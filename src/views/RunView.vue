<script setup lang="ts">
/**
 * 单局主视图（PRD §3.2）：密林幕 17 层地图 + 商店/篝火/事件/奖励浮层
 * 顶部显示 SingleRunStatusBar（角色基础信息 + 遗物栏，含卡组/菜单弹窗）
 * 地图渲染：楼层自下而上（1 层在下）；行间隔放大；节点间以虚线连接；每个节点随机浮动；
 * 节点仅"当前节点的下一层连线节点"可进入（修复可走同层/上层节点）。
 */
import { computed, ref, nextTick, onBeforeUnmount, watch } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import { useMap, NODE_TYPE_NAME } from '@/composables/useMap'
import SingleRunStatusBar from '@/components/common/SingleRunStatusBar.vue'
import DeckChooseOverlay from '@/components/common/DeckChooseOverlay.vue'
import CardReveal from '@/components/common/CardReveal.vue'
import type { MapNode } from '@/types'
import { MAP } from '@/config/gameConfig'

const store = useGameStore()
const { floors, current, isEnterable, isReachable } = useMap()

// —— 地图网格几何常量（决定 DOM 布局与 SVG 连线坐标，须保持一致）——
const COL_W = 110 // 单列宽（每层最多 branchMax 列）
const ROW_H = 44 // 节点行高
const ROW_GAP = 48 // 行间隔（放大，使各楼层层次更清晰）
const ROW_STEP = ROW_H + ROW_GAP // 相邻楼层 y 距
const COLS = MAP.branchMax // 每层最大分支数 = 列数

// 地图容器宽高（SVG viewBox 与 DOM 同尺寸）
const mapW = COLS * COL_W
const mapH = (MAP.totalFloors - 1) * ROW_STEP + ROW_H

// 每层节点数（用于水平居中各层分支；先古/Boss 单节点因此居中）
function layerWidth(floor: number): number {
  return store.run?.map.filter((n) => n.floor === floor).length ?? 0
}
// 某层居左偏移列数：让该层在 COLS 列网格中水平居中（需求：节点分散居中分布）
function layerOffset(floor: number): number {
  return Math.floor((COLS - layerWidth(floor)) / 2)
}

// 节点中心坐标：floor 1 在底部（渲染顶部为 floor 17），x 由"层居偏移 + 行号"决定
function nodeCenter(n: MapNode): { x: number; y: number } {
  return {
    x: (layerOffset(n.floor) + n.row) * COL_W + COL_W / 2,
    y: (MAP.totalFloors - n.floor) * ROW_STEP + ROW_H / 2,
  }
}

