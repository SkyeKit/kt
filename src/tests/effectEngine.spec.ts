/**
 * 效果链引擎测试（agent.md §6：每种效果类型必须覆盖）
 * 覆盖：damage（含多段）/ block / draw / applyStatus / heal / loseHp / addCard
 */
import { describe, it, expect } from 'vitest'
import { createCombatContext, startCombat, startPlayerTurn } from '@/engine/combatEngine'
import {
  resolveEffectChain,
  damageUnit,
  calculateFinalDamage,
  drawCards,
  onExhaustCard,
  addStatus,
  getStatusAmount,
} from '@/engine/effectEngine'
import { getCard } from '@/data'
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
    ctx.drawPile = ['strike_ironclad', 'strike_ironclad', 'strike_ironclad'].map((id) => ({
      id,
      upgrade: false,
    }))
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
    expect(ctx.discardPile).toContainEqual({ id: 'slime', upgrade: false })
  })
})

describe('效果链：新机制卡效果', () => {
  it('nextAttacksExtra：累计"攻击额外生效"次数', () => {
    const ctx = makeCtx()
    resolveEffectChain(ctx, [{ type: 'nextAttacksExtra', count: 2 }])
    expect(ctx.nextAttacksExtra).toBe(2)
  })

  it('playTopXCards：打出抽牌堆顶部 lastXPaid 张牌', () => {
    const ctx = makeCtx()
    ctx.lastXPaid = 3
    ctx.drawPile = ['strike_ironclad', 'strike_ironclad', 'strike_ironclad'].map((id) => ({
      id,
      upgrade: false,
    }))
    const hpBefore = ctx.enemies[0]!.hp
    resolveEffectChain(ctx, [{ type: 'playTopXCards' }])
    // 3 张打击 × 6 = 18
    expect(ctx.enemies[0]!.hp).toBe(hpBefore - 18)
    expect(ctx.drawPile.length).toBe(0)
    expect(ctx.discardPile.length).toBe(3)
  })

  it('transformHandAttacks：手牌攻击全部变化为随机攻击牌', () => {
    const ctx = makeCtx()
    ctx.hand = [
      { id: 'strike_ironclad', upgrade: false },
      { id: 'bash', upgrade: false },
    ]
    resolveEffectChain(ctx, [{ type: 'transformHandAttacks' }])
    expect(ctx.hand.length).toBe(2)
    // 变化后仍为攻击牌（巨石缺失降级为随机战士攻击牌）
    for (const h of ctx.hand) {
      expect(getCard(h.id)?.type).toBe('attack')
    }
  })

  it('身体素质（damageScaling block）：造成当前格挡值伤害', () => {
    const ctx = makeCtx()
    ctx.player.block = 7
    const hpBefore = ctx.enemies[0]!.hp
    resolveEffectChain(ctx, [{ type: 'damageScaling', target: 'enemy', base: 0, scaling: 'block' }])
    expect(ctx.enemies[0]!.hp).toBe(hpBefore - 7)
  })
})

describe('效果链：残酷（对易伤敌人额外倍率）', () => {
  it('普通残酷：易伤敌人额外 ×1.25', () => {
    const ctx = makeCtx()
    ctx.enemies[0]!.statuses.push({ id: 'vulnerable', amount: 1, turns: 999 })
    ctx.powers.set('cruelty', false)
    // 基础10 ×易伤1.5 ×残酷1.25 = 18.75 → 向下取整 18
    expect(calculateFinalDamage(ctx.player, ctx.enemies[0]!, 10, 1, ctx)).toBe(18)
  })

  it('升级残酷：易伤敌人额外 ×1.5', () => {
    const ctx = makeCtx()
    ctx.enemies[0]!.statuses.push({ id: 'vulnerable', amount: 1, turns: 999 })
    ctx.powers.set('cruelty', true)
    // 基础10 ×易伤1.5 ×残酷1.5 = 22.5 → 向下取整 22
    expect(calculateFinalDamage(ctx.player, ctx.enemies[0]!, 10, 1, ctx)).toBe(22)
  })
})

