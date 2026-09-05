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

  // 当前所在节点（开局时指向 f1-r0 先古节点；进入某节点后指向该节点）
  const current = computed<MapNode | null>(() => store.currentNode)

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

  // 该节点的下一层可达节点（用于连线条渲染）
  function nextOf(node: MapNode): MapNode[] {
    return getNextNodes(store.run?.map ?? [], node.id)
  }

  // 节点是否"可达"：仅当前节点本身、或"当前节点连线指向的下一层节点"
  // （修复"可走同层/上一层节点"；连通性由地图连线保证——中间层只连相邻节点，
  // 端点边（先古→第2层、Boss前→Boss）为发散/汇聚可跨列，故不再在此做硬性行差判定）
  function isReachable(node: MapNode): boolean {
    const cur = current.value
    if (!cur) return false
    if (node.id === cur.id) return true
    return node.floor === cur.floor + 1 && nextOf(cur).some((n) => n.id === node.id)
  }

  // 节点是否可进入（未被访问、未锁定 且 可达；locked 由 unlockFloor 推进解锁）
  // 含 !node.locked：续档/节点进行中退出后，当前节点 visited 被重置为可重进，但其下一层尚未解锁，
  // 若只看 isReachable 会误判"下一层可进入"（亮着却点不了——enterNode 会因 locked 拦截）
  function isEnterable(node: MapNode): boolean {
    return !node.visited && !node.locked && isReachable(node)
  }

  return { floors, current, isEnterable, nextOf, isReachable }
}
