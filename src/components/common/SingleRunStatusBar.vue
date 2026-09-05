<script setup lang="ts">
/**
 * 共用单局状态栏（PRD §5.2 / document/ui.md 顶栏布局）
 * 用于 BattleView / RunView / SettlementView 等所有需要显示角色基础信息与遗物的视图
 * 包含：角色基础信息（HP/金币/药水/层数/Boss）+ 遗物栏 + 卡组/地图/菜单按钮
 * 地图按钮：任何页面点击 → 中央弹窗显示 17 层地图（只读），点击空白处关闭
 * 顶栏固定在屏幕上方（sticky），滚动时保持可见
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import { getCard, getRelic } from '@/data'
import { NODE_TYPE_NAME } from '@/composables/useMap'
import { ACTS } from '@/config/gameConfig'
import CardView from '@/components/common/CardView.vue'
import PauseMenu from '@/components/common/PauseMenu.vue'
import type { MapNode } from '@/types'

const store = useGameStore()

// ===== 弹窗 =====
const showDeck = ref(false)
const showMenu = ref(false)
const showMap = ref(false)

// 地图弹窗容器 ref：打开时滚动定位到当前所在楼层
const mapBodyRef = ref<HTMLElement | null>(null)

// 打开地图时，将视图滚动到"当前所在层"所在行（需求：不应回到顶端的第 17 层）
watch(showMap, (open) => {
  if (!open) return
  // 等 DOM 渲染完成后，再于下一帧（flex/动画布局安定后）滚动定位到当前所在楼层
  nextTick(() => {
    requestAnimationFrame(() => {
      mapBodyRef.value?.querySelector('.current-row')?.scrollIntoView({ block: 'center' })
    })
  })
})

// 触发暂停菜单的游戏进行中阶段（结算/测试/图鉴等阶段禁用 Esc 暂停）
const PAUSE_PHASES = ['RUN', 'BATTLE', 'SHOP', 'CAMPFIRE', 'EVENT', 'REWARD', 'PAUSE']

// 全局 Esc 快捷键开关暂停菜单（PRD §3.11：战斗与地图界面均可按 Esc 打开暂停）
function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return
  if (!PAUSE_PHASES.includes(store.phase)) return
  ev.preventDefault()
  // 若卡组/地图弹窗打开，先关闭其中之一，再开暂停菜单（合理的交互优先级）
  if (showDeck.value) {
    showDeck.value = false
    return
  }
  if (showMap.value) {
    showMap.value = false
    return
  }
  showMenu.value = !showMenu.value
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// 遗物栏（替换"页签遗物"小标题）
const relicChips = computed(() =>
  (store.run?.relics ?? []).map((id) => {
    const r = getRelic(id)
    return r ? { id, name: r.name } : { id, name: id }
  }),
)

// ===== 点击已拥有遗物 → 在遗物下方显示遗物数据 =====
// 记录当前选中的遗物 id；再点击同一项则收起，点其它项则切换
const selectedRelic = ref<string | null>(null)
// 当前选中遗物的完整数据（缺失时回退 null，不展示详情条）
const selectedRelicData = computed(
  () => (selectedRelic.value !== null ? getRelic(selectedRelic.value) : undefined) ?? null,
)
// 点击遗物徽章：同项切换显隐、异项切换显示
function toggleRelic(id: string): void {
  selectedRelic.value = selectedRelic.value === id ? null : id
}

interface Props {
  playerHp?: number
  playerMaxHp?: number
  playerBlock?: number
  playerStrength?: number
  turn?: number
  energy?: number
  maxEnergy?: number
}

const props = withDefaults(defineProps<Props>(), {
  playerHp: 0,
  playerMaxHp: 0,
  playerBlock: 0,
  playerStrength: 0,
  turn: 0,
  energy: 0,
  maxEnergy: 0,
})

const hpCurrent = computed(() =>
  props.playerHp > 0 ? props.playerHp : store.run ? store.run.hp : 0,
)
const hpMax = computed(() =>
  props.playerMaxHp > 0 ? props.playerMaxHp : store.run ? store.run.maxHp : 0,
)
const hpPercent = computed(() =>
  hpMax.value > 0 ? Math.max(0, (hpCurrent.value / hpMax.value) * 100) : 0,
)

const turnLabel = computed(() => (props.turn > 0 ? `回合 ${props.turn}` : ''))
const isBoss = computed(() => store.battleKind === 'boss')

// ===== 地图弹窗（只读，配合主地图 RunView 的同款排版：虚线连线 + 按列网格落位） =====
// 楼层自下而上（floor 1 在最下），与 RunView 使用同一套几何常量，保证弹窗与主地图观感一致
const mapFloors = computed<MapNode[][]>(() => {
  const nodes = store.run?.map ?? []
  const total = nodes.reduce((max, n) => Math.max(max, n.floor), 0)
  const floors: MapNode[][] = []
  for (let f = 1; f <= total; f++) floors.push(nodes.filter((n) => n.floor === f))
  return floors
})

// 节点类型 → 颜色类名（与 RunView 一致）
const typeClass = (t: string): string => `node-${t}`

// —— 地图几何常量（与 RunView.vue 保持一致，确保弹窗内节点/连线的坐标排版相同）——
const COL_W = 110 // 单列宽（每层最多 branchMax 列）
const ROW_H = 44 // 节点行高
const ROW_GAP = 48 // 行间隔
const ROW_STEP = ROW_H + ROW_GAP // 相邻楼层 y 距
const COLS = 5 // 每层最大分支数 = 列数
// 地图容器宽（列数 × 列宽，固定 550px）
const mapW = COLS * COL_W
// 实际最大层数（非固定 17，从当前地图节点动态取得）
const mapTotal = computed(() => store.run?.map.reduce((max, n) => Math.max(max, n.floor), 0) ?? 17)
// 地图高度（顶层 floor 在顶，参考 RunView）
const mapH = computed(() => (mapTotal.value - 1) * ROW_STEP + ROW_H)

// 每层节点数（用于水平居中该层各分支；先古/Boss 单节点因此居中）
function layerWidth(floor: number): number {
  return store.run?.map.filter((n) => n.floor === floor).length ?? 0
}
// 某层居左偏移列数：让该层在 COLS 列网格中水平居中（与 RunView 相同的分散居中）
function layerOffset(floor: number): number {
  return Math.floor((COLS - layerWidth(floor)) / 2)
}
// 节点中心像素坐标（floor 1 在最底；供 SVG 连线端点使用）
function nodeCenter(n: MapNode): { x: number; y: number } {
  return {
    x: (layerOffset(n.floor) + n.row) * COL_W + COL_W / 2,
    y: (mapTotal.value - n.floor) * ROW_STEP + ROW_H / 2,
  }
}
// 虚线连线：每个节点 → 其 next 目标的线段（与 RunView 的连线数据一致）
const mapLines = computed<Array<{ x1: number; y1: number; x2: number; y2: number }>>(() => {
  const map = store.run?.map ?? []
  const out: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  for (const n of map) {
    const a = nodeCenter(n)
    for (const id of n.next) {
      const t = map.find((m) => m.id === id)
      if (!t) continue
      const b = nodeCenter(t)
      out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
    }
  }
  return out
})
</script>

<template>
  <div v-if="store.run" class="status-bar">
    <!-- ① 顶栏：基础信息 -->
    <header class="top-bar">
      <div class="top-left">
        <span class="avatar" title="铁甲战士">⚔️</span>
        <span class="hp">
          <span class="hp-bar">
            <span class="hp-fill" :style="{ width: hpPercent + '%' }" />
          </span>
          ❤ {{ hpCurrent }}/{{ hpMax }}
        </span>
        <span class="gold">💰 {{ store.run.gold }}</span>
        <span class="potion-slot" title="药水系统未上线">药水（—）</span>
        <span class="floor"
          >第 {{ store.run.floor }} 层<span class="floor-act"
            >· {{ ACTS[store.run.act ?? 'overgrowth'].name }}</span
          ></span
        >
        <span v-if="isBoss" class="boss-tag">BOSS</span>
        <span v-if="props.playerBlock" class="block">🛡 {{ props.playerBlock }}</span>
        <span v-if="props.playerStrength" class="str">力量 {{ props.playerStrength }}</span>
      </div>
      <div class="top-right">
        <span v-if="turnLabel" class="turn">{{ turnLabel }}</span>
        <span v-if="props.energy > 0 || props.maxEnergy > 0" class="energy">
          ⚡ {{ props.energy }}/{{ props.maxEnergy }}
        </span>
        <button class="btn top-btn" title="查看当前牌组" @click.stop="showDeck = !showDeck">
          卡组
        </button>
        <button class="btn top-btn" title="查看地图" @click.stop="showMap = !showMap">地图</button>
        <button class="btn top-btn" title="暂停菜单" @click.stop="showMenu = true">菜单</button>
      </div>
    </header>

    <!-- ② 遗物栏：点击徽章 → 在该徽章下方显示遗物数据（再点收起；点其它项切换到该遗物） -->
    <div class="relic-bar">
      <span class="relic-label">遗物</span>
      <button
        v-for="r in relicChips"
        :key="r.id"
        class="relic-chip"
        :class="{ selected: selectedRelic === r.id }"
        @click="toggleRelic(r.id)"
      >
        {{ r.name }}
      </button>
    </div>

    <!-- ②-1 选中遗物的详情条：显示在遗物栏下方（名称 + 完整效果描述），无选中时隐藏 -->
    <Transition name="relic-fade">
      <div v-if="selectedRelicData" class="relic-detail">
        <strong>{{ selectedRelicData.name }}</strong>
        <span>{{ selectedRelicData.desc }}</span>
      </div>
    </Transition>

    <!-- 全屏页：覆盖整个屏幕、左右透明透出当前场景（用 z-index:9999 强制最上层） -->
    <div v-if="showDeck" class="full-page">
      <div class="page-panel">
        <h3 class="page-title">卡组（{{ store.run?.deck.length ?? 0 }}）</h3>
        <div class="page-deck-grid">
          <CardView
            v-for="(entry, i) in store.run?.deck ?? []"
            :key="i"
            :card="getCard(entry.id)"
            :upgraded="entry.upgrade"
          />
        </div>
      </div>
      <button class="back-arrow" title="返回当前场景" @click="showDeck = false">← 返回</button>
    </div>

    <div v-if="showMap" class="full-page map-page" @click.self="showMap = false">
      <div class="page-panel">
        <h3 class="page-title">
          {{ ACTS[store.run?.act ?? 'overgrowth'].name }}幕地图（第 {{ store.run?.floor ?? 0 }} 层）
        </h3>
        <div ref="mapBodyRef" class="page-map">
          <!-- 与主地图 RunView 同款：虚线连线 + 按列网格落位 + 楼层自下而上 -->
          <div
            class="map-canvas"
            :style="{
              width: mapW + 'px',
              height: mapH + 'px',
              '--col-w': COL_W + 'px',
              '--row-h': ROW_H + 'px',
              '--row-gap': ROW_GAP + 'px',
            }"
          >
            <svg class="map-lines" :viewBox="`0 0 ${mapW} ${mapH}`" aria-hidden="true">
              <line
                v-for="(l, i) in mapLines"
                :key="i"
                :x1="l.x1"
                :y1="l.y1"
                :x2="l.x2"
                :y2="l.y2"
                class="conn-line"
              />
            </svg>
            <div
              v-for="row in [...mapFloors].reverse()"
              :key="row[0]!.floor"
              class="map-row"
              :class="{ 'current-row': row.some((n) => n.id === store.run?.nodeId) }"
            >
              <span class="map-floor-no">{{ row[0]?.floor }}</span>
              <div
                v-for="node in row"
                :key="node.id"
                class="map-node-wrap"
                :style="{ gridColumn: String(layerOffset(node.floor) + node.row + 1) }"
              >
                <span
                  class="map-node"
                  :class="[typeClass(node.type), { current: node.id === store.run?.nodeId }]"
                  :title="NODE_TYPE_NAME[node.type]"
                >
                  {{ NODE_TYPE_NAME[node.type] }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <button class="back-arrow" title="返回当前场景" @click="showMap = false">← 返回</button>
    </div>

    <!-- 暂停菜单（PRD §3.11）：Esc/菜单按钮打开；含重打、控制台、存档退出、放弃本局 -->
    <PauseMenu v-if="showMenu" @close="showMenu = false" />

    <!-- 开局选中先古遗物后的幕名浮层：屏幕正中显示，1 秒后自动缓慢淡出 -->
    <Transition name="splash">
      <div v-if="store.actSplash" class="act-splash">{{ ACTS[store.actSplash].name }}</div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.status-bar {
  position: fixed; // 改 fixed 而非 sticky：sticky 元素会创建 containing block 让子元素 fixed 相对 status-bar 定位
  top: 0;
  left: 0;
  right: 0;
  z-index: 100; // 顶栏 fixed 提高 z-index
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 18px 6px;
  border-bottom: 1px solid var(--border);
  // 顶部渐变暖光 + 底部投影，让状态栏从场景中"浮起"（纯 CSS）
  background: linear-gradient(
    180deg,
    rgba(28, 23, 20, 0.98),
    rgba(20, 16, 14, 0.96)
  ); // 半透明底（不加 backdrop-filter）
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}
.top-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.avatar {
  font-size: 20px;
}
.hp {
  color: var(--accent-strong);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.hp-bar {
  width: 80px;
  height: 9px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--bg-deep);
  overflow: hidden;
}
.hp-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent-dim), var(--accent-strong));
}
.gold {
  color: var(--gold);
}
.potion-slot {
  color: var(--text-faint);
  font-size: 12px;
}
.floor {
  color: var(--text-dim);
}
// 楼层右侧的幕（地图）类型说明：弱化区分于楼层号
.floor-act {
  color: var(--text-faint);
}
.boss-tag {
  color: var(--accent-strong);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 0 6px;
  font-size: 12px;
}
.block {
  color: #6aa8d6;
}
.str {
  color: var(--gold);
}
.top-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.turn,
.energy {
  color: var(--text-dim);
  font-size: 13px;
}
.energy {
  color: var(--gold);
}
.top-btn {
  font-size: 13px;
  padding: 4px 10px;
}
.relic-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  flex-wrap: wrap;
}
.relic-label {
  font-size: 12px;
  color: var(--text-faint);
}
.relic-chip {
  font-size: 12px;
  color: var(--gold);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 8px;
  background: rgba(201, 162, 39, 0.08);
  cursor: pointer; // 点击查看遗物数据
  font-family: inherit;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.relic-chip:hover {
  border-color: var(--gold);
}
// 选中态：金色高亮边框，提示当前正在查看该遗物数据
.relic-chip.selected {
  border-color: var(--gold);
  background: rgba(201, 162, 39, 0.22);
  box-shadow: 0 0 6px rgba(201, 162, 39, 0.35);
}
// 选中遗物的详情条：位于遗物栏下方，浅底 + 虚线分隔，展示名称与完整描述
.relic-detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: rgba(201, 162, 39, 0.05);
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-main);
  // 缩小详情框：不再占满整行，限制宽度并靠左排列
  align-self: flex-start;
  max-width: 420px;
}
.relic-detail strong {
  color: var(--gold);
}
.relic-detail span {
  color: var(--text-dim);
}
// 详情条出现/消失的淡入淡出动画
.relic-fade-enter-active,
.relic-fade-leave-active {
  transition: opacity 0.15s ease;
}
.relic-fade-enter-from,
.relic-fade-leave-to {
  opacity: 0;
}

/* 地图弹窗：与主地图 RunView 同款的节点/连线排版 */
.map-canvas {
  position: relative;
  margin: 0 auto;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  row-gap: var(--row-gap); // 相邻楼层行间隔（放大，层次清晰，与主地图一致）
}
// 连线层：虚线连接各节点（SVG line），位于节点下方，不拦截点击
.map-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}
.conn-line {
  stroke: var(--border-strong);
  stroke-width: 1.5;
  stroke-dasharray: 6 4; // 节点由虚线连接
  opacity: 0.55;
}
.map-row {
  height: var(--row-h);
  position: relative;
  display: grid;
  grid-template-columns: repeat(5, var(--col-w)); // 5 列柱网格，与主地图列数一致
}
.map-floor-no {
  position: absolute;
  left: -34px; // 楼层号悬于左侧列外，不影响网格列对齐
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--text-faint);
  z-index: 2;
}
.map-node-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1;
}
.map-node {
  width: 72px;
  height: var(--row-h);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-raised);
  color: var(--text-main);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.map-node.current {
  outline: 2px solid var(--gold);
}
.node-monster {
  border-color: #7a3220;
}
.node-elite {
  border-color: #b5482d;
}
.node-boss {
  border-color: #d9663f;
  box-shadow: 0 0 10px rgba(217, 102, 63, 0.4);
}
.node-chest {
  border-color: #c9a227;
}
.node-campfire {
  border-color: #a89a84;
}
.node-shop {
  border-color: #5a86ad;
}
.node-unknown {
  border-color: #8a5fa8;
}
.node-neow {
  border-color: #6f9d5a;
}

