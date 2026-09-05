/**
 * 遗物类型（PRD §3.1 / §3.8 / 数据源 document/relic.md）
 * 遗物数据来自 src/data/relics.json；触发钩子（trigger）驱动 relicSystem 执行被动效果。
 */

// 遗物触发钩子：与 relicSystem 的事件注册对应
export type RelicTrigger =
  | 'ON_COMBAT_START' // 战斗开始
  | 'ON_TURN_START' // 回合开始
  | 'ON_TURN_END' // 回合结束
  | 'ON_PLAY_CARD' // 打出卡牌
  | 'ON_DAMAGE_TAKEN' // 受到伤害
  | 'ON_DEAL_DAMAGE' // 造成伤害
  | 'ON_ENEMY_DEATH' // 敌人死亡
  | 'ON_CARD_EXHAUST' // 消耗卡牌
  | 'ON_PICKUP' // 拾起时（立即生效）
  | 'ON_SHOP_ENTER' // 进入商店
  | 'ON_REST' // 篝火休息
  | 'ON_COMBAT_END' // 战斗结束
  | 'PASSIVE' // 常驻被动（无钩子，效果写死在效果逻辑）
  | 'ON_STRENGTH_GAIN' // 获得力量时

export interface Relic {
  id: string // snake_case
  name: string
  rarity: string // 普通/罕见/稀有/商店/事件/遗物/先古之民…
  trigger: RelicTrigger
  desc: string // 效果描述（原样引用数据文件文本）
  pool?:
    | 'warrior'
    | 'silent'
    | 'juggler'
    | 'religion'
    | 'robomancer'
    | 'general'
    | 'neowPool'
    | 'ancient' // 所属池
  excluded?: boolean // 是否 MVP 剔除（如依赖药水/附魔/充能球/网格等缺失子系统）
}
