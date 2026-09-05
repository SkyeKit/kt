<script setup lang="ts">
/**
 * 暂停菜单（PRD §3.11）：全屏覆盖层，不改动状态机阶段（保持当前场景可见、可读）
 * 菜单项：继续 / 重打当前节点 / 调试控制台 / 存档退出 / 放弃本局
 * 入口：SingleRunStatusBar 的"菜单"按钮 或 按 Esc 键触发
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/gameStore'
import ConsolePanel from '@/components/console/ConsolePanel.vue'

// 关闭事件：通知宿主（SingleRunStatusBar）关闭覆盖层
const emit = defineEmits<{ (e: 'close'): void }>()
const store = useGameStore()
const router = useRouter()
// 控制台子面板是否展开（"控制台"按钮打开，关闭返回菜单）
const showConsole = ref(false)
// 是否显示"放弃本局"二次确认层（替代原生 window.confirm，保持暗黑哥特风格统一）
const confirmAbandon = ref(false)

// 按当前阶段导航到对应视图：重打/存档退出后 phase 会因 force/enterNode 变化，
// BATTLE → 战斗页；其余（RUN/SHOP/EVENT/CAMPFIRE/REWARD）→ 地图页
function goByPhase(): void {
  router.push(store.phase === 'BATTLE' ? '/battle' : '/run')
}

// 继续：仅关闭覆盖层（phase 不变，返回暂停前的界面）
function resume(): void {
  emit('close')
}

// 重打当前节点：恢复进入前快照并重新进入（敌人重置、玩家恢复到进入前）
// 成功后立即关闭菜单并跳到对应页面（战斗/地图），不停留在暂停菜单
// 无快照（刚开局未进任何节点）时返回 false，退化为仅关闭
function retry(): void {
  if (store.restartNode()) {
    goByPhase()
    emit('close')
  } else {
    resume()
  }
}

// 存档退出：保存当前局并返回主菜单（MVP 不保存战斗现场，续档等效重打该节点）
function saveExit(): void {
  store.saveAndExit()
  router.push('/')
}

// 放弃本局：先弹二次确认层（不直接执行，防止误触清空存档）
function requestAbandon(): void {
  confirmAbandon.value = true
}

// 取消放弃：关闭确认层，留在暂停菜单
function cancelAbandon(): void {
  confirmAbandon.value = false
}

// 确认放弃：清空存档返回主菜单（不可恢复）
function confirmAbandonNow(): void {
  store.abandonRun()
  router.push('/')
}
</script>

<template>
  <!-- 全屏覆盖层：最高层 z-index，盖住地图/战斗/所有弹窗 -->
  <div class="pause-mask">
    <!-- 控制台子面板：打开时展示调试控制台，关闭返回菜单列表 -->
    <div v-if="showConsole" class="pause-panel console-pause-panel">
      <ConsolePanel />
      <button class="btn pause-btn" @click="showConsole = false">← 返回菜单</button>
    </div>

    <!-- 菜单列表 -->
    <div v-else class="pause-panel">
      <h2 class="pause-title">暂停</h2>
      <button class="btn btn-primary pause-btn" @click="resume">继续游戏</button>
      <button class="btn pause-btn" @click="retry">重打当前节点</button>
      <button class="btn pause-btn" @click="showConsole = true">调试控制台</button>
      <button class="btn pause-btn" @click="saveExit">存档退出</button>
      <button class="btn pause-btn danger" @click="requestAbandon">放弃本局</button>
      <p class="pause-hint">按 Esc 或点击「继续游戏」返回</p>
    </div>

    <!-- 放弃本局二次确认层：暗黑哥特风格，盖住暂停菜单；点遮罩空白/取消返回 -->
    <div v-if="confirmAbandon" class="abandon-mask" @click.self="cancelAbandon">
      <div class="abandon-panel" role="alertdialog" aria-label="确认放弃本局">
        <h3 class="abandon-title">放弃本局</h3>
        <p class="abandon-text">当前进度将被清除，<span class="abandon-em">无法恢复</span>。</p>
        <p class="abandon-text faint">确认后本局存档将被销毁，返回主菜单。</p>
        <div class="abandon-actions">
          <button class="btn abandon-btn abandon-cancel" @click="cancelAbandon">取消</button>
          <button class="btn abandon-btn abandon-confirm" @click="confirmAbandonNow">
            确认放弃
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.pause-mask {
  position: fixed;
  inset: 0;
  z-index: 500; // 高于状态栏(100)/地图浮层(10)/全屏页(20)，确保暂停菜单最顶层
  background: rgba(10, 8, 7, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}
.pause-panel {
  pointer-events: auto;
  background: rgba(14, 11, 9, 0.97);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 28px 36px;
  width: 360px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: stretch;
}
.pause-title {
  color: var(--accent-strong);
  font-size: 26px;
  margin: 0 0 6px;
  letter-spacing: 3px;
  text-align: center;
}
.pause-btn {
  font-size: 16px;
  padding: 10px 18px;
  width: 100%;
}
.pause-btn.danger {
  color: var(--accent-strong);
  border-color: var(--accent);
}
.pause-hint {
  color: var(--text-faint);
  font-size: 12px;
  text-align: center;
  margin-top: 6px;
}

// 控制台面板加宽：容纳卡组/全量卡/遗物浏览网格
.console-pause-panel {
  width: min(760px, 96vw);
  max-height: 92vh;
  padding: 18px 22px;
}
.console-pause-panel .pause-btn {
  font-size: 14px;
  padding: 6px 12px;
}

// ===== 放弃本局二次确认层（暗黑哥特风格） =====
// 遮罩：比暂停菜单遮罩更暗，盖住整个暂停面板（z-index 高于 .pause-panel）
.abandon-mask {
  position: fixed;
  inset: 0;
  z-index: 10;
  background: rgba(5, 4, 3, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
}
// 面板：深褐渐变底 + 红褐双边框 + 内阴影，呼应哥特石质/烛光质感
.abandon-panel {
  width: 380px;
  max-width: 90vw;
  background: linear-gradient(180deg, rgba(20, 16, 14, 0.98), rgba(12, 9, 7, 0.98));
  border: 1px solid var(--accent-dim);
  border-radius: var(--radius-lg);
  box-shadow:
    0 0 0 1px var(--border-strong),
    0 0 26px rgba(181, 72, 45, 0.22),
    inset 0 0 34px rgba(0, 0, 0, 0.55);
  padding: 26px 32px 22px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
// 标题：红褐警示色 + 顶部菱形分隔线（CSS 绘制的哥特装饰，避免图片资源）
.abandon-title {
  margin: 0 0 4px;
  color: var(--accent-strong);
  font-size: 22px;
  letter-spacing: 4px;
  text-align: center;
  text-shadow: 0 0 12px rgba(217, 102, 63, 0.45);
  &::after {
    content: '';
    display: block;
    width: 64px;
    height: 1px;
    margin: 10px auto 0;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
  }
}
// 正文：灰褐弱化文本；强调词用红褐
.abandon-text {
  margin: 0;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1.6;
  text-align: center;
}
.abandon-text.faint {
  color: var(--text-faint);
  font-size: 12px;
}
.abandon-em {
  color: var(--accent-strong);
  font-weight: 600;
}
// 按钮行：取消（中性）+ 确认放弃（红褐危险渐变，hover 亮起发光）
.abandon-actions {
  width: 100%;
  display: flex;
  gap: 12px;
  margin-top: 10px;
}
.abandon-btn {
  flex: 1;
  font-size: 15px;
  padding: 9px 0;
}
.abandon-cancel {
  background: linear-gradient(180deg, var(--bg-raised), var(--bg-base));
  color: var(--text-main);
  border-color: var(--border-strong);
}
.abandon-cancel:hover:not(:disabled) {
  border-color: var(--text-dim);
  color: var(--text-main);
}
.abandon-confirm {
  background: linear-gradient(180deg, var(--accent), var(--accent-dim));
  border-color: var(--accent-strong);
  color: #f6e4d4;
}
.abandon-confirm:hover:not(:disabled) {
  background: linear-gradient(180deg, #cf5b38, var(--accent));
  color: #fff;
  box-shadow: 0 0 14px rgba(217, 102, 63, 0.55);
}
</style>
