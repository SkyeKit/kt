<script setup lang="ts">
/**
 * 卡牌组件：展示费用/名称/类型/效果（agent.md §9.3：边框色区分类型，灰底统一）
 * 卡面文字直接来自数据（data/cards.json），组件内不硬编码数值
 */
import { computed } from 'vue'
import type { Card } from '@/types'

const props = defineProps<{ card: Card | undefined; playable?: boolean; selected?: boolean }>()
const emit = defineEmits<{ select: [] }>()

// 边框色按类型（攻击红/技能灰/能力金/诅咒紫/事件绿）
const borderClass = computed(() => {
  const c = props.card
  if (!c) return ''
  if (c.rarity === 'curse') return 'card-curse'
  if (c.rarity === 'event') return 'card-event'
  if (c.type === 'attack') return 'card-attack'
  if (c.type === 'power') return 'card-power'
  return 'card-skill'
})

// 显示费用：X / 数字 / —（不可打出）
const costText = computed(() => {
  const c = props.card
  if (!c) return ''
  return c.cost === null ? '—' : String(c.cost)
})
</script>

<template>
  <div class="card" :class="[borderClass, { playable, selected }]" @click="emit('select')">
    <div class="card-cost">{{ costText }}</div>
    <div class="card-name">{{ card?.name ?? '?' }}</div>
    <div class="card-type">
      {{ card?.type === 'attack' ? '攻击' : card?.type === 'skill' ? '技能' : '能力' }}
    </div>
    <div class="card-desc">{{ card?.upgrade ? card?.upgradeDesc : card?.desc }}</div>
  </div>
</template>

<style scoped lang="scss">
// 卡牌：灰色统一背景 + 类型边框色 + 文字遮罩保证可读性（agent.md §9.5）
.card {
  width: var(--card-w);
  height: var(--card-h);
  border: 2px solid var(--border-strong);
  border-radius: var(--radius);
  background: linear-gradient(180deg, var(--bg-card), var(--bg-base));
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
  cursor: pointer;
  user-select: none;
  transition: transform 0.08s;
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
}
.card.playable {
  box-shadow: 0 0 8px rgba(201, 162, 39, 0.35);
}
.card.selected {
  outline: 2px solid var(--gold);
}

.card-attack {
  border-color: var(--card-border-attack);
}
.card-skill {
  border-color: var(--card-border-skill);
}
.card-power {
  border-color: var(--card-border-power);
}
.card-curse {
  border-color: var(--card-border-curse);
}
.card-event {
  border-color: var(--card-border-event);
}

.card-cost {
  position: absolute;
  top: -10px;
  left: -8px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid var(--gold);
  background: var(--bg-deep);
  color: var(--gold);
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
}

.card-name {
  font-size: 15px;
  font-weight: bold;
  text-align: center;
  margin-top: 8px;
  color: var(--text-main);
}

.card-type {
  font-size: 11px;
  text-align: center;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
}

.card-desc {
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-main);
  overflow: hidden;
  background: rgba(0, 0, 0, 0.25); // 文字遮罩（§9.5）
  border-radius: 4px;
  padding: 4px;
}
</style>
