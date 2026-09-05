/**
 * 附魔数据转换：enchantments.md → data/enchantments.json（全量 22 个）
 * 数据来自 slaythespire2.gg/zh/enchantments，由 document/enchantments.md 表格承载：
 * - ID/名称/效果文本/来源 来自表格；「语义」列为机器可读 JSON，脚本原样 JSON.parse 读取；
 * - id 直接用表格的 ID（snake_case，与引擎注册一致）；数值全部来自 md，脚本不做改写。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOC = join(__dirname, '..', '..', 'document')
const OUT = join(__dirname, '..', 'data')

// 从 Markdown 表格块提取数据行（与 parse-utils 同逻辑，避免循环依赖）
function parseTable(md, tableTitle = 'ID') {
  const lines = md.split('\n')
  const tables = []
  let inTable = false
  let header = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim())
      if (!inTable) {
        header = cells
        inTable = true
      } else if (cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        // 分隔行：跳过
      } else {
        const record = {}
        header.forEach((h, i) => {
          record[h] = cells[i] ?? ''
        })
        if (record[tableTitle] && record[tableTitle] !== tableTitle) {
          tables.push(record)
        }
      }
    } else {
      inTable = false
    }
  }
  return tables
}

// 解析"语义"列：``` 反引号包裹的 JSON 字符串 → 对象；解析失败返回空对象（引擎按无效果处理）
function parseSemantics(raw) {
  if (!raw) return {}
  const json = raw.replace(/^`|`$/g, '')
  try {
    return JSON.parse(json)
  } catch {
    console.warn(`⚠️ 附魔语义解析失败：${raw}`)
    return {}
  }
}

export function generateEnchantments() {
  const md = readFileSync(join(DOC, 'enchantments.md'), 'utf-8')
  const rows = parseTable(md)
  const enchantments = rows
    .filter((r) => r.ID)
    .map((r) => ({
      id: r.ID.trim(),
      name: r['名称'].trim(),
      desc: r['效果'].trim(),
      source: r['来源'].trim(),
      // 语义字段（机器可读效果，引擎按此叠加；含伤害/格挡/关键词/触发型等）
      ...parseSemantics(r['语义']),
    }))

  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'enchantments.json'), JSON.stringify({ enchantments }, null, 2))
  console.log(`✅ enchantments.json：${enchantments.length} 个附魔`)
}
