/**
 * 事件数据转换：event.md → data/events.json
 * 提取 MVP 16 个事件（任意阶段 4 + 密林幕 12），保留触发条件与选项文本；
 * 「药水的未来？」依赖药水系统 → excluded；涉及药水的选项标 excluded。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOC = join(__dirname, '..', '..', 'document')
const OUT = join(__dirname, '..', 'data')

// MVP 事件清单：任意阶段 4 + 密林幕 12（PRD §3.7）
const MVP_EVENTS = [
  '自助指南',
  '滑脚木桥',
  '药水的未来？',
  '这个还是那个？',
  '丛林迷宫奇遇',
  '低语空谷',
  '冷光合唱团',
  '变形灵林谷',
  '多尼斯异鸟巢',
  '无休之处',
  '木雕',
  '泉水',
  '混沌芳香',
  '真理石板',
  '茂密的植被',
  '蓝宝石种子',
]

// 密林幕事件集合（用于 stage 标记）
const OVERGROWTH_EVENTS = [
  '丛林迷宫奇遇',
  '低语空谷',
  '冷光合唱团',
  '变形灵林谷',
  '多尼斯异鸟巢',
  '无休之处',
  '木雕',
  '泉水',
  '混沌芳香',
  '真理石板',
  '茂密的植被',
  '蓝宝石种子',
]

// 解析事件块：### 名称 / `id` / 触发条件 / 选项
export function generateEvents() {
  const md = readFileSync(join(DOC, 'event.md'), 'utf-8')
  const events = []

  const blocks = md.split(/^### /m).slice(1)
  for (const block of blocks) {
    const lines = block.split('\n')
    const name = lines[0].trim()
    if (!MVP_EVENTS.includes(name)) continue
    const body = lines.slice(1).join('\n')

    // 事件 id：从 `xxx` 代码块提取
    const idMatch = body.match(/`([a-z_0-9]+)`/)
    const id = idMatch ? idMatch[1] : `event_${name.charCodeAt(0)}`

    // 触发条件
    const triggerMatch = body.match(/\*\*触发条件\*\*：([^\n]+)/)
    const trigger = triggerMatch ? triggerMatch[1].trim() : undefined

    // 选项
    const options = []
    const optSection = body.match(/\*\*选项\*\*：\n([\s\S]+?)(?=\n\*\*|\n---|\n###|$)/)
    if (optSection) {
      for (const line of optSection[1].split('\n')) {
        const m = line.match(/^-\s*\*\*([^*]+)\*\*：(.+)/)
        if (m) {
          const text = m[1].trim()
          const effect = m[2]
            .trim()
            .replace(/（备注：.+$/s, '')
            .trim()
          options.push({
            text,
            effect,
            excluded: effect.includes('药水') && !effect.includes('药水形状'),
          })
        }
      }
    }

    events.push({
      id,
      name,
      stage: OVERGROWTH_EVENTS.includes(name) ? 'overgrowth' : 'any',
      trigger,
      options,
      excluded: name === '药水的未来？',
    })
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'events.json'), JSON.stringify({ events }, null, 2), 'utf-8')
  console.log(
    `events.json 生成完成：${events.length} 个事件（生效 ${events.filter((e) => !e.excluded).length}）`,
  )
}