/* 全屏覆盖页：覆盖整个屏幕、panel 水平居中且上下填满，左右透出当前场景 */
.full-page {
  position: fixed;
  inset: 0;
  pointer-events: auto;
  display: flex;
  justify-content: center; // 水平居中 panel
  align-items: stretch; // 垂直方向撑满剩余屏幕高度
  padding-top: 69px; // 顶部让出固定状态栏（角色信息行 + 遗物栏），面板不越过该行
  z-index: 20;
  overflow: auto; // panel 超高时允许滚动
  background: transparent; // 显式透明，左右透出当前场景
}
.map-page {
  cursor: pointer; // 点击空白关闭
}

/* 中央不透明 panel：水平居中、上下填满屏幕高度，宽度容纳 6 张 132px 卡牌 + 间隔 + padding */
.page-panel {
  pointer-events: auto;
  background: rgba(14, 11, 9, 0.96);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 20px 24px 24px;
  width: 920px;
  max-width: calc(60vw);
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%; // 上下填满整个屏幕高度（配合 .full-page 的 align-items: stretch）
}
.page-title {
  color: var(--accent-strong);
  font-size: 26px;
  margin: 0;
  letter-spacing: 2px;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
  flex-shrink: 0;
  text-align: center;
}
/* 卡组网格：固定 6 列 × 132px = 792 + 5*8 gap = 832，panel 内宽 920-48=872 容纳 */
.page-deck-grid {
  display: grid;
  grid-template-columns: repeat(6, 132px);
  gap: 8px;
  justify-content: center;
  width: 100%;
  margin: 0 auto;
  flex: 1; // 占满 panel 剩余高度
  min-height: 0; // 允许 flex 子项收缩，配合 overflow 滚动
  overflow-y: auto; // 卡组超高时 panel 内部滚动
}
// CardView 在 grid item 中自适应列宽（深选择器穿透 scoped）
.page-deck-grid :deep(.card) {
  width: 100% !important;
  height: auto !important;
  aspect-ratio: 132 / 190; // 保持原卡牌 132:190 比例
}
.page-map {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1; // 占满 panel 剩余高度
  min-height: 0; // 允许 flex 子项收缩，配合 overflow 滚动
  overflow-y: auto; // 17 层地图超高时 panel 内部滚动
  // 左预留楼层号空间（.map-floor-no 绝对定位于行外 -34px），节点/连线排版不受影响
  padding-left: 50px;
}
.page-menu {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  margin-top: 30px;
}
.big-btn {
  font-size: 18px !important;
  padding: 12px 30px !important;
  min-width: 220px;
}

