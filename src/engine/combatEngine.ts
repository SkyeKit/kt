/**
 * 战斗引擎（PRD §3.3 / agent.md §5.3）
 * 职责：构建战斗上下文、玩家回合（打牌/结算）、敌人回合（意图执行）、胜负判定。
 * 伤害公式（PRD §3.3.3）：攻击伤害 = ⌊(基础+力量) × 易伤(×1.5) × 虚弱(×0.75) × 其他倍率⌋；
 * 格挡获得 = 基础 + 敏捷（×脆弱修正）；结算顺序：伤害 → 扣格挡 → 扣血 → 触发受伤效果。
 */
import type { Card, EffectChain, Enemy, EnemyMove, IntentType, StatusId } from '@/types'
import { COMBAT } from '@/config/gameConfig'
import { addStatus, drawCards, getStatusAmount, resolveEffectChain, shuffle } from './effectEngine'
import { buildEnemyUnit, resolveIntent } from './enemyAI'

// 战斗单位（玩家或敌人共用）
export interface CombatUnit {
  id: string
  name: string
  isPlayer: boolean
  hp: number
  maxHp: number
  block: number // 格挡（回合结束消失）
  armor: number // 覆甲（跨回合保留）
  strength: number // 力量
  dexterity: number // 敏捷
  statuses: Array<{ id: StatusId; amount: number; turns: number }>
  alive: boolean
  turnCount: number
  // 敌人字段
  category?: string
  ai?: Enemy['ai']
  moves?: Record<string, EnemyMove>
  intentName?: string // 当前意图招式名
  intentType?: IntentType
  intentDamage?: number // 意图显示伤害（含力量/易伤等修正）
  intentHits?: number
  intentBlock?: number
  spawns?: Enemy['spawns']
  // 玩家字段（主角色）
  hand: string[]
  drawPile: string[]
  discardPile: string[]
  exhaustPile: string[]
  energy: number
  maxEnergy: number
}

// 战斗上下文：effectEngine 与回合循环共享的可变状态
export interface CombatContext {
  player: CombatUnit
  enemies: CombatUnit[]
  hand: string[]
  drawPile: string[]
  discardPile: string[]
  exhaustPile: string[]
  energy: number
  maxEnergy: number
  turn: number // 当前回合（玩家视角，从 1 开始）
  cardsPlayedThisTurn: number
  attacksPlayedThisTurn: number
  skillsPlayedThisTurn: number
  cardsPlayedTotal: number // 本场累计打牌数
  cardsThisTurn: number // 本回合打出牌数（狂怒/杂耍等用）
  gold: number // 事件/斩杀金币用
  upgradeQueue: number // 待升级卡牌数（战斗内升级/事件）
  transformQueue: number
  removeQueue: number
  log: string[]
  rng: () => number
  // 战斗特效队列（伤害数字跳动等，PRD §5.3 动画）
  fxId: number // 自增 id
  fx: CombatFx[]
}

// 战斗特效：伤害/格挡/回复等数字跳动（BattleView 渲染用）
export interface CombatFx {
  id: number
  unitId: string // 目标单位（玩家或敌人 id）
  text: string // 显示文本（如 -6 / +5 格挡）
  kind: 'damage' | 'block' | 'heal' | 'buff' // 动画类型
}

// 战斗结束原因
export type CombatResult =
  { status: 'victory'; gold: number } | { status: 'defeat' } | { status: 'running' }

// 从卡牌数据创建战斗上下文（初始手牌按 startingDeck 洗入抽牌堆）
export function createCombatContext(
  player: {
    id: string
    name: string
    hp: number
    maxHp: number
    deck: string[]
    gold?: number
    relics?: string[]
  },
  enemies: Array<{ id: string; name: string; hp: number; maxHp: number }>,
  rng: () => number = Math.random,
): CombatContext {
  const drawPile = shuffle(player.deck, rng)
  const hand: string[] = []
  const ctx: CombatContext = {
    player: {
      id: player.id,
      name: player.name,
      isPlayer: true,
      hp: player.hp,
      maxHp: player.maxHp,
      block: 0,
      armor: 0,
      strength: 0,
      dexterity: 0,
      statuses: [],
      alive: true,
      turnCount: 0,
      hand,
      drawPile,
      discardPile: [],
      exhaustPile: [],
      energy: 0,
      maxEnergy: 0,
    },
    enemies: enemies.map((e) => ({
      id: e.id,
      name: e.name,
      isPlayer: false,
      hp: e.hp,
      maxHp: e.maxHp,
      block: 0,
      armor: 0,
      strength: 0,
      dexterity: 0,
      statuses: [],
      alive: true,
      turnCount: 0,
      hand: [],
      drawPile: [],
      discardPile: [],
      exhaustPile: [],
      energy: 0,
      maxEnergy: 0,
    })),
    hand,
    drawPile,
    discardPile: [],
    exhaustPile: [],
    energy: 0,
    maxEnergy: 3,
    turn: 0,
    cardsPlayedThisTurn: 0,
    attacksPlayedThisTurn: 0,
    skillsPlayedThisTurn: 0,
    cardsPlayedTotal: 0,
    cardsThisTurn: 0,
    gold: player.gold ?? 0,
    upgradeQueue: 0,
    transformQueue: 0,
    removeQueue: 0,
    log: [],
    rng,
    fxId: 0,
    fx: [],
  }
  return ctx
}

// 战斗开始：第一回合抽牌、获得能量、敌人意图初始化
export function startCombat(ctx: CombatContext, handSize = 5, maxEnergy = 3): void {
  ctx.player.maxEnergy = maxEnergy
  ctx.turn = 0
  startPlayerTurn(ctx, handSize)
  // 敌人回合数从 0 开始（第 1 回合行动），初始化意图
  for (const e of ctx.enemies) {
    e.turnCount = 0
  }
  setEnemyIntents(ctx)
}

