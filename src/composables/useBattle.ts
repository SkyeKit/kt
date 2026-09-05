/**
 * 战斗组合函数（PRD §3.3）：BattleView 用，提供当前回合可打牌/意图/回合计数等派生数据
 */
import { computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import { intentDamage, intentTypeName } from '@/engine/enemyAI'
import { getCard } from '@/data'
import type { Card } from '@/types'
import type { CombatUnit } from '@/engine/combatEngine'

export function useBattle() {
  const store = useGameStore()
  const ctx = computed(() => store.battle)

  // 当前手牌（含卡牌数据与升级状态）
  const hand = computed<Array<{ id: string; card: Card | undefined; upgrade: boolean }>>(() =>
    (ctx.value?.hand ?? []).map((en) => ({ id: en.id, card: getCard(en.id), upgrade: en.upgrade })),
  )

  // 存活敌人（含意图显示）
  const enemies = computed(() => (ctx.value?.enemies ?? []).filter((e) => e.alive))

  // 敌方意图描述
  function intentText(e: CombatUnit): string {
    const dmg = intentDamage(e, e.intentDamage, e.intentHits)
    const base = intentTypeName(e.intentType)
    if (dmg > 0) return `${base} ${dmg}`
    if (e.intentBlock) return `${base} ${e.intentBlock}`
    return base
  }

  // 手牌中某张牌是否可打出（能量足够且非状态/诅咒）
  function canPlay(card: Card | undefined): boolean {
    if (!card || !ctx.value) return false
    if (card.cost === null) return false
    if (card.cost === 'X') return ctx.value.energy >= 1
    return ctx.value.energy >= (card.cost as number)
  }

  return { ctx, hand, enemies, intentText, canPlay }
}
