/**
 * 效果链引擎（agent.md §5.2 / PRD §3.3）
 * 负责解析并执行 Effect[]（卡牌效果/怪物招式/事件结算），是战斗结算的核心执行器。
 * 新增效果类型时必须在此实现执行逻辑，并在 tests/effectEngine.spec.ts 补测试。
 */
import type { CombatContext, CombatUnit } from './combatEngine'
import type { Effect, EffectChain } from '@/types'

// 效果来源：玩家出牌（默认）或敌人招式。来源不同，"enemy/self"的目标语义相反
export type EffectSource = 'player' | 'enemy'

// 执行效果链：依次对 ctx 生效；返回执行过程中产生的文本日志
// opts.source：效果来源（决定目标指向）；opts.actorId：来源为敌人时，指定"施法敌人"（用于 self 增益）
export function resolveEffectChain(
  ctx: CombatContext,
  effects: EffectChain,
  opts: { targetId?: string; source?: EffectSource; actorId?: string } = {},
): string[] {
  const logs: string[] = []
  const { targetId, source = 'player', actorId } = opts
  for (const effect of effects) {
    logs.push(...applyEffect(ctx, effect, targetId, source, actorId))
  }
  return logs
}

// 解析效果目标：来源为玩家时，"enemy"= 场上敌人；来源为敌人时，"enemy"= 玩家
function pickTarget(
  ctx: CombatContext,
  targetId: string | undefined,
  source: EffectSource,
  _actorId?: string,
): CombatUnit | undefined {
  if (source === 'enemy') {
    // 敌人招式：目标是玩家（MVP 单人模式）；self 增益目标 = 施法敌人
    return ctx.player
  }
  if (targetId) {
    return ctx.enemies.find((e) => e.id === targetId && e.alive)
  }
  return ctx.enemies.find((e) => e.alive)
}

// 施法者本体（来源为敌人时 = actorId 对应敌人；来源为玩家时 = 玩家）
function pickSelf(
  ctx: CombatContext,
  source: EffectSource,
  actorId?: string,
): CombatUnit | undefined {
  if (source === 'enemy') {
    return ctx.enemies.find((e) => e.id === actorId && e.alive) ?? ctx.enemies[0]
  }
  return ctx.player
}

// 从目标敌人身上读取状态层数（如易伤层数，用于 damageScaling）
function statusAmount(unit: CombatUnit, statusId: string): number {
  const s = unit.statuses.find((st) => st.id === statusId)
  return s ? s.amount : 0
}

