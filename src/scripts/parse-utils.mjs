/**
 * 数据转换公共工具（agent.md §5.1：document/*.md → data/*.json）
 * 提供：Markdown 表格解析、中文效果文本 → 结构化效果链、关键词提取。
 * 解析规则覆盖 MVP 常用句式；无法解析的复杂卡牌效果留空（引擎兜底，UI 显示原文）。
 */

// 从 Markdown 表格块提取数据行
export function parseTable(md, tableTitle = '名称') {
  const lines = md.split('\n')
  const tables = []
  let inTable = false
  let header = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = splitRow(trimmed)
      if (!inTable) {
        header = cells
        inTable = true
      } else if (cells.every((c) => /^:?-{2,}:?$/.test(c.trim()))) {
        // 分隔行：跳过
      } else {
        const record = {}
        header.forEach((h, i) => {
          record[h.trim()] = (cells[i] ?? '').trim()
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

// 拆分表格行
function splitRow(line) {
  const inner = line.slice(1, -1)
  return inner.split('|').map((c) => c.trim())
}

// 提取中文效果中的首个数字
export function firstNum(text) {
  const m = text.match(/[-+]?\d+/)
  return m ? parseInt(m[0], 10) : null
}

// 效果文本 → 效果链（玩家视角；source 为 'enemy' 时目标语义翻转）
export function parseEffects(text, source = 'player') {
  const effects = []
  const t = text.replace(/[。；;]\s*/g, '；')

  // 多段攻击：造成X点伤害×N次/段 或 造成X点伤害N次
  const multiHit = t.match(/造成(\d+)点伤害[×x]?(\d+)[次段]/)
  if (multiHit) {
    effects.push({
      type: 'damage',
      target: 'enemy',
      amount: parseInt(multiHit[1], 10),
      hits: parseInt(multiHit[2], 10),
    })
  } else {
    const dmg = t.match(/造成(\d+)点伤害/)
    if (dmg) effects.push({ type: 'damage', target: 'enemy', amount: parseInt(dmg[1], 10) })
  }
  // 对所有敌人造成伤害
  if (t.includes('所有敌人') && !multiHit) {
    const all = t.match(/对所有敌人造成(\d+)点伤害/)
    if (all) effects.push({ type: 'damage', target: 'allEnemies', amount: parseInt(all[1], 10) })
  }
  // 随机敌人伤害
  const rand = t.match(/随机对敌人造成(\d+)点伤害/)
  if (rand) effects.push({ type: 'damage', target: 'randomEnemy', amount: parseInt(rand[1], 10) })

  // 格挡 / 覆甲
  const blk = t.match(/获得(\d+)点格挡/)
  if (blk) effects.push({ type: 'block', amount: parseInt(blk[1], 10) })
  const armor = t.match(/获得(\d+)层覆甲/)
  if (armor)
    effects.push({
      type: 'applyStatus',
      target: 'self',
      status: 'armor',
      amount: parseInt(armor[1], 10),
    })

  // 抽牌
  const draw = t.match(/抽(\d+)张牌/)
  if (draw) effects.push({ type: 'draw', count: parseInt(draw[1], 10) })

  // 获得能量
  const energy = t.match(/获得(\d+)点能量/)
  if (energy) effects.push({ type: 'gainEnergy', amount: parseInt(energy[1], 10) })

  // 力量/敏捷
  const str = t.match(/获得(\d+)点力量/)
  if (str)
    effects.push({
      type: 'applyStatus',
      target: 'self',
      status: 'strength',
      amount: parseInt(str[1], 10),
    })
  const dex = t.match(/获得(\d+)点敏捷/)
  if (dex)
    effects.push({
      type: 'applyStatus',
      target: 'self',
      status: 'dexterity',
      amount: parseInt(dex[1], 10),
    })

  // 状态施加（易伤/虚弱/脆弱等）：N层X
  for (const [zh, id] of STATUS_MAP) {
    const re = new RegExp(`(\\d+)层${escapeRe(zh)}`)
    const amount = t.match(re)
    if (amount) {
      effects.push({
        type: 'applyStatus',
        target: 'enemy',
        status: id,
        amount: parseInt(amount[1], 10),
      })
    }
    // 怪物施加：给予玩家"缩小"状态
    const special = t.match(new RegExp(`给予玩家["“]?${escapeRe(zh)}["”]?状态`))
    if (special && source === 'enemy') {
      effects.push({ type: 'applyStatus', target: 'enemy', status: id, amount: firstNum(t) ?? 1 })
    }
  }

  // 治疗 / 失去生命 / 最大生命
  const heal = t.match(/回复(\d+)点生命/)
  if (heal) effects.push({ type: 'heal', amount: parseInt(heal[1], 10) })
  const lose = t.match(/失去(\d+)点生命/)
  if (lose) effects.push({ type: 'loseHp', amount: parseInt(lose[1], 10) })
  const maxHpGain = t.match(/获得(\d+)点最大生命/)
  if (maxHpGain) effects.push({ type: 'gainMaxHp', amount: parseInt(maxHpGain[1], 10) })
  const maxHpLose = t.match(/失去(\d+)点最大生命/)
  if (maxHpLose) effects.push({ type: 'loseMaxHp', amount: parseInt(maxHpLose[1], 10) })

  // 洗入状态牌：向弃牌堆洗入 N 张【X】
  const wash = t.match(/向弃牌堆洗入(\d+)张【([^】]+)】/)
  if (wash) {
    const cardId = CARD_ALIAS[wash[2]] ?? wash[2]
    for (let i = 0; i < parseInt(wash[1], 10); i++) {
      effects.push({ type: 'addCard', cardId, to: 'discard' })
    }
  }

  // 消耗关键词
  if (t.includes('消耗')) effects.push({ type: 'exhaust' })

  // 去重
  return dedupe(effects)
}

// 状态中文名 → id
const STATUS_MAP = [
  ['易伤', 'vulnerable'],
  ['虚弱', 'weak'],
  ['脆弱', 'frail'],
  ['混乱', 'confused'],
  ['缩小', 'shrink'],
  ['紧缠', 'constricted'],
  ['缠结', 'tangled'],
  ['昏眩', 'ringing'],
  ['击晕', 'stunned'],
  ['滑溜', 'slippery'],
  ['幻象', 'illusion'],
  ['领地意识', 'territorial'],
  ['缓慢', 'slow'],
  ['无实体', 'intangible'],
  ['荆棘', 'thorns'],
  ['活力', 'vigor'],
]

// 状态牌中文名 → 卡牌 id
export const CARD_ALIAS = {
  黏液: 'slime',
  晕眩: 'dizzy',
  感染: 'infection',
  伤口: 'wound',
  笨拙: 'clumsy',
  愧疚: 'guilt',
  受伤: 'injured',
  贪婪: 'greed',
  睡眠不佳: 'bad_sleep',
  孢子心灵: 'spore_mind',
  多尼斯异鸟蛋: 'byrdonis_egg',
  苦恼: 'anguish',
  啄击: 'peck',
  坚韧之环: 'tough_ring',
  巨石: 'boulder',
  冷光: 'cold_light',
  小刀: 'shiv',
  灵魂: 'soul',
  燃料: 'fuel',
  虚空: 'void',
  灼伤: 'burn',
  凋萎: 'wilt',
}

// 关键词提取
export function parseKeywords(text) {
  const keywords = []
  if (text.includes('消耗')) keywords.push('exhaust')
  if (text.includes('固有')) keywords.push('innate')
  if (text.includes('保留')) keywords.push('retain')
  if (text.includes('虚无')) keywords.push('ethereal')
  if (text.includes('不能被打出')) keywords.push('unplayable')
  return keywords
}

// 正则转义
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 效果去重
function dedupe(effects) {
  const seen = new Set()
  return effects.filter((e) => {
    const key = JSON.stringify(e)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
