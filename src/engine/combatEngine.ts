/**
 * 战斗引擎（PRD §3.3 / agent.md §5.3）
 * 职责：构建战斗上下文、玩家回合（打牌/结算）、敌人回合（意图执行）、胜负判定。
 * 伤害公式（PRD §3.3.3）：攻击伤害 = ⌊(基础+力量) × 易伤(×1.5) × 虚弱(×0.75) × 其他倍率⌋；
 * 格挡获得 = 基础 + 敏捷（×脆弱修正）；结算顺序：伤害 → 扣格挡 → 扣血 → 触发受伤效果。
 */
import type { Card, DeckCard, EffectChain, Enemy, EnemyMove, IntentType, StatusId } from '@/types'
import { COMBAT } from '@/config/gameConfig'
import { cardsData, getCard, getEnemy } from '@/data'
import {
  addStatus,
  damageUnit,
  drawCards,
  getStatusAmount,
  onEnemyDeath,
  onExhaustCard,
  onPlayerLoseHp,
  playTopNCards,
  resolveEffectChain,
  shuffle,
} from './effectEngine'
import { buildEnemyUnit, resolveIntent, uniqueEnemyId } from './enemyAI'
import {
  buildEnchantMods,
  effectiveCost,
  enchantStateOf,
  enchantmentsOf,
  hasCardKeyword,
  hasEnchant,
  resetCostReduction,
} from './enchantSystem'
import {
  applyRelicsBeforePlayerTurn,
  applyRelicsOnExhaust,
  applyRelicsOnPlayAttack,
  applyRelicsOnPlayCard,
  applyRelicsOnPlaySkill,
  applyRelicsOnPlayPower,
  applyRelicsOnTurnEnd,
  computeAttackRelicBonus,
  getState,
  hasRelic,
  NEGATIVE_STATUS_SET,
} from './relicSystem'

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
  defId?: string // 原始敌人数据 id（用于 getEnemy 查定义）；id 字段可能被唯一化(多胞胎)加后缀
  category?: string
  ai?: Enemy['ai']
  moves?: Record<string, EnemyMove>
  intentName?: string // 当前意图招式名
  intentType?: IntentType
  intentDamage?: number // 意图显示伤害（含力量/易伤等修正）
  intentHits?: number
  intentBlock?: number
  spawns?: Enemy['spawns']
  // 招式冷却计数（暗港敌人 ai.cooldowns 定义时长）：使用某招式后置时长、每回合递减 1，归零后可再用
  // 存于逐实例字段而非共享 ai 对象，避免多胞胎敌人间互相污染（ai 由 buildEnemyUnit 按引用复制）
  cooldowns?: Record<string, number>
  // 暗港（Underdocks）机制运行时字段（非持久化，仅战斗内有效）
  hardShellUsedThisTurn: number // 硬化外壳：本回合累计已损失、计入封顶的生命值（玩家回合开始清零）
  steamBlow?: number // 蒸汽喷发：触发"血量归零不死"时记录要爆炸造成的伤害
  steamTriggered?: boolean // 蒸汽喷发：是否已触发过一次"下回合自爆"（防重复触发）
  // 玩家字段（主角色）；牌堆元素为卡实例（携带各自升级状态，支持同名卡独立升级）
  hand: DeckCard[]
  drawPile: DeckCard[]
  discardPile: DeckCard[]
  exhaustPile: DeckCard[]
  energy: number
  maxEnergy: number
}

// 附魔战斗内状态（按卡牌 id 记录，仅当场有效，不持久化）：
// 记录首次触发标记/动量累计/华彩每场一次/费用修正（蛇行随机化、沉眠精华 -1）
export interface EnchantCombatState {
  firstPlayed?: boolean // 本场是否已打出过（迅速/播种/活力首次触发）
  momentum?: number // 动量：本场累计伤害加成（每次打出 +5）
  glamUsed?: boolean // 华彩：本场是否已用（每场重放一次）
  costMod?: number // 沉眠精华：回合结束在手牌的费用 -1 累计（打出后清零）
  costOverride?: number // 蛇行：抽到时随机化 0~3 的费用
}

