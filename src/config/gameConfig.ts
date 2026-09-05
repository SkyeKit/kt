/**
 * 游戏配置常量（agent.md §3：数据文件之外的配置集中于此）
 * 数值/概率/价格等设计常量（PRD §3.2.1 / §3.5 / §3.6 / §3.3.5）。
 * 注意：卡牌/敌人/遗物/事件数据一律在 data/*.json，此处只放"规则性"配置。
 */
import type { MapNodeType, ActId } from '@/types'

// 幕注册表：中文名 + 事件过滤 stage（供运行时按幕选择遭遇/事件/标题）
export const ACTS: Record<ActId, { name: string; stage: string }> = {
  overgrowth: { name: '密林', stage: 'overgrowth' }, // 密林丘（Overgrowth）
  underdocks: { name: '暗港', stage: 'harbor' }, // 暗港（Underdocks）
} as const

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
    'defend_ironclad',
    'bash',
  ], // 打击×5 防御×5 痛击×1
  startingRelic: ['burning_blood'], // 燃烧之血（战斗结束回复 6 点生命）
} as const

// 密林幕地图参数（PRD §3.2.1）
export const MAP = {
  totalFloors: 17, // 总层数
  branchMin: 2, // 每层分支路线数下限（PRD §3.2.1：2~5 条/层）
  branchMax: 5, // 每层分支路线数上限
  // 固定楼层（PRD §3.2.1 / Overgrowth.md §1.1）
  fixedFloors: {
    1: 'neow', // 先古之民（自第 2 局起；首局为普通节点）
    2: 'monster', // 必定普通战斗
    10: 'chest', // 宝箱
    16: 'campfire', // 篝火
    17: 'boss', // Boss 战
  } as Record<number, MapNodeType>,
  // 非固定楼层节点概率（PRD §3.2.1：普通40/精英15/未知20/商店10/篝火15，合计100；宝箱无概率仅第10层固定）
  floorWeights: {
    monster: 40, // 普通战斗
    elite: 15, // 精英
    unknown: 20, // 未知（？）
    shop: 10, // 商店
    campfire: 15, // 休息处
    chest: 0, // 宝箱：无概率（仅第 10 层固定）
  } as Record<Exclude<MapNodeType, 'boss' | 'neow'>, number>,
  // 未知（？）房间内部内容概率（PRD §3.2.1：事件85/战斗10/商店3/宝箱2，合计100）
  unknownRoomChance: { event: 0.85, battle: 0.1, shop: 0.03, chest: 0.02 },
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
  // 卡牌奖励质量分级（PRD §3.3.5：普通战保底普通卡、精英战保底罕见卡、Boss 战保底稀有卡）
  cardRarityChance: {
    normal: { common: 0.75, uncommon: 0.23, rare: 0.02 },
    elite: { common: 0.3, uncommon: 0.6, rare: 0.1 },
    boss: { common: 0, uncommon: 0.2, rare: 0.8 },
  },
  cardChoices: 3, // 3 选 1
  // 卡牌奖励"白/蓝/金"档位下，每张候选卡小概率升一级稀有度的概率（白→罕见、蓝→稀有、金保持稀有）
  tierUpgradeChance: 0.25,
  bloodHeal: 6, // 燃烧之血：战斗结束回复 6 点
  // 遗物掉落（PRD §3.3.5：精英必掉 1 件，Boss 必掉 1 件；黑星→+1、熔岩石→+2 后续扩展）
  relicDrop: { elite: 1, boss: 1, monster: 0 },
} as const

// 商店（PRD §3.5）
export const SHOP = {
  cardCount: 8, // 卡牌商品数（战士 6 + 无色 2，等于 cardWarrior+cardColorless）
  cardWarrior: 6, // 战士卡池张数（商店上方区域）
  cardColorless: 2, // 无色卡池张数（商店下方区域）
  relicCount: 3,
  removeCount: 1,
  removeBaseCost: 75, // 卡牌移除基础价
  removeIncrement: 25, // 每次移除 +25
  prices: { common: 50, uncommon: 75, rare: 150 }, // 卡牌价格（±10% 浮动）
  relicPrice: [150, 300], // 遗物价格区间
} as const

// 遗物规则性数值（PRD §3.8；卡牌真实数值以 relic.md / data/relics.json 为准，此处仅回合制/结算层通用值）
export const RELIC = {
  // 战斗结束回血类遗物（由 gameStore.onVictory 结算）
  relicHeal: {
    blackBlood: 12, // 黑暗之血：战斗结束回复 12 点生命
    meatOnTheBone: 12, // 带骨肉：生命 ≤50% 时回复 12 点生命
  },
  // 拾起即生效的最大生命增益（草莓等，由 gameStore.onRelicGained 结算）
  maxHpBonus: {
    strawberry: 7, // 草莓：最大生命 +7
    oyster: 11, // 营养牡蛎：最大生命 +11
  },
  // 会员卡：商店价格立减比例（15%）
  shopDiscount: 0.15,
  // 白银熔炉：前 N 次卡牌奖励会被升级
  silverRewardCount: 3,
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
  version: 2, // v2：deck 由 id 数组改为卡实例数组（DeckCard[]），旧档因版本号不匹配自动作废
} as const

// 结算（PRD §3.13）
export const SETTLEMENT = {
  victoryGold: 0, // Boss 击败额外金币（可扩展）
} as const
