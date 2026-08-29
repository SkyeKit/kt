<script setup lang="ts">
/**
 * 战斗视图（PRD §5.2 / document/ui.md 布局）
 * 自上而下：顶栏（HP/金币/药水/层数/Boss + 回合/卡组/菜单）→ 遗物栏 → 战场
 * → 底部（左侧 = 抽牌堆，上方为能量球 / 右侧 = 弃牌堆，上方为消耗牌堆 / 中央 = 手牌）
 * 交互（PRD §3.3.2）：点击卡牌选择 → 点击怪物指定目标；仅 1 个怪物时自动使用
 * 牌堆查看：点击抽牌堆 / 弃牌堆 / 消耗牌堆三者之一弹窗查看（PRD ui.md §"牌堆"操作）
 */
import { ref, computed } from 'vue'
import { useBattle } from '@/composables/useBattle'
import { useGameStore } from '@/stores/gameStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getCard, getRelic } from '@/data'

const { ctx, hand, enemies, canPlay } = useBattle()
const store = useGameStore()
const settings = useSettingsStore()

// 只读模式：战斗已结算（胜利后从奖励页返回查看战场，PRD §3.3.7）
const readonly = computed(() => store.battleResult?.status === 'victory')

// ===== 目标选择（PRD §3.3.2） =====
const selectedCardId = ref<string | null>(null) // 已选中待定目标的卡牌

// 点击手牌：可打出时 → 单怪自动使用 / 多怪进入目标选择
function onCardClick(cardId: string): void {
  if (readonly.value) return
  const card = getCard(cardId)
  if (!canPlay(card)) return
  if (enemies.value.length <= 1) {
    play(cardId)
    return
  }
  // 再次点击同一张卡 = 取消选择
  selectedCardId.value = selectedCardId.value === cardId ? null : cardId
}

// 点击怪物：指定目标打出
function onEnemyClick(unitId: string): void {
  if (!selectedCardId.value) return
  play(selectedCardId.value, unitId)
  selectedCardId.value = null
}

// 打出卡牌（对指定目标；未指定时取首个存活敌人）
function play(cardId: string, targetId?: string): void {
  if (readonly.value) return
  store.playCard(cardId, targetId)
}

// 结束回合；只读模式禁用
function endTurn(): void {
  if (readonly.value) return
  store.endTurn()
}

// 返回主菜单（放弃本局）
function abandon(): void {
  store.abandonRun()
}

// ===== 弹窗：卡组 / 菜单 / 单个牌堆 =====
// 点击抽牌堆 / 弃牌堆 / 消耗牌堆直接查看对应牌堆详情（PRD ui.md）
const showDeck = ref(false)
const showMenu = ref(false)
const inspectingPile = ref<'draw' | 'discard' | 'exhaust' | null>(null)

// 当前查看牌堆的卡牌列表（按堆顺序，方便定位）
const inspectingCards = computed(() => {
  if (!inspectingPile.value) return []
  const list =
    inspectingPile.value === 'draw'
      ? ctx.value!.drawPile.slice().reverse() // 抽牌堆顶部在前
      : inspectingPile.value === 'discard'
        ? ctx.value!.discardPile.slice().reverse() // 弃牌堆顶在前
        : ctx.value!.exhaustPile.slice().reverse() // 消耗堆顶在前
  return list.map((id) => ({ id, card: getCard(id) }))
})

// 点击对应牌堆：开/关弹窗（点击同一堆可关闭）
function openPile(pile: 'draw' | 'discard' | 'exhaust'): void {
  inspectingPile.value = inspectingPile.value === pile ? null : pile
}

// 卡牌扇形角度（手牌越多角度越大，§5.3 抽牌动画静态版）
function fanStyle(index: number, total: number): Record<string, string> {
  if (total <= 1) return {}
  const spread = Math.min(24, total * 4)
  const angle = (index - (total - 1) / 2) * (spread / total)
  return {
    transform: `rotate(${angle.toFixed(1)}deg) translateY(${(Math.abs(angle) * 0.6).toFixed(1)}px)`,
  }
}

// 遗物栏
const relicNames = computed(() => (store.run?.relics ?? []).map((id) => getRelic(id)?.name ?? id))

// 牌堆文案
const pileLabel: Record<'draw' | 'discard' | 'exhaust', string> = {
  draw: '抽牌堆',
  discard: '弃牌堆',
  exhaust: '消耗牌堆',
}
</script>

