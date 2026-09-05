/**
 * 暗港（Underdocks）专属机制单元测试（Underdocks.md §3/§4）
 * 覆盖：烟雾弥漫(限技能)、覆甲(回合格挡+递减)、硬化外壳(每回合伤害封顶)、吮吸(伤获力)、
 * 尖叫(半血眩晕)、蒸汽喷发(归零不死+下回合自爆)、人工制品(抵消负面)、死亡召唤(意外)。
 */
import { describe, it, expect } from 'vitest'
import { createCombatContext, startCombat, enemyTurn } from '@/engine/combatEngine'
import { addStatus, resolveEffectChain, getStatusAmount } from '@/engine/effectEngine'
import { buildEnemyUnit, resolveIntent, uniqueEnemyId } from '@/engine/enemyAI'
import { getEnemy } from '@/data'
import type { CombatContext, CombatUnit } from '@/engine/combatEngine'

// 构造含指定敌人的战斗上下文（敌人在战斗开始时装载其 initialStatuses）
function makeCtx(enemy: CombatUnit): ReturnType<typeof createCombatContext> {
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
      ].map((id) => ({ id, upgrade: false })),
    },
    [{ id: enemy.id, name: enemy.name, hp: enemy.hp, maxHp: enemy.maxHp }],
    () => 0.5,
  )
  ctx.enemies = [enemy]
  startCombat(ctx)
  return ctx
}

describe('烟雾弥漫（smoggy）：玩家每回合只能打出 1 张技能牌', () => {
  it('限制技能牌，不限制攻击牌', () => {
    const def = getEnemy('living_fog')!
    const unit = buildEnemyUnit(def, 80, () => 0.5)
    const ctx = makeCtx(unit)
    addStatus(ctx.player, 'smoggy', 1)
    ctx.energy = 3
    // 第一张技能牌（防御）允许打出
    const defend = { id: 'defend_ironclad', upgrade: false }
    expect(playCardCtx(ctx, defend)).toBe(true)
    // 第二张技能牌被烟雾弥漫拦下
    expect(playCardCtx(ctx, defend)).toBe(false)
    // 攻击牌不受限制
    const strike = { id: 'strike_ironclad', upgrade: false }
    ctx.energy = 3
    expect(playCardCtx(ctx, strike, unit.id)).toBe(true)
  })
})

describe('覆甲（plating）：回合结束时获格挡、回合开始时层数减 1', () => {
  it('下水道蚌：开始减层，结束获等量格挡', () => {
    const def = getEnemy('sewer_clam')!
    const unit = buildEnemyUnit(def, 56, () => 0.5)
    const ctx = makeCtx(unit)
    expect(getStatusAmount(unit, 'plating')).toBe(8)
    enemyTurn(ctx)
    // 回合开始 8→7，回合结束按当前 7 获格挡
    expect(getStatusAmount(unit, 'plating')).toBe(7)
    expect(unit.block).toBe(7)
  })
})

describe('硬化外壳（hard_shell）：每回合失去的生命不超过层数', () => {
  it('一次造成 30 点伤害，本回合只损失 20', () => {
    const def = getEnemy('skulking_colony')!
    const unit = buildEnemyUnit(def, 75, () => 0.5)
    const ctx = makeCtx(unit)
    resolveEffectChain(ctx, [{ type: 'damage', target: 'enemy', amount: 30 }], {
      targetId: unit.id,
    })
    expect(unit.hp).toBe(75 - 20)
    // 进入下一回合：重置封顶计数后可再次攻击
    startPlayerTurnCtx(ctx)
    resolveEffectChain(ctx, [{ type: 'damage', target: 'enemy', amount: 30 }], {
      targetId: unit.id,
    })
    expect(unit.hp).toBe(75 - 40)
  })
})

describe('吮吸（suck）：造成未被格挡伤害时获得力量', () => {
  it('化石追踪者：对无格挡玩家造成伤害后 +3 力量', () => {
    const def = getEnemy('fossil_stalker')!
    const unit = buildEnemyUnit(def, 52, () => 0.5)
    const ctx = makeCtx(unit)
    expect(getStatusAmount(unit, 'suck')).toBe(3)
    unit.intentName = '缠上' // 12 点伤害
    const strBefore = unit.strength
    enemyTurn(ctx)
    expect(unit.strength).toBe(strBefore + 3)
  })
})

describe('尖叫（shriek）：血量降至一半时眩晕一回合', () => {
  it('骇鳗：掉到 70 以下后跳过一回合', () => {
    const def = getEnemy('terror_eel')!
    const unit = buildEnemyUnit(def, 140, () => 0.5)
    const ctx = makeCtx(unit)
    expect(getStatusAmount(unit, 'shriek')).toBe(70)
    resolveEffectChain(ctx, [{ type: 'damage', target: 'enemy', amount: 80 }], {
      targetId: unit.id,
    })
    expect(unit.hp).toBe(60)
    enemyTurn(ctx)
    // 尖叫已触发清除，且本回合被眩晕，未对玩家造成伤害
    expect(getStatusAmount(unit, 'shriek')).toBe(0)
    expect(ctx.player.hp).toBe(80)
  })
})

