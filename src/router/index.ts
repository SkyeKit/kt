/**
 * 路由表：页面视图与游戏阶段一一对应（agent.md §5.4 状态机约束）
 */
import { createRouter, createWebHashHistory } from 'vue-router'
import MainMenuView from '@/views/MainMenuView.vue'
import RunView from '@/views/RunView.vue'
import BattleView from '@/views/BattleView.vue'
import SettlementView from '@/views/SettlementView.vue'
import TestView from '@/views/TestView.vue'
import CodexView from '@/views/CodexView.vue'
import StatsView from '@/views/StatsView.vue'

// 使用 hash 路由（纯前端部署友好，刷新不丢状态）
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'menu', component: MainMenuView },
    { path: '/run', name: 'run', component: RunView },
    { path: '/battle', name: 'battle', component: BattleView },
    { path: '/settlement', name: 'settlement', component: SettlementView },
    { path: '/test', name: 'test', component: TestView },
    { path: '/codex', name: 'codex', component: CodexView },
    { path: '/stats', name: 'stats', component: StatsView },
  ],
})

export default router
