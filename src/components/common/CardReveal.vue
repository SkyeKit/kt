<script setup lang="ts">
/**
 * 卡牌居中展示浮层（事件/遗物获得卡牌时展示）
 * 读取 store.revealedCards，把新获得的牌在屏幕正中展示，1 秒后由 store 自动清空（浮层消失，卡牌已入组）。
 * 浮层 pointer-events: none，不拦截下方交互；多张时横向排开。
 */
import { computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import CardView from '@/components/common/CardView.vue'

const store = useGameStore()
const show = computed(() => store.revealedCards && store.revealedCards.length > 0)
</script>

<template>
  <!-- 居中展示：不拦截点击；多张牌横向排开，带淡入上浮动画，1s 后消失 -->
  <Transition name="reveal">
    <div v-if="show" class="card-reveal">
      <CardView
        v-for="(c, i) in store.revealedCards"
        :key="`${c.id}-${i}`"
        :card="c"
        class="reveal-card"
      />
    </div>
  </Transition>
</template>

<style scoped lang="scss">
// 覆盖层直接铺在屏幕中心，pointer-events:none 保证不挡地图/其它交互
.card-reveal {
  position: fixed;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-wrap: wrap; // 卡多时换行展示，避免横向溢出屏幕
  justify-content: center;
  align-items: center;
  gap: 14px;
  padding: 0 24px;
  max-height: 70vh;
  overflow: auto; // 极多卡（如整组复制）时允许滚动查看
  z-index: 90;
  pointer-events: none;
}
// 单张时略微放大强调，多张时保持原尺寸
.reveal-card {
  width: var(--card-w);
  height: var(--card-h);
  box-shadow: 0 0 34px rgba(0, 0, 0, 0.7);
}
// 淡入 + 轻微上浮动画；Store 在 1s 后清空 revealedCards，浮层随 v-if 消失
.reveal-enter-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.reveal-leave-active {
  transition: opacity 0.15s ease;
}
.reveal-enter-from {
  opacity: 0;
  transform: translateY(14px);
}
.reveal-leave-to {
  opacity: 0;
}
</style>
