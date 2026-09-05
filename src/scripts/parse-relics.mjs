/**
 * 遗物数据转换：relic.md → data/relics.json（全量 298 件）
 * 覆盖：职业遗物五池（战士/静默/储君/亡灵/机器人）+ 通用遗物（普通/罕见/稀有/商店/事件/遗物/事件变体）
 *       + 先古之民八池（涅奥/欧洛巴斯/佩尔/特兹卡塔拉/诺奴佩普/坦克斯/瓦库/达弗）。
 * 说明：
 * - 数据文本/稀有度/所属池全部来自 relic.md 表格与章节标题，脚本不做数值改写；
 * - id 由本脚本的中文名映射表补充（snake_case，与引擎注册一致）；trigger 按效果文本启发式推导；
 * - excluded=true 表示依赖当前引擎未实现的子系统（药水/附魔/充能球/辉星/灵魂/选择界面等），
 *   数据仍完整收录（图鉴可见），但引擎触发循环会跳过，避免刷"未实现"日志。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOC = join(__dirname, '..', '..', 'document')
const OUT = join(__dirname, '..', 'data')

/**
 * 中文遗物名 → 引擎 id（snake_case）。
 * excluded=true：依赖未实现子系统或选择界面，仅收录数据、不注册效果。
 * 说明：本表为全量映射，遗漏名会以拼音兜底 id 生成并警告，保证不漏。
 */
