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
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useBattle } from '@/composables/useBattle'
import { useGameStore } from '@/stores/gameStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getCard, getRelic } from '@/data'
import SingleRunStatusBar from '@/components/common/SingleRunStatusBar.vue'
import type { CombatFx, CombatUnit } from '@/engine/combatEngine'

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

// 真正出牌入口：先播打出动画（页面正中心翻转消失），再交给引擎结算（PRD §5.3 卡牌打出）
function play(cardId: string, targetId?: string): void {
  if (readonly.value) return
  spawnPlayGhost(cardId)
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
  return list.map((en) => ({ id: en.id, card: getCard(en.id), upgrade: en.upgrade }))
})
function openPile(pile: 'draw' | 'discard' | 'exhaust'): void {
  inspectingPile.value = inspectingPile.value === pile ? null : pile
}

const pileLabel: Record<'draw' | 'discard' | 'exhaust', string> = {
  draw: '抽牌堆',
  discard: '弃牌堆',
  exhaust: '消耗牌堆',
}

// 各牌堆当前张数（供全屏查看标题显示，格式与"卡组（N）"一致）
const pileCount = computed<number>(() => {
  const p = inspectingPile.value
  if (p === 'draw') return ctx.value?.drawPile.length ?? 0
  if (p === 'discard') return ctx.value?.discardPile.length ?? 0
  return ctx.value?.exhaustPile.length ?? 0
})

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

// ===== 战斗动画（PRD §5.3）=====

// ① 抽牌动画：回合开始卡牌逐张进入（间隔 90ms，单张 500ms）
const dealing = ref(false)
let dealTimer: number | undefined
function triggerDeal(): void {
  dealing.value = true
  window.clearTimeout(dealTimer)
  // 最后一张的延迟 = 手牌数×90ms，再加单张动画时长 500ms 后清除类名
  dealTimer = window.setTimeout(
    () => {
      dealing.value = false
    },
    hand.value.length * 90 + 600,
  )
}
// 回合变化（含开局）→ 重新触发逐张入场
watch(() => ctx.value?.turn ?? 0, triggerDeal, { immediate: true })

// ② 卡牌打出动画：卡牌在页面正中心出现，随后翻转消失（PRD §5.3 卡牌打出）
interface PlayGhost {
  key: number
  cardId: string
}
const playGhost = ref<PlayGhost | null>(null)
// 生成打出幻影：只记录卡牌 id 与唯一 key，播放居中翻转动画后移除
function spawnPlayGhost(cardId: string): void {
  playGhost.value = { key: Date.now(), cardId }
  // 动画时长约 500ms，结束后移除幻影
  window.setTimeout(() => {
    if (playGhost.value?.cardId === cardId) playGhost.value = null
  }, 520)
}

// ③ 敌人攻击突进动画（600ms）：玩家受击时让"攻击意图"的敌人前冲
const lungeEnemyId = ref<string | null>(null)
const lungeTick = ref(0) // 同一敌人连续攻击时强制重触发动画（配合 :key）
let lungeTimer: number | undefined
// ④ 玩家格挡获得 / Buff 施加闪光（450ms / 500ms）
const playerFlash = ref<'block' | 'buff' | null>(null)
let flashTimer: number | undefined
// 监听战斗特效队列：新特效出现时驱动对应动画
watch(
  () => ctx.value?.fx.length ?? 0,
  (len, old) => {
    if (!ctx.value || len <= (old ?? 0)) return
    const newFx = ctx.value.fx.slice(old ?? 0)
    // 玩家受击 → 敌人突进
    if (newFx.some((f) => f.unitId === ctx.value!.player.id && f.kind === 'damage')) {
      const attacker = enemies.value.find((e) => e.intentType === 'attack')
      if (attacker) {
        lungeEnemyId.value = attacker.id
        lungeTick.value++
        window.clearTimeout(lungeTimer)
        lungeTimer = window.setTimeout(() => {
          lungeEnemyId.value = null
        }, 650)
      }
    }
    // 玩家获得格挡 / 增益 → 玩家卡闪光
    const pKind = newFx.find((f) => f.unitId === ctx.value!.player.id)?.kind
    if (pKind === 'block' || pKind === 'buff') {
      playerFlash.value = pKind
      window.clearTimeout(flashTimer)
      flashTimer = window.setTimeout(() => {
        playerFlash.value = null
      }, 500)
    }
  },
)

