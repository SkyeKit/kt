/**
 * 单局 Store（Pinia）：MVP 全局状态中枢（PRD §3.3~§3.13）
 * 持有：单局存档（RunState）、战斗上下文（CombatContext）、当前阶段（GamePhase）。
 * 所有"进入节点/开战/打牌/回合结束/领奖/离开"等动作经此派发，视图保持薄。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CombatContext, CombatResult } from '@/engine/combatEngine'
import type { Card, MapNode, Relic, RunState } from '@/types'
import type { GamePhase } from '@/engine/stateMachine'
import { CAMPFIRE, MAP, NEOW, PLAYER, REWARD, SAVE, SHOP } from '@/config/gameConfig'
import {
  checkResult,
  createCombatContext,
  enemyTurn,
  playCard as enginePlayCard,
  setEnemyIntents,
  startCombat,
} from '@/engine/combatEngine'
import { generateMap, mulberry32, unlockFloor } from '@/engine/mapGenerator'
import { loadRun, saveRun, clearRun } from '@/engine/saveSystem'
import { stateMachine } from '@/engine/stateMachine'
import {
  cardsData,
  enemiesData,
  eventsData,
  eventMap,
  getCard,
  getEnemy,
  getRelic,
  relicsData,
} from '@/data'
import { buildEnemyUnit } from '@/engine/enemyAI'

// 战斗类型（奖励分级依据，PRD §3.3.5）
type BattleKind = 'normal' | 'elite' | 'boss'

// 战斗奖励（击杀后待选）
interface PendingReward {
  kind: 'card' | 'relic' | 'gold'
  cards?: Card[]
  relics?: Relic[]
  gold?: number
}

export const useGameStore = defineStore('game', () => {
  // ===== 状态 =====
  const run = ref<RunState | null>(null) // 单局存档（null = 未开局）
  const battle = ref<CombatContext | null>(null) // 战斗上下文（BATTLE 阶段非空）
  const battleKind = ref<BattleKind>('normal') // 当前战斗类型（奖励分级依据）
  const pendingReward = ref<PendingReward | null>(null) // 战斗胜利待选奖励
  const currentEvent = ref<string | null>(null) // 当前事件 id（EVENT 阶段）
  const battleResult = ref<CombatResult | null>(null) // 战斗结算结果
  const shopState = ref<{
    cards: Card[]
    relics: Relic[]
    removeCount: number
    removeCost: number
  } | null>(null)
  const eliteLoop = ref<string[]>([]) // 精英循环抽取池（3→2→1 重置）
  const message = ref('') // 顶部提示（遗物/事件/系统消息）
  const log = ref<string[]>([]) // 战斗日志（调试控制台/战斗记录）

  // 阶段：响应式 ref，订阅状态机变化同步（stateMachine 本身是纯逻辑，不可被 Vue 侦测）
  const phase = ref<GamePhase>(stateMachine.current)
  stateMachine.onChange((p) => {
    phase.value = p
  })

  // 当前节点
  const currentNode = computed<MapNode | null>(() => {
    if (!run.value) return null
    return run.value.map.find((n) => n.id === run.value!.nodeId) ?? null
  })

  // ===== 开局 =====
  // 新开一局：生成种子局 + 地图 + 初始牌组/遗物，进入 RUN
  // 第 1 层固定为先古之民节点（用户确认：每局开局都要有遗物三选一）
  function newRun(seed?: number): void {
    const s = seed ?? Math.floor(Math.random() * 0xffffffff)
    const map = generateMap(s, true)
    run.value = {
      version: SAVE.version,
      seed: s,
      floor: 1,
      nodeId: 'f1-r0',
      map,
      hp: PLAYER.maxHp,
      maxHp: PLAYER.maxHp,
      gold: PLAYER.startingGold,
      deck: [...PLAYER.startingDeck],
      relics: [...PLAYER.startingRelic],
      potions: [],
      fightCount: 0,
      bossDefeated: false,
      meta: { kills: 0, elitesKilled: 0 },
    }
    eliteLoop.value = [...MAP.eliteLoopPool]
    unlockFloor(map, 1)
    stateMachine.force('RUN')
    persist()
  }

  // 继续存档：校验通过则恢复，失败提示
  function continueRun(): boolean {
    const saved = loadRun()
    if (!saved) return false
    run.value = saved
    stateMachine.force('RUN')
    persist()
    return true
  }

  // 丢弃当前局（返回主菜单）
  function abandonRun(): void {
    clearRun()
    run.value = null
    battle.value = null
    stateMachine.transition('MENU')
  }

  // 持久化当前局
  function persist(): void {
    if (run.value) saveRun(run.value)
  }

  // ===== 地图节点进入 =====
  // 从地图进入节点：按节点类型派发战斗/商店/篝火/事件/Boss
  function enterNode(nodeId: string): void {
    const r = run.value
    if (!r) return
    const node = r.map.find((n) => n.id === nodeId)
    if (!node || node.locked) return
    r.nodeId = nodeId
    r.floor = node.floor
    // 固定层：Boss 战
    if (node.type === 'boss') {
      startBattle([...MAP.bossPool], 'boss')
      return
    }
    if (node.type === 'monster') {
      startBattle(pickEncounter(), 'normal')
      return
    }
    if (node.type === 'unknown') {
      // 未知（？）房间内部内容（PRD §3.2.1：事件85/战斗10/商店3/宝箱2）
      const roll = mulberry32(r.seed + r.floor * 31)()
      const { event, battle: battleChance, shop, chest } = MAP.unknownRoomChance
      if (roll < event) {
        enterEvent()
      } else if (roll < event + battleChance) {
        startBattle(pickEncounter(), 'normal')
      } else if (roll < event + battleChance + shop) {
        setupShop()
        stateMachine.transition('SHOP')
      } else if (roll < event + battleChance + shop + chest) {
        giveChest()
      } else {
        startBattle(pickEncounter(), 'normal') // 兜底（概率浮点误差）
      }
      return
    }
    if (node.type === 'elite') {
      startBattle([pickElite()], 'elite')
      return
    }
    if (node.type === 'chest') {
      giveChest()
      return
    }
    if (node.type === 'shop') {
      setupShop()
      stateMachine.transition('SHOP')
      return
    }
    if (node.type === 'campfire') {
      stateMachine.transition('CAMPFIRE')
      return
    }
    if (node.type === 'neow') {
      offerNeow()
      return
    }
  }

  // 随机遭遇（前 3 场弱怪池，之后强怪池；PRD §3.2.2）
  function pickEncounter(): string[] {
    const r = run.value!
    const pool = r.fightCount < 3 ? enemiesData.encounters.weak : enemiesData.encounters.strong
    const idx = Math.floor(mulberry32(r.seed + r.fightCount * 7919)() * pool.length)
    return pool[idx] ?? pool[0] ?? ['fuzzy_wurm_crawler']
  }

  // 精英循环抽取（3→2→1 后重置，不重复）
  function pickElite(): string {
    if (eliteLoop.value.length === 0) eliteLoop.value = [...MAP.eliteLoopPool]
    const r = run.value!
    const idx = Math.floor(mulberry32(r.seed + r.fightCount * 104729)() * eliteLoop.value.length)
    return eliteLoop.value.splice(idx, 1)[0]!
  }

  // ===== 战斗 =====
  // 开战：按敌人 id 构建战斗上下文（PRD §3.3）；kind 决定奖励质量分级（§3.3.5）
  function startBattle(enemyIds: string[], kind: BattleKind): void {
    const r = run.value
    if (!r) return
    battleKind.value = kind
    const enemies = enemyIds
      .map((id) => {
        const def = getEnemy(id)
        return def ? buildEnemyUnit(def, undefined, mulberry32(r.seed + r.fightCount * 1543)) : null
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
    const ctx = createCombatContext(
      { id: 'ironclad', name: '铁甲战士', hp: r.hp, maxHp: r.maxHp, deck: r.deck, gold: r.gold },
      enemies.map((e) => ({ id: e.id, name: e.name, hp: e.hp, maxHp: e.maxHp })),
      mulberry32(r.seed + r.fightCount * 104729 + 7),
    )
    // 同步敌人完整数据（AI/招式/衍生物）
    ctx.enemies = enemies
    startCombat(ctx)
    battle.value = ctx
    battleResult.value = null
    log.value = ['战斗开始！']
    stateMachine.transition('BATTLE')
    // 战斗开始遗物（灯笼/弹珠袋等）
    triggerRelicsOnCombatStart(ctx)
    persist()
  }

  // 战斗开始遗物触发（PRD §3.8 钩子）
  function triggerRelicsOnCombatStart(ctx: CombatContext): void {
    const relics =
      run.value?.relics.map((id) => getRelic(id)).filter((x): x is Relic => Boolean(x)) ?? []
    for (const relic of relics) {
      if (relic.trigger === 'ON_COMBAT_START' && !relic.excluded) {
        applyRelicEffect(relic, ctx)
      }
    }
  }

  // 遗物效果执行（MVP 子集）
  function applyRelicEffect(relic: Relic, ctx: CombatContext): void {
    switch (relic.id) {
      case 'vajra':
        ctx.player.strength += 1
        log.value.push('[金刚杵] 获得 1 点力量')
        break
      case 'anchor':
        ctx.player.block += 10
        log.value.push('[锚] 获得 10 点格挡')
        break
      case 'bag_of_marbles':
        for (const e of ctx.enemies) e.statuses.push({ id: 'vulnerable', amount: 1, turns: 999 })
        log.value.push('[弹珠袋] 敌人获得 1 层易伤')
        break
      case 'red_mask':
        for (const e of ctx.enemies) e.statuses.push({ id: 'weak', amount: 1, turns: 999 })
        log.value.push('[红面具] 敌人获得 1 层虚弱')
        break
      case 'burning_blood':
      case 'lantern':
      case 'happy_flower':
      case 'centennial_puzzle':
        // 这些在战斗内钩子中处理（回合开始/受伤），此处跳过
        break
      default:
        log.value.push(`[${relic.name}] 效果未实现（数据已记录）`)
    }
  }

  // 玩家打出一张牌（BattleView 调用）
  function playCard(cardId: string, targetId?: string): boolean {
    const ctx = battle.value
    if (!ctx) return false
    const card = getCard(cardId)
    if (!card) return false
    const ok = enginePlayCard(ctx, card, targetId)
    if (ok) {
      log.value.push(...ctx.log.slice(-8))
      const result = checkResult(ctx)
      battleResult.value = result
      if (result.status === 'victory') onVictory()
      else if (result.status === 'defeat') onDefeat()
    }
    return ok
  }

  // 结束玩家回合：敌人行动 → 新回合（PRD §3.3.2）
  function endTurn(): void {
    const ctx = battle.value
    if (!ctx) return
    // 回合结束：手牌全部移入弃牌堆（PRD §3.3.2 第 1 步）
    ctx.discardPile.push(...ctx.hand)
    ctx.hand.length = 0
    enemyTurn(ctx)
    log.value.push(...ctx.log.slice(-8))
    const result = checkResult(ctx)
    battleResult.value = result
    if (result.status === 'victory') return onVictory()
    if (result.status === 'defeat') return onDefeat()
    // 新回合：能量重置 + 抽牌 + 意图更新（PRD §3.3.2）
    const handSize = 5
    ctx.player.block = 0
    ctx.energy = ctx.maxEnergy
    ctx.turn++
    for (const e of ctx.enemies) if (e.alive) e.block = 0
    setEnemyIntents(ctx)
    // 抽牌（引擎抽牌逻辑）
    for (let i = 0; i < handSize; i++) {
      if (ctx.drawPile.length === 0) {
        ctx.drawPile.push(...shuffleArr(ctx.discardPile))
        ctx.discardPile.length = 0
      }
      const card = ctx.drawPile.pop()
      if (card) ctx.hand.push(card)
    }
    // 回合开始遗物（灯笼等）
    triggerRelicsOnTurnStart(ctx)
    log.value.push(`—— 第 ${ctx.turn} 回合 ——`)
  }

  // 抽牌洗牌（本地实现，避免额外依赖）
  function shuffleArr<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = a[i] as T
      a[i] = a[j] as T
      a[j] = tmp
    }
    return a
  }

  // 回合开始遗物
  function triggerRelicsOnTurnStart(ctx: CombatContext): void {
    const relics =
      run.value?.relics.map((id) => getRelic(id)).filter((x): x is Relic => Boolean(x)) ?? []
    for (const relic of relics) {
      if (relic.id === 'lantern' && ctx.turn === 1) {
        ctx.energy += 1
        log.value.push('[灯笼] 第一回合获得 1 点能量')
      }
      if (relic.id === 'happy_flower' && ctx.turn > 0 && ctx.turn % 3 === 0) {
        ctx.energy += 1
        log.value.push('[开心小花] 获得 1 点能量')
      }
    }
  }

  // 战斗胜利：燃烧之血回血 + 生成奖励（PRD §3.3.5 / §3.13）
  function onVictory(): void {
    const r = run.value
    const ctx = battle.value
    if (!r || !ctx) return
    // 燃烧之血回血
    if (r.relics.includes('burning_blood')) {
      r.hp = Math.min(r.maxHp, r.hp + REWARD.bloodHeal)
      log.value.push(`[燃烧之血] 回复 ${REWARD.bloodHeal} 点生命`)
    }
    // 统计击杀
    const dead = ctx.enemies.filter((e) => !e.alive).length
    r.meta.kills += dead
    r.fightCount++
    r.hp = ctx.player.hp
    r.gold = ctx.gold
    // 精英/Boss 额外记录
    const isBoss = battleKind.value === 'boss'
    if (battleKind.value === 'elite' || isBoss) r.meta.elitesKilled++
    // Boss 战：直接结算（§3.13），无奖励页
    if (isBoss) {
      r.bossDefeated = true
      stateMachine.transition('SETTLEMENT')
      persist()
      return
    }
    pendingReward.value = generateReward(battleKind.value)
    stateMachine.transition('REWARD')
    persist()
  }

  // 战斗失败：进入结算（失败结局）
  function onDefeat(): void {
    battleResult.value = { status: 'defeat' }
    stateMachine.transition('SETTLEMENT')
    persist()
  }

  // 生成战斗奖励（金币 + 遗物 + 卡牌 3 选 1；PRD §3.3.5/§3.3.7）
  // 普通战：金币 + 卡牌；精英战：金币 + 遗物 1 件（直接入库）+ 卡牌；Boss 战无奖励页（直接结算）
  function generateReward(kind: BattleKind): PendingReward {
    const r = run.value!
    const rng = mulberry32(r.seed + r.fightCount * 217)
    const [gMin, gMax] = kind === 'elite' ? REWARD.gold.elite : REWARD.gold.monster
    const gold = Math.floor(rng() * (gMax - gMin + 1)) + gMin
    r.gold += gold
    // 卡牌 3 选 1（按战斗类型质量分级）
    const cards = pickCardRewards(rng, kind)
    const result: PendingReward = { kind: 'card', cards, gold }
    // 精英必掉 1 件遗物（PRD §3.3.5；黑星→+1 后续扩展）：直接入库，页面展示
    if (kind === 'elite') {
      const relic = rollRelicDrop()
      if (relic) {
        r.relics.push(relic.id)
        result.relics = [relic]
      }
    }
    return result
  }

  // 遗物掉落（从通用/战士池抽取未拥有的）
  function rollRelicDrop(): Relic | undefined {
    const r = run.value!
    const pool = [...relicsData.general, ...relicsData.warrior].filter(
      (x) => !x.excluded && !r.relics.includes(x.id),
    )
    if (pool.length === 0) return undefined
    const idx = Math.floor(mulberry32(r.seed + r.fightCount * 331)() * pool.length)
    return pool[idx]
  }

  // 抽 3 张奖励卡（按战斗类型质量分级：普通战保底普通、精英战保底罕见、Boss 保底稀有）
  function pickCardRewards(rng: () => number, kind: BattleKind): Card[] {
    const pool = cardsData.warrior.filter((c) => c.rarity !== 'basic' && c.rarity !== 'ancient')
    const weights = REWARD.cardRarityChance[kind]
    const picked: Card[] = []
    const used = new Set<string>()
    while (picked.length < 3) {
      const roll = rng()
      const rarity =
        roll < weights.common
          ? 'common'
          : roll < weights.common + weights.uncommon
            ? 'uncommon'
            : 'rare'
      const candidates = pool.filter((c) => c.rarity === rarity && !used.has(c.id))
      if (candidates.length === 0) {
        if (used.size >= pool.length) break
        continue
      }
      const card = candidates[Math.floor(rng() * candidates.length)]!
      used.add(card.id)
      picked.push(card)
    }
    return picked
  }

  // 领取卡牌奖励
  function claimCardReward(cardId: string | null): void {
    const r = run.value
    const pr = pendingReward.value
    if (!r || !pr) return
    if (cardId) r.deck.push(cardId)
    pendingReward.value = null
    advanceAfterReward()
  }

  // 领取金币（无卡可选时）
  function claimGoldOnly(): void {
    pendingReward.value = null
    advanceAfterReward()
  }

  // 奖励页返回战斗界面（已结算，仅可查看；PRD §3.3.7）
  function backToBattle(): void {
    if (!pendingReward.value) return
    stateMachine.transition('BATTLE')
  }

  // 战斗只读界面返回奖励页（BATTLE → REWARD，PRD §3.3.7）
  function backToReward(): void {
    if (!pendingReward.value) return
    stateMachine.transition('REWARD')
  }

  // 奖励页前进至地图（未选卡默认跳过；PRD §3.3.7）
  function forwardToMap(): void {
    if (!pendingReward.value) return
    pendingReward.value = null
    advanceAfterReward()
  }

  // 奖励后推进：解锁下一层并回到地图
  function advanceAfterReward(): void {
    const r = run.value
    if (!r) return
    const node = r.map.find((n) => n.id === r.nodeId)
    const nextFloor = node ? node.floor + 1 : r.floor + 1
    unlockFloor(r.map, nextFloor)
    battle.value = null
    stateMachine.transition('RUN')
    persist()
  }

  // ===== 事件 =====
  // 进入事件：从事件池随机（剔除依赖药水的）
  function enterEvent(): void {
    const r = run.value!
    const pool = eventsData.events.filter((e) => !e.excluded)
    const idx = Math.floor(mulberry32(r.seed + r.floor * 997)() * pool.length)
    const ev = pool[idx]
    if (!ev) return
    currentEvent.value = ev.id
    stateMachine.transition('EVENT')
  }

  // 事件选项结算（MVP 简化：金币/生命/遗物/卡牌变化）
  function resolveEventOption(optionText: string): void {
    const r = run.value
    const evId = currentEvent.value
    if (!r || !evId) return
    const ev = eventMap.get(evId)
    if (ev) {
      const opt = ev.options.find((o) => o.text === optionText)
      if (opt && opt.battle) {
        // 事件战斗（茂密的植被 → 4 只扭动虫）
        startBattle(['wriggler', 'wriggler', 'wriggler', 'wriggler'], 'normal')
        currentEvent.value = null
        return
      }
      applyEventEffect(ev.name, optionText)
    }
    currentEvent.value = null
    stateMachine.transition('RUN')
    persist()
  }

  // 事件效果执行（按选项文本匹配数值，MVP 子集）
  function applyEventEffect(eventName: string, option: string): void {
    const r = run.value!
    const num = (s: string): number => Number(s.match(/(\d+)/)?.[1] ?? 0)
    // 金币
    const goldMatch = option.match(/(\d+)(?:[-~](\d+))?\s*金币/)
    if (goldMatch) {
      const lo = parseInt(goldMatch[1]!, 10)
      const hi = goldMatch[2] ? parseInt(goldMatch[2]!, 10) : lo
      const gain = lo + Math.floor(mulberry32(r.seed + r.floor * 101)() * (hi - lo + 1))
      if (option.includes('失去') || option.includes('支付')) r.gold = Math.max(0, r.gold - gain)
      else r.gold += gain
      message.value = `${eventName}：金币变动 ${option.includes('失去') || option.includes('支付') ? '-' : '+'}${gain}`
    }
    // 生命
    if (option.includes('失去') && (option.includes('生命') || option.includes('最大生命'))) {
      const n = num(option)
      if (option.includes('最大生命')) {
        r.maxHp = Math.max(1, r.maxHp - n)
        r.hp = Math.min(r.hp, r.maxHp)
      } else {
        r.hp = Math.max(0, r.hp - n)
      }
      message.value = `${eventName}：失去 ${n} 点${option.includes('最大生命') ? '最大' : ''}生命`
    }
    if (option.includes('回复') && option.includes('生命')) {
      const n = num(option)
      r.hp = Math.min(r.maxHp, r.hp + n)
      message.value = `${eventName}：回复 ${n} 点生命`
    }
    // 遗物（获得随机遗物）
    if (option.includes('遗物')) {
      const pool = relicsData.general.filter((x) => !x.excluded && !r.relics.includes(x.id))
      const relic = pool[Math.floor(mulberry32(r.seed + r.floor * 103)() * pool.length)]
      if (relic) {
        r.relics.push(relic.id)
        message.value = `${eventName}：获得遗物【${relic.name}】`
      }
    }
    // 卡牌变化（升级/变化简化处理：随机选一张普通牌）
    if (option.includes('升级')) {
      message.value = `${eventName}：升级一张牌（MVP 简化：待实现）`
    }
    if (option.includes('最大生命') && option.includes('获得')) {
      const n = num(option)
      r.maxHp += n
      r.hp += n
      message.value = `${eventName}：获得 ${n} 点最大生命`
    }
  }

  // ===== 商店（PRD §3.5） =====
  function setupShop(): void {
    const r = run.value!
    const rng = mulberry32(r.seed + r.floor * 131)
    const cardPool = [
      ...cardsData.warrior.filter((c) => c.rarity !== 'basic' && c.rarity !== 'ancient'),
      ...cardsData.colorless,
    ]
    const cards: Card[] = []
    for (let i = 0; i < SHOP.cardCount; i++) {
      const c = cardPool[Math.floor(rng() * cardPool.length)]!
      cards.push(c)
    }
    const relicPool = [...relicsData.general, ...relicsData.warrior].filter(
      (x) => !x.excluded && !r.relics.includes(x.id),
    )
    const relics: Relic[] = []
    for (let i = 0; i < SHOP.relicCount; i++) {
      const idx = Math.floor(rng() * relicPool.length)
      const relic = relicPool[idx]
      if (relic) relics.push(relic)
    }
    shopState.value = {
      cards,
      relics,
      removeCount: SHOP.removeCount,
      removeCost: SHOP.removeBaseCost,
    }
  }

  // 购买卡牌
  function buyCard(index: number): boolean {
    const r = run.value
    const s = shopState.value
    if (!r || !s) return false
    const card = s.cards[index]
    if (!card) return false
    const price = priceOf(card)
    if (r.gold < price) return false
    r.gold -= price
    r.deck.push(card.id)
    s.cards.splice(index, 1)
    persist()
    return true
  }

  // 购买遗物
  function buyRelic(index: number): boolean {
    const r = run.value
    const s = shopState.value
    if (!r || !s) return false
    const relic = s.relics[index]
    if (!relic) return false
    const price =
      SHOP.relicPrice[0] + Math.floor(Math.random() * (SHOP.relicPrice[1] - SHOP.relicPrice[0] + 1))
    if (r.gold < price) return false
    r.gold -= price
    r.relics.push(relic.id)
    s.relics.splice(index, 1)
    persist()
    return true
  }

  // 移除卡牌（价格递增）
  function buyRemove(cardId: string): boolean {
    const r = run.value
    const s = shopState.value
    if (!r || !s) return false
    if (s.removeCount <= 0 || r.gold < s.removeCost) return false
    const idx = r.deck.lastIndexOf(cardId)
    if (idx < 0) return false
    r.gold -= s.removeCost
    r.deck.splice(idx, 1)
    s.removeCount--
    s.removeCost += SHOP.removeIncrement
    persist()
    return true
  }

  // 卡牌价格（PRD §3.5：普通 50 / 罕见 75 / 稀有 150 ±10%）
  function priceOf(card: Card): number {
    const base =
      card.rarity === 'rare'
        ? SHOP.prices.rare
        : card.rarity === 'uncommon'
          ? SHOP.prices.uncommon
          : SHOP.prices.common
    const rng = mulberry32(run.value!.seed + run.value!.floor * 137)
    const factor = 0.9 + rng() * 0.2
    return Math.round(base * factor)
  }

  // 离开商店
  function leaveShop(): void {
    shopState.value = null
    advanceAfterReward()
  }

  // ===== 篝火（PRD §3.6） =====
  function campfireRest(): void {
    const r = run.value!
    const heal = Math.floor(r.maxHp * CAMPFIRE.restHealRatio)
    r.hp = Math.min(r.maxHp, r.hp + heal)
    message.value = `篝火休息：回复 ${heal} 点生命`
    leaveCampfire()
  }

  // 锻造：升级牌组中一张卡（PRD §3.6）
  function campfireSmith(cardId?: string): boolean {
    const r = run.value!
    const card = cardId
      ? getCard(cardId)
      : r.deck.map((id) => getCard(id)).find((c) => c && !c.upgrade)
    if (!card) return false
    card.upgrade = true
    message.value = `锻造：升级【${card.name}】`
    leaveCampfire()
    return true
  }

  function leaveCampfire(): void {
    advanceAfterReward()
  }

  // ===== 宝箱 =====
  function giveChest(): void {
    const r = run.value!
    const pool = relicsData.general.filter((x) => !x.excluded && !r.relics.includes(x.id))
    const relic = pool[Math.floor(mulberry32(r.seed + r.floor * 193)() * pool.length)]
    if (relic) {
      r.relics.push(relic.id)
      message.value = `宝箱：获得遗物【${relic.name}】`
    }
    stateMachine.transition('RUN')
    unlockFloor(r.map, r.floor + 1)
    persist()
  }

  // ===== 先古遗物选择（PRD §3.1） =====
  // 开局从涅奥池抽 3 件（剔除 5 件 MVP 不可用）
  function offerNeow(): void {
    const r = run.value!
    const pool = relicsData.neowPool.filter((x) => !x.excluded)
    const rng = mulberry32(r.seed + 1)
    const offer = [...pool]
    // Fisher-Yates 抽 3
    for (let i = offer.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = offer[i] as Relic
      offer[i] = offer[j] as Relic
      offer[j] = tmp
    }
    const relics = offer.slice(0, NEOW.offerCount)
    message.value = '先古之民：选择你的初始遗物'
    // 用 pendingReward 复用选择界面
    pendingReward.value = { kind: 'relic', relics }
    stateMachine.transition('REWARD')
  }

  // 选择遗物（先古/事件）
  function claimRelicReward(relicId: string | null): void {
    const r = run.value
    const pr = pendingReward.value
    if (!r || !pr) return
    if (relicId) r.relics.push(relicId)
    pendingReward.value = null
    // 开局遗物选择后解锁第 2 层
    unlockFloor(r.map, 2)
    stateMachine.transition('RUN')
    persist()
  }

  return {
    run,
    battle,
    battleKind,
    pendingReward,
    currentEvent,
    battleResult,
    shopState,
    message,
    log,
    phase,
    currentNode,
    newRun,
    continueRun,
    abandonRun,
    enterNode,
    startBattle,
    playCard,
    endTurn,
    claimCardReward,
    claimGoldOnly,
    backToBattle,
    backToReward,
    forwardToMap,
    enterEvent,
    resolveEventOption,
    buyCard,
    buyRelic,
    buyRemove,
    leaveShop,
    campfireRest,
    campfireSmith,
    offerNeow,
    claimRelicReward,
  }
})
