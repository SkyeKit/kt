# Errors

Command failures and integration errors.

---

## [ERR-20260829-001] stateMachine 非响应式

**Logged**: 2026-08-29T15:53:00+08:00
**Priority**: critical
**Status**: resolved
**Area**: frontend | tests

### Summary
开局点击地图节点"无法进入"、先古之民三选一不出现——根因是 `phase = computed(() => stateMachine.current)` 中 stateMachine 是普通类（非响应式），computed 缓存永不失效，阶段永远卡在首值。

### Error
用户反馈："开局未有先古之民的遗物三选一，无法进入节点"。
实际表现：enterNode 已执行、stateMachine.transition('BATTLE') 已调用，但 store.phase 仍是缓存的 'RUN'，App.vue 的阶段→路由 watch 不触发，界面无任何反应。

### Context
- `src/engine/stateMachine.ts`：`private phase: GamePhase = 'MENU'` + getter，纯逻辑无 Vue 依赖
- `src/stores/gameStore.ts`：`const phase = computed(() => stateMachine.current)` —— computed 依赖必须是响应式源，普通 getter 变化不触发重算
- 连带影响：RunView 浮层（REWARD/SHOP/EVENT/CAMPFIRE）判断 `store.phase` 全部失效

### Suggested Fix
stateMachine 增加 onChange 订阅，gameStore 用 `ref` 同步：
```ts
const phase = ref<GamePhase>(stateMachine.current)
stateMachine.onChange((p) => { phase.value = p })
```
已修复 + 新增 tests/gameStore.spec.ts（3 用例：首局普通节点→BATTLE、第 2 局先古三选一、选遗物解锁第 2 层）。

### Metadata
- Reproducible: yes
- Related Files: src/engine/stateMachine.ts, src/stores/gameStore.ts, src/tests/gameStore.spec.ts
- See Also: LRN-20260829-001
- Pattern-Key: reactive_state_machine_sync

### Resolution
- **Resolved**: 2026-08-29T15:55:00+08:00
- **Notes**: stateMachine 加 onChange 订阅 + store ref 同步；36 测试全绿

---
