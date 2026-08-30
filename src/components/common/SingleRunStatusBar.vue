<script setup lang="ts">
/**
 * 共用单局状态栏（PRD §5.2 / document/ui.md 顶栏布局）
 * 用于 BattleView / RunView / SettlementView 等所有需要显示角色基础信息与遗物的视图
 * 包含：角色基础信息（HP/金币/药水/层数/Boss）+ 遗物栏 + 卡组/地图/菜单按钮
 * 地图按钮：任何页面点击 → 中央弹窗显示 17 层地图（只读），点击空白处关闭
 * 顶栏固定在屏幕上方（sticky），滚动时保持可见
 */
import { ref, computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import { getCard, getRelic } from '@/data'
import { NODE_TYPE_NAME } from '@/composables/useMap'
import CardView from '@/components/common/CardView.vue'
import type { MapNode } from '@/types'

const store = useGameStore()

// ===== 弹窗 =====
const showDeck = ref(false)
const showMenu = ref(false)
const showMap = ref(false)

// 遗物栏（替换"页签遗物"小标题）
const relicChips = computed(() =>
  (store.run?.relics ?? []).map((id) => {
    const r = getRelic(id)
    return r ? { id, name: r.name } : { id, name: id }
  }),
)

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

// ===== 地图弹窗（只读，楼层自下而上） =====
const mapFloors = computed<MapNode[][]>(() => {
  const nodes = store.run?.map ?? []
  const total = nodes.reduce((max, n) => Math.max(max, n.floor), 0)
  const floors: MapNode[][] = []
  for (let f = 1; f <= total; f++) floors.push(nodes.filter((n) => n.floor === f))
  return floors
})

// 节点类型 → 颜色类名（与 RunView 一致）
const typeClass = (t: string): string => `node-${t}`

// 放弃本局
function abandon(): void {
  store.abandonRun()
}
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
        <span class="floor">第 {{ store.run.floor }} 层</span>
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

    <!-- ② 遗物栏 -->
    <div class="relic-bar">
      <span class="relic-label">遗物</span>
      <span v-for="r in relicChips" :key="r.id" class="relic-chip">{{ r.name }}</span>
    </div>

    <!-- 全屏页：卡组（透明背景覆盖整个屏幕，铺满布局，红色长方形返回箭头回到当前场景） -->
    <div v-if="showDeck" class="full-page">
      <h3 class="page-title">卡组（{{ store.run.deck.length }}）</h3>
      <div class="page-deck-grid">
        <CardView v-for="(id, i) in store.run.deck" :key="i" :card="getCard(id)" />
      </div>
      <button class="back-arrow" title="返回当前场景" @click="showDeck = false">← 返回</button>
    </div>

    <!-- 全屏页：地图（透明背景覆盖整个屏幕，17 层全显） -->
    <div v-if="showMap" class="full-page map-page" @click.self="showMap = false">
      <h3 class="page-title">密林幕地图（第 {{ store.run.floor }} 层）</h3>
      <div class="page-map">
        <div v-for="(row, idx) in [...mapFloors].reverse()" :key="idx" class="map-row">
          <span class="map-floor-no">{{ row[0]?.floor }}</span>
          <div class="map-nodes">
            <span
              v-for="node in row"
              :key="node.id"
              class="map-dot"
              :class="[typeClass(node.type), { current: node.id === store.run?.nodeId }]"
              :title="NODE_TYPE_NAME[node.type]"
            >
              {{ NODE_TYPE_NAME[node.type] }}
            </span>
          </div>
        </div>
      </div>
      <button class="back-arrow" title="返回当前场景" @click="showMap = false">← 返回</button>
    </div>

    <!-- 全屏页：菜单 -->
    <div v-if="showMenu" class="full-page">
      <h3 class="page-title">菜单</h3>
      <div class="page-menu">
        <button class="btn btn-primary big-btn" @click="showMenu = false">继续游戏</button>
        <button class="btn big-btn" @click="abandon">放弃本局（回主菜单）</button>
      </div>
      <button class="back-arrow" title="返回当前场景" @click="showMenu = false">← 返回</button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.status-bar {
  position: sticky;
  top: 0;
  z-index: 15;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 18px 6px;
  border-bottom: 1px solid var(--border);
  background: rgba(20, 16, 14, 0.96); // 固定顶栏半透明底，滚动时内容不被遮挡
  backdrop-filter: blur(4px);
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
}

/* 地图弹窗 */
.map-mini {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 60vh;
  overflow: auto;
}
.map-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.map-floor-no {
  width: 24px;
  text-align: right;
  font-size: 11px;
  color: var(--text-faint);
}
.map-nodes {
  flex: 1;
  display: flex;
  justify-content: space-around;
  gap: 6px;
}
.map-dot {
  width: 56px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text-dim);
}
.map-dot.current {
  outline: 2px solid var(--gold);
  color: var(--text-main);
}
.node-monster {
  border-color: #7a3220;
}
.node-elite {
  border-color: #b5482d;
}
.node-boss {
  border-color: #d9663f;
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

/* 全屏覆盖页：覆盖整个屏幕、透明背景（透出当前场景）、红色长方形返回箭头 */
.full-page {
  position: fixed;
  inset: 0;
  // 透明遮罩：场景透出，但内容仍可读
  background: rgba(8, 6, 5, 0.3);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 70px 32px 32px; // 顶部避开顶栏
  z-index: 20;
  overflow: auto;
}
.map-page {
  cursor: pointer; // 点击空白关闭
}
.page-title {
  color: var(--accent-strong);
  font-size: 26px;
  margin: 0 0 20px;
  letter-spacing: 2px;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
  flex-shrink: 0;
}
.page-deck-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
}
.page-map {
  width: 100%;
  max-width: 1000px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
.page-menu {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  margin-top: 60px;
}
.big-btn {
  font-size: 18px !important;
  padding: 12px 30px !important;
  min-width: 220px;
}

/* 左上角返回箭头：红色长方形（PRD：上调、红色、长方形） */
.back-arrow {
  position: fixed;
  top: 70px; // 顶栏下方
  left: 18px;
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
  transform: scale(1.04);
}
.back-arrow:active {
  transform: scale(0.96);
}
</style>
