<script setup lang="ts">
/**
 * 奖励浮层（PRD §3.3.5）：战斗奖励卡牌 3 选 1 / 先古遗物 3 选 1 / 金币
 */
import { computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'

const store = useGameStore()
const reward = computed(() => store.pendingReward)

// 标题：遗物 = 先古之民选择，卡牌 = 战斗奖励
const title = computed(() =>
  reward.value?.kind === 'relic' ? '先古之民：选择遗物' : '战斗奖励：选择一张卡牌',
)

function chooseCard(cardId: string): void {
  store.claimCardReward(cardId)
}
function skipCard(): void {
  store.claimCardReward(null)
}
function chooseRelic(relicId: string): void {
  store.claimRelicReward(relicId)
}
</script>

<template>
  <div class="reward panel">
    <h2 class="h-title">{{ title }}</h2>
    <p v-if="reward?.gold" class="reward-gold">金币 +{{ reward.gold }}</p>

    <!-- 卡牌 3 选 1 -->
    <div v-if="reward?.kind === 'card'" class="reward-cards">
      <CardView
        v-for="card in reward.cards"
        :key="card.id"
        :card="card"
        :playable="true"
        @select="chooseCard(card.id)"
      />
      <button class="btn skip-btn" @click="skipCard">跳过（不加牌）</button>
    </div>

    <!-- 遗物 3 选 1（先古之民） -->
    <div v-if="reward?.kind === 'relic'" class="reward-relics">
      <button
        v-for="relic in reward.relics"
        :key="relic.id"
        class="relic-option"
        @click="chooseRelic(relic.id)"
      >
        <span class="relic-name">{{ relic.name }}</span>
        <span class="relic-desc">{{ relic.desc }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.reward {
  min-width: 560px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 28px;
}
.reward-gold {
  color: var(--gold);
}
.reward-cards {
  display: flex;
  gap: 14px;
  align-items: flex-end;
}
.skip-btn {
  font-size: 13px;
}
.reward-relics {
  display: flex;
  gap: 14px;
}
.relic-option {
  width: 170px;
  padding: 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: linear-gradient(180deg, var(--bg-raised), var(--bg-base));
  color: var(--text-main);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: inherit;
}
.relic-option:hover {
  border-color: var(--gold);
}
.relic-name {
  font-size: 15px;
  color: var(--gold);
}
.relic-desc {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.5;
}
</style>
