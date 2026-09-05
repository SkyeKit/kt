/**
 * 事件数据转换：event.md → data/events.json
 * 提取全部 57 个事件（任意阶段 + 三阶段 × 通用/各幕），标注 stage 与触发条件；
 * 药水类选项标 excluded（MVP 未实现药水），全事件「药水的未来？」整体 excluded。
 * stage 取值：any / overgrowth(密林) / harbor(暗港) / nest(巢穴) / glory(荣耀) / phase1~3(通用)。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOC = join(__dirname, '..', '..', 'document')
const OUT = join(__dirname, '..', 'data')

// 全部 57 个事件 → 所属阶段/幕（对齐 document/event.md §二、事件分布索引与各事件标题下的阶段标注）
// 跨阶段事件（如满屋芝士出现于第一、二阶段）取最早阶段；用于 stage 字段归类（运行时密林幕仅取 any/overgrowth）
const EVENT_STAGE = {
  自助指南: 'any',
  滑脚木桥: 'any',
  '药水的未来？': 'any',
  '这个还是那个？': 'any',
  混沌芳香: 'overgrowth',
  多尼斯异鸟巢: 'overgrowth',
  茂密的植被: 'overgrowth',
  丛林迷宫奇遇: 'overgrowth',
  冷光合唱团: 'overgrowth',
  变形灵林谷: 'overgrowth',
  蓝宝石种子: 'overgrowth',
  真理石板: 'overgrowth',
  无休之处: 'overgrowth',
  泉水: 'overgrowth',
  低语空谷: 'overgrowth',
  木雕: 'overgrowth',
  脑蛭: 'phase1',
  满屋芝士: 'phase1',
  沉没雕像: 'phase1',
  茶艺大师: 'phase1',
  传说是真的: 'phase1',
  深渊浴场: 'harbor',
  光与暗的门扉: 'harbor',
  淹水灯塔: 'harbor',
  无尽传送带: 'harbor',
  重拳出击: 'harbor',
  螺旋漩涡: 'harbor',
  淹水金库: 'harbor',
  垃圾堆: 'harbor',
  水漫缮写室: 'harbor',
  熔合者: 'nest',
  害虫杀手: 'nest',
  色彩哲学家: 'nest',
  巨大花卉: 'nest',
  人形洞穴之地: 'nest',
  被寄生的自动机械: 'nest',
  迷失鬼火: 'nest',
  灵魂嫁接者: 'nest',
  灯火钥匙: 'nest',
  修禅织网者: 'nest',
  水晶球: 'phase2',
  玩偶室: 'phase2',
  '商人？？？': 'phase2',
  药水快递员: 'phase2',
  长者兰伟德: 'phase2',
  遗物交换商: 'phase2',
  永恒之石: 'phase2',
  共生体: 'phase2',
  欢迎来到旺购百货: 'phase2',
  战痕累累的训练假人: 'glory',
  遗忘之墓: 'glory',
  蘑菇饥渴: 'glory',
  '镜中倒影 影倒中镜': 'glory',
  圆桌茶会: 'glory',
  打造时间: 'glory',
  审判: 'glory',
  '战史学家 付袭': 'glory',
}

// 整个事件被 MVP 剔除的（依赖药水/多人/宠物等核心系统）
const EVENT_EXCLUDED = ['药水的未来？']

// 解析事件块：### 名称 / `id` / 触发条件 / 选项
export function generateEvents() {
  const md = readFileSync(join(DOC, 'event.md'), 'utf-8')
  const events = []

  const blocks = md.split(/^### /m).slice(1)
  for (const block of blocks) {
    const lines = block.split('\n')
    const name = lines[0].trim().replace(/[#\s]+$/, '')
    // 仅处理已登记阶段的事件（跳过 md 中非事件小节，如文件头/注释标题）
    if (!(name in EVENT_STAGE)) continue
    const body = lines.slice(1).join('\n')

    // 事件 id：从 `xxx` 代码块提取；缺省用名字首字 ascii 兜底
    const idMatch = body.match(/`([a-z_0-9]+)`/)
    const id = idMatch ? idMatch[1] : `event_${name.charCodeAt(0)}`

    // 触发条件
    const triggerMatch = body.match(/\*\*触发条件\*\*：([^\n]+)/)
    const trigger = triggerMatch ? triggerMatch[1].trim() : undefined

    // 选项：解析第一处「**选项**：」起的一级选项列表
    // 兼容 `- **休息**：` 与 `- **休息**（触发事件战斗）：` 两种写法，捕捉文本与效果
    const options = []
    const optSection = body.match(/\*\*选项\*\*：\n([\s\S]+?)(?=\n\*\*|\n---|\n###|$)/)
    if (optSection) {
      for (const line of optSection[1].split('\n')) {
        const m = line.match(/^-\s*\*\*([^*]+?)\*\*\s*[:：]?\s*(.+)/)
        if (m) {
          const text = m[1].trim()
          const effect = m[2]
            .trim()
            .replace(/（备注：.+$/s, '')
            .replace(/^（.+?）：/, '')
            .trim()
          // 战斗选项：效果文本含"战斗/进入战斗"等（重拳出击/茂密的植被/灯火钥匙）
          const battle = /战斗/.test(effect)
          options.push({
            text,
            effect,
            battle: battle || undefined,
            // 药水相关选项剔除（MVP 未实现药水系统）
            excluded: effect.includes('药水') && !effect.includes('药水形状'),
          })
        }
      }
    }

    events.push({
      id,
      name,
      stage: EVENT_STAGE[name],
      trigger,
      options,
      excluded: EVENT_EXCLUDED.includes(name),
    })
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'events.json'), JSON.stringify({ events }, null, 2), 'utf-8')
  console.log(
    `events.json 生成完成：${events.length} 个事件（生效 ${events.filter((e) => !e.excluded).length}）`,
  )
}
