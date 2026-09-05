/**
 * 敌人回合回归测试（用户反馈：怪物意图不生效、不掉血、不上 buff）
 * 根因：parseEffects 未处理敌人文档空格（"造成 4 点伤害"），effects 全空
 */
import { describe, it, expect } from 'vitest'
import {
  createCombatContext,
  startCombat,
  setEnemyIntents,
  enemyTurn,
  playCard,
} from '@/engine/combatEngine'
import { buildEnemyUnit } from '@/engine/enemyAI'
import { getEnemy } from '@/data'
import type { Card } from '@/types'

function makeCtx(): ReturnType<typeof createCombatContext> {
  const def = getEnemy('fuzzy_wurm_crawler')!
  const unit = buildEnemyUnit(def, 55, () => 0.5)
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
      ].map((id) => ({ id, upgrade: false })), // 牌组实例：默认未升级
    },
    [{ id: unit.id, name: unit.name, hp: 55, maxHp: 55 }],
    () => 0.5,
  )
  ctx.enemies = [unit]
  startCombat(ctx)
  return ctx
}

describe('敌人回合：意图必须生效', () => {
  it('怪物攻击：玩家掉血', () => {
    const ctx = makeCtx()
    setEnemyIntents(ctx)
    const hpBefore = ctx.player.hp
    enemyTurn(ctx)
    // 毛绒伏地虫第 1 回合：酸液黏球 4 点伤害
    expect(ctx.player.hp).toBe(hpBefore - 4)
  })

  it('怪物 buff（吸入）：获得 7 点力量', () => {
    const ctx = makeCtx()
    const e = ctx.enemies[0]!
    // 强制意图为"吸入"
    e.intentName = '吸入'
    const strBefore = e.strength
    enemyTurn(ctx)
    expect(e.strength).toBe(strBefore + 7)
  })

  it('敌人意图攻击有伤害数值（UI 显示）', () => {
    const ctx = makeCtx()
    setEnemyIntents(ctx)
    expect(ctx.enemies[0]!.intentType).toBe('attack')
    expect(ctx.enemies[0]!.intentDamage).toBe(4)
  })

  it('玩家攻击怪物：怪物掉血', () => {
    const ctx = makeCtx()
    setEnemyIntents(ctx)
    const strike: Card = {
      id: 'strike_ironclad',
      name: '打击',
      cost: 1,
      type: 'attack',
      rarity: 'basic',
      desc: '造成 6 点伤害',
      upgradeDesc: '',
      keywords: [],
      effects: [{ type: 'damage', target: 'enemy', amount: 6 }],
      upgradeEffects: [],
    }
    const e = ctx.enemies[0]!
    const hpBefore = e.hp
    playCard(ctx, { id: strike.id, upgrade: false }, e.id)
    expect(e.hp).toBe(hpBefore - 6)
  })

  it('招式冷却：出招后置冷却，下一回合该招不可选（防连发）', () => {
    const ctx = makeCtx()
    const e = ctx.enemies[0]!
    e.ai = {
      mode: 'weighted',
      sequence: ['拍击', '啃咬'],
      weights: { 拍击: 1, 啃咬: 1 },
      cooldowns: { 拍击: 1 }, // 拍击使用后冷却 1 回合
    }
    e.moves = {
      拍击: {
        name: '拍击',
        intent: 'attack',
        damage: 5,
        effects: [{ type: 'damage', target: 'enemy', amount: 5 }],
        desc: '造成 5 点伤害',
      },
      啃咬: {
        name: '啃咬',
        intent: 'attack',
        damage: 3,
        effects: [{ type: 'damage', target: 'enemy', amount: 3 }],
        desc: '造成 3 点伤害',
      },
    }
    // 第一回合：两招均可用，rng 固定 0.5 → 选到"拍击"
    setEnemyIntents(ctx)
    expect(e.intentName).toBe('拍击')
    // 出招：拍击进入冷却（cd=1）
    enemyTurn(ctx)
    expect(e.cooldowns?.['拍击']).toBe(1)
    // 第二回合意图：拍击冷却中，只能选"啃咬"
    setEnemyIntents(ctx)
    expect(e.intentName).toBe('啃咬')
  })
})
