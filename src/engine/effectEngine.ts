/**
 * 效果链引擎（agent.md §5.2 / PRD §3.3）
 * 负责解析并执行 Effect[]（卡牌效果/怪物招式/事件结算），是战斗结算的核心执行器。
 * 新增效果类型时必须在此实现执行逻辑，并在 tests/effectEngine.spec.ts 补测试。
 */
import type { CombatContext, CombatFx, CombatPickRequest, CombatUnit } from './combatEngine'
import type { Card, DeckCard, Effect, EffectChain, StatusId } from '@/types'
import { cardsData, getCard, getEnemy } from '@/data'
import { buildEnemyUnit, uniqueEnemyId } from './enemyAI'
import { STATUS_META } from '@/config/statusMeta'
import type { EnchantMods } from './enchantSystem'
import {
  applyClockworkBoots,
  applyPenNib,
  applyRelicsOnDamageTaken,
  applyRelicsOnEnemyDeath,
  applyRelicsOnPlayAttack,
  applyRelicsOnShuffle,
  applyRelicsOnStrengthGain,
  getState,
  hasRelic,
} from './relicSystem'

// 追加一条战斗特效（伤害数字跳动，PRD §5.3）：由结算点调用
export function pushFx(
  ctx: CombatContext,
  unitId: string,
  text: string,
  kind: CombatFx['kind'],
): void {
  ctx.fxId++
  ctx.fx.push({ id: ctx.fxId, unitId, text, kind })
  // 限制队列长度，防止无限增长（只保留最近 80 条）
  if (ctx.fx.length > 80) ctx.fx.splice(0, ctx.fx.length - 80)
}

// 效果来源：玩家出牌（默认）或敌人招式。来源不同，"enemy/self"的目标语义相反
export type EffectSource = 'player' | 'enemy'

