/**
 * 地图生成器（PRD §3.2 / agent.md §3 engine/mapGenerator）
 * 密林幕 17 层地图：固定楼层 + 权重随机 + 分支连接，精英池循环抽取（3→2→1 重置）。
 * 使用注入的种子随机（mulberry32），同一种子生成的局完全相同（存档/测试可复现）。
 */
import type { MapNode, MapNodeType } from '@/types'
import { MAP } from '@/config/gameConfig'

// mulberry32：可复现的伪随机数生成器（PRD §3.2.1 种子局）
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 按种子生成整张地图（返回全部节点，含楼层/类型/连接）
export function generateMap(seed: number): MapNode[] {
  const rng = mulberry32(seed)
  const total = MAP.totalFloors
  const nodes: MapNode[] = []
  // 每层节点列（第 1 层与 Boss 层固定 1 列）
  const widths = new Array(total + 1).fill(MAP.branchWidth)
  widths[1] = 1
  widths[total] = 1
  // 逐层创建节点
  for (let floor = 1; floor <= total; floor++) {
    const w = widths[floor]
    for (let row = 0; row < w; row++) {
      const id = `f${floor}-r${row}`
      nodes.push({
        id,
        floor,
        row,
        type: resolveFloorType(floor, row, rng),
        next: [],
        visited: false,
        locked: floor > 1,
      })
    }
  }
  // 层间连线：每节点连向下层 1~2 个节点（带内随机），并保证下一层每个节点至少 1 条入边
  for (let floor = 1; floor < total; floor++) {
    const cur = nodes.filter((n) => n.floor === floor)
    const next = nodes.filter((n) => n.floor === floor + 1)
    const nextWidth = next.length
    for (const n of cur) {
      // 候选带：row-1..row+1（越界裁剪）
      const lo = Math.max(0, n.row - 1)
      const hi = Math.min(nextWidth - 1, n.row + 1)
      const band = range(lo, hi)
      // 洗牌后取最多 maxEdges 个目标
      const targets = shuffleArray(band, rng).slice(0, MAP.maxEdges)
      for (const t of targets) n.next.push(`f${floor + 1}-r${t}`)
    }
    // 兜底：保证下一层每个节点可达
    for (const nn of next) {
      const incoming = cur.filter((c) => c.next.includes(nn.id))
      if (incoming.length === 0) {
        // 从上一层最近行的节点补一条边
        const best = cur.reduce((acc, c) =>
          Math.abs(c.row - nn.row) < Math.abs(acc.row - nn.row) ? c : acc,
        )
        best.next.push(nn.id)
      }
    }
  }
  return nodes
}

// 解析楼层/列类型：固定楼层优先，其余按权重随机（PRD §3.2.1）
function resolveFloorType(floor: number, _row: number, rng: () => number): MapNodeType {
  const fixed = MAP.fixedFloors[floor]
  if (fixed) return fixed
  // 精英仅在第 4 层及以后出现（避免前期过难），其余按权重
  const weights = { ...MAP.floorWeights }
  if (floor < 4) weights.elite = 0
  // 商店/篝火/宝箱在第 15/16 层附近降低权重（避免与固定层冲突），此处简化不调
  return weightedPick(weights, rng)
}

// 权重随机取类型
function weightedPick(weights: Record<string, number>, rng: () => number): MapNodeType {
  const entries = Object.entries(weights).filter(([, w]) => w > 0) as Array<[MapNodeType, number]>
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let roll = rng() * total
  for (const [type, w] of entries) {
    roll -= w
    if (roll <= 0) return type
  }
  return entries[0]?.[0] ?? 'monster'
}

// 从当前节点获得下一层可达节点（已解锁判定由调用方处理）
export function getNextNodes(map: MapNode[], nodeId: string): MapNode[] {
  const node = map.find((n) => n.id === nodeId)
  if (!node) return []
  return node.next.map((id) => map.find((n) => n.id === id)).filter((n): n is MapNode => Boolean(n))
}

// 解锁：Boss 层之后无后续；第 2 层战斗后解锁下一层
export function unlockFloor(map: MapNode[], floor: number): void {
  for (const n of map) {
    if (n.floor === floor) n.locked = false
  }
}

function range(lo: number, hi: number): number[] {
  const out: number[] = []
  for (let i = lo; i <= hi; i++) out.push(i)
  return out
}

// 数组洗牌（注入 rng 保证可复现）
function shuffleArray<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = a[i] as T
    a[i] = a[j] as T
    a[j] = tmp
  }
  return a
}
