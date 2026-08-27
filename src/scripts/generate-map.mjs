/**
 * 地图配置数据生成：PRD §3.2.1 常量 → data/map.json
 * 楼层/权重等设计常量与 config/gameConfig.ts 保持一致（单一来源：gameConfig）。
 * 运行时地图实例由 engine/mapGenerator.ts 按种子生成，本文件仅存"静态规格"供参考/存档校验。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'data')

// 静态地图规格（与 config/gameConfig.ts 的 MAP 常量一致）
export function generateMap() {
  const map = {
    totalFloors: 17,
    branchWidth: 3,
    fixedFloors: { 1: 'neow', 2: 'monster', 10: 'chest', 16: 'campfire', 17: 'boss' },
    floorWeights: { monster: 55, elite: 12, unknown: 8, shop: 5, campfire: 12, chest: 8 },
    unknownEventChance: 0.85,
    eliteLoopPool: ['byrdonis', 'bygone_effigy', 'phrog_parasite'],
    bossPool: ['vantom', 'ceremonial_beast', 'the_kin'],
    maxEdges: 2,
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'map.json'), JSON.stringify(map, null, 2), 'utf-8')
  console.log('map.json 生成完成（静态规格）')
}
