# AGENT 开发规则 — 杀戮尖塔2 网页版复刻

> 本文件为 AI 编码助手（Claude Code / Codex / Cursor / Copilot 等）的项目级开发规范。
> 放置于仓库根目录，命名为 `AGENTS.md`（或 `agent.md`）即可被主流 Agent 自动读取。
> 数据依据：`document/PRD_v1.0.md` 及 `document/` 下的全部游戏数据文件。

---

## 1. 项目概述

**项目**：杀戮尖塔2（Slay the Spire 2）网页版复刻，个人学习 + 开源项目（纯前端，无后端）。

**技术栈（MVP 固定，勿擅自更换）**：

- Vue 3（Composition API + `<script setup>`）+ TypeScript（strict 模式）
- Vite + Vue Router + Pinia
- SCSS + CSS Variables（暗黑哥特风格）
- Vitest（引擎单元测试）
- ESLint + Prettier；unplugin-auto-import / unplugin-vue-components

**MVP 范围（只做这些，其余明确不做）**：

- ✅ 战士（铁甲战士）单角色、密林幕（17 层）地图、战斗/商店/篝火/事件/遗物/先古遗物选择
- ✅ 单局存档、测试场（木桩）、调试控制台、结算界面
- 🚫 药水、其他 4 个角色、多人模式、其他幕（暗港/巢穴/荣耀）、攀升难度、事件后续幕

---

## 2. 常用命令

```bash
pnpm install        # 安装依赖
pnpm dev            # 启动开发服务器
pnpm typecheck      # 类型检查（tsc --noEmit，改动后必跑）
pnpm lint           # ESLint + Prettier 检查
pnpm lint --fix     # 自动修复格式
pnpm test           # Vitest 单元测试（全部）
pnpm vitest run -t "<模式名>"   # 只跑某个测试
pnpm build          # 生产构建
```

> 完成任何任务前，必须保证 `pnpm typecheck && pnpm lint && pnpm test` 全部通过。

---

## 3. 项目结构（关键目录职责）

```
src/
├── views/            # 页面视图（MainMenu/Run/Battle/Settlement/Test/Codex/Stats）
├── components/       # 组件（battle/map/reward/event/shop/campfire/console/codex/common/menu）
├── engine/           # ★核心逻辑（stateMachine/combatEngine/effectEngine/relicSystem/enemyAI/mapGenerator/saveSystem）
├── composables/      # useBattle/useMap/useEvent/useSave/useMetaProgress
├── stores/           # Pinia（gameStore 单局 / metaStore 元进度 / settingsStore 设置）
├── data/             # ★游戏数据 JSON（由 scripts/ 生成，禁止手改）
├── config/           # gameConfig.ts（数值/概率/价格常量，游戏数据外的配置）
├── types/            # TS 类型（card/relic/enemy/event/status/runSave/effect）
├── tests/            # Vitest（combatEngine/effectEngine/mapGenerator 等 spec）
└── scripts/          # 数据转换脚本（document/*.md → data/*.json）
```

---

## 4. 代码风格

**TypeScript 严格模式**，以下约定：

```ts
// ✅ 正确：命名导出 + 显式返回类型 + 常量用 const
export const getCardById = (id: string): Card | undefined => cardsMap.value.get(id)

// ❌ 错误：默认导出、any、隐式类型、可变全局
// export default function getUser(id) { return db.users.find(id); }
```

- **命名**：组件/类型 `PascalCase`；变量/函数 `camelCase`；常量 `UPPER_SNAKE_CASE`；卡牌/遗物/敌人/事件的 **ID 一律 snake_case**（如 `burning_blood`、`strike_ironclad`，与数据文件一致）
- **导出**：一律命名导出，禁止默认导出
- **类型**：禁止 `any`；效果/状态/事件等业务数据必须用 `types/` 下的类型约束
- **单引号、无分号**（Prettier 统一，不要手动纠结格式）
- **组件**：Vue 3 `<script setup lang="ts">` + Composition API；逻辑抽到 `composables/`，组件保持薄
- **中文**：所有玩家可见文本（卡牌描述、UI、事件文本）使用中文，且**直接引用数据文件内容**，不重复手写

**注释规范（★必读）**：

- 所有代码必须带**详细中文注释**，说明"做了什么"与"为什么这么做"
- **创建处**注明用途：函数/变量/组件创建时，注释说明其职责与初始值含义
- **调用处**注明意图：调用某个函数/变量时，注释说明该调用的目的与关键参数
- 关键逻辑（伤害结算、意图循环、效果链解析、地图生成）必须**逐段注释**

