<script setup lang="ts">
/**
 * 敌人组件：血条/意图（意图循环预告）/名称；数据来自 data/enemies.json
 */
import { computed } from 'vue'
import type { CombatUnit } from '@/engine/combatEngine'

const props = defineProps<{ unit: CombatUnit }>()

// 意图文本（攻击显示伤害，防御显示格挡，其他显示类型）
const intentText = computed(() => {
  const u = props.unit
  if (!u.intentName) return '准备'
  const base =
    u.intentType === 'attack'
      ? '攻击'
      : u.intentType === 'defend'
        ? '防御'
        : u.intentType === 'buff'
          ? '强化'
          : '特殊'
  if (u.intentDamage) return `${base} ${u.intentDamage * (u.intentHits ?? 1)}`
  if (u.intentBlock) return `${base} ${u.intentBlock}`
  return base
})

// 血条宽度百分比
const hpPct = computed(() => Math.max(0, (props.unit.hp / props.unit.maxHp) * 100))
</script>

<template>
  <div class="enemy">
    <div class="enemy-name">
      {{ unit.name }}
      <span v-if="unit.intentName" class="enemy-intent">{{ intentText }}</span>
    </div>
    <div class="enemy-hp-bar">
      <span class="enemy-hp-fill" :style="{ width: hpPct + '%' }" />
    </div>
    <div class="enemy-hp">{{ unit.hp }}/{{ unit.maxHp }}</div>
    <div v-if="unit.block > 0" class="enemy-block">格挡 {{ unit.block }}</div>
  </div>
</template>

<style scoped lang="scss">
.enemy {
  width: 150px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: linear-gradient(180deg, var(--bg-raised), var(--bg-deep));
  text-align: center;
}
.enemy-name {
  font-size: 14px;
  margin-bottom: 6px;
  color: var(--text-main);
}
.enemy-intent {
  display: block;
  font-size: 12px;
  color: var(--accent-strong);
  margin-top: 2px;
}
.enemy-hp-bar {
  height: 8px;
  border-radius: 4px;
  background: var(--bg-deep);
  border: 1px solid var(--border-strong);
  overflow: hidden;
}
.enemy-hp-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #7a3220, var(--accent-strong));
}
.enemy-hp {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 4px;
}
.enemy-block {
  font-size: 12px;
  color: var(--blue);
}
</style>
