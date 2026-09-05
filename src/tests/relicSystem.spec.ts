/**
 * 遗物系统测试（agent.md §6：新增效果/修复战斗 bug 必须补测试）
 * 覆盖：回合开始（灯笼/硫磺/冰淇淋结转）、回合结束（历石/坚固钳子）、
 *      受伤（百年积木）、打出攻击（钢笔尖/损毁头盔）、消耗（卡戎之灰）、
 *      击杀（地精之角）、纸蛙倍率
 */
import { describe, it, expect } from 'vitest'
import {
  createCombatContext,
  startCombat,
  playCard,
  enemyTurn,
  startPlayerTurn,
} from '@/engine/combatEngine'
import { drawCards } from '@/engine/effectEngine'
import { applyRelicsBeforePlayerTurn } from '@/engine/relicSystem'
import type { CombatContext, CombatUnit } from '@/engine/combatEngine'
import type { Card } from '@/types'

// 构造带 AI 的战斗上下文（敌人"待机"不反伤，便于断言力量/能量；relics 传参指定测试遗物）
function makeCtx(relics: string[]): CombatContext {
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
      relics,
    },
    [{ id: 'fuzzy_wurm_crawler', name: '毛绒伏地虫', hp: 200, maxHp: 200 }],
    () => 0.5,
  )
  const enemy = ctx.enemies[0]!
  enemy.ai = { mode: 'loop', sequence: ['待机'] }
  enemy.moves = {
    待机: { name: '待机', intent: 'buff', effects: [], desc: '待机' },
    撕咬: {
      name: '撕咬',
      intent: 'attack',
      damage: 10,
      effects: [{ type: 'damage', target: 'enemy', amount: 10 }],
      desc: '造成 10 点伤害',
    },
  }
  startCombat(ctx)
  return ctx
}

// 打击：基础 6 伤
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

// 预备打击：造成 7 伤 + 获得 2 点力量（损毁头盔翻倍对象；对应 cards.json prep_strike）
const prepStrike: Card = {
  id: 'prep_strike',
  name: '预备打击',
  cost: 1,
  type: 'attack',
  rarity: 'common',
  desc: '造成7点伤害。获得2点力量。',
  upgradeDesc: '造成9点伤害。获得3点力量。',
  effects: [
    { type: 'damage', target: 'enemy', amount: 7 },
    { type: 'applyStatus', target: 'self', status: 'strength', amount: 2 },
  ],
  upgradeEffects: [
    { type: 'damage', target: 'enemy', amount: 9 },
    { type: 'applyStatus', target: 'self', status: 'strength', amount: 3 },
  ],
  keywords: [],
}

// 让敌人改为"撕咬"（对玩家造成 10 伤）驱动一回合，模拟玩家受到伤害
function makeEnemyAttack(ctx: CombatContext): CombatUnit {
  const e = ctx.enemies[0]!
  e.ai = { mode: 'loop', sequence: ['撕咬'] }
  e.intentName = '撕咬' // 直接指定意图，敌人本回合使用撕咬
  return e
}

describe('遗物：回合开始钩子', () => {
  it('灯笼：第一回合额外 1 点能量', () => {
    const ctx = makeCtx(['lantern'])
    expect(ctx.energy).toBe(4) // 基础 3 + 灯笼 1
  })

  it('硫磺：每回合己方 +2 力量、敌人 +1 力量', () => {
    const ctx = makeCtx(['brimstone'])
    expect(ctx.player.strength).toBe(2)
    expect(ctx.enemies[0]!.strength).toBe(1)
  })

  it('冰淇淋：剩余能量结转下一回合', () => {
    const ctx = makeCtx(['ice_cream'])
    // 第一回合结束时剩余 1 点能量 → 记录结转
    ctx.energy = 1
    enemyTurn(ctx) // endOfTurn 记录 ice_cream_carry = 1
    const carry = ctx.relicState['ice_cream_carry'] as number
    expect(carry).toBe(1)
    // 下一回合开始：在基础 3 能量之上再结转 1 点
    startPlayerTurn(ctx, 5)
    expect(ctx.energy).toBe(4)
  })
})

