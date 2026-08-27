/**
 * 效果链类型（agent.md §5.2 / PRD §3.3）
 * 卡牌/怪物招式/事件选项的效果统一用"效果链数组"表达，由 effectEngine.ts 解析执行。
 * 新增效果类型时：effectEngine 实现执行逻辑 + tests/effectEngine.spec.ts 补测试，禁止在组件里临时实现。
 */

// 效果目标：单体敌人 / 全体敌人 / 自己 / 随机敌人
export type EffectTarget = 'enemy' | 'allEnemies' | 'self' | 'randomEnemy'

// 攻击伤害的倍率修正来源（PRD §3.3.3 结算顺序：基础+力量 → 易伤 → 虚弱 → 其他倍率）
export type DamageModifier = 'vulnerable' | 'weak' | 'shrink' | 'brutality'

// 效果链：判别联合（discriminated union），按 type 区分
export type Effect =
  | { type: 'damage'; target: EffectTarget; amount: number; hits?: number }
  | { type: 'block'; amount: number }
  | { type: 'draw'; count: number }
  | {
      type: 'applyStatus'
      target: 'enemy' | 'allEnemies' | 'self'
      status: string
      amount: number
    }
  | { type: 'gainEnergy'; amount: number }
  | { type: 'loseEnergy'; amount: number }
  | { type: 'heal'; amount: number }
  | { type: 'loseHp'; amount: number }
  | { type: 'exhaust' }
  | { type: 'addCard'; cardId: string; to: 'hand' | 'draw' | 'discard' | 'exhaust' }
  | { type: 'upgrade'; count: number }
  | { type: 'transform'; count: number }
  | { type: 'removeCard'; count: number }
  | { type: 'gainGold'; amount: number }
  | { type: 'loseGold'; amount: number }
  | { type: 'gainMaxHp'; amount: number }
  | { type: 'loseMaxHp'; amount: number }
  // 多段随机/条件类复杂效果：scaling 描述数值来源，由 effectEngine 在运行时求值
  | {
      type: 'damageScaling'
      target: EffectTarget
      base: number
      scaling: 'block' | 'cardsPlayed' | 'exhaustPile' | 'deckSize' | 'statusOnTarget'
      hits?: number
    }

// 效果链 = 一组顺序执行的效果
export type EffectChain = Effect[]