const RELIC_ID = {
  // ===== 铁甲战士 9 =====
  燃烧之血: 'burning_blood',
  黑暗之血: 'black_blood',
  红头骨: 'red_skull',
  纸蛙: 'paper_frog',
  自成型黏土: 'self_forming_clay',
  卡戎之灰: 'charons_ashes',
  恶魔之舌: 'demons_tongue',
  损毁头盔: 'broken_helmet',
  硫磺: 'brimstone',
  // ===== 静默猎手 9 =====
  蛇之戒指: 'snake_ring',
  长蛇戒指: 'eel_ring',
  异蛇头骨: 'serpent_skull',
  铜钹: 'cymbal',
  扭曲漏斗: 'twisted_funnel',
  螺线飞镖: 'spiral_dart',
  纸鹤: 'paper_crane',
  结实绷带: 'tough_bandage',
  忍术卷轴: 'ninja_scroll',
  // ===== 储君 9 =====
  天赋君权: 'innate_majesty',
  天命所归: 'mandate_of_heaven',
  击剑指南: 'fencing_guide',
  星系尘埃: 'stellar_dust',
  君王矿石: 'king_ore',
  月亮糕点: 'moon_pastry',
  迷你储君: 'mini_juggler',
  橙色团块: 'orange_lump',
  维特鲁威仆从: 'vitruvius_servant',
  // ===== 亡灵契约师 9 =====
  缚魂命匣: 'soul_locket',
  无界命匣: 'boundless_locket',
  骨笛: 'bone_flute',
  修书小刀: 'book_knife',
  葬礼面具: 'funeral_mask',
  大帽子: 'big_hat',
  书签: 'bookmark',
  象牙麻将牌: 'ivory_mahjong',
  不死符文: 'undying_rune',
  // ===== 故障机器人 9 =====
  破损核心: 'cracked_core',
  注能核心: 'filled_core',
  数据磁盘: 'data_disk',
  镀金缆线: 'gilded_cable',
  共生病毒: 'symbiotic_virus',
  情感芯片: 'emotion_chip',
  节拍器: 'metronome',
  能量电池: 'energy_cell',
  符文电容器: 'runic_capacitor',
  // ===== 通用·普通 25 =====
  百年积木: 'centennial_puzzle',
  摆动球: 'pendulum',
  餐券: 'meal_ticket',
  草莓: 'strawberry',
  打击木偶: 'strike_dummy',
  弹珠袋: 'bag_of_marbles',
  灯笼: 'lantern',
  佛珠手链: 'buddhist_beads',
  古茶具套装: 'old_tea_set',
  红面具: 'red_mask',
  护喉甲: 'throat_guard',
  皇家枕头: 'royal_pillow',
  节日拉炮: 'confetti_cannon',
  金刚杵: 'vajra',
  开心小花: 'happy_flower',
  锚: 'anchor',
  磨刀石: 'whetstone',
  铜质鳞片: 'copper_scales',
  五轮书: 'five_layers',
  小血瓶: 'blood_vial',
  药水腰带: 'potion_belt',
  意外光滑的石头: 'smooth_stone',
  战纹涂料: 'war_paint',
  准备背包: 'prep_bag',
  紫水晶茄子: 'amethyst_eggplant',
  // ===== 通用·罕见 30 =====
  奥利哈钢: 'orichalcum',
  臂甲: 'bracer',
  波纹水盆: 'ripple_basin',
  吃不完的糖: 'unending_candy',
  赤牛: 'red_bull',
  船夹板: 'horn_cleat',
  地精之角: 'gremlin_horn',
  钢笔尖: 'pen_nib',
  活动星图: 'astral_chart',
  金纸: 'golden_star',
  精致折扇: 'ornamental_fan',
  开信刀: 'letter_opener',
  梨子: 'pear',
  爬行动物饰品: 'reptile_spirit',
  闪亮口红: 'shimmering_lipstick',
  石化蟾蜍: 'petrified_frog',
  双截棍: 'nunchaku',
  水银沙漏: 'mercury_hourglass',
  碎石钻: 'diamond',
  缩放仪: 'scaler',
  锁镰: 'scythe',
  微型大炮: 'micro_cannon',
  小邮箱: 'mail_box',
  音叉: 'tuning_fork',
  永冻冰晶: 'frozen_crystal',
  永恒羽毛: 'eternal_feather',
  圆顶礼帽: 'bowler_hat',
  招财异鱼: 'goldfish',
  招架盾: 'parrying_shield',
  烛台: 'candlestick',
  // ===== 通用·稀有 35 =====
  白兽雕像: 'white_bear',
  白星: 'white_star',
  冰淇淋: 'ice_cream',
  不安油灯: 'uneasy_lamp',
  不休陀螺: 'endless_top',
  彩虹戒指: 'rainbow_ring',
  铲子: 'shovel',
  带骨肉: 'meat_on_the_bone',
  吊灯: 'chandelier',
  冻结之蛋: 'frozen_egg',
  斗篷扣: 'cloak_clasp',
  毒素之蛋: 'toxic_egg',
  赌博筹码: 'gambling_chip',
  舵盘: 'rudder',
  烦人机关盒: 'annoying_box',
  风箱: 'bellows',
  干瘪之手: 'shriveled_hand',
  古钱币: 'old_coin',
  骇人头盔: 'scary_helmet',
  壶铃: 'kettlebell',
  怀表: 'pocket_watch',
  坚固钳子: 'sturdy_clamp',
  苦无: 'kunai',
  历石: 'stone_calendar',
  律动残余: 'watch_and_learn',
  芒果: 'mango',
  棋子: 'chess_piece',
  熔火之蛋: 'molten_egg',
  手里剑: 'shuriken',
  送货员: 'deliverer',
  孙子兵法: 'sun_tzu',
  剃刀牙: 'razor_tooth',
  钨合金棍: 'tungsten_rod',
  蜥蜴尾巴: 'lizard_tail',
  转经轮: 'prayer_wheel',
  // ===== 通用·商店 25 =====
  肮脏地毯: 'dusty_carpet',
  大锅: 'cauldron',
  多利之镜: 'mirror',
  工具箱: 'toolbox',
  化学物X: 'chemical_x',
  会员卡: 'membership_card',
  火龙果: 'dragon_fruit',
  尖叫酒壶: 'screaming_jar',
  李家华夫饼: 'waffle',
  面包: 'bread',
  木札: 'wooden_piece',
  扭曲锤子: 'twisted_hammer',
  拳刃: 'punch_dagger',
  燃烧木棍: 'burning_stick',
  熔岩灯: 'lava_lamp',
  三角铃鼓: 'triangle_drum',
  神秘打火机: 'mysterious_lighter',
  算盘: 'abacus',
  王室印章: 'royal_seal',
  微型帐篷: 'mini_tent',
  星系仪: 'star_chart',
  腰带扣: 'belt_buckle',
  勇气投石索: 'courage_sling',
  幽灵种子: 'ghost_seed',
  羽翼护符: 'feather_amulet',
  // ===== 通用·事件 25 =====
  抱抱先生: 'mr_hug',
  宾邦: 'bing_bang',
  捕梦网: 'dream_catcher',
  大蘑菇: 'big_mushroom',
  发条靴: 'clockwork_boots',
  芳香蘑菇: 'fragrant_mushroom',
  菲涅耳透镜: 'fresnel_lens',
  风的女儿: 'wind_daughter',
  骨茶: 'bone_tea',
  黑石护符: 'black_stele',
  花粉核心: 'pollen_core',
  巨口储蓄罐: 'giant_jaw',
  历史课: 'history_lesson',
  迷失鬼火: 'lost_ghost_fire',
  石之剑: 'stone_sword',
  手钻: 'hand_drill',
  天选芝士: 'chosen_cheese',
  王室猛毒: 'royal_poison',
  旺购客户感恩徽章: 'grateful_badge',
  旺购神秘券: 'mystery_ticket',
  无礼之茶: 'rude_tea',
  遗忘之魂: 'forgotten_soul',
  异鸟宝宝: 'bird_baby',
  余烬茶: 'ember_tea',
  玉之剑: 'jade_sword',
  // ===== 通用·遗物 1 =====
  头环: 'circlet',
  // ===== 通用·事件变体 10（？？？）=====
  '奥利哈钢？？？': 'orichalcum_ev',
  '打击木偶？？？': 'strike_dummy_ev',
  '古茶具套装？？？': 'old_tea_set_ev',
  '开心小花？？？': 'happy_flower_ev',
  '李家华夫饼？？？': 'waffle_ev',
  '芒果？？？': 'mango_ev',
  '锚？？？': 'anchor_ev',
  '商人的地毯？？？': 'merchant_carpet_ev',
  '小血瓶？？？': 'blood_vial_ev',
  '异蛇之眼？？？': 'serpent_eye_ev',
  // ===== 先古·涅奥 30 =====
  奥术卷轴: 'arcane_scroll',
  白银熔炉: 'silver_crucible',
  沉重石板: 'hefty_tablet',
  橙型香盒: 'pomander',
  钓鱼竿: 'fishing_rod',
  轰鸣海螺: 'booming_conch',
  华美发束: 'silken_tress',
  金色珍珠: 'golden_pearl',
  精准剪刀: 'precise_scissors',
  巨大卷轴: 'massive_scroll',
  巨大扭蛋: 'large_capsule',
  卷轴箱: 'scroll_boxes',
  涅奥的护符: 'neows_talisman',
  涅奥的苦痛: 'neows_torment',
  涅奥骨骰: 'neows_bones',
  铅制镇纸: 'lead_paperweight',
  熔岩石: 'lava_rock',
  失物盒: 'lost_coffer',
  石炉加湿器: 'stone_humidifier',
  树叶药膏: 'leafy_poultice',
  松动羊毛剪: 'precarious_shears',
  万花筒: 'kaleidoscope',
  小型扭蛋: 'small_capsule',
  新叶: 'new_leaf',
  药瓶皮套: 'phial_holster',
  营养牡蛎: 'nutritious_oyster',
  羽翼之靴: 'winged_boots',
  诅咒珍珠: 'cursed_pearl',
  寻龙尺: 'dowsing_rod',
  涅奥的牺牲: 'neows_sacrifice',
  // ===== 先古·欧洛巴斯 10 =====
  玻璃眼珠: 'glass_eye',
  发光珍珠: 'glowing_pearl',
  放电异虾: 'static_shrimp',
  浮木: 'flotsam',
  古老牙齿: 'ancient_tooth',
  海玻璃: 'sea_glass',
  棱彩宝石: 'prismatic_gem',
  炼金箱: 'alchemy_box',
  欧洛巴斯之触: 'eolobas_touch',
  沙堡: 'sandcastle',
  // ===== 先古·佩尔 10 =====
  佩尔的士兵: 'percy_soldier',
  佩尔的增生组织: 'percy_growth',
  佩尔之角: 'percy_horn',
  佩尔之泪: 'percy_tear',
  佩尔之肉: 'percy_meat',
  佩尔之血: 'percy_blood',
  佩尔之牙: 'percy_tooth',
  佩尔之眼: 'percy_eye',
  佩尔之翼: 'percy_wing',
  佩尔之爪: 'percy_claw',
  // ===== 先古·特兹卡塔拉 10 =====
  '大～抱抱': 'big_hug',
  故事书: 'storybook',
  烘焙手套: 'baking_glove',
  黄金罗盘: 'golden_compass',
  黄金印: 'golden_stamp',
  美味饼干: 'delicious_cookie',
  南瓜蜡烛: 'pumpkin_candle',
  烫嘴可可: 'hot_cocoa',
  玩具盒: 'toy_box',
  营养汤: 'nourishing_soup',
  // ===== 先古·诺奴佩普 10 =====
  布质果实: 'cloth_fruit',
  赐福鹿角: 'blessed_antlers',
  华美手镯: 'gorgeous_bracelet',
  娇嫩蕨草: 'delicate_fern',
  亮片: 'sequins',
  皮草大衣: 'fur_coat',
  图章戒指: 'signet_ring',
  艳丽围巾: 'gaudy_scarf',
  珠宝盒: 'jewel_box',
  钻石头冠: 'diamond_crown',
  // ===== 先古·坦克斯 10 =====
  钗: 'hairpin',
  带刺手甲: 'spiked_gauntlet',
  利爪: 'claws',
  切肉刀: 'cleaver',
  三刃回旋镖: 'tri_blade_boomerang',
  十字弓: 'crossbow',
  坦克斯的哨子: 'tanks_whistle',
  铁棒: 'iron_staff',
  投斧: 'throwing_axe',
  战锤: 'war_hammer',
  // ===== 先古·瓦库 10 =====
  宝石面具: 'gem_mask',
  低语耳环: 'whisper_earring',
  领主阳伞: 'lord_umbrella',
  小提琴: 'violin',
  选择悖论: 'choice_paradox',
  血染玫瑰: 'blood_rose',
  腌制活雾: 'pickled_mist',
  音乐盒: 'music_box',
  原初之爪: 'primordial_claw',
  卓越斗篷: 'paramount_cloak',
  // ===== 先古·达弗 12 =====
  尘封魔典: 'dusty_tome',
  符文金字塔: 'runic_pyramid',
  黑星: 'black_star',
  空鸟笼: 'empty_birdcage',
  灵体外质: 'ectoplasm',
  潘多拉魔盒: 'pandoras_box',
  天鹅绒颈圈: 'velvet_collar',
  添水: 'add_water',
  贤者之石: 'philosophers_stone',
  星盘: 'astrolabe',
  异蛇之眼: 'serpent_eye',
  召唤铃铛: 'calling_bell',
}