describe('遗物：回合结束钩子', () => {
  it('历石：第 7 回合结束时对所有敌人造成 52 伤', () => {
    const ctx = makeCtx(['stone_calendar'])
    ctx.turn = 7
    const hpBefore = ctx.enemies[0]!.hp
    enemyTurn(ctx) // 内部 endOfTurn 触发历石
    expect(ctx.enemies[0]!.hp).toBe(hpBefore - 52)
  })

  it('坚固钳子：跨回合保留最多 10 点格挡', () => {
    const ctx = makeCtx(['sturdy_clamp'])
    ctx.player.block = 14
    startPlayerTurn(ctx, 5) // 重置格挡前后寄存 min(14,10) → 归还 10
    expect(ctx.player.block).toBe(10)
  })
})

describe('遗物：受伤钩子', () => {
  it('百年积木：每场第一次受伤抽 3 张', () => {
    const ctx = makeCtx(['centennial_puzzle'])
    makeEnemyAttack(ctx)
    const handBefore = ctx.hand.length
    enemyTurn(ctx) // 敌人撕咬 10 伤，触发百年积木抽 3
    expect(ctx.hand.length).toBe(handBefore + 3)
  })
})

describe('遗物：打出攻击 / 消耗 / 击杀钩子', () => {
  it('钢笔尖：每第 10 张攻击牌伤害翻倍', () => {
    const ctx = makeCtx(['pen_nib'])
    const enemy = ctx.enemies[0]!
    ctx.energy = 10 // 预付足够能量，专注验证第 10 张翻倍
    // 连打 9 张（各 6 伤），第 10 张翻倍为 12 伤
    for (let i = 0; i < 9; i++) playCard(ctx, { id: strike.id, upgrade: false }, enemy.id)
    const hpAfter9 = enemy.hp
    playCard(ctx, { id: strike.id, upgrade: false }, enemy.id)
    expect(enemy.hp).toBe(hpAfter9 - 12)
  })

  it('卡戎之灰：消耗牌对全体敌人额外 3 伤', () => {
    const ctx = makeCtx(['charons_ashes'])
    const enemy = ctx.enemies[0]!
    const hpBefore = enemy.hp
    // 用数据中的消耗攻击牌"灰烬打击"(6 伤、带消耗关键词)验证钩子
    playCard(ctx, { id: 'ash_strike', upgrade: false }, enemy.id)
    expect(ctx.exhaustPile).toContainEqual({ id: 'ash_strike', upgrade: false })
    expect(enemy.hp).toBe(hpBefore - 9) // 灰烬打击 6 + 卡戎之灰 3
  })

  it('地精之角：敌人死亡 +1 能量并抽 1 张', () => {
    const ctx = makeCtx(['gremlin_horn'])
    const enemy = ctx.enemies[0]!
    enemy.hp = 6
    const handBefore = ctx.hand.length
    playCard(ctx, { id: strike.id, upgrade: false }, enemy.id) // 6 伤击杀（扣 1 费 + 地精之角 +1，净能量不变）
    expect(enemy.alive).toBe(false)
    expect(ctx.energy).toBe(3) // 起点 3 - 1 费 + 1 击杀回能 = 3
    // 手牌：打出的牌移除（-1）+ 地精之角抽 1（+1）= 净持平；若未触发则只剩 4 张
    expect(ctx.hand.length).toBe(handBefore)
  })

  it('损毁头盔：每场第一次获得力量翻倍', () => {
    const ctx = makeCtx(['broken_helmet'])
    playCard(ctx, { id: prepStrike.id, upgrade: false }, ctx.enemies[0]!.id) // 2 力量 → 翻倍 4
    expect(ctx.player.strength).toBe(4)
    playCard(ctx, { id: prepStrike.id, upgrade: false }, ctx.enemies[0]!.id) // 第二次 +2 不翻倍 → 共 6
    expect(ctx.player.strength).toBe(6)
  })
})