// 执行效果链：依次对 ctx 生效；返回执行过程中产生的文本日志
// opts.source：效果来源（决定目标指向）；opts.actorId：来源为敌人时，指定"施法敌人"（用于 self 增益）
// opts.enchant：附魔修正（由 combatEngine.playCard 传入，把附魔伤害/格挡加成并入结算）
export function resolveEffectChain(
  ctx: CombatContext,
  effects: EffectChain,
  opts: {
    targetId?: string
    source?: EffectSource
    actorId?: string
    enchant?: EnchantMods
  } = {},
): string[] {
  const logs: string[] = []
  const { targetId, source = 'player', actorId, enchant } = opts
  for (const effect of effects) {
    logs.push(...applyEffect(ctx, effect, targetId, source, actorId, enchant))
  }
  return logs
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

// 解析单个效果的作用目标集合（支持单体/全体/随机），返回目标数组
// target 含义（来源为玩家）：'enemy'→所选 targetId 或首个存活敌人；'allEnemies'→全部存活敌人；
//   'randomEnemy'→随机一个存活敌人；'self'→玩家自己
// 来源为敌人时：攻击目标恒为玩家；'self' 加成归施法敌人
// 注意：dynamic 阶段（damage/damageScaling）需在每段命中时重新解析，以便 randomEnemy 每段独立随机选敌
function resolveTargets(
  ctx: CombatContext,
  target: string,
  targetId: string | undefined,
  source: EffectSource,
  actorId?: string,
): CombatUnit[] {
  if (source === 'enemy') {
    if (target === 'self') return [pickSelf(ctx, source, actorId) ?? ctx.player]
    return [ctx.player]
  }
  switch (target) {
    case 'allEnemies':
      return ctx.enemies.filter((e) => e.alive)
    case 'randomEnemy': {
      const alive = ctx.enemies.filter((e) => e.alive)
      return alive.length > 0 ? [alive[Math.floor(ctx.rng() * alive.length)]!] : []
    }
    case 'self':
      return [ctx.player]
    default: {
      const t = targetId
        ? ctx.enemies.find((e) => e.id === targetId && e.alive)
        : ctx.enemies.find((e) => e.alive)
      return t ? [t] : []
    }
  }
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
  enchant?: EnchantMods,
): string[] {
  const logs: string[] = []
  switch (effect.type) {
    case 'damage': {
      // 伤害结算：基础 + 力量 → 易伤 → 虚弱 → 缩小（PRD §3.3.3），多段攻击逐段结算
      // 附魔修正：锋利/特兹卡塔拉/活力/动量加在基础，腐化/本能乘进倍率链
      // 攻击方：玩家出牌 → 玩家；敌人招式 → 施法敌人
      const attacker =
        source === 'enemy' ? (pickSelf(ctx, source, actorId) ?? ctx.player) : ctx.player
      // 命中次数：X 费牌（旋风斩）次数 = 投入能量 + plus；普通牌为标准 hits 或 1
      const hits = effect.hitsFromX === true ? (ctx.lastXPaid ?? 0) : (effect.hits ?? 1)
      if (hits <= 0) break
      // 钢笔尖遗物：每第 10 张攻击牌双倍（PRD §3.8）；仅玩家攻击牌触发，敌招式不受影响
      const penNibMul = source === 'player' ? applyPenNib(ctx) : 1
      // 附魔基础伤害加成 + 附魔倍率（与钢笔尖/易伤/虚弱同链相乘）
      let base = effect.amount + (source === 'player' ? (enchant?.damage ?? 0) : 0)
      // 遗物攻击加成（微型大炮=升级攻击+3、打击木偶/打击木偶？？？=名字含"打击"+3/+1）：
      // 由 combatEngine.playCard 在结算攻击牌前把总加成写入 atk_bonus_this_play，此处按攻击实例消费
      if (source === 'player') {
        base += (ctx.relicState['atk_bonus_this_play'] as number) ?? 0
      }
      // 活力：本张攻击牌伤害 + 活力层数，随后消耗该状态（活力作用于一次攻击，用后即消失）
      const vigorAmt = getStatusAmount(attacker, 'vigor')
      if (vigorAmt > 0) {
        base += vigorAmt
        addStatus(attacker, 'vigor', -vigorAmt)
      }
      const mult = penNibMul * (source === 'player' ? (enchant?.damageMult ?? 1) : 1)
      // 多目标：每段命中重新解析目标集合，使 allEnemies→全体、randomEnemy→每段独立随机选敌都能正确生效
      for (let i = 0; i < hits; i++) {
        const targets = resolveTargets(ctx, effect.target, targetId, source, actorId)
        for (const target of targets) {
          const dmg = calculateFinalDamage(attacker, target, base, mult, ctx)
          // 发条靴：玩家攻击造成 ≤4 点未格挡伤害时提升为 5（按格挡保持消耗、未格挡部分补足）
          const dmgToInflict = applyClockworkBoots(ctx, source, target, dmg)
          // 结算前存活状态（用于判断本次攻击是否击杀敌人，触发地精之角等击杀遗物）
          const wasAlive = target.alive
          const actual = damageUnit(target, dmgToInflict)
          // 手钻：玩家攻击"突破敌人格挡"（有未格挡伤害命中）时，给予该敌人 2 层易伤
          // 判据：actual>0 即本段伤害未被完全格挡；仅玩家攻击敌人且拥有该遗物时触发
          if (
            source === 'player' &&
            !target.isPlayer &&
            actual > 0 &&
            hasRelic(ctx, 'hand_drill')
          ) {
            addStatus(target, 'vulnerable', 2)
            const vs = target.statuses.find((st) => st.id === 'vulnerable')
            if (vs) vs.turns = 2 // 与 applyStatus 分支一致：易伤有限持续 2 回合
            logs.push(`【手钻】突破 ${target.name} 的格挡，给予 2 层易伤`)
            pushFx(ctx, target.id, '+2 易伤', 'buff')
          }
          // 伤害数字跳动（PRD §5.3）：挂目标单位（玩家/敌人共用）
          pushFx(ctx, target.id, `-${actual}`, 'damage')
          logs.push(`对 ${target.name} 造成 ${actual} 点伤害`)
          // 遗物"受伤"钩子：玩家被真实伤害命中时（恶魔之舌回血/百年积木抽牌/自成型黏土标记）
          if (target.isPlayer && actual > 0) applyRelicsOnDamageTaken(ctx, actual)
          // 敌人本次被打到 hp≤0：先判定"蒸汽喷发"（血量归零假死、下回合自爆）。
          // 若是假死则只复活、不执行任何死亡结算；否则才视为真正死亡，走统一死亡结算（击杀遗物/死亡召唤）。
          // ★修复时序（原先 onEnemyDeath 在蒸汽复活之前执行）：假死瞬间会误发击杀奖励/召唤衍生物，
          //   而真正的自爆（combatEngine.enemyTurn 直接置 alive=false）反而绕过统一结算导致真死奖励丢失。
          if (!target.isPlayer && wasAlive && !target.alive) {
            const steamAmt = getStatusAmount(target, 'steam')
            if (steamAmt > 0 && target.steamTriggered !== true) {
              target.steamTriggered = true
              target.steamBlow = steamAmt
              target.hp = 999999999 // 重置为"无限"，下一回合自爆（Underdocks.md §3.4）
              target.alive = true
              // 净化所有负面状态（仅清掉玩家侧的负面效果，蒸汽层数保留）
              target.statuses = target.statuses.filter(
                (s) =>
                  !(
                    s.id === 'vulnerable' ||
                    s.id === 'weak' ||
                    s.id === 'frail' ||
                    s.id === 'shrink' ||
                    s.id === 'tangled' ||
                    s.id === 'constricted' ||
                    s.id === 'ringing'
                  ),
              )
              logs.push(
                `【蒸汽喷发】${target.name} 生命归零却未死，下回合自爆（将造成 ${steamAmt} 点伤害）`,
              )
            } else {
              // 真正死亡：击杀遗物（地精之角）+ 死亡召唤衍生物（意外/寄生物等）
              onEnemyDeath(ctx, target)
            }
          }
          // 吮吸：敌人造成未被格挡的伤害（actual>0）时，按层数获得力量（化石追踪者，Underdocks.md §3.2）
          if (target.isPlayer && actual > 0 && source === 'enemy') {
            const sucker = pickSelf(ctx, source, actorId)
            const suckAmt = sucker ? getStatusAmount(sucker, 'suck') : 0
            if (sucker && suckAmt > 0) {
              addStatus(sucker, 'strength', suckAmt)
              logs.push(`【吮吸】${sucker.name} 造成伤害，获得 ${suckAmt} 点力量`)
            }
          }
          // 荆棘反伤：目标持有荆棘时，对攻击方反弹层数伤害（每段攻击各反伤一次）
          // 通用作用于玩家与敌人（铜质鳞片/蟾蜍蝌蚪/棘刺蟾蜍等赋予），"受到攻击时"即每次命中结算
          const thornAmt = getStatusAmount(target, 'thorns')
          if (thornAmt > 0) {
            const reflected = damageUnit(attacker, thornAmt)
            pushFx(ctx, attacker.id, `-${reflected}`, 'damage')
            logs.push(`【荆棘】${target.name} 反伤 ${reflected} 点伤害给 ${attacker.name}`)
          }
        } // 关闭内层目标循环（resolveTargets 解析出的每个目标都完成一次伤害结算）
      }
      break
    }
    case 'damageScaling': {
      // 缩放伤害：数值来源在运行时求值（block/已打牌数/消耗堆/牌组数等）；附魔伤害加成同样并入
      const attacker =
        source === 'enemy' ? (pickSelf(ctx, source, actorId) ?? ctx.player) : ctx.player
      let base = effect.base + (source === 'player' ? (enchant?.damage ?? 0) : 0)
      // 缩放数值：按 scaling 来源在运行时求值（与目标无关者循环外一次求值）
      switch (effect.scaling) {
        case 'block':
          base += attacker.block // 全身撞击：造成当前格挡值的伤害
          break
        case 'cardsPlayed':
          base += ctx.cardsPlayedTotal // 金斧等
          break
        case 'exhaustPile':
          base += ctx.exhaustPile.length * 3 // 灰烬打击：每张消耗牌 +3
          break
        case 'deckSize':
          base += attacker.drawPile.length // 心灵震慑
          break
        case 'strikeCount': {
          // 完美打击：整副牌中名字含"打击"的牌每张 +2（手牌+抽牌堆+弃牌堆+消耗堆都计）
          const strikeNamed = [
            ...ctx.hand,
            ...ctx.drawPile,
            ...ctx.discardPile,
            ...ctx.exhaustPile,
          ].filter((en) => (getCard(en.id)?.name ?? '').includes('打击')).length
          base += strikeNamed * 2
          break
        }
        // statusOnTarget：敌易伤层数 ×2，属目标相关加成，在目标循环内按每个目标单独求值
      }
      const penNibMul = source === 'player' ? applyPenNib(ctx) : 1
      const mult = penNibMul * (source === 'player' ? (enchant?.damageMult ?? 1) : 1)
      const hits = effect.hits ?? 1
      // 多目标：每段命中重新解析目标集合（allEnemies→全体、randomEnemy→逐段随机选敌）
      for (let i = 0; i < hits; i++) {
        const targets = resolveTargets(ctx, effect.target, targetId, source, actorId)
        for (const target of targets) {
          // statusOnTarget：针对当前目标易伤层数追加伤害（欺凌/拆卸等单目标缩放攻击）
          const dmgBase =
            effect.scaling === 'statusOnTarget'
              ? base + statusAmount(target, 'vulnerable') * 2
              : base
          const dmg = calculateFinalDamage(attacker, target, dmgBase, mult, ctx)
          // 发条靴：玩家攻击造成 ≤4 点未格挡伤害时提升为 5（与 damage 分支一致）
          const dmgToInflict = applyClockworkBoots(ctx, source, target, dmg)
          const wasAlive = target.alive
          const actual = damageUnit(target, dmgToInflict)
          // 手钻：突破敌人格挡时给予 2 层易伤（缩放攻击同样触发）
          if (
            source === 'player' &&
            !target.isPlayer &&
            actual > 0 &&
            hasRelic(ctx, 'hand_drill')
          ) {
            addStatus(target, 'vulnerable', 2)
            const vs = target.statuses.find((st) => st.id === 'vulnerable')
            if (vs) vs.turns = 2
            logs.push(`【手钻】突破 ${target.name} 的格挡，给予 2 层易伤`)
            pushFx(ctx, target.id, '+2 易伤', 'buff')
          }
          pushFx(ctx, target.id, `-${actual}`, 'damage')
          logs.push(`对 ${target.name} 造成 ${actual} 点伤害`)
          if (target.isPlayer && actual > 0) applyRelicsOnDamageTaken(ctx, actual)
          if (!target.isPlayer && wasAlive && !target.alive) onEnemyDeath(ctx, target)
          // 吮吸：敌人造成未被格挡的伤害时按层数获得力量（与 damage 分支对齐，scaling 攻击同样生效）
          if (target.isPlayer && actual > 0 && source === 'enemy') {
            const sucker = pickSelf(ctx, source, actorId)
            const suckAmt = sucker ? getStatusAmount(sucker, 'suck') : 0
            if (sucker && suckAmt > 0) {
              addStatus(sucker, 'strength', suckAmt)
              logs.push(`【吮吸】${sucker.name} 造成伤害，获得 ${suckAmt} 点力量`)
            }
          }
          // 荆棘反伤：目标持有荆棘时对攻击方反弹层数伤害（与 damage 分支一致）
          const thornAmt = getStatusAmount(target, 'thorns')
          if (thornAmt > 0) {
            const reflected = damageUnit(attacker, thornAmt)
            pushFx(ctx, attacker.id, `-${reflected}`, 'damage')
            logs.push(`【荆棘】${target.name} 反伤 ${reflected} 点伤害给 ${attacker.name}`)
          }
        } // 关闭内层目标循环
      }
      break
    }
    case 'block': {
      // 格挡获得 = 基础 + 敏捷（×脆弱修正）；敌人招式获得格挡时归施法敌人
      // 附魔修正：伶俐/灵巧的格挡加成并入基础（先加再乘脆弱）
      const unit = source === 'enemy' ? (pickSelf(ctx, source, actorId) ?? ctx.player) : ctx.player
      let base = effect.amount + (unit === ctx.player ? (enchant?.blockBonus ?? 0) : 0)
      // 坚定不移：玩家每回合第一次从卡牌获得的格挡翻倍（能力卡已打出时生效，回合开始重置）
      if (unit === ctx.player && ctx.powers?.has('adamant') && !ctx.blockDoubledThisTurn) {
        base *= 2
        ctx.blockDoubledThisTurn = true
        logs.push('【坚定不移】本回合首次格挡翻倍')
      }
      // 臂甲：每场战斗中玩家第一次从卡牌获得的格挡值翻倍（relic.md 臂甲，PASSIVE，整场战斗仅一次）
      if (unit === ctx.player && hasRelic(ctx, 'bracer') && getState(ctx, 'bracer_used') === 0) {
        base *= 2
        ctx.relicState['bracer_used'] = 1
        logs.push('【臂甲】本场首次卡牌格挡翻倍')
      }
      // 不安油灯：本张牌（能给予敌人负面状态）的格挡类副效果是否翻倍由各分支自行处理；此处仅格挡
      const amount = Math.max(
        0,
        Math.floor(
          (base + (unit === ctx.player ? unit.dexterity : 0)) * getMultiplier(unit, 'frail'),
        ),
      )
      unit.block += amount
      // 格挡数字跳动
      pushFx(ctx, unit.id, `+${amount} 格挡`, 'block')
      logs.push(`${unit.name} 获得 ${amount} 点格挡`)
      // 势不可当：玩家每获得格挡时，对一名随机敌人造成 6/8 点伤害（能力卡已打出时生效）
      if (unit === ctx.player && amount > 0 && ctx.powers?.has('unstoppable')) {
        const alive = ctx.enemies.filter((e) => e.alive)
        const victim = alive[Math.floor(ctx.rng() * alive.length)]
        if (victim) {
          const dmg = calculateFinalDamage(
            ctx.player,
            victim,
            ctx.powers.get('unstoppable') ? 8 : 6,
            1,
            ctx,
          )
          const actual = damageUnit(victim, dmg)
          pushFx(ctx, victim.id, `-${actual}`, 'damage')
          logs.push(`【势不可当】对 ${victim.name} 造成 ${actual} 点伤害`)
        }
      }
      break
    }
    case 'draw': {
      // 抽牌：从抽牌堆顶部取牌进手牌，不足则洗回弃牌堆；"本回合不再抽牌"时忽略（战斗专注）
      if (ctx.noDrawThisTurn) {
        logs.push('本回合不再抽牌（忽略抽牌效果）')
        break
      }
      const drawn = drawCards(ctx, effect.count)
      logs.push(`抽 ${drawn} 张牌`)
      break
    }
    case 'gainEnergy': {
      // 跃跃欲试后本回合不再获得额外能量
      if (ctx.noEnergyGainThisTurn) {
        logs.push('本回合不再获得额外能量（忽略）')
        break
      }
      ctx.energy += effect.amount
      logs.push(`获得 ${effect.amount} 点能量`)
      break
    }
    case 'loseEnergy': {
      ctx.energy = Math.max(0, ctx.energy - effect.amount)
      break
    }
    case 'applyStatus': {
      // 施加状态（易伤/虚弱/力量等）；目标按来源解析：self → 施法者，allEnemies → 对侧全体，enemy → 所选/首个存活
      const targets = resolveTargets(ctx, effect.target, targetId, source, actorId)
      if (targets.length === 0) return logs
      for (const t of targets) {
        let amount = effect.amount
        // 遗物"力量获得"钩子：损毁头盔使玩家每场第一次获得的力量翻倍（仅玩家出牌施加给自己力量时）
        if (t === ctx.player && effect.status === 'strength' && source === 'player') {
          amount = applyRelicsOnStrengthGain(ctx, amount)
        }
        // 不安油灯：本张牌（首个给敌方负面状态的牌）对敌人施加的负面状态层数翻倍（relic.md 不安油灯）
        if (ctx.doubleEnemyStatusThisPlay && !t.isPlayer && source === 'player') {
          amount *= 2
        }
        addStatus(t, effect.status, amount, 999)
        // 易伤/虚弱/脆弱为"回合结束衰减"型负面增益，应有限持续：覆盖为 2 回合，令 combatEngine.endOfTurn 的
        // turns-- 衰减真正生效（此前统一 999 造成永不衰减，衰减逻辑成死代码，与 statusMeta 描述矛盾）
        if (
          (effect.status === 'vulnerable' ||
            effect.status === 'weak' ||
            effect.status === 'frail') &&
          amount > 0
        ) {
          const s = t.statuses.find((st) => st.id === effect.status)
          if (s) s.turns = 2
        }
        // buff 数字跳动（力量/敏捷等正面状态显示金色）
        pushFx(ctx, t.id, `+${amount} ${statusName(effect.status)}`, 'buff')
        logs.push(`${t.name} 获得 ${amount} 层${statusName(effect.status)}`)
      }
      // 凶恶：每当玩家给予敌人易伤时抽牌（1 张，升级后 2 张；能力卡已打出时生效）
      // 仅在"本次施加了易伤层数"到至少一个敌人时触发一次，其余状态不触发
      if (
        effect.status === 'vulnerable' &&
        effect.amount > 0 &&
        source === 'player' &&
        ctx.powers?.has('vicious') &&
        targets.some((t) => !t.isPlayer)
      ) {
        const drawn = drawCards(ctx, ctx.powers.get('vicious') ? 2 : 1)
        logs.push(`【凶恶】给予易伤，抽 ${drawn} 张牌`)
      }
      break
    }
    case 'heal': {
      // 治疗：不超过最大生命
      const before = ctx.player.hp
      ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + effect.amount)
      const healed = ctx.player.hp - before
      pushFx(ctx, ctx.player.id, `+${healed} 生命`, 'heal')
      logs.push(`回复 ${healed} 点生命`)
      break
    }
    case 'loseHp': {
      // 失去生命（不经过格挡）
      ctx.player.hp = Math.max(0, ctx.player.hp - effect.amount)
      pushFx(ctx, ctx.player.id, `-${effect.amount}`, 'damage')
      logs.push(`失去 ${effect.amount} 点生命`)
      logs.push(...onPlayerLoseHp(ctx, effect.amount))
      break
    }
    case 'loseHpHandSize': {
      // 失去等同于当前手牌数量的生命（诅咒·悔恨）
      const amount = ctx.hand.length
      ctx.player.hp = Math.max(0, ctx.player.hp - amount)
      pushFx(ctx, ctx.player.id, `-${amount}`, 'damage')
      logs.push(`失去 ${amount} 点生命（手牌数）`)
      logs.push(...onPlayerLoseHp(ctx, amount))
      break
    }
    case 'retainHandThisTurn': {
      // 本回合保留手牌：标记，由结算端在回合结束手牌结算时读取（均衡/箭雨）
      ctx.retainHandThisTurn = true
      logs.push('本回合保留手牌')
      break
    }
    case 'grantReplay': {
      // 未掘宝石：给抽牌堆中一张"无重放"的随机牌施加 effect.count 层重放，之后打出该牌自动再结算
      const candidates = ctx.drawPile.filter((en) => !((ctx.replay[en.id] ?? 0) > 0))
      const target =
        candidates.length > 0 ? candidates[Math.floor(ctx.rng() * candidates.length)] : undefined
      if (target) {
        ctx.replay[target.id] = effect.count
        logs.push(`给予【${target.id}】${effect.count} 层重放`)
      } else {
        logs.push('抽牌堆无可用目标（未施加重放）')
      }
      break
    }
    case 'intrinsic': {
      // 内在/触发类效果不被"打出"生效，而是由 trigger 时机（回合结束/抽到时）单独结算。
      // 此处正常打牌解析到它时不产生任何即时效果（状态/诅咒牌本就不可打出）。
      break
    }
    case 'addCard': {
      // 向指定牌堆加入卡牌（敌人洗入状态牌等）；新加入均为未升级实例
      const cardId = effect.cardId
      const inst = { id: cardId, upgrade: false }
      if (effect.to === 'hand') ctx.hand.push(inst)
      else if (effect.to === 'draw') ctx.drawPile.push(inst)
      else if (effect.to === 'discard') ctx.discardPile.push(inst)
      else ctx.exhaustPile.push(inst)
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
    case 'chooseAdd': {
      // 选择一张牌加入手牌：构造候选列表挂到 ctx.pendingPicks，由 store 桥接选牌浮层
      const req = buildChooseAddRequest(ctx, effect)
      if (req) {
        ctx.pendingPicks.push(req)
        logs.push('请选择一张牌加入手牌')
      }
      break
    }
    case 'nextAttacksExtra': {
      // 连环拳：累计"本回合接下来攻击额外生效"次数，由 combatEngine.playCard 的攻击分支逐张消耗
      ctx.nextAttacksExtra = (ctx.nextAttacksExtra ?? 0) + effect.count
      logs.push(`本回合接下来 ${effect.count} 张攻击牌将额外生效一次`)
      break
    }
    case 'upgradeHand': {
      // 武装：升级手牌中的卡牌。未经升级的武装随机升级 count 张，升级后的武装升级全部（WarriorDeck.md）
      const candidates =
        effect.all === true
          ? [...ctx.hand]
          : shuffle(ctx.hand, ctx.rng).slice(0, Math.min(effect.count, ctx.hand.length))
      for (const en of candidates) en.upgrade = true
      logs.push(`升级手牌中 ${candidates.length} 张卡牌`)
      break
    }
    case 'moveDiscardToTop': {
      // 头槌：将弃牌堆中随机 count 张牌放到抽牌堆顶部（本引擎抽牌堆使用 pop 从尾部抽，push 即顶部）
      const count = effect.count ?? 1
      const pool = shuffle(ctx.discardPile, ctx.rng)
      const moved = pool.slice(0, Math.min(count, pool.length))
      for (const en of moved) {
        const idx = ctx.discardPile.indexOf(en)
        if (idx >= 0) ctx.discardPile.splice(idx, 1)
        ctx.drawPile.push(en)
      }
      logs.push(`将弃牌堆 ${moved.length} 张牌放到抽牌堆顶部`)
      break
    }
    case 'nextAttackFree': {
      // 无情猛攻：累计"打出的下一张攻击牌耗能变为 0"次数，由 combatEngine.playCard 对后续攻击牌消费
      ctx.nextAttackFree = (ctx.nextAttackFree ?? 0) + effect.count
      logs.push(`你打出的下一张攻击牌耗能变为 0`)
      break
    }
    case 'playTopXCards': {
      // 倾泻：打出抽牌堆顶部的 N 张牌，N = 本卡投入的 X 能量 + plus（升级 +1）
      const count = (ctx.lastXPaid ?? 0) + (effect.plus ?? 0)
      logs.push(...playTopNCards(ctx, count, '倾泻'))
      break
    }
    case 'playRandomFromDraw': {
      // 横祸：从抽牌堆随机打出 count 张牌（先洗乱抽牌堆再打顶部 count 张，等效随机抽打）
      if (ctx.drawPile.length > 1) ctx.drawPile = shuffle(ctx.drawPile, ctx.rng)
      logs.push(...playTopNCards(ctx, effect.count, '横祸'))
      break
    }
    case 'playRandomAttacksFromDiscard': {
      // 狠揍：打出弃牌堆中的 count 张随机攻击牌（复活牌按各自效果结算，通常带消耗）
      const pending: DeckCard[] = []
      for (const en of ctx.discardPile) {
        const c = getCard(en.id)
        if (c && c.type === 'attack') pending.push(en)
      }
      // 随机洗乱攻击牌候选池，取前 count 张逐一复活打出
      const chosen = shuffle(pending, ctx.rng).slice(0, Math.min(effect.count, pending.length))
      for (const entry of chosen) {
        const idx = ctx.discardPile.indexOf(entry)
        if (idx >= 0) ctx.discardPile.splice(idx, 1)
        const card = getCard(entry.id)
        if (!card) continue
        const chain = entry.upgrade ? card.upgradeEffects : card.effects
        logs.push(`【狠揍】打出【${card.name}】`)
        logs.push(...resolveEffectChain(ctx, chain, { source: 'player' }))
        // 去向：按"该牌是否消耗"归堆（复活打出的牌遵循原关键词，通常消耗）
        if (card.keywords.includes('exhaust')) {
          ctx.exhaustPile.push(entry)
          logs.push(...onExhaustCard(ctx, entry))
        } else ctx.discardPile.push(entry)
      }
      logs.push(`【狠揍】从弃牌堆打出 ${chosen.length} 张随机攻击牌`)
      break
    }
    case 'transformHandAttacks': {
      // 原始力量：将手牌中的所有攻击牌变化成一张随机战士攻击牌（巨石数据缺失，按项目降级约定随机攻击牌）
      const pool = cardsData.warrior.filter((c) => c.type === 'attack')
      if (pool.length === 0) {
        logs.push('无可变化目标（无随机攻击牌池）')
        break
      }
      const transformed: string[] = []
      for (const entry of ctx.hand) {
        const c = getCard(entry.id)
        if (c && c.type === 'attack') {
          const pick = pool[Math.floor(ctx.rng() * pool.length)]!
          entry.id = pick.id // 覆盖实例 id 即完成"变化"
          transformed.push(pick.name)
        }
      }
      logs.push(`变化手牌中 ${transformed.length} 张攻击牌为随机攻击牌`)
      break
    }
    case 'doubleStatus': {
      // 翻倍目标身上的某状态层数（熔融之拳：给敌人添上当前易伤层数，即翻倍）
      const target = (resolveTargets(ctx, effect.target, targetId, source, actorId) ?? [])[0]
      if (!target) break
      const cur = getStatusAmount(target, effect.status)
      if (cur > 0) {
        addStatus(target, effect.status, cur)
        logs.push(`将 ${target.name} 的${statusName(effect.status)}翻倍至 ${cur * 2} 层`)
      }
      break
    }
    case 'strengthFromTargetVulnerable': {
      // 主宰：敌人每有一层易伤，就获得 1 点力量（读取目标当前易伤层数）
      const target = (resolveTargets(ctx, effect.target, targetId, source, actorId) ?? [])[0]
      if (target) {
        const n = statusAmount(target, 'vulnerable')
        if (n > 0) {
          addStatus(ctx.player, 'strength', n)
          logs.push(`【主宰】依据 ${target.name} 的 ${n} 层易伤获得 ${n} 点力量`)
        }
      }
      break
    }
    case 'gainEnergyPerHandAttack': {
      // 跃跃欲试：手牌中每张攻击牌获得 amount 能量，并禁止本回合后续额外能量
      const atkCount = ctx.hand.filter((en) => getCard(en.id)?.type === 'attack').length
      ctx.energy += atkCount * effect.amount
      if (effect.blockFurther) ctx.noEnergyGainThisTurn = true
      logs.push(
        `每张手牌攻击牌获得 ${effect.amount} 点能量（${atkCount} 张），共 ${atkCount * effect.amount} 点`,
      )
      if (effect.blockFurther) logs.push('本回合不再获得额外能量')
      break
    }
    case 'noDraw': {
      // 战斗专注：本回合不再抽牌（置标记，后续 draw 效果被忽略）
      ctx.noDrawThisTurn = true
      logs.push('本回合不再抽牌')
      break
    }
    case 'drawUntilNonAttack': {
      // 劫掠：抽牌直到抽到一张非攻击牌（至少抽 1 张；若全为攻击则一直抽）
      const startLen = ctx.hand.length
      for (;;) {
        // 抽牌堆为空则洗回弃牌堆（沿用手牌洗牌遗物钩子，保持与 drawCards 一致）
        if (ctx.drawPile.length === 0) {
          if (ctx.discardPile.length === 0) break
          ctx.drawPile.push(...shuffle(ctx.discardPile, ctx.rng))
          ctx.discardPile.length = 0
          applyRelicsOnShuffle(ctx)
          // 计策（无色能力卡）：洗牌时选择一张牌放入手牌
          logs.push(...applyPowerOnShuffle(ctx))
        }
        const entry = ctx.drawPile.pop()
        if (!entry) break
        const c = getCard(entry.id)
        ctx.hand.push(entry)
        if (c && c.type !== 'attack') break // 抽到非攻击牌后停止
      }
      logs.push(`抽牌直至抽到非攻击牌（共抽 ${ctx.hand.length - startLen} 张）`)
      break
    }
    case 'gainIfExhausted': {
      // 被遗忘的仪式/邪眼：本回合消耗过卡牌才生效的增益（能量或格挡）
      if (!ctx.exhaustedThisTurn) {
        logs.push('本回合未消耗过卡牌，不生效')
        break
      }
      if (effect.gain === 'energy') {
        ctx.energy += effect.amount
        logs.push(`因本回合消耗过卡牌，获得 ${effect.amount} 点能量`)
      } else {
        ctx.player.block += effect.amount
        logs.push(`因本回合消耗过卡牌，获得 ${effect.amount} 点格挡`)
      }
      break
    }
    case 'blockPerNonAttackExhausted': {
      // 重振精神：消耗手牌中所有非攻击牌，每张获得 amount 格挡
      const nonAtk = ctx.hand.filter((en) => (getCard(en.id)?.type ?? '') !== 'attack')
      for (const en of nonAtk) {
        ctx.hand.splice(ctx.hand.indexOf(en), 1)
        ctx.exhaustPile.push(en)
        ctx.exhaustedThisTurn = true
        logs.push(...onExhaustCard(ctx, en))
      }
      ctx.player.block += nonAtk.length * effect.amount
      logs.push(`消耗 ${nonAtk.length} 张非攻击牌，获得 ${nonAtk.length * effect.amount} 点格挡`)
      break
    }
    case 'spawnEnemy': {
      // 召唤衍生物登入战斗（雾菇 虚幻孢子 召唤 1 只利齿之眼等）
      const def = getEnemy(effect.enemyId)
      if (!def) {
        logs.push(`无法召唤：${effect.enemyId} 数据缺失`)
        break
      }
      const times = effect.count ?? 1
      for (let i = 0; i < times; i++) {
        const unit = buildEnemyUnit(def, undefined, ctx.rng)
        unit.isPlayer = false
        unit.id = uniqueEnemyId(unit.id, (id) => ctx.enemies.some((e) => e.id === id))
        ctx.enemies.push(unit)
        logs.push(`召唤【${def.name}】`)
      }
      break
    }
  }
  return logs
}

// 倾泻/横祸/乱战辅助：从抽牌堆顶部逐张打出 count 张牌（不额外扣能量）
// 每张牌解析其效果链（攻击缺省打首个存活敌人），结算后正常入弃牌堆/消耗堆
// label 为触发来源描述（倾泻/横祸/乱战），用于日志
export function playTopNCards(ctx: CombatContext, count: number, label = '倾泻'): string[] {
  const logs: string[] = []
  for (let i = 0; i < count; i++) {
    // 抽牌堆不足时洗回弃牌堆（与 drawCards 的洗牌遗物钩子一致）
    if (ctx.drawPile.length === 0) {
      if (ctx.discardPile.length === 0) break
      ctx.drawPile.push(...shuffle(ctx.discardPile, ctx.rng))
      ctx.discardPile.length = 0
      applyRelicsOnShuffle(ctx)
      // 计策（无色能力卡）：抽牌堆打乱洗牌时，选择一张牌放入手牌（抽牌堆洗回弃牌堆也属"打乱洗牌"）
      ctx.log.push(...applyPowerOnShuffle(ctx))
    }
    const entry = ctx.drawPile.pop()
    if (!entry) break
    const card = getCard(entry.id)
    if (!card) {
      ctx.discardPile.push(entry)
      continue
    }
    // 按该张牌的升级态取效果链并结算（攻击牌自动取首个存活敌人为目标）
    const chain = entry.upgrade ? card.upgradeEffects : card.effects
    logs.push(`【${label}】打出【${card.name}】`)
    logs.push(...resolveEffectChain(ctx, chain, { source: 'player' }))
    // 去向：消耗关键词走消耗堆，否则弃牌堆
    if (card.keywords.includes('exhaust')) {
      ctx.exhaustPile.push(entry)
      logs.push(...onExhaustCard(ctx, entry))
    } else ctx.discardPile.push(entry)
  }
  return logs
}

// ===== 无色能力卡"洗牌时触发"被动钩子（计策） =====

// 计策：每当抽牌堆打乱洗牌（弃牌堆洗回抽牌堆）时，从抽牌堆选择一张牌加入手牌
// 在 drawCards / playTopNCards / drawUntilNonAttack 等洗牌点（applyRelicsOnShuffle 之后）调用
export function applyPowerOnShuffle(ctx: CombatContext): string[] {
  const logs: string[] = []
  if (!ctx.powers?.has('stratagem')) return logs
  // 复用 chooseAdd 机制构造"从抽牌堆选一张牌入手"的挂起选牌请求
  const req = buildChooseAddRequest(ctx, { type: 'chooseAdd', filter: 'anyInDraw', count: 1 })
  if (req) {
    ctx.pendingPicks.push(req)
    logs.push('【计策】抽牌堆洗牌，请选择一张牌加入手牌')
  }
  return logs
}

// ===== "选择一张牌加入手牌"候选构造（chooseAdd 效果） =====

// 按 chooseAdd 效果构造选牌请求：根据 filter 生成候选列表并分配 action
// 候选为空时返回 null（调用方不挂起，等于无条件跳过）
function buildChooseAddRequest(
  ctx: CombatContext,
  effect: Extract<Effect, { type: 'chooseAdd' }>,
): CombatPickRequest | null {
  const count = effect.count ?? 1
  const action = effect.free ? 'addToHandFree' : 'addToHand'
  let cards: Card[] = []
  switch (effect.filter) {
    case 'seek':
      // 探寻打击：抽牌堆随机 N 张
      cards = pickDistinct(
        ctx.drawPile.map((en) => getCard(en.id)).filter((c): c is Card => Boolean(c)),
        count,
        ctx.rng,
      )
      break
    case 'random':
      // 发现：全局随机 N 张（无色 + 战士非基础/先古）
      cards = pickDistinct(
        [
          ...cardsData.colorless,
          ...cardsData.warrior.filter((c) => c.rarity !== 'basic' && c.rarity !== 'ancient'),
        ],
        count,
        ctx.rng,
      )
      break
    case 'attack':
      // 飞溅：本职业随机 N 张攻击牌（MVP 单角色）
      cards = pickDistinct(
        cardsData.warrior.filter((c) => c.type === 'attack'),
        count,
        ctx.rng,
      )
      break
    case 'skillInDraw':
      // 秘密技法：抽牌堆中的技能牌
      cards = ctx.drawPile
        .map((en) => getCard(en.id))
        .filter((c): c is Card => Boolean(c))
        .filter((c) => c.type === 'skill')
      break
    case 'attackInDraw':
      // 秘密武器：抽牌堆中的攻击牌
      cards = ctx.drawPile
        .map((en) => getCard(en.id))
        .filter((c): c is Card => Boolean(c))
        .filter((c) => c.type === 'attack')
      break
    case 'anyInDraw':
      // 许愿：抽牌堆全部牌
      cards = ctx.drawPile.map((en) => getCard(en.id)).filter((c): c is Card => Boolean(c))
      break
  }
  // 候选去重（抽牌堆里可能多张同名）
  const seen = new Set<string>()
  cards = cards.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)))
  if (cards.length === 0) return null
  return { pickId: ++ctx.pickSeq, title: '选择一张牌加入手牌', cards, action }
}

