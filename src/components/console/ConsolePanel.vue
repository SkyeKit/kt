<script setup lang="ts">
/**
 * 调试浏览器（替换原命令控制台）：左侧分类导航 + 右上角模糊搜索
 *   - 左侧导航自上而下：卡组 / 卡牌（角色=基础·普通·罕见·稀有 / 无色 / 状态 / 诅咒 / 事件 / 衍生）/ 遗物
 *   - 卡组卡牌：左键放大查看详情；右键菜单可「删除」或「升级（+）」
 *   - 全部卡牌（按分类分组）：左键查看详情；右键「加入牌组」获得
 *   - 全部遗物：左键查看详情；未拥有右键「获得（触发拾起效果）」、已拥有右键「移除」
 *   - 右上角搜索框：对全部卡牌/遗物按「名称 / id」模糊匹配，结果同样支持上方交互
 * 数据驱动：卡牌/遗物数据及文字均来自 src/data/*.json，组件不硬编码（agent.md §5.1）
 */
import { computed, ref } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import { cardsData, getCard, cardMap, relicMap } from '@/data'
import CardView from '@/components/common/CardView.vue'
import type { Card, Relic } from '@/types'

const store = useGameStore()

// ===== 左侧导航状态 =====
// 三态：卡组 / 具体某类卡牌（池 + 可选稀有度）/ 遗物
type NavState =
  | { kind: 'deck' }
  | { kind: 'cards'; pool: keyof typeof cardsData; rarity?: string }
  | { kind: 'relics' }
const nav = ref<NavState>({ kind: 'deck' })
// 「卡牌」分组是否展开（默认展开，便于浏览子分类）
const cardsOpen = ref(true)

// 卡牌子分类：角色卡（战士池）按稀有度再细分；其余池整池展示
type PoolKey = keyof typeof cardsData
interface CardSubNav {
  label: string
  pool: PoolKey
  rarity?: string // 有值时表示该子分类为「角色卡」的某稀有度细分
}
const cardSubNavs: CardSubNav[] = [
  { label: '角色·普通', pool: 'warrior', rarity: 'common' },
  { label: '角色·罕见', pool: 'warrior', rarity: 'uncommon' },
  { label: '角色·稀有', pool: 'warrior', rarity: 'rare' },
  { label: '无色卡', pool: 'colorless' },
  { label: '状态卡', pool: 'status' },
  { label: '诅咒卡', pool: 'curse' },
  { label: '事件卡', pool: 'eventCards' },
  { label: '衍生卡', pool: 'derived' },
]

// 切换到指定分类（供左侧导航项点击）
function select(s: NavState): void {
  nav.value = s
}
// 「卡牌」顶项处于"已选中某子分类"时不高亮（仅展开态）
// 类型守卫：只有 kind 为 'cards' 时才有 pool/rarity 字段
const hasSubSelected = computed(() => {
  if (nav.value.kind !== 'cards') return false
  return !!nav.value.pool
})

// 卡组卡牌：牌组实例数组（含重复副本与"升级+"标记）
const deckCards = computed<{ id: string; upgrade: boolean }[]>(() => store.run?.deck ?? [])

// 当前"卡牌"分类实际展示的卡：按池取数组，若有 rarity 则过滤该稀有度
const shownCards = computed<Card[]>(() => {
  if (nav.value.kind !== 'cards') return []
  // 局部引用当前分类（窄化后 nav.value 含 pool/rarity 字段，避免链式访问失策）
  const cur = nav.value
  const pool = cardsData[cur.pool] as Card[]
  return cur.rarity ? pool.filter((c) => c.rarity === cur.rarity) : pool
})

// ===== 全部遗物 & 已拥有标记 =====
const allRelics = computed(() => Array.from(relicMap.values()))
const ownedRelics = computed(() => new Set(store.run?.relics ?? []))

// ===== 右上角搜索（模糊匹配卡牌/遗物，按 name 或 id 包含） =====
const searchText = ref('')
const searching = computed(() => searchText.value.trim() !== '')
const matchedCards = computed<Card[]>(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return []
  return Array.from(cardMap.values()).filter(
    (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
  )
})
const matchedRelics = computed<Relic[]>(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return []
  return Array.from(relicMap.values()).filter(
    (r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
  )
})

// ===== 详情浮层（左键放大查看卡牌/遗物） =====
type Detail = { kind: 'card'; id: string; upgraded: boolean } | { kind: 'relic'; id: string }
const detail = ref<Detail | null>(null)
function closeDetail(): void {
  detail.value = null
}

// 稀有度 → 中文标签（卡牌详情展示）
const RARITY_NAME: Record<string, string> = {
  basic: '基础',
  common: '普通',
  uncommon: '罕见',
  rare: '稀有',
  ancient: '先古',
  colorless: '无色',
  status: '状态',
  curse: '诅咒',
  event: '事件',
  derived: '衍生',
}