// 战斗上下文：effectEngine 与回合循环共享的可变状态
export interface CombatContext {
  player: CombatUnit
  enemies: CombatUnit[]
  hand: DeckCard[]
  drawPile: DeckCard[]
  discardPile: DeckCard[]
  exhaustPile: DeckCard[]
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
  // 玩家持有遗物 id 列表（MVP 遗物系统，PRD §3.8）
  relics: string[]
  // 遗物内部计数状态（纸蛙/钢笔尖/冰淇淋/损毁头盔等每场战斗内状态，不持久化到存档）
  relicState: Record<string, number | string>
  // 战斗内选牌挂起队列（"选择一张牌加入手牌"类效果），由 store 桥接给选牌浮层
  pendingPicks: CombatPickRequest[]
  pickSeq: number // 战斗内选牌自增号
  // 本回合可免费打出的牌 id 集合（"发现/飞溅"等选到的零费牌）
  freeThisTurn: Set<string>
  // 本回合保留全部手牌（均衡/箭雨牌"在本回合保留你的手牌"；仅当回合有效）
  retainHandThisTurn: boolean
  // 战斗中指定"获得保留"的卡牌 id 集合（选择悖论遗物：被选中的牌每回合结束都留手；仅本战斗有效，跨回合不清理）
  retainHandCards?: Set<string>
  // 卡牌"重放"层数（重放：打出时自动再结算 N 次效果链，未掘宝石施加；按卡牌 id 记录）
  replay: Record<string, number>
  // 附魔战斗内状态（按卡牌 id 记录：首次触发/动量/华彩/费用修正）
  enchantState: Record<string, EnchantCombatState>
  // 本场战斗中已打出的"能力牌(power)"与其升级态（cardId → 是否升级）；被动能力卡效果在此追踪
  powers: Map<string, boolean>
  // 剩余"本回合接下来攻击额外生效"次数（连环拳）：回合开始清零
  nextAttacksExtra: number
  // 剩余"打出的下一张攻击牌耗能变为 0"次数（无情猛攻）：跨回合保留直到被某张攻击牌消费
  nextAttackFree: number
  // 当前是否为玩家回合（用于"在你的回合失去生命"类被动能力卡的判定，敌人回合为 false）
  isPlayerTurn: boolean
  // 本回合是否已触发"坚定不移"首次格挡翻倍：回合开始清零
  blockDoubledThisTurn: boolean
  // 最近一次打出 X 费卡牌实际投入的能量（倾泻按其展开抽牌堆顶部牌）
  lastXPaid: number
  // 本回合不再抽牌（战斗专注：用了后本回合后续 draw 效果被忽略）
  noDrawThisTurn: boolean
  // 本回合不再获得额外能量（跃跃欲试：打出后本回合后续 gainEnergy 效果被忽略）
  noEnergyGainThisTurn: boolean
  // 本回合是否消耗过卡牌（被遗忘的仪式/邪眼等"本回合消耗过"条件增益判断）
  exhaustedThisTurn: boolean
  // 本回合是否已触发"怀旧"的首张攻击/技能置顶（无色能力卡：每回合仅首次触发一次）
  nostalgiaUsedThisTurn: boolean
  // 不安油灯遗物：本次打出牌"对敌人施加负面状态"的层数是否翻倍（每场战斗首个负面牌触发，单次打出有效）
  doubleEnemyStatusThisPlay: boolean
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

// 战斗内选牌请求：由"选择一张牌加入手牌"类无色卡效果（find/discover）在结算时挂起，
// store 读取后桥接给通用选牌浮层（PickCardsModal），玩家选中后把牌回填到手牌。
export interface CombatPickRequest {
  pickId: number // 战斗内自增 id（用于 store 侧匹配 resolver）
  title: string // 浮层标题
  cards: Card[] // 候选卡（非空；无候选则不挂起）
  action: 'addToHand' | 'addToHandFree' | 'addToHandRetain' // 选中后仅入手牌 / 本回合可免费打出 / 入手并获得保留
}

// 从卡牌数据创建战斗上下文（初始手牌按 startingDeck 洗入抽牌堆）
export function createCombatContext(
  player: {
    id: string
    name: string
    hp: number
    maxHp: number
    deck: DeckCard[]
    gold?: number
    relics?: string[]
    maxEnergy?: number
    handSize?: number
  },
  enemies: Array<{ id: string; name: string; hp: number; maxHp: number }>,
  rng: () => number = Math.random,
): CombatContext {
  const drawPile = shuffle(player.deck, rng)
  const hand: DeckCard[] = []
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
      hardShellUsedThisTurn: 0,
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
      hardShellUsedThisTurn: 0,
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
    relics: [...(player.relics ?? [])],
    relicState: {},
    pendingPicks: [],
    pickSeq: 0,
    freeThisTurn: new Set<string>(),
    retainHandThisTurn: false,
    retainHandCards: new Set<string>(),
    replay: {},
    enchantState: {},
    powers: new Map<string, boolean>(),
    nextAttacksExtra: 0,
    nextAttackFree: 0,
    isPlayerTurn: true,
    blockDoubledThisTurn: false,
    lastXPaid: 0,
    // 回合级限制标记（创建时初始化，startCombat/startPlayerTurn 每回合开始复位）：
    // noDrawThisTurn 本回合禁抽；noEnergyGainThisTurn 本回合禁能量；exhaustedThisTurn 本回合已消耗过卡牌
    noDrawThisTurn: false,
    noEnergyGainThisTurn: false,
    exhaustedThisTurn: false,
    // 怀旧首张攻击/技能置顶标记：本回合是否已触发（每回合开始复位）
    nostalgiaUsedThisTurn: false,
    // 不安油灯"单次打出翻倍"标记：本次打出牌是否对敌人负面状态层数翻倍（playCard 重设）
    doubleEnemyStatusThisPlay: false,
  }
  ctx.player.maxEnergy = player.maxEnergy ?? 3
  return ctx
}

// 战斗开始：第一回合抽牌、获得能量、敌人意图初始化
export function startCombat(ctx: CombatContext, handSize = 5, maxEnergy = 3): void {
  ctx.player.maxEnergy = maxEnergy
  ctx.turn = 0
  // 能力追踪与回合级计数器初始化（每场新战斗重置）
  ctx.powers = new Map()
  ctx.nextAttacksExtra = 0
  ctx.nextAttackFree = 0
  ctx.blockDoubledThisTurn = false
  ctx.lastXPaid = 0
  // 回合级限制标记：战斗开始复位（禁抽/禁能量/消耗标记每回合开始同样清零）
  ctx.noDrawThisTurn = false
  ctx.noEnergyGainThisTurn = false
  ctx.exhaustedThisTurn = false
  // 怀旧首张攻击/技能置顶标记：本回合开始复位
  ctx.nostalgiaUsedThisTurn = false
  // 固有卡（innate，含附魔追加的固有）开局加入手牌，且从抽牌堆中移除避免重复抽到（PRD 关键词）
  moveInnateToHand(ctx)
  startPlayerTurn(ctx, handSize)
  // 注能附魔：战斗开始时自动打出（从抽牌堆取出并结算）
  playImbuedCards(ctx)
  // 敌人回合数从 0 开始（第 1 回合行动），初始化意图
  for (const e of ctx.enemies) {
    e.turnCount = 0
  }
  setEnemyIntents(ctx)
  // 施加敌人"初始状态"（覆甲/吮吸/硬化外壳/尖叫/蒸汽等需引擎钩子的机制，Underdocks.md §3）
  // 用 defId 查定义：id 可能被多胞胎唯一化加后缀，defId 始终是原始数据 id
  for (const e of ctx.enemies) {
    const def = getEnemy(e.defId ?? e.id)
    for (const s of def?.initialStatuses ?? []) addStatus(e, s.status, s.amount)
  }
}

// 开局把"固有"关键词的卡移到手牌（从抽牌堆剔除）；附魔"王室认证"追加固有也一并处理
function moveInnateToHand(ctx: CombatContext): void {
  const keep: DeckCard[] = []
  for (const entry of ctx.drawPile) {
    const card = getCard(entry.id)
    if (card && hasCardKeyword(card, 'innate')) ctx.hand.push(entry)
    else keep.push(entry)
  }
  ctx.drawPile = keep
}

