/**
 * 敌人类型（PRD §3.2.3 / 数据源 document/Overgrowth.md）
 * 敌人数据全部来自 src/data/enemies.json；aiPattern 即"意图循环"（agent.md §5.3）。
 */
import type { EffectChain } from './effect'

// 敌人分类：普通 / 精英 / Boss / 爪牙（爪牙通常作为群体或衍生物存在）
export type EnemyCategory = 'normal' | 'elite' | 'boss' | 'minion'

// 意图类型：攻击 / 防御 / 施放状态 / 强化自身 / 特殊（召唤/洗入牌等）
export type IntentType = 'attack' | 'defend' | 'status' | 'buff' | 'special'

// 单个招式的结构化数据（数值/文本由转换脚本从 md 解析，行为用 EffectChain 表达）
export interface EnemyMove {
  name: string // 招式名（如 酸液黏球）
  intent: IntentType // 意图类别（用于 UI 图标与 AI 行为）
  damage?: number // 意图显示伤害（多段为单段值×hits）
  hits?: number // 攻击段数（默认为 1）
  block?: number // 本回合格挡（若有）
  effects: EffectChain // 实际执行效果（由 effectEngine 解析）
  desc: string // 原始文本（如"造成 4 点伤害"）
}

// AI 模式：按固定序列循环 / 固定脚本（按回合推进）/ 权重随机
export type AiMode = 'loop' | 'scripted' | 'weighted'

export interface EnemyAiPattern {
  mode: AiMode
  // loop：循环序列（招式名数组，按序循环）；scripted：按回合索引取 moves[floor]
  sequence: string[]
  // weighted：各招式权重（按招式名）
  weights?: Record<string, number>
  // 冷却/禁用约束：{ 招式名: 冷却回合数 }，用于"不可连续使用/冷却 X 回合"
  cooldowns?: Record<string, number>
  // 阶段切换：{ 招式名: { hpBelow: number; next: string[] } }（如仪式兽二阶段）
  phases?: Array<{ hpBelow: number; next: string[] }>
}

export interface Enemy {
  id: string // snake_case（如 fuzzy_wurm_crawler，与 img.md 一致）
  name: string
  hpMin: number // HP 区间下限
  hpMax: number // HP 区间上限
  category: EnemyCategory
  abilities: string[] // 初始能力/机制（如 滑溜、领地意识、寄生物）
  ai: EnemyAiPattern
  moves: Record<string, EnemyMove>
  // 衍生物声明（死亡时召唤等）：{ id, count }
  spawns?: Array<{ id: string; count: number; condition: 'onDeath' | 'onStart' }>
}

// 遭遇战组合（PRD §3.2.2）：每个组合是敌人 id 数组
export interface EncounterPool {
  weak: string[][] // 弱怪池（前 3 场）
  strong: string[][] // 强怪池（第 4 场及以后）
  elites: string[] // 精英池（循环抽取）
  bosses: string[] // Boss 池（三选一）
}
