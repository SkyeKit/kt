// 一次性修复卡牌 effects/upgradeEffects 数据（本次审查发现的 AoE/随机目标与缺副效果问题）
// 只改写目标卡的 effects / upgradeEffects 两个字段，其余键与其余卡牌原样保留
import { readFileSync, writeFileSync } from 'fs'

const FILE = 'src/data/cards.json'
const cards = JSON.parse(readFileSync(FILE, 'utf8'))

// 待修改卡片与目标 effects（E）+ upgradeEffects（U），未给出的字段保持原值
const patches = new Map()
const set = (id, effects, upgradeEffects) => patches.set(id, { effects, upgradeEffects })

// ---- task2：AoE/随机攻击卡修正（去掉错误的单体 damage，多目标 target 修正） ----
set(
  'cleave',
  [
    { type: 'damage', target: 'allEnemies', amount: 9 },
    { type: 'loseHp', amount: 1 },
  ],
  [
    { type: 'damage', target: 'allEnemies', amount: 13 },
    { type: 'loseHp', amount: 1 },
  ],
)
set(
  'thunderclap',
  [
    { type: 'damage', target: 'allEnemies', amount: 4 },
    { type: 'applyStatus', target: 'allEnemies', status: 'vulnerable', amount: 1 },
  ],
  [
    { type: 'damage', target: 'allEnemies', amount: 7 },
    { type: 'applyStatus', target: 'allEnemies', status: 'vulnerable', amount: 1 },
  ],
)
set(
  'sword_boomerang',
  [{ type: 'damage', target: 'randomEnemy', amount: 3, hits: 3 }],
  [{ type: 'damage', target: 'randomEnemy', amount: 3, hits: 4 }],
)
set(
  'otherside_roar',
  [{ type: 'damage', target: 'allEnemies', amount: 16 }, { type: 'exhaust' }],
  [{ type: 'damage', target: 'allEnemies', amount: 21 }, { type: 'exhaust' }],
)
set(
  'whirlwind',
  [{ type: 'damage', target: 'allEnemies', amount: 5 }],
  [{ type: 'damage', target: 'allEnemies', amount: 8 }],
)
set(
  'stomp',
  [{ type: 'damage', target: 'allEnemies', amount: 12 }],
  [{ type: 'damage', target: 'allEnemies', amount: 15 }],
)
set(
  'contract_end',
  [{ type: 'damage', target: 'allEnemies', amount: 17 }, { type: 'exhaust' }],
  [{ type: 'damage', target: 'allEnemies', amount: 23 }, { type: 'exhaust' }],
)
set(
  'incinerate',
  [{ type: 'damage', target: 'allEnemies', amount: 2, hits: 4 }],
  [{ type: 'damage', target: 'allEnemies', amount: 2, hits: 5 }],
)

// ---- task4：改用现有引擎能力表达缺失的副效果 ----
set(
  'bully', // 欺凌：每层易伤额外 +2 伤害 → 缩放伤害
  [{ type: 'damageScaling', target: 'enemy', base: 4, scaling: 'statusOnTarget' }],
  [{ type: 'damageScaling', target: 'enemy', base: 4, scaling: 'statusOnTarget' }],
)
set(
  'ash_strike', // 灰烬打击：消耗牌堆每张 +3 → 缩放伤害（基础归其自带的普通 damage）
  [
    { type: 'damageScaling', target: 'enemy', base: 6, scaling: 'exhaustPile' },
    { type: 'exhaust' },
  ],
  [
    { type: 'damageScaling', target: 'enemy', base: 6, scaling: 'exhaustPile' },
    { type: 'exhaust' },
  ],
)
set(
  'flame_barrier', // 火焰屏障：本回合受击反伤 → 用荆棘(thorns)表达对攻击者的反伤
  [
    { type: 'block', amount: 12 },
    { type: 'applyStatus', target: 'self', status: 'thorns', amount: 4 },
  ],
  [
    { type: 'block', amount: 16 },
    { type: 'applyStatus', target: 'self', status: 'thorns', amount: 6 },
  ],
)
set(
  'fight_me', // 与我一战：敌方也获得 1 力量
  [
    { type: 'damage', target: 'enemy', amount: 5, hits: 2 },
    { type: 'applyStatus', target: 'self', status: 'strength', amount: 3 },
    { type: 'applyStatus', target: 'enemy', status: 'strength', amount: 1 },
  ],
  [
    { type: 'damage', target: 'enemy', amount: 5, hits: 2 },
    { type: 'applyStatus', target: 'self', status: 'strength', amount: 4 },
    { type: 'applyStatus', target: 'enemy', status: 'strength', amount: 1 },
  ],
)
set(
  'primal_power', // 原始力量：手牌攻击牌全部变为随机攻击牌 → 引擎已实现 transformHandAttacks
  [{ type: 'transformHandAttacks' }],
  [{ type: 'transformHandAttacks' }],
)

