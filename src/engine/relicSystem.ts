/**
 * 遗物系统（agent.md §3 engine/relicSystem / PRD §3.8）
 * 遗物为被动道具，通过事件钩子（trigger）在特定时机触发效果，核心机制：
 * - 数据驱动：data/relics.json 定义遗物 id/名称/触发钩子/描述；引擎不写魔法数值。
 * - 注册：registerRelic(id, fn) 把效果逻辑绑定到具体遗物 id（按 id 而非 trigger，规避同一触发器多个遗物冲突）。
 * - 触发：triggerRelicEffects(trigger, ctx, relics) 由调用方（gameStore 等）传入已解析的遗物数据数组，
 *   钩子内对每个对应 trigger 的遗物派发到注册函数；未注册的仅记日志（可扩展）。
 * - 公式层钩子（纸蛙倍率/钢笔尖双倍/红酒壶力量/冰淇淋结转/自成型黏土）只依赖 ctx.relics（id 数组），
 *   由 effectEngine/combatEngine 直接调用，无需遗物数据。
 * MVP 已实现 data/relics.json 中 warrior+general+ancient 三个池的全部效果（PRD §3.8 32 件）。
 */
import type { CombatContext, CombatUnit } from './combatEngine'
import {
  addStatus,
  damageUnit,
  drawCards,
  pushFx,
  resolveEffectChain,
  shuffle,
} from './effectEngine'
import { cardsData, getCard } from '@/data'
import type { Card, Relic, RelicTrigger, StatusId } from '@/types'

// 遗物效果函数：接收遗物数据与战斗上下文，就地修改 ctx（无需返回值）
export type RelicEffectFn = (relic: Relic, ctx: CombatContext) => void

// 遗物效果注册表：遗物 id → 效果函数（启动时注册；重复 id 后注册者覆盖）
const registry = new Map<string, RelicEffectFn>()

// 注册遗物效果（在游戏启动 / combos 初始化时调用一次）
export function registerRelic(id: string, fn: RelicEffectFn): void {
  registry.set(id, fn)
}

// 判断玩家是否持有指定遗物（公式层钩子高频调用，仅查 id 数组）
export function hasRelic(ctx: CombatContext, id: string): boolean {
  return ctx.relics.includes(id)
}

// ===== 触发分发 =====
// 触发某一钩子的全部遗物效果：返回期间产生的日志
// relics 由调用方解析好（含 excluded 过滤），此处按 trigger 分发
export function triggerRelicEffects(
  trigger: RelicTrigger,
  ctx: CombatContext,
  relics: Relic[],
): string[] {
  const logs: string[] = []
  for (const relic of relics) {
    if (relic.trigger !== trigger || relic.excluded) continue
    const fn = registry.get(relic.id)
    if (!fn) {
      logs.push(`[遗物] ${relic.name} 效果未实现（数据已记录）`)
      continue
    }
    fn(relic, ctx)
    logs.push(`[遗物] ${relic.name} 生效`)
  }
  return logs
}

// 简化的 id 级触发：仅对持有且匹配 trigger 的遗物派发（用于战斗内无数据可查的低频钩子）
export function triggerRelicEffectsById(
  trigger: RelicTrigger,
  ctx: CombatContext,
  resolve: (id: string) => Relic | undefined,
): string[] {
  const relics = ctx.relics.map((id) => resolve(id)).filter((r): r is Relic => Boolean(r))
  return triggerRelicEffects(trigger, ctx, relics)
}

// ===== 内部计数工具（relicState，不持久化） =====
function bumpState(ctx: CombatContext, key: string, delta = 1): number {
  const cur = (ctx.relicState[key] as number) ?? 0
  ctx.relicState[key] = cur + delta
  return cur + delta
}

export function getState(ctx: CombatContext, key: string): number {
  return (ctx.relicState[key] as number) ?? 0
}

// 随机攻击牌池（供十字弓等"随机攻击牌入手"类遗物取样；MVP 单角色取战士攻击牌）
function getAttackPool(): Card[] {
  return cardsData.warrior.filter((c) => c.type === 'attack')
}