// 敌人死亡结算：遗物"击杀"钩子（地精之角等） + "死亡时召唤衍生物"（意外/寄生物等，Underdocks.md §3.2）
// 导出：除伤害分支外，蒸汽喷发自爆真死（combatEngine.enemyTurn）也复用此统一结算，保证真死奖励/召唤不丢失
export function onEnemyDeath(ctx: CombatContext, target: CombatUnit): void {
  applyRelicsOnEnemyDeath(ctx)
  for (const sp of target.spawns ?? []) {
    if (sp.condition !== 'onDeath') continue
    const def = getEnemy(sp.id)
    if (!def) continue
    for (let i = 0; i < sp.count; i++) {
      const unit = buildEnemyUnit(def, undefined, ctx.rng)
      unit.isPlayer = false
      unit.id = uniqueEnemyId(unit.id, (id) => ctx.enemies.some((e) => e.id === id))
      ctx.enemies.push(unit)
      ctx.log.push(`【意外】${target.name} 死亡时召唤【${def.name}】`)
    }
  }
}

// 从候选列表中随机取至多 n 张（去重后；用注入 rng 保证可测）
function pickDistinct(list: Card[], n: number, rng: () => number): Card[] {
  return shuffle([...list], rng).slice(0, Math.min(n, list.length))
}

