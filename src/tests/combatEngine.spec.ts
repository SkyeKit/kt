/**
 * 战斗引擎测试（agent.md §6：回合/伤害/能量必须覆盖）
 * 覆盖：伤害公式（PRD §3.3.3）、意图循环、回合流转、能量消耗
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  createCombatContext,
  startCombat,
  playCard,
  enemyTurn,
  checkResult,
  setEnemyIntents,
  endOfTurn,
  resolveHandEndOfTurn,
  startPlayerTurn,
} from '@/engine/combatEngine'
import { resolveIntent } from '@/engine/enemyAI'
import { resolveEffectChain, drawCards, addStatus, getStatusAmount } from '@/engine/effectEngine'
import { getCard } from '@/data'
import type { CombatContext, CombatUnit } from '@/engine/combatEngine'

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
      ].map((id) => ({ id, upgrade: false })), // 牌组实例：默认均未升级
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

  it('打出打击：扣能量 + 造成伤害 + 手牌移除 + 进入弃牌堆', () => {
    const ctx = makeCtx()
    const enemy = ctx.enemies[0]!
    const before = enemy.hp
    const handBefore = ctx.hand.length
    // 手牌打出的为卡实例：strike 升级前打出（伤害 6）
    const ok = playCard(ctx, { id: 'strike_ironclad', upgrade: false }, enemy.id)
    expect(ok).toBe(true)
    expect(ctx.energy).toBe(2)
    expect(enemy.hp).toBe(before - 6)
    // 手牌应移除已打出的牌（防"卡牌重复使用"回归）
    expect(ctx.hand.length).toBe(handBefore - 1)
    expect(ctx.discardPile).toContainEqual({ id: 'strike_ironclad', upgrade: false })
  })

  it('能量不足时无法出牌', () => {
    const ctx = makeCtx()
    ctx.energy = 0
    const ok = playCard(ctx, { id: 'strike_ironclad', upgrade: false })
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

describe('战斗引擎：红头骨条件型力量（回归：勿逐回合累加）', () => {
  // 10 张牌保证开局抽满 5 张；携带红头骨遗物
  function makeCtxWithRedSkull(hp: number): CombatContext {
    return createCombatContext(
      {
        id: 'p',
        name: '铁甲战士',
        hp,
        maxHp: 80,
        deck: Array.from({ length: 10 }, () => ({ id: 'strike_ironclad', upgrade: false })),
        relics: ['red_skull'],
      },
      [{ id: 'fuzzy_wurm_crawler', name: '毛绒伏地虫', hp: 55, maxHp: 55 }],
      () => 0.5,
    )
  }

  it('低血恒定 +3 力量不累加；回血后回退', () => {
    const ctx = makeCtxWithRedSkull(40) // 40/80=50% ≤50% 视为低血
    startPlayerTurn(ctx, 5)
    expect(ctx.player.strength).toBe(3)
    // 仍低血：不应再次 +3（原 bug 会累加为 6）
    startPlayerTurn(ctx, 5)
    expect(ctx.player.strength).toBe(3)
    // 回血超 50%：应扣回 3 点力量
    ctx.player.hp = 60
    startPlayerTurn(ctx, 5)
    expect(ctx.player.strength).toBe(0)
  })
})

describe('战斗引擎：附魔伤害结算（document/enchantments.md 语义）', () => {
  // 附魔挂在卡"数据"上（applyEnchant 对共享数据卡打补丁，MVP 简化）；每次测试前重置，避免串扰
  afterEach(() => {
    const dc = getCard('strike_ironclad')
    if (dc) dc.enchantments = []
  })

  it('锋利：打击附魔后伤害 +3（6→9）', () => {
    const ctx = makeCtx()
    getCard('strike_ironclad')!.enchantments = ['sharp']
    const hpBefore = ctx.enemies[0]!.hp
    playCard(ctx, { id: 'strike_ironclad', upgrade: false }, ctx.enemies[0]!.id)
    // 基础 6 + 锋利 3 = 9
    expect(ctx.enemies[0]!.hp).toBe(hpBefore - 9)
  })

  it('神秘打火机：有附魔的攻击牌额外造成 9 点伤害', () => {
    const ctx = makeCtx()
    ctx.relics.push('mysterious_lighter')
    getCard('strike_ironclad')!.enchantments = ['adroit'] // 伶俐只加格挡，不叠伤害
    const hpBefore = ctx.enemies[0]!.hp
    playCard(ctx, { id: 'strike_ironclad', upgrade: false }, ctx.enemies[0]!.id)
    // 基础 6 + 神秘打火机 9 = 15（伶俐的格挡加成不改变伤害）
    expect(ctx.enemies[0]!.hp).toBe(hpBefore - 15)
  })

  it('腐化：伤害 ×1.5（6→9）且打出后失去 2 生命', () => {
    const ctx = makeCtx()
    getCard('strike_ironclad')!.enchantments = ['corrupted']
    const hpBefore = ctx.enemies[0]!.hp
    const playerHpBefore = ctx.player.hp
    playCard(ctx, { id: 'strike_ironclad', upgrade: false }, ctx.enemies[0]!.id)
    // 基础 6 × 1.5 = 9；玩家失去 2 生命
    expect(ctx.enemies[0]!.hp).toBe(hpBefore - 9)
    expect(ctx.player.hp).toBe(playerHpBefore - 2)
  })
})

describe('战斗引擎：复杂效果卡机制', () => {
  it('壁垒：回合结束格挡保留', () => {
    const ctx = makeCtx()
    ctx.player.block = 10
    ctx.powers.set('barricade', true)
    endOfTurn(ctx)
    expect(ctx.player.block).toBe(10)
  })

  it('坚定不移：每回合首次格挡翻倍', () => {
    const ctx = makeCtx()
    ctx.powers.set('adamant', true)
    resolveEffectChain(ctx, [{ type: 'block', amount: 6 }])
    expect(ctx.player.block).toBe(12)
    // 第二次不再翻倍
    resolveEffectChain(ctx, [{ type: 'block', amount: 2 }])
    expect(ctx.player.block).toBe(14)
  })

  it('连环拳：下一张攻击牌额外生效一次（伤害翻倍）', () => {
    const ctx = makeCtx()
    ctx.hand.push({ id: 'chain_punch', upgrade: false })
    playCard(ctx, { id: 'chain_punch', upgrade: false })
    expect(ctx.nextAttacksExtra).toBe(1)
    const hpBefore = ctx.enemies[0]!.hp
    playCard(ctx, { id: 'strike_ironclad', upgrade: false }, ctx.enemies[0]!.id)
    // 6 + 6 = 12；次数耗尽
    expect(ctx.enemies[0]!.hp).toBe(hpBefore - 12)
    expect(ctx.nextAttacksExtra).toBe(0)
  })

  it('杂耍：本回合打出第 3 张攻击牌时入手其复制品', () => {
    const ctx = makeCtx()
    ctx.powers.set('juggle', true)
    for (let i = 0; i < 3; i++) {
      playCard(ctx, { id: 'strike_ironclad', upgrade: false }, ctx.enemies[0]!.id)
    }
    // 初始 5 张 - 打出 3 张 + 杂耍复制 1 张 = 3 张在手
    expect(ctx.hand.length).toBe(3)
  })

  it('好勇斗狠：回合开始从弃牌堆拾取一张随机攻击牌并升级', () => {
    const ctx = makeCtx()
    ctx.discardPile = [{ id: 'strike_ironclad', upgrade: false }]
    ctx.hand = []
    // 手动进入新回合以触发能力（保留回合级计数器重置逻辑）
    ctx.powers.set('bravado', true)
    startPlayerTurn(ctx, 0)
    // 从弃牌堆拾取一张并升级，弃牌堆取空
    expect(ctx.hand.length).toBe(1)
    expect(ctx.discardPile.length).toBe(0)
    expect(ctx.hand[0]!.upgrade).toBe(true)
  })

  it('惊逃：回合结束随机打出手中一张攻击牌', () => {
    const ctx = makeCtx()
    ctx.powers.set('frighten', true)
    ctx.hand = [{ id: 'strike_ironclad', upgrade: false }]
    const hpBefore = ctx.enemies[0]!.hp
    resolveHandEndOfTurn(ctx)
    // 惊逃自动打出：6 点伤害，且该牌已出手
    expect(ctx.enemies[0]!.hp).toBe(hpBefore - 6)
    expect(ctx.hand.length).toBe(0)
    expect(ctx.discardPile.length).toBe(1)
  })

  it('地狱狂徒：抽到"打击"自动打出攻击随机敌人', () => {
    const ctx = makeCtx()
    ctx.powers.set('hell_zealot', true)
    ctx.hand = []
    ctx.drawPile = [{ id: 'strike_ironclad', upgrade: false }]
    const hpBefore = ctx.enemies[0]!.hp
    drawCards(ctx, 1)
    // 抽到的打击被自动打出：6 点伤害，手牌清空，进入弃牌堆
    expect(ctx.enemies[0]!.hp).toBe(hpBefore - 6)
    expect(ctx.hand.length).toBe(0)
    expect(ctx.discardPile.length).toBe(1)
  })

  it('全身撞击：造成当前格挡值伤害', () => {
    const ctx = makeCtx()
    ctx.player.block = 7
    ctx.hand.push({ id: 'body_slam', upgrade: false })
    const hpBefore = ctx.enemies[0]!.hp
    playCard(ctx, { id: 'body_slam', upgrade: false }, ctx.enemies[0]!.id)
    // 格挡 7 点伤害，费用 1
    expect(ctx.enemies[0]!.hp).toBe(hpBefore - 7)
    expect(ctx.energy).toBe(2)
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

describe('战斗引擎：怪物专属机制（未实现子系统补齐）', () => {
  it('紧缠：回合结束时玩家受到层数点伤害', () => {
    const ctx = makeCtx()
    const hpBefore = ctx.player.hp
    addStatus(ctx.player, 'constricted', 3)
    endOfTurn(ctx)
    expect(ctx.player.hp).toBe(hpBefore - 3)
  })

  it('缠结：玩家攻击牌耗能 +1', () => {
    const ctx = makeCtx()
    addStatus(ctx.player, 'tangled', 1)
    // 打击基础 1 费 + 缠结 1 费 = 2 费
    expect(playCard(ctx, { id: 'strike_ironclad', upgrade: false }, ctx.enemies[0]!.id)).toBe(true)
    expect(ctx.energy).toBe(1)
  })

  it('昏眩：本回合只能打出 1 张牌', () => {
    const ctx = makeCtx()
    addStatus(ctx.player, 'ringing', 1)
    // 第一张打击可打出
    expect(playCard(ctx, { id: 'strike_ironclad', upgrade: false }, ctx.enemies[0]!.id)).toBe(true)
    // 第二张被昏眩拦截（能量仍剩 2 足够，但被限制）
    expect(playCard(ctx, { id: 'strike_ironclad', upgrade: false }, ctx.enemies[0]!.id)).toBe(false)
    // 能量只扣了第一张的 1 费
    expect(ctx.energy).toBe(2)
  })

  it('召唤：spawnEnemy 效果登入一只利齿之眼', () => {
    const ctx = makeCtx()
    const before = ctx.enemies.length
    resolveEffectChain(ctx, [{ type: 'spawnEnemy', enemyId: 'eye_with_teeth' }])
    expect(ctx.enemies.length).toBe(before + 1)
    expect(ctx.enemies[before]!.name).toBe('利齿之眼')
  })

  it('横冲直撞：仪式兽血量≤层数时被击晕并重置力量', () => {
    const ctx = makeCtx()
    const e = ctx.enemies[0]!
    e.ai = { mode: 'scripted', sequence: ['跺地', '横冲直撞'] }
    addStatus(e, 'rampage', 150)
    e.strength = 5
    e.hp = 100 // ≤150 触发
    // 先设意图为跺地，敌人回合触发阶段切换
    setEnemyIntents(ctx)
    enemyTurn(ctx)
    expect(getStatusAmount(e, 'rampage')).toBe(0)
    expect(e.strength).toBe(0)
    // 已被击晕（本回合消耗）且 AI 切换为阶段二狂暴循环
    expect(e.ai.mode).toBe('loop')
    expect(e.ai.sequence).toEqual(['野兽咆哮', '踩踏', '碾碎'])
  })

  it('无情猛攻：打出的下一张攻击牌耗能变为 0', () => {
    const ctx = makeCtx()
    // 玩家先打出无情猛攻（攻击牌，14 伤），登记 nextAttackFree = 1
    expect(playCard(ctx, { id: 'relentless_assault', upgrade: false }, ctx.enemies[0]!.id)).toBe(
      true,
    )
    expect(ctx.nextAttackFree).toBe(1)
    const energyBefore = ctx.energy
    // 下一张攻击牌免费打出，不扣能量
    expect(playCard(ctx, { id: 'strike_ironclad', upgrade: false }, ctx.enemies[0]!.id)).toBe(true)
    expect(ctx.energy).toBe(energyBefore)
    expect(ctx.nextAttackFree).toBe(0)
  })

  it('腐化：技能牌耗能 0 且打出即消耗', () => {
    const ctx = makeCtx()
    ctx.hand = []
    ctx.discardPile = []
    // 腐化是能力卡，打出即登记 power
    expect(playCard(ctx, { id: 'corruption', upgrade: false })).toBe(true)
    // 之后打出技能牌：耗能为 0（腐化技能 0 费），且进入消耗堆而非弃牌堆
    expect(playCard(ctx, { id: 'defend_ironclad', upgrade: false })).toBe(true)
    expect(ctx.exhaustPile.some((c) => c.id === 'defend_ironclad')).toBe(true)
    expect(ctx.discardPile.some((c) => c.id === 'defend_ironclad')).toBe(false)
  })

  it('覆甲：每回合开始将当前层数转为本回合格挡并递减（岩石铠甲/永恒铠甲/护喉甲）', () => {
    const ctx = makeCtx()
    // 同时覆盖 statuses 层 armor（岩石铠甲）与 unit.armor 字段（护喉甲）
    addStatus(ctx.player, 'armor', 2)
    ctx.player.armor = 2
    ctx.player.block = 0
    startPlayerTurn(ctx, 0)
    // 转格挡 = 2(statuses) + 2(字段) = 4；各自递减 1 → 剩 1 + 1
    expect(ctx.player.block).toBe(4)
    expect(getStatusAmount(ctx.player, 'armor')).toBe(1)
    expect(ctx.player.armor).toBe(1)
  })

  it('仪式：敌人回合开始获得等同层数的力量（暗港念咒敌人）', () => {
    const ctx = makeCtx()
    addStatus(ctx.enemies[0]!, 'ritual', 2)
    const sBefore = ctx.enemies[0]!.strength
    enemyTurn(ctx)
    expect(ctx.enemies[0]!.strength).toBe(sBefore + 2)
  })
})
