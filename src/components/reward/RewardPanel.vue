<script setup lang="ts">
/**
 * 奖励浮层（PRD §3.3.7）：金币 → 药水占位 → 遗物（精英战）→ 卡牌 3 选 1
 * 导航：返回箭头（←）回战斗界面（已结算只读查看），前进箭头（→）去地图（未选卡默认跳过）
 * 兼容：先古之民（涅奥）遗物 3 选 1（kind = 'relic'）
 */
import { computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'

const store = useGameStore()
const reward = computed(() => store.pendingReward)

// 标题：遗物 = 先古之民选择，卡牌 = 战斗奖励
const title = computed(() => (reward.value?.kind === 'relic' ? '先古之民：选择遗物' : '战斗奖励'))

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

    <!-- ① 金币 -->
    <p v-if="reward?.gold !== undefined" class="reward-row gold-row">金币 +{{ reward.gold }}</p>

    <!-- ② 药水（预留占位，MVP 隐藏） -->
    <p v-if="reward?.kind === 'card'" class="reward-row potion-row">药水（预留位置）</p>

    <!-- ③ 遗物（精英战必掉 1 件，展示区） -->
    <div
      v-if="
        reward?.kind === 'card' && reward.relics && reward.relics.length > 0 && reward.relics[0]
      "
      class="reward-row relic-row"
    >
      <span class="relic-got"
        >获得遗物：{{ reward.relics[0].name }} — {{ reward.relics[0].desc }}</span
      >
    </div>

    <!-- ④ 卡牌 3 选 1（战斗奖励） -->
    <div v-if="reward?.kind === 'card'" class="reward-cards">
      <CardView
        v-for="card in reward.cards"
        :key="card.id"
        :card="card"
        :playable="true"
        @select="chooseCard(card.id)"
      />
    </div>

    <!-- 先古之民：遗物 3 选 1 -->
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

    <!-- 导航：返回战斗（←）/ 前进地图（→）；卡牌未选默认跳过（PRD §3.3.7） -->
    <div v-if="reward?.kind === 'card'" class="reward-nav">
      <button class="btn nav-btn" title="返回战斗界面（只读）" @click="store.backToBattle()">
        ←
      </button>
      <button class="btn nav-btn" title="跳过卡牌并前往地图" @click="skipCard">跳过</button>
      <button class="btn btn-primary nav-btn" title="前往地图" @click="store.forwardToMap()">
        →
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.reward {
  min-width: 580px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px;
}
.reward-row {
  font-size: 14px;
}
.gold-row {
  color: var(--gold);
}
.potion-row {
  color: var(--text-faint);
  font-size: 12px;
}
.relic-row {
  color: var(--purple);
  font-size: 13px;
}
.reward-cards {
  display: flex;
  gap: 14px;
  align-items: flex-end;
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
.reward-nav {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}
.nav-btn {
  min-width: 44px;
}
</style>
