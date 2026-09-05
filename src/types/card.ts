/**
 * 卡牌类型（PRD §3.4 / 数据源 document/WarriorDeck.md 等）
 * 卡牌数据全部来自 src/data/cards.json，引擎/组件禁止硬编码数值（agent.md §5.1）。
 */
import type { EffectChain } from './effect'

// 卡牌类型：攻击 / 技能 / 能力
export type CardType = 'attack' | 'skill' | 'power'

// 卡牌稀有度（对应数据文档各分组）
export type CardRarity =
  | 'basic' // 基础（打击/防御/痛击）
  | 'common' // 普通
  | 'uncommon' // 罕见
  | 'rare' // 稀有
  | 'ancient' // 先古（破击/腐化）
  | 'colorless' // 无色
  | 'status' // 状态牌
  | 'curse' // 诅咒牌
  | 'event' // 事件卡
  | 'derived' // 衍生卡

// 卡牌费用：数字或 X（可变费用）；null 表示不可打出（状态/诅咒）
export type CardCost = number | 'X' | null

// 卡牌关键词（UI 展示与规则提示用）
export type CardKeyword = 'exhaust' | 'innate' | 'retain' | 'ethereal' | 'unplayable' | 'unique'

export interface Card {
  id: string // snake_case（如 strike_ironclad / bash）
  name: string
  cost: CardCost
  type: CardType
  rarity: CardRarity
  desc: string // 卡面描述（原样引用数据文件文本）
  upgradeDesc: string // 升级后描述（原样引用）
  effects: EffectChain // 由数据转换脚本从 desc 解析的结构化效果链（解析失败为空数组）
  upgradeEffects: EffectChain // 升级后效果链
  keywords: CardKeyword[] // 关键词标记（供 UI/引擎快速判断）
  upgrade?: boolean // 是否已升级（运行时状态，不存于数据文件）
  enchantments?: string[] // 运行时附魔 id 数组（不存于数据文件，由事件/遗物拾起时挂载）
}

// 卡牌奖励/商店抽卡用的"卡池引用"：只记录 id，具体卡从 cards.json 查找
export type CardPool = 'warrior' | 'colorless'
