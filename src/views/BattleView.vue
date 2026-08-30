<script setup lang="ts">
/**
 * 战斗视图（PRD §5.2 / document/ui.md）
 * 布局：SingleRunStatusBar 顶栏（HP/金币/药水/层数/Boss + 回合/卡组/菜单）→ 战场
 * → 底栏（左 [能量 / 抽牌堆] / 中 [手牌] / 右 [结束回合 / 消耗堆 / 弃牌堆]）
 * 交互（PRD §5.3 + §3.3.2）：拖拽玩法
 *   - 攻击卡：mousedown → 拖拽中显示虚线箭头 → 松手在怪物上指定目标
 *   - 技能/能力卡：拖拽到玩家身上或手牌外松手即可直接打出
 *   - 兼容点击：点击攻击卡 → 进入选择态 → 再点怪物
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useBattle } from '@/composables/useBattle'
import { useGameStore } from '@/stores/gameStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getCard, getRelic } from '@/data'
import SingleRunStatusBar from '@/components/common/SingleRunStatusBar.vue'
import type { CombatFx } from '@/engine/combatEngine'

const { ctx, hand, enemies, canPlay } = useBattle()
const store = useGameStore()
const settings = useSettingsStore()

// 只读模式：战斗已结算（胜利后从奖励页返回查看战场，PRD §3.3.7）
const readonly = computed(() => store.battleResult?.status === 'victory')

// ===== 目标选择 / 拖拽状态 =====
// 拖拽态：null 表示无拖拽；对象包含卡牌 id、卡牌中心坐标、当前鼠标坐标
interface DragState {
  cardId: string
  startX: number
  startY: number
  currentX: number
  currentY: number
  // 是否已经离开手牌（拖出去即开始拖拽）
  moved: boolean
}
const drag = ref<DragState | null>(null)
// 点选态（点攻击卡后等待点怪物）
const selectedCardId = ref<string | null>(null)

// 战场 DOM ref（用于计算相对坐标、判定玩家区域）
const fieldRef = ref<HTMLDivElement | null>(null)
// 玩家卡 ref
const playerRef = ref<HTMLDivElement | null>(null)
// 各敌人 DOM refs（key = enemy.id）→ 用于鼠标进入/离开高亮
const enemyRefs = ref<Record<string, HTMLElement>>({})
// 自定义组件 ref 取其 $el 根节点；普通元素直接接收
function setEnemyRef(id: string, el: unknown): void {
  if (el instanceof HTMLElement) {
    enemyRefs.value[id] = el
    return
  }
  if (el && typeof el === 'object' && '$el' in el) {
    const root = (el as { $el: Element | null }).$el
    if (root instanceof HTMLElement) {
      enemyRefs.value[id] = root
      return
    }
  }
  delete enemyRefs.value[id]
}

// 当前悬停的敌人 id（拖拽中 + 点击选中时）
const hoveredEnemyId = ref<string | null>(null)

// ===== 拖拽玩法（PRD §5.3） =====
// 计算卡牌中心点（在 battle 容器内的相对坐标）
function getCardCenter(cardId: string): { x: number; y: number } | null {
  const el = document.querySelector<HTMLElement>(`.hand-slot[data-card-id="${CSS.escape(cardId)}"]`)
  const field = fieldRef.value
  if (!el || !field) return null
  const elRect = el.getBoundingClientRect()
  const fRect = field.getBoundingClientRect()
  return {
    x: elRect.left + elRect.width / 2 - fRect.left,
    y: elRect.top + elRect.height / 2 - fRect.top,
  }
}

// 鼠标按下卡牌：开始拖拽态（只有能打出的牌且非只读）
function onCardMouseDown(ev: MouseEvent, cardId: string): void {
  if (readonly.value) return
  const card = getCard(cardId)
  if (!card || !canPlay(card)) return
  // 阻止文本选择 + 阻止 bubble 触发 BattleView 根 @click 清空 selectedCardId
  ev.preventDefault()
  ev.stopPropagation()
  const field = fieldRef.value
  if (!field) return
  const fRect = field.getBoundingClientRect()
  const cardCenter = getCardCenter(cardId) ?? { x: 0, y: 0 }
  const needsTarget = card.type === 'attack'
  selectedCardId.value = null
  // 非攻击类：mousedown 即视为"开始"准备直接使用（不需要拖拽）
  if (!needsTarget) {
    drag.value = {
      cardId,
      startX: cardCenter.x,
      startY: cardCenter.y,
      currentX: ev.clientX - fRect.left,
      currentY: ev.clientY - fRect.top,
      moved: false,
    }
  } else {
    // 攻击类：直接进入拖拽态（用户要求的"拖拽到怪物"）
    drag.value = {
      cardId,
      startX: cardCenter.x,
      startY: cardCenter.y,
      currentX: ev.clientX - fRect.left,
      currentY: ev.clientY - fRect.top,
      moved: true,
    }
  }
}

// 拖拽中：更新坐标、判定悬停敌怪
function onMouseMove(ev: MouseEvent): void {
  if (!drag.value) return
  const field = fieldRef.value
  if (!field) return
  const fRect = field.getBoundingClientRect()
  drag.value.currentX = ev.clientX - fRect.left
  drag.value.currentY = ev.clientY - fRect.top
  // 判定悬停敌怪
  hoveredEnemyId.value = hitTestEnemy(ev.clientX, ev.clientY)
}

// 松手：根据当前点击位置决定出牌、选中目标或取消
function onMouseUp(ev: MouseEvent): void {
  const d = drag.value
  drag.value = null
  if (!d) return
  const card = getCard(d.cardId)
  if (!card || !canPlay(card)) {
    selectedCardId.value = null
    hoveredEnemyId.value = null
    return
  }
  // 玩家区域 = 玩家卡 div 命中
  if (playerRef.value) {
    const r = playerRef.value.getBoundingClientRect()
    if (
      ev.clientX >= r.left &&
      ev.clientX <= r.right &&
      ev.clientY >= r.top &&
      ev.clientY <= r.bottom
    ) {
      // 非攻击类在自己身上 = 使用；攻击类在自己身上 = 取消
      if (card.type !== 'attack') {
        play(d.cardId)
        return
      }
      selectedCardId.value = null
      hoveredEnemyId.value = null
      return
    }
  }
  // 攻击类：是否命中怪物
  if (card.type === 'attack') {
    const enemyId = hitTestEnemy(ev.clientX, ev.clientY)
    if (enemyId) {
      play(d.cardId, enemyId)
      return
    }
  } else {
    // 非攻击类：拖出到手牌"player 区域"之外即视为使用（依据用户需求"拖出手牌区"）
    // 已先判定 player 区域；如果在玩家身上则上面分支处理；其他地方松手 → 使用
    play(d.cardId)
    return
  }
  // 空白处松手：取消
  selectedCardId.value = null
  hoveredEnemyId.value = null
}

// 命中测试：鼠标点是否在某敌怪 DOM 内
function hitTestEnemy(clientX: number, clientY: number): string | null {
  for (const [id, el] of Object.entries(enemyRefs.value)) {
    const r = el.getBoundingClientRect()
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      return id
    }
  }
  return null
}

// ===== 兼容点击玩法（点击卡牌→点击怪物） =====
// 攻击卡：点击进入选择态（先前的 click 实现）；再点怪物出牌
function onCardClick(cardId: string): void {
  if (readonly.value) return
  if (drag.value) return // 拖拽中忽略点击
  const card = getCard(cardId)
  if (!card || !canPlay(card)) return
  if (card.type === 'attack') {
    // 单怪时直接打出，多怪时进入"等待选怪"态
    if (enemies.value.length <= 1 && enemies.value[0]) {
      play(cardId, enemies.value[0].id)
      return
    }
    selectedCardId.value = selectedCardId.value === cardId ? null : cardId
  } else {
    // 技能/能力：单次点击直接打出
    play(cardId)
  }
}

// 点击敌人：点击态时作为目标；若在拖拽中则忽略（拖拽用松手判定）
function onEnemyClick(unitId: string): void {
  if (drag.value) return
  if (!selectedCardId.value) return
  play(selectedCardId.value, unitId)
  selectedCardId.value = null
}

// 真正出牌入口
function play(cardId: string, targetId?: string): void {
  if (readonly.value) return
  store.playCard(cardId, targetId)
}

// ===== 结束回合 =====
function endTurn(): void {
  if (readonly.value) return
  store.endTurn()
}

// 返回奖励页（已结算只读战斗 → 奖励页）
function backToReward(): void {
  store.backToReward()
}

// ===== 弹窗：单牌堆查看 =====
const inspectingPile = ref<'draw' | 'discard' | 'exhaust' | null>(null)
const inspectingCards = computed(() => {
  if (!inspectingPile.value) return []
  const list =
    inspectingPile.value === 'draw'
      ? ctx.value!.drawPile.slice().reverse()
      : inspectingPile.value === 'discard'
        ? ctx.value!.discardPile.slice().reverse()
        : ctx.value!.exhaustPile.slice().reverse()
  return list.map((id) => ({ id, card: getCard(id) }))
})
function openPile(pile: 'draw' | 'discard' | 'exhaust'): void {
  inspectingPile.value = inspectingPile.value === pile ? null : pile
}

const pileLabel: Record<'draw' | 'discard' | 'exhaust', string> = {
  draw: '抽牌堆',
  discard: '弃牌堆',
  exhaust: '消耗牌堆',
}

// ===== 卡牌扇形角度 =====
function fanStyle(index: number, total: number): Record<string, string> {
  if (total <= 1) return {}
  const spread = Math.min(24, total * 4)
  const angle = (index - (total - 1) / 2) * (spread / total)
  return {
    transform: `rotate(${angle.toFixed(1)}deg) translateY(${(Math.abs(angle) * 0.6).toFixed(1)}px)`,
  }
}

// 拖拽时卡牌是否需要浮起 + 跟随光标（脱离原位）
const draggingCard = computed(() => drag.value)
const isDraggingAttack = computed(() => drag.value && getCard(drag.value.cardId)?.type === 'attack')

// 箭头终点：拖到敌怪上时指向敌怪中心；否则指向鼠标
const arrow = computed(() => {
  if (!drag.value) return null
  let tx = drag.value.currentX
  let ty = drag.value.currentY
  let toEnemy: string | null = null
  if (isDraggingAttack.value) {
    if (hoveredEnemyId.value && enemyRefs.value[hoveredEnemyId.value]) {
      const r = enemyRefs.value[hoveredEnemyId.value]!.getBoundingClientRect()
      const f = fieldRef.value!.getBoundingClientRect()
      tx = r.left + r.width / 2 - f.left
      ty = r.top + r.height / 2 - f.top
      toEnemy = hoveredEnemyId.value
    }
  } else {
    // 非攻击卡：让鼠标悬停玩家卡时指向玩家中心（自身用的视觉反馈）
    if (playerRef.value && hoveredEnemyId.value === null) {
      const r = playerRef.value.getBoundingClientRect()
      const f = fieldRef.value!.getBoundingClientRect()
      const cursorX = drag.value.currentX
      const cursorY = drag.value.currentY
      // 鼠标若落在玩家卡区域内 → 替换为玩家卡中心
      if (
        cursorX >= r.left - f.left &&
        cursorX <= r.right - f.left &&
        cursorY >= r.top - f.top &&
        cursorY <= r.bottom - f.top
      ) {
        tx = r.left + r.width / 2 - f.left
        ty = r.top + r.height / 2 - f.top
      }
    }
  }
  return { x1: drag.value.startX, y1: drag.value.startY, x2: tx, y2: ty, toEnemy }
})

// ===== 全局 mouseup 监听：即使鼠标在 BattleView 外松开也能捕获 =====
function handleWindowMouseUp(ev: MouseEvent): void {
  if (drag.value) onMouseUp(ev)
}
function handleWindowMouseMove(ev: MouseEvent): void {
  if (drag.value) onMouseMove(ev)
}
onMounted(() => {
  window.addEventListener('mousemove', handleWindowMouseMove)
  window.addEventListener('mouseup', handleWindowMouseUp)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', handleWindowMouseMove)
  window.removeEventListener('mouseup', handleWindowMouseUp)
})

// ===== 战斗页面所需的 battle ctx 用于 status bar =====
const playerHp = computed(() => ctx.value?.player.hp ?? 0)
const playerMaxHp = computed(() => ctx.value?.player.maxHp ?? 0)
const playerBlock = computed(() => ctx.value?.player.block ?? 0)
const playerStrength = computed(() => ctx.value?.player.strength ?? 0)
const turn = computed(() => ctx.value?.turn ?? 0)
const energy = computed(() => ctx.value?.energy ?? 0)
const maxEnergy = computed(() => ctx.value?.maxEnergy ?? 0)

// 遗物栏副本（SingleRunStatusBar 自己接 store.run；这里为了避免重复渲染只在 BattleView 不再渲染）
void getRelic

// ===== 战斗特效（伤害数字跳动，PRD §5.3） =====
// 取某单位最近的 fx（按 id 逆序，最多显示 5 条）
function fxOf(unitId: string): CombatFx[] {
  return ctx.value
    ? ctx.value.fx
        .filter((f) => f.unitId === unitId)
        .slice(-5)
        .reverse()
    : []
}
// 玩家卡 fx（飘字渲染在玩家卡上方）
const playerFx = computed(() => fxOf(ctx.value?.player.id ?? 'player'))
</script>

<template>
  <div v-if="ctx" class="battle" @click="selectedCardId = null">
    <!-- ① 共用状态栏（HP/金币/药水/层数/Boss + 回合/能量/卡组/菜单 + 遗物栏） -->
    <SingleRunStatusBar
      :player-hp="playerHp"
      :player-max-hp="playerMaxHp"
      :player-block="playerBlock"
      :player-strength="playerStrength"
      :turn="turn"
      :energy="energy"
      :max-energy="maxEnergy"
    />

    <!-- ② 战场：左玩家 | 右怪物 -->
    <div ref="fieldRef" class="field" @click.stop>
      <div class="player-side">
        <div ref="playerRef" class="player-card">
          <!-- 伤害数字跳动（玩家头上） -->
          <div class="fx-layer">
            <span v-for="f in playerFx" :key="f.id" class="fx-num" :class="'fx-' + f.kind">
              {{ f.text }}
            </span>
          </div>
          <div class="player-avatar">⚔️</div>
          <div class="player-name">铁甲战士</div>
          <div class="player-hp-bar">
            <span
              class="player-hp-fill"
              :style="{ width: (ctx.player.hp / ctx.player.maxHp) * 100 + '%' }"
            />
          </div>
          <div class="player-stats">
            <span>格挡 {{ ctx.player.block }}</span>
            <span>力量 {{ ctx.player.strength }}</span>
          </div>
        </div>
      </div>

      <div class="enemy-side">
        <EnemyView
          v-for="e in enemies"
          :key="e.id"
          :ref="(el) => setEnemyRef(e.id, el)"
          :unit="e"
          :targetable="(Boolean(selectedCardId) || Boolean(isDraggingAttack)) && !readonly"
          :hovered="hoveredEnemyId === e.id"
          :fx="fxOf(e.id)"
          @select="onEnemyClick(e.id)"
        />
      </div>

      <!-- 拖拽中的 SVG 虚线箭头叠加层 -->
      <svg
        v-if="arrow"
        class="drag-arrow"
        :viewBox="`0 0 ${fieldRef?.clientWidth ?? 1000} ${fieldRef?.clientHeight ?? 600}`"
        preserveAspectRatio="none"
      >
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              :fill="arrow.toEnemy ? 'var(--gold)' : 'var(--text-dim)'"
            />
          </marker>
        </defs>
        <line
          :x1="arrow.x1"
          :y1="arrow.y1"
          :x2="arrow.x2"
          :y2="arrow.y2"
          :stroke="arrow.toEnemy ? 'var(--gold)' : 'var(--text-dim)'"
          stroke-width="3"
          stroke-dasharray="6 5"
          stroke-linecap="round"
          marker-end="url(#arrowhead)"
        />
      </svg>
    </div>

    <!-- ③ 底栏：左 [能量 / 抽牌堆] / 中 [手牌] / 右 [结束回合 / 消耗堆 / 弃牌堆] -->
    <div class="bottom">
      <div class="side-col">
        <div
          class="side-pile energy-orb"
          :class="{ full: ctx.energy >= ctx.maxEnergy }"
          title="当前能量"
          @click.stop="openPile('draw')"
        >
          {{ ctx.energy }}<small>/{{ ctx.maxEnergy }}</small>
        </div>
        <button
          class="side-pile pile-btn draw-pile"
          title="点击查看抽牌堆"
          @click.stop="openPile('draw')"
        >
          <span class="pile-icon">🂠</span>
          <span class="pile-num">{{ ctx.drawPile.length }}</span>
          <span class="pile-label">抽牌</span>
        </button>
      </div>

      <div class="hand-area">
        <div class="hand">
          <div
            v-for="(h, i) in hand"
            :key="h.id + i"
            class="hand-slot"
            :data-card-id="h.id"
            :style="fanStyle(i, hand.length)"
          >
            <CardView
              :card="h.card"
              :playable="!readonly && canPlay(h.card)"
              :selected="selectedCardId === h.id && !draggingCard"
              @select="onCardClick(h.id)"
              @mousedown="(ev: MouseEvent) => onCardMouseDown(ev, h.id)"
            />
          </div>
        </div>
        <p v-if="selectedCardId && !draggingCard" class="target-hint">
          点击一个怪物作为目标（或再次点击卡牌取消）
        </p>
        <p v-if="isDraggingAttack" class="target-hint">拖拽到目标怪物上松手释放</p>
        <p v-else-if="draggingCard && !isDraggingAttack" class="target-hint">
          拖出手牌区（到自己/场上任意位置）松手释放
        </p>
      </div>

      <!-- 右侧：结束回合（最上方）+ 消耗堆 + 弃牌堆 -->
      <div class="side-col">
        <button
          v-if="!readonly"
          class="end-btn btn btn-primary"
          title="结束玩家回合"
          @click="endTurn"
        >
          结束回合
        </button>
        <button v-else class="end-btn btn" title="返回奖励页" @click="backToReward">
          返回奖励 →
        </button>
        <button
          class="side-pile pile-btn exhaust-pile"
          title="点击查看消耗牌堆"
          @click.stop="openPile('exhaust')"
        >
          <span class="pile-icon">🔥</span>
          <span class="pile-num">{{ ctx.exhaustPile.length }}</span>
          <span class="pile-label">消耗</span>
        </button>
        <button
          class="side-pile pile-btn discard-pile"
          title="点击查看弃牌堆"
          @click.stop="openPile('discard')"
        >
          <span class="pile-icon">🂠</span>
          <span class="pile-num">{{ ctx.discardPile.length }}</span>
          <span class="pile-label">弃牌</span>
        </button>
      </div>
    </div>

    <!-- 弹窗：单牌堆查看（全屏透明 + 左下角返回箭头，与卡组/地图风格一致） -->
    <div v-if="inspectingPile" class="modal" @click.stop>
      <div class="modal-panel panel">
        <h3 class="modal-title">
          {{ pileLabel[inspectingPile] }}
          <span class="dim"
            >（{{
              inspectingPile === 'draw'
                ? ctx.drawPile.length
                : inspectingPile === 'discard'
                  ? ctx.discardPile.length
                  : ctx.exhaustPile.length
            }}
            张）</span
          >
        </h3>
        <p class="modal-hint">
          <span v-if="inspectingPile === 'draw'">顶部在前（下一个抽到）</span>
          <span v-else-if="inspectingPile === 'discard'">弃牌堆顶在前（最近弃掉的牌）</span>
          <span v-else>消耗堆顶在前（最近消耗的牌）</span>
        </p>
        <div class="modal-cards">
          <CardView v-for="c in inspectingCards" :key="c.id" :card="c.card" />
        </div>
      </div>
      <button class="back-arrow" title="返回当前场景" @click="inspectingPile = null">←</button>
    </div>

    <!-- 调试控制台 -->
    <div v-if="settings.settings.showDebugConsole" class="console">
      <ConsolePanel />
    </div>
  </div>
</template>

<style scoped lang="scss">
.battle {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 10px 18px;
  gap: 8px;
  user-select: none;
  position: relative;
}

/* ② 战场 */
.field {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 20px;
  min-height: 0;
  position: relative;
}
.player-side {
  display: flex;
  align-items: center;
}
.player-card {
  width: 150px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: linear-gradient(180deg, var(--bg-raised), var(--bg-deep));
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative; // fx 数字跳动定位基准
  transition:
    border-color 0.1s,
    box-shadow 0.1s;
}
// 伤害数字跳动层（PRD §5.3：角色/怪物头上数字）
.fx-layer {
  position: absolute;
  top: -16px;
  left: 50%;
  pointer-events: none;
  z-index: 6;
}
.fx-num {
  position: absolute;
  transform: translateX(-50%);
  font-weight: bold;
  font-size: 20px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
  animation: fx-rise 0.9s ease-out forwards;
  white-space: nowrap;
}
// 多条数字依次错开（第 1 条最新在顶部）
.fx-num:nth-child(1) {
  animation-delay: 0.5s;
  opacity: 0;
}
.fx-num:nth-child(2) {
  animation-delay: 0.32s;
  opacity: 0;
}
.fx-num:nth-child(3) {
  animation-delay: 0.14s;
  opacity: 0;
}
.fx-num:nth-child(n + 4) {
  animation-delay: 0s;
  opacity: 0;
}
.fx-damage {
  color: var(--accent-strong);
}
.fx-block {
  color: #6aa8d6;
}
.fx-heal {
  color: #7ac97a;
}
.fx-buff {
  color: var(--gold);
}
@keyframes fx-rise {
  0% {
    transform: translateX(-50%) translateY(0);
    opacity: 0;
  }
  15% {
    opacity: 1;
  }
  100% {
    transform: translateX(-50%) translateY(-46px);
    opacity: 0;
  }
}
// 拖拽非攻击卡时玩家卡高亮（自身用卡可拖到自己身上）
.player-card.player-target {
  border-color: var(--gold);
  box-shadow: 0 0 12px rgba(201, 162, 39, 0.3);
}
.player-avatar {
  font-size: 44px;
}
.player-name {
  font-size: 14px;
  color: var(--text-main);
}
.player-hp-bar {
  height: 10px;
  border-radius: 5px;
  background: var(--bg-deep);
  border: 1px solid var(--border-strong);
  overflow: hidden;
}
.player-hp-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent-dim), var(--accent-strong));
}
.player-stats {
  display: flex;
  justify-content: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-dim);
}
.enemy-side {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  gap: 14px;
  flex-wrap: wrap;
}