describe('效果链：武装（upgradeHand）', () => {
  it('未升级武装：随机升级手牌中 1 张', () => {
    const ctx = makeCtx()
    ctx.hand = [
      { id: 'strike_ironclad', upgrade: false },
      { id: 'strike_ironclad', upgrade: false },
      { id: 'bash', upgrade: false },
    ]
    resolveEffectChain(ctx, [{ type: 'upgradeHand', count: 1 }])
    expect(ctx.hand.filter((h) => h.upgrade).length).toBe(1)
  })

  it('升级后武装（all）：升级手牌中的所有牌', () => {
    const ctx = makeCtx()
    ctx.hand = [
      { id: 'strike_ironclad', upgrade: false },
      { id: 'bash', upgrade: false },
    ]
    resolveEffectChain(ctx, [{ type: 'upgradeHand', count: 1, all: true }])
    expect(ctx.hand.every((h) => h.upgrade)).toBe(true)
  })
})

describe('效果链：头槌（moveDiscardToTop）', () => {
  it('将弃牌堆 1 张随机牌放到抽牌堆顶部', () => {
    const ctx = makeCtx()
    ctx.discardPile = [{ id: 'armaments', upgrade: false }]
    ctx.drawPile = [{ id: 'strike_ironclad', upgrade: false }]
    resolveEffectChain(ctx, [{ type: 'moveDiscardToTop' }])
    expect(ctx.discardPile.length).toBe(0)
    expect(ctx.drawPile.length).toBe(2)
    // 抽牌堆使用 pop 从尾部抽（pop = 顶部），被移动的牌应位于尾部
    expect(ctx.drawPile[ctx.drawPile.length - 1]!.id).toBe('armaments')
  })
})

describe('效果链：无情猛攻（nextAttackFree）', () => {
  it('累计"下一张攻击牌耗能 0"次数', () => {
    const ctx = makeCtx()
    resolveEffectChain(ctx, [{ type: 'nextAttackFree', count: 1 }])
    expect(ctx.nextAttackFree).toBe(1)
  })
})

describe('效果链：荆棘反伤', () => {
  it('目标持有荆棘时，对攻击方反弹层数伤害', () => {
    const ctx = makeCtx()
    // 玩家持有 2 层荆棘，敌人攻击玩家 3 点伤害
    ctx.player.statuses.push({ id: 'thorns', amount: 2, turns: 999 })
    const playerBefore = ctx.player.hp
    const enemyBefore = ctx.enemies[0]!.hp
    resolveEffectChain(ctx, [{ type: 'damage', target: 'enemy', amount: 3 }], {
      source: 'enemy',
      actorId: 'e',
    })
    // 玩家受 3 伤；敌人反伤 2 伤
    expect(ctx.player.hp).toBe(playerBefore - 3)
    expect(ctx.enemies[0]!.hp).toBe(enemyBefore - 2)
  })
})

describe('效果链：活力（vigor）', () => {
  it('攻击伤害 + 层数后消耗活力状态', () => {
    const ctx = makeCtx()
    addStatus(ctx.player, 'vigor', 3)
    const enemyBefore = ctx.enemies[0]!.hp
    resolveEffectChain(ctx, [{ type: 'damage', target: 'enemy', amount: 1 }])
    // 伤害 = 1(基础) + 3(活力) = 4；活力用后清空
    expect(ctx.enemies[0]!.hp).toBe(enemyBefore - 4)
    expect(getStatusAmount(ctx.player, 'vigor')).toBe(0)
  })
})

