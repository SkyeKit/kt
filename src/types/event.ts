/**
 * 事件类型（PRD §3.7 / 数据源 document/event.md）
 * MVP 事件池 = 任意阶段 4 个 + 密林幕 12 个 = 16 个（「药水的未来？」依赖药水系统剔除，实际生效 15 个）。
 */

// 事件选项的结算效果（供事件 UI 展示与 useEvent 执行）
export interface EventOptionEffect {
  text: string // 选项名（如 跨越 / 再撑一会）
  effect: string // 选项结算效果文本（含数值，原样引用数据文件）
  requires?: string // 前置条件描述（如"至少 44 金币"）
  battle?: boolean // 是否触发事件专属战斗
  excluded?: boolean // 是否 MVP 剔除（药水相关选项）
}

export interface GameEvent {
  id: string // snake_case（如 self_help_book，来自 event.md）
  name: string
  stage: 'any' | 'overgrowth' // 任意阶段 / 密林幕
  trigger?: string // 触发条件（无则无条件）
  options: EventOptionEffect[]
  excluded?: boolean // 整个事件是否 MVP 剔除（药水的未来？）
}