/* 拖拽 SVG 箭头 */
.drag-arrow {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
}

/* ③ 底栏 */
.bottom {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 6px;
}
.side-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.side-pile {
  width: 76px;
  text-align: center;
  font-size: 13px;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 4px;
  background: rgba(0, 0, 0, 0.3);
  transition:
    transform 0.1s,
    border-color 0.1s;
}
.pile-btn {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  color: var(--text-main);
}
.pile-btn:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}
.pile-icon {
  font-size: 22px;
  line-height: 1;
}
.pile-num {
  font-size: 13px;
  color: var(--gold);
}
.pile-label {
  font-size: 11px;
  color: var(--text-faint);
}
.draw-pile .pile-icon {
  color: #6aa8d6;
}
.discard-pile .pile-icon {
  color: #b06a6a;
}
.exhaust-pile .pile-icon {
  color: #d9b066;
}
.energy-orb {
  color: var(--gold);
  font-size: 20px;
  border-color: var(--border-strong);
  cursor: pointer;
  font-weight: bold;
}
.energy-orb.full {
  border-color: var(--gold);
  box-shadow: 0 0 8px rgba(201, 162, 39, 0.3);
}
.energy-orb small {
  font-size: 12px;
  color: var(--text-dim);
  font-weight: normal;
}
.hand-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.hand {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 4px;
  min-height: 200px;
  flex-wrap: nowrap;
}
.hand-slot {
  transition: transform 0.12s;
}
.target-hint {
  color: var(--gold);
  font-size: 12px;
}

