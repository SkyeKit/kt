<script setup lang="ts">
/**
 * 单位 buff/debuff 徽章条：在角色/怪物下方展示全部状态（格挡/覆甲/力量/易伤/虚弱…）。
 * 每个状态一个方块（首字当轻量图标）+ 右下角层数数字；正面 buff 金色、负面 debuff 红色、中性灰色。
 * 点击任意徽章，会在其上方弹出详情浮层（名称/层级/效果说明），再次点击或点击其他徽章切换。
 * 数据来自共享纯函数 unitStatusChips（src/config/statusMeta.ts）。
 */
import { computed, ref } from 'vue'
import { unitStatusChips, type StatusChip } from '@/config/statusMeta'
import type { CombatUnit } from '@/engine/combatEngine'

const props = defineProps<{ unit: CombatUnit }>()

// 单位的可显示状态徽章列表（含格挡字段 + statuses）
const chips = computed(() => unitStatusChips(props.unit))

// 当前展开查看详情的徽章（key）；null 表示不显示浮层。点击已展开徽章可收起
const activeChip = ref<StatusChip | null>(null)

// 切换徽章详情浮层：点同一徽章收起，点其他徽章切换展示；用 key 与单位 id 双重锁定避免跨单位串状态
function toggleChip(chip: StatusChip): void {
  activeChip.value = activeChip.value?.key === chip.key ? null : chip
}
</script>

<template>
  <div v-if="chips.length" class="unit-chips">
    <!-- 详情浮层：展示被点中徽章的说明；仅当有选中徽章时渲染，absolute 定位在徽章条上方 -->
    <div v-if="activeChip" class="chip-popover" :class="activeChip.type">
      <div class="pop-title">
        <span class="pop-name">{{ activeChip.name }}</span>
        <span class="pop-amt">层数 {{ activeChip.amount }}</span>
      </div>
      <div class="pop-desc">{{ activeChip.desc || '（暂无说明）' }}</div>
    </div>

    <!-- 状态徽章：点击查看详情（visible 情况下键盘可操作） -->
    <div
      v-for="c in chips"
      :key="c.key"
      class="chip"
      :class="[c.type, { active: activeChip?.key === c.key }]"
      tabindex="0"
      role="button"
      :title="`${c.name} ${c.amount}`"
      @click.stop="toggleChip(c)"
      @keydown.enter.prevent.stop="toggleChip(c)"
      @keydown.space.prevent.stop="toggleChip(c)"
    >
      <span class="chip-name">{{ c.name.slice(0, 1) }}</span>
      <span v-if="c.amount" class="chip-amt">{{ c.amount }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 状态徽章条：flex 换行排列在单位下方；position 相对作为浮层定位基准
.unit-chips {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: center;
  margin-top: 2px;
}
// 单个状态方块：首字图标（居中）+ 右下角层数数字；点击态高亮边框
.chip {
  position: relative;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 22px;
  text-align: center;
  border: 1px solid var(--border-strong);
  background: rgba(0, 0, 0, 0.4);
  cursor: pointer;
  outline: none;
}
.chip.active {
  border-color: var(--text-main);
  filter: brightness(1.25);
}
.chip-name {
  font-weight: bold;
}
.chip-amt {
  position: absolute;
  right: 1px;
  bottom: 0;
  font-size: 9px;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
}
// 正面 buff：金色
.chip.buff {
  color: var(--gold);
  border-color: rgba(201, 162, 39, 0.6);
}
// 负面 debuff：红色
.chip.debuff {
  color: #e08a6a;
  border-color: rgba(217, 102, 63, 0.55);
}
// 中性：灰色
.chip.neutral {
  color: var(--text-dim);
}
// 详情浮层：定位于徽章条上方居中，显示名称/层数/说明；
// 伪类箭头指向下方徽章，配色与被查看状态类别一致
.chip-popover {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  width: 180px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(18, 16, 24, 0.96);
  border: 1px solid var(--border-strong);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55);
  text-align: left;
}
.chip-popover::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: rgba(18, 16, 24, 0.96);
}
// 标题行：状态名 + 层数
.pop-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.pop-name {
  font-weight: bold;
  font-size: 13px;
}
.pop-amt {
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
}
.pop-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-main);
}
// 浮层标题配色跟随状态类别
.chip-popover.buff .pop-name {
  color: var(--gold);
  border-color: rgba(201, 162, 39, 0.6);
}
.chip-popover.debuff .pop-name {
  color: #e08a6a;
}
.chip-popover.neutral .pop-name {
  color: var(--text-dim);
}
</style>
