<script setup lang="ts">
/**
 * 图鉴视图（PRD §3.10 附）：浏览全部卡牌/敌人/遗物数据（来自 data/*.json）
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { cardsData, enemiesData, relicsData } from '@/data'

const router = useRouter()
const tab = ref<'cards' | 'enemies' | 'relics'>('cards')
const search = ref('')

// 全部卡牌（去重：同一 id 只显示一次）
const allCards = [
  ...cardsData.warrior,
  ...cardsData.colorless,
  ...cardsData.status,
  ...cardsData.curse,
  ...cardsData.eventCards,
  ...cardsData.derived,
]
const filteredCards = () =>
  allCards.filter(
    (c) => !search.value || c.name.includes(search.value) || c.id.includes(search.value),
  )
const filteredEnemies = () =>
  enemiesData.enemies.filter((e) => !search.value || e.name.includes(search.value))
const allRelics = () =>
  [
    ...relicsData.neowPool,
    ...relicsData.warrior,
    ...relicsData.general,
    ...relicsData.ancient,
  ].filter((r) => !search.value || r.name.includes(search.value))

function back(): void {
  router.push('/')
}
</script>

<template>
  <div class="codex">
    <div class="codex-head">
      <h1 class="h-title">图鉴</h1>
      <div class="codex-tabs">
        <button class="btn" :class="{ 'btn-primary': tab === 'cards' }" @click="tab = 'cards'">
          卡牌（{{ allCards.length }}）
        </button>
        <button class="btn" :class="{ 'btn-primary': tab === 'enemies' }" @click="tab = 'enemies'">
          敌人（{{ enemiesData.enemies.length }}）
        </button>
        <button class="btn" :class="{ 'btn-primary': tab === 'relics' }" @click="tab = 'relics'">
          遗物
        </button>
        <button class="btn" @click="back">返回</button>
      </div>
      <input v-model="search" class="codex-search" placeholder="搜索名称/id" />
    </div>

    <!-- 卡牌 -->
    <div v-if="tab === 'cards'" class="codex-grid cards">
      <CardView v-for="c in filteredCards()" :key="c.id + c.rarity" :card="c" class="codex-card" />
    </div>

    <!-- 敌人 -->
    <div v-if="tab === 'enemies'" class="codex-grid enemies">
      <div v-for="e in filteredEnemies()" :key="e.id" class="enemy-card">
        <p class="ec-name">{{ e.name }}（{{ e.id }}）</p>
        <p class="ec-hp">HP {{ e.hpMin }}~{{ e.hpMax }}｜{{ e.category }}</p>
        <p v-for="(m, key) in e.moves" :key="key" class="ec-moves">{{ m.name }}：{{ m.desc }}</p>
      </div>
    </div>

    <!-- 遗物 -->
    <div v-if="tab === 'relics'" class="codex-grid relics">
      <div v-for="r in allRelics()" :key="r.id" class="relic-card">
        <p class="rc-name">{{ r.name }}（{{ r.rarity }}）</p>
        <p class="rc-desc">{{ r.desc }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.codex {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
}
.codex-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.codex-tabs {
  display: flex;
  gap: 8px;
}
.codex-search {
  background: var(--bg-deep);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  color: var(--text-main);
  padding: 6px 10px;
  font-family: inherit;
}
.codex-grid {
  flex: 1;
  overflow: auto;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-content: flex-start;
}
.enemy-card,
.relic-card {
  width: 200px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px;
  background: var(--bg-raised);
  font-size: 12px;
  line-height: 1.6;
}
.ec-name,
.rc-name {
  color: var(--accent-strong);
  font-weight: bold;
}
.ec-hp {
  color: var(--text-dim);
}
.ec-moves {
  color: var(--text-dim);
}
.rc-desc {
  color: var(--text-dim);
}
</style>