describe('蒸汽喷发（steam）：归零不死，下回合自爆', () => {
  it('瀑布巨兽：首次归零回满，下一回合自爆造成层数伤害', () => {
    const def = getEnemy('waterfall_giant')!
    const unit = buildEnemyUnit(def, 240, () => 0.5)
    const ctx = makeCtx(unit)
    addStatus(unit, 'steam', 15)
    resolveEffectChain(ctx, [{ type: 'damage', target: 'enemy', amount: 999 }], {
      targetId: unit.id,
    })
    // 首次归零未死
    expect(unit.alive).toBe(true)
    expect(unit.steamTriggered).toBe(true)
    const hpBefore = ctx.player.hp
    enemyTurn(ctx)
    // 自爆：对玩家造成 15 点伤害后死亡
    expect(ctx.player.hp).toBe(hpBefore - 15)
    expect(unit.alive).toBe(false)
  })
})

describe('人工制品（artifact）：抵消 1 次负面状态', () => {
  it('拳击构装体：首次施加负面被抵消，之后正常生效', () => {
    const def = getEnemy('punch_construct')!
    const unit = buildEnemyUnit(def, 55, () => 0.5)
    const ctx = makeCtx(unit)
    expect(getStatusAmount(unit, 'artifact')).toBe(1)
    resolveEffectChain(
      ctx,
      [{ type: 'applyStatus', target: 'enemy', status: 'vulnerable', amount: 2 }],
      {
        targetId: unit.id,
      },
    )
    expect(getStatusAmount(unit, 'vulnerable')).toBe(0)
    expect(getStatusAmount(unit, 'artifact')).toBe(0)
    // 第二次施加正常生效
    resolveEffectChain(
      ctx,
      [{ type: 'applyStatus', target: 'enemy', status: 'vulnerable', amount: 2 }],
      {
        targetId: unit.id,
      },
    )
    expect(getStatusAmount(unit, 'vulnerable')).toBe(2)
  })
})

describe('死亡召唤（意外）：死亡时召唤衍生物', () => {
  it('地精佣兵：死亡后召唤胖地精与卑鄙地精', () => {
    const def = getEnemy('gremlin_mercenary')!
    const unit = buildEnemyUnit(def, 48, () => 0.5)
    const ctx = makeCtx(unit)
    resolveEffectChain(ctx, [{ type: 'damage', target: 'enemy', amount: 999 }], {
      targetId: unit.id,
    })
    expect(unit.alive).toBe(false)
    expect(ctx.enemies.some((e) => e.id === 'fat_gremlin')).toBe(true)
    expect(ctx.enemies.some((e) => e.id === 'sneaky_gremlin')).toBe(true)
  })
})

// 多胞胎意图解析回归：weighted 模式且 sequence 为空的怪物，意图必须解析出真实招式（非空）
describe('weighted 空序列（防意图失效）：sequence 为空时按 weights 键随机', () => {
  it('噬尸蛞蝓每次都能解析出 鞭打/扑上/黏液 之一', () => {
    const def = getEnemy('corpse_slug')!
    for (let t = 0; t < 10; t++) {
      const res = resolveIntent({ ai: def.ai, turnCount: t }, () => 0.3)
      expect(['鞭打', '扑上', '黏液']).toContain(res.name)
    }
  })
  it('双尾鼠能解析出含"呼唤后援"在内的招式', () => {
    const def = getEnemy('two_tailed_rat')!
    const res = resolveIntent({ ai: def.ai, turnCount: 0 }, () => 0.9)
    expect(['抓挠', '疾病啃咬', '尖声嘶吼', '呼唤后援']).toContain(res.name)
  })
})

// 敌人实例 id 唯一化回归：多胞胎（同 def 复现）id 须唯一，否则拖拽选目标与效果定位失效
describe('uniqueEnemyId：多胞胎敌人 id 唯一', () => {
  it('toadpole×2 生成 toadpole 与 toadpole_2', () => {
    const taken = new Set<string>()
    const ids: string[] = []
    for (let i = 0; i < 2; i++) {
      const id = uniqueEnemyId('toadpole', (x) => taken.has(x))
      taken.add(id)
      ids.push(id)
    }
    expect(new Set(ids).size).toBe(2)
    expect(ids[0]).toBe('toadpole')
    expect(ids[1]).toBe('toadpole_2')
  })
})

// --- 易用封装（避免在用例里重复 import） ---
import { playCard as playCardImpl, startPlayerTurn } from '@/engine/combatEngine'
function playCardCtx(
  ctx: CombatContext,
  entry: { id: string; upgrade: boolean },
  targetId?: string,
): boolean {
  return playCardImpl(ctx, entry as never, targetId)
}
function startPlayerTurnCtx(ctx: CombatContext): void {
  startPlayerTurn(ctx)
}