// ===== 伤害/状态基础工具（combatEngine 复用） =====

// 最终伤害：⌊(基础 + 力量) × 易伤(×1.5) × 虚弱(×0.75) × 缩小(×0.7) × 其他倍率⌋（PRD §3.3.3）
// ctx 可选：用于纸蛙遗物把易伤倍率从 1.5 提升到 1.75
export function calculateFinalDamage(
  attacker: CombatUnit,
  target: CombatUnit,
  base: number,
  extraMultiplier = 1,
  ctx?: CombatContext,
): number {
  const raw = Math.max(0, base + attacker.strength)
  // 残忍（残酷）：敌人有易伤时额外倍率——升级 +50%，普通 +25%（能力卡已打出时生效）
  const cruelty =
    ctx &&
    !target.isPlayer &&
    ctx.powers?.has('cruelty') &&
    getStatusAmount(target, 'vulnerable') > 0
      ? ctx.powers.get('cruelty')
        ? 1.5
        : 1.25
      : 1
  const mul =
    getMultiplier(target, 'vulnerable', ctx) * // 易伤：受伤方
    getMultiplier(attacker, 'weak') * // 虚弱：攻击方
    getMultiplier(attacker, 'shrink') * // 缩小：攻击方
    cruelty * // 残酷：对易伤敌人额外倍率
    extraMultiplier
  // 钻石头冠：玩家本回合打出牌 ≤2 张时，受到的敌人伤害减半（relic.md §四·诺奴佩普）
  const crown =
    target.isPlayer && ctx && hasRelic(ctx, 'diamond_crown') && ctx.cardsThisTurn <= 2 ? 0.5 : 1
  // 无实体：伤害降为 1
  if (getStatusAmount(target, 'intangible') > 0) return 1
  return Math.floor(raw * mul * crown)
}

