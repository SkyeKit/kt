<script setup lang="ts">
// 根组件：顶部栏（单局状态摘要）+ 主视图
// 阶段 → 路由自动导航（agent.md §5.4：禁止绕过状态机切换页面，此处由阶段驱动路由）
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '@/stores/gameStore'

const store = useGameStore()
const router = useRouter()
const route = useRoute()

// 阶段与路由的映射：战斗→/battle，结算→/settlement，其余单局阶段→/run
watch(
  () => store.phase,
  (phase) => {
    if (phase === 'BATTLE' && route.name !== 'battle') router.push('/battle')
    else if (phase === 'SETTLEMENT' && route.name !== 'settlement') router.push('/settlement')
    else if (['RUN', 'REWARD', 'SHOP', 'CAMPFIRE', 'EVENT'].includes(phase) && route.name !== 'run')
      router.push('/run')
  },
)
</script>

<template>
  <div class="app-root">
    <header v-if="store.run" class="app-topbar">
      <span class="top-item">楼层 {{ store.run.floor }}/17</span>
      <span class="top-item hp">
        <span class="hp-bar">
          <span class="hp-fill" :style="{ width: (store.run.hp / store.run.maxHp) * 100 + '%' }" />
        </span>
        {{ store.run.hp }}/{{ store.run.maxHp }}
      </span>
      <span class="top-item">金币 {{ store.run.gold }}</span>
      <span class="top-item dim">牌组 {{ store.run.deck.length }}</span>
      <span v-if="store.message" class="top-item message">{{ store.message }}</span>
    </header>
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped lang="scss">
// 根布局：顶部栏固定，主内容区滚动
.app-root {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.app-topbar {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--border);
  background: rgba(20, 16, 14, 0.9);
  font-size: 14px;
  flex-wrap: wrap;
}

.top-item {
  color: var(--text-main);
}
.top-item.dim {
  color: var(--text-dim);
}
.top-item.message {
  color: var(--gold);
  margin-left: auto;
}

.hp {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.hp-bar {
  width: 90px;
  height: 10px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  overflow: hidden;
  background: var(--bg-deep);
}
.hp-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent-dim), var(--accent-strong));
}

.app-main {
  flex: 1;
  overflow: auto;
}
</style>
