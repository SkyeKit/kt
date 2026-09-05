/**
 * 数据生成总入口：document/*.md → src/data/*.json
 * 运行：pnpm data:generate（修改游戏数据 = 改 md 后重跑本脚本，agent.md §5.1）
 */
import { generateCards } from './parse-cards.mjs'
import { generateEnemies } from './parse-enemies.mjs'
import { generateRelics } from './parse-relics.mjs'
import { generateEvents } from './parse-events.mjs'
import { generateEnchantments } from './parse-enchantments.mjs'
import { generateMap } from './generate-map.mjs'

console.log('🔄 开始生成游戏数据（document/*.md → data/*.json）...')
generateCards()
generateEnemies()
generateRelics()
generateEvents()
generateEnchantments()
generateMap()
console.log('✅ 全部数据生成完成')
