/**
 * 效果链引擎测试（agent.md §6：每种效果类型必须覆盖）
 * 覆盖：damage（含多段）/ block / draw / applyStatus / heal / loseHp / addCard
 */
import { describe, it, expect } from 'vitest'
import { createCombatContext, startCombat } from '@/engine/combatEngine'
import {
  resolveEffectChain,
  damageUnit,
  calculateFinalDamage,
  drawCards,
} from '@/engine/effectEngine'
import type { CombatContext } from '@/engine/combatEngine'

// 构造标准战斗上下文（1 个敌人，玩家 80 血）
function makeCtx(): CombatContext {
  const ctx = createCombatContext(
    { id: 'p', name: '铁甲战士', hp: 80, maxHp: 80, deck: [] },
    [{ id: 'e', name: '小啃兽', hp: 42, maxHp: 42 }],
    () => 0.5,
  )
  ctx.player.maxEnergy = 3
  startCombat(ctx, 0)
  return ctx
}

describe('效果链：伤害', () => {
  it('普通伤害：扣除目标生命', () => {
    const ctx = makeCtx()
    const before = ctx.enemies[0]!.hp
    resolveEffectChain(ctx, [{ type: 'damage', target: 'enemy', amount: 6 }])
    expect(ctx.enemies[0]!.hp).toBe(before - 6)
  })

  it('多段伤害：逐段结算，总量 = 单段 × 段数', () => {
    const ctx = makeCtx()
    const before = ctx.enemies[0]!.hp
    resolveEffectChain(ctx, [{ type: 'damage', target: 'enemy', amount: 3, hits: 3 }])
    expect(ctx.enemies[0]!.hp).toBe(before - 9)
  })

  it('敌人死亡后 alive 置为 false', () => {
    const ctx = makeCtx()
    resolveEffectChain(ctx, [{ type: 'damage', target: 'enemy', amount: 999 }])
    expect(ctx.enemies[0]!.alive).toBe(false)
    expect(ctx.enemies[0]!.hp).toBe(0)
  })
})

describe('效果链：格挡', () => {
  it('获得格挡：格挡值增加', () => {
    const ctx = makeCtx()
    resolveEffectChain(ctx, [{ type: 'block', amount: 8 }])
    expect(ctx.player.block).toBe(8)
  })

  it('格挡吸收伤害：先扣格挡再扣血（PRD §3.3.3 结算顺序）', () => {
    const ctx = makeCtx()
    resolveEffectChain(ctx, [{ type: 'block', amount: 5 }])
    const hpBefore = ctx.player.hp
    const lost = damageUnit(ctx.player, 7)
    expect(ctx.player.block).toBe(0)
    expect(lost).toBe(2)
    expect(ctx.player.hp).toBe(hpBefore - 2)
  })
})

describe('效果链：抽牌', () => {
  it('抽牌：手牌增加，抽牌堆减少', () => {
    const ctx = makeCtx()
    ctx.drawPile = ['strike_ironclad', 'strike_ironclad', 'strike_ironclad']
    ctx.hand = []
    const drawn = drawCards(ctx, 2)
    expect(drawn).toBe(2)
    expect(ctx.hand.length).toBe(2)
    expect(ctx.drawPile.length).toBe(1)
  })
})

describe('效果链：状态施加', () => {
  it('给予易伤：目标状态层数增加', () => {
    const ctx = makeCtx()
    resolveEffectChain(ctx, [
      { type: 'applyStatus', target: 'enemy', status: 'vulnerable', amount: 2 },
    ])
    const s = ctx.enemies[0]!.statuses.find((x) => x.id === 'vulnerable')
    expect(s?.amount).toBe(2)
  })

  it('易伤对伤害的修正：×1.5（PRD §3.3.3）', () => {
    const ctx = makeCtx()
    resolveEffectChain(ctx, [
      { type: 'applyStatus', target: 'enemy', status: 'vulnerable', amount: 1 },
    ])
    const dmg = calculateFinalDamage(ctx.player, ctx.enemies[0]!, 10)
    expect(dmg).toBe(15)
  })

  it('虚弱对伤害的修正：×0.75（PRD §3.3.3）', () => {
    const ctx = makeCtx()
    ctx.player.statuses.push({ id: 'weak', amount: 1, turns: 999 })
    const dmg = calculateFinalDamage(ctx.player, ctx.enemies[0]!, 10)
    expect(dmg).toBe(7)
  })

  it('缩小修正：×0.7', () => {
    const ctx = makeCtx()
    ctx.player.statuses.push({ id: 'shrink', amount: 1, turns: 999 })
    const dmg = calculateFinalDamage(ctx.player, ctx.enemies[0]!, 10)
    expect(dmg).toBe(7)
  })

  it('力量加成：基础 + 力量（PRD §3.3.3）', () => {
    const ctx = makeCtx()
    ctx.player.strength = 3
    const dmg = calculateFinalDamage(ctx.player, ctx.enemies[0]!, 10)
    expect(dmg).toBe(13)
  })
})

describe('效果链：治疗与失去生命', () => {
  it('heal：不超过最大生命', () => {
    const ctx = makeCtx()
    ctx.player.hp = 70
    resolveEffectChain(ctx, [{ type: 'heal', amount: 20 }])
    expect(ctx.player.hp).toBe(80)
  })

  it('loseHp：不经过格挡直接扣血', () => {
    const ctx = makeCtx()
    ctx.player.block = 10
    const before = ctx.player.hp
    resolveEffectChain(ctx, [{ type: 'loseHp', amount: 5 }])
    expect(ctx.player.hp).toBe(before - 5)
  })
})

describe('效果链：向弃牌堆洗入卡牌', () => {
  it('addCard：弃牌堆增加', () => {
    const ctx = makeCtx()
    resolveEffectChain(ctx, [{ type: 'addCard', cardId: 'slime', to: 'discard' }])
    expect(ctx.discardPile).toContain('slime')
  })
})