// 应用单个效果（switch 分发）
function applyEffect(
  ctx: CombatContext,
  effect: Effect,
  targetId: string | undefined,
  source: EffectSource,
  actorId?: string,
): string[] {
  const logs: string[] = []
  switch (effect.type) {
    case 'damage': {
      // 伤害结算：基础 + 力量 → 易伤 → 虚弱 → 缩小（PRD §3.3.3），多段攻击逐段结算
      const target = pickTarget(ctx, targetId, source, actorId)
      if (!target) return logs
      // 攻击方：玩家出牌 → 玩家；敌人招式 → 施法敌人
      const attacker =
        source === 'enemy' ? (pickSelf(ctx, source, actorId) ?? ctx.player) : ctx.player
      const hits = effect.hits ?? 1
      for (let i = 0; i < hits; i++) {
        const dmg = calculateFinalDamage(attacker, target, effect.amount, 1)
        const actual = damageUnit(target, dmg)
        logs.push(`对 ${target.name} 造成 ${actual} 点伤害`)
      }
      break
    }
    case 'damageScaling': {
      // 缩放伤害：数值来源在运行时求值（block/已打牌数/消耗堆/牌组数等）
      const target = pickTarget(ctx, targetId, source, actorId)
      if (!target) return logs
      const attacker =
        source === 'enemy' ? (pickSelf(ctx, source, actorId) ?? ctx.player) : ctx.player
      let value = effect.base
      switch (effect.scaling) {
        case 'block':
          value += attacker.block // 全身撞击：造成当前格挡值的伤害
          break
        case 'cardsPlayed':
          value += ctx.cardsPlayedTotal // 金斧等
          break
        case 'exhaustPile':
          value += ctx.exhaustPile.length * 3 // 灰烬打击：每张消耗牌 +3
          break
        case 'deckSize':
          value += attacker.drawPile.length // 心灵震慑
          break
        case 'statusOnTarget':
          value += statusAmount(target, 'vulnerable') * 2 // 欺凌等
          break
      }
      const hits = effect.hits ?? 1
      for (let i = 0; i < hits; i++) {
        const dmg = calculateFinalDamage(attacker, target, value, 1)
        const actual = damageUnit(target, dmg)
        logs.push(`对 ${target.name} 造成 ${actual} 点伤害`)
      }
      break
    }
    case 'block': {
      // 格挡获得 = 基础 + 敏捷（×脆弱修正）；敌人招式获得格挡时归施法敌人
      const unit = source === 'enemy' ? (pickSelf(ctx, source, actorId) ?? ctx.player) : ctx.player
      const amount = Math.max(
        0,
        Math.floor(
          (effect.amount + (unit === ctx.player ? unit.dexterity : 0)) *
            getMultiplier(unit, 'frail'),
        ),
      )
      unit.block += amount
      logs.push(`${unit.name} 获得 ${amount} 点格挡`)
      break
    }
    case 'draw': {
      // 抽牌：从抽牌堆顶部取牌进手牌，不足则洗回弃牌堆
      const drawn = drawCards(ctx, effect.count)
      logs.push(`抽 ${drawn} 张牌`)
      break
    }
    case 'gainEnergy': {
      ctx.energy += effect.amount
      logs.push(`获得 ${effect.amount} 点能量`)
      break
    }
    case 'loseEnergy': {
      ctx.energy = Math.max(0, ctx.energy - effect.amount)
      break
    }
    case 'applyStatus': {
      // 施加状态（易伤/虚弱/力量等）；目标按来源解析：self → 施法者，allEnemies → 对侧全体
      let targets: CombatUnit[]
      if (effect.target === 'self') {
        targets = [pickSelf(ctx, source, actorId) ?? ctx.player]
      } else if (effect.target === 'allEnemies') {
        targets = source === 'enemy' ? [ctx.player] : ctx.enemies.filter((e) => e.alive)
      } else {
        targets = [pickTarget(ctx, targetId, source, actorId) ?? ctx.player]
      }
      for (const t of targets) {
        addStatus(t, effect.status, effect.amount, 999)
        logs.push(`${t.name} 获得 ${effect.amount} 层${statusName(effect.status)}`)
      }
      break
    }
    case 'heal': {
      // 治疗：不超过最大生命
      const before = ctx.player.hp
      ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + effect.amount)
      logs.push(`回复 ${ctx.player.hp - before} 点生命`)
      break
    }
    case 'loseHp': {
      // 失去生命（不经过格挡）
      ctx.player.hp = Math.max(0, ctx.player.hp - effect.amount)
      logs.push(`失去 ${effect.amount} 点生命`)
      break
    }
    case 'addCard': {
      // 向指定牌堆加入卡牌（敌人洗入状态牌等）
      const cardId = effect.cardId
      if (effect.to === 'hand') ctx.hand.push(cardId)
      else if (effect.to === 'draw') ctx.drawPile.push(cardId)
      else if (effect.to === 'discard') ctx.discardPile.push(cardId)
      else ctx.exhaustPile.push(cardId)
      logs.push(
        `将 ${cardId} 加入${effect.to === 'hand' ? '手牌' : effect.to === 'draw' ? '抽牌堆' : effect.to === 'discard' ? '弃牌堆' : '消耗堆'}`,
      )
      break
    }
    case 'exhaust': {
      // 消耗当前打出牌：由 playCard 调用方处理，此处仅记录
      logs.push('消耗此牌')
      break
    }
    case 'gainMaxHp': {
      ctx.player.maxHp += effect.amount
      ctx.player.hp += effect.amount
      break
    }
    case 'loseMaxHp': {
      ctx.player.maxHp = Math.max(1, ctx.player.maxHp - effect.amount)
      ctx.player.hp = Math.min(ctx.player.hp, ctx.player.maxHp)
      break
    }
    case 'gainGold': {
      ctx.gold = (ctx.gold ?? 0) + effect.amount
      break
    }
    case 'loseGold': {
      ctx.gold = Math.max(0, (ctx.gold ?? 0) - effect.amount)
      break
    }
    case 'upgrade': {
      // 升级卡牌（战斗内少见，事件/篝火用）：标记牌组中指定数量卡牌
      ctx.upgradeQueue = (ctx.upgradeQueue ?? 0) + effect.count
      logs.push(`升级 ${effect.count} 张牌（待选择）`)
      break
    }
    case 'transform': {
      ctx.transformQueue = (ctx.transformQueue ?? 0) + effect.count
      logs.push(`变化 ${effect.count} 张牌（待选择）`)
      break
    }
    case 'removeCard': {
      ctx.removeQueue = (ctx.removeQueue ?? 0) + effect.count
      logs.push(`移除 ${effect.count} 张牌（待选择）`)
      break
    }
  }
  return logs
}

// ===== 伤害/状态基础工具（combatEngine 复用） =====