// 依赖未实现子系统（药水/附魔/充能球/辉星/灵魂/中毒/其他职业机制/选择界面等）→ excluded=true
const EXCLUDED = new Set([
  // 静默猎手（非当前职业，效果依赖中毒/小刀/药水等）
  'snake_ring',
  'eel_ring',
  'serpent_skull',
  'cymbal',
  'twisted_funnel',
  'spiral_dart',
  'paper_crane',
  'tough_bandage',
  'ninja_scroll',
  // 储君（辉星机制未实现）
  'innate_majesty',
  'mandate_of_heaven',
  'fencing_guide',
  'stellar_dust',
  'king_ore',
  'moon_pastry',
  'mini_juggler',
  'orange_lump',
  'vitruvius_servant',
  // 亡灵契约师（灵魂/灾厄机制未实现）
  'soul_locket',
  'boundless_locket',
  'bone_flute',
  'book_knife',
  'funeral_mask',
  'big_hat',
  'bookmark',
  'ivory_mahjong',
  'undying_rune',
  // 故障机器人（充能球机制未实现）
  'cracked_core',
  'filled_core',
  'data_disk',
  'gilded_cable',
  'symbiotic_virus',
  'emotion_chip',
  'metronome',
  'energy_cell',
  'runic_capacitor',
  // 通用·普通：药水相关
  'potion_belt',
  // 通用·罕见：药水/附魔相关
  'reptile_spirit',
  'petrified_frog',
  'mail_box',
  // 通用·稀有：药水相关
  'white_bear',
  // 通用·商店：药水/选牌界面缺失（附魔类已随附魔系统实现解除：木札/扭曲锤子/拳刃/王室印章/羽翼护符/神秘打火机）
  'cauldron',
  'mirror',
  // 通用·事件：复杂继承机制（附魔类已实现解除：菲涅耳透镜）
  'history_lesson',
  // 先古·涅奥：多人牌/药水/地图UI缺失（选牌界面已实现，卷轴箱已释放）
  'massive_scroll',
  'lost_coffer',
  'phial_holster',
  'kaleidoscope',
  'winged_boots',
  'neows_sacrifice',
  // 先古·欧洛巴斯：药水/其他角色/先古版数据（附魔类已实现解除：放电异虾；剧情类已解除：发光珍珠；洗牌类已解除：浮木）
  'alchemy_box',
  'sea_glass',
  'prismatic_gem',
  'ancient_tooth',
  'eolobas_touch',
  // 先古·佩尔：额外回合/奖励献祭（附魔类已实现解除：佩尔的增生组织/佩尔之爪；移除返还类已解除：佩尔之牙）
  'percy_eye',
  'percy_wing',
  // 先古·特兹卡塔拉：蜡制/地图UI（附魔类已实现解除：营养汤；剧情类已解除：故事书/大~抱抱；金币能量类已解除：黄金印）
  'golden_compass',
  'toy_box',
  // 先古·诺奴佩普：药水/地图UI（附魔类已实现解除：华美手镯/亮片；剧情类已解除：皮草大衣/珠宝盒；减伤类已解除：钻石头冠）
  'delicate_fern',
  // 先古·坦克斯：休息系统/选牌（附魔类已实现解除：三刃回旋镖；剧情类已解除：吹哨/利爪）
  'cleaver',
  // 先古·瓦库：接管回合（剧情类已解除：宝石面具/领主阳伞/血染玫瑰/腌制活雾/原初之爪/卓越斗篷；战斗内选牌类已解除：选择悖论）
  'whisper_earring',
  'music_box',
  // 先古·达弗：复杂选牌界面（变化升级类已解除：星盘）
  'cus_from_text_choice', // 无实际对应，防止误判
])