<template>
  <div v-if="ctx" class="battle" @click="selectedCardId = null">
    <!-- ① 顶部状态栏（ui.md：HP/金币/药水/层数/Boss + 回合/卡组/菜单） -->
    <header class="top-bar">
      <div class="top-left">
        <span class="avatar" title="铁甲战士">⚔️</span>
        <span class="hp">❤ {{ ctx.player.hp }}/{{ ctx.player.maxHp }}</span>
        <span class="gold">💰 {{ store.run?.gold ?? 0 }}</span>
        <span class="potion-slot" title="药水系统未上线">药水（—）</span>
        <span class="floor">第 {{ store.run?.floor ?? 1 }} 层</span>
        <span v-if="store.battleKind === 'boss'" class="boss-tag">BOSS</span>
      </div>
      <div class="top-right">
        <span class="turn">回合 {{ ctx.turn }}</span>
        <button class="btn top-btn" title="查看当前牌组" @click.stop="showDeck = !showDeck">
          卡组
        </button>
        <button class="btn top-btn" title="暂停菜单" @click.stop="showMenu = true">菜单</button>
      </div>
    </header>

    <!-- ② 遗物栏（ui.md：遗物从左往右添加） -->
    <div class="relic-bar">
      <span class="relic-label">遗物</span>
      <span v-for="(name, i) in relicNames" :key="i" class="relic-chip">{{ name }}</span>
    </div>

    <!-- ③ 战场：左玩家 | 右怪物（ui.md：意图 意图 意图 / 怪物1-2-3） -->
    <div class="field" @click.stop>
      <div class="player-side">
        <div class="player-card">
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
          :unit="e"
          :targetable="Boolean(selectedCardId) && !readonly"
          @select="onEnemyClick(e.id)"
        />
      </div>
    </div>

    <!-- ④ 底部操作区（左侧：抽牌堆 + 上方能量球 / 中央：手牌 / 右侧：弃牌堆 + 上方消耗堆） -->
    <div class="bottom">
      <!-- 左侧：能量球（上方） + 抽牌堆（可点击查看） -->
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

      <!-- 中央：手牌 -->
      <div class="hand-area">
        <div class="hand">
          <div
            v-for="(h, i) in hand"
            :key="h.id + i"
            class="hand-slot"
            :style="fanStyle(i, hand.length)"
          >
            <CardView
              :card="h.card"
              :playable="!readonly && canPlay(h.card)"
              :selected="selectedCardId === h.id"
              @select="onCardClick(h.id)"
            />
          </div>
        </div>
        <!-- 目标选择提示（PRD §3.3.2） -->
        <p v-if="selectedCardId" class="target-hint">点击一个怪物作为目标（或再次点击卡牌取消）</p>
        <button class="btn btn-primary end-btn" :disabled="readonly" @click="endTurn">
          结束回合
        </button>
      </div>

      <!-- 右侧：消耗牌堆（上方） + 弃牌堆（可点击查看） -->
      <div class="side-col">
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

    <!-- ⑤ 弹窗：卡组查看 -->
    <div v-if="showDeck" class="modal" @click.stop>
      <div class="modal-panel panel">
        <h3 class="modal-title">卡组（{{ store.run?.deck.length ?? 0 }}）</h3>
        <div class="modal-cards">
          <CardView v-for="(id, i) in store.run?.deck ?? []" :key="i" :card="getCard(id)" />
        </div>
        <button class="btn" @click="showDeck = false">关闭</button>
      </div>
    </div>

    <!-- ⑥ 弹窗：单牌堆查看（点击抽/弃/消耗牌堆触发） -->
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
        <button class="btn" @click="inspectingPile = null">关闭</button>
      </div>
    </div>

    <!-- ⑦ 弹窗：暂停菜单（PRD §3.11） -->
    <div v-if="showMenu" class="modal" @click.stop>
      <div class="modal-panel panel">
        <h3 class="modal-title">菜单</h3>
        <div class="menu-btns">
          <button class="btn btn-primary" @click="showMenu = false">继续游戏</button>
          <button class="btn" @click="abandon">放弃本局（回主菜单）</button>
        </div>
      </div>
    </div>

    <!-- 调试控制台（PRD §3.10） -->
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
}

/* ① 顶部状态栏 */
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding-bottom: 6px;
  font-size: 14px;
}
.top-left {
  display: flex;
  align-items: center;
  gap: 14px;
}
.avatar {
  font-size: 20px;
}
.hp {
  color: var(--accent-strong);
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
.top-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.turn {
  color: var(--text-dim);
  font-size: 13px;
}
.top-btn {
  font-size: 13px;
  padding: 4px 10px;
}

/* ② 遗物栏 */
.relic-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
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

/* ③ 战场 */
.field {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 20px;
  min-height: 0;
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

/* ④ 底部操作区：左 [能量 / 抽牌堆] / 中央手牌 / 右 [消耗堆 / 弃牌堆] */
.bottom {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 6px;
}

// 牌堆列：上下一对（左 = 能量球 + 抽牌堆 / 右 = 消耗堆 + 弃牌堆）
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
.end-btn {
  margin-top: 2px;
}

/* ⑤ 弹窗 */
.modal {
  position: fixed;
  inset: 0;
  background: rgba(10, 8, 7, 0.8);
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
.menu-btns {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.console {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 340px;
  z-index: 30;
}
</style>
