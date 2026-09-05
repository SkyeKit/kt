<script setup lang="ts">
/**
 * 篝火浮层（PRD §3.6）：休息（回复 30% 最大生命）/ 锻造（升级 1 张牌）
 * 锻造采用三态交互（需求）：
 *   menu   → 选择 休息 / 锻造
 *   grid   → 若选锻造：以卡组网格展示全部牌实例（已升级的置灰不可选），点击某张进入对比
 *   compare→ 中间对比：左=未升级卡，中=向右箭头，右=升级后卡；左下红色左箭头取消(回 grid)，
 *             右下绿色右箭头确认升级（仅升级所选那一张实例，同名卡互不影响）。
 */
import { computed, ref } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import { getCard } from '@/data'
import CardView from '@/components/common/CardView.vue'
import type { DeckCard } from '@/types'

const store = useGameStore()

// 篝火 `phase`：menu 动作选择 / grid 选卡 / compare 升级对比确认
const phase = ref<'menu' | 'grid' | 'compare'>('menu')
// 当前被选中准备升级的"牌组实例下标"（compare 阶段使用）
const pickIdx = ref(-1)

// 持有微型帐篷 → 允许在同一休息点连续完成多次动作（休息/锻造/挖掘/壶铃/烹饪后停留）再手动离开
const hasMiniTent = computed(() => store.run?.relics.includes('mini_tent') ?? false)
// 持有休息处专属遗物 → 展示对应额外选项按钮
const hasShovel = computed(() => store.run?.relics.includes('shovel') ?? false)
const hasKettlebell = computed(() => store.run?.relics.includes('kettlebell') ?? false)
const hasCleaver = computed(() => store.run?.relics.includes('cleaver') ?? false)
// 壶铃力量是否已达上限（3 次 = 9 点）
const kettlebellFull = computed(() => (store.run?.meta.kettlebellStrength ?? 0) >= 9)

// 牌组全部实例（含下标），供升级选择网格渲染
const deckGrid = computed<Array<{ index: number; entry: DeckCard }>>(() => {
  const r = store.run
  if (!r) return []
  return r.deck.map((entry, index) => ({ index, entry }))
})
// 是否还有未升级的牌（无可升级时提示）
const hasUpgradable = computed(() => deckGrid.value.some((g) => !g.entry.upgrade))

// 选择某张牌进入对比阶段（已升级的不可再选）
function openCompare(index: number): void {
  const en = store.run?.deck[index]
  if (!en || en.upgrade) return
  pickIdx.value = index
  phase.value = 'compare'
}

// 休息
function rest(): void {
  store.campfireRest()
  // 微型帐篷：休息后停留休息处，回到动作选择菜单以便继续其它动作
  if (hasMiniTent.value) phase.value = 'menu'
}
// 挖掘遗物（铲子）
function dig(): void {
  store.campfireDig()
  if (hasMiniTent.value) phase.value = 'menu'
}
// 举壶铃（壶铃）
function kettlebell(): void {
  store.campfireKettlebell()
  if (hasMiniTent.value) phase.value = 'menu'
}
// 烹饪（切肉刀）
function cook(): void {
  store.campfireCook()
  if (hasMiniTent.value) phase.value = 'menu'
}
// 离开休息处（微型帐篷：手动推进）
function leave(): void {
  store.leaveCampfire()
}
// 确认升级（绿色右箭头）：仅升级所选那一张牌实例
function confirmUpgrade(): void {
  if (pickIdx.value >= 0 && store.campfireSmith(pickIdx.value)) {
    // 微型帐篷：锻后停留休息处，回到动作菜单以便继续其它动作
    if (hasMiniTent.value) phase.value = 'menu'
  }
}
</script>

