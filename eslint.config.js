import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import eslintConfigPrettier from 'eslint-config-prettier'

// ESLint 扁平配置：JS 推荐 + TS 严格 + Vue 推荐，最后关闭与 Prettier 冲突的规则
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src/auto-imports.d.ts', 'src/components.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    rules: {
      // 单文件组件不强制多词命名（本项目视图名如 BattleView 已满足，但保留宽松）
      'vue/multi-word-component-names': 'off',
      // 未使用变量仅在 debug 时允许前缀 _，其余报错
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // 禁止 any：项目级硬性约束（agent.md §4）
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  eslintConfigPrettier,
)
