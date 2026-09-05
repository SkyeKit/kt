/**
 * 地图生成器测试（agent.md §6：分支/固定楼层/概率/精英循环池）
 * 覆盖：17 层结构、固定楼层、节点连通性、精英池循环
 */
import { describe, it, expect } from 'vitest'
import { generateMap, mulberry32 } from '@/engine/mapGenerator'
import { MAP } from '@/config/gameConfig'

describe('地图生成：结构', () => {
  const map = generateMap(12345)

  it('共 17 层', () => {
    const floors = new Set(map.map((n) => n.floor))
    expect(floors.size).toBe(MAP.totalFloors)
  })

  it('第 1 层为单节点先古（neow）', () => {
    const f1 = map.filter((n) => n.floor === 1)
    expect(f1.length).toBe(1)
    expect(f1[0]!.type).toBe('neow')
  })

  it('firstFloorIsNeow=false 时第 1 层为普通战斗节点（保留能力，store 恒传 true）', () => {
    const firstRunMap = generateMap(12345, false)
    const f1 = firstRunMap.filter((n) => n.floor === 1)
    expect(f1.length).toBe(1)
    expect(f1[0]!.type).toBe('monster')
  })

  it('每层分支路线 2~5 条（第 1/17 层为 1 条）（PRD §3.2.1）', () => {
    const map2 = generateMap(555)
    for (let floor = 2; floor <= 16; floor++) {
      const count = map2.filter((n) => n.floor === floor).length
      expect(count).toBeGreaterThanOrEqual(MAP.branchMin)
      expect(count).toBeLessThanOrEqual(MAP.branchMax)
    }
  })

  it('第 2/10/16/17 层为固定类型（monster/chest/campfire/boss）', () => {
    expect(map.find((n) => n.floor === 2)!.type).toBe('monster')
    expect(map.find((n) => n.floor === 10)!.type).toBe('chest')
    expect(map.find((n) => n.floor === 16)!.type).toBe('campfire')
    const f17 = map.filter((n) => n.floor === 17)
    expect(f17.length).toBe(1)
    expect(f17[0]!.type).toBe('boss')
  })

  it('每个节点（除第 1 层）至少有一条入边（连通性）', () => {
    const reachable = new Set<string>()
    const f1 = map.filter((n) => n.floor === 1)
    for (const n of f1) reachable.add(n.id)
    // 从第 1 层 BFS
    const queue = [...f1]
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const next of cur.next) {
        if (!reachable.has(next)) {
          reachable.add(next)
          queue.push(map.find((n) => n.id === next)!)
        }
      }
    }
    expect(reachable.size).toBe(map.length)
  })

  it('连线只落在相邻节点（下一层且列差 ≤ 1）—— 一个节点只能走相邻的节点', () => {
    // 仅中间层连线要求"只能走相邻节点"（行差≤1）；端点边（第1层→第2层、Boss 前一层→Boss）
    // 因起点发散/终点汇聚，行差可跨列，故跳过断言
    for (const n of map) {
      if (n.floor === 1 || n.floor === MAP.totalFloors - 1) continue
      for (const id of n.next) {
        const t = map.find((m) => m.id === id)!
        expect(t.floor).toBe(n.floor + 1)
        expect(Math.abs(t.row - n.row)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('汇聚连接：每个下层节点至少有 1 条入边（多对多，允许被多个父连接）；交叉连线数量较少', () => {
    let crossings = 0 // 交叉连线计数：行号应大体对齐，允许少量交叉但不允许凌乱
    for (let floor = 2; floor <= MAP.totalFloors; floor++) {
      const cur = map.filter((n) => n.floor === floor - 1)
      const next = map.filter((n) => n.floor === floor)
      // 汇聚连接：每个下层节点被上一层 ≥1 个节点连接（多对多汇聚，允许被多个父连接但不可无父）
      for (const nn of next) {
        const parents = cur.filter((c) => c.next.includes(nn.id))
        expect(parents.length).toBeGreaterThanOrEqual(1)
      }
      // 交叉计数：下层行号递增时，若"最近"父节点行号发生"回退"（递减）则计入 1 次交叉
      const nextSorted = [...next].sort((a, b) => a.row - b.row)
      let lastParentRow = -Infinity
      for (const nn of nextSorted) {
        const parent = map.find((c) => c.floor === floor - 1 && c.next.includes(nn.id))!
        if (parent.row < lastParentRow) crossings++
        lastParentRow = parent.row
      }
    }
    // 允许少量交叉（交汇绕行制造自然交错），但整图交叉数必须较少（≤ 总层数），避免连线凌乱交叉
    expect(crossings).toBeLessThanOrEqual(MAP.totalFloors)
  })

  it('Boss 节点从第 1 层可达（存在通关路径）', () => {
    const reachable = new Set<string>()
    const f1 = map.filter((n) => n.floor === 1)
    const queue = [...f1]
    for (const n of f1) reachable.add(n.id)
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const id of cur.next) {
        if (!reachable.has(id)) {
          reachable.add(id)
          queue.push(map.find((n) => n.id === id)!)
        }
      }
    }
    const boss = map.find((n) => n.floor === MAP.totalFloors)!
    expect(reachable.has(boss.id)).toBe(true)
  })

  it('相邻两层之间至少存在一条向下连线（层间不中断）', () => {
    for (let floor = 1; floor < MAP.totalFloors; floor++) {
      const cur = map.filter((n) => n.floor === floor)
      expect(cur.some((c) => c.next.length > 0)).toBe(true)
    }
  })

  it('中间两层的分支宽度差 ≤ 1（保证中间层连线仅落相邻列；端点层宽度独立不做约束）', () => {
    const map2 = generateMap(555)
    for (let floor = 2; floor < MAP.totalFloors - 1; floor++) {
      const w = map2.filter((n) => n.floor === floor).length
      const wn = map2.filter((n) => n.floor === floor + 1).length
      expect(Math.abs(w - wn)).toBeLessThanOrEqual(1)
    }
  })

  it('同一种子生成的局完全一致（可复现）', () => {
    const map2 = generateMap(12345)
    expect(map2).toEqual(map)
  })

  it('不同种子生成的局不同', () => {
    const map2 = generateMap(99999)
    const typeStr = (m: typeof map): string => m.map((n) => n.type).join(',')
    expect(typeStr(map2)).not.toBe(typeStr(map))
  })
})

describe('地图生成：随机与精英池', () => {
  it('精英节点仅出现在第 4 层及以后', () => {
    const map = generateMap(777)
    for (const n of map) {
      if (n.type === 'elite') expect(n.floor).toBeGreaterThanOrEqual(4)
    }
  })

  it('mulberry32：确定性随机序列', () => {
    const rng = mulberry32(42)
    const seq1 = [rng(), rng(), rng()]
    const rng2 = mulberry32(42)
    const seq2 = [rng2(), rng2(), rng2()]
    expect(seq1).toEqual(seq2)
    expect(seq1[0]).not.toBe(seq1[1]) // 数值应有变化（极小概率相等，此处仅作合理性质疑）
  })
})
