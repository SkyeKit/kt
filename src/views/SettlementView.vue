<script setup lang="ts">
/**
 * 结算视图（PRD §3.13）：胜利（击败 Boss）/ 失败（死亡），记录元进度
 * 顶部显示 SingleRunStatusBar（基础信息 + 遗物）
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/gameStore'
import { useMetaProgress } from '@/composables/useMetaProgress'
import SingleRunStatusBar from '@/components/common/SingleRunStatusBar.vue'

const router = useRouter()
const store = useGameStore()
const meta = useMetaProgress()

// 胜利判定：击败过 Boss
const victory = computed(() => store.run?.bossDefeated ?? false)
const run = computed(() => store.run)

// 记录战绩并返回主菜单
function backToMenu(): void {
  if (run.value) meta.recordRunResult(victory.value)
  store.abandonRun()
  router.push('/')
}

// 查看统计
function goStats(): void {
  if (run.value) meta.recordRunResult(victory.value)
  store.abandonRun()
  router.push('/stats')
}
</script>

<template>
  <div class="settlement">
    <!-- 顶部：单局状态栏（含遗物 + 角色基础信息） -->
    <SingleRunStatusBar />

    <div class="settlement-body">
      <h1 class="st-title" :class="victory ? 'win' : 'lose'">
        {{ victory ? '胜利' : '战败' }}
      </h1>
      <div v-if="run" class="st-stats panel">
        <p>到达楼层：{{ run.floor }}</p>
        <p>击杀：{{ run.meta.kills }}（精英 {{ run.meta.elitesKilled }}）</p>
        <p>剩余生命：{{ run.hp }}/{{ run.maxHp }}</p>
        <p>剩余金币：{{ run.gold }}</p>
        <p>牌组规模：{{ run.deck.length }}</p>
        <p>遗物：{{ run.relics.length }} 件</p>
      </div>
      <div class="st-btns">
        <button class="btn btn-primary" @click="backToMenu">返回主菜单</button>
        <button class="btn" @click="goStats">查看统计</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.settlement {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.settlement-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
}
.st-title {
  font-size: 60px;
  letter-spacing: 10px;
}
.st-title.win {
  color: var(--gold);
  text-shadow: 0 0 30px rgba(201, 162, 39, 0.4);
}
.st-title.lose {
  color: var(--accent-dim);
}
.st-stats {
  min-width: 300px;
  line-height: 2;
  color: var(--text-dim);
}
.st-btns {
  display: flex;
  gap: 12px;
}
</style>
