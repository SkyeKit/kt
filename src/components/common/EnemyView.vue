<script setup lang="ts">
/**
 * 敌人组件（PRD §3.3/§5.2）：名称 / 意图图标与数值 / 血槽 / 格挡
 * targetable：高亮可点（点击态进入"等待选目标"）
 * hovered：拖拽中鼠标悬停在敌怪上（活靶金色描边 + 缩放）
 * selected：已选中态（点击卡后点怪物打出的目标）
 */
import { computed } from 'vue'
import type { CombatUnit } from '@/engine/combatEngine'

const props = defineProps<{
  unit: CombatUnit
  targetable?: boolean
  hovered?: boolean
  selected?: boolean
}>()
const emit = defineEmits<{ select: [unit: CombatUnit] }>()

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

// 意图是否"攻击"（攻击意图用红色警示）
const isAttack = computed(() => props.unit.intentType === 'attack')

// 血条宽度百分比
const hpPct = computed(() => Math.max(0, (props.unit.hp / props.unit.maxHp) * 100))

// 状态摘要（力量/格挡等）
const statusText = computed(() => {
  const u = props.unit
  const parts: string[] = []
  if (u.block > 0) parts.push(`格挡 ${u.block}`)
  if (u.strength > 0) parts.push(`力量 ${u.strength}`)
  return parts.join(' · ')
})
</script>

<template>
  <div class="enemy" :class="{ targetable, hovered, selected }" @click.stop="emit('select', unit)">
    <!-- 意图（头顶，PRD §5.2：意图图标） -->
    <div class="enemy-intent" :class="{ attack: isAttack }">{{ intentText }}</div>
    <div class="enemy-name">{{ unit.name }}</div>
    <!-- 立绘占位（§5.4：assets/enemies/<id>/idle.png，MVP 用首字色块） -->
    <div class="enemy-art">{{ unit.name.slice(0, 1) }}</div>
    <div class="enemy-hp-bar">
      <span class="enemy-hp-fill" :style="{ width: hpPct + '%' }" />
    </div>
    <div class="enemy-hp">{{ unit.hp }}/{{ unit.maxHp }}</div>
    <div v-if="statusText" class="enemy-status">{{ statusText }}</div>
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
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition:
    border-color 0.12s,
    transform 0.08s,
    box-shadow 0.12s;
}
.enemy-intent {
  font-size: 12px;
  color: var(--text-dim);
  background: rgba(0, 0, 0, 0.35);
  border-radius: 4px;
  padding: 2px 6px;
  align-self: center;
}
.enemy-intent.attack {
  color: var(--accent-strong);
  font-weight: bold;
}
.enemy-name {
  font-size: 14px;
  color: var(--text-main);
}
.enemy-art {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  color: var(--text-faint);
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  margin: 2px 0;
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
}
.enemy-status {
  font-size: 11px;
  color: var(--blue);
}

/* 目标选择状态（点击卡后等待选目标）*/
.enemy.targetable {
  cursor: pointer;
  border-color: var(--gold);
  box-shadow: 0 0 10px rgba(201, 162, 39, 0.35);
}
.enemy.targetable:hover {
  transform: scale(1.04);
}

/* 拖拽中悬停高亮（活靶） */
.enemy.hovered {
  border-color: var(--gold);
  transform: scale(1.08);
  box-shadow: 0 0 16px rgba(201, 162, 39, 0.55);
}

/* 已选中 */
.enemy.selected {
  border-color: var(--accent-strong);
  box-shadow: 0 0 12px rgba(217, 102, 63, 0.5);
}
</style>