// ⑤ 敌人死亡动画（600ms）：保留死去的敌人快照，播放消散后移除
const dyingEnemies = ref<CombatUnit[]>([])
let lastAliveMap = new Map<string, boolean>()
watch(
  () => ctx.value?.enemies.map((e) => `${e.id}:${e.alive}`).join('|') ?? '',
  (_sig) => {
    if (!ctx.value) return
    const now = new Map(ctx.value.enemies.map((e) => [e.id, e.alive]))
    // 找出由存活 → 死亡的敌人，加入消散队列
    for (const e of ctx.value.enemies) {
      if (!e.alive && lastAliveMap.get(e.id) === true) {
        dyingEnemies.value.push({ ...e })
        window.setTimeout(() => {
          dyingEnemies.value = dyingEnemies.value.filter((d) => d.id !== e.id)
        }, 950)
      }
    }
    lastAliveMap = now
  },
  { immediate: true },
)
// 已激活能力牌的被动（ctx.powers 登记，combatEngine.playCard 打出 power 时写入）：
// 以"能力徽章"展示在角色下方，让玩家直观看到本场生效的能力被动（能力牌只会用到一次已进消耗堆）
const activePowers = computed(() =>
  [...(ctx.value?.powers.entries() ?? [])].map(([id, up]) => ({
    id,
    name: getCard(id)?.name ?? id,
    upgraded: up,
  })),
)

// 战场渲染单位：存活敌人 + 正在消散的敌人（保持原相对顺序，保证消散位置正确）
const renderUnits = computed<CombatUnit[]>(() => {
  const dying = dyingEnemies.value
  if (dying.length === 0) return enemies.value
  const raw = ctx.value?.enemies ?? []
  const result: CombatUnit[] = []
  for (const e of raw) {
    if (e.alive) result.push(e)
    else {
      const ghost = dying.find((d) => d.id === e.id)
      if (ghost) result.push(ghost)
    }
  }
  return result
})