describe('遗物：大～抱抱洗牌钩子', () => {
  it('抽牌堆抽空洗回弃牌堆时，抽牌堆加入一张煤灰（大～抱抱）', () => {
    const ctx = makeCtx(['big_hug'])
    // 人为制造"抽牌堆抽空 + 弃牌堆有牌"的场景，触发洗回
    ctx.drawPile = []
    ctx.discardPile = [{ id: 'strike_ironclad', upgrade: false }]
    drawCards(ctx, 1)
    // 洗回后 soot 被 push 到抽牌堆顶部，本次 drawCards(1) 抽到的即煤灰
    expect(ctx.hand).toContainEqual({ id: 'soot', upgrade: false })
    // 原弃牌堆的打击仍在抽牌堆中（洗回但未被本次抽走）
    expect(ctx.drawPile).toContainEqual({ id: 'strike_ironclad', upgrade: false })
    // 无大～抱抱时，洗牌不额外加煤灰
    const ctrl = makeCtx([])
    ctrl.drawPile = []
    ctrl.discardPile = [{ id: 'strike_ironclad', upgrade: false }]
    drawCards(ctrl, 1)
    expect(ctrl.drawPile).not.toContainEqual({ id: 'soot', upgrade: false })
    expect(ctrl.hand).not.toContainEqual({ id: 'soot', upgrade: false })
  })
})

describe('遗物：纸蛙倍率', () => {
  it('有易伤敌人受到的伤害 ×1.75（而非 1.5）', () => {
    const ctx = makeCtx(['paper_frog'])
    const enemy = ctx.enemies[0]!
    enemy.statuses.push({ id: 'vulnerable', amount: 1, turns: 999 })
    const hpBefore = enemy.hp
    playCard(ctx, { id: strike.id, upgrade: false }, enemy.id) // 6 ×1.75 = 10.5 → 向下取整 10
    expect(enemy.hp).toBe(hpBefore - 10)
  })
})