// 玩家回合开始：回能量、抽牌、重置本回合计数
// 在此接入遗物"回合开始"钩子（红头骨/硫磺/船夹板/开心小花/灯笼/冰淇淋结转/自成型黏土格挡）
export function startPlayerTurn(ctx: CombatContext, handSize = 5): void {
  ctx.turn += 1
  ctx.isPlayerTurn = true
  ctx.energy = ctx.maxEnergy
  ctx.cardsPlayedThisTurn = 0
  ctx.attacksPlayedThisTurn = 0
  ctx.skillsPlayedThisTurn = 0
  ctx.cardsThisTurn = 0
  // 回合级计数器清零（连环拳额外生效次数 / 坚定不移首次格挡翻倍 / 禁抽·禁能量·消耗标记）
  ctx.nextAttacksExtra = 0
  ctx.blockDoubledThisTurn = false
  ctx.noDrawThisTurn = false
  ctx.noEnergyGainThisTurn = false
  ctx.exhaustedThisTurn = false
  // 怀旧首张攻击/技能置顶标记：本回合开始复位
  ctx.nostalgiaUsedThisTurn = false
  // 硬化外壳：每回合封顶计数清零（鬼祟珊瑚群等，Underdocks.md §4；含玩家，虽玩家暂不用于此）
  for (const u of [ctx.player, ...ctx.enemies]) u.hardShellUsedThisTurn = 0
  // 胆小：敌人每回合开始时获得等量格挡（花园幽灵鳗，Underdocks.md §3.3）
  for (const e of ctx.enemies) {
    if (!e.alive) continue
    const timid = getStatusAmount(e, 'timid')
    if (timid > 0) {
      e.block += timid
      ctx.log.push(`【胆小】${e.name} 获得 ${timid} 点格挡`)
    }
  }
  // 上一回合"免费打出"标记清空（发现/飞溅选到的牌仅当回合免费）
  ctx.freeThisTurn.clear()
  // 上一回合"本回合保留手牌"标记清空（均衡/箭雨效果仅当回合有效）
  ctx.retainHandThisTurn = false
  // 坚固钳子：允许把最多 10 点格挡保留到跨回合（重置前先寄存，重置后归还）
  const clampCarry = hasRelic(ctx, 'sturdy_clamp') ? Math.min(ctx.player.block, 10) : 0
  ctx.player.block = 0 // 格挡回合结束消失（覆甲保留）
  // 先结算遗物回合开始效果（部分遗物会 +格挡，需在格挡重置之后）
  applyRelicsBeforePlayerTurn(ctx)
  ctx.player.block += clampCarry // 归还坚固钳子寄存的格挡
  // 覆甲（玩家）：每回合开始将当前层数转为本回合格挡，随后各层递减 1
  // （岩石铠甲/永恒铠甲/护喉甲施加的 armor 状态与 unit.armor 字段统一按本语义结算，覆甲随回合递减至 0）
  const armorAmt = getStatusAmount(ctx.player, 'armor') + ctx.player.armor
  if (armorAmt > 0) {
    ctx.player.block += armorAmt
    ctx.log.push(`【覆甲】回合开始获得 ${armorAmt} 点格挡，层数递减`)
  }
  if (getStatusAmount(ctx.player, 'armor') > 0) addStatus(ctx.player, 'armor', -1)
  if (ctx.player.armor > 0) ctx.player.armor -= 1
  // 好勇斗狠：回合开始时，将弃牌堆一张随机攻击牌放入手牌并升级
  if (ctx.powers.has('bravado')) {
    const atkIndices: number[] = []
    ctx.discardPile.forEach((en, i) => {
      if (getCard(en.id)?.type === 'attack') atkIndices.push(i)
    })
    if (atkIndices.length > 0) {
      const pick = atkIndices[Math.floor(ctx.rng() * atkIndices.length)] ?? -1
      if (pick >= 0) {
        const entry = ctx.discardPile.splice(pick, 1)[0]
        if (entry) {
          entry.upgrade = true
          ctx.hand.push(entry)
          ctx.log.push('【好勇斗狠】将弃牌堆一张随机攻击牌入手并升级')
        }
      }
    }
  }
  drawCards(ctx, handSize)
  // ===== 战斗开始（第 1 回合摸牌后）遗物的"手牌类"效果 =====
  // 风箱：每场战斗开始时，将手牌全部升级（本场战斗内，玩家手牌实例 upgrade 置真）
  if (ctx.turn === 1 && hasRelic(ctx, 'bellows')) {
    ctx.hand.forEach((en) => (en.upgrade = true))
    ctx.log.push('[风箱] 战斗开始的手牌被升级')
  }
  // 三角铃鼓：每场战斗的第一回合保留手牌（回合结束不丢弃）
  if (ctx.turn === 1 && hasRelic(ctx, 'triangle_drum')) {
    ctx.retainHandThisTurn = true
    ctx.log.push('[三角铃鼓] 第一回合保留手牌')
  }
  // 烦人机关盒：每场战斗开始时，将一张随机卡牌加入手牌，且本回合免费打出
  if (ctx.turn === 1 && hasRelic(ctx, 'annoying_box')) {
    const pool = getRelicRandomCardPool()
    if (pool.length > 0) {
      const pick = pool[Math.floor(ctx.rng() * pool.length)]!
      ctx.hand.push({ id: pick.id, upgrade: false })
      ctx.freeThisTurn.add(pick.id)
      ctx.log.push(`[烦人机关盒] 将随机卡牌【${pick.name}】加入手牌（本回合免费）`)
    }
  }
  // 能力卡"回合开始"被动触发（需在抽牌后统一结算，保证与遗物/好勇斗狠顺序一致）
  applyPowersAtTurnStart(ctx)
}

// 供"随机卡牌入手"类遗物（烦人机关盒）取样的卡牌池：取全部可打出的战士卡
function getRelicRandomCardPool(): Card[] {
  return cardsData.warrior.filter((c) => !c.keywords.includes('unplayable'))
}

// 能力卡"回合开始"被动结算（WarriorDeck.md 能力卡）：
// 在玩家回合开始的抽牌后调用，逐一检查已打出能力卡（ctx.powers）并对玩家施放对应效果
function applyPowersAtTurnStart(ctx: CombatContext): void {
  // 恶魔形态：回合开始获得 2/3 点力量
  if (ctx.powers.has('demon_form')) {
    const amt = ctx.powers.get('demon_form') ? 3 : 2
    addStatus(ctx.player, 'strength', amt)
    ctx.log.push(`【恶魔形态】回合开始获得 ${amt} 点力量`)
  }
  // 绯红披风：回合开始失去 1 点生命并获得 8/10 点格挡
  if (ctx.powers.has('crimson_cloak')) {
    const block = ctx.powers.get('crimson_cloak') ? 10 : 8
    ctx.player.hp = Math.max(0, ctx.player.hp - 1)
    ctx.player.block += block
    ctx.log.push('【绯红披风】回合开始失去 1 点生命并获得 ' + block + ' 点格挡')
    // 失去生命触发"在你的回合失去生命"被动（如狱火/撕裂），绯红披风自身无该联动
    ctx.log.push(...onPlayerLoseHp(ctx, 1))
  }
  // 薪火之源：回合开始获得 1/2 点能量
  if (ctx.powers.has('ember_source')) {
    const amt = ctx.powers.get('ember_source') ? 2 : 1
    ctx.energy += amt
    ctx.log.push(`【薪火之源】回合开始获得 ${amt} 点能量`)
  }
  // 狱火：回合开始失去 1 点生命（触发"失去生命"被动对全体敌人造成伤害）
  if (ctx.powers.has('hellfire')) {
    ctx.player.hp = Math.max(0, ctx.player.hp - 1)
    ctx.log.push('【狱火】回合开始失去 1 点生命')
    ctx.log.push(...onPlayerLoseHp(ctx, 1))
  }
  // 准备时间（无色能力卡）：回合开始时获得 4/6 点活力（升级 6）
  if (ctx.powers.has('prep_time')) {
    const amt = ctx.powers.get('prep_time') ? 6 : 4
    addStatus(ctx.player, 'vigor', amt)
    ctx.log.push(`【准备时间】回合开始获得 ${amt} 点活力`)
  }
  // 熵（无色能力卡）：回合开始时，将手牌中随机 1 张牌变化成随机攻击牌
  if (ctx.powers.has('entropy')) {
    ctx.log.push(...transformRandomHandCard(ctx, 1))
  }
  // 乱战（无色能力卡）：回合开始时，打出抽牌堆顶部的牌
  if (ctx.powers.has('melee')) {
    const played = playTopNCards(ctx, 1, '乱战')
    ctx.log.push(`【乱战】回合开始打出抽牌堆顶部的牌`, ...played)
  }
}