// ⑥ 洗牌回抽动画（PRD §5.3 洗牌回抽）：弃牌堆卡牌带流光逐张飞回抽牌堆
const shuffling = ref(false)
let shuffleTimer: number | undefined
let lastDrawPileLen: number | null = null
watch(
  () => (ctx.value ? ctx.value.drawPile.length : -1),
  (len) => {
    // ctx 尚未初始化（-1）时忽略；首次有效值仅记录初始长度，避免开局误触发
    if (len < 0) return
    if (lastDrawPileLen === null) {
      lastDrawPileLen = len
      return
    }
    // 抽牌堆长度增大 = 弃牌堆被洗回抽牌堆 → 触发流光回抽动画
    if (len > lastDrawPileLen) {
      shuffling.value = true
      window.clearTimeout(shuffleTimer)
      // 7 条流光错峰 55ms，末条约 385ms 后开始 + 550ms 动画，共约 950ms
      shuffleTimer = window.setTimeout(() => {
        shuffling.value = false
      }, 950)
    }
    lastDrawPileLen = len
  },
  { immediate: true },
)
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
        <div
          ref="playerRef"
          class="player-card"
          :class="{ 'flash-block': playerFlash === 'block', 'flash-buff': playerFlash === 'buff' }"
        >
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
            <UnitStatusChips :unit="ctx.player" />
            <!-- 能力徽章：展示本场已激活的能力牌被动（金色徽章），让玩家确认能力已生效 -->
            <div v-if="activePowers.length" class="power-chips">
              <span
                v-for="p in activePowers"
                :key="p.id"
                class="power-chip"
                :class="{ up: p.upgraded }"
              >
                {{ p.upgraded ? p.name + '+' : p.name }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="enemy-side">
        <EnemyView
          v-for="e in renderUnits"
          :key="e.id + (lungeEnemyId === e.id ? '-' + lungeTick : '')"
          :ref="(el) => (e.alive ? setEnemyRef(e.id, el) : undefined)"
          :unit="e"
          :targetable="(Boolean(selectedCardId) || Boolean(isDraggingAttack)) && !readonly"
          :hovered="hoveredEnemyId === e.id"
          :fx="e.alive ? fxOf(e.id) : []"
          :lunge="lungeEnemyId === e.id"
          :dying="!e.alive"
          @select="onEnemyClick(e.id)"
        />
      </div>

      <!-- 卡牌打出动画：卡牌在页面正中心出现，随后翻转消失（PRD §5.3 卡牌打出） -->
      <div v-if="playGhost" :key="playGhost.key" class="play-ghost">
        <CardView :card="getCard(playGhost.cardId)" />
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
      <!-- 洗牌回抽流光动画：弃牌堆卡牌带流光逐张飞回抽牌堆（PRD §5.3） -->
      <div v-if="shuffling" class="shuffle-anim" aria-hidden="true">
        <span v-for="n in 7" :key="n" class="shuffle-card" :style="{ '--n': n }"></span>
      </div>
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
            :class="{ deal: dealing }"
            :data-card-id="h.id"
            :style="fanStyle(i, hand.length)"
          >
            <CardView
              :card="h.card"
              :upgraded="h.upgrade"
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

      <!-- 右侧：结束回合 -->
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

    <!-- 全屏页：单牌堆查看（覆盖整个屏幕，两边透明可看战斗场景，中央 panel） -->
    <div v-if="inspectingPile" class="full-page">
      <div class="page-panel">
        <h3 class="page-title">
          {{ pileLabel[inspectingPile] }}
          <span class="dim">（{{ pileCount }}）</span>
        </h3>
        <div class="page-cards-grid">
          <CardView v-for="c in inspectingCards" :key="c.id" :card="c.card" :upgraded="c.upgrade" />
        </div>
      </div>
      <button class="back-arrow" title="返回当前场景" @click="inspectingPile = null">← 返回</button>
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
  padding: 10px 20px; // 左右各 20px：角色距左边框 20px、怪物距右边框 20px
  padding-top: 80px; // 让出 SingleRunStatusBar 顶栏空间（顶栏 fixed）
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
  // 左右边距由 .battle 的 20px padding 统一控制，这里不再叠加
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
  animation: fx-rise 1.1s ease-out forwards;
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
// 格挡获得闪光（PRD §5.3：防御结算，450ms）
.player-card.flash-block {
  animation: flash-block 0.45s ease-out;
}
// Buff/Debuff 施加闪光（PRD §5.3：状态变更，500ms）
.player-card.flash-buff {
  animation: flash-buff 0.5s ease-out;
}
@keyframes flash-block {
  0% {
    box-shadow: 0 0 0 rgba(106, 168, 214, 0);
    border-color: var(--border);
  }
  40% {
    box-shadow: 0 0 18px rgba(106, 168, 214, 0.85);
    border-color: #6aa8d6;
  }
  100% {
    box-shadow: 0 0 0 rgba(106, 168, 214, 0);
    border-color: var(--border);
  }
}
@keyframes flash-buff {
  0% {
    box-shadow: 0 0 0 rgba(201, 162, 39, 0);
    border-color: var(--border);
  }
  40% {
    box-shadow: 0 0 18px rgba(201, 162, 39, 0.85);
    border-color: var(--gold);
  }
  100% {
    box-shadow: 0 0 0 rgba(201, 162, 39, 0);
    border-color: var(--border);
  }
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
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}
// 能力徽章：金色胶囊内显示已激活能力牌名称，升级版后缀 "+"
.power-chips {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 5px;
}
.power-chip {
  padding: 1px 8px;
  border-radius: 10px;
  background: rgba(201, 162, 39, 0.16);
  border: 1px solid rgba(201, 162, 39, 0.55);
  color: var(--gold);
  font-weight: bold;
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
}
.power-chip.up {
  color: #7ed389;
  border-color: rgba(88, 196, 106, 0.6);
  background: rgba(88, 196, 106, 0.12);
}
.enemy-side {
  flex: 1;
  display: flex;
  justify-content: flex-end; // 怪物组右对齐，距右边框 20px（由 .battle padding 控制）
  align-items: center; // 与左侧玩家垂直对齐（平行）
  gap: 28px; // 怪物之间保持明显间距（避免贴太近）
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

/* 卡牌打出动画：卡牌在页面正中心出现，随后翻转消失（PRD §5.3 卡牌打出，500ms） */
.play-ghost {
  position: fixed;
  left: 50%;
  top: 50%;
  width: 132px;
  height: 190px;
  z-index: 40;
  pointer-events: none;
  animation: card-play 0.5s ease-in-out forwards;
}
.play-ghost :deep(.card) {
  width: 132px !important;
  height: 190px !important;
}
@keyframes card-play {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.4);
  }
  35% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.05);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.15) rotateY(100deg);
  }
}

