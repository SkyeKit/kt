/**
 * 状态系统类型（PRD §3.3.6）
 * 状态分三类：①数值状态（力量/敏捷/格挡/覆甲…）②负面状态（易伤/虚弱/脆弱/混乱…）
 * ③怪物专属状态（缩小/紧缠/缠结/滑溜…）。状态以 snake_case id 标识，数据与 rules 由引擎统一管理。
 */

// 状态 ID：统一 snake_case（与 data/*.json 一致）
export type StatusId =
  // ① 数值状态
  | 'strength' // 力量：攻击伤害 +X
  | 'dexterity' // 敏捷：格挡获得 +X
  | 'block' // 格挡：临时护甲，回合结束消失
  | 'armor' // 覆甲：独立于格挡的护甲层，跨回合保留
  | 'thorns' // 荆棘：受击时反伤
  | 'vigor' // 活力：下一次攻击 +X 伤害
  | 'intangible' // 无实体：受到的伤害降为 1
  // ② 负面状态（玩家）
  | 'vulnerable' // 易伤：受到攻击伤害 ×1.5
  | 'weak' // 虚弱：攻击伤害 ×0.75
  | 'frail' // 脆弱：获得的格挡 ×0.75
  | 'confused' // 混乱：抽牌费用随机化
  | 'constricted' // 紧缠：每回合结束受 X 点伤害
  | 'tangled' // 缠结：攻击牌耗能 +1
  | 'shrink' // 缩小：玩家攻击伤害 -30%
  | 'ringing' // 昏眩：本回合只能打出 1 张牌
  | 'stunned' // 击晕：跳过回合
  // ③ 怪物机制状态
  | 'slippery' // 滑溜：下一次失去生命时只失去 1 点
  | 'illusion' // 幻象：死亡后下一回合满血复活
  | 'territorial' // 领地意识：回合结束时 +1 力量
  | 'slow' // 缓慢：玩家每打出一张牌，其受攻击伤害 +10%
  | 'parasitic' // 寄生物：死亡后召唤衍生物
  | 'artifact' // 人工制品：抵消 1 次负面状态
  | 'rampage' // 横冲直撞：仪式兽阶段切换计数器
  | 'metallicize' // 金属化（战士能力）：回合结束获得格挡
  | 'ritual' // 仪式：回合结束获得力量
  | 'noDraw' // 不能再抽牌（战斗专注）
  | 'energized' // 能量化（保留能量：冰淇淋）

// 状态的回合持续时间语义：0 表示永久（持续整场战斗）
export interface StatusInstance {
  id: StatusId
  amount: number // 层数/数值
  turns: number // 剩余回合数；-1 表示永久
}
