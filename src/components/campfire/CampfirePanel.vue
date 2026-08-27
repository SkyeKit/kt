<script setup lang="ts">
/**
 * 篝火浮层（PRD §3.6）：休息（回复 30% 最大生命）/ 锻造（升级 1 张牌）
 */
import { ref } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import { getCard } from '@/data'

const store = useGameStore()
const showDeck = ref(false)

// 可升级卡（未升级的牌组卡）
const upgradeable = (store.run?.deck ?? []).filter((id) => {
  const c = getCard(id)
  return c && !c.upgrade
})

function rest(): void {
  store.campfireRest()
}
function smith(cardId: string): void {
  store.campfireSmith(cardId)
}
</script>

<template>
  <div class="campfire panel">
    <h2 class="h-title">篝火</h2>
    <p class="cf-hint">温暖的火焰照亮了旅途。你可以在篝火旁休息或锻造。</p>
    <div class="cf-btns">
      <button class="btn btn-primary" @click="rest">休息（回复 30% 最大生命）</button>
      <button class="btn" @click="showDeck = !showDeck">锻造（升级 1 张牌）</button>
    </div>
    <div v-if="showDeck" class="cf-deck">
      <button
        v-for="cardId in upgradeable"
        :key="cardId"
        class="btn cf-card"
        @click="smith(cardId)"
      >
        {{ getCard(cardId)?.name ?? cardId }}
      </button>
      <p v-if="upgradeable.length === 0" class="cf-none">没有可升级的卡牌</p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.campfire {
  min-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cf-hint {
  font-size: 13px;
  color: var(--text-dim);
}
.cf-btns {
  display: flex;
  gap: 10px;
}
.cf-deck {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  max-height: 300px;
  overflow: auto;
}
.cf-card {
  font-size: 13px;
  padding: 6px 10px;
}
.cf-none {
  color: var(--text-faint);
  font-size: 13px;
}
</style>