// 最终伤害：⌊(基础 + 力量) × 易伤(×1.5) × 虚弱(×0.75) × 缩小(×0.7) × 其他倍率⌋（PRD §3.3.3）
export function calculateFinalDamage(
  attacker: CombatUnit,
  target: CombatUnit,
  base: number,
  extraMultiplier = 1,
): number {
  const raw = Math.max(0, base + attacker.strength)
  const mul =
    getMultiplier(target, 'vulnerable') * // 易伤：受伤方
    getMultiplier(attacker, 'weak') * // 虚弱：攻击方
    getMultiplier(attacker, 'shrink') * // 缩小：攻击方
    extraMultiplier
  // 无实体：伤害降为 1
  if (getStatusAmount(target, 'intangible') > 0) return 1
  return Math.floor(raw * mul)
}

// 状态倍率查询（易伤/虚弱/缩小等）
export function getMultiplier(
  unit: CombatUnit,
  statusId: 'vulnerable' | 'weak' | 'frail' | 'shrink',
): number {
  const amount = getStatusAmount(unit, statusId)
  if (amount <= 0) return 1
  switch (statusId) {
    case 'vulnerable':
      return 1.5 // 纸蛙遗物可提升至 1.75（relicSystem 中处理）
    case 'weak':
      return 0.75 // 纸鹤遗物可降低至 0.6
    case 'frail':
      return 0.75
    case 'shrink':
      return 0.7
  }
}

// 读取单位状态层数（找不到返回 0）
export function getStatusAmount(unit: CombatUnit, statusId: string): number {
  const s = unit.statuses.find((st) => st.id === statusId)
  return s ? s.amount : 0
}

// 添加状态：同 ID 叠加层数；力量/敏捷同步到单位字段（伤害/格挡结算读取字段，保证一致）
export function addStatus(unit: CombatUnit, statusId: string, amount: number, turns = 999): void {
  const s = unit.statuses.find((st) => st.id === statusId)
  if (s) s.amount += amount
  else unit.statuses.push({ id: statusId as never, amount, turns })
  // 力量/敏捷字段同步（PRD §3.3.3 伤害公式直接使用）
  if (statusId === 'strength') unit.strength += amount
  if (statusId === 'dexterity') unit.dexterity += amount
}

// 扣血（经过格挡）：返回实际损失的生命（PRD §3.3.3 结算顺序：伤害 → 扣格挡 → 扣血）
export function damageUnit(target: CombatUnit, damage: number): number {
  const blocked = Math.min(target.block, damage)
  target.block -= blocked
  let hpLoss = damage - blocked
  // 滑溜：下一次失去生命时只失去 1 点（完全格挡不消耗层数）
  if (hpLoss > 0 && getStatusAmount(target, 'slippery') > 0) {
    setStatusAmount(target, 'slippery', getStatusAmount(target, 'slippery') - 1)
    hpLoss = Math.min(1, hpLoss)
  }
  target.hp = Math.max(0, target.hp - hpLoss)
  if (target.hp <= 0) target.alive = false
  return hpLoss
}

function setStatusAmount(unit: CombatUnit, statusId: string, amount: number): void {
  const s = unit.statuses.find((st) => st.id === statusId)
  if (s) s.amount = amount
}

// 抽牌：从抽牌堆取 count 张进手牌，抽牌堆不足时洗回弃牌堆（保留顺序随机）
export function drawCards(ctx: CombatContext, count: number): number {
  let drawn = 0
  for (let i = 0; i < count; i++) {
    if (ctx.drawPile.length === 0) {
      if (ctx.discardPile.length === 0) break
      ctx.drawPile.push(...shuffle(ctx.discardPile, ctx.rng))
      ctx.discardPile.length = 0
    }
    const card = ctx.drawPile.pop()
    if (card) {
      ctx.hand.push(card)
      drawn++
    }
  }
  return drawn
}

// Fisher–Yates 洗牌（注入 rng，保证可测）
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    // 交换 a[i] 与 a[j]（noUncheckedIndexedAccess 下用非空断言）
    const tmp = a[i] as T
    a[i] = a[j] as T
    a[j] = tmp
  }
  return a
}

// 状态中文名（UI/日志）
function statusName(id: string): string {
  const map: Record<string, string> = {
    vulnerable: '易伤',
    weak: '虚弱',
    frail: '脆弱',
    strength: '力量',
    dexterity: '敏捷',
    block: '格挡',
    armor: '覆甲',
    thorns: '荆棘',
    constricted: '紧缠',
    tangled: '缠结',
    shrink: '缩小',
    ringing: '昏眩',
    stunned: '击晕',
  }
  return map[id] ?? id
}
