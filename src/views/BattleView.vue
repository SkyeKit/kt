<script setup lang="ts">
/**
 * 战斗视图（PRD §5.2 / document/ui.md 布局）
 * 自上而下：顶部状态栏（HP/金币/药水占位/层数/Boss + 回合/地图/卡组/菜单）
 * → 遗物栏 → 战场（左玩家 | 右怪物：意图+血槽）→ 底部操作区（能量球/抽牌堆/手牌/弃牌堆/消耗堆）
 * 交互（PRD §3.3.2）：点击卡牌选择 → 点击怪物指定目标；仅 1 个怪物时自动使用
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

// ===== 弹窗：卡组 / 菜单 / 牌堆 =====
const showDeck = ref(false)
const showMenu = ref(false)
const showPiles = ref(false)

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
</script>

<template>
  <div v-if="ctx" class="battle" @click="selectedCardId = null">
    <!-- ① 顶部状态栏（ui.md：头像|❤血量|💰金币|药水|层数|Boss | 回合|地图|卡组|菜单） -->
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
        <button class="btn top-btn" title="查看抽/弃/消耗牌堆" @click.stop="showPiles = !showPiles">
          牌堆
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

    <!-- 战斗日志 -->
    <div class="battle-log">
      <p v-for="(line, i) in store.log.slice(-8)" :key="i" class="log-line">{{ line }}</p>
    </div>

    <!-- ④ 底部操作区（ui.md：能量 | 抽牌堆 | 手牌 | 弃牌堆 | 结束回合） -->
    <div class="bottom">
      <div class="side-pile energy-orb" :class="{ full: ctx.energy >= ctx.maxEnergy }">
        {{ ctx.energy }}<small>/{{ ctx.maxEnergy }}</small>
      </div>
      <div class="side-pile" title="抽牌堆">🂠 {{ ctx.drawPile.length }}</div>

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

      <div class="side-pile" title="弃牌堆">🂠 {{ ctx.discardPile.length }}</div>
      <div class="side-pile" title="消耗牌堆">🔥 {{ ctx.exhaustPile.length }}</div>
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

    <!-- ⑥ 弹窗：牌堆查看 -->
    <div v-if="showPiles" class="modal" @click.stop>
      <div class="modal-panel panel">
        <h3 class="modal-title">牌堆</h3>
        <p>抽牌堆（{{ ctx.drawPile.length }}）：{{ ctx.drawPile.join('、') }}</p>
        <p>弃牌堆（{{ ctx.discardPile.length }}）：{{ ctx.discardPile.join('、') }}</p>
        <p>消耗堆（{{ ctx.exhaustPile.length }}）：{{ ctx.exhaustPile.join('、') }}</p>
        <button class="btn" @click="showPiles = false">关闭</button>
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

/* 战斗日志 */
.battle-log {
  min-height: 44px;
  max-height: 90px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.25);
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.5;
}

/* ④ 底部操作区 */
.bottom {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 6px;
}
.side-pile {
  width: 72px;
  text-align: center;
  font-size: 13px;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 4px;
  background: rgba(0, 0, 0, 0.3);
}
.energy-orb {
  color: var(--gold);
  font-size: 18px;
  border-color: var(--border-strong);
}
.energy-orb.full {
  border-color: var(--gold);
  box-shadow: 0 0 8px rgba(201, 162, 39, 0.3);
}
.energy-orb small {
  font-size: 11px;
  color: var(--text-dim);
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
