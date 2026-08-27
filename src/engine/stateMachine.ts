/**
 * 全局状态机（agent.md §5.4 / PRD §3.11）
 * 状态流转：MENU → RUN →（战斗/商店/篝火/事件/奖励）→ SETTLEMENT
 * 禁止绕过状态机直接切换页面；页面路由与状态机状态一一对应。
 */

// 全局状态
export type GamePhase =
  | 'MENU' // 主菜单
  | 'RUN' // 单局进行中（地图层）
  | 'BATTLE' // 战斗中
  | 'REWARD' // 奖励选择
  | 'SHOP' // 商店
  | 'CAMPFIRE' // 篝火
  | 'EVENT' // 事件
  | 'PAUSE' // 暂停
  | 'SETTLEMENT' // 结算
  | 'TEST' // 测试场（木桩）
  | 'CODEX' // 图鉴
  | 'STATS' // 统计

// 状态迁移表：当前状态 → 允许的目标状态集合
const TRANSITIONS: Record<GamePhase, GamePhase[]> = {
  MENU: ['RUN', 'TEST', 'CODEX', 'STATS'],
  RUN: ['BATTLE', 'SHOP', 'CAMPFIRE', 'EVENT', 'PAUSE', 'SETTLEMENT', 'REWARD'],
  BATTLE: ['RUN', 'REWARD', 'SETTLEMENT', 'PAUSE'],
  REWARD: ['RUN'],
  SHOP: ['RUN', 'PAUSE'],
  CAMPFIRE: ['RUN', 'PAUSE'],
  EVENT: ['RUN', 'BATTLE'],
  PAUSE: ['RUN', 'BATTLE', 'MENU'],
  SETTLEMENT: ['MENU', 'STATS', 'RUN'],
  TEST: ['MENU', 'BATTLE'],
  CODEX: ['MENU'],
  STATS: ['MENU', 'SETTLEMENT'],
}

// 状态机：持有当前状态并提供受约束的迁移
export class StateMachine {
  private phase: GamePhase = 'MENU'

  // 获取当前状态
  get current(): GamePhase {
    return this.phase
  }

  // 受约束迁移：非法迁移直接抛错（防止组件绕过状态机）
  transition(to: GamePhase): void {
    if (!TRANSITIONS[this.phase].includes(to)) {
      throw new Error(`非法状态迁移：${this.phase} → ${to}`)
    }
    this.phase = to
  }

  // 直接设置（仅用于恢复存档等受控场景）
  force(phase: GamePhase): void {
    this.phase = phase
  }
}

// 单例导出（应用内全局共享一个状态机）
export const stateMachine = new StateMachine()