/* ③ 底栏 */
.bottom {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 6px;
  position: relative; // 洗牌流光动画定位基准
}
// 洗牌回抽流光动画（PRD §5.3 洗牌回抽 500ms）：流光从弃牌堆（右侧）飞回抽牌堆（左侧）
.shuffle-anim {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 8;
  overflow: hidden;
}
.shuffle-card {
  position: absolute;
  top: 55%;
  left: 0;
  width: 10px;
  height: 24px;
  border-radius: 2px;
  background: linear-gradient(180deg, rgba(201, 162, 39, 0.15), rgba(201, 162, 39, 0.85));
  box-shadow: 0 0 10px rgba(201, 162, 39, 0.7);
  opacity: 0;
  animation: shuffle-fly 0.55s ease-in forwards;
  animation-delay: calc(var(--n) * 55ms);
}
@keyframes shuffle-fly {
  0% {
    left: 84%;
    opacity: 0;
    transform: translateY(0) rotate(-8deg);
  }
  12% {
    opacity: 1;
  }
  100% {
    left: 12%;
    opacity: 0;
    transform: translateY(-6px) rotate(8deg);
  }
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
// 抽牌动画：回合开始卡牌从左侧逐张滑入手牌区（PRD §5.3 逐张出现并呈扇形分布）
// 通过 nth-child 递增动画延迟实现逐张出现；类名由 dealing 状态控制
.hand-slot.deal .card {
  animation: card-draw 0.65s ease-out both;
}
.hand-slot.deal:nth-child(1) .card {
  animation-delay: 0ms;
}
.hand-slot.deal:nth-child(2) .card {
  animation-delay: 90ms;
}
.hand-slot.deal:nth-child(3) .card {
  animation-delay: 180ms;
}
.hand-slot.deal:nth-child(4) .card {
  animation-delay: 270ms;
}
.hand-slot.deal:nth-child(5) .card {
  animation-delay: 360ms;
}
.hand-slot.deal:nth-child(6) .card {
  animation-delay: 450ms;
}
.hand-slot.deal:nth-child(7) .card {
  animation-delay: 540ms;
}
.hand-slot.deal:nth-child(8) .card {
  animation-delay: 630ms;
}
.hand-slot.deal:nth-child(9) .card {
  animation-delay: 720ms;
}
.hand-slot.deal:nth-child(n + 10) .card {
  animation-delay: 810ms;
}
@keyframes card-draw {
  from {
    opacity: 0;
    transform: translate(-110px, 24px) scale(0.85); // 从左侧（抽牌堆方向）滑入
  }
  to {
    opacity: 1;
    transform: translate(0, 0) scale(1);
  }
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

/* 全屏覆盖页：覆盖整个屏幕、两边透明可看当前场景、中央 panel 不透明。
   布局与顶部"卡组"全屏页完全一致：inset:0 撑满 + 水平居中 + 垂直撑满(stretch)，
   panel 自身 height:100%，内部网格滚动——避免超高卡牌时 justify-content:center 造成裁切/偏左 */
.full-page {
  position: fixed;
  inset: 0;
  pointer-events: auto;
  display: flex;
  justify-content: center; // 水平居中 panel
  align-items: stretch; // 垂直方向撑满剩余屏幕高度
  padding-top: 69px; // 顶部让出固定状态栏（与卡组全屏页一致），面板不越过该行
  z-index: 20;
  overflow: auto; // 面板超高时允许滚动
  background: transparent; // 显式透明，左右透出当前场景
}
.page-panel {
  pointer-events: auto;
  background: rgba(14, 11, 9, 0.96);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 20px 24px 24px;
  width: 920px;
  max-width: calc(100vw - 24px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%; // 与顶部"卡组"面板一致：上下填满全屏高度
  backdrop-filter: blur(2px);
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
.page-title .dim {
  color: var(--text-dim);
  font-size: 16px;
  font-weight: normal;
  margin-left: 8px;
}
// 牌堆查看网格：与卡组界面(.page-deck-grid)完全一致的 6 列 × 132px 布局 / 撑满剩余高度 / 内部滚动
.page-cards-grid {
  display: grid;
  grid-template-columns: repeat(6, 132px);
  gap: 8px;
  justify-content: center;
  width: 100%;
  margin: 0 auto;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
// CardView 在 grid item 中自适应列宽（深选择器穿透 scoped）
.page-cards-grid :deep(.card) {
  width: 100% !important;
  height: auto !important;
  aspect-ratio: 132 / 190;
}

/* 返回按钮：左下角固定（PRD：箭头调整到左下角） */
.back-arrow {
  position: fixed !important;
  bottom: 24px !important;
  left: 24px !important;
  top: auto !important;
  right: auto !important;
  transform: none !important;
  width: 90px;
  height: 32px;
  border-radius: 4px;
  border: 2px solid #fff;
  background: var(--accent-strong);
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

.console {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 340px;
  z-index: 30;
}
</style>
