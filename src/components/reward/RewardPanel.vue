<script setup lang="ts">
/**
 * 奖励浮层（PRD §3.3.7）：金币 → 药水占位 → 遗物（精英战）→ 卡牌 3 选 1
 * 导航：返回箭头（←）回战斗界面（已结算只读查看），前进箭头（→）去地图（未选卡默认跳过）
 * 兼容：先古之民（涅奥）遗物 3 选 1（kind = 'relic'）
 */
import { computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'

const store = useGameStore()
const reward = computed(() => store.pendingReward)

// 标题：遗物 = 先古之民选择，卡牌 = 战斗奖励
const title = computed(() => (reward.value?.kind === 'relic' ? '先古之民：选择遗物' : '战斗奖励'))

// 浮木遗物：持有且本奖励未重掷时，显示"重掷"按钮
const canReroll = computed(
  () =>
    reward.value?.kind === 'card' &&
    !!store.run?.relics.includes('flotsam') &&
    !(store.run?.meta.flotsamRerolled ?? false),
)

function chooseRelic(relicId: string): void {
  store.claimRelicReward(relicId)
}

// 卡牌奖励档位颜色类（白=普通、蓝=罕见、金=稀有），用于圆点与"卡牌奖励"标签着色
const tierMeta: Record<string, string> = {
  common: 'tier-common',
  uncommon: 'tier-uncommon',
  rare: 'tier-rare',
}
// 当前档位的颜色类（无档位或未知时返回空串，卡牌入口不显示颜色标）
const cardTier = computed(() => tierMeta[reward.value?.cardTier ?? ''] ?? '')
</script>

<template>
  <div class="reward panel">
    <h2 class="h-title">{{ title }}</h2>

    <!-- ① 金币：像卡牌奖励一样可点击领取，点击后行消失（金币已在奖励生成时入账） -->
    <button
      v-if="reward?.gold !== undefined"
      class="reward-row gold-btn"
      :class="{ 'claimed-hidden': reward.goldClaimed }"
      title="点击领取金币"
      @click="store.claimGold()"
    >
      <span class="gold-label">金币 +{{ reward.gold }}</span>
    </button>

    <!-- ③ 遗物（精英战必掉 1 件，展示区） -->
    <div
      v-if="
        reward?.kind === 'card' && reward.relics && reward.relics.length > 0 && reward.relics[0]
      "
      class="reward-row relic-row"
    >
      <span class="relic-got"
        >获得遗物：{{ reward.relics[0].name }} — {{ reward.relics[0].desc }}</span
      >
    </div>

    <!-- ④ 卡牌奖励：白/蓝/金档位可点击入口；领取后以 visibility:hidden 隐藏（保持方框高度不缩小） -->
    <div
      v-if="reward?.kind === 'card'"
      class="reward-row card-reward-row"
      :class="[cardTier, { 'claimed-hidden': reward.cardClaimed }]"
    >
      <button
        class="card-reward-btn"
        title="点击展开 3 张卡牌（3 选 1，点任意一张直接获得）"
        @click="store.openCardRewardChoice()"
      >
        <span class="tier-dot"></span>
        <span class="label">卡牌奖励</span>
      </button>
    </div>

    <!-- 先古之民：遗物 3 选 1 -->
    <div v-if="reward?.kind === 'relic'" class="reward-relics">
      <button
        v-for="relic in reward.relics"
        :key="relic.id"
        class="relic-option"
        @click="chooseRelic(relic.id)"
      >
        <span class="relic-name">{{ relic.name }}</span>
        <span class="relic-desc">{{ relic.desc }}</span>
      </button>
    </div>

    <!-- 导航：返回战斗（←）/ 前往地图（→）；未点"卡牌奖励"直接前进即视为跳过（PRD §3.3.7） -->
    <div v-if="reward?.kind === 'card'" class="reward-nav">
      <button class="btn nav-btn" title="返回战斗界面（只读）" @click="store.backToBattle()">
        ←
      </button>
      <button
        v-if="canReroll"
        class="btn nav-btn"
        title="浮木：重掷本次卡牌奖励"
        @click="store.rerollCardReward()"
      >
        重掷
      </button>
      <button
        class="btn btn-primary nav-btn"
        title="前往地图（跳过未领取的卡牌奖励）"
        @click="store.forwardToMap()"
      >
        →
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.reward {
  // 窄高矩形（竖长横短）：奖励从上到下竖列，每行是窄胶囊；限制不超过视口以防溢出
  width: 300px;
  min-width: 300px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px;
}
.reward-row {
  font-size: 14px;
}
// 可点击领取行（金币/卡牌奖励）：占满面板全宽，随面板变宽而拉宽
.gold-btn,
.card-reward-row {
  width: 100%;
}
// 行按钮通用：整行可点击；无右侧提示文字，内容水平居中
.gold-btn,
.card-reward-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: linear-gradient(180deg, var(--bg-raised), var(--bg-base));
  color: var(--text-main);
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  transition: border-color 0.12s;
}
.gold-btn:hover,
.card-reward-btn:hover {
  border-color: var(--gold);
}
// 已领取隐藏：visibility 而非移除 DOM，保留占位使奖励方框高度不随领取而缩小
.claimed-hidden {
  visibility: hidden;
  pointer-events: none;
}
.gold-label {
  color: var(--gold);
  font-weight: bold;
}
// 卡牌奖励档位颜色标（白=普通、蓝=罕见、金=稀有）+ 档位标签颜色
.tier-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--border-strong);
  flex-shrink: 0;
}
.card-reward-btn .label {
  font-weight: bold;
}
.tier-common .tier-dot {
  background: #d8d0c2; // 白
}
.tier-common .label {
  color: #f0ead9; // 白
}
.tier-uncommon .tier-dot {
  background: var(--blue); // 蓝
}
.tier-uncommon .label {
  color: var(--blue);
}
.tier-rare .tier-dot {
  background: var(--gold); // 金
}
.tier-rare .label {
  color: var(--gold);
}
.relic-row {
  color: var(--purple);
  font-size: 13px;
}
.reward-relics {
  display: flex;
  gap: 14px;
}
.relic-option {
  width: 170px;
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
.relic-option:hover {
  border-color: var(--gold);
}
.relic-name {
  font-size: 15px;
  color: var(--gold);
}
.relic-desc {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.5;
}
.reward-nav {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}
.nav-btn {
  min-width: 44px;
}
</style>
