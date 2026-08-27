/**
 * 元进度组合函数（PRD §3.9）：结算界面记录战绩、统计界面读取
 */
import { computed } from 'vue'
import { useMetaStore } from '@/stores/metaStore'
import { useGameStore } from '@/stores/gameStore'

export function useMetaProgress() {
  const metaStore = useMetaStore()
  const gameStore = useGameStore()

  // 统计视图数据
  const stats = computed(() => metaStore.meta)

  // 记录一局结果（结算界面调用）
  function recordRunResult(victory: boolean): void {
    const r = gameStore.run
    if (!r) return
    metaStore.recordRun(victory, r.floor, r.meta.kills, r.meta.elitesKilled)
  }

  return { stats, recordRunResult }
}
