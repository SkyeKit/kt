<script setup lang="ts">
/**
 * 事件浮层（PRD §3.7）：显示事件名/触发条件/选项，选项点击立即结算
 */
import { useEvent } from '@/composables/useEvent'

const { event, options, choose } = useEvent()
</script>

<template>
  <div v-if="event" class="event panel">
    <h2 class="h-title">{{ event.name }}</h2>
    <p v-if="event.trigger" class="event-trigger">触发条件：{{ event.trigger }}</p>
    <div class="event-options">
      <button v-for="opt in options" :key="opt.text" class="event-option" @click="choose(opt)">
        <span class="opt-text">{{ opt.text }}</span>
        <span class="opt-effect">{{ opt.effect }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.event {
  min-width: 480px;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.event-trigger {
  font-size: 12px;
  color: var(--text-faint);
}
.event-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.event-option {
  padding: 12px 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: linear-gradient(180deg, var(--bg-raised), var(--bg-base));
  color: var(--text-main);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.event-option:hover {
  border-color: var(--accent-strong);
}
.opt-text {
  font-size: 15px;
  color: var(--accent-strong);
}
.opt-effect {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.5;
}
</style>