describe('遗物：公式层（伤害/格挡加成）', () => {
  it('微型大炮：升级的攻击牌额外 3 伤（未升级不生效）', () => {
    const ctx = makeCtx(['micro_cannon'])
    const enemy = ctx.enemies[0]!
    // 未升级打击：6 伤不享受加成
    const hp1 = enemy.hp
    playCard(ctx, { id: strike.id, upgrade: false }, enemy.id)
    expect(enemy.hp).toBe(hp1 - 6)
    // 升级打击：9 + 3（微型大炮）= 12 伤
    const hp2 = enemy.hp
    playCard(ctx, { id: strike.id, upgrade: true }, enemy.id)
    expect(enemy.hp).toBe(hp2 - 12)
  })

  it('打击木偶：名字含"打击"的卡牌 +3 伤', () => {
    const ctx = makeCtx(['strike_dummy'])
    const enemy = ctx.enemies[0]!
    const hpBefore = enemy.hp
    playCard(ctx, { id: strike.id, upgrade: false }, enemy.id) // 6 + 3 = 9
    expect(enemy.hp).toBe(hpBefore - 9)
  })

  it('腰带扣：没有药水时额外 +2 敏捷（仅施加一次）', () => {
    // 无腰带扣的对照组：战斗开始无敏捷加成
    const base = makeCtx([])
    // makeCtx 内部的 startCombat 已调用回合开始钩子，此时应用了腰带扣 → 基础敏捷 0 + 2 = 2
    const ctx = makeCtx(['belt_buckle'])
    expect(ctx.player.dexterity).toBe(base.player.dexterity + 2)
    applyRelicsBeforePlayerTurn(ctx) // 再次触发不重复累加
    expect(ctx.player.dexterity).toBe(base.player.dexterity + 2)
  })

  it('发条靴：未格挡攻击伤害 ≤4 时提升为 5', () => {
    const ctx = makeCtx(['clockwork_boots'])
    const enemy = ctx.enemies[0]!
    enemy.block = 5 // 打击 6 伤：格挡挡下 5，未格挡仅 1 → 提升为 5
    const hpBefore = enemy.hp
    playCard(ctx, { id: strike.id, upgrade: false }, enemy.id)
    expect(enemy.block).toBe(0) // 格挡正常消耗 5
    expect(enemy.hp).toBe(hpBefore - 5) // 未格挡伤害被提升到 5（而非 1）
  })

  it('手钻：突破敌人格挡时给予其 2 层易伤', () => {
    const ctx = makeCtx(['hand_drill'])
    const enemy = ctx.enemies[0]!
    enemy.block = 4 // 打击 6 伤：突破格挡、有 2 点未格挡伤害
    playCard(ctx, { id: strike.id, upgrade: false }, enemy.id)
    const vuln = enemy.statuses.find((s) => s.id === 'vulnerable')
    expect(vuln).toBeDefined()
    expect(vuln!.amount).toBe(2)
  })

  it('臂甲：每场第一次从卡牌获得的格挡翻倍', () => {
    const ctx = makeCtx(['bracer'])
    ctx.energy = 5
    const defendId = 'defend_ironclad' // 防御：5 格挡
    playCard(ctx, { id: defendId, upgrade: false }) // 首次 → 翻倍 = 10
    expect(ctx.player.block).toBe(10)
    playCard(ctx, { id: defendId, upgrade: false }) // 第二次 → 正常 5 → 累计 15
    expect(ctx.player.block).toBe(15)
  })

  it('不安油灯：每场首次打出"给出敌方负面状态"的牌时层数翻倍', () => {
    const ctx = makeCtx(['uneasy_lamp'])
    const enemy = ctx.enemies[0]!
    const bashId = 'bash' // 痛击：8 伤 + 给敌人 2 层易伤
    playCard(ctx, { id: bashId, upgrade: false }, enemy.id)
    const vuln = enemy.statuses.find((s) => s.id === 'vulnerable')
    expect(vuln).toBeDefined()
    expect(vuln!.amount).toBe(4) // 2 → 翻倍 4
  })
})

describe('遗物：受伤/回合结束（先古）', () => {
  it('钨合金棍：每次失去生命减少 1 点', () => {
    const ctx = makeCtx(['tungsten_rod'])
    makeEnemyAttack(ctx) // 敌人撕咬 10 伤
    const hpBefore = ctx.player.hp // 80
    enemyTurn(ctx) // 受 10 伤后被钨合金棍回补 1
    expect(ctx.player.hp).toBe(hpBefore - 9)
  })

  it('观察与习得：一回合累计失去生命不超过 20', () => {
    const ctx = makeCtx(['watch_and_learn'])
    const e = ctx.enemies[0]!
    // 让撕咬改为 25 伤，单次即超过 20 点上限
    e.ai = { mode: 'loop', sequence: ['撕咬'] }
    e.intentName = '撕咬'
    e.moves!['撕咬'] = {
      name: '撕咬',
      intent: 'attack',
      damage: 25,
      effects: [{ type: 'damage', target: 'enemy', amount: 25 }],
      desc: '造成 25 点伤害',
    }
    const hpBefore = ctx.player.hp // 80
    enemyTurn(ctx)
    // 只损失 20 点（超出部分被回补封顶）
    expect(ctx.player.hp).toBe(hpBefore - 20)
  })

  it('奥利哈钢：回合结束时无格挡则获得 6 点格挡', () => {
    const ctx = makeCtx(['orichalcum'])
    ctx.player.block = 0
    enemyTurn(ctx) // 敌人待机，回合结束触发奥利哈钢
    expect(ctx.player.block).toBe(6)
  })

  it('招架盾：回合结束格挡≥10 时对随机敌人造成 6 伤', () => {
    const ctx = makeCtx(['parrying_shield'])
    const enemy = ctx.enemies[0]!
    ctx.player.block = 10
    const hpBefore = enemy.hp
    enemyTurn(ctx)
    expect(enemy.hp).toBe(hpBefore - 6)
  })
})