// 玩家回合开始：回能量、抽牌、重置本回合计数
export function startPlayerTurn(ctx: CombatContext, handSize = 5): void {
  ctx.turn += 1
  ctx.energy = ctx.maxEnergy
  ctx.cardsPlayedThisTurn = 0
  ctx.attacksPlayedThisTurn = 0
  ctx.skillsPlayedThisTurn = 0
  ctx.cardsThisTurn = 0
  ctx.player.block = 0 // 格挡回合结束消失（覆甲保留）
  drawCards(ctx, handSize)
}

// 玩家打出卡牌：扣费 → 解析效果 → 计牌数；返回是否成功打出
export function playCard(ctx: CombatContext, card: Card, targetId?: string): boolean {
  if (ctx.energy < (card.cost === 'X' ? 1 : (card.cost as number))) return false
  // 攻击类卡牌必须指定有效目标（防御/能力卡不需要；未指定目标自动取首个存活敌人）
  if (card.type === 'attack') {
    if (targetId !== undefined && !ctx.enemies.some((e) => e.id === targetId && e.alive)) {
      return false // 无效目标：仍消耗能量报错？本实现按 PRD：攻击前选好目标，校验失败返回 false 不出
    }
  }
  // 扣费（X 费用按剩余能量扣）
  const cost = card.cost === 'X' ? ctx.energy : (card.cost as number)
  ctx.energy -= cost
  ctx.cardsPlayedThisTurn++
  ctx.cardsPlayedTotal++
  ctx.cardsThisTurn++
  if (card.type === 'attack') ctx.attacksPlayedThisTurn++
  if (card.type === 'skill') ctx.skillsPlayedThisTurn++
  // 执行效果链（升级后用升级效果）
  const effects = card.upgrade ? card.upgradeEffects : card.effects
  const logs = resolveEffectChain(ctx, effects.length > 0 ? effects : fallbackEffect(card), {
    targetId,
  })
  ctx.log.push(`打出【${card.name}】`, ...logs)
  // 打出后从手牌移除一张（相同 id 可能有复数张，只移除一张）
  const handIdx = ctx.hand.lastIndexOf(card.id)
  if (handIdx >= 0) ctx.hand.splice(handIdx, 1)
  // 去向：消耗牌进消耗堆，否则进弃牌堆
  if (card.keywords.includes('exhaust')) ctx.exhaustPile.push(card.id)
  else ctx.discardPile.push(card.id)
  return true
}

// 效果链为空时的兜底：空效果（数据转换未能解析的复杂牌直接跳过，UI 仍显示原文）
function fallbackEffect(_card: Card): EffectChain {
  return []
}

// 敌人回合：执行意图 → 回合结束
export function enemyTurn(ctx: CombatContext): void {
  for (const e of ctx.enemies) {
    if (!e.alive) continue
    // 击晕/幻象复活等特殊状态处理
    if (getStatusAmount(e, 'stunned') > 0) {
      addStatus(e, 'stunned', -1)
      continue
    }
    const move = e.intentName ? e.moves?.[e.intentName] : undefined
    if (move) {
      // 敌人招式：效果来源为 enemy，施法者为该敌人（self 增益归敌人，伤害目标为玩家）
      const logs = resolveEffectChain(ctx, move.effects, { source: 'enemy', actorId: e.id })
      ctx.log.push(`${e.name} 使用【${move.name}】`, ...logs)
    }
    e.turnCount++
    // 领地意识：回合结束获得力量
    if (getStatusAmount(e, 'territorial') > 0) addStatus(e, 'strength', 1)
  }
  // 回合结束结算：格挡清空（玩家）、状态层数递减
  endOfTurn(ctx)
}

// 回合结束：玩家格挡清空、状态回合递减（持续型状态）
export function endOfTurn(ctx: CombatContext): void {
  if (ctx.player.block > 0 && COMBAT.blockExpires) ctx.player.block = 0
  for (const u of [ctx.player, ...ctx.enemies]) {
    u.statuses = u.statuses.filter((s) => {
      if (s.turns > 0) s.turns--
      return s.amount > 0 && s.turns !== 0
    })
  }
}

// 更新全部敌人意图（按各自 AI 模式；elite/boss 循环池由外部 map 保证）
export function setEnemyIntents(ctx: CombatContext): void {
  for (const e of ctx.enemies) {
    if (!e.alive || !e.ai) continue
    const intent = resolveIntent(e, ctx.rng)
    e.intentName = intent.name
    const move = e.moves?.[intent.name]
    e.intentType = move?.intent ?? 'special'
    e.intentDamage = move?.damage ?? undefined
    e.intentHits = move?.hits ?? 1
    e.intentBlock = move?.block ?? undefined
  }
}

// 战斗结果判定：玩家死亡 = 失败；敌人全灭 = 胜利
export function checkResult(ctx: CombatContext): CombatResult {
  if (ctx.player.hp <= 0) return { status: 'defeat' }
  if (ctx.enemies.length > 0 && ctx.enemies.every((e) => !e.alive)) {
    return { status: 'victory', gold: 0 }
  }
  return { status: 'running' }
}

// 敌人死亡后的衍生物召唤（寄生物等）：返回新增敌人
export function spawnMinion(ctx: CombatContext, enemy: Enemy, hp: number): void {
  ctx.enemies.push({
    ...buildEnemyUnit(enemy, hp),
    isPlayer: false,
  })
}
