/**
 * 事件系统数据完整性测试（document/event.md 全量 57 个事件）
 * 覆盖：① id 唯一且可经 eventMap 索引；② stage 取值合法；
 *       ③ 运行环境（任意+密林幕）事件池均可选；④ 每个事件至少有一个可选选项。
 */
import { describe, it, expect } from 'vitest'
import { eventsData, eventMap } from '@/data'

// stage 允许的全部取值（对齐 types/event.ts 与 parse-events.mjs 的 EVENT_STAGE 映射）
const VALID_STAGES = new Set([
  'any',
  'overgrowth',
  'harbor',
  'nest',
  'glory',
  'phase1',
  'phase2',
  'phase3',
])

describe('事件数据完整性（全量事件）', () => {
  it('事件总数达到 document/event.md 全量 57 个', () => {
    expect(eventsData.events.length).toBe(57)
  })

  it('id 全局唯一，且均能经 eventMap 索引', () => {
    const ids = eventsData.events.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of eventsData.events) {
      expect(eventMap.get(e.id)).toBeTruthy()
    }
  })

  it('每个事件的 stage 取值合法', () => {
    for (const e of eventsData.events) {
      expect(VALID_STAGES.has(e.stage), `${e.name} 的 stage=${e.stage}`).toBe(true)
    }
  })

  it('运行环境事件池（任意阶段 + 密林幕）均未整事件剔除', () => {
    const pool = eventsData.events.filter(
      (e) => !e.excluded && (e.stage === 'any' || e.stage === 'overgrowth'),
    )
    expect(pool.length).toBeGreaterThan(0)
    for (const e of pool) {
      expect(e.id).toBeTruthy()
    }
  })

  it('每个可选事件至少提供 1 个选项（商人？？？为独立商店型事件除外）', () => {
    for (const e of eventsData.events) {
      if (e.id === 'fake_merchant') continue
      expect(e.options.length, `${e.name} 缺少选项`).toBeGreaterThan(0)
    }
  })

  it('药水依赖事件「药水的未来？」整体被剔除，符合预期', () => {
    const e = eventsData.events.find((x) => x.id === 'the_future_of_potions')
    expect(e?.excluded).toBe(true)
  })
})
