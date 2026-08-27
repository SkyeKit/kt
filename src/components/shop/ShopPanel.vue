<script setup lang="ts">
/**
 * 商店浮层（PRD §3.5）：卡牌/遗物/卡牌移除购买，离开后不可返回
 */
import { computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'

const store = useGameStore()
const shop = computed(() => store.shopState)
const gold = computed(() => store.run?.gold ?? 0)

function buyCard(idx: number): void {
  store.buyCard(idx)
}
function buyRelic(idx: number): void {
  store.buyRelic(idx)
}
</script>

<template>
  <div v-if="shop" class="shop panel">
    <h2 class="h-title">商店</h2>
    <p class="shop-gold">金币：{{ gold }}</p>

    <h3 class="shop-sec">卡牌（{{ shop.cards.length }}）</h3>
    <div class="shop-cards">
      <div v-for="(card, i) in shop.cards" :key="i" class="shop-item">
        <CardView :card="card" />
        <button class="btn btn-primary" :disabled="gold < 50" @click="buyCard(i)">购买</button>
      </div>
    </div>

    <h3 class="shop-sec">遗物（{{ shop.relics.length }}）</h3>
    <div class="shop-relics">
      <button
        v-for="(relic, i) in shop.relics"
        :key="relic.id"
        class="relic-item"
        @click="buyRelic(i)"
      >
        <span class="relic-name">{{ relic.name }}</span>
        <span class="relic-price">{{ relic.rarity === '商店' ? '150~300' : '150~300' }} 金币</span>
      </button>
    </div>

    <h3 class="shop-sec">卡牌移除（剩余 {{ shop.removeCount }} 次，{{ shop.removeCost }} 金币）</h3>
    <div class="shop-remove">
      <button
        v-for="(cardId, i) in store.run?.deck ?? []"
        :key="i"
        class="btn"
        :disabled="gold < shop.removeCost"
        @click="store.buyRemove(cardId)"
      >
        {{ cardId }}
      </button>
    </div>

    <button class="btn leave-btn" @click="store.leaveShop()">离开商店</button>
  </div>
</template>

<style scoped lang="scss">
.shop {
  min-width: 680px;
  max-height: 86vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.shop-gold {
  color: var(--gold);
}
.shop-sec {
  font-size: 14px;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
  margin-top: 6px;
}
.shop-cards {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.shop-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.shop-relics {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.relic-item {
  padding: 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg-raised);
  cursor: pointer;
  color: var(--text-main);
  font-family: inherit;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.relic-name {
  color: var(--gold);
}
.relic-price {
  font-size: 12px;
  color: var(--text-dim);
}
.shop-remove {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.shop-remove .btn {
  font-size: 12px;
  padding: 4px 8px;
}
.leave-btn {
  align-self: flex-end;
}
</style>
