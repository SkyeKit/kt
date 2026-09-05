<script setup lang="ts">
/**
 * 商店浮层（PRD §3.5）：购买卡牌/遗物/移除卡牌，离开后不可返回
 * 布局（按需求）：上方 6 张战士卡；下方 2 张无色卡（左侧）与遗物（右侧）；右下角为卡牌移除入口。
 * 交互：点击卡牌/遗物直接购买（点击处只显示价格，不显示独立购买按钮）；遗物悬停显示详情工具提示；
 *       左上角叉号离开商店（离开后不可返回）；右下角为卡牌移除入口，点开全卡组选卡界面（DeckChooseOverlay）
 *       从中选一张移除（展示全部牌实例，含升级态；"永恒"牌不可移）。
 */
import { computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import CardView from '@/components/common/CardView.vue'

const store = useGameStore()
const shop = computed(() => store.shopState)
const gold = computed(() => store.run?.gold ?? 0)

// 移除价格：基础价经会员卡折扣后的实际价
const removeCost = computed(() => (shop.value ? store.shopPriceOf(shop.value.removeCost) : 0))
// 移除剩余次数不足时禁止再移除
const canRemove = computed(() => (shop.value?.removeCount ?? 0) > 0)

// 点击卡牌/遗物直接购买（金币不足时置灰，点击无效）
function buyCardItem(i: number): void {
  store.buyCard(i)
}
function buyColorlessItem(i: number): void {
  store.buyColorless(i)
}
function buyRelicItem(i: number): void {
  store.buyRelic(i)
}
// 点击移除入口：弹出全卡组选卡界面（不满足条件时不弹）
function openRemove(): void {
  store.shopOpenRemove()
}
</script>

<template>
  <div v-if="shop" class="shop panel">
    <header class="shop-head">
      <h2 class="h-title">商店</h2>
      <!-- 离开商店按钮（红色按钮 + 白色叉号，置于右上角；离开后不可返回，金币余额在状态栏可见） -->
      <button class="shop-close" title="离开商店" @click="store.leaveShop()">×</button>
    </header>

    <!-- 主体：上排 6 张战士卡；下排与角色卡同区 无色卡 + 遗物 + 删卡 三者横向并排，均贴合摆放 -->
    <div class="shop-body">
      <!-- 上排：6 张战士卡（角色卡区，居中）；其中之一为 5 折特价卡（删除线原价 + 绿色折后价） -->
      <section class="warrior-area">
        <div class="cards-row">
          <div
            v-for="(item, i) in shop.cards"
            :key="i"
            class="shop-card"
            :class="{ disabled: gold < item.price }"
            @click="buyCardItem(i)"
          >
            <!-- 卡面点击 => CardView 的 select 事件（.card 上 @click.stop 已阻止冒泡，须经由事件购买） -->
            <CardView :card="item.card" @select="buyCardItem(i)" />
            <!-- 价格：特价卡显示原价(删除线)+绿色折后价；普通卡仅显示单价 -->
            <span class="price-tag">
              <template v-if="item.originalPrice">
                <s class="orig-price">{{ item.originalPrice }}</s>
                <b class="discount-price">{{ item.price }}</b>
              </template>
              <template v-else>{{ item.price }}</template>
            </span>
          </div>
        </div>
      </section>

      <!-- 下排：无色卡 + 遗物 + 删卡 三者在角色卡下方同排，均贴合摆放 -->
      <section class="lower-row">
        <!-- 无色卡：2 张 -->
        <div class="lower-block">
          <div class="cards-row">
            <div
              v-for="(item, i) in shop.colorless"
              :key="i"
              class="shop-card"
              :class="{ disabled: gold < item.price }"
              @click="buyColorlessItem(i)"
            >
              <CardView :card="item.card" @select="buyColorlessItem(i)" />
              <span class="price-tag">{{ item.price }}</span>
            </div>
          </div>
        </div>

        <!-- 遗物：3 件 -->
        <div class="lower-block">
          <div class="relics-row">
            <button
              v-for="(item, i) in shop.relics"
              :key="i"
              class="relic-item"
              :class="{ disabled: gold < item.price }"
              @click="buyRelicItem(i)"
            >
              <span class="relic-name">{{ item.relic.name }}</span>
              <span class="relic-price">{{ item.price }}</span>
              <!-- 悬停详情工具提示：名称 + 完整效果描述 -->
              <div v-if="item.relic" class="relic-tip">
                <strong>{{ item.relic.name }}</strong>
                <span>{{ item.relic.desc }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- 删卡功能：与无色卡、遗物同排（角色位置），点击弹出全卡组选卡界面 -->
        <div class="lower-block remove-block">
          <button
            class="remove-trigger"
            :class="{ disabled: !canRemove }"
            :disabled="!canRemove"
            title="移除一张牌组中的卡牌"
            @click="openRemove"
          >
            <!-- 圆形 + 卡牌形状图标（内嵌一张迷你卡，斜线表示删除） -->
            <span class="remove-card-icon">
              <span class="remove-card-deco"></span>
            </span>
          </button>
          <!-- 移除价格：悬于图标下方 -->
          <span class="remove-price">{{ removeCost }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 商店主面板：固定宽高，背景恒定不随内容伸缩；内容区自身滚动
// 本版扩大商店背景（1400px 宽），容纳上方 6 张战士卡 + 下方 2 张无色卡/遗物/删卡/药水预留
.shop {
  width: 1400px;
  max-width: 96vw;
  height: 78vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
  padding-bottom: 16px;
}
.shop-head {
  display: flex;
  align-items: center;
  justify-content: space-between; // 标题在左、关闭按钮推到右侧
  gap: 12px;
}
// 右上角"离开商店"按钮：红色按钮 + 白色叉号（离开后不可返回）
.shop-close {
  width: 34px;
  height: 34px;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--accent); // 红色底
  color: #fff; // 白色叉号
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
}
.shop-close:hover {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
}
.shop-sec {
  font-size: 14px;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
  margin-top: 6px;
}
// 卡牌行（上方战士卡 / 下方无色卡共用）：居中排列，消除右侧留空
.cards-row {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  justify-content: center;
}
.shop-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.shop-card.disabled .card {
  opacity: 0.45;
  cursor: not-allowed;
}
// 价格标：卡牌/遗物/移除入口统一用金色数字；价格区横向排列以容纳 原价+折后价
.price-tag {
  color: var(--gold);
  font-weight: bold;
  font-size: 13px;
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}
// 特价原价：灰色 + 删除线，表示原价已被打折（下方另有绿色折后价）
.orig-price {
  color: var(--text-faint);
  font-weight: normal;
  text-decoration: line-through;
}
// 打折后的价格：绿色高亮，区别于普通金色价
.discount-price {
  color: #58c46a;
  font-size: 14px;
}
// 主体纵向布局：上排战士卡满宽、下排 无色卡+遗物+删卡 三者同排贴合
.shop-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
// 上排：6 张战士卡贴合占满
.warrior-area {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
// 下排：无色卡 / 遗物 / 删卡 三者在角色卡下方横向并排，均贴合（不再拉伸占位）
.lower-row {
  display: flex;
  gap: 36px;
  align-items: flex-start;
  flex-wrap: wrap;
  justify-content: center;
}
.lower-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
// 卡牌移除入口：圆形按钮 + 卡牌形状图标，与无色卡/遗物同排（角色位置）居中对齐
.remove-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.remove-trigger {
  width: 88px; // 圆形直径
  height: 88px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  background: var(--bg-raised);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.remove-trigger:hover:not(:disabled) {
  border-color: var(--gold);
}
.remove-trigger.disabled,
.remove-trigger:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
// 圆形内嵌"卡牌形状"图标：一张迷你卡，右上角带斜删除线表示"移除"
.remove-card-icon {
  position: relative;
  width: 46px;
  height: 62px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: linear-gradient(180deg, var(--bg-card), var(--bg-base));
}
.remove-card-deco {
  position: absolute;
  top: 8px;
  left: 10px;
  width: 26px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-strong);
}
.remove-card-deco::before {
  content: '';
  position: absolute;
  top: 10px;
  left: 0;
  width: 26px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-strong);
}
// 表示"删除"的斜线：从卡片左上斜向右下
.remove-card-icon::after {
  content: '';
  position: absolute;
  left: -2px;
  right: -2px;
  top: 50%;
  height: 2px;
  background: var(--accent); // 红色删除线
  transform: rotate(-18deg);
}
.remove-price {
  color: var(--gold);
  font-weight: bold;
  font-size: 14px;
}
// 遗物行：横向并排展示多件遗物（居中，配合整体居中布局）
.relics-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}
// 遗物：悬停高亮 + 右上位置显示价格，hover 弹出详情
.relic-item {
  position: relative;
  padding: 10px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg-raised);
  color: var(--text-main);
  font-family: inherit;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  cursor: pointer;
  min-width: 90px;
}
.relic-item:hover {
  border-color: var(--gold);
}
.relic-item.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.relic-name {
  color: var(--gold);
}
.relic-price {
  font-size: 12px;
  color: var(--gold);
  font-weight: bold;
}
// 遗物悬停详情：覆盖于商品下方，含名称与完整描述
.relic-tip {
  display: none;
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  width: 220px;
  padding: 10px;
  background: var(--bg-deep);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.6);
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-main);
  text-align: left;
}
.relic-item:hover .relic-tip {
  display: flex;
}
.relic-tip strong {
  color: var(--gold);
}

// 移除选择弹层：覆盖在商店上，内部为牌组卡牌网格
.remove-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 8, 7, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.remove-modal {
  max-width: 88vw;
  max-height: 82vh;
  overflow: auto;
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.remove-title {
  color: var(--gold);
  font-size: 16px;
}
.deck-grid {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}
// 牌组卡格：展示卡牌名称（兜底显示 id），"永恒"牌置灰并禁点
.deck-tile {
  width: 120px;
  height: 72px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: linear-gradient(180deg, var(--bg-card), var(--bg-base));
  color: var(--text-main);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  word-break: break-all;
}
.deck-tile:hover:not(:disabled) {
  border-color: var(--gold);
  color: var(--gold);
}
.deck-tile.eternal,
.deck-tile:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
</style>
