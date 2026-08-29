<script setup lang="ts">
/**
 * 战斗视图（PRD §3.3）：敌人（意图）→ 战斗日志 → 玩家状态 → 手牌
 * 点击卡牌打出（对首个存活敌人）；「结束回合」进入敌人回合
 * 从奖励页返回时处于只读模式（已结算，仅查看战场，PRD §3.3.7）
 */
import { computed } from 'vue'
import { useBattle } from '@/composables/useBattle'
import { useGameStore } from '@/stores/gameStore'
import { useSettingsStore } from '@/stores/settingsStore'

const { ctx, hand, enemies, canPlay } = useBattle()
const store = useGameStore()
const settings = useSettingsStore()

// 只读模式：战斗已结算（胜利后从奖励页返回查看战场）
const readonly = computed(() => store.battleResult?.status === 'victory')

// 打出卡牌（对首个存活敌人）；只读模式禁用
function play(cardId: string): void {
  if (readonly.value) return
  store.playCard(cardId)
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

// 只读模式返回奖励页（BATTLE → REWARD，PRD §3.3.7）
function backToReward(): void {
  store.backToReward()
}
</script>

<template>
  <div v-if="ctx" class="battle">
    <!-- 敌人区 -->
    <div class="enemies">
      <EnemyView v-for="e in enemies" :key="e.id" :unit="e" />
    </div>

    <!-- 战斗日志 -->
    <div class="battle-log">
      <p v-for="(line, i) in store.log.slice(-14)" :key="i" class="log-line">{{ line }}</p>
    </div>

    <!-- 玩家状态 -->
    <div class="player-bar">
      <span class="pl">生命 {{ ctx.player.hp }}/{{ ctx.player.maxHp }}</span>
      <span class="pl">格挡 {{ ctx.player.block }}</span>
      <span class="pl">力量 {{ ctx.player.strength }}</span>
      <span class="pl energy">能量 {{ ctx.energy }}/{{ ctx.maxEnergy }}</span>
      <span class="pl">回合 {{ ctx.turn }}</span>
    </div>

    <!-- 手牌 -->
    <div class="hand">
      <CardView
        v-for="h in hand"
        :key="h.id"
        :card="h.card"
        :playable="!readonly && canPlay(h.card)"
        @select="!readonly && canPlay(h.card) && play(h.id)"
      />
    </div>

    <div class="actions">
      <!-- 只读模式（战斗已胜利，从奖励页返回）：仅可返回奖励页 -->
      <template v-if="readonly">
        <span class="readonly-tip">战斗已结束（查看战场）</span>
        <button class="btn btn-primary" @click="backToReward">返回奖励 →</button>
      </template>
      <template v-else>
        <button class="btn btn-primary" @click="endTurn">结束回合</button>
        <button class="btn" @click="abandon">放弃本局</button>
      </template>
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
  padding: 14px 20px;
  gap: 10px;
}
.enemies {
  display: flex;
  justify-content: center;
  gap: 14px;
  padding: 10px 0;
}
.battle-log {
  flex: 1;
  min-height: 60px;
  max-height: 180px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.25);
  font-size: 12px;
  color: var(--text-dim);
}
.log-line {
  line-height: 1.5;
}
.player-bar {
  display: flex;
  gap: 16px;
  padding: 6px 0;
  font-size: 14px;
}
.pl.energy {
  color: var(--gold);
  font-weight: bold;
}
.hand {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
  padding: 10px 0;
}
.actions {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
}
.readonly-tip {
  color: var(--text-faint);
  font-size: 13px;
}
.console {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 340px;
}
</style>