// 结束回合按钮（占据右侧列顶部）
.end-btn {
  height: 56px;
  font-size: 14px;
  font-weight: bold;
}

/* 弹窗：全屏覆盖 + 透明背景（透出当前战斗场景），左下角返回箭头关闭 */
.modal {
  position: fixed;
  inset: 0;
  // 透明遮罩：几乎不遮挡背景战斗场景
  background: rgba(8, 6, 5, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-panel {
  max-width: 720px;
  max-height: 80vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  // 半透明深色底：内容可读且场景透出
  background: rgba(20, 16, 14, 0.88);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 18px;
  backdrop-filter: blur(2px);
}
.modal-title {
  color: var(--accent-strong);
}
.modal-title .dim {
  color: var(--text-dim);
  font-size: 13px;
  font-weight: normal;
  margin-left: 6px;
}
.modal-hint {
  font-size: 12px;
  color: var(--text-faint);
}
.modal-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* 左下角返回箭头（关闭弹窗回到当前场景） */
.back-arrow {
  position: fixed;
  left: 24px;
  bottom: 24px;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border: 2px solid var(--gold);
  background: rgba(20, 16, 14, 0.85);
  color: var(--gold);
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s,
    transform 0.1s;
}
.back-arrow:hover {
  background: rgba(201, 162, 39, 0.25);
  transform: scale(1.06);
}
.back-arrow:active {
  transform: scale(0.94);
}

.console {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 340px;
  z-index: 30;
}
</style>
