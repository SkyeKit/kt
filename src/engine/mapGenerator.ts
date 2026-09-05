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
// @param firstFloorIsNeow 第 1 层是否为先古之民（PRD §3.1：自第 2 局起；首局为普通节点）
export function generateMap(seed: number, firstFloorIsNeow = true): MapNode[] {
  const rng = mulberry32(seed)
  const total = MAP.totalFloors
  const nodes: MapNode[] = []
  // 每层分支宽度：第 1/17 层固定 1 列（先古/Boss 单点，居中渲染）
  // 第 2 层与 Boss 前一层独立从 2~5 取值——否则它们紧邻单点端层、会被"±1 演化 + branchMin=2"
  // 钳成恒定等于 2；改为独立随机赋予变化。其余中间层仍以前一层 ±1 平滑演化。
  const widths = new Array(total + 1).fill(0)
  widths[1] = 1
  widths[total] = 1
  widths[2] = MAP.branchMin + Math.floor(rng() * (MAP.branchMax - MAP.branchMin + 1))
  widths[total - 1] = MAP.branchMin + Math.floor(rng() * (MAP.branchMax - MAP.branchMin + 1))
  // 中间层 3..total-2：前一层宽度 ±1 平滑演化，夹在 [branchMin, branchMax]
  for (let floor = 3; floor <= total - 2; floor++) {
    const step = Math.floor(rng() * 3) - 1
    widths[floor] = Math.min(MAP.branchMax, Math.max(MAP.branchMin, widths[floor - 1] + step))
  }
  // 反向收敛(自 total-2 至第 2 层)：让中间层与下层(朝向 Boss)保持差 ≤ 1 平滑；
  // 不处理 Boss 前一层(16)，使其独立宽度得以保留(由终点汇聚承载)。
  // 第 2 层也按此贴近第 3 层，故其最终值随地图在中段宽窄间变化，而非恒为 2。
  for (let floor = total - 2; floor >= 2; floor--) {
    const lower = Math.max(MAP.branchMin, widths[floor + 1] - 1)
    const upper = Math.min(MAP.branchMax, widths[floor + 1] + 1)
    widths[floor] = Math.max(Math.min(widths[floor], upper), lower)
  }
  // 逐层创建节点
  for (let floor = 1; floor <= total; floor++) {
    const w = widths[floor]
    for (let row = 0; row < w; row++) {
      const id = `f${floor}-r${row}`
      nodes.push({
        id,
        floor,
        row,
        type: resolveFloorType(floor, firstFloorIsNeow, rng),
        next: [],
        visited: false,
        locked: floor > 1,
      })
    }
  }
  // 层间连线：多对多连接——一个节点可连向下层多个节点（发散），也可被上层多个节点连接（汇聚）。
  // 先古（第1层）向下发散，Boss（末层）由上层汇聚，中间层穿行交错，避免出现"无连接的孤立/末端死路"。
  // 中间层为保持"不交叉"与"只能走相邻节点"，连线仅落在行差≤1（相邻列）的节点之间；
  // 但端点边（第1层→第2层、第16层→Boss）因起点/终点是单点、本应发向/收自整面，故放宽行差限制。
  // 两阶段：① 主连接——为每个下层节点就近接入至少1个父（保证全员连通，无未连接节点）；
  //         ② 丰满——为每个父补连相邻子，使多数节点拥有多入多出（减少单向末端，地图更丰满）。
  for (let floor = 1; floor < total; floor++) {
    // 本层父节点与下一层子节点，均按行号升序（就近匹配 → 连线不交叉）
    const cur = nodes.filter((n) => n.floor === floor).sort((a, b) => a.row - b.row)
    const next = nodes.filter((n) => n.floor === floor + 1).sort((a, b) => a.row - b.row)
    // 端点边判定：任一端是单点层（起点先古向下发散 / 终点 Boss 由上层汇聚），放宽行差使整面连通
    const isEndpoint = cur.length === 1 || next.length === 1
    const childCount = new Map<string, number>()
    // ① 主连接：每个下层节点从"行相邻"父中选一个接入（优先取当前子数最少的父，均衡发散）
    for (const nn of next) {
      // 候选父：端点边取全部父（发散/汇聚）；普通边仅取行差≤1（保证走相邻节点、无交叉）
      const cands = cur.filter((p) => isEndpoint || Math.abs(p.row - nn.row) <= 1)
      if (cands.length === 0) continue
      // 按当前出边数升序，取最空闲的父 → 分支均匀、不扎堆一侧
      cands.sort((a, b) => (childCount.get(a.id) ?? 0) - (childCount.get(b.id) ?? 0))
      const parent = cands[0]!
      parent.next.push(nn.id)
      childCount.set(parent.id, (childCount.get(parent.id) ?? 0) + 1)
    }
    // ② 丰满：为尚未连满的父补连一条相邻子，使多数节点拥有多出边/多入边（形成分叉、汇聚，减少死路）
    for (const p of cur) {
      const already = childCount.get(p.id) ?? 0
      if (already >= MAP.maxEdges) continue // 已发满就不再补
      // 未向下连接过的节点必须补（防出边死路）；已连接的按随机一半概率再连一条（丰富多对多）
      const cands2 = next.filter(
        (n) => !p.next.includes(n.id) && (isEndpoint || Math.abs(n.row - p.row) <= 1),
      )
      if (cands2.length === 0) continue
      if (already === 0 || Math.floor(rng() * 2) === 1) {
        const added = cands2[Math.floor(rng() * cands2.length)]!
        p.next.push(added.id)
        childCount.set(p.id, (childCount.get(p.id) ?? 0) + 1)
      }
    }
  }
  return nodes
}

// 解析楼层/列类型：固定楼层优先，其余按权重随机（PRD §3.2.1）
// @param firstFloorIsNeow 首局时第 1 层为普通节点而非先古之民
function resolveFloorType(
  floor: number,
  firstFloorIsNeow: boolean,
  rng: () => number,
): MapNodeType {
  // 第 1 层：首局为普通节点，第 2 局起为先古之民（PRD §3.1/§3.2.1）
  if (floor === 1) return firstFloorIsNeow ? 'neow' : 'monster'
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
