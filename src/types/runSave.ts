/**
 * 单局存档类型（PRD §3.12 / saveSystem.ts）
 * 存档经 saveSystem 持久化到 localStorage，键名 sts2_run_v1（含版本号，损坏自动回退）。
 */

// 地图节点类型（PRD §3.2.1）
export type MapNodeType =
  | 'neow' // 先古之民（第 1 层）
  | 'monster' // 普通战斗
  | 'elite' // 精英战斗
  | 'chest' // 宝箱
  | 'campfire' // 篝火（休息处）
  | 'shop' // 商店
  | 'unknown' // 未知（事件 85% / 战斗 15%）
  | 'boss' // Boss

// 地图节点：楼层 + 分支列 + 类型 + 前后连接
export interface MapNode {
  id: string // 节点唯一标识（floor-row）
  floor: number // 楼层（1~17）
  row: number // 该层的分支列（0~2）
  type: MapNodeType
  next: string[] // 下一层可达节点 id
  visited?: boolean
  locked?: boolean // 未到达（不可点击）
}

// 遗物选择结果（先古之民/事件奖励）
export interface RelicOffer {
  relics: string[] // 遗物 id 候选
  chosen?: string // 已选（存档）
}

export interface RunState {
  version: number // 存档结构版本（当前 1）
  seed: number // 本局随机种子
  floor: number // 当前楼层
  nodeId: string // 当前所在节点
  map: MapNode[] // 整张地图
  hp: number
  maxHp: number
  gold: number
  deck: string[] // 牌组（卡牌 id 数组，可含重复）
  relics: string[] // 已拥有遗物 id
  potions: never[] // 药水（MVP 未上线，保留空数组占位）
  fightCount: number // 已战斗次数（用于精英循环池/弱强怪池切换）
  bossDefeated: boolean // 是否已击败 Boss（决定结算）
  pendingReward?: {
    // 战斗胜利后的待选奖励
    kind: 'card' | 'relic' | 'gold' | 'eventBattle'
    cards?: string[] // 3 选 1 卡牌候选
    relics?: string[]
    gold?: number
  }
  meta: {
    // 元进度相关（击杀统计）
    kills: number
    elitesKilled: number
  }
}

// 测试场（木桩）配置：与单局无关的独立战斗状态
export interface TestRunState {
  hp: number
  maxHp: number
  energy: number
  deck: string[]
  hand: string[]
  drawPile: string[]
  discardPile: string[]
  enemies: string[]
}
