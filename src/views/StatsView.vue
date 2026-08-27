<script setup lang="ts">
/**
 * 统计视图（PRD §3.9 / §3.13）：元进度展示（胜利/击杀/最佳楼层）
 */
import { useRouter } from 'vue-router'
import { useMetaProgress } from '@/composables/useMetaProgress'

const router = useRouter()
const { stats } = useMetaProgress()

function back(): void {
  router.push('/')
}
</script>

<template>
  <div class="stats">
    <h1 class="h-title">统计</h1>
    <div class="stats-panel panel">
      <p>总游戏局数：{{ stats.runs }}</p>
      <p>胜利局数：{{ stats.victories }}</p>
      <p>胜率：{{ stats.runs ? Math.round((stats.victories / stats.runs) * 100) : 0 }}%</p>
      <p>累计击杀：{{ stats.kills }}（精英/Boss {{ stats.elitesKilled }}）</p>
      <p>最佳到达楼层：{{ stats.bestFloor }}/17</p>
    </div>
    <button class="btn" @click="back">返回主菜单</button>
  </div>
</template>

<style scoped lang="scss">
.stats {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
}
.stats-panel {
  min-width: 320px;
  line-height: 2;
  color: var(--text-dim);
}
</style>
