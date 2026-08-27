/**
 * 地图组合函数（PRD §3.2）：供 RunView 渲染地图与进入节点
 */
import { computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import { getNextNodes } from '@/engine/mapGenerator'
import type { MapNode, MapNodeType } from '@/types'

// 节点类型中文名（UI 展示）
export const NODE_TYPE_NAME: Record<MapNodeType, string> = {
  neow: '先古',
  monster: '战斗',
  elite: '精英',
  chest: '宝箱',
  campfire: '篝火',
  shop: '商店',
  unknown: '未知',
  boss: 'Boss',
}

export function useMap() {
  const store = useGameStore()

  // 当前局地图（按楼层分组渲染）
  const floors = computed(() => {
    const map = store.run?.map ?? []
    const grouped: MapNode[][] = []
    for (const node of map) {
      if (!grouped[node.floor]) grouped[node.floor] = []
      grouped[node.floor]!.push(node)
    }
    return grouped.filter((f) => f.length > 0)
  })

  // 节点是否可进入（未被锁定且位于当前可达层）
  function isEnterable(node: MapNode): boolean {
    return !node.locked && !node.visited
  }

  // 该节点的下一层可达节点（用于连线条渲染）
  function nextOf(node: MapNode): MapNode[] {
    return getNextNodes(store.run?.map ?? [], node.id)
  }

  return { floors, isEnterable, nextOf }
}
