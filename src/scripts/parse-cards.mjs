/**
 * 卡牌数据转换：WarriorDeck.md / ColorlessDeck.md / OtherDecks.md → data/cards.json
 * 卡牌 ID 通过 ID_MAP（中文名 → snake_case）映射；效果文本解析为 Effect[]。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTable, parseEffects, parseKeywords } from './parse-utils.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOC = join(__dirname, '..', '..', 'document')
const OUT = join(__dirname, '..', 'data')

// 中文卡名 → snake_case ID（与引擎/存档一致；新增卡牌在此补充）
const ID_MAP = {
  // 基础
  打击: 'strike_ironclad',
  痛击: 'bash',
  防御: 'defend_ironclad',
  // 普通
  余烬: 'ember',
  全身撞击: 'body_slam',
  剑柄打击: 'pommel_strike',
  双重打击: 'twin_strike',
  头槌: 'headbutt',
  完美打击: 'perfected_strike',
  愤怒: 'anger',
  熔融之拳: 'molten_fist',
  突破: 'cleave',
  铁斩波: 'iron_wave',
  闪电霹雳: 'thunderclap',
  预备打击: 'prep_strike',
  飞剑回旋镖: 'sword_boomerang',
  坚毅: 'true_grit',
  战栗: 'tremble',
  放血: 'bloodletting',
  武装: 'armaments',
  破灭: 'obliterate',
  耸肩无视: 'shrug_it_off',
  血墙: 'blood_wall',
  // 罕见
  上勾拳: 'uppercut',
  '与我一战！': 'fight_me',
  劫掠: 'pillage',
  彼岸咆哮: 'otherside_roar',
  御血术: 'blood_control',
  怨恨: 'resentment',
  拆卸: 'dismantle',
  擒拿: 'grapple',
  旋风斩: 'whirlwind',
  无情猛攻: 'relentless_assault',
  暴走: 'rampage',
  欺凌: 'bully',
  灰烬打击: 'ash_strike',
  踩踏: 'stomp',
  重锤: 'heavy_blow',
  主宰: 'dominator',
  地狱之刃: 'hell_blade',
  战斗专注: 'battle_focus',
  挑衅: 'taunt',
  火焰屏障: 'flame_barrier',
  燃烧契约: 'burning_pact',
  狂怒: 'fury',
  被遗忘的仪式: 'forgotten_ritual',
  跃跃欲试: 'eager',
  邪眼: 'evil_eye',
  重振精神: 'rally_spirit',
  凶恶: 'vicious',
  岩石铠甲: 'rock_armor',
  惊逃: 'frighten',
  战鼓: 'war_drum',
  撕裂: 'rend',
  无畏疼痛: 'fearless_pain',
  杂耍: 'juggle',
  燃烧: 'ignite',
  狱火: 'hellfire',
  // 稀有
  凌虐: 'torment',
  契约终结: 'contract_end',
  恶魔之焰: 'demon_flame',
  扯碎: 'shred',
  焚烧: 'incinerate',
  狂宴: 'feast',
  痛殴: 'pummel',
  倾泻: 'pour',
  原始力量: 'primal_power',
  岿然不动: 'stalwart',
  添柴: 'add_fuel',
  烙印: 'brand',
  祭品: 'sacrifice',
  连环拳: 'chain_punch',
  势不可当: 'unstoppable',
  地狱狂徒: 'hell_zealot',
  坚定不移: 'adamant',
  壁垒: 'barricade',
  好勇斗狠: 'bravado',
  恶魔形态: 'demon_form',
  残酷: 'cruelty',
  绯红披风: 'crimson_cloak',
  薪火之源: 'ember_source',
  黑暗之拥: 'dark_embrace',
  // 先古
  破击: 'sunder',
  腐化: 'corruption',
  // 无色 罕见
  连射: 'rapid_fire',
  亮剑: 'flash_blade',
  闪亮登场: 'grand_entrance',
  万向斩: 'omni_slash',
  究极打击: 'ultimate_strike',
  拳斗: 'pugilism',
  探寻打击: 'seek_strike',
  无休手斧: 'endless_handaxe',
  心灵震慑: 'mind_blast',
  黑暗镣铐: 'dark_shackles',
  花样百出: 'trickery',
  急躁: 'impatient',
  净化: 'purify',
  妙计: 'clever',
  深谋远虑: 'foresight',
  生产制造: 'produce',
  心神不宁: 'restless',
  延伸: 'extend',
  应急按钮: 'panic_button',
  发现: 'discover',
  飞溅: 'splash',
  究极防御: 'ultimate_defense',
  横祸: 'mishap',
  均衡: 'equilibrium',
  炸弹: 'bomb',
  震荡波: 'shockwave',
  神气制胜: 'triumphant',
  非凡技艺: 'extraordinary_skill',
  计策: 'stratagem',
  勒紧: 'tighten',
  准备时间: 'prep_time',
  自动化: 'automation',
  // 无色 稀有
  流星锤: 'meteor_hammer',
  箭雨: 'arrow_rain',
  金斧: 'gold_axe',
  撕碎: 'tear',
  贪婪之手: 'greedy_hand',
  大奖: 'jackpot',
  孤注一掷: 'all_in',
  秘密技法: 'secret_technique',
  秘密武器: 'secret_weapon',
  战略大师: 'master_strategy',
  炼制药水: 'potion_brew',
  潦草急就: 'scribble',
  天选: 'chosen',
  未掘宝石: 'uncut_gem',
  狠揍: 'beat_down',
  怀旧: 'nostalgia',
  熵: 'entropy',
  乱战: 'melee',
  滚石: 'rolling_stone',
  劫难: 'catastrophe',
  永恒铠甲: 'eternal_armor',
  // 状态牌
  毒素: 'toxin',
  呼唤: 'summons',
  狂乱逃离: 'frantic_escape',
  黏液: 'slime',
  碎屑: 'scrap',
  凋萎: 'wilt',
  感染: 'infection',
  煤灰: 'soot',
  伤口: 'wound',
  虚空: 'void',
  晕眩: 'dizzy',
  灼伤: 'burn',
  // 诅咒牌
  孢子心灵: 'spore_mind',
  执迷: 'obsession',
  笨拙: 'clumsy',
  凡庸: 'mediocrity',
  腐朽: 'decay',
  悔恨: 'regret',
  进阶之灾: 'ascension_curse',
  苦恼: 'anguish',
  愧疚: 'guilt',
  铃铛的诅咒: 'bell_curse',
  霉运: 'misfortune',
  受伤: 'injured',
  睡眠不佳: 'bad_sleep',
  贪婪: 'greed',
  羞耻: 'shame',
  疑虑: 'doubt',
  愚行: 'folly',
  债务: 'debt',
  // 事件卡
  异鸟扑击: 'byrdonis_swoop',
  杀灭: 'kill',
  压扁: 'squash',
  啄击: 'peck',
  疯狂进食: 'frenzy_feast',
  开悟: 'enlightenment',
  坚韧之环: 'tough_ring',
  羽化: 'pupate',
  涅奥之怒: 'neows_anger',
  撕咬: 'bite',
  吹哨: 'whistle',
  许愿: 'wish',
  至亮之焰: 'brightest_flame',
  灵体: 'apparition',
  神化: 'apotheosis',
  放松: 'relax',
  疯狂科学: 'crazy_science',
  // 衍生卡
  懒惰: 'lazy',
  衰朽: 'degenerate',
  瓦解: 'collapse',
  心灵腐化: 'mental_corruption',
  仆从打击: 'minion_strike',
  仆从俯冲: 'minion_dive',
  扫荡凝视: 'sweeping_gaze',
  小刀: 'shiv',
  巨石: 'boulder',
  君王之剑: 'monarch_sword',
  冷光: 'cold_light',
  灵魂: 'soul',
  仆从捐躯: 'minion_sacrifice',
  燃料: 'fuel',
}

// 稀有度分节 → 类型
const RARITY_TYPE = {
  基础: 'basic',
  普通: 'common',
  罕见: 'uncommon',
  稀有: 'rare',
  先古: 'ancient',
}

// 解析单个卡表（名称|费用|类型|效果|升级后效果）
function parseCardTable(md, section, rarity) {
  return parseTable(md)
    .filter((r) => r['名称'])
    .map((r) => {
      const name = r['名称'].replace(/^\*\*|\*\*$/g, '')
      const id = ID_MAP[name]
      if (!id) console.warn(`⚠️ 缺少 ID 映射：${name}（${section}）`)
      const desc = r['效果'] ?? ''
      const upgradeDesc = r['升级后效果'] ?? ''
      const costRaw = (r['费用'] ?? '').trim()
      const cost = costRaw === 'X' ? 'X' : costRaw === '—' ? null : parseInt(costRaw, 10)
      const typeZh = (r['类型'] ?? '').trim()
      const type = typeZh === '攻击' ? 'attack' : typeZh === '技能' ? 'skill' : 'power'
      return {
        id: id ?? `unnamed_${name.charCodeAt(0)}`,
        name,
        cost: Number.isNaN(cost) ? null : cost,
        type,
        rarity,
        desc,
        upgradeDesc,
        effects: parseEffects(desc),
        upgradeEffects: parseEffects(upgradeDesc),
        keywords: parseKeywords(desc + ' ' + upgradeDesc),
      }
    })
}

// 按 ## 分节
function splitSections(md) {
  return md
    .split(/^## /m)
    .slice(1)
    .map((p) => {
      const nl = p.indexOf('\n')
      return { title: p.slice(0, nl).trim(), body: p.slice(nl + 1) }
    })
    .filter((s) => s.body.trim())
}

// 生成 cards.json
export function generateCards() {
  // 战士卡池
  const warriorMd = readFileSync(join(DOC, 'WarriorDeck.md'), 'utf-8')
  const warrior = []
  for (const sec of splitSections(warriorMd)) {
    // 战士卡表标题为纯稀有度名（基础/普通/罕见/稀有/先古），直接映射
    const rarity = RARITY_TYPE[sec.title]
    if (!rarity) continue
    warrior.push(...parseCardTable(sec.body, sec.title, rarity))
  }
  // 无色卡池
  const colorlessMd = readFileSync(join(DOC, 'ColorlessDeck.md'), 'utf-8')
  const colorless = []
  for (const sec of splitSections(colorlessMd)) {
    const rarity = sec.title.includes('罕见')
      ? 'uncommon'
      : sec.title.includes('稀有')
        ? 'rare'
        : null
    if (!rarity) continue
    colorless.push(
      ...parseCardTable(sec.body, sec.title, rarity).map((c) => ({ ...c, rarity: 'colorless' })),
    )
  }
  // 状态/诅咒/事件/衍生
  const otherMd = readFileSync(join(DOC, 'OtherDecks.md'), 'utf-8')
  const status = []
  const curse = []
  const eventCards = []
  const derived = []
  let crazyIdx = 0
  for (const sec of splitSections(otherMd)) {
    if (sec.title.includes('状态')) status.push(...parseCardTable(sec.body, sec.title, 'status'))
    else if (sec.title.includes('诅咒')) curse.push(...parseCardTable(sec.body, sec.title, 'curse'))
    else if (sec.title.includes('事件')) {
      const cards = parseCardTable(sec.body, sec.title, 'event')
      eventCards.push(
        ...cards.map((c) => {
          if (c.name === '疯狂科学') {
            crazyIdx++
            return { ...c, id: `crazy_science_${crazyIdx}` }
          }
          return c
        }),
      )
    } else if (sec.title.includes('衍生'))
      derived.push(...parseCardTable(sec.body, sec.title, 'derived'))
  }

  const data = { warrior, colorless, status, curse, eventCards, derived }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'cards.json'), JSON.stringify(data, null, 2), 'utf-8')
  const total =
    warrior.length +
    colorless.length +
    status.length +
    curse.length +
    eventCards.length +
    derived.length
  console.log(
    `cards.json 生成完成：战士 ${warrior.length} / 无色 ${colorless.length} / 状态 ${status.length} / 诅咒 ${curse.length} / 事件卡 ${eventCards.length} / 衍生 ${derived.length}（共 ${total}）`,
  )
}
