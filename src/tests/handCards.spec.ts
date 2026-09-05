/**
 * 无色/状态/诅咒/衍生卡机制测试（agent.md §6：新增效果类型必须补测试）
 * 覆盖：回合结束手牌结算（灼伤/毒素/悔恨/债务/羞耻/疑虑）、固有卡起手、虚无消耗、保留留手、
 *      抽到触发（虚空）、不可打出拦截、新手牌结算不影响其他机制。
 */
import { describe, it, expect } from 'vitest'
import {
  createCombatContext,
  startCombat,
  playCard,
  resolveHandEndOfTurn,
} from '@/engine/combatEngine'
import type { CombatContext } from '@/engine/combatEngine'
import { drawCards, getStatusAmount, resolveEffectChain } from '@/engine/effectEngine'
import { getCard } from '@/data'

// 构造一个空战斗上下文（不触发敌人，仅测试玩家手牌机制）
function makeCtx(deck: string[]): CombatContext {
  // 传入的为卡 id 数组，转为"未升级"卡实例
  const cards = deck.map((id) => ({ id, upgrade: false }))
  return createCombatContext(
    { id: 'p', name: '铁甲战士', hp: 80, maxHp: 80, deck: cards, gold: 50 },
    [],
    () => 0.5,
  )
}

// 构造一个带单体敌人的战斗上下文（供攻击卡打牌/重放等测试）
function makeEnemyCtx(deck: string[]): CombatContext {
  const cards = deck.map((id) => ({ id, upgrade: false }))
  return createCombatContext(
    { id: 'p', name: '铁甲战士', hp: 80, maxHp: 80, deck: cards, gold: 50 },
    [{ id: 'e1', name: '蜥蜴', hp: 100, maxHp: 100 }],
    () => 0.5,
  )
}

describe('状态/诅咒卡 回合结束手牌结算', () => {
  it('灼伤：回合结束时若在手牌中，玩家失去 2 点生命', () => {
    const ctx = makeCtx(['burn'])
    ctx.hand = ['burn'].map((id) => ({ id, upgrade: false }))
    ctx.player.hp = 80
    resolveHandEndOfTurn(ctx)
    expect(ctx.player.hp).toBe(78)
    // 灼伤无虚无/保留关键词，回合结束进弃牌堆
    expect(ctx.hand).toEqual([])
    expect(ctx.discardPile).toContainEqual({ id: 'burn', upgrade: false })
  })

  it('毒素：回合结束时失去 5 点生命（每张在手牌的毒素各结算一次）', () => {
    const ctx = makeCtx([])
    ctx.hand = ['toxin', 'toxin'].map((id) => ({ id, upgrade: false }))
    resolveHandEndOfTurn(ctx)
    expect(ctx.player.hp).toBe(70)
  })

  it('悔恨：失去等同于手牌数量的生命', () => {
    const ctx = makeCtx([])
    ctx.hand = ['strike_ironclad', 'strike_ironclad', 'regret'].map((id) => ({
      id,
      upgrade: false,
    }))
    resolveHandEndOfTurn(ctx)
    // 手牌原本 3 张，扣除 3 点生命；悔恨随后进弃牌堆
    expect(ctx.player.hp).toBe(77)
    expect(ctx.discardPile).toContainEqual({ id: 'regret', upgrade: false })
  })

  it('债务：回合结束时失去 10 金币', () => {
    const ctx = makeCtx([])
    ctx.hand = ['debt'].map((id) => ({ id, upgrade: false }))
    resolveHandEndOfTurn(ctx)
    expect(ctx.gold).toBe(40)
  })

  it('羞耻：回合结束时获得 1 层脆弱（施加给自己）', () => {
    const ctx = makeCtx([])
    ctx.hand = ['shame'].map((id) => ({ id, upgrade: false }))
    resolveHandEndOfTurn(ctx)
    expect(getStatusAmount(ctx.player, 'frail')).toBe(1)
  })
})

describe('虚无(ethereal) 与 保留(retain)', () => {
  it('虚无：回合结束时消耗（进消耗堆），不进弃牌堆', () => {
    const ctx = makeCtx([])
    ctx.hand = ['void'].map((id) => ({ id, upgrade: false }))
    resolveHandEndOfTurn(ctx)
    expect(ctx.exhaustPile).toContainEqual({ id: 'void', upgrade: false })
    expect(ctx.discardPile).not.toContainEqual({ id: 'void', upgrade: false })
    expect(ctx.hand).toEqual([])
  })

  it('保留：回合结束时留在手牌', () => {
    const ctx = makeCtx([])
    // 君王之剑 带保留关键词
    ctx.hand = ['monarch_sword'].map((id) => ({ id, upgrade: false }))
    resolveHandEndOfTurn(ctx)
    expect(ctx.hand).toContainEqual({ id: 'monarch_sword', upgrade: false })
    expect(ctx.discardPile).not.toContainEqual({ id: 'monarch_sword', upgrade: false })
  })

  it('无关键词的普通牌：回合结束进弃牌堆', () => {
    const ctx = makeCtx([])
    ctx.hand = ['strike_ironclad'].map((id) => ({ id, upgrade: false }))
    resolveHandEndOfTurn(ctx)
    expect(ctx.hand).toEqual([])
    expect(ctx.discardPile).toContainEqual({ id: 'strike_ironclad', upgrade: false })
  })

  it('retainAll（符文金字塔）：非保留牌也留手牌', () => {
    const ctx = makeCtx([])
    ctx.hand = ['strike_ironclad'].map((id) => ({ id, upgrade: false }))
    resolveHandEndOfTurn(ctx, { retainAll: true })
    expect(ctx.hand).toEqual([{ id: 'strike_ironclad', upgrade: false }])
    expect(ctx.discardPile).toEqual([])
  })

  it('本回合保留手牌（均衡）：打出该牌后在回合结束批量保留手牌，且仅当回合生效', () => {
    const ctx = makeCtx([])
    ctx.hand = ['equilibrium'].map((id) => ({ id, upgrade: false }))
    // 打出均衡：解析其效果应置 retainHandThisTurn = true
    resolveEffectChain(ctx, getCard('equilibrium')!.effects, {})
    expect(ctx.retainHandThisTurn).toBe(true)
    // 回合结束：全员保留
    resolveHandEndOfTurn(ctx)
    expect(ctx.hand).toEqual([{ id: 'equilibrium', upgrade: false }])
    expect(ctx.discardPile).toEqual([])
  })
})