// ---- 二批：新增效果类型的副效果补全（引擎端新增对应 case） ----
set(
  'whirlwind', // 旋风斩：对所有敌人造成 amount 伤害 X 次（次数 = 投入能量）
  [{ type: 'damage', target: 'allEnemies', amount: 5, hitsFromX: true }],
  [{ type: 'damage', target: 'allEnemies', amount: 8, hitsFromX: true }],
)
set(
  'perfected_strike', // 完美打击：每张名字含"打击"的牌 +2 伤害
  [{ type: 'damageScaling', target: 'enemy', base: 6, scaling: 'strikeCount' }],
  [{ type: 'damageScaling', target: 'enemy', base: 6, scaling: 'strikeCount' }],
)
set(
  'molten_fist', // 熔融之拳：将该敌人身上的易伤层数翻倍
  [
    { type: 'damage', target: 'enemy', amount: 10 },
    { type: 'doubleStatus', target: 'enemy', status: 'vulnerable' },
    { type: 'exhaust' },
  ],
  [
    { type: 'damage', target: 'enemy', amount: 14 },
    { type: 'doubleStatus', target: 'enemy', status: 'vulnerable' },
    { type: 'exhaust' },
  ],
)
set(
  'dominator', // 主宰：敌人每有一层易伤，就获得 1 点力量
  [
    { type: 'applyStatus', target: 'enemy', status: 'vulnerable', amount: 1 },
    { type: 'strengthFromTargetVulnerable', target: 'enemy' },
    { type: 'exhaust' },
  ],
  [
    { type: 'applyStatus', target: 'enemy', status: 'vulnerable', amount: 2 },
    { type: 'strengthFromTargetVulnerable', target: 'enemy' },
    { type: 'exhaust' },
  ],
)
set(
  'eager', // 跃跃欲试：手牌中每张攻击牌 +1 能量，本回合不再获得额外能量
  [{ type: 'gainEnergyPerHandAttack', amount: 1, blockFurther: true }],
  [{ type: 'gainEnergyPerHandAttack', amount: 1, blockFurther: true }],
)
set(
  'battle_focus', // 战斗专注：抽 3，本回合不再抽牌
  [{ type: 'draw', count: 3 }, { type: 'noDraw' }],
  [{ type: 'draw', count: 4 }, { type: 'noDraw' }],
)
set(
  'pillage', // 劫掠：造成 6 伤，抽牌直到抽到非攻击牌
  [{ type: 'damage', target: 'enemy', amount: 6 }, { type: 'drawUntilNonAttack' }],
  [{ type: 'damage', target: 'enemy', amount: 9 }, { type: 'drawUntilNonAttack' }],
)
set(
  'forgotten_ritual', // 被遗忘的仪式：本回合消耗过卡牌才获得能量
  [{ type: 'gainIfExhausted', gain: 'energy', amount: 3 }, { type: 'exhaust' }],
  [{ type: 'gainIfExhausted', gain: 'energy', amount: 4 }, { type: 'exhaust' }],
)
set(
  'evil_eye', // 邪眼：本回合消耗过卡牌则额外获得格挡
  [
    { type: 'block', amount: 8 },
    { type: 'gainIfExhausted', gain: 'block', amount: 8 },
    { type: 'exhaust' },
  ],
  [
    { type: 'block', amount: 11 },
    { type: 'gainIfExhausted', gain: 'block', amount: 11 },
    { type: 'exhaust' },
  ],
)
set(
  'rally_spirit', // 重振精神：消耗手牌中所有非攻击牌，每张获得格挡
  [{ type: 'blockPerNonAttackExhausted', amount: 5 }, { type: 'exhaust' }],
  [{ type: 'blockPerNonAttackExhausted', amount: 7 }, { type: 'exhaust' }],
)
set(
  'anger', // 愤怒：造成伤害，并将一张此牌的复制品加入弃牌堆
  [
    { type: 'damage', target: 'enemy', amount: 6 },
    { type: 'addCard', cardId: 'anger', to: 'discard' },
  ],
  [
    { type: 'damage', target: 'enemy', amount: 8 },
    { type: 'addCard', cardId: 'anger', to: 'discard' },
  ],
)

let changed = 0
for (const c of cards.warrior) {
  const p = patches.get(c.id)
  if (!p) continue
  if (p.effects) c.effects = p.effects
  if (p.upgradeEffects) c.upgradeEffects = p.upgradeEffects
  changed++
  console.log(
    `patched -> ${c.id}  E=${JSON.stringify(c.effects)}  U=${JSON.stringify(c.upgradeEffects)}`,
  )
}

const out = JSON.stringify(cards, null, 2) + '\n'
writeFileSync(FILE, out)
console.log(`\nUpdated ${changed} cards, file size ${out.length} bytes`)
