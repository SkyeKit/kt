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

// 中文数字/阿拉伯数字 → 阿拉伯数字（用于解析"两次/二段/十次"等攻击次数）
// 支持单一中文数字（两/二/三…九/十）与组合（十二/二十/二十三）；纯数字直接 parseInt
function numToAr(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  const map = { 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  // 组合式：以"十"为分界，前面是十位（缺省为 1），后面是个位
  if (s.includes('十')) {
    const [hiPart, loPart] = s.split('十')
    const hi = hiPart ? (map[hiPart] ?? parseInt(hiPart, 10)) : 1
    const lo = loPart ? (map[loPart] ?? parseInt(loPart, 10)) : 0
    return hi * 10 + lo
  }
  const n = map[s] ?? parseInt(s, 10)
  return Number.isNaN(n) ? 0 : n
}

// 效果文本 → 效果链（玩家视角；source 为 'enemy' 时目标语义翻转）
export function parseEffects(text, source = 'player') {
  const effects = []
  // 敌人文档效果含空格（"造成 4 点伤害"）与卡牌无空格（"造成4点伤害"）并存，统一去掉空白再匹配
  const t = text.replace(/\s+/g, '').replace(/[。；;]/g, '；')

  // === 内在/触发类（状态/诅咒牌）：先于通用解析判定，避免"你受到X点伤害"被误判为对敌方伤害 ===
  // 倾泻（X 费用）：打出抽牌堆顶部的 X 张牌；升级为 X+1（数值以投入能量为基准，升级 plus=1）
  const pour = t.match(/打出你抽牌堆顶部的X(\+1)?张牌/)
  if (pour) {
    effects.push(pour[1] ? { type: 'playTopXCards', plus: 1 } : { type: 'playTopXCards' })
    return effects
  }
  // 回合结束时若在手牌中则触发（如 灼伤/凋萎/毒素/腐朽/霉运/悔恨/债务/羞耻/疑虑 等）
  const endTurn = t.match(/在你的回合结束时，如果这张牌在你的手牌中，(?:你)?(.+)/)
  if (endTurn) {
    effects.push({
      type: 'intrinsic',
      trigger: 'endOfTurn',
      effects: parseIntrinsic(endTurn[1]),
    })
    // 仍保留"消耗"等关键词解析（由调用方统一 parseKeywords，此处无需重复）
    return effects
  }
  // 抽到这张牌时触发（如 虚空：抽到失去 1 点能量）
  const onDraw = t.match(/每当你?抽到这张牌时，(?:你)?(.+)/)
  if (onDraw) {
    effects.push({
      type: 'intrinsic',
      trigger: 'onDraw',
      effects: parseIntrinsic(onDraw[1]),
    })
    return effects
  }

  // 多段攻击：支持"造成X点伤害N次/段"、"造成X点伤害两次"(中文数字)、"造成X点伤害3次" 三种写法
  const multiHit = t.match(/(?:造成)?(\d+)点伤害[×x]?([0-9两二三四五六七八九十]+)[次段]/)
  if (multiHit) {
    effects.push({
      type: 'damage',
      target: 'enemy',
      amount: parseInt(multiHit[1], 10),
      hits: numToAr(multiHit[2]),
    })
  } else {
    const dmg = t.match(/(?:造成)?(\d+)点伤害/)
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

  // 选择一张牌加入手牌（无色交互卡：发现/飞溅/秘密技法/秘密武器/许愿/探寻打击）
  // 注意顺序：先匹配更具体的句式，避免互相误命中
  const wish = t.match(/将你抽牌堆中的(?:一张|1张)牌放?入你的手牌/)
  if (wish) effects.push({ type: 'chooseAdd', filter: 'anyInDraw' })
  const seek = t.match(/从抽牌堆的随机(\d+)张牌中选择一张加?入你的手牌/)
  if (seek) effects.push({ type: 'chooseAdd', filter: 'seek', count: parseInt(seek[1], 10) })
  const tech = t.match(/从抽牌堆中选择一张技能牌放?入你的手牌/)
  if (tech) effects.push({ type: 'chooseAdd', filter: 'skillInDraw' })
  const weapon = t.match(/从抽牌堆中选择一张攻击牌放?入你的手牌/)
  if (weapon) effects.push({ type: 'chooseAdd', filter: 'attackInDraw' })
  const find = t.match(/从(\d+)张随机牌中选择1张加?入你的手牌/)
  if (find)
    effects.push({ type: 'chooseAdd', filter: 'random', count: parseInt(find[1], 10), free: true })
  const splash = t.match(/从(\d+)张其他角色的攻击牌中选择1张加?入你的手牌/)
  if (splash)
    effects.push({
      type: 'chooseAdd',
      filter: 'attack',
      count: parseInt(splash[1], 10),
      free: true,
    })

  // 本回合保留手牌（均衡/箭雨等）
  if (t.includes('在本回合保留你的手牌')) effects.push({ type: 'retainHandThisTurn' })

  // 重放：抽牌堆中一张无重放的随机牌获得 X 层重放（未掘宝石）
  const replay = t.match(/获得(\d+)层重放/)
  if (replay) effects.push({ type: 'grantReplay', count: parseInt(replay[1], 10) })

  // 消耗关键词
  if (t.includes('消耗')) effects.push({ type: 'exhaust' })

  // 去重
  return dedupe(effects)
}

// 解析"在你回合结束时/抽到这张牌时"的内在触发效果（均针对玩家自身）
// 覆盖常见句式：受X点伤害/失去X点生命/失去X金币/失去手牌数生命/获得X层脆弱或虚弱
function parseIntrinsic(innerText) {
  const inner = []
  const loseHp = innerText.match(/你?受到(\d+)点伤害/)
  if (loseHp) inner.push({ type: 'loseHp', amount: parseInt(loseHp[1], 10) })
  const loseHp2 = innerText.match(/你?失去(\d+)点生命/)
  if (loseHp2) inner.push({ type: 'loseHp', amount: parseInt(loseHp2[1], 10) })
  const loseGold = innerText.match(/你?失去(\d+)金币/)
  if (loseGold) inner.push({ type: 'loseGold', amount: parseInt(loseGold[1], 10) })
  // 虚空：抽到这张牌时失去能量
  const loseEn = innerText.match(/你?失去(\d+)点能量/)
  if (loseEn) inner.push({ type: 'loseEnergy', amount: parseInt(loseEn[1], 10) })
  // 悔恨：失去等同于手牌数量的生命
  if (innerText.includes('手牌数量')) inner.push({ type: 'loseHpHandSize' })
  // 羞耻/疑虑：获得 1 层脆弱/虚弱（施加给自己）
  for (const [zh, id] of STATUS_MAP) {
    const re = new RegExp(`获得(\\d+)层${escapeRe(zh)}`)
    const m = innerText.match(re)
    if (m)
      inner.push({ type: 'applyStatus', target: 'self', status: id, amount: parseInt(m[1], 10) })
  }
  return inner
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
  if (text.includes('永恒')) keywords.push('unique')
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
