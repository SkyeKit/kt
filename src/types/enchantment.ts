/**
 * 附魔类型（document/enchantments.md / data/enchantments.json）
 * 附魔是卡牌副本级强化：绑定单张卡牌副本，持续整局。
 * 语义字段为机器可读效果（JSON 原样来自数据文件），引擎在打牌/抽牌/回合结束等时机叠加；
 * 各字段含义见 document/enchantments.md §五「语义字段字典」。
 */

export interface Enchantment {
  id: string // snake_case（如 sharp / tezcataras_ember）
  name: string
  desc: string // 附魔效果描述（原样引用数据文件文本）
  source: string // 来源（遗物/事件，仅展示）
  // —— 伤害/格挡加成 ——
  damage?: number // 打出时固定伤害加成（锋利 +3、特兹卡塔拉的余烬 +3）
  damageMult?: number // 打出时伤害倍率（腐化 ×1.5、本能 ×2）
  firstPlayDamage?: number // 每场战斗首次打出时额外伤害（活力 8）
  momentumPerPlay?: number // 本场战斗每次打出伤害累计 +N（动量 5）
  blockBonus?: number // 打出时格挡加成（伶俐 +3、灵巧 +2）
  goopyBlock?: boolean // 打出时该牌格挡值永久 +1（黏糊）
  applyWeak?: number // 打出时施加虚弱层数（墨影 1）
  loseHp?: number // 打出时失去生命（腐化 2）
  // —— 关键词改变 ——
  exhaust?: boolean // 该牌获得消耗（黏糊）
  removeExhaust?: boolean // 该牌移除消耗（灵魂之力）
  innate?: boolean // 该牌获得固有（王室认证）
  retain?: boolean // 该牌获得保留（王室认证、稳定）
  unique?: boolean // 该牌获得永恒（特兹卡塔拉的余烬）
  // —— 重放 ——
  replayOnce?: boolean // 每场战斗可重放一次（华彩）
  replay1?: boolean // 该牌获得 1 层重放（涡旋）
  // —— 战斗开始/抽牌堆行为 ——
  autoPlayAtStart?: boolean // 战斗开始时自动打出（注能）
  topOfDrawPile?: boolean // 洗入抽牌堆时放抽牌堆顶（完美契合）
  randomizeCost?: boolean // 抽到时费用 0~3 随机（蛇行）
  reduceCostInHand?: boolean // 回合结束若在手牌费用 -1，直到打出（沉眠精华）
  costZero?: boolean // 该牌费用变为 0（特兹卡塔拉的余烬）
  // —— 首次打出触发 ——
  firstPlayDraw?: number // 每场首次打出抽牌数（迅速 1）
  firstPlayEnergy?: number // 每场首次打出获得能量（播种 1）
  // —— 其他 ——
  cloneAtRest?: boolean // 可在休息处复制该牌（克隆）
}
