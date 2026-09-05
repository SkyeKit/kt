# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## [LRN-20260904-001] correction

**Logged**: 2026-09-04T22:00:00+08:00
**Priority**: critical
**Status**: pending
**Area**: backend

### Summary
大量战士卡"效果不生效"的根因是数据层 effects 数组缺漏 + 引擎层机制钩子缺失，而非单个功能 bug。

### Details
用户报告荆棘、武装、无情猛攻、头槌、能力卡整体不生效。审计全部战士卡后确认：
1. **数据缺漏**：多张卡的 `effects`/`upgradeEffects` 只含主效果（伤害/格挡），漏掉 desc 中的副效果（武装缺"升级手牌"、头槌缺"弃牌→抽牌堆顶"、破灭缺"打抽牌堆顶牌"等）。
2. **被动能力卡被错误建模**：`type='power'` 的被动（"每当给予易伤时抽牌"等）写成了打出时一次性结算，且引擎无对应钩子。
3. **引擎机制缺失**：荆棘反伤、本回合临时属性/下张0费、战斗内升级手牌、弃牌→抽牌堆顶、玩家覆甲结算、"名字含打击"缩放等均无实现。
4. **系统性 AoE 双伤**：`cleave`/`thunderclap` 等 effects 同时含单目标+全体伤害，首个敌人被打 2 次。

### Suggested Action
分阶段修复：先修 D-1(AoE 重复) + 引擎基础机制(C1~C7) + 用户点名的卡，再批量补齐其余卡。为每个新效果类型补 effectEngine.spec 用例。

### Metadata
- Source: user_feedback
- Related Files: src/data/cards.json, src/engine/effectEngine.ts, src/engine/combatEngine.ts
- Tags: cards, effects, engine, data

---
## 2026-09-04 - 卡牌效果与 buff 不生效

**Category**: insight

用户报告角色卡和部分 buff 不生效：荆棘反伤、武装随机升级、无情猛攻下张攻击 0 费、能力卡无法使用、弃牌堆随机一牌放抽牌堆顶。根因可能是数据层 cards.json 的 effects 缺漏 + 引擎层钩子缺失。


## 2026-09-04 - 卡牌效果与被动能力卡修复（完成）

**Category**: best_practice

根因是数据层 cards.json 的 effects 缺漏/错误建模 + 引擎层被动钩子缺失。修复：新增 upgradeHand/moveDiscardToTop/nextAttackFree 三种效果类型；Ability卡被动钩子系统（回合开始/消耗/施加易伤/失去生命/获得格挡/腐化）用 ctx.powers Map 按卡 id 触发；荆棘反伤在 damage 分支统一结算。验证：typecheck + lint + 162 tests 全绿。


## 2026-09-04 - 全面审计 buff/状态结算

**Category**: insight

审计所有状态：confused/metallicize/energized/noDraw/illusion/slow/parasitic 无任何施加来源（死状态）。有来源但无结算的：armor(覆甲,宠物岩+永恒铠甲+护喉甲)、ritual(仪式,暗港念咒)、vigor(活力,附魔/暗港)。已修复：覆甲每回合开始转格挡+递减、仪式敌人回合开始加力量、活力攻击+层数后消耗。165 tests 通过。

