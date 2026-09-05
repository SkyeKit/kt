/**
 * 敌人 AI 模块（agent.md §3 engine/enemyAI / PRD §3.2.3）
 * 职责：意图解析（意图循环）、敌人 HP 随机、敌人战斗单位构建。
 * 意图数据来自 data/enemies.json 的 aiPattern（loop 循环 / scripted 脚本 / weighted 权重）。
 */
import type { IntentType } from '@/types'
import type { Enemy } from '@/types/enemy'
import type { CombatUnit } from './combatEngine'

// 根据 AI 模式计算当前意图招式名（agent.md §5.3：怪物意图循环以 enemies.json 的 aiPattern 为准）
// cooldowns 为逐实例的招试冷却计数（由 combatEngine.enemyTurn 在出招后写入，每回合前递减）；
// 只在意图选择时读取做"冷却中招式不可选"过滤，不修改共享 ai（数据同源，多胞胎共用）。
export function resolveIntent(
  e: { ai?: Enemy['ai']; turnCount: number; cooldowns?: Record<string, number> },
  rng: () => number,
): { name: string } {
  const ai = e.ai
  // 无 ai 时返回空意图；有 ai 但 sequence 为空时不在入口拦截——
  // weighted 模式允许 weights 独立提供招式（噬尸蛞蝓/双尾鼠等仅靠 weights，sequence 为空），
  // 若在这里统一提前返回，会导致这些怪物永远没有意图（不出行动）。
  if (!ai) return { name: '' }
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
      // 权重随机；命中冷却中的招式则跳过（"防连发"限制）。
      // 候选来源：优先 ai.sequence，缺失则用 weights 的键（供 sequence 为空的纯权重怪物）
      const w = ai.weights ?? {}
      const names = (
        ai.sequence && ai.sequence.length > 0 ? ai.sequence : Object.keys(w)
      ) as string[]
      // 冷却过滤：仅排除处于冷却（cooldowns>0）中的招式，其余全部候选
      const cd = e.cooldowns ?? {}
      const candidates = names.filter((s) => !((cd[s] ?? 0) > 0))
      const pool = candidates.length > 0 ? candidates : names
      const total = pool.reduce((sum, s) => sum + (w[s as string] ?? 1), 0)
      // total 为 0（空权重）时兜底返回空，避免除零
      if (total <= 0) return { name: pool[0] ?? '' }
      let roll = rng() * total
      for (const s of pool) {
        roll -= w[s as string] ?? 1
        if (roll <= 0) return { name: s as string }
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

// 生成唯一敌人实例 id：多胞胎（同 def 出现多次，如蟾蜍蝌蚪×2、双尾鼠×3、花园幽灵鳗×4）若 id 相同，
// 会破坏 UI 拖拽选目标（enemyRefs 以 id 为 key 被覆盖）与效果目标定位，必须唯一化。
// taken 用于判定某 id 是否已被占用；未占用则保持原名，否则追加 _2/_3… 后缀。
export function uniqueEnemyId(base: string, taken: (id: string) => boolean): string {
  if (!taken(base)) return base
  let n = 2
  while (taken(`${base}_${n}`)) n++
  return `${base}_${n}`
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
    defId: enemy.id, // 保留原始数据 id（多胞胎唯一化可能改 id，查定义走 defId）
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
    hardShellUsedThisTurn: 0,
    category: enemy.category,
    ai: enemy.ai,
    moves: enemy.moves,
    spawns: enemy.spawns,
    cooldowns: {}, // 招式冷却逐实例计数：开局无冷却，使用某招后由 enemyTurn 置时长，每回合递减
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
