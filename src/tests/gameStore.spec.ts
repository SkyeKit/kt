/**
 * 单局 Store 集成测试（PRD §3.1/§3.11 关键流程）
 * 覆盖：① 状态机阶段响应式同步（修复"点击节点无反应"回归）
 *       ② 首局第 1 层普通战斗节点；第 2 局起第 1 层先古之民（三选一）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '@/stores/gameStore'
import { useMetaStore } from '@/stores/metaStore'

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
  it('newRun 后阶段为 RUN，enterNode 普通节点后进入 BATTLE（修复"无法进入节点"回归）', () => {
    const store = useGameStore()
    store.newRun(123)
    expect(store.phase).toBe('RUN')
    // 首局第 1 层为普通战斗节点
    const f1 = store.run!.map.find((n) => n.floor === 1)!
    expect(f1.type).toBe('monster')
    store.enterNode(f1.id)
    // 阶段应响应式变化到 BATTLE（此前 computed 缓存导致永远 RUN）
    expect(store.phase).toBe('BATTLE')
    expect(store.battle).not.toBeNull()
  })
})

describe('先古之民（PRD §3.1：自第 2 局起）', () => {
  it('第 2 局起第 1 层为先古之民，进入节点出现遗物三选一', () => {
    const meta = useMetaStore()
    // 模拟已结算 1 局（第 2 局）
    meta.recordRun(false, 5, 3, 0)
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
    const meta = useMetaStore()
    meta.recordRun(false, 5, 3, 0)
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