```ts
// 创建玩家生命值状态：初始 80（对应 PRD 战士基础属性），燃烧之血战斗结束回血时更新
const hp = ref(80)
const maxHp = ref(80)

// 调用 combatEngine.calculateDamage 计算最终伤害
// 依次应用：基础值+力量 → 易伤修正(×1.5) → 虚弱修正(×0.75) → 格挡扣除
const damage = combatEngine.calculateDamage(card.effects, { attacker: player, target: enemy })

// 调用 saveSystem.save 持久化当前局（localStorage 键 sts2_run_v1，含版本号）
saveSystem.save(runState)
```

- **函数/组件顶部**：用 JSDoc 风格写明用途、参数、返回值：

```ts
/**
 * 结算一次攻击伤害（PRD §3.3.3）
 * @param base 基础伤害（来自卡牌/怪物招式数据）
 * @param attacker 攻击方（含力量修正）
 * @param target 目标（含易伤/虚弱状态）
 * @returns 实际扣除的生命值（已扣除格挡）
 */
export function calculateDamage(base: number, attacker: Unit, target: Unit): number
```

- **数据字段**：注释标注含义与来源（如 `// 稀有度，对应 relic.md 的 tier 字段`），便于与 `document/` 数据文件核对
- 禁止无意义注释（如 `// 加1`）；**注释与代码同步更新**，改动代码必须同步修改注释

---

## 5. 游戏逻辑规范（★重要）

### 5.1 数据驱动，禁止硬编码

- 卡牌/遗物/敌人/事件/状态的**全部数值与文本**来自 `data/*.json`
- 数据源是 `document/` 下的 md 文件（如 `WarriorDeck.md`、`relic.md`），**修改游戏数据 = 改 md 后重跑 `scripts/` 转换**，或直接改 json（保持与 md 一致）
- 引擎代码中**不得出现**魔法数值（伤害 6、费用 1 等）——全部从数据读取
- 新增卡牌/遗物/事件 → 先加数据，再考虑引擎是否要支持新的效果类型

### 5.2 效果链（effectEngine）

- 卡牌效果用**效果链数组**表达，由 `effectEngine.ts` 解析执行：
  ```ts
  // types/effect.ts
  type Effect =
    | { type: 'damage'; target: 'enemy' | 'allEnemies'; amount: number }
    | { type: 'block'; amount: number }
    | { type: 'draw'; count: number }
    | { type: 'applyStatus'; target: 'enemy' | 'self'; status: StatusId; amount: number }
    | { type: 'gainEnergy'; amount: number }
    | { type: 'exhaust' }
    | { type: 'addCard'; cardId: string; to: 'hand' | 'draw' | 'discard' | 'exhaust' }
    | { type: 'heal'; amount: number }
    | { type: 'loseHp'; amount: number }
  ```
- **新增效果类型时**：在 `effectEngine` 实现执行逻辑 + `tests/effectEngine.spec.ts` 补测试，禁止在组件里临时实现效果

### 5.3 数值规则（与 PRD §3.3.3 一致）

- 攻击伤害 = ⌊(基础 + 力量) × 易伤修正(×1.5，纸蛙×1.75) × 虚弱修正(×0.75，纸鹤×0.6) × 其他倍率⌋
- 格挡获得 = 基础 + 敏捷；结算顺序：伤害 → 扣格挡 → 扣血 → 触发受伤效果
- 状态规则以 PRD §3.3.6 为准；怪物意图循环以各图 `enemies.json` 的 `aiPattern` 为准

### 5.4 状态机与存档

- 全局状态流转用 `engine/stateMachine.ts`（MENU/RUN/BATTLE/REWARD/PAUSE/SETTLEMENT…），**禁止绕过状态机直接切换页面**
- 单局存档经 `saveSystem.ts`（版本号 + 损坏回退），localStorage 键 `sts2_run_v1`

---

## 6. 测试要求

- 框架：**Vitest**；测试文件放 `tests/`，命名 `*.spec.ts`
- **必须覆盖**：`combatEngine`（回合/伤害/能量）、`effectEngine`（每种效果类型）、`mapGenerator`（分支/固定楼层/概率/精英循环池）
- 新增效果类型、修复战斗 bug、改动地图生成时，**必须补/改对应测试**
- 提交前：`pnpm typecheck && pnpm lint && pnpm test` 全绿

---

## 7. Git 工作流

- **Conventional Commits**：
  ```
  feat(combat): 实现意图循环伤害结算
  fix(effect): 修复虚弱对多段攻击的重复计算
  refactor(map): 抽取 mapGenerator 独立模块
  test(effectEngine): 补充 draw 效果用例
  docs(prd): 更新奖励页面规格
  ```
- 分支：功能开发在 `feature/*` 分支，合入前跑全套检查
- 提交信息用中文描述功能点，格式 `type(scope): 描述`

---

## 8. 边界（三档权限）

### ✅ Always do（必须做）

- 改动后跑 `pnpm typecheck && pnpm lint && pnpm test`
- 新功能/新效果补测试；改动跨模块时同步更新相关测试
- 游戏数值/文本一律从 `data/*.json` 读取
- 组件用命名导出；TypeScript strict 下编写