// 章节标题 → 池 key（决定 relic.pool 与 JSON 分组）
const POOL_BY_HEADER = {
  铁甲战士: 'warrior',
  静默猎手: 'silent',
  储君: 'juggler',
  亡灵契约师: 'religion',
  故障机器人: 'robomancer',
  普通: 'general',
  罕见: 'general',
  稀有: 'general',
  商店: 'general',
  事件: 'general',
  遗物: 'general',
  事件变体: 'general',
  涅奥: 'neowPool',
  欧洛巴斯: 'ancient',
  佩尔: 'ancient',
  特兹卡塔拉: 'ancient',
  诺奴佩普: 'ancient',
  坦克斯: 'ancient',
  瓦库: 'ancient',
  达弗: 'ancient',
}

// 先古八池的细分 key（neow 单独一池，其余归 ancientDetail）
const ANCIENT_KEY = {
  涅奥: 'neow',
  欧洛巴斯: 'eolobas',
  佩尔: 'pert',
  特兹卡塔拉: 'tez',
  诺奴佩普: 'nonupup',
  坦克斯: 'tanks',
  瓦库: 'vaku',
  达弗: 'davu',
}

/** 解析一个 Markdown 表格块（表头为 名称|稀有度|效果 等列） */
function parseTable(md, tableTitle = '名称') {
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
          record[h?.trim() ?? ''] = (cells[i] ?? '').trim()
        })
        const key = record[tableTitle]
        if (key && key !== tableTitle) tables.push(record)
      }
    } else {
      inTable = false
    }
  }
  return tables
}

