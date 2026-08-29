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
      ],
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
    playCard(ctx, strike, e.id)
    expect(e.hp).toBe(hpBefore - 6)
  })
})
