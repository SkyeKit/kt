/**
 * 游戏配置常量（agent.md §3：数据文件之外的配置集中于此）
 * 数值/概率/价格等设计常量（PRD §3.2.1 / §3.5 / §3.6 / §3.3.5）。
 * 注意：卡牌/敌人/遗物/事件数据一律在 data/*.json，此处只放"规则性"配置。
 */
import type { MapNodeType } from '@/types'

// 战士基础属性（PRD §3.4，对应数据：燃烧之血为战士初始遗物）
export const PLAYER = {
  maxHp: 80, // 初始最大生命
  energyPerTurn: 3, // 每回合初始能量
  startingGold: 99, // 初始金币
  handSize: 5, // 每回合抽牌数
  startingDeck: [
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
  ], // 打击×5 防御×4 痛击×1
  startingRelic: ['burning_blood'], // 燃烧之血（战斗结束回复 6 点生命）
} as const

// 密林幕地图参数（PRD §3.2.1）
export const MAP = {
  totalFloors: 17, // 总层数
  branchWidth: 3, // 每层分支列数（第 1/2 层与 Boss 层为 1 列）
  // 固定楼层（PRD §3.2.1 / Overgrowth.md §1.1）
  fixedFloors: {
    1: 'neow', // 先古之民
    2: 'monster', // 必定普通战斗
    10: 'chest', // 宝箱
    16: 'campfire', // 篝火
    17: 'boss', // Boss 战
  } as Record<number, MapNodeType>,
  // 普通楼层房间权重（非固定楼层）
  floorWeights: {
    monster: 55, // 普通战斗
    elite: 12, // 精英
    unknown: 8, // 未知（事件 85% / 战斗 15%）
    shop: 5, // 商店
    campfire: 12, // 休息处
    chest: 8, // 宝箱
  } as Record<Exclude<MapNodeType, 'boss' | 'neow'>, number>,
  // 未知房间判定（PRD §3.7）
  unknownEventChance: 0.85, // 未知 → 事件
  // 精英池循环：3→2→1 后重置（不重复）
  eliteLoopPool: ['byrdonis', 'bygone_effigy', 'phrog_parasite'],
  // Boss 三选一
  bossPool: ['vantom', 'ceremonial_beast', 'the_kin'],
  // 相邻楼层连接数（分支密度）
  maxEdges: 2, // 每个节点最多连向下层 2 个节点
} as const

// 战斗规则（PRD §3.3.3）
export const COMBAT = {
  // 伤害修正倍率（基础 × 易伤 × 虚弱 × 其他）
  vulnerableMultiplier: 1.5, // 易伤 ×1.5
  weakMultiplier: 0.75, // 虚弱 ×0.75
  shrinkMultiplier: 0.7, // 缩小 -30%
  frailMultiplier: 0.75, // 脆弱：格挡获得 ×0.75
  intangiblDamage: 1, // 无实体：受伤降为 1
  // 格挡：回合结束消失（不移除覆甲）
  blockExpires: true,
} as const

// 战斗奖励（PRD §3.3.5）
export const REWARD = {
  gold: { monster: [15, 25], elite: [30, 45], boss: [100, 100] }, // 设计值区间 [min,max]
  cardRarityChance: { common: 0.75, uncommon: 0.23, rare: 0.02 }, // 卡牌奖励稀有度权重
  cardChoices: 3, // 3 选 1
  bloodHeal: 6, // 燃烧之血：战斗结束回复 6 点
} as const

// 商店（PRD §3.5）
export const SHOP = {
  cardCount: 7, // 卡牌商品数
  cardWarrior: 5, // 战士卡池张数
  cardColorless: 2, // 无色卡池张数
  relicCount: 3,
  removeCount: 1,
  removeBaseCost: 75, // 卡牌移除基础价
  removeIncrement: 25, // 每次移除 +25
  prices: { common: 50, uncommon: 75, rare: 150 }, // 卡牌价格（±10% 浮动）
  relicPrice: [150, 300], // 遗物价格区间
} as const

// 篝火（PRD §3.6）
export const CAMPFIRE = {
  restHealRatio: 0.3, // 休息回复 30% 最大生命
  smithUpgrade: '升级 1 张牌', // 锻造（升级卡牌）
  // 皇家枕头/永恒羽毛等遗物挂钩在 relicSystem 中处理
} as const

// 先古遗物选择（PRD §3.1）：从涅奥池抽 3 件，MVP 剔除 5 件后池内 25 件
export const NEOW = {
  offerCount: 3,
  poolFilter: (excluded: boolean | undefined): boolean => !excluded,
} as const

// 存档
export const SAVE = {
  storageKey: 'sts2_run_v1', // localStorage 键（含版本号）
  version: 1,
} as const

// 结算（PRD §3.13）
export const SETTLEMENT = {
  victoryGold: 0, // Boss 击败额外金币（可扩展）
} as const
