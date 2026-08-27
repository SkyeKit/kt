/**
 * 敌人 AI 模块（agent.md §3 engine/enemyAI / PRD §3.2.3）
 * 职责：意图解析（意图循环）、敌人 HP 随机、敌人战斗单位构建。
 * 意图数据来自 data/enemies.json 的 aiPattern（loop 循环 / scripted 脚本 / weighted 权重）。
 */
import type { IntentType } from '@/types'
import type { Enemy } from '@/types/enemy'
import type { CombatUnit } from './combatEngine'

// 根据 AI 模式计算当前意图招式名（agent.md §5.3：怪物意图循环以 enemies.json 的 aiPattern 为准）
export function resolveIntent(
  e: { ai?: Enemy['ai']; turnCount: number },
  rng: () => number,
): { name: string } {
  const ai = e.ai
  if (!ai || ai.sequence.length === 0) return { name: '' }
  const seq = ai.sequence
  switch (ai.mode) {
    case 'loop': {
      // 固定序列循环：按已行动次数取模（如 酸液黏球 → 吸气 → 循环）
      const idx = e.turnCount % seq.length
      return { name: seq[idx] ?? '' }
    }
    case 'scripted': {
      // 按回合推进的固定脚本，超出后重复最后一招（如 沉睡 → 苏醒 → 斩击×∞）
      const idx = Math.min(e.turnCount, seq.length - 1)
      return { name: seq[idx] ?? '' }
    }
    case 'weighted': {
      // 权重随机；命中冷却中的招式则跳过（飞蝇菌子等复杂 AI 简化处理）
      const w = ai.weights ?? {}
      const candidates = seq.filter((s) => !((ai.cooldowns?.[s] ?? 0) > 0))
      const pool = candidates.length > 0 ? candidates : seq
      const total = pool.reduce((sum, s) => sum + (w[s] ?? 1), 0)
      let roll = rng() * total
      for (const s of pool) {
        roll -= w[s] ?? 1
        if (roll <= 0) return { name: s }
      }
      return { name: pool[0] ?? '' }
    }
  }
}

// HP 在区间内随机（基础难度）
export function rollHp(enemy: Enemy, rng: () => number = Math.random): number {
  if (enemy.hpMax === enemy.hpMin) return enemy.hpMin
  return Math.floor(rng() * (enemy.hpMax - enemy.hpMin + 1)) + enemy.hpMin
}

// 由敌人数据构建战斗单位（含意图字段占位，回合开始由 setEnemyIntents 填充）
export function buildEnemyUnit(
  enemy: Enemy,
  hp?: number,
  rng: () => number = Math.random,
): CombatUnit {
  const rolled = hp ?? rollHp(enemy, rng)
  return {
    id: enemy.id,
    name: enemy.name,
    isPlayer: false,
    hp: rolled,
    maxHp: rolled,
    block: 0,
    armor: 0,
    strength: 0,
    dexterity: 0,
    statuses: [],
    alive: true,
    turnCount: 0,
    category: enemy.category,
    ai: enemy.ai,
    moves: enemy.moves,
    spawns: enemy.spawns,
    hand: [],
    drawPile: [],
    discardPile: [],
    exhaustPile: [],
    energy: 0,
    maxEnergy: 0,
  }
}

// 意图显示伤害（供 UI 展示）：单段伤害 × 段数 + 攻击方力量修正
export function intentDamage(
  unit: CombatUnit,
  base: number | undefined,
  hits: number | undefined,
): number {
  if (base === undefined) return 0
  const strength = unit.strength
  return (base + strength) * (hits ?? 1)
}

// 意图类别中文名（UI 展示）
export function intentTypeName(type: IntentType | undefined): string {
  switch (type) {
    case 'attack':
      return '攻击'
    case 'defend':
      return '防御'
    case 'status':
      return '状态'
    case 'buff':
      return '强化'
    default:
      return '特殊'
  }
}
