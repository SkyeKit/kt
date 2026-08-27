/**
 * 应用入口：创建 Vue 应用，挂载 Pinia 与路由，引入全局样式
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import '@/styles/variables.scss'

// 创建应用：Pinia（状态）→ 路由（页面）→ 挂载
const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
