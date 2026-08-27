/**
 * 战斗引擎测试（agent.md §6：回合/伤害/能量必须覆盖）
 * 覆盖：伤害公式（PRD §3.3.3）、意图循环、回合流转、能量消耗
 */
import { describe, it, expect } from 'vitest'
import {
  createCombatContext,
  startCombat,
  playCard,
  enemyTurn,
  checkResult,
  setEnemyIntents,
} from '@/engine/combatEngine'
import { resolveIntent } from '@/engine/enemyAI'
import type { CombatContext, CombatUnit } from '@/engine/combatEngine'
import type { Card } from '@/types'

// 构造带 AI 的战斗上下文（毛绒伏地虫：酸液黏球↔吸入循环；牌组 10 张保证开局抽满 5 张）
function makeCtx(): CombatContext {
  const ctx = createCombatContext(
    {
      id: 'p',
      name: '铁甲战士',
      hp: 80,
      maxHp: 80,
      deck: [
        'strike_ironclad',
        'strike_ironclad',
        'strike_ironclad',
        'strike_ironclad',
        'strike_ironclad',
        'defend_ironclad',
        'defend_ironclad',
        'defend_ironclad',
        'defend_ironclad',
        'bash',
      ],
    },
    [{ id: 'fuzzy_wurm_crawler', name: '毛绒伏地虫', hp: 55, maxHp: 55 }],
    () => 0.5,
  )
  const enemy = ctx.enemies[0]!
  enemy.ai = {
    mode: 'loop',
    sequence: ['酸液黏球', '吸入'],
  }
  enemy.moves = {
    酸液黏球: {
      name: '酸液黏球',
      intent: 'attack',
      damage: 4,
      effects: [{ type: 'damage', target: 'enemy', amount: 4 }],
      desc: '造成 4 点伤害',
    },
    吸入: {
      name: '吸入',
      intent: 'buff',
      effects: [{ type: 'applyStatus', target: 'self', status: 'strength', amount: 7 }],
      desc: '获得 7 点力量',
    },
  }
  startCombat(ctx)
  return ctx
}

// 构造打击卡
const strike: Card = {
  id: 'strike_ironclad',
  name: '打击',
  cost: 1,
  type: 'attack',
  rarity: 'basic',
  desc: '造成6点伤害。',
  upgradeDesc: '造成9点伤害。',
  effects: [{ type: 'damage', target: 'enemy', amount: 6 }],
  upgradeEffects: [{ type: 'damage', target: 'enemy', amount: 9 }],
  keywords: [],
}

describe('战斗引擎：意图循环', () => {
  it('loop 模式：按序列循环解析意图', () => {
    const e = { ai: { mode: 'loop', sequence: ['酸液黏球', '吸入'] }, turnCount: 0 } as CombatUnit
    expect(resolveIntent(e, () => 0.5).name).toBe('酸液黏球')
    e.turnCount = 1
    expect(resolveIntent(e, () => 0.5).name).toBe('吸入')
    e.turnCount = 2
    expect(resolveIntent(e, () => 0.5).name).toBe('酸液黏球') // 循环回第一招
  })

  it('setEnemyIntents：填充敌人意图字段', () => {
    const ctx = makeCtx()
    setEnemyIntents(ctx)
    expect(ctx.enemies[0]!.intentName).toBe('酸液黏球')
    expect(ctx.enemies[0]!.intentDamage).toBe(4)
  })
})

describe('战斗引擎：玩家回合', () => {
  it('开局抽牌并获得能量（PRD §3.3.4）', () => {
    const ctx = makeCtx()
    expect(ctx.energy).toBe(3)
    expect(ctx.hand.length).toBe(5)
  })

  it('打出打击：扣能量 + 造成伤害 + 进入弃牌堆', () => {
    const ctx = makeCtx()
    const enemy = ctx.enemies[0]!
    const before = enemy.hp
    const ok = playCard(ctx, strike, enemy.id)
    expect(ok).toBe(true)
    expect(ctx.energy).toBe(2)
    expect(enemy.hp).toBe(before - 6)
    expect(ctx.discardPile).toContain('strike_ironclad')
  })

  it('能量不足时无法出牌', () => {
    const ctx = makeCtx()
    ctx.energy = 0
    const ok = playCard(ctx, strike)
    expect(ok).toBe(false)
  })

  it('敌人回合：按意图行动并计数', () => {
    const ctx = makeCtx()
    setEnemyIntents(ctx)
    const hpBefore = ctx.player.hp
    enemyTurn(ctx)
    // 第一回合意图为酸液黏球（4 点伤害）
    expect(ctx.player.hp).toBe(hpBefore - 4)
    expect(ctx.enemies[0]!.turnCount).toBe(1)
  })
})

describe('战斗引擎：胜负判定', () => {
  it('敌人全灭 = 胜利', () => {
    const ctx = makeCtx()
    ctx.enemies[0]!.hp = 0
    ctx.enemies[0]!.alive = false
    const r = checkResult(ctx)
    expect(r.status).toBe('victory')
  })

  it('玩家死亡 = 失败', () => {
    const ctx = makeCtx()
    ctx.player.hp = 0
    const r = checkResult(ctx)
    expect(r.status).toBe('defeat')
  })

  it('双方存活 = 进行中', () => {
    const ctx = makeCtx()
    expect(checkResult(ctx).status).toBe('running')
  })
})