// 熵的"变化手牌"辅助：将手牌中随机 count 张牌变化成一张随机攻击牌
// 返回值：日志文本数组（供回合开始被动结算使用）
function transformRandomHandCard(ctx: CombatContext, count: number): string[] {
  const logs: string[] = []
  if (ctx.hand.length === 0) return logs
  const pool = cardsData.warrior.filter((c) => c.type === 'attack')
  if (pool.length === 0) {
    logs.push('无可变化目标（无随机攻击牌池）')
    return logs
  }
  // 洗乱手牌，取前 count 张逐一变化
  const chosen = shuffle([...ctx.hand], ctx.rng).slice(0, Math.min(count, ctx.hand.length))
  for (const entry of chosen) {
    const idx = ctx.hand.indexOf(entry)
    if (idx < 0) continue
    const oldName = getCard(entry.id)?.name ?? entry.id
    const pick = pool[Math.floor(ctx.rng() * pool.length)]!
    entry.id = pick.id
    entry.upgrade = false
    logs.push(`【熵】将【${oldName}】变化为【${pick.name}】`)
  }
  return logs
}

// 玩家打出卡牌：扣费 → 解析效果 → 计牌数；返回是否成功打出
// entry 为手牌中的卡实例（携带该张 upgrade 状态），据此决定用升级后效果
export function playCard(ctx: CombatContext, entry: DeckCard, targetId?: string): boolean {
  const card = getCard(entry.id)
  if (!card) return false
  // 剃刀牙（遗物）：打出攻击/技能牌时，将其在本场战斗内升级（改用升级效果结算）
  const razorTooth =
    hasRelic(ctx, 'razor_tooth') && (card.type === 'attack' || card.type === 'skill')
  const upgraded = entry.upgrade || razorTooth
  if (razorTooth && !entry.upgrade) {
    entry.upgrade = true
    ctx.log.push(`[剃刀牙] 将【${card.name}】在本场战斗内升级`)
  }
  // 不可打出的牌（状态/诅咒/"不能被打出"）直接拒绝
  if (card.keywords.includes('unplayable')) return false
  // 本回合免费打出的牌（发现/飞溅选中）不需能量；其余按"运行时费用"校验（附魔可改费用：蛇行/沉眠精华/特兹卡塔拉）
  const isFreePlay = ctx.freeThisTurn.has(card.id)
  // 腐化：能力卡已打出时，技能牌耗能变为 0（WarriorDeck.md 腐化）
  const corruptionFree = card.type === 'skill' && ctx.powers.has('corruption')
  // 无情猛攻：已打出"你打出的下一张攻击牌耗能变为 0"，本张攻击牌免费（消费一次）
  const nextAtkFree = card.type === 'attack' && (ctx.nextAttackFree ?? 0) > 0
  // 疯狂科学（变体8，事件能力卡）：能力牌的耗能减少 1（已打出时对所有能力牌生效）
  const crazyScience8 = card.type === 'power' && ctx.powers.has('crazy_science_8')
  // 运行时费用（附魔可改费）；疯狂科学8 对能力牌额外 -1（不低于 0，X/无费用不受影响）
  const playCost = effectiveCost(ctx, card)
  const discountedCost =
    crazyScience8 && playCost !== 'X' && playCost !== null
      ? Math.max(0, (playCost as number) - 1)
      : playCost
  // 缠结：玩家所有攻击牌耗能 +1，持续 X 回合（藤蔓蹒跚者 紧绕藤蔓施加；X 费不受影响）
  const tangledFee =
    discountedCost !== 'X' &&
    discountedCost !== null &&
    card.type === 'attack' &&
    getStatusAmount(ctx.player, 'tangled') > 0
      ? 1
      : 0
  const totalCost: number | 'X' = discountedCost === 'X' ? 'X' : (discountedCost ?? 0) + tangledFee
  if (
    !isFreePlay &&
    !corruptionFree &&
    !nextAtkFree &&
    ctx.energy < (totalCost === 'X' ? 1 : (totalCost as number))
  )
    return false
  // 天鹅绒颈圈：每回合最多打出 6 张牌；已打满则无法继续出牌
  if (hasRelic(ctx, 'velvet_collar') && ctx.cardsThisTurn >= 6) return false
  // 昏眩：本回合只能打出 1 张牌（仪式兽 野兽咆哮施加；每回合都按当前已打牌数限制）
  if (getStatusAmount(ctx.player, 'ringing') > 0 && ctx.cardsPlayedThisTurn >= 1) return false
  // 烟雾弥漫：玩家每回合只能打出 1 张技能牌（活雾专属，Underdocks.md §4）
  // 采用"已打出技能数"限制：本回合击至 1 张技能牌后，再出技能牌直接拒绝
  if (
    card.type === 'skill' &&
    getStatusAmount(ctx.player, 'smoggy') > 0 &&
    ctx.skillsPlayedThisTurn >= 1
  )
    return false
  // 攻击类卡牌必须指定有效目标（防御/能力卡不需要；未指定目标自动取首个存活敌人）
  if (card.type === 'attack') {
    if (targetId !== undefined && !ctx.enemies.some((e) => e.id === targetId && e.alive)) {
      return false // 无效目标：仍消耗能量报错？本实现按 PRD：攻击前选好目标，校验失败返回 false 不出
    }
  }
  // 扣费（X 费用按剩余能量扣）；本回合免费打出的牌 / 腐化技能 / 无情猛攻标记的攻击牌按 0 费处理；含缠结 +1 的耗能加成
  // 艳丽围巾（遗物）：每回合打出的第 5 张牌可免费打出（cardsThisTurn 此时为 4，即即将打出第 5 张）
  const isFree =
    ctx.freeThisTurn.has(card.id) ||
    corruptionFree ||
    nextAtkFree ||
    (hasRelic(ctx, 'gaudy_scarf') && ctx.cardsThisTurn === 4)
  // 无情猛攻标记被消耗：本张攻击牌兑现"下张攻击牌耗能 0"，次数 -1
  if (nextAtkFree) ctx.nextAttackFree = (ctx.nextAttackFree ?? 0) - 1
  const cost = isFree ? 0 : totalCost === 'X' ? ctx.energy : (totalCost as number)
  ctx.energy -= cost
  // 记录 X 费卡实际投入的能量（倾泻按其作为"打出抽牌堆顶部 X 张牌"的数量依据）
  // 化学物X遗物：X 的数值 +2（relic.md 化学物X），即倾泻多打出 2 张顶部牌
  if (playCost === 'X') {
    const chemX = hasRelic(ctx, 'chemical_x')
    ctx.lastXPaid = cost + (chemX ? 2 : 0)
    if (chemX) ctx.log.push('【化学物X】本张 X 费用牌的数值 +2')
  }
  // 能力牌(power)被动登记：记录"是否升级"，被动效果在各阶段钩子查询 ctx.powers 生效
  if (card.type === 'power') ctx.powers.set(card.id, upgraded)
  ctx.cardsPlayedThisTurn++
  ctx.cardsPlayedTotal++
  ctx.cardsThisTurn++
  if (card.type === 'attack') ctx.attacksPlayedThisTurn++
  if (card.type === 'skill') ctx.skillsPlayedThisTurn++
  // 沉眠精华：打出后清空其费用削减（"直到其被打出"：削减仅保留到打出为止）
  resetCostReduction(ctx, card)
  // 附魔修正：伤害/格挡加成在结算效果链时注入（含首次活力/动量累计；首次判定在 buildEnchantMods 内部）
  const mods = buildEnchantMods(ctx, card)
  // 执行效果链（升级后用升级效果）
  const effects = upgraded ? card.upgradeEffects : card.effects
  const chain = effects.length > 0 ? effects : fallbackEffect(card)
  // 不安油灯：每场战斗第一次打出"能给予敌人负面状态"的牌，将其对敌人施加的负面状态层数翻倍
  // 判定依据：效果链中存在把负面状态施加给敌方（target !== self）的 applyStatus 效果
  ctx.doubleEnemyStatusThisPlay = false
  const hasEnemyDebuff = effects.some(
    (e) =>
      e.type === 'applyStatus' &&
      e.target !== 'self' &&
      NEGATIVE_STATUS_SET.has(e.status as StatusId),
  )
  if (hasRelic(ctx, 'uneasy_lamp') && getState(ctx, 'uneasy_lamp_used') === 0 && hasEnemyDebuff) {
    ctx.doubleEnemyStatusThisPlay = true
    ctx.relicState['uneasy_lamp_used'] = 1
    ctx.log.push('[不安油灯] 本张牌对敌人的负面状态效果翻倍')
  }
  // 微型大炮/打击木偶（及其？？？变体）：攻击牌额外基础伤害。
  // 把总加成写入 atk_bonus_this_play，effectEngine 的 damage 分支在每段命中时消费（升级态已含剃刀牙临时升级）
  if (card.type === 'attack') {
    const relicAtkBonus = computeAttackRelicBonus(ctx, upgraded, card)
    if (relicAtkBonus > 0) {
      ctx.relicState['atk_bonus_this_play'] = relicAtkBonus
      ctx.log.push(`[攻击遗物加成] 本张攻击牌额外伤害 +${relicAtkBonus}`)
    }
  }
  let logs = resolveEffectChain(ctx, chain, {
    targetId,
    enchant: mods,
  })
  // 连环拳：本回合"攻击额外生效"次数>0 时，本张攻击牌再结算一次效果链并消耗次数（升级后为 2 次）
  if (card.type === 'attack' && ctx.nextAttacksExtra > 0) {
    ctx.nextAttacksExtra--
    logs = logs.concat(resolveEffectChain(ctx, chain, { targetId, enchant: mods }))
    ctx.log.push('【连环拳】该攻击额外生效一次')
  }
  // 杂耍：本回合打出的第 3 张攻击牌时，将其复制品加入手牌（升级为固有）
  if (card.type === 'attack' && ctx.attacksPlayedThisTurn === 3 && ctx.powers.has('juggle')) {
    ctx.hand.push({ id: entry.id, upgrade: entry.upgrade })
    ctx.log.push('【杂耍】将本回合第 3 张攻击牌的复制品加入手牌')
  }
  // 劫难（无色能力卡）：每当打出一张攻击牌时，将一张随机攻击牌加入手牌
  if (card.type === 'attack' && ctx.powers.has('catastrophe')) {
    const pool = cardsData.warrior.filter((c) => c.type === 'attack')
    if (pool.length > 0) {
      const pick = pool[Math.floor(ctx.rng() * pool.length)]!
      ctx.hand.push({ id: pick.id, upgrade: false })
      ctx.log.push(`【劫难】将随机攻击牌【${pick.name}】加入手牌`)
    }
  }
  // 投斧：每场战斗打出的第一张牌会多打出一次（对同一目标再结算一次效果链）
  if (hasRelic(ctx, 'throwing_axe') && ctx.cardsPlayedTotal === 1) {
    logs = logs.concat(resolveEffectChain(ctx, chain, { targetId, enchant: mods }))
    ctx.log.push('（投斧：该牌多打出一次）')
  }
  // 附魔重放：涡旋每次打出重放 1 次；华彩每场战斗重放 1 次（未用才触发）
  const st = enchantStateOf(ctx, card)
  if (hasEnchant(card, 'replay1')) {
    logs = logs.concat(resolveEffectChain(ctx, chain, { targetId, enchant: mods }))
    ctx.log.push('【涡旋】该牌重放 1 次')
  }
  if (hasEnchant(card, 'replayOnce') && !st.glamUsed) {
    logs = logs.concat(resolveEffectChain(ctx, chain, { targetId, enchant: mods }))
    st.glamUsed = true
    ctx.log.push('【华彩】该牌本场重放一次')
  }
  // 重放（echo）：该牌带"重放N层"（未掘宝石施加于抽牌堆某牌）时，打出后自动再结算 N 次效果链
  const replayTimes = ctx.replay[card.id] ?? 0
  if (replayTimes > 0) {
    for (let i = 0; i < replayTimes; i++) {
      logs = logs.concat(resolveEffectChain(ctx, chain, { targetId, enchant: mods }))
    }
    ctx.log.push(`【${card.name}】重放 ${replayTimes} 次`)
    ctx.replay[card.id] = 0 // 层数一次性耗尽
  }
  ctx.log.push(`打出【${card.name}】`, ...logs)
  // 附魔一次性效果（墨影虚弱/腐化失去生命/迅速首抽/播种首能量/动量累计/黏糊格挡）
  ctx.log.push(...applyEnchantOnPlay(ctx, card, targetId))
  // 首次打出标记：迅速/播种/活力的首次触发已结算，置位避免再次触发
  st.firstPlayed = true
  // 打出后从手牌移除该实例（相同 id 可能有复数张，按实例 id 精确移除一张；兼容传入临时实例的场景）
  const handIdx = (() => {
    for (let i = ctx.hand.length - 1; i >= 0; i--) {
      if (ctx.hand[i]!.id === entry.id) return i
    }
    return -1
  })()
  if (handIdx >= 0) ctx.hand.splice(handIdx, 1)
  // 去向：消耗判断用"有效关键词"（灵魂之力移除消耗、黏糊追加消耗）+ 腐化（技能牌打出即消耗）；实例随之移动（保留升级状态）
  // 能力牌(power)强制进消耗堆：能力被动仅生效一次，打出即移除，不可再次抽到重打（杀戮尖塔规则）
  // 腐化：能力卡已打出时，技能牌打出即消耗（WarriorDeck.md 腐化）
  const corruptExhaust = card.type === 'skill' && ctx.powers.has('corruption')
  // 怀旧（无色能力卡）：每回合首次打出攻击或技能牌时，将其置于抽牌堆顶端而非弃牌堆
  // 抽牌堆"顶端" = 数组末尾（drawPile.pop 从尾部取，先入者先被抽到），故 push 即置顶
  const nostalgiaTop =
    (card.type === 'attack' || card.type === 'skill') &&
    ctx.powers.has('nostalgia') &&
    !ctx.nostalgiaUsedThisTurn
  if (hasCardKeyword(card, 'exhaust') || card.type === 'power' || corruptExhaust) {
    ctx.exhaustPile.push(entry)
    // 遗物"消耗牌"钩子：卡戎之灰对全体敌人 3 伤
    applyRelicsOnExhaust(ctx)
    // 能力卡被动"消耗时触发"钩子（黑暗之拥/无畏疼痛/战鼓）
    ctx.log.push(...onExhaustCard(ctx, entry))
  } else if (nostalgiaTop) {
    // 怀旧置顶：不丢弃，直接放回抽牌堆顶部（仅当回合首次攻击/技能触发一次）
    ctx.nostalgiaUsedThisTurn = true
    ctx.drawPile.push(entry)
    ctx.log.push('【怀旧】将本回合首张攻击/技能牌置于抽牌堆顶端')
  } else {
    ctx.discardPile.push(entry)
  }
  // 遗物"打出攻击牌"钩子：精致折扇/双截棍/苦无/手里剑/锁镰/风的女儿（按攻击累计张数结算）
  if (card.type === 'attack') applyRelicsOnPlayAttack(ctx)
  // 遗物"打出技能牌"钩子：开信刀/音叉（按技能累计张数结算）
  if (card.type === 'skill') applyRelicsOnPlaySkill(ctx)
  // 遗物"打出能力牌"钩子：棋子/永冻冰晶/迷失鬼火/彩虹戒指
  if (card.type === 'power') applyRelicsOnPlayPower(ctx)
  // 遗物"打出任意牌"钩子：波纹水盆/铁棒/骇人头盔（不区分牌类）
  applyRelicsOnPlayCard(ctx, card)
  // 音乐盒（遗物）：将每回合打出的第一张攻击牌的一张虚无复制品加入手牌
  // 用 relicState 记录本回合是否已触发，回合结束由 applyRelicsOnTurnEnd 复位
  if (
    card.type === 'attack' &&
    hasRelic(ctx, 'music_box') &&
    (ctx.relicState['music_box_this_turn'] as number | undefined) !== 1
  ) {
    ctx.relicState['music_box_this_turn'] = 1
    ctx.hand.push({ id: entry.id, upgrade: false })
    ctx.log.push(`[音乐盒] 将本回合首张攻击牌【${card.name}】的虚无复制品加入手牌`)
  }
  // 燃烧木棍（遗物）：每场战斗中第一次消耗技能牌时，将那张牌的复制品加入手牌
  // 打印出的技能牌若带"消耗"关键词，在此补一张同 id 复制品入手（消耗后才会走到此）
  if (
    card.type === 'skill' &&
    hasCardKeyword(card, 'exhaust') &&
    hasRelic(ctx, 'burning_stick') &&
    (ctx.relicState['burning_stick_used'] as number | undefined) !== 1
  ) {
    ctx.relicState['burning_stick_used'] = 1
    ctx.hand.push({ id: entry.id, upgrade: entry.upgrade })
    ctx.log.push(`[燃烧木棍] 首次消耗技能牌【${card.name}】，复制品加入手牌`)
  }
  return true
}

