/**
 * 事件组合函数（PRD §3.7）：EventView 用，事件选项显示与可选择性判断
 */
import { computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import { eventMap } from '@/data'
import type { EventOptionEffect } from '@/types'

export function useEvent() {
  const store = useGameStore()

  // 当前事件
  const event = computed(() => {
    const id = store.currentEvent
    return id ? (eventMap.get(id) ?? null) : null
  })

  // 可选项：剔除药水相关（MVP 未上线）
  const options = computed<EventOptionEffect[]>(() =>
    (event.value?.options ?? []).filter((o) => !o.excluded),
  )

  // 选项是否满足前置条件（金币类条件）
  function isOptionAvailable(opt: EventOptionEffect): boolean {
    const r = store.run
    if (!r) return false
    if (opt.requires) return true // MVP 简化：不做精确校验
    return true
  }

  // 选择选项
  function choose(opt: EventOptionEffect): void {
    if (opt.excluded) return
    store.resolveEventOption(opt.text)
  }

  return { event, options, isOptionAvailable, choose }
}
