<script setup lang="ts">
// 根组件：仅保留主视图区（顶部全局状态栏已移除，状态信息整合进各视图的 top-bar）
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
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped lang="scss">
// 根布局：主内容区上下顶满，无全局顶栏
.app-root {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.app-main {
  flex: 1;
  overflow: auto;
}
</style>