// 打出时的附魔一次性效果（不改变伤害结算，作为独立收益/代价）：
// 墨影虚弱 / 腐化失去生命 / 迅速首抽 / 播种首能量 / 动量累计 / 黏糊格挡
export function applyEnchantOnPlay(ctx: CombatContext, card: Card, targetId?: string): string[] {
  const logs: string[] = []
  const ench = enchantmentsOf(card)
  const st = enchantStateOf(ctx, card)
  for (const e of ench) {
    // 墨影：对攻击目标（缺省取首个存活敌人）施加虚弱
    if (e.applyWeak) {
      const target = targetId
        ? ctx.enemies.find((x) => x.id === targetId && x.alive)
        : ctx.enemies.find((x) => x.alive)
      if (target) {
        addStatus(target, 'weak', e.applyWeak)
        logs.push(`【墨影】对 ${target.name} 施加 ${e.applyWeak} 层虚弱`)
      }
    }
    // 腐化：打出后失去生命（可致死，按 PRD 失去生命处理）
    if (e.loseHp) {
      ctx.player.hp = Math.max(0, ctx.player.hp - e.loseHp)
      logs.push(`【腐化】失去 ${e.loseHp} 点生命`)
    }
    // 迅速：每场首次打出抽牌
    if (e.firstPlayDraw && !st.firstPlayed) {
      const drawn = drawCards(ctx, e.firstPlayDraw)
      logs.push(`【迅速】首次打出抽 ${drawn} 张牌`)
    }
    // 播种：每场首次打出获得能量
    if (e.firstPlayEnergy && !st.firstPlayed) {
      ctx.energy += e.firstPlayEnergy
      logs.push(`【播种】首次打出获得 ${e.firstPlayEnergy} 点能量`)
    }
    // 动量：本场每次打出后累计伤害加成（本次已用旧累计，结算后 +5）
    if (e.momentumPerPlay) {
      st.momentum = (st.momentum ?? 0) + e.momentumPerPlay
      logs.push(`【动量】该牌本场伤害 +${st.momentum}`)
    }
    // 黏糊：每次打出获得 1 点格挡（"格挡值永久 +1" MVP 简化为每次打出 +1 格挡）
    if (e.goopyBlock) {
      ctx.player.block += 1
      logs.push('【黏糊】获得 1 点格挡')
    }
  }
  return logs
}