// ===== 右键菜单：删除 / 升级 / 加入牌组 / 获得遗物 / 移除遗物 =====
interface CtxItem {
  label: string
  disabled?: boolean // true 时该项置灰不可点（如永恒牌删除、"已升级"卡升级）
  run: () => void
}
interface CtxMenu {
  x: number
  y: number
  items: CtxItem[]
}
const ctxMenu = ref<CtxMenu | null>(null)

// 打开右键菜单：记录鼠标坐标与动作项，并阻止浏览器默认菜单
function openMenu(e: MouseEvent, items: CtxItem[]): void {
  ctxMenu.value = { x: e.clientX, y: e.clientY, items }
  e.preventDefault()
}
function closeMenu(): void {
  ctxMenu.value = null
}
// 点击菜单项：先收起菜单，非禁用项再执行动作
function runCtxItem(item: CtxItem): void {
  closeMenu()
  if (!item.disabled) item.run()
}

// ===== 卡组卡牌交互 =====
// 右击卡组卡：提供「升级（+）/ 删除」。永恒牌删除项禁用；已升级卡升级项禁用
function onDeckCardCtx(e: MouseEvent, entry: { id: string; upgrade: boolean }): void {
  const r = store.run
  if (!r) return
  openMenu(e, [
    {
      label: '升级（+）',
      disabled: !!entry.upgrade,
      run: () => {
        // 升级仅作用于被右击的这张卡实例（其余同名卡不受影响，与篝火升级口径一致）
        r.deck[r.deck.indexOf(entry)]!.upgrade = true
      },
    },
    {
      label: '删除',
      disabled: store.isCardUnique(entry.id), // "永恒"牌不可移除
      run: () => {
        const i = r.deck.indexOf(entry)
        if (i >= 0) {
          r.deck.splice(i, 1)
          detail.value = null
        }
      },
    },
  ])
}

// 将一张卡加入牌组（全部卡牌页 / 搜索结果「加入牌组」动作）
function addToDeck(id: string): void {
  const r = store.run
  if (!r) return
  r.deck.push({ id, upgrade: false })
}

// 右击卡牌（全部卡牌页或搜索结果）：提供「加入牌组」获得动作
function onAllCardCtx(e: MouseEvent, id: string): void {
  openMenu(e, [{ label: '加入牌组', run: () => addToDeck(id) }])
}

// ===== 遗物交互 =====
// 右击遗物（全部遗物页或搜索结果）：统一提供「获得（触发拾起效果）」一项（含已拥有者）
function onRelicCtx(e: MouseEvent, id: string): void {
  const r = store.run
  if (!r) return
  const owned = ownedRelics.value.has(id)
  openMenu(e, [
    {
      // 已拥有时提示"已拥有"，仅作标记；未拥有时可直接获得
      label: owned ? '已拥有' : '获得（触发拾起效果）',
      disabled: owned, // 已拥有则置灰不可重复获得
      run: () => {
        if (owned) return
        // 先入库再触发 ON_PICKUP 拾起效果
        r.relics.push(id)
        store.addRelicPickup(id)
      },
    },
  ])
}
</script>

