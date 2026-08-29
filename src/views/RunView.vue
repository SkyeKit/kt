<script setup lang="ts">
/**
 * 单局主视图（PRD §3.2）：密林幕 17 层地图 + 商店/篝火/事件/奖励浮层
 * 顶部显示 SingleRunStatusBar（角色基础信息 + 遗物栏，含卡组/菜单弹窗）
 * 节点类型按颜色/图标区分；锁定节点不可点击
 */
import { useGameStore } from '@/stores/gameStore'
import { useMap, NODE_TYPE_NAME } from '@/composables/useMap'
import SingleRunStatusBar from '@/components/common/SingleRunStatusBar.vue'
import type { MapNode } from '@/types'

const store = useGameStore()
const { floors, isEnterable } = useMap()

// 节点类型 → 颜色类名
const typeClass = (t: string): string => `node-${t}`

// 进入节点
function onNodeClick(node: MapNode): void {
  if (!isEnterable(node)) return
  node.visited = true
  store.enterNode(node.id)
}

// 浮层显隐由阶段驱动
const showOverlay = (phase: string): boolean => store.phase === phase
</script>

<template>
  <div class="run-view">
    <!-- 顶部：单局状态栏（HP/金币/药水/层数 + 遗物 + 卡组/菜单） -->
    <SingleRunStatusBar />

    <!-- 地图：楼层自下而上（1 层在下） -->
    <div class="map">
      <div v-for="(row, idx) in [...floors].reverse()" :key="idx" class="map-floor">
        <span class="floor-no">{{ row[0]!.floor }}</span>
        <div class="floor-nodes">
          <button
            v-for="node in row"
            :key="node.id"
            class="map-node"
            :class="[
              typeClass(node.type),
              {
                locked: node.locked,
                visited: node.visited,
                current: node.id === store.run?.nodeId,
              },
            ]"
            :disabled="node.locked || node.visited"
            @click="onNodeClick(node)"
          >
            {{ NODE_TYPE_NAME[node.type] }}
          </button>
        </div>
      </div>
    </div>

    <!-- 阶段浮层 -->
    <div v-if="showOverlay('REWARD')" class="overlay">
      <RewardPanel />
    </div>
    <div v-if="showOverlay('EVENT')" class="overlay">
      <EventPanel />
    </div>
    <div v-if="showOverlay('SHOP')" class="overlay">
      <ShopPanel />
    </div>
    <div v-if="showOverlay('CAMPFIRE')" class="overlay">
      <CampfirePanel />
    </div>
  </div>
</template>

<style scoped lang="scss">
.run-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 8px 20px;
  overflow: auto;
}

.map {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 460px;
  margin: 12px auto 24px;
  flex-shrink: 0;
}

.map-floor {
  display: flex;
  align-items: center;
  gap: 8px;
}
.floor-no {
  width: 26px;
  text-align: right;
  font-size: 12px;
  color: var(--text-faint);
}
.floor-nodes {
  flex: 1;
  display: flex;
  justify-content: space-around;
  gap: 8px;
}

.map-node {
  width: 72px;
  height: 42px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-raised);
  color: var(--text-main);
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.12s,
    transform 0.08s;
}
.map-node:disabled {
  cursor: not-allowed;
}
.map-node:hover:not(:disabled) {
  border-color: var(--accent-strong);
  transform: scale(1.06);
}
.map-node.locked {
  opacity: 0.35;
  background: var(--bg-deep);
}
.map-node.visited {
  opacity: 0.55;
}
.map-node.current {
  outline: 2px solid var(--gold);
}

.node-monster {
  border-color: #7a3220;
}
.node-elite {
  border-color: #b5482d;
}
.node-boss {
  border-color: #d9663f;
  box-shadow: 0 0 10px rgba(217, 102, 63, 0.4);
}
.node-chest {
  border-color: #c9a227;
}
.node-campfire {
  border-color: #a89a84;
}
.node-shop {
  border-color: #5a86ad;
}
.node-unknown {
  border-color: #8a5fa8;
}
.node-neow {
  border-color: #6f9d5a;
}

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 8, 7, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
</style>