// 注能附魔：战斗开始时自动打出（从抽牌堆/手牌中取出该牌并结算其效果链与一次性效果）
function playImbuedCards(ctx: CombatContext): void {
  // 汇总注能(autoPlayAtStart)牌目标：来自抽牌堆 或 手牌（首抽可能把它抽进手牌，也须自动打出）
  const targets: DeckCard[] = []
  for (const pile of [ctx.drawPile, ctx.hand]) {
    for (const en of [...pile]) {
      if (en) {
        const c = getCard(en.id)
        if (c && hasEnchant(c, 'autoPlayAtStart') && !targets.includes(en)) targets.push(en)
      }
    }
  }
  for (const entry of targets) {
    const card = getCard(entry.id)
    if (!card) continue
    // 从原堆移除（抽牌堆或手牌，可能已被先前注能牌的效果移走而找不到）
    const drawIdx = ctx.drawPile.indexOf(entry)
    if (drawIdx >= 0) ctx.drawPile.splice(drawIdx, 1)
    const handIdx = ctx.hand.indexOf(entry)
    if (handIdx >= 0) ctx.hand.splice(handIdx, 1)
    // 按正常打牌流程结算（附魔修正 + 效果链 + 一次性效果 + 首次标记）
    const mods = buildEnchantMods(ctx, card)
    const effects = entry.upgrade ? card.upgradeEffects : card.effects
    const chain = effects.length > 0 ? effects : fallbackEffect(card)
    const logs = resolveEffectChain(ctx, chain, { enchant: mods })
    const st = enchantStateOf(ctx, card)
    applyEnchantOnPlay(ctx, card)
    st.firstPlayed = true
    // 去向：消耗走消耗堆，否则弃牌堆（注能技能牌通常不消耗）
    if (hasCardKeyword(card, 'exhaust')) ctx.exhaustPile.push(entry)
    else ctx.discardPile.push(entry)
    ctx.log.push(`【${card.name}】注能：战斗开始自动打出`, ...logs)
  }
}

