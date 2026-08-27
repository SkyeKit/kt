# 杀戮尖塔2 网页版复刻（STS2 Web）

《杀戮尖塔2》（Slay the Spire 2）网页版复刻 · 个人学习 + 开源项目（纯前端，无后端）。

- **MVP 范围**：战士（铁甲战士）单角色、密林幕（17 层）地图、战斗/商店/篝火/事件/遗物/先古遗物选择、单局存档、测试场（木桩）、调试控制台、结算界面。
- **明确不做**：药水、其他角色、多人模式、其他幕、攀升难度、事件后续幕。
- **技术栈**：Vue 3（`<script setup>`）+ TypeScript（strict）+ Vite + Vue Router + Pinia + SCSS + Vitest。

## 快速开始

```bash
pnpm install      # 安装依赖
pnpm dev          # 启动开发服务器（http://localhost:5173）
pnpm typecheck    # 类型检查
pnpm lint         # ESLint + Prettier
pnpm test         # Vitest 引擎单元测试
pnpm build        # 生产构建
pnpm data:generate  # 重新生成 src/data/*.json（数据源为 document/*.md）
```

## 目录结构

```
src/
├── views/        # 页面视图（MainMenu/Run/Battle/Settlement/Test/Codex/Stats）
├── components/   # 组件（battle/map/reward/event/shop/campfire/console/codex/common/menu）
├── engine/       # 核心逻辑（stateMachine/combatEngine/effectEngine/relicSystem/enemyAI/mapGenerator/saveSystem）
├── composables/  # useBattle/useMap/useEvent/useSave/useMetaProgress
├── stores/       # Pinia（gameStore 单局 / metaStore 元进度 / settingsStore 设置）
├── data/         # 游戏数据 JSON（由 scripts/ 生成，禁止手改）
├── config/       # gameConfig.ts（数值/概率/价格常量，游戏数据外的配置）
├── types/        # TS 类型（card/relic/enemy/event/status/runSave/effect）
├── tests/        # Vitest 单元测试
└── scripts/      # 数据转换脚本（document/*.md → data/*.json）
```

## 数据驱动

- 游戏数值/文本一律来自 `src/data/*.json`，**禁止在引擎/组件中硬编码**（agent.md §5.1）。
- 数据源是 `document/` 下的 md 文件（与 `D:/muyu/document/` 同步）；**修改游戏数据 = 改 md 后重跑 `pnpm data:generate`**。
- 开发规范详见 `AGENTS.md`。

## 文档

- `document/PRD_v1.0.md` — 产品需求文档（v1.2 定稿）
- `document/img.md` — 美术资源占位与命名清单
- `AGENTS.md` — AI 编码助手开发规则
