<script setup lang="ts">
/**
 * 主菜单（PRD §3.10）：开始新局 / 继续存档 / 测试场 / 图鉴 / 统计 / 设置 / 数据浏览
 * 设置面板：音效/动画/调试控制台显隐开关 + 重置存档 + 退出。
 * 数据浏览器：只读浏览全部卡牌/遗物/附魔（PRD §3.10 控制台-只读浏览）。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/gameStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useMetaStore } from '@/stores/metaStore'
import { clearRun } from '@/engine/saveSystem'
import { ACTS } from '@/config/gameConfig'
import type { ActId } from '@/types'
import DataBrowser from '@/components/menu/DataBrowser.vue'

const router = useRouter()
const store = useGameStore()
const settings = useSettingsStore()
const meta = useMetaStore()
const notice = ref('')
// 弹窗开关：showSettings 设置面板 / showBrowser 只读数据浏览
const showSettings = ref(false)
const showBrowser = ref(false)
// 开始新局：幕随机抽取（密林丘/暗港等值概率），随机种子开局
function startNew(): void {
  const acts = Object.keys(ACTS) as ActId[]
  const act = acts[Math.floor(Math.random() * acts.length)] ?? 'overgrowth'
  store.newRun(undefined, act)
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

// 重置存档：清除单局存档 + 元进度，需二次确认（PRD §3.10 设置）
function resetAll(): void {
  if (!window.confirm('确定重置存档？将清除当前单局与全部战绩记录。')) return
  clearRun()
  meta.reset()
  notice.value = '存档已重置'
}

// 退出：纯前端只能尝试关闭当前标签页（由浏览器策略决定是否生效）
function quitGame(): void {
  window.close()
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
      <button class="btn menu-btn" @click="showBrowser = true">控制台（数据浏览）</button>
      <button class="btn menu-btn" @click="showSettings = true">设置</button>
    </div>
    <p v-if="notice" class="menu-notice">{{ notice }}</p>

    <!-- 设置面板 -->
    <div v-if="showSettings" class="menu-mask" @click.self="showSettings = false">
      <div class="menu-modal">
        <h3 class="modal-title">设置</h3>
        <label class="menu-opt"
          ><input v-model="settings.settings.sound" type="checkbox" /> 音效</label
        >
        <label class="menu-opt">
          <input v-model="settings.settings.animations" type="checkbox" /> 动画（可访问性）
        </label>
        <label class="menu-opt">
          <input v-model="settings.settings.showDebugConsole" type="checkbox" />
          战斗中显示调试控制台
        </label>
        <button class="btn menu-btn" @click="resetAll">重置存档</button>
        <button class="btn menu-btn" @click="quitGame">退出</button>
        <button class="btn btn-primary menu-btn" @click="showSettings = false">关闭</button>
      </div>
    </div>

    <!-- 只读数据浏览器（PRD §3.10 控制台） -->
    <div v-if="showBrowser" class="menu-mask" @click.self="showBrowser = false">
      <div class="menu-modal browser-modal">
        <h3 class="modal-title">控制台 · 数据浏览（只读）</h3>
        <DataBrowser />
        <button class="btn btn-primary menu-btn" @click="showBrowser = false">关闭</button>
      </div>
    </div>
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
  // 标题：金→猩红渐变文字 + 双层辉光，营造招牌感（纯 CSS，不引入图片）
  font-size: 52px;
  letter-spacing: 8px;
  background: linear-gradient(180deg, #f0dca8 0%, var(--gold) 45%, var(--accent-strong) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 18px rgba(217, 102, 63, 0.45)) drop-shadow(0 2px 2px rgba(0, 0, 0, 0.6));
  text-align: center;
  // 底部金色装饰线：哥特边框风格
  &::after {
    content: '';
    display: block;
    width: 260px;
    height: 1px;
    margin: 14px auto 0;
    background: linear-gradient(90deg, transparent, var(--gold), transparent);
  }
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
  text-shadow: 0 0 8px rgba(201, 162, 39, 0.4);
}
.menu-opt {
  color: var(--text-dim);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 弹窗遮罩：覆盖全屏、可点空白关闭 */
.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: rgba(10, 8, 7, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 设置面板：垂直排列 */
.menu-modal {
  background: rgba(14, 11, 9, 0.97);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 22px 30px;
  width: 340px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-title {
  color: var(--accent-strong);
  font-size: 22px;
  margin: 0 0 4px;
  letter-spacing: 2px;
  text-align: center;
}
/* 数据浏览器：更高更宽，容纳滚动列表 */
.browser-modal {
  width: 820px;
  height: 80vh;
  max-width: 94vw;
}
</style>
