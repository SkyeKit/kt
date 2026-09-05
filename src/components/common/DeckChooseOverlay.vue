<script setup lang="ts">
/**
 * 全卡组选卡浮层：渲染 store 挂起的"按牌组实例选择"请求（activeDeckPick）。
 * 用于移除/变化/升级/附魔等需"指定某一张拷贝"的动作；与按候选卡 id 的 PickCardsModal 互补。
 * 两段式交互：
 *  ① 选卡阶段：点击一张牌选中、再次点击取消（toggle）；选满所需数量后自动进入确认页。
 *     选卡页不设底部 ✕/✓ 按钮。
 *  ② 确认页：居中展示已选牌（含升级态），底部 红色✕=返回选卡重选、绿色✓=真正结算。
 */
import { computed, ref, watch } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import { getCard } from '@/data'
import CardView from '@/components/common/CardView.vue'
import type { Card, DeckCard } from '@/types'

const store = useGameStore()

// 当前激活的选卡请求
const req = computed(() => store.activeDeckPick)
// 牌组全部实例（含升级态）与其下标，供网格渲染
const grid = computed<Array<{ index: number; entry: DeckCard }>>(() => {
  const r = store.run
  if (!r) return []
  return r.deck.map((entry, index) => ({ index, entry }))
})
// 可选（未选中）下标集合：由 store 依据 filter 计算
const selectable = computed(() => new Set<number>(store.activeDeckPickIndices))
const selectedSet = computed(() => new Set<number>(req.value?.results ?? []))
// 已选数量 / 需选数量
const pickedCount = computed(() => req.value?.results.length ?? 0)
// 是否处于确认页
const confirming = ref(false)
// 换请求（含结算后清空）时重置确认页
watch(
  () => req.value?.id,
  () => {
    confirming.value = false
  },
)

// 点击某张牌 toggle 选/取消；选满所需数量后自动进入确认页
function choose(index: number): void {
  // 可选(未选)或已选（用于取消）都可点击
  if (!selectable.value.has(index) && !selectedSet.value.has(index)) return
  store.confirmDeckPick(index)
  const cnt = req.value?.results.length ?? 0
  const need = req.value?.count ?? 0
  if (cnt >= need) confirming.value = true // 选满自动进确认页
}

// 确认页红✕：返回选卡页（保留已选，可取消重选）
function backToSelect(): void {
  confirming.value = false
}

// 确认页展示的已选牌（含升级态）
const confirmCards = computed<Array<{ card: Card | undefined; upgraded: boolean }>>(() => {
  const r = store.run
  const current = req.value
  if (!r || !current) return []
  return current.results.map((idx) => ({
    card: getCard(r.deck[idx]!.id),
    upgraded: r.deck[idx]!.upgrade,
  }))
})
</script>

<template>
  <div v-if="req" class="deck-overlay" @click.self="store.skipDeckPick()">
    <div class="deck-modal">
      <!-- ② 确认页：展示已选牌 + 红✕返回选卡 / 绿✓结算 -->
      <template v-if="confirming">
        <h3 class="deck-title">{{ req.title }}</h3>
        <p v-if="req.hint" class="deck-hint">{{ req.hint }}</p>
        <p class="deck-count">已选 {{ pickedCount }} 张</p>
        <div class="deck-grid">
          <div v-for="(item, i) in confirmCards" :key="`cf-${i}`" class="deck-tile selected">
            <CardView :card="item.card" :upgraded="item.upgraded" :playable="false" />
          </div>
          <p v-if="confirmCards.length === 0" class="deck-none">未选择卡牌</p>
        </div>
        <div class="deck-actions">
          <button class="act act-cancel" title="返回选卡" @click="backToSelect">
            <span>✕</span>
          </button>
          <button class="act act-confirm" title="确认并继续" @click="store.finishDeckPick()">
            <span>✓</span>
          </button>
        </div>
      </template>

      <!-- ① 选卡阶段：点击选/取消；选满自动进确认页（本页不设底部 ✕/✓ 按钮） -->
      <template v-else>
        <h3 class="deck-title">{{ req.title }}</h3>
        <p v-if="req.hint" class="deck-hint">{{ req.hint }}</p>
        <p class="deck-count">
          已选 {{ pickedCount }}/{{ req.count }}
          <span v-if="req.allowSkip">（可点空白处跳过）</span>
        </p>

        <!-- 卡组网格：显示全部牌实例（含升级态），不可选(永恒/已升级)的置灰 -->
        <div class="deck-grid">
          <div
            v-for="g in grid"
            :key="`dp-${g.index}`"
            class="deck-tile"
            :class="{
              selected: selectedSet.has(g.index),
              disabled: !selectable.has(g.index) && !selectedSet.has(g.index),
            }"
            @click="choose(g.index)"
          >
            <!-- @select 接收 CardView 卡面点击（CardView 内部 @click.stop 拦截冒泡，外层 @click 收不到），
                 点击卡面即选/取消；外层 .deck-tile 的 @click 兜底处理点击卡片 padding/边框区域 -->
            <CardView
              :card="getCard(g.entry.id)"
              :upgraded="g.entry.upgrade"
              :playable="false"
              @select="choose(g.index)"
            />
          </div>
          <p v-if="grid.length === 0" class="deck-none">牌组为空</p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.deck-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 8, 7, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60; // 高于商店/篝火等阶段浮层
}
.deck-modal {
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 16px;
  min-width: 320px;
  max-width: 78vw;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.deck-title {
  font-size: 16px;
  color: var(--text-main);
}
.deck-hint {
  font-size: 12px;
  color: var(--text-dim);
}
.deck-count {
  font-size: 12px;
  color: var(--gold);
}
.deck-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  overflow: auto;
}
.deck-tile {
  cursor: pointer;
  transition: opacity 0.12s;
}
.deck-tile.selected {
  transform: translateY(-4px);
}
.deck-tile.selected .card {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
.deck-tile.disabled {
  opacity: 0.4;
  pointer-events: none;
}
.deck-none {
  color: var(--text-faint);
  font-size: 13px;
}
.deck-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
}
// 红底白✕（返回选卡重选）、绿底白✓（确认结算）——遵循"红叉取消、绿勾确认"约定
.act {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  color: #fff;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  transition: filter 0.12s;
}
.act-cancel {
  background: #9c3b34; // 红底
}
.act-cancel:hover {
  filter: brightness(1.12);
}
.act-confirm {
  background: #2f8f4c; // 绿底
}
.act-confirm:hover {
  filter: brightness(1.12);
}
</style>
