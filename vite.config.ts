import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { fileURLToPath, URL } from 'node:url'

// Vite 配置：Vue3 + 自动导入（unplugin-auto-import / unplugin-vue-components）
export default defineConfig({
  plugins: [
    vue(),
    // 自动导入 vue/vue-router/pinia 的 API（ref/computed 等无需手动 import）
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      dts: 'src/auto-imports.d.ts',
    }),
    // 自动注册 src/components 下的组件（目录递归）
    Components({
      dirs: ['src/components'],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      // 路径别名 @ → src，配合 tsconfig paths
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        // 全局注入设计变量与混入（variables.scss 自身不注入，避免循环引用）
        additionalData: (content: string, filename: string) => {
          if (filename.endsWith('variables.scss')) return content
          return `@use "@/styles/variables.scss" as *;\n${content}`
        },
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
})
