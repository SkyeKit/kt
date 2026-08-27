/**
 * 遗物系统（agent.md §3 engine/relicSystem / PRD §3.8）
 * 按触发钩子（RelicTrigger）注册回调：战斗开始/回合开始/打出卡牌/受到伤害/敌人死亡/战斗结束等。
 * 数据来自 data/relics.json；MVP 已实现常用钩子，未实现的遗物仅记录到日志（可扩展）。
 */
import type { CombatContext } from './combatEngine'
import type { Relic } from '@/types'

// 遗物上下文：战斗场景下携带 player 战斗单位与战斗上下文
export interface RelicContext {
  ctx?: CombatContext
  hp?: number
  gold?: number
  log: string[]
}

// 钩子回调：接收遗物本身与当前上下文，返回事件是否被"消费"（如挡下一次伤害）
export type RelicCallback = (relic: Relic, context: RelicContext) => void

// 遗物注册表：触发钩子 → 处理函数
const registry: Partial<Record<string, RelicCallback>> = {}

// 注册遗物处理函数（在游戏启动时调用一次，挂载 MVP 支持的遗物逻辑）
export function registerRelic(trigger: string, handler: RelicCallback): void {
  registry[trigger] = handler
}

// 触发遗物钩子：遍历持有遗物中 trigger 匹配的，执行对应处理
export function triggerRelics(relics: Relic[], trigger: string, context: RelicContext): void {
  for (const relic of relics) {
    if (relic.trigger !== trigger || relic.excluded) continue
    const handler = registry[relic.trigger]
    if (handler) {
      handler(relic, context)
      context.log.push(`[遗物] ${relic.name} 生效`)
    }
  }
}

// ===== MVP 遗物实现（燃烧之血为战士初始遗物，必须可用） =====

// 燃烧之血：战斗结束时回复 6 点生命（ON_COMBAT_END；数值与 PRD §3.4 一致）
registerRelic('ON_COMBAT_END', (_relic, context) => {
  const heal = 6
  if (context.ctx) {
    const p = context.ctx.player
    p.hp = Math.min(p.maxHp, p.hp + heal)
    context.log.push(`[燃烧之血] 回复 ${heal} 点生命`)
  }
})

// 灯笼：战斗第一回合获得 1 点能量（ON_TURN_START，仅 turn===1）
registerRelic('ON_TURN_START', (relic, context) => {
  if (relic.id !== 'lantern') return
  if (context.ctx && context.ctx.turn === 1) {
    context.ctx.energy += 1
  }
})

// 开心小花：每 3 个回合获得 1 点能量（ON_TURN_START，turn % 3 === 0）
registerRelic('ON_TURN_START', (relic, context) => {
  if (relic.id !== 'happy_flower') return
  if (context.ctx && context.ctx.turn > 0 && context.ctx.turn % 3 === 0) {
    context.ctx.energy += 1
  }
})

// 百年积木：每场战斗第一次损失生命时抽 3 张牌（ON_DAMAGE_TAKEN，用 hp 差判断第一次）
registerRelic('ON_DAMAGE_TAKEN', (_relic, context) => {
  // 简化实现：MVP 战斗引擎在受到伤害时触发；第一次判定由调用方保证
  if (context.ctx && context.ctx.hand.length === 0) {
    // 占位：真实抽牌逻辑在 combatEngine 中通过钩子调用 drawCards
    context.log.push('[百年积木] 触发抽 3 张（MVP 简化）')
  }
})