### ⚠️ Ask first（先问再做）

- 新增 npm 依赖
- 修改引擎核心（`combatEngine` / `effectEngine` / `stateMachine` / `saveSystem`）
- 修改 `data/*.json` 或 `document/*.md` 的游戏数值（需与数据源核对）
- 涉及 PRD 范围之外的系统（药水/多人/其他角色/其他幕）
- 重构跨越 3 个以上模块

### 🚫 Never do（绝对禁止）

- 在引擎/组件中硬编码卡牌、遗物、敌人、事件的数值或文本
- 提交密钥、环境变量、个人信息
- 直接 push 到 `main`；跳过 lint/typecheck/test 提交
- 使用 `any` 绕过类型检查
- 修改 `document/` 原始数据文件来"顺手修 bug"（数据源用脚本生成 json，逻辑问题改代码）
- 擅自实现 MVP 范围外内容（药水、其他角色、多人模式等）

---

## 9. 美术资源与动画规范

> 详细占位清单与资源路径见 `document/PRD_v1.0.md` §5.4。本节的硬性约束必须与 PRD 一致，且**遵循数据驱动原则——图片路径/帧元数据一律走 `data/*.json`，禁止在组件里硬编码路径或帧数**。

### 9.1 资源目录

所有美术资源归入 `src/assets/` 对应子目录：`characters/`（角色立绘/头像/精灵图）、`enemies/`（怪物）、`relics/`（遗物图标）、`cards/`（卡牌背景）、`ui/`（通用图标）、`backgrounds/`（主界面/地图背景）。

### 9.2 引用方式（数据驱动）

- 图片引用统一走 `data/*.json` 的 `art` / `icon` 字段（卡牌背景由 `rarity` 自动选取，无需逐卡配置）。
- 组件读取字段后用 `<img :src>` 或 `new Image()` 加载，**路径与帧数全部来自数据，组件内不写死**。
- 缺失资源时降级占位（纯色块 + 文字/首字），保证无图也能跑通。

### 9.3 卡牌背景与边框（★简化约定）

- **统一灰色中性背景**，不区分稀有度/类型；通过**边框颜色**区分卡牌类别（边框色为 CSS `border-color`，无需图片资源）。
- 配色：战士普通=**红** / 无色=灰 / 衍生=灰 / 状态=灰 / 诅咒=**紫** / 事件=**绿**。（上表"颜色"均指**边框颜色**，背景本身统一为灰色。）
- **不做单卡插画**；组件按卡牌 `type`/`category` 推导边框色，背景统一用 `assets/cards/bg_card.png`（或 CSS 纯色）。
- **特殊：「感染」状态牌**使用**蠕动的蛆**动画背景（精灵图 `assets/cards/infection_sheet.png`，按 §9.4 元数据驱动但**循环播放**），由卡牌 `id === "infection"` 触发。
- 此方案取代原"稀有度三套背景"，稀有度如需体现可用角标/边框粗细叠加（可选，不强制）。

### 9.4 精灵图（Sprite Sheet）动画

角色/怪物的攻击、受击等动作**统一用精灵图**，不用独立多图（`atk_1..n.png`）方案。

- **布局**：每个动作打包为 1 张**横向帧条 PNG**，帧从左到右排列（首帧最左）；整图宽 = 单帧宽 × 帧数。命名 `{角色|敌人}/{动作}_sheet.png`（如 `warrior/atk_sheet.png`、`vantom/atk_sheet.png`）。
- **帧元数据**（存于对应 `data/*.json` 的 `art.animations`，不写死在组件）：

  ```json
  "art": {
    "portrait": "assets/enemies/vantom/portrait.png",
    "sprite": "assets/enemies/vantom/idle.png",
    "animations": {
      "attack": {
        "sheet": "assets/enemies/vantom/atk_sheet.png",
        "frameCount": 4,
        "frameWidth": 300,
        "frameHeight": 500,
        "fps": 12
      }
    }
  }
  ```

- **播放方式（二选一，均按元数据驱动）**：
  - CSS：`background-image` + `animation` 的 `steps(frameCount)` 平移 `background-position`，时长 = `frameCount / fps`。
  - Canvas：`ctx.drawImage(sheet, i*frameWidth, 0, frameWidth, frameHeight, x, y, w, h)` 配合 `requestAnimationFrame` 逐帧裁剪。
- **约定**：攻击动画**播放一次**后回到 `idle` 静态帧（非循环）；帧数/帧率以数据为准，换图只改尺寸 + `frameCount` 即可，逻辑无需改动；无对应精灵图时降级为静态 `idle.png` 或色块。

### 9.5 文字遮罩（卡牌可读性）

卡牌费用/名称/效果文字绘制于背景图**上层**；背景图在文字区域做**暗化/半透明蒙版**处理（CSS 或图片本身预留安全区），确保文字清晰可读。