// 效果链为空时的兜底：空效果（数据转换未能解析的复杂牌直接跳过，UI 仍显示原文）
function fallbackEffect(_card: Card): EffectChain {
  return []
}

// 敌人回合：执行意图 → 回合结束
export function enemyTurn(ctx: CombatContext): void {
  ctx.isPlayerTurn = false
  for (const e of ctx.enemies) {
    if (!e.alive) continue
    // 招式冷却：每回合前递减 1 层（归零后该招恢复可用；数据定义时长见 ai.cooldowns）
    if (e.cooldowns) {
      for (const k of Object.keys(e.cooldowns)) {
        if (e.cooldowns[k]! > 0) e.cooldowns[k]!--
      }
    }
    // 蒸汽喷发：已触发"血量归零不死"后，下一回合自爆（瀑布巨兽，Underdocks.md §3.4）
    if (e.steamTriggered) {
      const blow = e.steamBlow ?? 0
      const actual = damageUnit(ctx.player, blow)
      ctx.log.push(`【蒸汽喷发】${e.name} 自爆！对玩家造成 ${actual} 点伤害`)
      e.hp = 0
      e.alive = false
      // 自爆是真死：走统一死亡结算（死亡召唤衍生物/击杀遗物），保证与普通死亡一致不丢奖励
      onEnemyDeath(ctx, e)
      continue
    }
    // 击晕/幻象复活等特殊状态处理：被击晕的本回合不行动，且跳过所有回合前被动结算
    // （尖叫/覆甲减层/仪式加力/狂怒判定都应在击晕判定之后，否则被击晕的回合仍会错误结算这些被动）
    if (getStatusAmount(e, 'stunned') > 0) {
      addStatus(e, 'stunned', -1)
      continue
    }
    // 尖叫（骇鳗专属）：生命值降至层数（=最大生命一半）时强制击晕一回合，并进入"恐吓"阶段
    const shriekAmt = getStatusAmount(e, 'shriek')
    if (shriekAmt > 0 && e.hp <= shriekAmt) {
      addStatus(e, 'stunned', 1)
      e.statuses = e.statuses.filter((s) => s.id !== 'shriek')
      // 阶段二：恐吓→撞击→撕扯 循环（替换阶段一的 scripted 撞击/撕扯交替）
      e.ai = { ...e.ai, mode: 'loop', sequence: ['恐吓', '撞击', '撕扯'] }
      ctx.log.push('【尖叫】骇鳗被击晕一回合，进入恐吓阶段')
    }
    // 覆甲：回合开始层数减 1（下水道蚌/乐加维林族母，Underdocks.md §3.2）
    if (getStatusAmount(e, 'plating') > 0) addStatus(e, 'plating', -1)
    // 仪式：每回合开始获得等同层数的力量（暗港念咒敌人，Underdocks.md §3）
    const ritualAmt = getStatusAmount(e, 'ritual')
    if (ritualAmt > 0) addStatus(e, 'strength', ritualAmt)
    // 横冲直撞（仪式兽专属）：血量降至层数时被击晕，清除该状态、重置力量并进入阶段二狂暴循环
    const rampageAmt = getStatusAmount(e, 'rampage')
    if (rampageAmt > 0 && e.hp <= rampageAmt) {
      addStatus(e, 'stunned', 1)
      e.statuses = e.statuses.filter((s) => s.id !== 'rampage')
      e.strength = 0
      // 阶段二：野兽咆哮→踩踏→碾碎 循环（替换阶段一的 scripted 踩地/横冲直撞）
      e.ai = { ...e.ai, mode: 'loop', sequence: ['野兽咆哮', '踩踏', '碾碎'] }
      ctx.log.push('【横冲直撞】仪式兽被击晕，进入疯狂阶段')
    }
    // 本回合刚因尖叫/横冲直撞触发而新被击晕的敌人：同样跳过本回合出招与后续被动结算
    // （此前首次击晕检查在其被施加前已完成，故此处需对"新眩晕"再判一次，保证当回合不吃出招）
    if (getStatusAmount(e, 'stunned') > 0) {
      addStatus(e, 'stunned', -1)
      continue
    }
    const move = e.intentName ? e.moves?.[e.intentName] : undefined
    if (move) {
      // 敌人招式：效果来源为 enemy，施法者为该敌人（self 增益归敌人，伤害目标为玩家）
      const logs = resolveEffectChain(ctx, move.effects, { source: 'enemy', actorId: e.id })
      ctx.log.push(`${e.name} 使用【${move.name}】`, ...logs)
      // 出招后按数据设定的冷却时长写入逐实例冷却（防连发；时长查共享 ai.cooldowns）
      const cdDur = e.ai?.cooldowns?.[e.intentName ?? ''] ?? 0
      if (cdDur > 0) {
        if (!e.cooldowns) e.cooldowns = {}
        e.cooldowns[e.intentName!] = cdDur
      }
    }
    e.turnCount++
    // 领地意识：回合结束获得力量
    if (getStatusAmount(e, 'territorial') > 0) addStatus(e, 'strength', 1)
    // 覆甲：回合结束获得等量格挡（减层后的当前值）
    const plating = getStatusAmount(e, 'plating')
    if (plating > 0) {
      e.block += plating
      ctx.log.push(`【覆甲】${e.name} 获得 ${plating} 点格挡`)
    }
  }
  // 回合结束结算：格挡清空（玩家）、状态层数递减
  endOfTurn(ctx)
}

