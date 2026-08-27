/**
 * 数据加载层：src/data/*.json → 类型化数据对象
 * JSON 由 scripts/ 生成（document/*.md 转换），禁止手改（agent.md §5.1）。
 */
import cardsJson from './cards.json'
import enemiesJson from './enemies.json'
import relicsJson from './relics.json'
import eventsJson from './events.json'
import mapJson from './map.json'
import type { Card, Enemy, GameEvent, Relic } from '@/types'

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

// 遗物数据：按池分组
export interface RelicsData {
  neowPool: Relic[]
  warrior: Relic[]
  general: Relic[]
  ancient: Relic[]
}

// 事件数据
export interface EventsData {
  events: GameEvent[]
}

export const cardsData = cardsJson as unknown as CardsData
export const enemiesData = enemiesJson as unknown as EnemiesData
export const relicsData = relicsJson as unknown as RelicsData
export const eventsData = eventsJson as unknown as EventsData
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

// 敌人 ID → 敌人
export const enemyMap: Map<string, Enemy> = new Map(enemiesData.enemies.map((e) => [e.id, e]))

// 遗物 ID → 遗物
export const relicMap: Map<string, Relic> = new Map(
  [...relicsData.neowPool, ...relicsData.warrior, ...relicsData.general, ...relicsData.ancient].map(
    (r) => [r.id, r],
  ),
)

// 事件 ID → 事件
export const eventMap: Map<string, GameEvent> = new Map(eventsData.events.map((e) => [e.id, e]))

// 取卡：不存在时返回 undefined（组件需兜底）
export const getCard = (id: string): Card | undefined => cardMap.get(id)
export const getEnemy = (id: string): Enemy | undefined => enemyMap.get(id)
export const getRelic = (id: string): Relic | undefined => relicMap.get(id)
export const getEvent = (id: string): GameEvent | undefined => eventMap.get(id)
