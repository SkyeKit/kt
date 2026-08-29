/**
 * 单局 Store 集成测试（PRD §3.1/§3.11 关键流程）
 * 覆盖：① 状态机阶段响应式同步（修复"点击节点无反应"回归）
 *       ② 第 1 层恒为先古之民节点（遗物三选一）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '@/stores/gameStore'

// 简单 localStorage mock（node 环境无 localStorage）
const storage = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
}

beforeEach(() => {
  storage.clear()
  setActivePinia(createPinia())
})

describe('阶段状态机：响应式同步', () => {
  it('newRun → 先古选择 → 点击第 2 层战斗节点进入 BATTLE（修复"无法进入节点"回归）', () => {
    const store = useGameStore()
    store.newRun(123)
    expect(store.phase).toBe('RUN')
    // 第 1 层先古：先完成三选一（解锁第 2 层）
    store.enterNode('f1-r0')
    store.claimRelicReward(store.pendingReward?.relics?.[0]?.id ?? null)
    const f2 = store.run!.map.find((n) => n.floor === 2)!
    expect(f2.type).toBe('monster')
    store.enterNode(f2.id)
    // 阶段应响应式变化到 BATTLE（此前 computed 缓存导致永远 RUN）
    expect(store.phase).toBe('BATTLE')
    expect(store.battle).not.toBeNull()
  })
})

describe('先古之民（第 1 层固定）', () => {
  it('每局第 1 层均为先古之民，进入节点出现遗物三选一', () => {
    const store = useGameStore()
    store.newRun(456)
    const f1 = store.run!.map.find((n) => n.floor === 1)!
    expect(f1.type).toBe('neow')
    store.enterNode(f1.id)
    expect(store.phase).toBe('REWARD')
    // 三选一：3 件遗物且不含已剔除的（巨大卷轴等）
    const offer = store.pendingReward
    expect(offer?.kind).toBe('relic')
    expect(offer?.relics?.length).toBe(3)
    for (const r of offer?.relics ?? []) {
      expect(r.excluded).not.toBe(true)
    }
  })

  it('选择遗物后遗物入库并回到 RUN，解锁第 2 层', () => {
    const store = useGameStore()
    store.newRun(789)
    store.enterNode('f1-r0')
    const relicId = store.pendingReward?.relics?.[0]?.id
    store.claimRelicReward(relicId ?? null)
    expect(store.run!.relics).toContain(relicId)
    expect(store.phase).toBe('RUN')
    // 第 2 层已解锁（可进入）
    const f2 = store.run!.map.find((n) => n.floor === 2)!
    expect(f2.locked).toBe(false)
  })
})