/* 返回按钮：固定定位到指定坐标（用 !important 防被 .full-page 父级或 z-index 影响） */
.back-arrow {
  position: fixed !important;
  top: 600px !important;
  left: 145px !important;
  right: auto !important;
  transform: none !important;
  width: 90px;
  height: 32px;
  border-radius: 4px;
  border: 2px solid #fff;
  background: var(--accent-strong); // 红色
  color: #fff;
  font-size: 14px;
  font-weight: bold;
  letter-spacing: 1px;
  cursor: pointer;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition:
    background 0.15s,
    transform 0.1s;
}
.back-arrow:hover {
  background: #b53a20;
  transform: scale(1.04) !important;
}
.back-arrow:active {
  transform: scale(0.96) !important;
}

// 开局幕名浮层：固定屏幕正中，大号哥特风标题，1 秒后经 Transition 缓慢淡出
.act-splash {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none; // 不拦截点击，下方地图/界面可正常操作
  z-index: 9999;
  color: var(--accent-strong);
  font-size: 64px;
  font-weight: bold;
  letter-spacing: 12px;
  text-shadow:
    0 0 30px rgba(217, 102, 63, 0.45),
    0 2px 8px rgba(0, 0, 0, 0.8);
}
// 进入淡入、离开缓慢淡出（Transition leave 时长为淡出动画时长）
.splash-enter-active,
.splash-leave-active {
  transition: opacity 0.8s ease;
}
.splash-enter-from,
.splash-leave-to {
  opacity: 0;
}
</style>