describe('固有(innate) 卡', () => {
  it('开局固有卡直接入手牌，且不占抽牌堆', () => {
    // 苦恼 诅咒带固有关键词
    const ctx = makeCtx(['anguish'])
    startCombat(ctx, 0, 3)
    expect(ctx.hand).toContainEqual({ id: 'anguish', upgrade: false })
    expect(ctx.drawPile).not.toContainEqual({ id: 'anguish', upgrade: false })
  })
})

describe('抽到触发(onDraw) 与 不可打出', () => {
  it('虚空：抽到这张牌时失去 1 点能量', () => {
    const ctx = makeCtx(['void'])
    ctx.energy = 3
    // 直接放入抽牌堆顶并抽 1 张
    ctx.drawPile = [{ id: 'void', upgrade: false }]
    const drawn = ctx.hand.length
    drawCards(ctx, 1)
    expect(ctx.hand.length).toBe(drawn + 1)
    expect(ctx.energy).toBe(2)
  })

  it('不可打出的状态/诅咒牌无法被 playCard 打出', () => {
    const ctx = makeCtx([])
    ctx.hand = ['wound'].map((id) => ({ id, upgrade: false }))
    ctx.energy = 10
    expect(playCard(ctx, { id: 'wound', upgrade: false })).toBe(false)
  })
})

describe('选择一张牌加入手牌（chooseAdd，无色交互卡）', () => {
  it('秘密技法：候选来自抽牌堆中的技能牌，挂起选牌请求', () => {
    const ctx = makeCtx(['defend_ironclad', 'strike_ironclad', 'cleave'])
    const card = getCard('secret_technique')!
    resolveEffectChain(ctx, card.effects, {})
    expect(ctx.pendingPicks.length).toBe(1)
    const req = ctx.pendingPicks[0]!
    expect(req.cards.every((c) => c.type === 'skill')).toBe(true) // 只有防御是技能
    expect(req.cards.map((c) => c.id)).toContain('defend_ironclad')
  })

  it('发现：候选为无色+战士非基础/先古池随机 3 张，action 为免费打出', () => {
    const ctx = makeCtx([])
    const card = getCard('discover')!
    resolveEffectChain(ctx, card.effects, {})
    expect(ctx.pendingPicks.length).toBe(1)
    const req = ctx.pendingPicks[0]!
    expect(req.cards.length).toBe(3)
    expect(req.action).toBe('addToHandFree')
  })

  it('无匹配候选时不挂起选牌（许愿：抽牌堆为空）', () => {
    const ctx = makeCtx([])
    const card = getCard('wish')!
    resolveEffectChain(ctx, card.effects, {})
    expect(ctx.pendingPicks.length).toBe(0)
  })
})

describe('重放（echo，未掘宝石）', () => {
  it('未掘宝石：给抽牌堆中一张无重放的随机牌施加 2 层重放', () => {
    const ctx = makeCtx(['strike_ironclad'])
    const card = getCard('uncut_gem')!
    resolveEffectChain(ctx, card.effects, {})
    // 抽牌堆仅有 1 张无重放，必被选中
    expect(ctx.replay['strike_ironclad']).toBe(2)
  })

  it('重放：打出带 2 层重放的攻击牌，效果会自动结算 3 次（3×打击伤害）', () => {
    const ctx = makeEnemyCtx(['strike_ironclad'])
    // 手牌放入打击；手牌中已持有该重放标记，但直接打牌验证重放层数
    ctx.hand = ['strike_ironclad'].map((id) => ({ id, upgrade: false }))
    ctx.replay['strike_ironclad'] = 2
    ctx.energy = 3
    const before = ctx.enemies[0]!.hp
    expect(playCard(ctx, { id: 'strike_ironclad', upgrade: false }, 'e1')).toBe(true)
    // 打击基础 6 伤，3 次共 18
    expect(ctx.enemies[0]!.hp).toBe(before - 18)
    // 重放层数一次性耗尽
    expect(ctx.replay['strike_ironclad']).toBe(0)
  })
})
