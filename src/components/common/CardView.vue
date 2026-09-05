<script setup lang="ts">
/**
 * 卡牌组件：展示费用/名称/类型/效果（agent.md §9.3：边框色区分类型，灰底统一）
 * 卡面文字直接来自数据（data/cards.json），组件内不硬编码数值
 * dragging 态：拖拽中浮起的卡牌（去掉 hover 效果，含光标 grabbing）
 */
import { computed } from 'vue'
import type { Card } from '@/types'
import { enchantmentsOf } from '@/engine/enchantSystem'

const props = defineProps<{
  card: Card | undefined
  playable?: boolean
  selected?: boolean
  dragging?: boolean
  /** 是否显示"升级态"（卡实例特有的标志）：名称追加 + 号，名称与数据用绿色字，数据改用 upgradeDesc */
  upgraded?: boolean
}>()
const emit = defineEmits<{ select: [] }>()

// 该卡的附魔列表（数据驱动：由 Card.enchantments 查 data/enchantments.json）
// 供卡面右上角展示附魔徽标（如「锋利」「迅速」），名称来自数据文件
const enchantList = computed(() => (props.card ? enchantmentsOf(props.card) : []))

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

// 显示名称：升级态追加 + 号（如「打击+」需与未升级「打击」区分，PRD 需求）
const nameText = computed(() =>
  props.upgraded ? `${props.card?.name ?? '?'}+` : (props.card?.name ?? '?'),
)
// 显示描述：升级态用数据中的升级后描述（upgradeDesc），否则用原描述
const descText = computed(() => {
  const c = props.card
  if (!c) return ''
  return props.upgraded ? c.upgradeDesc || c.desc : c.desc
})
</script>

<template>
  <div
    class="card"
    :class="[borderClass, { playable, selected, dragging }]"
    @click.stop="emit('select')"
  >
    <div class="card-cost">{{ costText }}</div>
    <!-- 附魔徽标：显示该牌已挂载的附魔名称（数据驱动），悬浮提示附魔效果描述 -->
    <div v-if="enchantList.length" class="card-enchants">
      <span
        v-for="e in enchantList"
        :key="e.id"
        class="card-enchant"
        :title="`${e.name}：${e.desc}`"
      >
        {{ e.name }}
      </span>
    </div>
    <div class="card-name" :class="{ 'is-upgraded': upgraded }">{{ nameText }}</div>
    <div class="card-type">
      {{ card?.type === 'attack' ? '攻击' : card?.type === 'skill' ? '技能' : '能力' }}
    </div>
    <div class="card-desc" :class="{ 'is-upgraded': upgraded }">{{ descText }}</div>
  </div>
</template>

<style scoped lang="scss">
// 卡牌：灰色统一背景 + 类型边框色 + 文字遮罩保证可读性（agent.md §9.5）
// 背景叠加顶部暖光渐变，模拟烛光洒在卡面上的质感
.card {
  width: var(--card-w);
  height: var(--card-h);
  border: 2px solid var(--border-strong);
  border-radius: var(--radius);
  background:
    radial-gradient(120% 90% at 50% -10%, rgba(90, 62, 40, 0.16), transparent 60%),
    linear-gradient(180deg, var(--bg-card), var(--bg-base));
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
  cursor: pointer;
  user-select: none;
  transition:
    transform 0.08s,
    box-shadow 0.08s;
}
.card:hover {
  transform: translateY(-4px);
  // 悬浮：深投影 + 金色描边微光，突出"可交互"
  box-shadow:
    0 6px 18px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(201, 162, 39, 0.18);
}
.card.playable {
  box-shadow: 0 0 8px rgba(201, 162, 39, 0.35);
}
.card.selected {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

// 拖拽态：抬高 + 旋转小角度 + 阴影
.card.dragging {
  transform: scale(1.05) rotate(-3deg);
  cursor: grabbing;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.7);
}
// 拖拽态禁用 hover 上抬
.card.dragging:hover {
  transform: scale(1.05) rotate(-3deg);
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
  // 费用徽章：金色微光 + 内凹阴影，如一枚哥特金币
  box-shadow:
    0 0 8px rgba(201, 162, 39, 0.35),
    inset 0 1px 2px rgba(0, 0, 0, 0.5);
}

// 附魔徽标：右上角竖排小标签（紫金色系，区别于费用/类型信息）
.card-enchants {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-end;
}
.card-enchant {
  font-size: 9px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 3px;
  background: rgba(140, 80, 200, 0.55);
  color: #e8d5ff;
  border: 1px solid rgba(180, 130, 255, 0.6);
  white-space: nowrap;
  cursor: help;
}

.card-name {
  font-size: 15px;
  font-weight: bold;
  text-align: center;
  margin-top: 8px;
  color: var(--text-main);
  letter-spacing: 0.03em;
  // 名称微光：提升可读性与质感
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

// 升级态：名称与数据用绿色字（PRD：升级卡卡名与数据绿色显示，卡名追加 + 号）
.is-upgraded {
  color: var(--card-upgraded, #6fce7f);
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
  // 描述区渐变遮罩：上深下浅，突出文字层次（agent.md §9.5 可读性）
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.32), rgba(0, 0, 0, 0.16));
  border-radius: 4px;
  padding: 4px;
}
</style>
