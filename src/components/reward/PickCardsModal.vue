<script setup lang="ts">
/**
 * 通用选牌浮层（ON_PICKUP 遗物/事件"从 N 张中选 1"，PRD §3.1 先古之民）
 * 由 store.pendingPicks 队列驱动：读取队首请求渲染候选，玩家选择后调用 store.resolvePick/skipPick 回传。
 * 采用两段式交互：
 *  ① 选卡阶段：点击一张卡选中、再次点击取消（toggle）；选满所需数量后自动切到确认页。
 *  ② 确认页：居中展示已选卡；底部 红色按钮(白✕)=返回选卡页重选、绿色按钮(白✓)=真正结算(下一步)。
 * 支持两种模式：
 *  - mode='cards'：候选单卡（CardView 展示）；count=1 选 1 张，count>1 多选后自动进确认页
 *  - mode='packs'：候选卡包（每包多张），点击选包 → 确认页展示该包 → 绿勾整包加入
 * 不依赖 phase，独立全屏浮层（拾取可能发生在任意阶段），z-index 高于地图/奖励浮层。
 */
import { computed, ref, watch } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import type { Card } from '@/types'

const store = useGameStore()
// 当前选牌请求（队首；链式多轮在 resolve 后自动展示下一项）
const pick = computed(() => store.pendingPicks[0] ?? null)
// 多选模式下已选中的卡 id 集合（Set 天然去重，同 id 只能选一张）
const selected = ref<Set<string>>(new Set())
// 卡包模式：已选包的索引（null=未选）
const packIndex = ref<number | null>(null)
// 是否处于"确认页"（选满 count 后自动切入）
const confirming = ref(false)

// 每轮选牌请求切换时清空已选与确认状态（避免上一轮残留）
watch(
  () => pick.value?.id,
  () => {
    selected.value.clear()
    packIndex.value = null
    confirming.value = false
  },
)

// 需选总数：cards 模式=count，packs 模式固定选 1 包
const needCount = computed(() => (pick.value?.mode === 'packs' ? 1 : (pick.value?.count ?? 1)))

// 选卡阶段：点击选/取消（再次点击取消选择）
function choose(cardId: string): void {
  if (!pick.value) return
  // 免确认（confirmless，战斗奖励三选一）：点任意一张立即结算，无需进确认页
  if (pick.value.confirmless && needCount.value === 1) {
    store.resolvePick(pick.value.id, [cardId])
    selected.value.clear()
    packIndex.value = null
    confirming.value = false
    return
  }
  if (selected.value.has(cardId)) selected.value.delete(cardId)
  else selected.value.add(cardId)
  // 选满所需数量后自动进入确认页（含单卡 count=1：点选即进）
  if (selected.value.size >= needCount.value) confirming.value = true
}

// 卡包模式：点击某包选中，进入确认页展示该包
function choosePack(index: number): void {
  if (!pick.value) return
  packIndex.value = index
  confirming.value = true
}

// 确认页：红✕ 返回选卡页（保留已选，可取消重选）
function backToSelect(): void {
  confirming.value = false
}

// 确认页：绿✓ 执行下一步（真正结算）——把最终选择回传给 store
function confirm(): void {
  if (!pick.value) return
  if (pick.value.mode === 'packs') {
    // 卡包模式回传包索引字符串；未选时回传空
    store.resolvePick(pick.value.id, packIndex.value != null ? [String(packIndex.value)] : [])
  } else {
    // 单卡/多卡：回传所选卡 id 数组
    store.resolvePick(pick.value.id, [...selected.value])
  }
  selected.value.clear()
  packIndex.value = null
  confirming.value = false
}

// 跳过当前选牌（allowSkip 时在选卡页显示）
function skip(): void {
  if (!pick.value) return
  store.skipPick(pick.value.id)
  selected.value.clear()
}

// 确认页展示的卡列表：cards 模式=已选候选卡；packs 模式=所选包内全部卡
const confirmCardList = computed<Card[]>(() => {
  if (!pick.value) return []
  if (pick.value.mode === 'packs') {
    return packIndex.value != null ? (pick.value.packs?.[packIndex.value]?.cards ?? []) : []
  }
  const out: Card[] = []
  for (const c of pick.value.cards ?? []) {
    if (c && selected.value.has(c.id)) out.push(c)
  }
  return out
})
</script>

