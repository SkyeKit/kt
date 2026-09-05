/**
 * 事件类型（PRD §3.7 / 数据源 document/event.md）
 * 数据含全部 57 个事件，stage 标注其所属阶段/幕：
 *   any 任意阶段 / overgrowth 密林 / harbor 暗港 / nest 巢穴 / glory 荣耀 / phase1~3 通用阶段。
 * 运行环境（密林幕地图）仅触发 any 与 overgrowth 事件；其余属数据完备但当前不可达。
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
  stage: 'any' | 'overgrowth' | 'harbor' | 'nest' | 'glory' | 'phase1' | 'phase2' | 'phase3'
  trigger?: string // 触发条件（无则无条件）
  options: EventOptionEffect[]
  excluded?: boolean // 整个事件是否剔除（依赖药水/多人的「药水的未来？」）
}
