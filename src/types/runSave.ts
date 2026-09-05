/**
 * 单局存档类型（PRD §3.12 / saveSystem.ts）
 * 存档经 saveSystem 持久化到 localStorage，键名 sts2_run_v1（含版本号，损坏自动回退）。
 */

// 幕（Act）标识：密林丘（Overgrowth）/ 暗港（Underdocks）
export type ActId = 'overgrowth' | 'underdocks'

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

// 牌组中的单张卡实例：id 标识卡牌，upgrade 标记"这一张是否已升级"
// （升级按实例独立，打击+ 与 打击 可并存；不再挂在共享 Card 对象上）
export interface DeckCard {
  id: string
  upgrade: boolean
}

export interface RunState {
  version: number // 存档结构版本（当前 2；v2 起 deck 为卡实例数组）
  act: ActId // 幕：overgrowth(密林) / underdocks(暗港)；旧档缺省 overgrowth
  seed: number // 本局随机种子
  floor: number // 当前楼层
  nodeId: string // 当前所在节点
  map: MapNode[] // 整张地图
  hp: number
  maxHp: number
  gold: number
  deck: DeckCard[] // 牌组（卡实例数组，可含重复 id；upgrade 标记某一张是否已升级）
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
    // 遗物内部计数（持久化到存档）
    silverRewards?: number // 白银熔炉：剩余"将升级的卡牌奖励"次数
    silverChestUsed?: boolean // 白银熔炉：首个宝箱是否已打开（为空）
    fishingStreak?: number // 钓鱼竿：已连续打完的普通战斗数（每 3 次升级随机一张牌）
    emberTeaLeft?: number // 余烬茶：剩余"+2 力量"的战斗场数（拾起时=5，逐场递减）
    oldTeaReady?: boolean // 古茶具套装：到达休息处后是否已就位（下一场战斗开始 +2 能量）
    oldTeaReadyEv?: boolean // 古茶具套装（？？？变体）：到达休息处后是否已就位（下一场战斗开始 +1 能量）
    giantJawBroken?: boolean // 巨口储蓄罐：是否已在商店花费金币（触发后失效，进店不再给金币）
    fiveLayersCounter?: number // 五轮书：自拾起后累计加入牌组的张数计数（每 5 张回血 20）
    silkenTressPending?: boolean // 华美发束：下一次卡牌奖励是否附魔「华彩」（拾起置位，首次领取卡牌时消耗）
    furCoatBattles?: number // 皮草大衣：剩余敌人仅 1 点生命的战斗场数（拾起时=7，逐场递减）
    percyToothRemoved?: string[] // 佩尔之牙：已移除待升级返还的牌 id 池（每场战斗结束随机取 1 张升级放回）
    flotsamRerolled?: boolean // 浮木：本次卡牌奖励是否已重掷（每场奖励至多重掷一次，奖励生成时清零）
    extraCardRewards?: number // 星系仪/玻璃眼珠：剩余"额外卡牌奖励"次数（拾起累加，战斗奖励页推进时逐次消费）
    kettlebellStrength?: number // 壶铃：休息处已获得的永久力量层数（最多 3 次，每场战斗开始附加到玩家）
    mysteryTicketDone?: boolean // 神秘券：是否已结算（打满 5 场战斗后发 3 件随机遗物，仅一次）
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