<template>
  <div v-if="pick" class="pick-overlay">
    <div class="pick-modal">
      <!-- ② 确认页：居中展示已选卡，底部 红✕返回 / 绿✓执行 -->
      <template v-if="confirming">
        <h2 class="pick-title">{{ pick.mode === 'packs' ? '确认卡包' : '确认选择' }}</h2>
        <p v-if="pick.hint" class="pick-hint">{{ pick.hint }}</p>
        <div class="pick-cards">
          <CardView
            v-for="card in confirmCardList"
            :key="card?.id"
            :card="card"
            :playable="false"
          />
        </div>
        <div class="confirm-actions">
          <button class="act act-cancel" title="返回选卡" @click="backToSelect">
            <!-- 白色叉号：返回选卡页重新选择 -->
            <span>✕</span>
          </button>
          <button class="act act-confirm" title="确认并继续" @click="confirm">
            <!-- 白色勾号：执行下一步 -->
            <span>✓</span>
          </button>
        </div>
      </template>

      <!-- ① 选卡阶段：点击选/取消；选满自动进确认页 -->
      <template v-else>
        <h2 class="pick-title">{{ pick.title }}</h2>
        <p v-if="pick.hint" class="pick-hint">{{ pick.hint }}</p>

        <!-- 候选单卡（CardView 复用卡面展示） -->
        <div v-if="pick.mode === 'cards'" class="pick-cards">
          <CardView
            v-for="card in pick.cards"
            :key="card?.id"
            :card="card"
            :selected="selected.has(card?.id ?? '')"
            :playable="true"
            @select="choose(card?.id ?? '')"
          />
        </div>

        <!-- 候选卡包（点击选中整包） -->
        <div v-else class="pick-packs">
          <button
            v-for="(pack, i) in pick.packs"
            :key="i"
            class="pack-option"
            @click="choosePack(i)"
          >
            <span class="pack-label">{{ pack.label }}</span>
            <span class="pack-cards">{{ pack.cards.map((c) => c.name).join('、') }}</span>
            <span class="pack-add">选择此包</span>
          </button>
        </div>

        <!-- 选卡页操作：多选进度 + 可跳过 -->
        <div class="pick-actions">
          <span v-if="pick.mode === 'cards' && needCount > 1" class="pick-hint">
            已选 {{ selected.size }}/{{ needCount }}
          </span>
          <button v-if="pick.allowSkip" class="btn" @click="skip">跳过</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 全屏遮罩：独立于阶段浮层，始终置顶供任意时机弹选牌
.pick-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 8, 7, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.pick-modal {
  min-width: 560px;
  max-width: 90vw;
  max-height: 86vh;
  overflow: auto;
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.pick-title {
  color: var(--gold);
  font-size: 18px;
}
.pick-hint {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.5;
  text-align: center;
}
.pick-cards {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  flex-wrap: wrap;
  justify-content: center;
}
// 卡包候选：整包卡片，悬停高亮
.pick-packs {
  display: flex;
  gap: 16px;
}
.pack-option {
  width: 200px;
  padding: 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: linear-gradient(180deg, var(--bg-raised), var(--bg-base));
  color: var(--text-main);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: inherit;
}
.pack-option:hover {
  border-color: var(--gold);
}
.pack-label {
  font-size: 15px;
  color: var(--gold);
  font-weight: bold;
}
.pack-cards {
  font-size: 12px;
  color: var(--text-main);
  line-height: 1.6;
}
.pack-add {
  font-size: 12px;
  color: var(--accent-strong);
}
.pick-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
// 确认页底部：红色按钮+白✕（返回）、绿色按钮+白✓（执行）——红叉取消、绿勾确认约定
.confirm-actions {
  display: flex;
  gap: 48px;
  align-items: center;
  margin-top: 8px;
}
.act {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  border: none;
  font-size: 28px;
  font-family: inherit;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
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
