/**
 * 数据加载层：src/data/*.json → 类型化数据对象
 * JSON 由 scripts/ 生成（document/*.md 转换），禁止手改（agent.md §5.1）。
 */
import cardsJson from './cards.json'
import enemiesJson from './enemies.json'
import enemiesUnderdocksJson from './enemies-underdocks.json'
import relicsJson from './relics.json'
import eventsJson from './events.json'
import enchantmentsJson from './enchantments.json'
import mapJson from './map.json'
import type { Card, Enemy, Enchantment, GameEvent, Relic, ActId } from '@/types'
import { MAP } from '@/config/gameConfig'

// 卡牌数据：按池分组
export interface CardsData {
  warrior: Card[]
  colorless: Card[]
  status: Card[]
  curse: Card[]
  eventCards: Card[]
  derived: Card[]
}

// 敌人数据 + 遭遇池
export interface EnemiesData {
  enemies: Enemy[]
  encounters: { weak: string[][]; strong: string[][]; elites: string[]; bosses: string[] }
}

// 遗物数据：按池分组（parse-relics.mjs 全量生成）
export interface RelicsData {
  neowPool: Relic[] // 先古·涅奥 30
  warrior: Relic[] // 铁甲战士 9
  general: Relic[] // 通用全部（普通/罕见/稀有/商店/事件/遗物/事件变体）
  ancient: Relic[] // 先古·除涅奥外七池合计
  silent: Relic[] // 静默猎手 9
  juggler: Relic[] // 储君 9
  religion: Relic[] // 亡灵契约师 9
  robomancer: Relic[] // 故障机器人 9
  ancientDetail: {
    neow: Relic[]
    eolobas: Relic[]
    pert: Relic[]
    tez: Relic[]
    nonupup: Relic[]
    tanks: Relic[]
    vaku: Relic[]
    davu: Relic[]
  }
}

// 事件数据
export interface EventsData {
  events: GameEvent[]
}

// 附魔数据
export interface EnchantmentsData {
  enchantments: Enchantment[]
}

export const cardsData = cardsJson as unknown as CardsData
export const enemiesData = enemiesJson as unknown as EnemiesData
// 暗港（Underdocks）敌人数据：敌人列表 + 该幕遭遇池
export const underdocksEnemiesData = enemiesUnderdocksJson as unknown as EnemiesData
// 暗港遭遇池（字段命名为 eliteLoop / boss，与密林 MAP 配置口径一致）
// 单独结构体导出，避免与 overgrowth 的 EnemiesData(elites/bosses) 类型混淆
export const underdocksEncounters = (
  enemiesUnderdocksJson as unknown as {
    enemies: unknown[]
    encounters: {
      weak: string[][]
      strong: string[][]
      eliteLoop: string[]
      boss: string[]
    }
  }
).encounters
export const relicsData = relicsJson as unknown as RelicsData
export const eventsData = eventsJson as unknown as EventsData
export const enchantmentsData = enchantmentsJson as unknown as EnchantmentsData
export const mapData = mapJson as unknown as {
  totalFloors: number
  branchWidth: number
  fixedFloors: Record<string, string>
  floorWeights: Record<string, number>
  unknownEventChance: number
  eliteLoopPool: string[]
  bossPool: string[]
  maxEdges: number
}

// ===== 查询工具（全量索引，供引擎/组件快速查找） =====

// 卡牌 ID → 卡（全池合并，重复 id 取先出现的）
export const cardMap: Map<string, Card> = new Map()
for (const pool of [
  cardsData.warrior,
  cardsData.colorless,
  cardsData.status,
  cardsData.curse,
  cardsData.eventCards,
  cardsData.derived,
]) {
  for (const c of pool) {
    if (!cardMap.has(c.id)) cardMap.set(c.id, c)
  }
}

// 敌人 ID → 敌人（密林 + 暗港全量合并，重复 id 先出现的生效）
export const enemyMap: Map<string, Enemy> = new Map()
for (const e of enemiesData.enemies) if (!enemyMap.has(e.id)) enemyMap.set(e.id, e)
for (const e of underdocksEnemiesData.enemies) if (!enemyMap.has(e.id)) enemyMap.set(e.id, e)

// 遭遇池（按幕集中查询，供 gameStore 按 run.act 分流）
// 密林丘：弱/强怪池沿用原 enemies.json，精英/Boss 池沿用 MAP 配置；暗港取新数据文件
export interface ActEncounters {
  weak: string[][] // 弱怪池（前 3 场）
  strong: string[][] // 强怪池（第 4 场及以后）
  eliteLoop: string[] // 精英循环抽取池（3→2→1 后重置）
  boss: string[] // Boss 三选一
}
export const ACT_ENCOUNTERS: Record<ActId, ActEncounters> = {
  overgrowth: {
    weak: enemiesData.encounters.weak,
    strong: enemiesData.encounters.strong,
    eliteLoop: [...MAP.eliteLoopPool],
    boss: [...MAP.bossPool],
  },
  underdocks: {
    weak: underdocksEncounters.weak,
    strong: underdocksEncounters.strong,
    eliteLoop: [...underdocksEncounters.eliteLoop],
    boss: [...underdocksEncounters.boss],
  },
}

// 遗物 ID → 遗物（全量池合并；ancientDetail 与主池重复，不重复构建）
export const relicMap: Map<string, Relic> = new Map(
  [
    ...relicsData.neowPool,
    ...relicsData.warrior,
    ...relicsData.general,
    ...relicsData.ancient,
    ...relicsData.silent,
    ...relicsData.juggler,
    ...relicsData.religion,
    ...relicsData.robomancer,
  ].map((r) => [r.id, r]),
)

// 事件 ID → 事件
export const eventMap: Map<string, GameEvent> = new Map(eventsData.events.map((e) => [e.id, e]))

// 附魔 ID → 附魔
export const enchantmentMap: Map<string, Enchantment> = new Map(
  enchantmentsData.enchantments.map((e) => [e.id, e]),
)

// 取卡：不存在时返回 undefined（组件需兜底）
export const getCard = (id: string): Card | undefined => cardMap.get(id)
export const getEnemy = (id: string): Enemy | undefined => enemyMap.get(id)
export const getRelic = (id: string): Relic | undefined => relicMap.get(id)
export const getEvent = (id: string): GameEvent | undefined => eventMap.get(id)
export const getEnchantment = (id: string): Enchantment | undefined => enchantmentMap.get(id)
