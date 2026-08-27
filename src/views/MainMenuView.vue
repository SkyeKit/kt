<script setup lang="ts">
/**
 * 主菜单（PRD §3.10）：开始新局 / 继续存档 / 测试场 / 图鉴 / 统计
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/gameStore'
import { useSettingsStore } from '@/stores/settingsStore'

const router = useRouter()
const store = useGameStore()
const settings = useSettingsStore()
const notice = ref('')

// 开始新局（随机种子）
function startNew(): void {
  store.newRun()
  router.push('/run')
}

// 继续存档
function continueGame(): void {
  if (!store.continueRun()) {
    notice.value = '没有可继续的存档'
    return
  }
  router.push('/run')
}

// 进入测试场（木桩）
function goTest(): void {
  router.push('/test')
}

function goCodex(): void {
  router.push('/codex')
}

function goStats(): void {
  router.push('/stats')
}
</script>

<template>
  <div class="menu">
    <h1 class="menu-title">杀戮尖塔2</h1>
    <p class="menu-sub">网页版复刻 · MVP</p>
    <div class="menu-btns">
      <button class="btn btn-primary menu-btn" @click="startNew">开始游戏</button>
      <button class="btn menu-btn" @click="continueGame">继续存档</button>
      <button class="btn menu-btn" @click="goTest">测试场（木桩）</button>
      <button class="btn menu-btn" @click="goCodex">图鉴</button>
      <button class="btn menu-btn" @click="goStats">统计</button>
    </div>
    <p v-if="notice" class="menu-notice">{{ notice }}</p>
    <label class="menu-opt">
      <input v-model="settings.settings.sound" type="checkbox" /> 音效
    </label>
  </div>
</template>

<style scoped lang="scss">
.menu {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
}
.menu-title {
  font-size: 52px;
  letter-spacing: 8px;
  color: var(--accent-strong);
  text-shadow: 0 0 24px rgba(217, 102, 63, 0.4);
}
.menu-sub {
  color: var(--text-dim);
  letter-spacing: 3px;
}
.menu-btns {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 220px;
}
.menu-btn {
  width: 100%;
}
.menu-notice {
  color: var(--gold);
}
.menu-opt {
  color: var(--text-dim);
  font-size: 13px;
}
</style>