// 虚线连线数据：收集每个节点 → 其 next 目标的线段（起点/终点像素坐标）
const lines = computed(() => {
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

// 节点类型 → 颜色类名
const typeClass = (t: string): string => `node-${t}`

// 进入节点（仅可达且未访问的节点可进）
function onNodeClick(node: MapNode): void {
  if (!isEnterable(node)) return
  node.visited = true
  store.enterNode(node.id)
}

// 浮层显隐由阶段驱动
const showOverlay = (phase: string): boolean => store.phase === phase

// 地图滚动容器 ref：用于首次进入地图时的"慢速滚到当前层"动画
const rootRef = ref<HTMLElement | null>(null)
// 缓入缓出曲线（让滚动匀速起停，观感更自然）
function easeInOut(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
}

// 首次进入地图的滚动动画时长（毫秒）：滚动到当前层后，幕名随即开始淡出（见 maybeMapIntro 的 showActSplash 传参）
const MAP_INTRO_MS = 1400

// 计算"让当前节点纵向居中于滚动容器"的目标滚动量（供慢滚动画与瞬时跳转复用，PRD §3.2.2）
function scrollTargetForCurrent(): number | null {
  const root = rootRef.value
  const cur = root?.querySelector<HTMLElement>('.map-node.current')
  if (!root || !cur) return null // 无容器或点位时返回 null（调用方自行兜底）
  const cRect = root.getBoundingClientRect()
  const eRect = cur.getBoundingClientRect()
  // 目标滚动量：让当前节点纵向居中于滚动容器（避免滚到最底露不出来）
  return root.scrollTop + (eRect.top - cRect.top) - (cRect.height / 2 - eRect.height / 2)
}

// 首次进入地图引导：将地图由顶部向下慢速滚动，直至"当前所在楼层"节点进入视野中央
// 用 requestAnimationFrame 逐帧推进 scrollTop，配合缓动实现"慢慢向下移动"的效果
function animateMapIntro(): void {
  const root = rootRef.value
  if (!root) return
  const target = scrollTargetForCurrent()
  if (target === null) return // 无当前节点时顺其自然（不至于卡死界面）
  const start = root.scrollTop
  const dist = target - start
  const dur = MAP_INTRO_MS // 慢滚时长：由统一常量控制（与幕名显示时长联动）
  const t0 = performance.now()
  const step = (now: number): void => {
    const p = Math.min(1, (now - t0) / dur)
    root.scrollTop = start + dist * easeInOut(p)
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// 首次进入地图引导（一次性）：幕名浮层 + 地图慢速滚动到当前层，两件事同时进行。
// 幕名显示时长 = 滚动时长 + 200ms 余量：滚动到位后幕名随即开始淡出，不再悬挂过久。
// 仅新局首次落地地图时执行；之后每次返回地图只做瞬时定位（recenterMap），不再慢滚与弹幕名。
function maybeMapIntro(): void {
  if (store.mapIntroDone) return
  store.mapIntroDone = true
  nextTick(() => {
    animateMapIntro()
    store.showActSplash(MAP_INTRO_MS + 200)
  })
}

// 回到地图时把滚动重新定位到"当前所在楼层"：地图是常驻滚动容器（跨节点/战斗不卸载），
// 打完一节点从 BATTLE/SHOP/EVENT 等回到 RUN 时 scrollTop 仍停留在原处（如上次结束的 boss 层），
// 必须在每次"地图就绪"时重新滚滚到当前节点，否则玩家会一直停在最后一层看不到当前层。
function recenterMap(): void {
  // 等 DOM 渲染完成后，再于下一帧（布局安定后）直接跳转到"当前节点所在楼层"（瞬时，不做慢滚动画）
  nextTick(() => {
    const root = rootRef.value
    const target = scrollTargetForCurrent()
    if (root && target !== null) root.scrollTop = target
  })
}

// 触发时机：新局先进入 Neow 浮层（phase=REWARD），选定遗物（可能连带有需选卡的遗物）后才真正落到地图。
// 为避免在"选卡/选遗物进行中"过早弹幕名+滚动，仅当"地图就绪"（RUN 阶段且无任何待选奖励/选卡）时触发。
// 用 immediate 监听：直接进入 RUN（续档等）或 REWARD→RUN 结束后、选卡队列清空时都会命中。
const settledOnMap = computed(
  () =>
    store.phase === 'RUN' &&
    !store.pendingReward &&
    store.pendingPicks.length === 0 &&
    store.activeDeckPick === null,
)
const settledStop = watch(
  settledOnMap,
  (settled) => {
    if (!settled) return
    // 首次进入地图：慢滚 + 幕名引导（maybeMapIntro 内部拦截，仅首次）；
    // 之后每次返回地图：瞬时跳转到"当前所在楼层"（不做慢滚动画）。
    if (store.mapIntroDone) recenterMap()
    else maybeMapIntro()
  },
  { immediate: true },
)
onBeforeUnmount(() => settledStop())
</script>

<template>
  <div ref="rootRef" class="run-view">
    <!-- 顶部：单局状态栏（HP/金币/药水/层数 + 遗物 + 卡组/菜单） -->
    <SingleRunStatusBar />

    <!-- 地图：楼层自下而上（1 层在下），虚线连线 + 节点随机浮动 -->
    <div
      class="map"
      :style="{
        width: mapW + 'px',
        height: mapH + 'px',
        '--col-w': COL_W + 'px',
        '--row-h': ROW_H + 'px',
        '--row-gap': ROW_GAP + 'px',
      }"
    >
      <!-- 连线层：绝对定位于地图上，按节点中心绘制虚线 -->
      <svg class="map-lines" :viewBox="`0 0 ${mapW} ${mapH}`" aria-hidden="true">
        <line
          v-for="(l, i) in lines"
          :key="i"
          :x1="l.x1"
          :y1="l.y1"
          :x2="l.x2"
          :y2="l.y2"
          class="conn-line"
        />
      </svg>

      <div v-for="row in [...floors].reverse()" :key="row[0]!.floor" class="map-floor">
        <span class="floor-no">{{ row[0]!.floor }}</span>
        <div
          v-for="node in row"
          :key="node.id"
          class="map-node-wrap"
          :style="{ gridColumn: String(layerOffset(node.floor) + node.row + 1) }"
        >
          <button
            class="map-node"
            :class="[
              typeClass(node.type),
              {
                locked: !isReachable(node) || node.locked,
                visited: node.visited,
                current: node.id === current?.id,
              },
            ]"
            :disabled="!isEnterable(node)"
            @click="onNodeClick(node)"
          >
            {{ NODE_TYPE_NAME[node.type] }}
          </button>
        </div>
      </div>
    </div>

    <!-- 阶段浮层 -->
    <div v-if="showOverlay('REWARD')" class="overlay">
      <RewardPanel />
    </div>
    <div v-if="showOverlay('EVENT')" class="overlay">
      <EventPanel />
    </div>
    <div v-if="showOverlay('SHOP')" class="overlay">
      <ShopPanel />
    </div>
    <div v-if="showOverlay('CAMPFIRE')" class="overlay">
      <CampfirePanel />
    </div>

    <!-- 通用选牌浮层：独立于阶段，由 store.pendingPicks 驱动（遗物拾取选牌可发生在任意阶段） -->
    <PickCardsModal />
    <!-- 全卡组选卡浮层：由 store.activeDeckPick 驱动（移除/变化/升级等需指定某一张拷贝的动作） -->
    <DeckChooseOverlay />
    <!-- 卡牌居中展示：事件/遗物获得卡牌时的获得动画浮层（1s 后自动消失，卡牌入组） -->
    <CardReveal />
  </div>
</template>

<style scoped lang="scss">
.run-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 8px 20px;
  padding-top: 80px; // 让出 SingleRunStatusBar 顶栏空间（顶栏 fixed）
  overflow: auto;
}

// 地图容器：相对定位（承接连线 SVG 层）；列宽/行距由内联 CSS 变量传入
.map {
  position: relative;
  margin: 12px auto 24px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  row-gap: var(--row-gap);
}

// 连线层：虚线连接各节点（svg line），位于节点下方，不拦截点击
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

// 每层一行：网格布局，节点按 row 落位到对应列，保证与 SVG 连线坐标对齐
.map-floor {
  height: var(--row-h);
  position: relative;
  display: grid;
  grid-template-columns: repeat(5, var(--col-w));
}
.floor-no {
  position: absolute;
  left: -34px; // 楼层号悬于左侧列外，不影响网格列对齐
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--text-faint);
  z-index: 2;
}

// 节点层：静态分散排布（去掉浮动动画，需求：节点不需要跳动）
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
  cursor: pointer;
  transition:
    border-color 0.12s,
    transform 0.08s;
}
.map-node:disabled {
  cursor: not-allowed;
}
.map-node:hover:not(:disabled) {
  border-color: var(--accent-strong);
  transform: scale(1.06);
}
.map-node.locked {
  opacity: 0.35;
  background: var(--bg-deep);
}
.map-node.visited {
  opacity: 0.55;
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

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 8, 7, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
</style>
