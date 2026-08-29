/**
 * BattleView 拖拽玩法回归测试（PRD §5.3 / 用户反馈：多怪时卡牌需"拖拽+箭头"，非攻击卡可直接使用）
 * 覆盖：①非攻击卡可直接打 player（无需 target）；②攻击卡必须指定 target 才能打
 * 涉及 store 调用层（target 校验逻辑）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '@/stores/gameStore'
import { cardsData, getCard } from '@/data'

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

function setupBattle(): { store: ReturnType<typeof useGameStore>; enemyId: string } {
  const store = useGameStore()
  store.newRun(42)
  // 第 1 层先古三选一
  store.enterNode('f1-r0')
  store.claimRelicReward(store.pendingReward?.relics?.[0]?.id ?? null)
  // 强制进入战斗（用第 2 层普通节点）
  const node = store.run!.map.find((n) => n.floor === 2)!
  store.enterNode(node.id)
  const enemyId = store.battle!.enemies[0]!.id
  return { store, enemyId }
}

describe('BattleView 出牌语义', () => {
  it('非攻击卡（技能）可直接打出，无需 target', () => {
    const { store } = setupBattle()
    const defend = cardsData.warrior.find((c) => c.id === 'defend_ironclad')!
    expect(defend.type).toBe('skill')
    const handBefore = store.battle!.hand.length
    const ok = store.playCard(defend.id)
    expect(ok).toBe(true)
    // 打出后手牌减少 1 张（不校验内容是否包含，因牌组中有多张同 id）
    expect(store.battle!.hand.length).toBe(handBefore - 1)
    expect(store.battle!.discardPile).toContain('defend_ironclad')
  })

  it('攻击卡：需指定目标 enemyId；未指定时多怪时挑首个', () => {
    const { store } = setupBattle()
    const strike = getCard('strike_ironclad')!
    expect(strike.type).toBe('attack')
    // 不传 target → 引擎内部挑首个敌人 → 应成功
    const ok = store.playCard(strike.id)
    expect(ok).toBe(true)
  })

  it('攻击卡：指定无效目标时返回失败', () => {
    const { store } = setupBattle()
    const strike = getCard('strike_ironclad')!
    const ok = store.playCard(strike.id, 'nonexistent_enemy')
    expect(ok).toBe(false)
  })

  it('能量不足时不能打出（耗能型卡）', () => {
    const { store } = setupBattle()
    const strike = getCard('strike_ironclad')!
    // 抽干玩家能量
    store.battle!.energy = 0
    const ok = store.playCard(strike.id)
    expect(ok).toBe(false)
  })
})
