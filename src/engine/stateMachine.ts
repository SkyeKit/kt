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
  // REWARD → BATTLE：奖励页返回战斗界面（已结算只读查看，PRD §3.3.7）
  REWARD: ['RUN', 'BATTLE'],
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
// 注：本模块保持纯逻辑（无 Vue 依赖），通过 onChange 订阅把状态变化同步给 store（响应式）
export class StateMachine {
  private phase: GamePhase = 'MENU'
  private listeners: Array<(phase: GamePhase) => void> = []

  // 获取当前状态
  get current(): GamePhase {
    return this.phase
  }

  // 订阅状态变化（gameStore 用其同步响应式 ref）
  onChange(listener: (phase: GamePhase) => void): void {
    this.listeners.push(listener)
  }

  // 受约束迁移：非法迁移直接抛错（防止组件绕过状态机）
  transition(to: GamePhase): void {
    if (!TRANSITIONS[this.phase].includes(to)) {
      throw new Error(`非法状态迁移：${this.phase} → ${to}`)
    }
    this.phase = to
    this.emit()
  }

  // 直接设置（仅用于恢复存档等受控场景）
  force(phase: GamePhase): void {
    this.phase = phase
    this.emit()
  }

  // 通知订阅者（store 同步响应式状态）
  private emit(): void {
    for (const listener of this.listeners) listener(this.phase)
  }
}

// 单例导出（应用内全局共享一个状态机）
export const stateMachine = new StateMachine()
