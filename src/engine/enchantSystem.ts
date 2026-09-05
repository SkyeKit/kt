/**
 * 附魔系统（document/enchantments.md / agent.md §5.1 数据驱动）
 * 附魔是卡牌副本级强化：事件/遗物拾起时把附魔 id 挂到 Card.enchantments（运行时字段），
 * 本模块提供纯函数把附魔语义转成引擎可用的修正值（伤害/格挡加成、关键词、费用）。
 * 设计约束：本模块只依赖 data + types（不含 effectEngine 运行时依赖），
 * 避免 effectEngine 引入本模块形成循环依赖；实际效果结算在 combatEngine.playCard 中完成。
 */
import type { Card, CardKeyword, Enchantment } from '@/types'
import { getEnchantment } from '@/data'
import type { CombatContext, EnchantCombatState } from './combatEngine'

// 某张牌的附魔列表（按 id 查数据；无效 id 自动跳过）
export function enchantmentsOf(card: Card): Enchantment[] {
  return (card.enchantments ?? [])
    .map((id) => getEnchantment(id))
    .filter((e): e is Enchantment => Boolean(e))
}

// 是否带某附魔字段（任一附魔命中即 true；如 hasEnchant(card, 'retain')）
export function hasEnchant(card: Card, field: keyof Enchantment): boolean {
  return enchantmentsOf(card).some((e) => Boolean(e[field]))
}

// 卡牌"有效关键词" = 基础关键词 + 附魔叠加（灵魂之力会移除消耗）
// 引擎在固有/消耗/保留/虚无/永恒等判定处统一走此函数，保证附魔生效
export function hasCardKeyword(card: Card, kw: CardKeyword): boolean {
  const ench = enchantmentsOf(card)
  // 灵魂之力：移除"消耗"
  if (kw === 'exhaust' && ench.some((e) => e.removeExhaust)) return false
  // 附魔追加的关键词
  if (kw === 'exhaust' && ench.some((e) => e.exhaust)) return true
  if (kw === 'innate' && ench.some((e) => e.innate)) return true
  if (kw === 'retain' && ench.some((e) => e.retain)) return true
  if (kw === 'unique' && ench.some((e) => e.unique)) return true
  return card.keywords.includes(kw)
}

// 本次打出的附魔修正（供 effectEngine 伤害/格挡结算注入）
export interface EnchantMods {
  damage: number // 固定伤害加成（锋利/特兹卡塔拉/首次活力/动量累计）
  damageMult: number // 伤害倍率（腐化 ×1.5、本能 ×2）
  blockBonus: number // 格挡加成（伶俐/灵巧）
}

// 计算本次打出的附魔修正：在消耗"首次触发"标记前调用（首次伤害需 firstPlayed === false）
// 动量：使用当前累计加成（首次打出 +0，之后每打出一次 +5）
export function buildEnchantMods(ctx: CombatContext, card: Card): EnchantMods {
  const ench = enchantmentsOf(card)
  const st = ctx.enchantState[card.id] ?? (ctx.enchantState[card.id] = {})
  let damage = 0
  let mult = 1
  let block = 0
  for (const e of ench) {
    if (e.damage) damage += e.damage
    if (e.damageMult) mult *= e.damageMult
    if (e.blockBonus) block += e.blockBonus
    // 活力：首次打出额外伤害（仅第一次）
    if (e.firstPlayDamage && !st.firstPlayed) damage += e.firstPlayDamage
    // 动量：当前已累计的伤害加成
    if (e.momentumPerPlay) damage += st.momentum ?? 0
  }
  // 神秘打火机：有附魔的攻击牌额外造成 9 点伤害（遗物被动，relic.md）
  if (ctx.relics.includes('mysterious_lighter') && card.type === 'attack' && ench.length > 0) {
    damage += 9
  }
  return { damage, damageMult: mult, blockBonus: block }
}

// 运行时费用：附魔/战斗状态叠加（特兹卡塔拉 0 费、蛇行随机化、沉眠精华 -1）
// 不修改 Card.cost（共享数据对象），仅在此返回当前有效费用供引擎/UI 读取
export function effectiveCost(ctx: CombatContext, card: Card): Card['cost'] {
  if (card.cost === null || card.cost === 'X') return card.cost
  let cost = card.cost as number
  if (hasEnchant(card, 'costZero')) cost = 0
  const st = ctx.enchantState[card.id]
  if (st?.costOverride !== undefined) cost = st.costOverride
  if (st?.costMod) cost += st.costMod
  return Math.max(0, Math.floor(cost))
}

// 蛇行：抽到该牌时随机化费用 0~3（写入 costOverride，直到下次随机覆盖）
export function randomizeCostOnDraw(ctx: CombatContext, card: Card): void {
  const st = ctx.enchantState[card.id] ?? (ctx.enchantState[card.id] = {})
  st.costOverride = Math.floor(ctx.rng() * 4)
}

// 沉眠精华：回合结束时若在手牌中，费用 -1（costMod 累计，打出后清零）
export function reduceCostInHand(ctx: CombatContext, card: Card): void {
  const st = ctx.enchantState[card.id] ?? (ctx.enchantState[card.id] = {})
  st.costMod = (st.costMod ?? 0) - 1
}

// 打出该牌时重置沉眠精华的费用削减（"直到其被打出"：打出后削减失效）
export function resetCostReduction(ctx: CombatContext, card: Card): void {
  const st = ctx.enchantState[card.id]
  if (st) st.costMod = 0
}

// 取战斗内附魔状态（不存在则创建空状态），供 combatEngine 读写
export function enchantStateOf(ctx: CombatContext, card: Card): EnchantCombatState {
  return ctx.enchantState[card.id] ?? (ctx.enchantState[card.id] = {})
}