// 回合结束：玩家格挡清空、状态回合递减（持续型状态）
// 在清理前接入遗物"回合结束"钩子（历石 52 伤 / 自成型黏土标记 / 恶魔之舌重置 / 冰淇淋记能量）
export function endOfTurn(ctx: CombatContext): void {
  applyRelicsOnTurnEnd(ctx)
  // 紧缠：回合结束时玩家受到层数点伤害（格挡可挡，战斗中持续生效；蛇行扼杀者 缠身施加）
  const constrictAmt = getStatusAmount(ctx.player, 'constricted')
  if (constrictAmt > 0) {
    damageUnit(ctx.player, constrictAmt)
    ctx.log.push(`【紧缠】回合结束受到 ${constrictAmt} 点伤害`)
  }
  // 壁垒：格挡不再回合结束消失（能力卡已打出时不清空格挡）
  if (ctx.player.block > 0 && COMBAT.blockExpires && !ctx.powers.has('barricade')) {
    ctx.player.block = 0
  }
  // 奥利哈钢：回合结束赠送的格挡要延续到对手回合，故在清除常规格挡后原样归还（防被上面清空白抹掉）
  const orichalcumCarry = (ctx.relicState['orichalcum_carry'] as number) ?? 0
  if (orichalcumCarry > 0) {
    ctx.player.block += orichalcumCarry
    ctx.relicState['orichalcum_carry'] = 0
  }
  for (const u of [ctx.player, ...ctx.enemies]) {
    u.statuses = u.statuses.filter((s) => {
      if (s.turns > 0) s.turns--
      return s.amount > 0 && s.turns !== 0
    })
  }
}

// 玩家回合结束时的"手牌结算"（在敌人回合前调用）：
// 1) 结算仍在手牌中的"内在 endOfTurn"效果（毒素/灼伤/腐朽/霉运/悔恨/债务/羞耻/疑虑等）；
// 2) 虚无(ethereal)牌本回合消耗（移入消耗堆）；
// 3) 保留(retain)牌留在手牌，其余全部移入弃牌堆；
// 4) 沉眠精华附魔：手牌中的该牌费用 -1（直到被打出）。
// opts.retainAll：符文金字塔——所有手牌保留（retain 之外的牌也不弃）
export function resolveHandEndOfTurn(ctx: CombatContext, opts: { retainAll?: boolean } = {}): void {
  // 惊逃：回合结束时随机打出手中一张攻击牌攻击随机敌人（在手牌结算前触发，此时攻击牌仍在手）
  playRandomHandAttack(ctx)
  const goDiscard: DeckCard[] = []
  const retain: DeckCard[] = []
  for (const entry of ctx.hand) {
    const card = getCard(entry.id)
    if (!card) {
      goDiscard.push(entry)
      continue
    }
    // 1) 内在 endOfTurn 触发：仍在手牌时结算（来源为玩家，目标为自身）
    for (const e of card.effects) {
      if (e.type === 'intrinsic' && e.trigger === 'endOfTurn') {
        resolveEffectChain(ctx, e.effects, { source: 'player' })
        ctx.log.push(`【${card.name}】回合结束时生效`)
      }
    }
    // 2) 虚无：本回合消耗（附魔不追加虚无，直接用基础关键词）
    if (card.keywords.includes('ethereal')) {
      ctx.exhaustPile.push(entry)
      ctx.log.push(`【${card.name}】虚无消耗`, ...onExhaustCard(ctx, entry))
      continue
    }
    // 3) 保留（含附魔"王室认证/稳定"追加的保留）、选择悖论指定保留，或全员保留：留手牌，否则弃掉
    if (opts.retainAll || ctx.retainHandCards?.has(entry.id) || hasCardKeyword(card, 'retain'))
      retain.push(entry)
    else goDiscard.push(entry)
    // 4) 沉眠精华：回合结束时若在手牌中，费用 -1（仅在保留后仍留在手牌的牌上生效）
    if (hasEnchant(card, 'reduceCostInHand')) {
      const st = enchantStateOf(ctx, card)
      st.costMod = (st.costMod ?? 0) - 1
      ctx.log.push(`【${card.name}】沉眠精华：费用 -1（当前 ${effectiveCost(ctx, card)}）`)
    }
  }
  ctx.discardPile.push(...goDiscard)
  ctx.hand = retain
}

// 惊逃辅助：能力卡已打出时，回合结束时从手牌随机取一张攻击牌，对随机敌人结算效果并出手
// 不消耗能量（惊逃为自动打出）；结算后该牌正常入弃牌堆/消耗堆，避免被手牌结算二次处理
function playRandomHandAttack(ctx: CombatContext): void {
  if (!ctx.powers?.has('frighten')) return
  const atkIdx: number[] = []
  ctx.hand.forEach((en, i) => {
    if (getCard(en.id)?.type === 'attack') atkIdx.push(i)
  })
  if (atkIdx.length === 0) return
  const idx = atkIdx[Math.floor(ctx.rng() * atkIdx.length)]!
  const entry = ctx.hand[idx]!
  const card = getCard(entry.id)
  if (!card) return
  // 随机挑一个存活敌人作为目标
  const alive = ctx.enemies.filter((e) => e.alive)
  const target = alive[Math.floor(ctx.rng() * alive.length)]
  // 从手牌移除该实例，结算其效果链后按去向归堆
  ctx.hand.splice(idx, 1)
  const chain = entry.upgrade ? card.upgradeEffects : card.effects
  const logs = resolveEffectChain(ctx, chain, { source: 'player', targetId: target?.id })
  ctx.log.push(`【惊逃】打出【${card.name}】`, ...logs)
  // 惊逃自动打出也是"打出攻击牌"：计入本回合攻击数并触发按攻击张数结算的遗物（精致折扇/苦无/双截棍等）
  ctx.attacksPlayedThisTurn++
  ctx.cardsThisTurn++
  applyRelicsOnPlayAttack(ctx)
  if (card.keywords.includes('exhaust')) {
    ctx.exhaustPile.push(entry)
    ctx.log.push(...onExhaustCard(ctx, entry))
  } else ctx.discardPile.push(entry)
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
  const unit = buildEnemyUnit(enemy, hp)
  unit.isPlayer = false
  unit.id = uniqueEnemyId(unit.id, (id) => ctx.enemies.some((e) => e.id === id))
  ctx.enemies.push(unit)
}