// 负面状态 ID 集合（供不安油灯"能给予敌人负面状态的牌"判定使用）
// 与 effectEngine.NEGATIVE_STATUS 保持一致：易伤/虚弱/脆弱/混乱/纠缠/缩小/鸣响/眩晕/迷雾
export const NEGATIVE_STATUS_SET = new Set<StatusId>([
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

// 发条靴：每当你造成 ≤4 点"未被格挡"的攻击伤害时，将伤害提升为 5（relic.md 发条靴，PASSIVE）
// 仅在玩家攻击敌人的伤害实例上生效；计算方式：先算会被格挡挡住的部分，再判断未格挡部分是否在 1~4 之间。
// 若命中则把补到 5，但保持格挡消耗不变（返回的 dmg 值交 damageUnit 结算，格挡照常抵扣）。
export function applyClockworkBoots(
  ctx: CombatContext,
  source: 'player' | 'enemy',
  target: CombatUnit,
  dmg: number,
): number {
  if (source !== 'player' || target.isPlayer || !hasRelic(ctx, 'clockwork_boots')) return dmg
  const blocked = Math.min(target.block, dmg) // 会被格挡挡下的部分
  const unblocked = dmg - blocked // 命中的未格挡伤害
  // 未格挡伤害 >0 且 ≤4 → 整体提到"格挡部分 + 至少 5"，即保证未格挡伤害命中 5
  if (unblocked > 0 && unblocked <= 4) return blocked + 5
  return dmg
}

// 微型大炮/打击木偶的攻击加成：计算 attack 牌应享受的额外基础伤害（relic.md，PASSIVE）
// 微型大炮=升级的攻击牌 +3；打击木偶=名字含"打击" +3；打击木偶？？？=名字含"打击" +1
// 返回需写入 atk_bonus_this_play 的数值；若无相关遗物返回 0，避免多余日志污染伤害日志
export function computeAttackRelicBonus(
  ctx: CombatContext,
  isUpgraded: boolean,
  card: Card,
): number {
  let bonus = 0
  // 微型大炮：本场被升级的攻击牌（含剃刀牙临时升级）额外 +3
  if (isUpgraded && hasRelic(ctx, 'micro_cannon')) bonus += 3
  // 打击木偶（与？？？变体）：名字含"打击"+3/+1
  if (hasRelic(ctx, 'strike_dummy') && card.name.includes('打击')) bonus += 3
  if (hasRelic(ctx, 'strike_dummy_ev') && card.name.includes('打击')) bonus += 1
  return bonus
}

// ===== 遗物效果注册（MVP 全量，对应 relic.md / data/relics.json warrior+general+ancient） =====

// —— 铁甲战士 9 件 ——

// 燃烧之血：战斗结束回复 6 点（由 gameStore·onVictory 按 REWARD.bloodHeal 处理，此处占位保证触发不报错）
registerRelic('burning_blood', (_r, _ctx) => {})

// 黑暗之血：战斗结束回复 12 点（ON_COMBAT_END，由 gameStore·onVictory 结算，此处占位）
registerRelic('black_blood', (_r, _ctx) => {})

// 红头骨：生命≤50% 时 +3 力量（由 applyRelicsBeforePlayerTurn 每回合结算，此处仅保证已实现标记）
registerRelic('red_skull', (_r, _ctx) => {})

// 纸蛙：易伤倍率 1.5→1.75（由 calculateFinalDamage 的纸蛙倍率钩子处理，见 effectEngine）
registerRelic('paper_frog', (_r, _ctx) => {})

// 自成型黏土：每回合失去生命则下回合 +3 格挡（onDamageTaken + turnEnd 结算）
registerRelic('self_forming_clay', (_r, _ctx) => {})

// 卡戎之灰：每消耗一张牌对全体敌人 3 伤（ON_CARD_EXHAUST）
registerRelic('charons_ashes', (r, ctx) => {
  for (const e of ctx.enemies) {
    if (!e.alive) continue
    // 卡戎之灰造成真正的伤害（经过格挡），非折后原始伤害：这里用 effects 式免疫部分倍率的中立伤害
    const dmg = damageUnit(e, 3)
    pushFx(ctx, e.id, `-${dmg}`, 'damage')
  }
  ctx.log.push(`[卡戎之灰] 对所有敌人造成 3 点伤害`)
  void r
})

// 恶魔之舌：每回合第一次失去生命时回复等量（onDamageTaken 结算）
registerRelic('demons_tongue', (_r, _ctx) => {})

// 损毁头盔：每场战斗第一次获得力量翻倍（onStrengthGain 结算）
registerRelic('broken_helmet', (_r, _ctx) => {})

// 硫磺：每回合开始己方 +2 力量、敌全体 +1 力量（applyRelicsBeforePlayerTurn 结算）
registerRelic('brimstone', (_r, _ctx) => {})

// —— 通用 20 件 ——

// 金刚杵：战斗开始 +1 力量
registerRelic('vajra', (r, ctx) => {
  ctx.player.strength += 1
  ctx.log.push(`[金刚杵] 获得 1 点力量`)
  void r
})

// 锚：战斗开始 10 格挡
registerRelic('anchor', (r, ctx) => {
  ctx.player.block += 10
  ctx.log.push(`[锚] 获得 10 点格挡`)
  void r
})

// 弹珠袋：战斗开始给全体敌人 1 层易伤
registerRelic('bag_of_marbles', (r, ctx) => {
  for (const e of ctx.enemies) {
    if (e.alive) e.statuses.push({ id: 'vulnerable', amount: 1, turns: 999 })
  }
  ctx.log.push(`[弹珠袋] 敌人获得 1 层易伤`)
  void r
})

// 灯笼：第一回合 +1 能量（applyRelicsBeforePlayerTurn 结算）
registerRelic('lantern', (_r, _ctx) => {})

// 红面具：战斗开始给全体敌人 1 层虚弱
registerRelic('red_mask', (r, ctx) => {
  for (const e of ctx.enemies) {
    if (e.alive) e.statuses.push({ id: 'weak', amount: 1, turns: 999 })
  }
  ctx.log.push(`[红面具] 敌人获得 1 层虚弱`)
  void r
})

// 开心小花：每 3 回合 +1 能量（applyRelicsBeforePlayerTurn 结算）
registerRelic('happy_flower', (_r, _ctx) => {})

// 百年积木：每场战斗第一次损失生命抽 3 张（onDamageTaken 结算）
registerRelic('centennial_puzzle', (_r, _ctx) => {})

// 草莓：拾起时最大生命 +7（ON_PICKUP，由 gameStore 拾取处处理）
registerRelic('strawberry', (_r, _ctx) => {})

// 船夹板：第二回合开始 14 格挡（applyRelicsBeforePlayerTurn 结算）
registerRelic('horn_cleat', (_r, _ctx) => {})

// 地精之角：敌人死亡 +1 能量抽 1 张（ON_ENEMY_DEATH）
registerRelic('gremlin_horn', (r, ctx) => {
  ctx.energy += 1
  // 抽 1 张：不足补洗
  if (ctx.drawPile.length === 0 && ctx.discardPile.length > 0) {
    ctx.drawPile.push(...ctx.discardPile.splice(0, ctx.discardPile.length))
  }
  const c = ctx.drawPile.pop()
  if (c) ctx.hand.push(c)
  ctx.log.push(`[地精之角] 获得 1 点能量并抽 1 张牌`)
  void r
})

// 钢笔尖：每第 10 张攻击牌双倍（applyPenNib 结算）
registerRelic('pen_nib', (_r, _ctx) => {})

// 精致折扇：同一回合打出 3 张攻击 +4 格挡（onPlayCard 结算）
registerRelic('ornamental_fan', (r, ctx) => {
  if (bumpState(ctx, 'fan_attack', 1) % 3 === 0) {
    ctx.player.block += 4
    ctx.log.push(`[精致折扇] 获得 4 点格挡`)
  }
  void r
})

// 双截棍：每打出 10 张攻击牌 +1 能量（onPlayCard 结算）
registerRelic('nunchaku', (r, ctx) => {
  if (bumpState(ctx, 'nunchaku_attack', 1) % 10 === 0) {
    ctx.energy += 1
    ctx.log.push(`[双截棍] 获得 1 点能量`)
  }
  void r
})

// 冰淇淋：多余能量结转下一回合（iceCream 钩子结算）
registerRelic('ice_cream', (_r, _ctx) => {})

// 带骨肉：战斗结束生命≤50% 回复 12（ON_COMBAT_END，由 gameStore 结算）
registerRelic('meat_on_the_bone', (_r, _ctx) => {})

// 坚固钳子：跨回合保留最多 10 点格挡（PASSIVE，由 combatEngine 回合切换结算）
registerRelic('sturdy_clamp', (_r, _ctx) => {})

// 苦无：同一回合打出 3 张攻击 +1 敏捷（onPlayCard 结算）
registerRelic('kunai', (r, ctx) => {
  if (bumpState(ctx, 'kunai_attack', 1) % 3 === 0) {
    ctx.player.dexterity += 1
    ctx.log.push(`[苦无] 获得 1 点敏捷`)
  }
  void r
})

// 历石：第 7 回合结束对全部敌人 52 伤（applyRelicsOnTurnEnd 结算）
registerRelic('stone_calendar', (_r, _ctx) => {})

// 化学物X：耗能为 X 的牌效果数值 +2（PASSIVE，由 gameStore·playCard 在打出 X 牌时处理）
registerRelic('chemical_x', (_r, _ctx) => {})

// 会员卡：商店商品 5 折（ON_SHOP_ENTER，由 gameStore·setupShop/buy 时结算）
registerRelic('membership_card', (_r, _ctx) => {})

// —— 先古 3 件 ——

// 黑星：精英战多掉一件遗物（ON_COMBAT_END，由 gameStore·generateReward 处理）
registerRelic('black_star', (_r, _ctx) => {})

// 符文金字塔：回合结束不丢弃手牌（PASSIVE，由 gameStore·endTurn 处理）
registerRelic('runic_pyramid', (_r, _ctx) => {})

// 潘多拉魔盒：变化所有打击与防御（ON_PICKUP，由 gameStore 拾取处处理）
registerRelic('pandoras_box', (_r, _ctx) => {})

// ===== 公式层钩子（effectEngine/combatEngine 调用） =====

// 玩家抽牌堆被打乱洗牌时（弃牌堆洗回抽牌堆）：大～抱抱往抽牌堆加入一张煤灰
// 说明：开战初始洗牌（createCombatContext）由 gameStore.startBattle 就地处理一次，
//      本钩子覆盖"战斗中抽牌堆抽空→洗回弃牌堆"的重复洗牌，二者共同还原 relic.md 的完整机制。
export function applyRelicsOnShuffle(ctx: CombatContext): void {
  // 算盘：每次抽牌堆洗牌时，获得 6 点格挡
  if (hasRelic(ctx, 'abacus')) {
    ctx.player.block += 6
    ctx.log.push('[算盘] 洗牌，获得 6 点格挡')
  }
  if (!hasRelic(ctx, 'big_hug')) return
  // 煤灰加入抽牌堆（未升级实例）
  ctx.drawPile.push({ id: 'soot', upgrade: false })
  ctx.log.push('[大～抱抱] 抽牌堆打乱洗牌，加入一张煤灰')
}

// 玩家受到伤害后：自成型黏土记录 / 恶魔之舌回血 / 百年积木抽牌 / 钨合金棍减伤 / 观察与习得控伤上限
export function applyRelicsOnDamageTaken(ctx: CombatContext, hpLost: number): void {
  if (
    !hasRelic(ctx, 'self_forming_clay') &&
    !hasRelic(ctx, 'demons_tongue') &&
    !hasRelic(ctx, 'centennial_puzzle') &&
    !hasRelic(ctx, 'tungsten_rod') &&
    !hasRelic(ctx, 'watch_and_learn') &&
    !hasRelic(ctx, 'lizard_tail')
  ) {
    return
  }
  // 蜥蜴尾巴：生命将至 0 或以下时，回复到最大生命值的 50%（仅能起效一次）
  if (
    hasRelic(ctx, 'lizard_tail') &&
    ctx.player.hp <= 0 &&
    getState(ctx, 'lizard_tail_used') === 0
  ) {
    bumpState(ctx, 'lizard_tail_used', 1)
    const revived = Math.floor(ctx.player.maxHp / 2)
    ctx.player.hp = revived
    pushFx(ctx, ctx.player.id, `+${revived} 生命`, 'heal')
    ctx.log.push(`[蜥蜴尾巴] 濒死复苏，回复到最大生命的 50%`)
  }
  if (hpLost <= 0) return
  if (hasRelic(ctx, 'self_forming_clay')) bumpState(ctx, 'self_forming_clay_this_turn', 1)
  if (hasRelic(ctx, 'demons_tongue') && getState(ctx, 'demons_tongue_this_turn') === 0) {
    bumpState(ctx, 'demons_tongue_this_turn', 1)
    const healed = Math.min(hpLost, ctx.player.maxHp - ctx.player.hp)
    if (healed > 0) {
      ctx.player.hp += healed
      pushFx(ctx, ctx.player.id, `+${healed} 生命`, 'heal')
      ctx.log.push(`[恶魔之舌] 回复 ${healed} 点生命`)
    }
  }
  if (hasRelic(ctx, 'centennial_puzzle') && getState(ctx, 'centennial_used') === 0) {
    bumpState(ctx, 'centennial_used', 1)
    const n = drawCards(ctx, 3)
    ctx.log.push(`[百年积木] 抽 ${n} 张牌`)
  }
  // 钨合金杆：每次失去生命时减少 1 点（真实伤害已扣除，此处回补 1 点，不超最大生命）
  if (hasRelic(ctx, 'tungsten_rod')) {
    const back = Math.max(0, Math.min(1, ctx.player.maxHp - ctx.player.hp))
    if (back > 0) {
      ctx.player.hp += back
      pushFx(ctx, ctx.player.id, `+${back} 生命`, 'heal')
    }
  }
  // 观察与习得：一回合内累计失去的生命不超过 20，超出部分回补并封顶
  if (hasRelic(ctx, 'watch_and_learn')) {
    const total = getState(ctx, 'watch_lost_this_turn') + hpLost
    const over = Math.max(0, total - 20)
    if (over > 0) {
      const back = Math.max(0, Math.min(over, ctx.player.maxHp - ctx.player.hp))
      if (back > 0) {
        ctx.player.hp += back
        pushFx(ctx, ctx.player.id, `+${back} 生命`, 'heal')
      }
      ctx.relicState['watch_lost_this_turn'] = 20
    } else {
      ctx.relicState['watch_lost_this_turn'] = total
    }
  }
}

// 回合结束结算：历石 52 伤 / 自成型黏土累积 / 恶魔之舌重置 / 冰淇淋记能量
export function applyRelicsOnTurnEnd(ctx: CombatContext): void {
  if (hasRelic(ctx, 'stone_calendar') && ctx.turn === 7) {
    for (const e of ctx.enemies) {
      if (!e.alive) continue
      const dmg = damageUnit(e, 52)
      pushFx(ctx, e.id, `-${dmg}`, 'damage')
    }
    ctx.log.push(`[历石] 对所有敌人造成 52 点伤害`)
  }
  // 自成型黏土：本回合受过伤 → 下回合 +3 格挡标记
  if (getState(ctx, 'self_forming_clay_this_turn') > 0) {
    ctx.relicState['clay_block_next'] = 3
    ctx.relicState['self_forming_clay_this_turn'] = 0
  }
  ctx.relicState['demons_tongue_this_turn'] = 0
  // 音乐盒：复位本回合已触发标记（下回合第一张攻击牌重新生效）
  ctx.relicState['music_box_this_turn'] = 0
  // 观察与习得：重置本回合失去生命计数（下回合重新累计 20 点上限）
  ctx.relicState['watch_lost_this_turn'] = 0
  // 冰淇淋：记录未消耗能量
  if (hasRelic(ctx, 'ice_cream')) ctx.relicState['ice_cream_carry'] = ctx.energy
  // 佩尔之泪：回合结束仍有余能量 → 下回合 +2 能量
  if (hasRelic(ctx, 'percy_tear') && ctx.energy > 0) {
    ctx.relicState['percy_tear_next'] = 2
    ctx.log.push('[佩尔之泪] 未花费能量，下回合额外 +2 能量')
  } else {
    ctx.relicState['percy_tear_next'] = 0
  }
  // 斗篷扣：回合结束时每有一张手牌获得 1 点格挡
  if (hasRelic(ctx, 'cloak_clasp')) {
    ctx.player.block += ctx.hand.length
    ctx.log.push(`[斗篷扣] 手牌 ${ctx.hand.length} 张，获得 ${ctx.hand.length} 点格挡`)
  }
  // 招架盾：回合结束时若拥有 ≥10 格挡，对随机敌人造成 6 点伤害
  if (hasRelic(ctx, 'parrying_shield') && ctx.player.block >= 10) {
    const alive = ctx.enemies.filter((e) => e.alive)
    if (alive.length > 0) {
      const target = alive[Math.floor(ctx.rng() * alive.length)]!
      const dmg = damageUnit(target, 6)
      pushFx(ctx, target.id, `-${dmg}`, 'damage')
      ctx.log.push('[招架盾] 对随机敌人造成 6 点伤害')
    }
  }
  // 奥利哈钢：回合结束时若没有任何格挡，获得 6 点格挡；事件变体"奥利哈钢？？？"获得 3 点格挡
  if ((hasRelic(ctx, 'orichalcum') || hasRelic(ctx, 'orichalcum_ev')) && ctx.player.block === 0) {
    const amount = hasRelic(ctx, 'orichalcum') ? 6 : 3
    ctx.player.block += amount
    // 记录本次赠送的格挡量：供 endOfTurn 在清除格挡后原样归还，使该格挡延续到对手回合（奥利哈钢的设计意图）
    ctx.relicState['orichalcum_carry'] = amount
    ctx.log.push(`[奥利哈钢] 回合结束时无格挡，获得 ${amount} 点格挡`)
  }
  // 孙子兵法：记录本回合是否未打出攻击牌（供下一回合判断）
  if (hasRelic(ctx, 'sun_tzu')) {
    ctx.relicState['sun_tzu_no_attack_next'] = ctx.attacksPlayedThisTurn === 0 ? 1 : 0
  }
  // 怀表：本回合打出 ≤3 张牌 → 下回合额外抽 3 张
  if (hasRelic(ctx, 'pocket_watch')) {
    ctx.relicState['pocket_watch_draw_next'] = ctx.cardsThisTurn <= 3 ? 1 : 0
  }
  // 尖声酒壶：回合结束时无手牌 → 对全体敌人 20 点伤害
  if (hasRelic(ctx, 'screaming_jar') && ctx.hand.length === 0) {
    for (const e of ctx.enemies) {
      if (!e.alive) continue
      const dmg = damageUnit(e, 20)
      pushFx(ctx, e.id, `-${dmg}`, 'damage')
    }
    ctx.log.push('[尖叫酒壶] 无手牌，对全体敌人造成 20 点伤害')
  }
}

// 玩家回合开始前结算：自成型黏土补块 / 红头骨 / 硫磺 / 船夹板 / 开心小花 / 灯笼 / 冰淇淋结转
export function applyRelicsBeforePlayerTurn(ctx: CombatContext): void {
  // 自成型黏土：上回合标记 → 本回合 +3 格挡
  const clay = ctx.relicState['clay_block_next'] as number | undefined
  if (clay && hasRelic(ctx, 'self_forming_clay')) {
    ctx.player.block += clay
    ctx.relicState['clay_block_next'] = 0
    ctx.log.push(`[自成型黏土] 获得 ${clay} 点格挡`)
  }
  // 腰带扣：没有药水时额外 +2 敏捷（relic.md §腰带扣，PASSIVE；MVP 无药水系统 → 恒生效）。
  // 整场战斗一次性施加（用 relicState 防止每回合重复累加）
  if (hasRelic(ctx, 'belt_buckle') && !ctx.relicState['belt_buckle_applied']) {
    ctx.player.dexterity += 2
    ctx.relicState['belt_buckle_applied'] = 1
    ctx.log.push('[腰带扣] 无药水，获得 2 点敏捷')
  }
  // 红头骨：≤50% 生命时 +3 力量（条件型：半血时施加一次，回血后回退，避免每回合重复累加）
  // 用 relicState 记录"当前是否处于低血加成态"（red_skull_active：0/1），只在状态切换时加减，保证恒定为 +3
  const redSkullActive = (ctx.relicState['red_skull_active'] as number) ?? 0
  const redSkullLow = ctx.player.hp <= ctx.player.maxHp / 2
  if (hasRelic(ctx, 'red_skull')) {
    if (redSkullLow && !redSkullActive) {
      ctx.player.strength += 3
      ctx.relicState['red_skull_active'] = 1
      ctx.log.push(`[红头骨] 生命不足一半，获得 3 点力量`)
    } else if (!redSkullLow && redSkullActive) {
      ctx.player.strength -= 3
      ctx.relicState['red_skull_active'] = 0
      ctx.log.push(`[红头骨] 生命恢复，失去 3 点力量`)
    }
  }
  // 硫磺：己方 +2 力量、敌全体 +1 力量
  if (hasRelic(ctx, 'brimstone')) {
    ctx.player.strength += 2
    for (const e of ctx.enemies) if (e.alive) e.strength += 1
    ctx.log.push(`[硫磺] 己方 +2 力量，敌人 +1 力量`)
  }
  // 船夹板：第二回合 14 格挡
  if (hasRelic(ctx, 'horn_cleat') && ctx.turn === 2) {
    ctx.player.block += 14
    ctx.log.push(`[船夹板] 获得 14 点格挡`)
  }
  // 开心小花：每 3 回合 +1 能量
  if (hasRelic(ctx, 'happy_flower') && ctx.turn % 3 === 0) {
    ctx.energy += 1
    ctx.log.push(`[开心小花] 获得 1 点能量`)
  }
  // 灯笼：第一回合 +1 能量
  if (hasRelic(ctx, 'lantern') && ctx.turn === 1) {
    ctx.energy += 1
    ctx.log.push(`[灯笼] 获得 1 点能量`)
  }
  // 冰淇淋：结转上回合能量
  const carry = (ctx.relicState['ice_cream_carry'] as number) ?? 0
  if (hasRelic(ctx, 'ice_cream') && carry > 0) {
    ctx.energy += carry
    ctx.relicState['ice_cream_carry'] = 0
    ctx.log.push(`[冰淇淋] 结转 ${carry} 点能量`)
  }
  // 佩尔之泪：上回合未花费能量 → 本回合 +2 能量
  const percyTear = ctx.relicState['percy_tear_next'] as number | undefined
  if (percyTear && hasRelic(ctx, 'percy_tear')) {
    ctx.energy += percyTear
    ctx.relicState['percy_tear_next'] = 0
    ctx.log.push(`[佩尔之泪] 结转 ${percyTear} 点能量`)
  }
  // 摆动球：每 3 个回合抽 1 张牌
  if (hasRelic(ctx, 'pendulum') && ctx.turn % 3 === 0) {
    const n = drawCards(ctx, 1)
    ctx.log.push(`[摆动球] 抽 ${n} 张牌`)
  }
  // 闪亮口红：第 3 回合开始时 +1 力量、+1 敏捷
  if (hasRelic(ctx, 'shimmering_lipstick') && ctx.turn === 3) {
    ctx.player.strength += 1
    ctx.player.dexterity += 1
    ctx.log.push('[闪亮口红] 第 3 回合获得 1 点力量与 1 点敏捷')
  }
  // 烛台：第 2 回合开始时 +2 能量
  if (hasRelic(ctx, 'candlestick') && ctx.turn === 2) {
    ctx.energy += 2
    ctx.log.push('[烛台] 获得 2 点能量')
  }
  // 吊灯：第 3 回合开始时 +3 能量
  if (hasRelic(ctx, 'chandelier') && ctx.turn === 3) {
    ctx.energy += 3
    ctx.log.push('[吊灯] 获得 3 点能量')
  }
  // 舵盘：第 3 回合开始时 +18 格挡
  if (hasRelic(ctx, 'rudder') && ctx.turn === 3) {
    ctx.player.block += 18
    ctx.log.push('[舵盘] 获得 18 点格挡')
  }
  // 水银沙漏：回合开始时对所有敌人造成 3 点伤害
  if (hasRelic(ctx, 'mercury_hourglass')) {
    for (const e of ctx.enemies) {
      if (!e.alive) continue
      const dmg = damageUnit(e, 3)
      pushFx(ctx, e.id, `-${dmg}`, 'damage')
    }
    ctx.log.push('[水银沙漏] 对所有敌人造成 3 点伤害')
  }
  // 抱抱先生：回合开始时对所有敌人造成等于当前回合数的伤害
  if (hasRelic(ctx, 'mr_hug')) {
    for (const e of ctx.enemies) {
      if (!e.alive) continue
      const dmg = damageUnit(e, ctx.turn)
      pushFx(ctx, e.id, `-${dmg}`, 'damage')
    }
    ctx.log.push(`[抱抱先生] 对所有敌人造成 ${ctx.turn} 点伤害`)
  }
  // 花粉核心：每 4 个回合额外抽 2 张牌
  if (hasRelic(ctx, 'pollen_core') && ctx.turn % 4 === 0) {
    const n = drawCards(ctx, 2)
    ctx.log.push(`[花粉核心] 抽 ${n} 张牌`)
  }
  // 不休陀螺：当你没有手牌时抽 1 张牌
  if (
    hasRelic(ctx, 'endless_top') &&
    ctx.hand.length === 0 &&
    ctx.drawPile.length + ctx.discardPile.length > 0
  ) {
    const n = drawCards(ctx, 1)
    ctx.log.push(`[不休陀螺] 抽 ${n} 张牌`)
  }
  // 佩尔之血：回合开始额外抽 1 张牌
  if (hasRelic(ctx, 'percy_blood')) {
    const n = drawCards(ctx, 1)
    ctx.log.push(`[佩尔之血] 额外抽 ${n} 张牌`)
  }
  // 佩尔之肉：从第 3 回合起每回合额外 +1 能量
  if (hasRelic(ctx, 'percy_meat') && ctx.turn >= 3) {
    ctx.energy += 1
    ctx.log.push('[佩尔之肉] 获得 1 点能量')
  }
  // 烫嘴可可：每场战斗第一回合额外 +4 能量
  if (hasRelic(ctx, 'hot_cocoa') && ctx.turn === 1) {
    ctx.energy += 4
    ctx.log.push('[烫嘴可可] 第一回合获得 4 点能量')
  }
  // 孙子兵法：上一回合没有打出过攻击牌 → 本回合额外 +1 能量
  if (hasRelic(ctx, 'sun_tzu') && getState(ctx, 'sun_tzu_no_attack_next') > 0) {
    ctx.energy += 1
    ctx.relicState['sun_tzu_no_attack_next'] = 0
    ctx.log.push('[孙子兵法] 未打出攻击牌，获得 1 点能量')
  }
  // 怀表：上一回合打出 ≤3 张牌 → 本回合额外抽 3 张
  if (hasRelic(ctx, 'pocket_watch') && getState(ctx, 'pocket_watch_draw_next') > 0) {
    ctx.relicState['pocket_watch_draw_next'] = 0
    const n = drawCards(ctx, 3)
    ctx.log.push(`[怀表] 上回合计牌 ≤3，抽 ${n} 张`)
  }
  // 面包：第一回合 -2 能量，其余回合 +1 能量
  if (hasRelic(ctx, 'bread')) {
    if (ctx.turn === 1) ctx.energy = Math.max(0, ctx.energy - 2)
    else {
      ctx.energy += 1
      ctx.log.push('[面包] 获得 1 点能量')
    }
  }
  // 钗：回合开始时获得 7 点格挡
  if (hasRelic(ctx, 'hairpin')) {
    ctx.player.block += 7
    ctx.log.push('[钗] 获得 7 点格挡')
  }
  // 烘焙手套：回合开始时消耗抽牌堆顶部一张牌并获得 1 点力量
  if (hasRelic(ctx, 'baking_glove')) {
    if (ctx.drawPile.length === 0 && ctx.discardPile.length > 0) {
      ctx.drawPile.push(...shuffle(ctx.discardPile, ctx.rng))
      ctx.discardPile.length = 0
    }
    const top = ctx.drawPile.pop()
    if (top) {
      ctx.exhaustPile.push(top)
      ctx.player.strength += 1
      ctx.log.push('[烘焙手套] 消耗抽牌堆顶部一张牌并获得 1 点力量')
    }
  }
  // 先古"每回合开始 +1 能量"类（南瓜蜡烛/灵体外质/添水/贤者之石/带刺手甲/天鹅绒颈圈/血染玫瑰）
  if (
    hasRelic(ctx, 'pumpkin_candle') ||
    hasRelic(ctx, 'ectoplasm') ||
    hasRelic(ctx, 'add_water') ||
    hasRelic(ctx, 'philosophers_stone') ||
    hasRelic(ctx, 'spiked_gauntlet') ||
    hasRelic(ctx, 'velvet_collar') ||
    hasRelic(ctx, 'blood_rose')
  ) {
    ctx.energy += 1
  }
  // 黄金印：回合开始花费 5 金币获得 1 点能量（relic.md §四·特兹卡塔拉；金币不足则跳过）
  if (hasRelic(ctx, 'golden_stamp') && ctx.gold >= 5) {
    ctx.gold -= 5
    ctx.energy += 1
    ctx.log.push('[黄金印] 花费 5 金币获得 1 点能量')
  }
  // 贤者之石：所有敌人初始获得 1 点力量（每场战斗仅生效一次，用状态标记防重复）
  if (hasRelic(ctx, 'philosophers_stone') && getState(ctx, 'phpstone_str_done') === 0) {
    bumpState(ctx, 'phpstone_str_done', 1)
    for (const e of ctx.enemies) if (e.alive) e.strength += 1
    ctx.log.push('[贤者之石] 所有敌人获得 1 点力量')
  }
  // 开心小花？？？（事件变体）：每 5 个回合获得 1 点能量
  if (hasRelic(ctx, 'happy_flower_ev') && ctx.turn % 5 === 0) {
    ctx.energy += 1
    ctx.log.push('[开心小花？？？] 获得 1 点能量')
  }
  // ===== 无色/通用遗物"每回合开始"类（补充实现） =====
  // 棱彩宝石：每个回合开始时获得 1 点能量
  if (hasRelic(ctx, 'prismatic_gem')) {
    ctx.energy += 1
    ctx.log.push('[棱彩宝石] 获得 1 点能量')
  }
  // 低语耳环：每个回合开始时获得 1 点能量；玩家的第一回合由瓦库接管（不获得）
  if (hasRelic(ctx, 'whisper_earring') && ctx.turn >= 2) {
    ctx.energy += 1
    ctx.log.push('[低语耳环] 获得 1 点能量')
  }
  // 赐福鹿角：每个回合开始时获得 1 点能量；战斗开始时将 3 张晕眩放入抽牌堆
  if (hasRelic(ctx, 'blessed_antlers')) {
    ctx.energy += 1
    ctx.log.push('[赐福鹿角] 获得 1 点能量')
  }
  if (hasRelic(ctx, 'blessed_antlers') && ctx.turn === 1) {
    for (let i = 0; i < 3; i++) ctx.drawPile.unshift({ id: 'dizzy', upgrade: false })
    ctx.log.push('[赐福鹿角] 将 3 张晕眩放入抽牌堆')
  }
  // 异蛇之眼：每回合多抽 2 张；每场战斗开始时获得混乱
  if (hasRelic(ctx, 'serpent_eye') && ctx.turn === 1) {
    addStatus(ctx.player, 'confuse', 1)
    ctx.log.push('[异蛇之眼] 战斗开始获得混乱')
  }
  if (hasRelic(ctx, 'serpent_eye')) {
    const n = drawCards(ctx, 2)
    ctx.log.push(`[异蛇之眼] 多抽 ${n} 张牌`)
  }
  // 异蛇之眼？？？（事件变体）：每场战斗开始时获得混乱
  if (hasRelic(ctx, 'serpent_eye_ev') && ctx.turn === 1) {
    addStatus(ctx.player, 'confuse', 1)
    ctx.log.push('[异蛇之眼？？？] 战斗开始获得混乱')
  }
  // 小提琴：每个回合开始时额外抽 2 张牌（回合进行中不再能抽牌的约束由 noDraw 钩子处理）
  if (hasRelic(ctx, 'violin')) {
    const n = drawCards(ctx, 2)
    ctx.log.push(`[小提琴] 多抽 ${n} 张牌`)
  }
  // 十字弓：回合开始时，将一张随机攻击牌加入手牌，且本回合免费打出
  if (hasRelic(ctx, 'crossbow')) {
    const pool = getAttackPool()
    if (pool.length > 0) {
      const pick = pool[Math.floor(ctx.rng() * pool.length)]!
      ctx.hand.push({ id: pick.id, upgrade: false })
      ctx.freeThisTurn.add(pick.id)
      ctx.log.push(`[十字弓] 将随机攻击牌【${pick.name}】加入手牌（本回合免费）`)
    }
  }
  // 缩放仪：Boss 战开始时回复 25 点生命值
  if (hasRelic(ctx, 'scaler') && ctx.turn === 1 && ctx.enemies.some((e) => e.category === 'boss')) {
    const healed = Math.min(25, ctx.player.maxHp - ctx.player.hp)
    if (healed > 0) {
      ctx.player.hp += healed
      pushFx(ctx, ctx.player.id, `+${healed} 生命`, 'heal')
      ctx.log.push(`[缩放仪] 回复 ${healed} 点生命`)
    }
  }
  // 碎石钻：每场战斗开始时，随机升级抽牌堆中的 2 张牌（本场战斗内临时升级）
  if (hasRelic(ctx, 'diamond') && ctx.turn === 1) {
    const candidates = ctx.drawPile.map((_, i) => i)
    shuffle(candidates, ctx.rng)
      .slice(0, 2)
      .forEach((i) => {
        if (ctx.drawPile[i] && !ctx.drawPile[i]!.upgrade) ctx.drawPile[i]!.upgrade = true
      })
    ctx.log.push('[碎石钻] 随机升级抽牌堆中 2 张牌')
  }
  // 历史课：你的回合开始时，打出一张你上一回合最后打出的攻击牌或技能牌的复制品
  if (hasRelic(ctx, 'history_lesson') && ctx.turn >= 2) {
    const last = ctx.relicState['history_last'] as string | undefined
    if (last && last !== '') {
      const card = getCard(last)
      if (card) {
        // 重打该牌的基础效果链（复制品视为未升级）
        const logs = resolveEffectChain(ctx, card.effects, { source: 'player' })
        ctx.log.push(`[历史课] 打出上一回合【${card.name}】的复制品`, ...logs)
      }
    }
  }
}

// 力量获得钩子：损毁头盔首次翻倍（effectEngine 加玩家力量时调用，返回实际应加量）
export function applyRelicsOnStrengthGain(ctx: CombatContext, amount: number): number {
  if (!hasRelic(ctx, 'broken_helmet')) return amount
  if (getState(ctx, 'broken_helmet_used') === 0) {
    bumpState(ctx, 'broken_helmet_used', 1)
    ctx.log.push(`[损毁头盔] 首次力量翻倍`)
    return amount * 2
  }
  return amount
}

// 钢笔尖：记录攻击次数，返回本次攻击倍率（第 10 张双倍）
export function applyPenNib(ctx: CombatContext): number {
  if (!hasRelic(ctx, 'pen_nib')) return 1
  return bumpState(ctx, 'pen_nib_count', 1) % 10 === 0 ? 2 : 1
}

// 玩家打出攻击牌后：结算按攻击张数的遗物（精致折扇/双截棍/苦无——每 3/10 张触发）
// 由 combatEngine.playCard 在攻击牌结算后调用（cardType === 'attack' 时才触发）
export function applyRelicsOnPlayAttack(ctx: CombatContext): void {
  if (hasRelic(ctx, 'ornamental_fan')) {
    // 精致折扇：同一回合内每打 3 张攻击牌 +4 格挡
    if (bumpState(ctx, 'fan_attack', 1) % 3 === 0) {
      ctx.player.block += 4
      ctx.log.push('[精致折扇] 获得 4 点格挡')
    }
  }
  if (hasRelic(ctx, 'nunchaku')) {
    // 双截棍：每打出 10 张攻击牌 +1 能量
    if (bumpState(ctx, 'nunchaku_attack', 1) % 10 === 0) {
      ctx.energy += 1
      ctx.log.push('[双截棍] 获得 1 点能量')
    }
  }
  if (hasRelic(ctx, 'kunai')) {
    // 苦无：同一回合内每打 3 张攻击牌 +1 敏捷
    if (bumpState(ctx, 'kunai_attack', 1) % 3 === 0) {
      ctx.player.dexterity += 1
      ctx.log.push('[苦无] 获得 1 点敏捷')
    }
  }
  if (hasRelic(ctx, 'shuriken')) {
    // 手里剑：同一回合内每打 3 张攻击牌 +1 力量
    if (bumpState(ctx, 'shuriken_attack', 1) % 3 === 0) {
      ctx.player.strength += 1
      ctx.log.push('[手里剑] 获得 1 点力量')
    }
  }
  if (hasRelic(ctx, 'scythe')) {
    // 锁镰：同一回合内每打 3 张攻击牌，随机对一名敌人造成 6 点伤害
    if (bumpState(ctx, 'scythe_attack', 1) % 3 === 0) {
      const alive = ctx.enemies.filter((e) => e.alive)
      if (alive.length > 0) {
        const target = alive[Math.floor(ctx.rng() * alive.length)]!
        const dmg = damageUnit(target, 6)
        pushFx(ctx, target.id, `-${dmg}`, 'damage')
        ctx.log.push('[锁镰] 对随机敌人造成 6 点伤害')
      }
    }
  }
  if (hasRelic(ctx, 'wind_daughter')) {
    // 风的女儿：每打出一张攻击牌获得 1 点格挡
    ctx.player.block += 1
    ctx.log.push('[风的女儿] 获得 1 点格挡')
  }
}

// 玩家打出技能牌后：结算按技能张数的遗物（开信刀——每 3 张技能对全体 5 伤；音叉——每 10 张技能 +7 格挡）
// 由 combatEngine.playCard 在技能牌结算后调用（cardType === 'skill' 时触发）
export function applyRelicsOnPlaySkill(ctx: CombatContext): void {
  if (hasRelic(ctx, 'letter_opener')) {
    // 开信刀：同一回合内每打 3 张技能牌对全体敌人造成 5 点伤害
    if (bumpState(ctx, 'letter_opener_skill', 1) % 3 === 0) {
      for (const e of ctx.enemies) {
        if (!e.alive) continue
        const dmg = damageUnit(e, 5)
        pushFx(ctx, e.id, `-${dmg}`, 'damage')
      }
      ctx.log.push('[开信刀] 对所有敌人造成 5 点伤害')
    }
  }
  if (hasRelic(ctx, 'tuning_fork')) {
    // 音叉：每打出 10 张技能牌获得 7 点格挡
    if (bumpState(ctx, 'tuning_fork_skill', 1) % 10 === 0) {
      ctx.player.block += 7
      ctx.log.push('[音叉] 获得 7 点格挡')
    }
  }
}

// 玩家打出能力牌后：结算能力类遗物（棋子——抽 1 张；永冻冰晶——首次 +7 格挡；迷失鬼火——对全体 8 伤）
// 由 combatEngine.playCard 在能力牌结算后调用（cardType === 'power' 时触发）
export function applyRelicsOnPlayPower(ctx: CombatContext): void {
  if (hasRelic(ctx, 'chess_piece')) {
    // 棋子：每打出一张能力牌抽 1 张牌
    const n = drawCards(ctx, 1)
    ctx.log.push(`[棋子] 抽 ${n} 张牌`)
  }
  if (hasRelic(ctx, 'frozen_crystal') && getState(ctx, 'frozen_crystal_used') === 0) {
    // 永冻冰晶：本场战斗第一次打出能力牌时获得 7 点格挡
    bumpState(ctx, 'frozen_crystal_used', 1)
    ctx.player.block += 7
    ctx.log.push('[永冻冰晶] 首次能力牌获得 7 点格挡')
  }
  if (hasRelic(ctx, 'lost_ghost_fire')) {
    // 迷失鬼火：每打出一张能力牌对所有敌人造成 8 点伤害
    for (const e of ctx.enemies) {
      if (!e.alive) continue
      const dmg = damageUnit(e, 8)
      pushFx(ctx, e.id, `-${dmg}`, 'damage')
    }
    ctx.log.push('[迷失鬼火] 对所有敌人造成 8 点伤害')
  }
  if (hasRelic(ctx, 'rainbow_ring')) {
    // 彩虹戒指：每回合首次打出攻击/技能/能力各一张时，+1 力量 +1 敏捷（在此处理能力牌维度）
    if (getState(ctx, 'rainbow_power') === 0) {
      bumpState(ctx, 'rainbow_power', 1)
      ctx.player.strength += 1
      ctx.player.dexterity += 1
      ctx.log.push('[彩虹戒指] 各类型首次打出，获得 1 点力量与 1 点敏捷')
    }
  }
}

// 玩家消耗一张牌后：结算消耗类遗物（卡戎之灰/金纸/遗忘之魂）
// 由 combatEngine.playCard 在牌被打入消耗堆后调用
export function applyRelicsOnExhaust(ctx: CombatContext): void {
  // 卡戎之灰：对全体敌人造成 3 点真实伤害（经过格挡）
  if (hasRelic(ctx, 'charons_ashes')) {
    for (const e of ctx.enemies) {
      if (!e.alive) continue
      const dmg = damageUnit(e, 3)
      pushFx(ctx, e.id, `-${dmg}`, 'damage')
    }
    ctx.log.push('[卡戎之灰] 对所有敌人造成 3 点伤害')
  }
  // 金纸：每消耗 5 张牌抽 1 张（按本场累计消耗数取余判定）
  if (hasRelic(ctx, 'golden_star') && bumpState(ctx, 'golden_star_exhaust', 1) % 5 === 0) {
    const n = drawCards(ctx, 1)
    ctx.log.push(`[金纸] 消耗满 5 张牌，抽 ${n} 张`)
  }
  // 遗忘之魂：每消耗一张牌，随机对一名敌人造成 1 点伤害
  if (hasRelic(ctx, 'forgotten_soul')) {
    const alive = ctx.enemies.filter((e) => e.alive)
    if (alive.length > 0) {
      const target = alive[Math.floor(ctx.rng() * alive.length)]!
      const dmg = damageUnit(target, 1)
      pushFx(ctx, target.id, `-${dmg}`, 'damage')
      ctx.log.push('[遗忘之魂] 对随机敌人造成 1 点伤害')
    }
  }
}

// 玩家打出任意卡牌后：结算"打出牌本身触发"的遗物（波纹水盆/铁棒/骇人头盔）
// 由 combatEngine.playCard 在效果结算与类型钩子之后调用；投斧、天鹅绒颈圈等在 playCard 内直接处理
export function applyRelicsOnPlayCard(ctx: CombatContext, card: Card): void {
  // 波纹水盆：本回合尚未打出攻击牌时获得 4 点格挡（拿到该张即可；攻击牌自身不会触发）
  if (hasRelic(ctx, 'ripple_basin') && ctx.attacksPlayedThisTurn === 0) {
    ctx.player.block += 4
    ctx.log.push('[波纹水盆] 本回合未打出攻击牌，获得 4 点格挡')
  }
  // 铁棒：每打出 4 张牌就抽 1 张（cardsPlayedTotal 已含当前牌）
  if (hasRelic(ctx, 'iron_staff') && ctx.cardsPlayedTotal % 4 === 0) {
    const n = drawCards(ctx, 1)
    ctx.log.push(`[铁棒] 打出满 4 张牌，抽 ${n} 张`)
  }
  // 骇人头盔：打出耗能 ≥2 的牌获得 4 点格挡（X 费用牌不判定）
  if (hasRelic(ctx, 'scary_helmet') && typeof card.cost === 'number' && card.cost >= 2) {
    ctx.player.block += 4
    ctx.log.push('[骇人头盔] 打出耗能≥2 的牌，获得 4 点格挡')
  }
  // 历史课：记录本回合最后打出的攻击/技能牌（供下一回合开始时重打复制品）
  if (hasRelic(ctx, 'history_lesson') && (card.type === 'attack' || card.type === 'skill')) {
    ctx.relicState['history_last'] = card.id
  }
  // 干瘪之手：每打出一张能力牌，手牌中一张随机牌在本回合免费打出
  if (hasRelic(ctx, 'shriveled_hand') && card.type === 'power' && ctx.hand.length > 0) {
    const pickEntry = ctx.hand[Math.floor(ctx.rng() * ctx.hand.length)]!
    ctx.freeThisTurn.add(pickEntry.id)
    ctx.log.push('[干瘪之手] 手牌中一张随机牌本回合免费')
  }
}

// 敌人死亡后：结算击杀类遗物（地精之角——+1 能量抽 1 张）
// 由 effectEngine 在敌人被伤害致死时调用（target.alive 由 true 变为 false）
export function applyRelicsOnEnemyDeath(ctx: CombatContext): void {
  if (!hasRelic(ctx, 'gremlin_horn')) return
  ctx.energy += 1
  ctx.log.push(`[地精之角] 获得 1 点能量`)
  // 抽 1 张：抽牌堆不足时洗回弃牌堆
  if (ctx.drawPile.length === 0 && ctx.discardPile.length > 0) {
    ctx.drawPile.push(...shuffle(ctx.discardPile, ctx.rng))
    ctx.discardPile.length = 0
  }
  const card = ctx.drawPile.pop()
  if (card) ctx.hand.push(card)
}