<template>
  <div class="console-panel">
    <!-- 顶栏：标题 + 右上角模糊搜索框 -->
    <header class="console-top">
      <span class="title">调试浏览</span>
      <input v-model="searchText" class="search" placeholder="模糊搜索卡牌 / 遗物…" />
    </header>

    <div class="console-layout">
      <!-- ===== 左侧分类导航 ===== -->
      <nav class="console-nav">
        <button
          class="nav-item"
          :class="{ active: !searching && nav.kind === 'deck' }"
          @click="select({ kind: 'deck' })"
        >
          卡组
        </button>

        <!-- 卡牌分组：点击展开/收起子分类 -->
        <button
          class="nav-item"
          :class="{ active: !searching && nav.kind === 'cards' && !hasSubSelected }"
          @click="cardsOpen = !cardsOpen"
        >
          卡牌 {{ cardsOpen ? '▾' : '▸' }}
        </button>
        <div v-show="cardsOpen" class="nav-children">
          <button
            v-for="sub in cardSubNavs"
            :key="sub.label"
            class="nav-item sub"
            :class="{
              active:
                !searching &&
                nav.kind === 'cards' &&
                nav.pool === sub.pool &&
                nav.rarity === sub.rarity,
            }"
            @click="select({ kind: 'cards', pool: sub.pool, rarity: sub.rarity })"
          >
            {{ sub.label }}
          </button>
        </div>

        <button
          class="nav-item"
          :class="{ active: !searching && nav.kind === 'relics' }"
          @click="select({ kind: 'relics' })"
        >
          遗物
        </button>
      </nav>

      <!-- ===== 右侧内容区 ===== -->
      <main class="console-main">
        <!-- 搜索结果：卡牌 + 遗物两块 -->
        <template v-if="searching">
          <div class="group-label">卡牌（{{ matchedCards.length }}）</div>
          <div v-if="matchedCards.length" class="grid">
            <div
              v-for="c in matchedCards"
              :key="c.id"
              class="cell"
              role="button"
              tabindex="-1"
              :title="c.name"
              @click.stop="detail = { kind: 'card', id: c.id, upgraded: false }"
              @contextmenu.stop="onAllCardCtx($event, c.id)"
            >
              <CardView :card="c" :upgraded="false" />
            </div>
          </div>
          <p v-else class="empty">无匹配卡牌</p>

          <div class="group-label">遗物（{{ matchedRelics.length }}）</div>
          <div v-if="matchedRelics.length" class="grid">
            <div
              v-for="rel in matchedRelics"
              :key="rel.id"
              class="relic-cell"
              role="button"
              tabindex="-1"
              :class="{ owned: ownedRelics.has(rel.id) }"
              :title="rel.name"
              @click.stop="detail = { kind: 'relic', id: rel.id }"
              @contextmenu.stop="onRelicCtx($event, rel.id)"
            >
              <span class="relic-name">{{ rel.name }}</span>
              <span class="relic-owner">{{ ownedRelics.has(rel.id) ? '✓ 已拥有' : '未拥有' }}</span>
            </div>
          </div>
          <p v-else class="empty">无匹配遗物</p>
        </template>

        <!-- ===== 卡组卡牌页 ===== -->
        <div v-else-if="nav.kind === 'deck'" class="grid">
          <p v-if="!deckCards.length" class="empty">卡组为空</p>
          <div
            v-for="(entry, i) in deckCards"
            :key="i"
            class="cell"
            role="button"
            tabindex="-1"
            :title="`${getCard(entry.id)?.name ?? entry.id}${entry.upgrade ? '+' : ''}`"
            @click.stop="detail = { kind: 'card', id: entry.id, upgraded: !!entry.upgrade }"
            @contextmenu.stop="onDeckCardCtx($event, entry)"
          >
            <CardView :card="getCard(entry.id)" :upgraded="!!entry.upgrade" />
            <span class="cell-tag"> {{ i + 1 }}{{ entry.upgrade ? '+' : '' }} </span>
          </div>
        </div>

        <!-- ===== 全部卡牌页（按当前分类） ===== -->
        <div v-else-if="nav.kind === 'cards'" class="grid">
          <p v-if="!shownCards.length" class="empty">该分类无卡牌</p>
          <div
            v-for="c in shownCards"
            :key="c.id"
            class="cell"
            role="button"
            tabindex="-1"
            :title="c.name"
            @click.stop="detail = { kind: 'card', id: c.id, upgraded: false }"
            @contextmenu.stop="onAllCardCtx($event, c.id)"
          >
            <CardView :card="c" :upgraded="false" />
          </div>
        </div>

        <!-- ===== 全部遗物页 ===== -->
        <div v-else-if="nav.kind === 'relics'" class="grid">
          <div
            v-for="rel in allRelics"
            :key="rel.id"
            class="relic-cell"
            role="button"
            tabindex="-1"
            :class="{ owned: ownedRelics.has(rel.id) }"
            :title="rel.name"
            @click.stop="detail = { kind: 'relic', id: rel.id }"
            @contextmenu.stop="onRelicCtx($event, rel.id)"
          >
            <span class="relic-name">{{ rel.name }}</span>
            <span class="relic-owner">{{ ownedRelics.has(rel.id) ? '✓ 已拥有' : '未拥有' }}</span>
          </div>
        </div>
      </main>
    </div>
  </div>

  <!-- ===== 详情浮层（左键放大查看卡牌/遗物） ===== -->
  <Teleport to="body">
    <div v-if="detail" class="overlay" @click.self="closeDetail">
      <div class="detail-card" @click.stop>
        <button class="detail-close" @click="closeDetail">✕</button>
        <template v-if="detail.kind === 'card'">
          <CardView :card="getCard(detail.id)" :upgraded="detail.upgraded" />
          <div class="detail-meta">
            <span
              >稀有度：{{
                RARITY_NAME[getCard(detail.id)?.rarity ?? ''] ?? getCard(detail.id)?.rarity
              }}</span
            >
            <span>ID：{{ detail.id }}</span>
          </div>
        </template>
        <template v-else>
          <div class="relic-big" :class="{ 'relic-owned': ownedRelics.has(detail.id) }">
            {{ relicMap.get(detail.id)?.name ?? detail.id }}
          </div>
          <div class="detail-meta">
            <span>稀有度：{{ relicMap.get(detail.id)?.rarity }}</span>
            <span v-if="relicMap.get(detail.id)?.pool"
              >所属池：{{ relicMap.get(detail.id)?.pool }}</span
            >
          </div>
          <p class="relic-desc">{{ relicMap.get(detail.id)?.desc }}</p>
        </template>
      </div>
    </div>
  </Teleport>

  <!-- ===== 右键菜单浮层 ===== -->
  <Teleport to="body">
    <div v-if="ctxMenu" class="ctx-mask" @click="closeMenu" @contextmenu.prevent="closeMenu">
      <div class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
        <button
          v-for="(item, i) in ctxMenu.items"
          :key="i"
          class="ctx-item"
          :class="{ disabled: item.disabled }"
          @click="runCtxItem(item)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.console-panel {
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-height: 86vh;
}

