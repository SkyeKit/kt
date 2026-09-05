<script setup lang="ts">
/**
 * 主菜单 · 数据浏览器（PRD §3.10 控制台-只读浏览）
 * 只读展示全部卡牌 / 遗物 / 附魔数据（名称/费用/类型/稀有度/文字描述/升级效果/关键词）。
 * 数据全部来自 data/*.json（agent.md §5.1 数据驱动），组件不做任何硬编码。
 */
import { ref } from 'vue'
import { cardsData, relicsData, enchantmentsData } from '@/data'
import type { Card, Relic } from '@/types'

// 当前浏览分页：'cards' 卡牌 / 'relics' 遗物 / 'enchs' 附魔
const tab = ref<'cards' | 'relics' | 'enchs'>('cards')

// 稀有度 → 中文（用于展示）
const RARITY_ZH: Record<string, string> = {
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

// 卡牌按池分组展示（顺序 = 数据文件各池）
const cardGroups: Array<{ label: string; list: Card[] }> = [
  { label: '战士卡', list: cardsData.warrior },
  { label: '无色卡', list: cardsData.colorless },
  { label: '状态牌', list: cardsData.status },
  { label: '诅咒牌', list: cardsData.curse },
  { label: '事件卡', list: cardsData.eventCards },
  { label: '衍生卡', list: cardsData.derived },
]

// 遗物按池分组展示
const relicGroups: Array<{ label: string; list: Relic[] }> = [
  { label: '先古·涅奥', list: relicsData.neowPool },
  { label: '战士遗物', list: relicsData.warrior },
  { label: '通用遗物', list: relicsData.general },
  { label: '先古·其余', list: relicsData.ancient },
  { label: '静默猎手', list: relicsData.silent },
  { label: '储君', list: relicsData.juggler },
  { label: '亡灵契约师', list: relicsData.religion },
  { label: '故障机器人', list: relicsData.robomancer },
]
</script>

<template>
  <div class="browser">
    <!-- 分页切换 -->
    <div class="browser-tabs">
      <button class="btn tab-btn" :class="{ active: tab === 'cards' }" @click="tab = 'cards'">
        卡牌
      </button>
      <button class="btn tab-btn" :class="{ active: tab === 'relics' }" @click="tab = 'relics'">
        遗物
      </button>
      <button class="btn tab-btn" :class="{ active: tab === 'enchs' }" @click="tab = 'enchs'">
        附魔
      </button>
    </div>

    <!-- 卡牌浏览 -->
    <div v-if="tab === 'cards'" class="browser-scroll">
      <section v-for="g in cardGroups" :key="g.label" class="browser-group">
        <h4 class="group-title">{{ g.label }}（{{ g.list.length }}）</h4>
        <div v-for="c in g.list" :key="c.id" class="browser-row">
          <span class="row-main">
            <b>{{ c.name }}</b>
            <span class="row-id">{{ c.id }}</span>
          </span>
          <span class="row-meta">
            费用 {{ c.cost ?? '—' }} · {{ c.type }} · {{ RARITY_ZH[c.rarity] }}
          </span>
          <span v-if="c.keywords.length" class="row-kw">{{ c.keywords.join('/') }}</span>
          <p class="row-desc">{{ c.desc }}</p>
          <p v-if="c.upgradeDesc" class="row-desc up">升级：{{ c.upgradeDesc }}</p>
        </div>
      </section>
    </div>

    <!-- 遗物浏览 -->
    <div v-else-if="tab === 'relics'" class="browser-scroll">
      <section v-for="g in relicGroups" :key="g.label" class="browser-group">
        <h4 class="group-title">{{ g.label }}（{{ g.list.length }}）</h4>
        <div v-for="re in g.list" :key="re.id" class="browser-row">
          <span class="row-main">
            <b>{{ re.name }}</b>
            <span class="row-id">{{ re.id }}</span>
            <span v-if="re.excluded" class="row-tag">排除</span>
          </span>
          <p class="row-desc">{{ re.desc }}</p>
        </div>
      </section>
    </div>

    <!-- 附魔浏览 -->
    <div v-else class="browser-scroll">
      <section class="browser-group">
        <h4 class="group-title">全部附魔（{{ enchantmentsData.enchantments.length }}）</h4>
        <div v-for="en in enchantmentsData.enchantments" :key="en.id" class="browser-row">
          <span class="row-main">
            <b>{{ en.name }}</b>
            <span class="row-id">{{ en.id }}</span>
          </span>
          <p class="row-desc">{{ en.desc }}</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.browser {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 720px;
  max-width: 92vw;
  height: 100%;
  min-height: 0;
}
.browser-tabs {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.tab-btn {
  font-size: 14px;
  padding: 6px 16px;
}
.tab-btn.active {
  border-color: var(--accent-strong);
  color: var(--accent-strong);
}
.browser-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-right: 6px;
}
.browser-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.group-title {
  color: var(--gold);
  font-size: 14px;
  margin: 0;
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
}
.browser-row {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.row-id {
  color: var(--text-faint);
  font-size: 11px;
}
.row-tag {
  color: var(--accent-strong);
  font-size: 11px;
  border: 1px solid var(--accent);
  border-radius: 3px;
  padding: 0 5px;
}
.row-meta {
  color: var(--text-dim);
  font-size: 12px;
}
.row-kw {
  color: var(--accent);
  font-size: 11px;
}
.row-desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-main);
  line-height: 1.5;
}
.row-desc.up {
  color: var(--gold);
}
</style>