// 状态倍率查询（易伤/虚弱/缩小等）
// ctx 仅易伤使用：纸蛙遗物（paper_frog）把易伤倍率从 1.5 提升到 1.75
export function getMultiplier(
  unit: CombatUnit,
  statusId: 'vulnerable' | 'weak' | 'frail' | 'shrink',
  ctx?: CombatContext,
): number {
  const amount = getStatusAmount(unit, statusId)
  if (amount <= 0) return 1
  switch (statusId) {
    case 'vulnerable':
      // 持有纸蛙时易伤倍率由 1.5 提升至 1.75（PRD §3.8）
      return ctx && hasRelic(ctx, 'paper_frog') ? 1.75 : 1.5
    case 'weak':
      return 0.75
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

// 负面状态集合：人工制品可抵消的"负面增益"（正面增益与减层不进此集合）
const NEGATIVE_STATUS = new Set<StatusId>([
  'vulnerable',
  'weak',
  'frail',
  'confused',
  'constricted',
  'tangled',
  'shrink',
  'ringing',
  'stunned',
  'smoggy',
])

// 添加状态：同 ID 叠加层数；力量/敏捷同步到单位字段（伤害/格挡结算读取字段，保证一致）
export function addStatus(unit: CombatUnit, statusId: string, amount: number, turns = 999): void {
  // 人工制品：抵消 1 次负面状态（拳击构装体等；负面增益对抗效果，Underdocks.md §4）
  // 仅在"新增负面（amount>0）且目标持有未耗尽的人工制品"时抵消，增益与减层不受影响
  if (amount > 0 && NEGATIVE_STATUS.has(statusId as StatusId)) {
    const artifact = unit.statuses.find((st) => st.id === 'artifact')
    if (artifact && artifact.amount > 0) {
      artifact.amount--
      return
    }
  }
  const s = unit.statuses.find((st) => st.id === statusId)
  if (s) s.amount += amount
  else if (amount > 0) unit.statuses.push({ id: statusId as never, amount, turns })
  // 目标无该状态且为减层/归零（amount<=0）时，不插入负值幽灵条目（仅同步 strength/dexterity 字段）
  // 力量/敏捷字段同步（PRD §3.3.3 伤害公式直接使用）
  if (statusId === 'strength') unit.strength += amount
  if (statusId === 'dexterity') unit.dexterity += amount
}

// 扣血（经过格挡）：返回实际损失的生命（PRD §3.3.3 结算顺序：伤害 → 扣格挡 → 扣血）
// 暗港专属：硬化外壳（hard_shell）——目标每回合失去的生命值不超过其层数（鬼祟珊瑚群诸）
export function damageUnit(target: CombatUnit, damage: number): number {
  const blocked = Math.min(target.block, damage)
  target.block -= blocked
  let hpLoss = damage - blocked
  // 滑溜：下一次失去生命时只失去 1 点（完全格挡不消耗层数）
  if (hpLoss > 0 && getStatusAmount(target, 'slippery') > 0) {
    setStatusAmount(target, 'slippery', getStatusAmount(target, 'slippery') - 1)
    hpLoss = Math.min(1, hpLoss)
  }
  // 硬化外壳：本回合累计损失封顶（已封顶的生命计入 target.hardShellUsedThisTurn）
  const shell = getStatusAmount(target, 'hard_shell')
  if (shell > 0) {
    const remaining = Math.max(0, shell - (target.hardShellUsedThisTurn ?? 0))
    if (hpLoss > remaining) hpLoss = remaining
    target.hardShellUsedThisTurn = (target.hardShellUsedThisTurn ?? 0) + hpLoss
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
// 抽到"抽到触发"类卡牌（如虚空）时结算其 onDraw 内在效果
export function drawCards(ctx: CombatContext, count: number): number {
  let drawn = 0
  for (let i = 0; i < count; i++) {
    if (ctx.drawPile.length === 0) {
      if (ctx.discardPile.length === 0) break
      ctx.drawPile.push(...shuffle(ctx.discardPile, ctx.rng))
      ctx.discardPile.length = 0
      // 大～抱抱：抽牌堆打乱洗牌（弃牌堆洗回）时加入一张煤灰（relic.md）
      applyRelicsOnShuffle(ctx)
      // 计策（无色能力卡）：洗牌时选择一张牌放入手牌
      ctx.log.push(...applyPowerOnShuffle(ctx))
    }
    const card = ctx.drawPile.pop()
    if (card) {
      ctx.hand.push(card)
      drawn++
      // 结算抽到触发（虚空：抽到失去 1 点能量）
      applyOnDraw(ctx, card.id)
      // 地狱狂徒：抽到名字含"打击"的牌时，对一名随机敌人自动打出（无需能量）
      applyHellZealot(ctx, card)
    }
  }
  return drawn
}

// 结算某张牌的"抽到触发"（onDraw 内在效果）：按卡牌数据中的 intrinsic.trigger==='onDraw' 分发
function applyOnDraw(ctx: CombatContext, cardId: string): void {
  const card = getCard(cardId)
  if (!card) return
  for (const e of card.effects) {
    if (e.type === 'intrinsic' && e.trigger === 'onDraw') {
      // 目标为玩家自身（如 虚空 失去 1 点能量），使用玩家来源解析
      resolveEffectChain(ctx, e.effects, { source: 'player' })
    }
  }
}

// 地狱狂徒辅助：能力卡已打出时，抽到的牌名含"打击"则对随机敌人自动打出
// 不消耗能量（抽到即打）；结算后该牌从手牌移除并按去向入弃牌堆/消耗堆
function applyHellZealot(ctx: CombatContext, entry: DeckCard): void {
  if (!ctx.powers?.has('hell_zealot')) return
  const card = getCard(entry.id)
  if (!card || !card.name.includes('打击')) return
  const alive = ctx.enemies.filter((e) => e.alive)
  if (alive.length === 0) return
  const target = alive[Math.floor(ctx.rng() * alive.length)]!
  const chain = entry.upgrade ? card.upgradeEffects : card.effects
  const logs = resolveEffectChain(ctx, chain, { source: 'player', targetId: target.id })
  ctx.log.push(`【地狱狂徒】打出【${card.name}】攻击 ${target.name}`, ...logs)
  // 地狱狂徒自动打出也是"打出攻击牌"：计入本回合攻击数并触发按攻击张数结算的遗物（精致折扇/苦无等）
  ctx.attacksPlayedThisTurn++
  ctx.cardsThisTurn++
  applyRelicsOnPlayAttack(ctx)
  // 从手牌移除该实例并按去向归堆
  const idx = ctx.hand.findIndex((h) => h === entry)
  if (idx >= 0) ctx.hand.splice(idx, 1)
  if (card.keywords.includes('exhaust')) {
    ctx.exhaustPile.push(entry)
    ctx.log.push(...onExhaustCard(ctx, entry))
  } else ctx.discardPile.push(entry)
}

// 玩家回合内失去生命时的被动能力卡钩子（撕裂/狱火）：
// 仅当处于玩家回合（isPlayerTurn）时触发，敌人回合中玩家受击不会触发（WarriorDeck.md）
// 由 loseHp 效果、回合开始绯红披风/狱火自伤等调用方在扣血后调用
export function onPlayerLoseHp(ctx: CombatContext, amount: number): string[] {
  const logs: string[] = []
  if (!ctx.isPlayerTurn || !amount || amount <= 0) return logs
  // 撕裂：每当你在你的回合失去生命时获得力量（升级 2，未升级 1）
  if (ctx.powers?.has('rend')) {
    const gained = ctx.powers.get('rend') ? 2 : 1
    addStatus(ctx.player, 'strength', gained)
    pushFx(ctx, ctx.player.id, `+${gained} 力量`, 'buff')
    logs.push(`【撕裂】失去生命，获得 ${gained} 点力量`)
  }
  // 狱火：每当你在你的回合失去生命时，对所有敌人造成 6/9 点伤害
  if (ctx.powers?.has('hellfire')) {
    const dmg = ctx.powers.get('hellfire') ? 9 : 6
    for (const e of ctx.enemies.filter((x) => x.alive)) {
      const final = calculateFinalDamage(ctx.player, e, dmg, 1, ctx)
      const actual = damageUnit(e, final)
      pushFx(ctx, e.id, `-${actual}`, 'damage')
      logs.push(`【狱火】对 ${e.name} 造成 ${actual} 点伤害`)
    }
  }
  return logs
}

// 有牌被"消耗"时的被动能力卡钩子（黑暗之拥/无畏疼痛/战鼓）：
// 由各消耗入口（打出消耗牌、虚无、倾泻、惊逃、地狱狂徒等）在把牌推入消耗堆时调用
export function onExhaustCard(ctx: CombatContext, entry: DeckCard): string[] {
  // 记录"本回合消耗过卡牌"（被遗忘的仪式/邪眼等"本回合消耗过"条件增益判断）
  ctx.exhaustedThisTurn = true
  const logs: string[] = []
  // 黑暗之拥：每当有一张牌被消耗时，抽 1 张牌（能力卡已打出时生效）
  if (ctx.powers?.has('dark_embrace')) {
    const drawn = drawCards(ctx, 1)
    logs.push(`【黑暗之拥】抽 ${drawn} 张牌`)
  }
  // 无畏疼痛：每当有一张牌被消耗时，获得 3/4 点格挡（能力卡已打出时生效）
  if (ctx.powers?.has('fearless_pain')) {
    const amount = ctx.powers.get('fearless_pain') ? 4 : 3
    ctx.player.block += amount
    pushFx(ctx, ctx.player.id, `+${amount} 格挡`, 'block')
    logs.push(`【无畏疼痛】获得 ${amount} 点格挡`)
  }
  // 战鼓：这张牌被消耗时，获得 2/3 点能量（仅在该牌本身被消耗时触发）
  if (entry.id === 'war_drum' && ctx.powers?.has('war_drum')) {
    const amount = entry.upgrade ? 3 : 2
    ctx.energy += amount
    logs.push(`【战鼓】被消耗，获得 ${amount} 点能量`)
  }
  return logs
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

// 状态中文名（UI/日志）：复用共享状态元数据，避免重复文案
function statusName(id: string): string {
  return STATUS_META[id as StatusId]?.name ?? id
}