/** 依据效果文本启发式推导触发钩子（引擎按 trigger 分发可用则用，纯信息用途） */
function deriveTrigger(effect) {
  if (effect.includes('拾起时')) return 'ON_PICKUP'
  if (effect.includes('战斗结束时')) return 'ON_COMBAT_END'
  if (effect.includes('战斗开始时') || effect.includes('战斗开始')) return 'ON_COMBAT_START'
  if (effect.includes('回合结束时')) return 'ON_TURN_END'
  if (effect.includes('回合开始时')) return 'ON_TURN_START'
  if (effect.includes('打出一张') || effect.includes('打出') || effect.includes('每打出'))
    return 'ON_PLAY_CARD'
  if (effect.includes('消耗一张') || effect.includes('每消耗')) return 'ON_CARD_EXHAUST'
  if (effect.includes('休息') || effect.includes('休息处')) return 'ON_REST'
  if (effect.includes('商店') || effect.includes('商人')) return 'ON_SHOP_ENTER'
  if (effect.includes('获得力量')) return 'ON_STRENGTH_GAIN'
  return 'PASSIVE'
}

// 生成全量 relics.json
export function generateRelics() {
  const md = readFileSync(join(DOC, 'relic.md'), 'utf-8')
  // relics.json 从底部数据修正记录向上截止到【四、先古之民遗物】段（标题层级由 "### " 标记）
  const blocks = md.split(/^### /m).slice(1)
  const pools = {
    warrior: [],
    silent: [],
    juggler: [],
    religion: [],
    robomancer: [],
    general: [],
    neowPool: [],
    ancient: [],
  }
  const ancientDetail = {
    neow: [],
    eolobas: [],
    pert: [],
    tez: [],
    nonupup: [],
    tanks: [],
    vaku: [],
    davu: [],
  }
  const warn = []

  for (const block of blocks) {
    const lines = block.split('\n')
    // 剥离 "### " 前缀、行尾 #/空白，以及标题括号的（N个/？？？）数量说明，
    // 得到纯章节名（如 "铁甲战士" / "事件变体" / "涅奥"）
    const header = (lines[0] ?? '')
      .trim()
      .replace(/^#+\s*/, '')
      .replace(/（.+?）$/g, '')
      .replace(/[#\s]+$/, '')
    const pool = POOL_BY_HEADER[header]
    if (!pool) continue // 非遗物数据段（如章节标题/修正记录）
    const rows = parseTable(block)
    for (const row of rows) {
      const name = row['名称'] ?? ''
      if (!name) continue
      const rarity = (row['稀有度'] ?? '').trim() || '普通'
      const effect = (row['效果'] ?? '').trim()
      const id = RELIC_ID[name] ?? name + '_' + header
      if (!RELIC_ID[name]) warn.push(`缺少中文名映射：${name}`)
      const relic = {
        id,
        name,
        rarity,
        trigger: deriveTrigger(effect),
        desc: effect || '(效果见数据文件)',
        pool,
        excluded: EXCLUDED.has(id),
      }
      // 归入主池
      pools[pool].push(relic)
      // 先古池细分
      if (pool === 'neowPool') ancientDetail.neow.push(relic)
      if (pool === 'ancient') {
        const key = ANCIENT_KEY[header]
        if (key && ancientDetail[key]) ancientDetail[key].push(relic)
      }
    }
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, 'relics.json'),
    JSON.stringify({ ...pools, ancientDetail }, null, 2),
    'utf-8',
  )
  if (warn.length) console.log('⚠️ 缺映射警告：' + warn.join(' / '))
  const total = Object.values(pools).reduce((s, a) => s + a.length, 0)
  const excluded = Object.values(pools).reduce((s, a) => s + a.filter((r) => r.excluded).length, 0)
  console.log(
    `relics.json 生成完成：共 ${total} 件（剔除 ${excluded}）｜` +
      Object.entries(pools)
        .map(([k, a]) => `${k} ${a.length}`)
        .join(' / '),
  )
}
