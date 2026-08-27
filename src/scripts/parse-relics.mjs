/**
 * 遗物数据转换：relic.md → data/relics.json
 * MVP 所需：涅奥池（30，剔除 5 件药水/多人相关）+ 战士专属（9）+ 通用精选（20）+ 先古之民（3）。
 * 数据文本来自 relic.md 表格；ID/稀有度/触发钩子由 PRD（§3.1/§3.8）映射表补充。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTable } from './parse-utils.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOC = join(__dirname, '..', '..', 'document')
const OUT = join(__dirname, '..', 'data')

// 中文遗物名 → { id, rarity, trigger }（依据 PRD §3.1/§3.8 映射；trigger 为引擎钩子）
const RELIC_META = {
  // 涅奥池 30（PRD §3.1；⚠️5 件 MVP 剔除）
  燃烧之血: { id: 'burning_blood', rarity: '先古之民', trigger: 'ON_COMBAT_END' },
  残破之环: { id: 'broken_crown', rarity: '稀有', trigger: 'PASSIVE' },
  巨大卷轴: { id: 'massive_scroll', rarity: '罕见', trigger: 'ON_COMBAT_START', excluded: true },
  打刀: { id: 'uchigatana', rarity: '罕见', trigger: 'PASSIVE' },
  白银熔炉: { id: 'silver_furnace', rarity: '罕见', trigger: 'PASSIVE' },
  幸运硬币: { id: 'lucky_coin', rarity: '稀有', trigger: 'ON_PICKUP' },
  熔岩灯: { id: 'lava_lamp', rarity: '稀有', trigger: 'ON_COMBAT_END' },
  残破齿轮: { id: 'broken_gear', rarity: '罕见', trigger: 'PASSIVE' },
  魔像核心: { id: 'golem_core', rarity: '罕见', trigger: 'ON_TURN_START' },
  心脏宝珠: { id: 'heart_orb', rarity: '稀有', trigger: 'PASSIVE' },
  花镜: { id: 'flower_mirror', rarity: '罕见', trigger: 'PASSIVE' },
  寻龙尺: { id: 'dowsing_rod', rarity: '罕见', trigger: 'ON_COMBAT_START' },
  涅奥的牺牲: { id: 'neows_sacrifice', rarity: '罕见', trigger: 'ON_PICKUP', excluded: true },
  涅奥之泪: { id: 'neows_tears', rarity: '稀有', trigger: 'ON_PICKUP' },
  碎梦: { id: 'broken_dreams', rarity: '罕见', trigger: 'ON_TURN_START' },
  先祖碎片: { id: 'ancestral_shard', rarity: '罕见', trigger: 'ON_PICKUP' },
  结晶之心: { id: 'crystal_heart', rarity: '稀有', trigger: 'PASSIVE' },
  以太之泪: { id: 'aether_tears', rarity: '稀有', trigger: 'ON_COMBAT_START' },
  咒术之匣: { id: 'curse_box', rarity: '罕见', trigger: 'ON_PICKUP' },
  苦修法典: { id: 'codex_of_penance', rarity: '稀有', trigger: 'ON_TURN_END' },
  万花筒: { id: 'kaleidoscope', rarity: '罕见', trigger: 'PASSIVE', excluded: true },
  不灭明灯: { id: 'unquenchable_lantern', rarity: '罕见', trigger: 'ON_COMBAT_START' },
  熔火护符: { id: 'molten_charm', rarity: '罕见', trigger: 'PASSIVE' },
  火山之心: { id: 'volcanic_heart', rarity: '稀有', trigger: 'ON_COMBAT_START' },
  扭曲之枝: { id: 'twisted_branch', rarity: '稀有', trigger: 'ON_PICKUP' },
  失落背包: { id: 'lost_coffer', rarity: '罕见', trigger: 'ON_COMBAT_START', excluded: true },
  碎晶石: { id: 'shattered_crystal', rarity: '罕见', trigger: 'ON_COMBAT_END' },
  远古之泪: { id: 'ancient_tears', rarity: '稀有', trigger: 'ON_COMBAT_START' },
  药瓶皮套: { id: 'phial_holster', rarity: '罕见', trigger: 'ON_PICKUP', excluded: true },
  星火: { id: 'spark_of_stars', rarity: '罕见', trigger: 'ON_TURN_START' },
  // 战士专属 9（PRD §3.8）
  黑暗之血: { id: 'black_blood', rarity: '稀有', trigger: 'ON_COMBAT_END' },
  红头骨: { id: 'red_skull', rarity: '罕见', trigger: 'PASSIVE' },
  纸蛙: { id: 'paper_frog', rarity: '罕见', trigger: 'PASSIVE' },
  自成型黏土: { id: 'self_forming_clay', rarity: '罕见', trigger: 'ON_DAMAGE_TAKEN' },
  卡戎之灰: { id: 'charons_ashes', rarity: '稀有', trigger: 'ON_CARD_EXHAUST' },
  恶魔之舌: { id: 'demons_tongue', rarity: '稀有', trigger: 'ON_DAMAGE_TAKEN' },
  损毁头盔: { id: 'broken_helmet', rarity: '稀有', trigger: 'ON_STRENGTH_GAIN' },
  硫磺: { id: 'brimstone', rarity: '商店', trigger: 'ON_TURN_START' },
  // 通用精选 20（PRD §3.8）
  金刚杵: { id: 'vajra', rarity: '普通', trigger: 'ON_COMBAT_START' },
  锚: { id: 'anchor', rarity: '普通', trigger: 'ON_COMBAT_START' },
  弹珠袋: { id: 'bag_of_marbles', rarity: '普通', trigger: 'ON_COMBAT_START' },
  灯笼: { id: 'lantern', rarity: '普通', trigger: 'ON_TURN_START' },
  红面具: { id: 'red_mask', rarity: '普通', trigger: 'ON_COMBAT_START' },
  开心小花: { id: 'happy_flower', rarity: '普通', trigger: 'ON_TURN_START' },
  百年积木: { id: 'centennial_puzzle', rarity: '普通', trigger: 'ON_DAMAGE_TAKEN' },
  草莓: { id: 'strawberry', rarity: '普通', trigger: 'ON_PICKUP' },
  船夹板: { id: 'horn_cleat', rarity: '罕见', trigger: 'ON_TURN_START' },
  地精之角: { id: 'gremlin_horn', rarity: '罕见', trigger: 'ON_ENEMY_DEATH' },
  钢笔尖: { id: 'pen_nib', rarity: '罕见', trigger: 'ON_PLAY_CARD' },
  精致折扇: { id: 'ornamental_fan', rarity: '罕见', trigger: 'ON_PLAY_CARD' },
  双截棍: { id: 'nunchaku', rarity: '罕见', trigger: 'ON_PLAY_CARD' },
  冰淇淋: { id: 'ice_cream', rarity: '稀有', trigger: 'PASSIVE' },
  带骨肉: { id: 'meat_on_the_bone', rarity: '稀有', trigger: 'ON_COMBAT_END' },
  坚固钳子: { id: 'sturdy_clamp', rarity: '稀有', trigger: 'PASSIVE' },
  苦无: { id: 'kunai', rarity: '稀有', trigger: 'ON_PLAY_CARD' },
  历石: { id: 'stone_calendar', rarity: '稀有', trigger: 'ON_TURN_END' },
  化学物X: { id: 'chemical_x', rarity: '商店', trigger: 'PASSIVE' },
  会员卡: { id: 'membership_card', rarity: '商店', trigger: 'ON_SHOP_ENTER' },
  // 先古之民 3（PRD §3.8，达弗池）
  黑星: { id: 'black_star', rarity: '先古之民', trigger: 'ON_COMBAT_END' },
  符文金字塔: { id: 'runic_pyramid', rarity: '先古之民', trigger: 'PASSIVE' },
  潘多拉魔盒: { id: 'pandoras_box', rarity: '先古之民', trigger: 'ON_PICKUP' },
}

// 涅奥池 30 件 id（PRD §3.1）
const NEOW_IDS = [
  'broken_crown',
  'massive_scroll',
  'uchigatana',
  'silver_furnace',
  'lucky_coin',
  'lava_lamp',
  'broken_gear',
  'golem_core',
  'heart_orb',
  'flower_mirror',
  'dowsing_rod',
  'neows_sacrifice',
  'neows_tears',
  'broken_dreams',
  'ancestral_shard',
  'crystal_heart',
  'aether_tears',
  'curse_box',
  'codex_of_penance',
  'kaleidoscope',
  'unquenchable_lantern',
  'molten_charm',
  'volcanic_heart',
  'twisted_branch',
  'lost_coffer',
  'shattered_crystal',
  'ancient_tears',
  'phial_holster',
  'spark_of_stars',
  'burning_blood',
]

// 战士专属 9 件 id（PRD §3.8）
const WARRIOR_IDS = [
  'burning_blood',
  'black_blood',
  'red_skull',
  'paper_frog',
  'self_forming_clay',
  'charons_ashes',
  'demons_tongue',
  'broken_helmet',
  'brimstone',
]

// 从 relic.md 读取名称→效果映射（保持数据源权威）
function loadRelicEffects(md) {
  const map = new Map()
  for (const row of parseTable(md, '名称')) {
    const name = row['名称'].trim()
    const effect = row['效果'] ?? ''
    if (name && effect) map.set(name, effect)
  }
  return map
}

// 生成 relics.json
export function generateRelics() {
  const md = readFileSync(join(DOC, 'relic.md'), 'utf-8')
  const effects = loadRelicEffects(md)
  const neowPool = []
  const warrior = []
  const general = []
  const ancient = []

  for (const [name, meta] of Object.entries(RELIC_META)) {
    const relic = {
      id: meta.id,
      name,
      rarity: meta.rarity,
      trigger: meta.trigger,
      desc: effects.get(name) ?? '(效果见数据文件)',
      excluded: meta.excluded ?? false,
    }
    // 归类：燃烧之血同属涅奥池与战士专属；先古之民独立（燃烧之血虽标先古之民但属战士池）
    if (NEOW_IDS.includes(meta.id)) neowPool.push(relic)
    if (WARRIOR_IDS.includes(meta.id)) warrior.push(relic)
    if (meta.rarity === '先古之民' && !WARRIOR_IDS.includes(meta.id)) ancient.push(relic)
    if (!NEOW_IDS.includes(meta.id) && !WARRIOR_IDS.includes(meta.id) && meta.rarity !== '先古之民')
      general.push(relic)
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, 'relics.json'),
    JSON.stringify({ neowPool, warrior, general, ancient }, null, 2),
    'utf-8',
  )
  console.log(
    `relics.json 生成完成：涅奥池 ${neowPool.length}（含剔除 ${neowPool.filter((r) => r.excluded).length}）/ 战士 ${warrior.length} / 通用 ${general.length} / 先古 ${ancient.length}`,
  )
}
