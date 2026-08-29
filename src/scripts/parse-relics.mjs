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
  // 涅奥池 30（PRD §3.1 / relic.md 四·先古之民·涅奥；⚠️5 件 MVP 剔除：巨大卷轴/失物盒/万花筒/药瓶皮套/涅奥的牺牲）
  奥术卷轴: { id: 'arcane_scroll', rarity: '先古之民', trigger: 'ON_PICKUP' },
  白银熔炉: { id: 'silver_crucible', rarity: '先古之民', trigger: 'PASSIVE' },
  沉重石板: { id: 'hefty_tablet', rarity: '先古之民', trigger: 'ON_PICKUP' },
  橙型香盒: { id: 'pomander', rarity: '先古之民', trigger: 'ON_PICKUP' },
  钓鱼竿: { id: 'fishing_rod', rarity: '先古之民', trigger: 'PASSIVE' },
  轰鸣海螺: { id: 'booming_conch', rarity: '先古之民', trigger: 'ON_COMBAT_START' },
  华美发束: { id: 'silken_tress', rarity: '先古之民', trigger: 'ON_PICKUP' },
  金色珍珠: { id: 'golden_pearl', rarity: '先古之民', trigger: 'ON_PICKUP' },
  精准剪刀: { id: 'precise_scissors', rarity: '先古之民', trigger: 'ON_PICKUP' },
  巨大卷轴: { id: 'massive_scroll', rarity: '先古之民', trigger: 'ON_PICKUP', excluded: true },
  巨大扭蛋: { id: 'large_capsule', rarity: '先古之民', trigger: 'ON_PICKUP' },
  卷轴箱: { id: 'scroll_boxes', rarity: '先古之民', trigger: 'ON_PICKUP' },
  涅奥的护符: { id: 'neows_talisman', rarity: '先古之民', trigger: 'ON_PICKUP' },
  涅奥的苦痛: { id: 'neows_torment', rarity: '先古之民', trigger: 'ON_PICKUP' },
  涅奥骨骰: { id: 'neows_bones', rarity: '先古之民', trigger: 'ON_PICKUP' },
  铅制镇纸: { id: 'lead_paperweight', rarity: '先古之民', trigger: 'ON_PICKUP' },
  熔岩石: { id: 'lava_rock', rarity: '先古之民', trigger: 'PASSIVE' },
  失物盒: { id: 'lost_coffer', rarity: '先古之民', trigger: 'ON_PICKUP', excluded: true },
  石炉加湿器: { id: 'stone_humidifier', rarity: '先古之民', trigger: 'ON_REST' },
  树叶药膏: { id: 'leafy_poultice', rarity: '先古之民', trigger: 'ON_PICKUP' },
  松动羊毛剪: { id: 'precarious_shears', rarity: '先古之民', trigger: 'ON_PICKUP' },
  万花筒: { id: 'kaleidoscope', rarity: '先古之民', trigger: 'ON_PICKUP', excluded: true },
  小型扭蛋: { id: 'small_capsule', rarity: '先古之民', trigger: 'ON_PICKUP' },
  新叶: { id: 'new_leaf', rarity: '先古之民', trigger: 'ON_PICKUP' },
  药瓶皮套: { id: 'phial_holster', rarity: '先古之民', trigger: 'ON_PICKUP', excluded: true },
  营养牡蛎: { id: 'nutritious_oyster', rarity: '先古之民', trigger: 'ON_PICKUP' },
  羽翼之靴: { id: 'winged_boots', rarity: '先古之民', trigger: 'PASSIVE' },
  诅咒珍珠: { id: 'cursed_pearl', rarity: '先古之民', trigger: 'ON_PICKUP' },
  寻龙尺: { id: 'dowsing_rod', rarity: '先古之民', trigger: 'ON_PICKUP' },
  涅奥的牺牲: { id: 'neows_sacrifice', rarity: '先古之民', trigger: 'ON_PICKUP', excluded: true },
  // 战士专属 9（PRD §3.8）
  燃烧之血: { id: 'burning_blood', rarity: '初始', trigger: 'ON_COMBAT_END' },
  黑暗之血: { id: 'black_blood', rarity: '初始', trigger: 'ON_COMBAT_END' },
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

// 涅奥池 30 件 id（PRD §3.1，与 relic.md 四·先古之民·涅奥一致）
const NEOW_IDS = [
  'arcane_scroll',
  'silver_crucible',
  'hefty_tablet',
  'pomander',
  'fishing_rod',
  'booming_conch',
  'silken_tress',
  'golden_pearl',
  'precise_scissors',
  'massive_scroll',
  'large_capsule',
  'scroll_boxes',
  'neows_talisman',
  'neows_torment',
  'neows_bones',
  'lead_paperweight',
  'lava_rock',
  'lost_coffer',
  'stone_humidifier',
  'leafy_poultice',
  'precarious_shears',
  'kaleidoscope',
  'small_capsule',
  'new_leaf',
  'phial_holster',
  'nutritious_oyster',
  'winged_boots',
  'cursed_pearl',
  'dowsing_rod',
  'neows_sacrifice',
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
    // 归类：涅奥池 30 件（含 5 件剔除）；战士专属 9；先古之民 3；其余为通用精选
    if (NEOW_IDS.includes(meta.id)) neowPool.push(relic)
    if (WARRIOR_IDS.includes(meta.id)) warrior.push(relic)
    if (!NEOW_IDS.includes(meta.id) && !WARRIOR_IDS.includes(meta.id) && meta.rarity === '先古之民')
      ancient.push(relic)
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
