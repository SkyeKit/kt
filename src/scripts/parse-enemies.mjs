/**
 * 敌人数据转换：Overgrowth.md → data/enemies.json
 * 解析：遭遇池（§2）+ 怪物详情（§3，含行为模式/招式/衍生物）+ 劫掠者团伙。
 * AI 模式从"行为模式"文本启发式推导：固定循环 → loop；随机/概率 → weighted；按回合脚本 → scripted。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTable, parseEffects } from './parse-utils.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOC = join(__dirname, '..', '..', 'document')
const OUT = join(__dirname, '..', 'data')

// 中文怪名 → snake_case id（与 img.md 命名一致）
const ENEMY_ID = {
  毛绒伏地虫: 'fuzzy_wurm_crawler',
  小啃兽: 'nibbit',
  缩小甲虫: 'shrinker_beetle',
  '树叶史莱姆（小）': 'leaf_slime_s',
  '树叶史莱姆（中）': 'leaf_slime_m',
  '树枝史莱姆（小）': 'twig_slime_s',
  '树枝史莱姆（中）': 'twig_slime_m',
  立柱构造体: 'cubex_construct',
  飞蝇菌子: 'flyconid',
  闪光贾克斯果: 'snapping_jaxfruit',
  雾菇: 'fogmog',
  墨宝: 'inklet',
  蛮兽: 'mawler',
  蛇行扼杀者: 'slithering_strangler',
  藤蔓蹒跚者: 'vine_shambler',
  利齿之眼: 'eye_with_teeth',
  扭动虫: 'wriggler',
  劫掠者暴徒: 'raider_brute',
  劫掠者刺客: 'raider_assassin',
  劫掠者斧手: 'raider_axe',
  劫掠者弩手: 'raider_crossbow',
  劫掠者追踪手: 'raider_tracker',
  多尼斯异鸟: 'byrdonis',
  旧日雕像: 'bygone_effigy',
  异蛙寄生虫: 'phrog_parasite',
  墨影幻灵: 'vantom',
  仪式兽: 'ceremonial_beast',
  同族小队: 'the_kin',
  同族神官: 'kin_priest',
  同族信徒: 'kin_follower',
}

// 解析 HP："55~57" → [55,57]；"65" → [65,65]
function parseHp(text) {
  const m = text.match(/(\d+)\s*~\s*(\d+)/)
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)]
  const single = text.match(/(\d+)/)
  const v = single ? parseInt(single[1], 10) : 50
  return [v, v]
}

// 解析敌人块（属性表/行为模式/招式表）
function parseEnemyBlock(header, body) {
  // 中文名：含全角括号变体（如 树叶史莱姆（小）），结尾的"（"为英文名分隔，去掉
  const zhRaw = header.match(/[\u4e00-\u9fa5·（）]+/)[0]
  const zhName = zhRaw.endsWith('（') ? zhRaw.slice(0, -1) : zhRaw
  const id = ENEMY_ID[zhName] ?? `enemy_${zhName.charCodeAt(0)}`
  if (!ENEMY_ID[zhName]) console.warn(`⚠️ 缺少敌人 ID 映射：${zhName}`)

  // 属性表
  const attrs = Object.fromEntries(parseTable(body, '属性').map((r) => [r['属性'], r['数值']]))
  const hp = parseHp(attrs['HP'] ?? '')
  const typeZh = attrs['类型'] ?? '普通'
  const category = typeZh.includes('精英')
    ? 'elite'
    : typeZh.includes('Boss')
      ? 'boss'
      : typeZh.includes('爪牙')
        ? 'minion'
        : 'normal'

  // 行为模式文本
  const behaviorMatch = body.match(/\*\*行为模式\*\*：([^\n]+)/)
  const behavior = behaviorMatch ? behaviorMatch[1].trim() : ''

  // 招式表
  const moveRows = parseTable(body, '招式')
  const moves = {}
  for (const r of moveRows) {
    const moveName = (r['招式'] ?? '').split('(')[0].trim()
    moves[moveName] = buildMove(moveName, r['效果'] ?? '')
  }

  // AI 序列：按行为模式文本中招式出现顺序提取；提取不到则用招式表顺序
  const seq = Object.keys(moves).filter((m) => behavior.includes(m))
  const sequence = seq.length > 0 ? seq : Object.keys(moves)

  // 模式推导
  let mode = 'loop'
  if (behavior.includes('概率') || behavior.includes('随机') || behavior.includes('等权重'))
    mode = 'weighted'
  else if (behavior.includes('第 1 回合') && behavior.includes('跳过')) mode = 'scripted'
  else if (behavior.includes('起手') && behavior.includes('循环')) mode = 'loop'

  // 起手特判：第 1 回合 X，之后循环 → 序列前插 X
  const startMove = behavior.match(/第 ?1 ?回合[^，,]*?(起手|行动)[^，,]*?([\u4e00-\u9fa5·]+)/)
  const first = startMove ? startMove[2] : null
  const finalSeq = first && moves[first] && sequence[0] !== first ? [first, ...sequence] : sequence

  return {
    id,
    name: zhName,
    hpMin: hp[0],
    hpMax: hp[1],
    category,
    abilities: attrs['初始能力'] && attrs['初始能力'] !== '无' ? [attrs['初始能力']] : [],
    ai: { mode, sequence: finalSeq },
    moves,
    spawns: [],
  }
}

// 构建招式：意图类别 + 效果链
function buildMove(name, effectText) {
  let intent = 'special'
  if (effectText.includes('伤害')) intent = 'attack'
  else if (effectText.includes('格挡')) intent = 'defend'
  else if (
    effectText.includes('力量') ||
    effectText.includes('敏捷') ||
    effectText.includes('覆甲')
  )
    intent = 'buff'
  else if (
    effectText.includes('给予') ||
    effectText.includes('洗入') ||
    effectText.includes('召唤')
  )
    intent = 'status'
  const dmg = effectText.match(/造成\s*(\d+)\s*点伤害/)
  const hitsMatch = effectText.match(/[×x]?(\d+)\s*[次段]/)
  return {
    name,
    intent,
    damage: dmg ? parseInt(dmg[1], 10) : undefined,
    hits: intent === 'attack' && hitsMatch ? parseInt(hitsMatch[1], 10) : 1,
    effects: parseEffects(effectText, 'enemy'),
    desc: effectText,
  }
}

// 遭遇池（Overgrowth.md §2 表）
function parseEncounters(md) {
  const weak = []
  const strong = []
  const elites = []
  const bosses = []
  let section = ''
  for (const line of md.split('\n')) {
    // 离开 §2 遭遇章节后停止解析（防止 §3 怪物表混入）
    if (line.startsWith('## ')) {
      section = ''
      continue
    }
    if (line.startsWith('### 2.')) {
      section = line
      continue
    }
    if (!section || !line.trim().startsWith('|') || line.includes('序号') || line.includes('---'))
      continue
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim())
    const comboText = cells[1] ?? ''
    if (section.includes('弱怪池')) weak.push(resolveCombo(comboText))
    else if (section.includes('强怪池')) strong.push(resolveCombo(comboText))
    else if (section.includes('精英战斗')) {
      const m = comboText.match(/([\u4e00-\u9fa5·]+)/)
      if (m) elites.push(ENEMY_ID[m[1]] ?? m[1])
    } else if (section.includes('首领战斗')) {
      const m = comboText.match(/([\u4e00-\u9fa5·]+)/)
      if (m) bosses.push(ENEMY_ID[m[1]] ?? m[1])
    }
  }
  return { weak, strong, elites, bosses }
}

// 组合文本 → 敌人 id 数组（简化：A或B 取 A；随机组合取固定样本；劫掠者/同族小队取固定编组）
function resolveCombo(text) {
  if (text.includes('同族小队')) return ['kin_priest', 'kin_follower', 'kin_follower']
  if (text.includes('劫掠者')) {
    const raiders = [
      'raider_brute',
      'raider_assassin',
      'raider_axe',
      'raider_crossbow',
      'raider_tracker',
    ]
    return [raiders[0], raiders[1], raiders[2]]
  }
  // "A 或 B"取 A；去掉"中的随机组合/中随机"等后缀
  let t = text
  if (t.includes('或')) t = t.split('或')[0]
  t = t.replace(/中的随机组合|中随机/g, '')
  // 名字匹配：优先带全角括号变体（如 树叶史莱姆（中）），否则纯名
  const nameRe = /[\u4e00-\u9fa5·]+（[\u4e00-\u9fa5·]+）|[\u4e00-\u9fa5·]+/g
  const names = t.match(nameRe) ?? []
  const counts = new Map()
  for (const raw of names) {
    if (/^[或和与及]$/.test(raw)) continue
    // 名字后面的 ×N（形如 墨宝 ×3）：从原文本该名之后截取判断
    const idx = t.indexOf(raw)
    const after = t.slice(idx + raw.length, idx + raw.length + 8)
    const mul = after.match(/^\s*[×x]\s*(\d+)/)
    const count = mul ? parseInt(mul[1], 10) : 1
    // 优先完整名（含括号变体），其次去括号变体，最终得到 snake_case id
    const key = ENEMY_ID[raw] ?? ENEMY_ID[raw.replace(/（[\u4e00-\u9fa5·]+）$/, '')]
    if (key) counts.set(key, count)
    else console.warn(`⚠️ 遭遇组合无法映射：${raw}`)
  }
  const out = []
  for (const [name, count] of counts) {
    for (let i = 0; i < count; i++) out.push(name)
  }
  return out
}

// 生成 enemies.json
export function generateEnemies() {
  const md = readFileSync(join(DOC, 'Overgrowth.md'), 'utf-8')
  const enemies = []
  const minions = []

  // 按 #### 切分怪物块
  const blocks = md.split(/^#### /m).slice(1)
  for (const block of blocks) {
    const header = block.split('\n')[0]
    const body = block.slice(header.length)
    // 劫掠者团伙：5 个子块单独解析
    if (header.includes('劫掠者团伙')) {
      const subs = body.split(/^\*\*(劫掠者[^*]+)\*\*/m).slice(1)
      for (let i = 0; i < subs.length; i += 2) {
        const subHeader = `#### ${subs[i].trim()}`
        const hpMatch = subs[i + 1].match(/HP\s*([\d~]+)/)
        const enemy = parseEnemyBlock(subHeader, subs[i + 1])
        if (hpMatch) {
          const [lo, hi] = parseHp(hpMatch[1])
          enemy.hpMin = lo
          enemy.hpMax = hi
        }
        enemies.push(enemy)
      }
      continue
    }
    // 同族小队：内部含 同族神官 / 同族信徒 两个 ** 子块，分别解析
    if (header.includes('同族小队')) {
      const subs = body.split(/^\*\*(同族[^*]+)\*\*/m).slice(1)
      for (let i = 0; i < subs.length; i += 2) {
        enemies.push(parseEnemyBlock(`#### ${subs[i].trim()}`, subs[i + 1]))
      }
      continue
    }
    const parsed = parseEnemyBlock(`#### ${header}`, body)
    // 衍生物："**衍生物 — X（Y）**" 拆分为独立 minion
    const derivedBlocks = body.split(/^\*\*衍生物\s*—\s*/m).slice(1)
    if (derivedBlocks.length > 0) {
      for (const db of derivedBlocks) {
        const dbHeader = db.split('\n')[0].trim()
        const dbBody = db.slice(dbHeader.length)
        const minion = parseEnemyBlock(`#### ${dbHeader}`, dbBody)
        minion.category = 'minion'
        const nameZh = dbHeader.split('（')[0].trim()
        if (ENEMY_ID[nameZh]) minion.id = ENEMY_ID[nameZh]
        minions.push(minion)
        parsed.spawns.push({ id: minion.id, count: 1, condition: 'onDeath' })
      }
    }
    enemies.push(parsed)
  }
  enemies.push(...minions)

  const encounters = parseEncounters(md)
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, 'enemies.json'),
    JSON.stringify({ enemies, encounters }, null, 2),
    'utf-8',
  )
  console.log(
    `enemies.json 生成完成：${enemies.length} 个敌人（弱怪池 ${encounters.weak.length} / 强怪池 ${encounters.strong.length} / 精英 ${encounters.elites.length} / Boss ${encounters.bosses.length}）`,
  )
}