describe('被动能力卡：黑暗之拥 / 恶魔形态', () => {
  it('黑暗之拥：有牌被消耗时抽 1 张', () => {
    const ctx = makeCtx()
    ctx.powers.set('dark_embrace', false)
    ctx.drawPile = [{ id: 'strike_ironclad', upgrade: false }]
    ctx.hand = []
    onExhaustCard(ctx, { id: 'burning_pact', upgrade: false })
    expect(ctx.hand.length).toBe(1)
  })

  it('恶魔形态：回合开始获得 2 点力量（经 startPlayerTurn）', () => {
    const ctx = makeCtx()
    ctx.powers.set('demon_form', false)
    const strBefore = ctx.player.strength
    startPlayerTurn(ctx, 0)
    expect(ctx.player.strength).toBe(strBefore + 2)
  })
})

describe('效果链：横祸（playRandomFromDraw）', () => {
  it('从抽牌堆随机打出 count 张牌并结算', () => {
    const ctx = makeCtx()
    // 抽牌堆放 3 张打击（各 6 伤，敌 42 血），横祸打出 2 张
    ctx.drawPile = [1, 2, 3].map(() => ({ id: 'strike_ironclad', upgrade: false }))
    ctx.discardPile = []
    const before = ctx.enemies[0]!.hp
    resolveEffectChain(ctx, [{ type: 'playRandomFromDraw', count: 2 }])
    expect(ctx.enemies[0]!.hp).toBe(before - 12)
    // 打出的牌进入弃牌堆（本局没有通用弃牌钩子干扰时），抽牌堆剩余 1 张
    expect(ctx.drawPile.length).toBe(1)
    expect(ctx.discardPile.length).toBe(2)
  })
})

describe('效果链：狠揍（playRandomAttacksFromDiscard）', () => {
  it('从弃牌堆随机打出 count 张随机攻击牌', () => {
    const ctx = makeCtx()
    ctx.discardPile = [
      { id: 'strike_ironclad', upgrade: false },
      { id: 'bash', upgrade: false },
    ]
    ctx.hand = []
    const before = ctx.enemies[0]!.hp
    resolveEffectChain(ctx, [{ type: 'playRandomAttacksFromDiscard', count: 3 }])
    // 两张攻击牌各结算一次（打击 6 + 重击 8 = 14 伤），共 2 张（不足 3 张取全部）
    expect(ctx.enemies[0]!.hp).toBe(before - 14)
    // 重放的非消耗攻击牌结算后回到弃牌堆（各 1 张）
    expect(ctx.discardPile.length).toBe(2)
  })
})

describe('无色能力卡被动生效', () => {
  it('准备时间：回合开始获得 4 点活力（经 startPlayerTurn）', () => {
    const ctx = makeCtx()
    ctx.powers.set('prep_time', false)
    startPlayerTurn(ctx, 0)
    expect(getStatusAmount(ctx.player, 'vigor')).toBe(4)
  })

  it('熵：回合开始时将手牌中随机 1 张牌变化成随机攻击牌', () => {
    const ctx = makeCtx()
    ctx.powers.set('entropy', false)
    ctx.hand = [{ id: 'defend_ironclad', upgrade: false }]
    startPlayerTurn(ctx, 0)
    const card = getCard(ctx.hand[0]!.id)
    // 手牌中的"防御"已被变化（仍是 1 张，id 变为某张攻击牌）
    expect(ctx.hand.length).toBe(1)
    expect(card?.type).toBe('attack')
  })

  it('乱战：回合开始时打出抽牌堆顶部的牌', () => {
    const ctx = makeCtx()
    ctx.powers.set('melee', false)
    // 抽牌堆 1 张打击，弃牌堆 1 张防御（洗回兜底）
    ctx.drawPile = [{ id: 'strike_ironclad', upgrade: false }]
    const before = ctx.enemies[0]!.hp
    startPlayerTurn(ctx, 0)
    // 乱战打出顶部的打击造成 6 伤
    expect(ctx.enemies[0]!.hp).toBe(before - 6)
  })
})
