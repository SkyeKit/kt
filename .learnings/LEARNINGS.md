## [LRN-20260829-001] correction

**Logged**: 2026-08-29T15:40:00+08:00
**Priority**: critical
**Status**: resolved
**Area**: frontend | data

### Summary

STS2 复刻项目首次交付时，涅奥遗物池（先古之民开局三选一）30 件数据被我**凭空编造**（打刀/幸运硬币/熔岩灯/花镜/涅奥之泪/碎梦/先祖碎片等 18 件不在 PRD/relic.md 的涅奥池中），导致"刚开始的先古之民就有问题"。

### Details

根因：parse-relics.mjs 的 RELIC_META 中涅奥池条目是我凭 STS1 记忆+想象写的，没有对照 `document/PRD_v1.0.md §3.1` 或 `document/relic.md 四·先古之民·涅奥` 的真实 30 件清单。PRD 真实池：奥术卷轴/白银熔炉/沉重石板/橙型香盒/钓鱼竿/轰鸣海螺/华美发束/金色珍珠/精准剪刀/巨大卷轴⚠️/巨大扭蛋/卷轴箱/涅奥的护符/涅奥的苦痛/涅奥骨骰/铅制镇纸/熔岩石/失物盒⚠️/石炉加湿器/树叶药膏/松动羊毛剪/万花筒⚠️/小型扭蛋/新叶/药瓶皮套⚠️/营养牡蛎/羽翼之靴/诅咒珍珠/寻龙尺/涅奥的牺牲⚠️（剔除 5 件→25 件可用）。
另：PRD §3.1 规定涅奥**自第 2 局起**触发，首局第 1 层为普通节点——首版实现每次开局都触发，同样违反 PRD。

### Suggested Action

- 游戏数据类代码（ID 映射/数值表）**必须逐条对照数据源文件**（document/*.md），禁止凭记忆/想象生成
- 完工交付前做一次"PRD ↔ 实现"逐节核对（§3.1~§3.13），输出偏差清单
- 已经修正：重写 RELIC_META 涅奥池 30 件 + 首局不触发涅奥逻辑 + 地图权重（40/15/20/10/15）+ 未知房内部概率（85/10/3/2）+ 奖励质量分级 + 精英/Boss 遗物掉落 + 回合结束清空手牌

### Metadata

- Source: user_feedback
- Related Files: src/scripts/parse-relics.mjs, src/config/gameConfig.ts, src/stores/gameStore.ts, src/engine/mapGenerator.ts
- Tags: data_integrity, prd_compliance, neow
- Pattern-Key: data_authority.md_must_be_source_of_truth

---
## [LRN-20260829-002] correction

**Logged**: 2026-08-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
战斗界面首版完全偏离 ui.md/PRD §5.2 布局；且 playCard 未从手牌移除卡牌导致"卡牌可重复使用"。

### Details
- playCard 只做了扣费/结算/进弃牌堆，漏了 `ctx.hand` 移除 → 手牌渲染不变化，同一张牌可反复打出。
- 目标选择缺失：出牌固定打第一个敌人，违背 PRD §3.3.2（拖拽/箭头指定目标；单怪自动）。
- UI 布局未按 document/ui.md 的线框图（顶部状态栏/遗物栏/左玩家右怪物/底部能量-抽牌堆-手牌-弃牌堆）。

### Suggested Action
- 打出牌必须从手牌移除（splice 一张）——已修 + 回归测试。
- 目标选择：点击卡牌→敌人高亮可点→指定目标；单怪自动用。已实现（点击式，拖拽+箭头留作后续）。
- 战斗布局按 ui.md 重做：顶部栏/遗物栏/战场左右/底部能量-牌堆-手牌。已完成。
- 经验：UI 交付前先把 PRD §5.2 + ui.md 布局转成组件结构清单再动手，避免"完全不符"。

### Metadata
- Source: user_feedback
- Related Files: src/engine/combatEngine.ts, src/views/BattleView.vue, src/components/common/EnemyView.vue
- Tags: battle_ui, hand_management, targeting
- Pattern-Key: verify_ui_layout_spec_before_build

---