<template>
  <div class="campfire panel">
    <!-- 阶段一：动作选择（休息/锻造） -->
    <template v-if="phase === 'menu'">
      <h2 class="h-title">篝火</h2>
      <p class="cf-hint">温暖的火焰照亮了旅途。你可以在篝火旁休息或锻造。</p>
      <div class="cf-btns">
        <button class="btn btn-primary" @click="rest">休息（回复 30% 最大生命）</button>
        <button class="btn" @click="phase = 'grid'">锻造（升级 1 张牌）</button>
        <!-- 休息处专属遗物：铲子→挖掘遗物 / 壶铃→获得永久力量 / 切肉刀→烹饪 -->
        <button v-if="hasShovel" class="btn" @click="dig">挖掘遗物（铲子）</button>
        <button v-if="hasKettlebell" class="btn" :disabled="kettlebellFull" @click="kettlebell">
          举壶铃（获得力量）
        </button>
        <button v-if="hasCleaver" class="btn" @click="cook">烹饪（切肉刀）</button>
      </div>
      <!-- 微型帐篷：允许连续多次动作后手动离开 -->
      <button v-if="hasMiniTent" class="btn btn-leave" @click="leave">离开篝火</button>
    </template>

    <!-- 阶段二：选择要升级的卡（卡组网格，展示全部牌实例数据；已升级置灰） -->
    <template v-else-if="phase === 'grid'">
      <h2 class="h-title">锻造：选择要升级的卡牌</h2>
      <p class="cf-hint">点击一张卡牌查看升级前后对比。</p>
      <div class="cf-deck-grid">
        <div
          v-for="g in deckGrid"
          :key="`cf-${g.index}`"
          class="cf-tile"
          :class="{ disabled: g.entry.upgrade }"
          @click="openCompare(g.index)"
        >
          <!-- @select 接收 CardView 卡面点击（CardView 内部 @click.stop 拦截冒泡，外层 @click 收不到）；
               外层 .cf-tile 的 @click 兜底处理点击卡片 padding/边框区域 -->
          <CardView
            :card="getCard(g.entry.id)"
            :upgraded="g.entry.upgrade"
            :playable="false"
            @select="openCompare(g.index)"
          />
          <span v-if="g.entry.upgrade" class="cf-done">已升级</span>
        </div>
        <p v-if="!hasUpgradable" class="cf-none">没有可升级的卡牌</p>
      </div>
      <button class="btn" @click="phase = 'menu'">返回</button>
    </template>

    <!-- 阶段三：升级对比确认（左=未升级，中=→，右=升级后；左下红←取消，右下绿→确认） -->
    <template v-else-if="phase === 'compare'">
      <h2 class="h-title">锻造：升级确认</h2>
      <div class="cf-compare">
        <CardView :card="getCard(store.run?.deck[pickIdx]?.id ?? '')" :playable="false" />
        <span class="cf-arrow">→</span>
        <CardView
          :card="getCard(store.run?.deck[pickIdx]?.id ?? '')"
          :upgraded="true"
          :playable="false"
        />
      </div>
      <!-- 操作条：左下红色左箭头=取消(回选卡)，右下绿色右箭头=确认升级 -->
      <div class="cf-actions">
        <button class="act act-cancel" title="取消，返回选卡" @click="phase = 'grid'">←</button>
        <button class="act act-confirm" title="确认升级" @click="confirmUpgrade">→</button>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.campfire {
  min-width: 720px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: auto;
}
.cf-hint {
  font-size: 13px;
  color: var(--text-dim);
}
.cf-btns {
  display: flex;
  gap: 10px;
}
// 升级选卡网格：卡组界面（CardView），自动换行展示全部牌实例
.cf-deck-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  max-height: 60vh;
  overflow: auto;
}
.cf-tile {
  position: relative;
  cursor: pointer;
  transition: opacity 0.12s;
}
.cf-tile.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cf-done {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 10px;
  color: var(--text-dim);
  background: rgba(0, 0, 0, 0.55);
  border-radius: 3px;
  padding: 1px 5px;
}
.cf-none {
  color: var(--text-faint);
  font-size: 13px;
}
// 升级对比布局：左卡 + 中间右箭头 + 右升级卡
.cf-compare {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 12px 0;
}
.cf-arrow {
  font-size: 40px;
  color: var(--gold);
  font-weight: bold;
}
// 底部操作条：左下红←取消、右下绿→确认
.cf-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
}
.act {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  background: var(--bg-base);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.act-cancel {
  color: #e05a5a;
  border-color: #a43a3a;
}
.act-cancel:hover {
  border-color: #e05a5a;
}
.act-confirm {
  color: #6fce7f;
  border-color: #3d8a4c;
}
.act-confirm:hover {
  border-color: #6fce7f;
}
</style>