// 顶栏：标题居左，搜索框靠右（右上角）
.console-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.title {
  color: var(--gold);
  font-weight: bold;
  font-size: 14px;
  letter-spacing: 1px;
  flex-shrink: 0;
}
.search {
  margin-left: auto; // 把搜索框推到最右
  width: 220px;
  background: var(--bg-deep);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text-main);
  padding: 5px 9px;
  font-family: inherit;
}
.search:focus {
  outline: none;
  border-color: var(--gold);
}

// 布局：左侧导航 + 右侧内容
.console-layout {
  display: flex;
  gap: 10px;
  min-height: 0;
}

// 左侧导航
.console-nav {
  width: 112px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: auto;
  max-height: 52vh;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 6px;
  padding: 6px;
}
.nav-item {
  font-size: 13px;
  padding: 6px 8px;
  text-align: left;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-main);
  cursor: pointer;
  transition:
    background 0.1s,
    color 0.1s;
}
.nav-item:hover {
  background: rgba(201, 162, 39, 0.15);
}
.nav-item.active {
  background: rgba(201, 162, 39, 0.25);
  color: var(--gold);
}
.nav-item.sub {
  padding-left: 18px;
  font-size: 12px;
}
.nav-children {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

// 右侧内容区（滚动）
.console-main {
  flex: 1;
  overflow: auto;
  max-height: 52vh;
  min-height: 120px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 6px;
  padding: 10px;
}

// 卡牌网格
.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-content: flex-start;
}
.cell {
  --card-w: 88px;
  --card-h: 122px;
  position: relative;
  cursor: pointer;
}
.cell .card:hover {
  transform: none;
}
.cell-tag {
  position: absolute;
  bottom: -2px;
  right: -2px;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.6);
  color: var(--text-dim);
  padding: 1px 4px;
  border-radius: 3px;
}
.group-label {
  width: 100%;
  color: var(--gold);
  font-weight: bold;
  margin-top: 6px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 2px;
}
.empty {
  color: var(--text-dim);
}

// 遗物格
.relic-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 108px;
  padding: 8px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: border-color 0.1s;
}
.relic-cell:hover {
  border-color: var(--gold);
}
.relic-cell.owned {
  border-color: rgba(111, 206, 127, 0.7);
}
.relic-name {
  font-weight: bold;
  text-align: center;
  color: var(--text-main);
}
.relic-owner {
  font-size: 10px;
  color: var(--text-dim);
}

// ===== 详情浮层 =====
.overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: rgba(5, 4, 3, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
}
.detail-card {
  --card-w: 210px;
  --card-h: 292px;
  position: relative;
  background: rgba(14, 11, 9, 0.98);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-width: 260px;
  max-width: 92vw;
  max-height: 90vh;
  overflow: auto;
}
.detail-close {
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 14px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}
.detail-meta {
  font-size: 11px;
  color: var(--text-dim);
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}
.relic-big {
  font-size: 20px;
  font-weight: bold;
  color: var(--gold);
  text-align: center;
  border: 1px solid var(--gold);
  border-radius: 8px;
  padding: 18px;
  width: 100%;
}
.relic-big.relic-owned {
  color: #6fce7f;
  border-color: rgba(111, 206, 127, 0.7);
}
.relic-desc {
  color: var(--text-main);
  line-height: 1.7;
  max-width: 260px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 6px;
}

// ===== 右键菜单 =====
.ctx-mask {
  position: fixed;
  inset: 0;
  z-index: 950;
}
.ctx-menu {
  position: fixed;
  display: flex;
  flex-direction: column;
  min-width: 140px;
  background: rgba(20, 15, 12, 0.98);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
}
.ctx-item {
  font-size: 13px;
  padding: 8px 14px;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text-main);
  cursor: pointer;
}
.ctx-item:hover {
  background: rgba(201, 162, 39, 0.2);
}
.ctx-item.disabled {
  color: var(--text-faint);
  cursor: not-allowed;
  background: transparent;
}
</style>
