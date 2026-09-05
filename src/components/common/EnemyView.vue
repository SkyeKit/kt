<script setup lang="ts">
/**
 * 敌人组件（PRD §3.3/§5.2）：名称 / 意图图标与数值 / 血槽 / 格挡
 * targetable：高亮可点（点击态进入"等待选目标"）
 * hovered：拖拽中鼠标悬停在敌怪上（活靶金色描边 + 缩放）
 * selected：已选中态（点击卡后点怪物打出的目标）
 * fx：伤害/格挡/回复数字跳动（PRD §5.3）
 */
import { computed } from 'vue'
import type { CombatFx, CombatUnit } from '@/engine/combatEngine'

const props = defineProps<{
  unit: CombatUnit
  targetable?: boolean
  hovered?: boolean
  selected?: boolean
  fx?: CombatFx[]
  // 攻击突进动画触发（PRD §5.3 敌人攻击 400ms）
  lunge?: boolean
  // 死亡消散动画中（PRD §5.3 敌人死亡 600ms）
  dying?: boolean
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

// 敌人 fx（最近的几条）
const fxList = computed(() => props.fx?.slice(-5) ?? [])
</script>

<template>
  <div
    class="enemy"
    :class="{ targetable, hovered, selected, lunge, dying }"
    @click.stop="emit('select', unit)"
  >
    <!-- 意图（头顶，PRD §5.2：意图图标）；死亡消散时隐藏 -->
    <div v-if="!dying" class="enemy-intent" :class="{ attack: isAttack }">{{ intentText }}</div>
    <!-- 伤害数字跳动层 -->
    <div class="fx-layer">
      <span v-for="f in fxList" :key="f.id" class="fx-num" :class="'fx-' + f.kind">
        {{ f.text }}
      </span>
    </div>
    <div class="enemy-name">{{ unit.name }}</div>
    <!-- 立绘占位（§5.4：assets/enemies/<id>/idle.png，MVP 用首字色块） -->
    <div class="enemy-art">{{ unit.name.slice(0, 1) }}</div>
    <div class="enemy-hp-bar">
      <span class="enemy-hp-fill" :style="{ width: hpPct + '%' }" />
    </div>
    <div class="enemy-hp">{{ unit.hp }}/{{ unit.maxHp }}</div>
    <div class="enemy-status"><UnitStatusChips :unit="unit" /></div>
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
  position: relative; // fx 数字跳动定位基准
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
  // 状态徽章条：不再用旧的纯文本样式，交给 UnitStatusChips 内部渲染，此处仅居中
  display: flex;
  justify-content: center;
}

/* 伤害数字跳动层（PRD §5.3） */
.fx-layer {
  position: absolute;
  top: -14px;
  left: 50%;
  pointer-events: none;
  z-index: 6;
}
.fx-num {
  position: absolute;
  transform: translateX(-50%);
  font-weight: bold;
  font-size: 20px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
  animation: fx-rise 1.1s ease-out forwards;
  white-space: nowrap;
}
.fx-num:nth-child(1) {
  animation-delay: 0.5s;
  opacity: 0;
}
.fx-num:nth-child(2) {
  animation-delay: 0.32s;
  opacity: 0;
}
.fx-num:nth-child(3) {
  animation-delay: 0.14s;
  opacity: 0;
}
.fx-num:nth-child(n + 4) {
  animation-delay: 0s;
  opacity: 0;
}
.fx-damage {
  color: var(--accent-strong);
}
.fx-block {
  color: #6aa8d6;
}
.fx-heal {
  color: #7ac97a;
}
.fx-buff {
  color: var(--gold);
}
@keyframes fx-rise {
  0% {
    transform: translateX(-50%) translateY(0);
    opacity: 0;
  }
  15% {
    opacity: 1;
  }
  100% {
    transform: translateX(-50%) translateY(-46px);
    opacity: 0;
  }
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

/* 攻击突进：朝左侧玩家前冲（PRD §5.3 敌人攻击 600ms） */
.enemy.lunge {
  animation: enemy-lunge 0.6s ease-out;
  z-index: 4;
}
@keyframes enemy-lunge {
  0% {
    transform: translateX(0) scale(1);
    opacity: 1;
  }
  30% {
    transform: translateX(-16px) scale(1.08);
  }
  60% {
    transform: translateX(-6px) scale(1.03);
  }
  100% {
    transform: translateX(0) scale(1);
  }
}

/* 死亡消散：放大 + 下沉淡出（PRD §5.3 敌人死亡 900ms） */
.enemy.dying {
  animation: enemy-death 0.9s ease-in forwards;
  pointer-events: none;
}
@keyframes enemy-death {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  30% {
    opacity: 1;
    transform: scale(1.06) rotate(-3deg);
  }
  100% {
    opacity: 0;
    transform: scale(0.6) translateY(18px);
  }
}
</style>
