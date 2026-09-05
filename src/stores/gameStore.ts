/**
 * 单局 Store（Pinia）：MVP 全局状态中枢（PRD §3.3~§3.13）
 * 持有：单局存档（RunState）、战斗上下文（CombatContext）、当前阶段（GamePhase）。
 * 所有"进入节点/开战/打牌/回合结束/领奖/离开"等动作经此派发，视图保持薄。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CombatContext, CombatResult } from '@/engine/combatEngine'
import type { Card, CardRarity, DeckCard, MapNode, Relic, RunState, ActId } from '@/types'
import type { GamePhase } from '@/engine/stateMachine'
import { ACTS, CAMPFIRE, MAP, NEOW, PLAYER, RELIC, REWARD, SAVE, SHOP } from '@/config/gameConfig'
import {
  checkResult,
  createCombatContext,
  enemyTurn,
  playCard as enginePlayCard,
  resolveHandEndOfTurn,
  setEnemyIntents,
  startCombat,
  startPlayerTurn,
} from '@/engine/combatEngine'
import { generateMap, mulberry32, unlockFloor } from '@/engine/mapGenerator'
import { loadRun, saveRun, clearRun } from '@/engine/saveSystem'
import { stateMachine } from '@/engine/stateMachine'
import {
  ACT_ENCOUNTERS,
  cardsData,
  eventsData,
  eventMap,
  getCard,
  getEnchantment,
  getEnemy,
  getRelic,
  relicsData,
} from '@/data'
import { buildEnemyUnit, uniqueEnemyId } from '@/engine/enemyAI'

// 战斗类型（奖励分级依据，PRD §3.3.5）
type BattleKind = 'normal' | 'elite' | 'boss'

// 假遗物判定：id 以 "_ev" 结尾的遗物（如 merchant_carpet_ev、orichalcum_ev、mango_ev…）
// 仅供假商人事件（fake_merchant）按 id 显式出售，不得流入任何随机掉落/事件/交换/发遗物等普通获取途径。
const isFakeRelic = (id: string): boolean => id.endsWith('_ev')

// 战斗奖励（击杀后待选）
interface PendingReward {
  kind: 'card' | 'relic' | 'gold'
  cards?: Card[]
  relics?: Relic[]
  gold?: number
  cardTier?: CardRarity // 卡牌奖励档位（白/普通、蓝/罕见、金/稀有），决定 3 张候选卡的保底稀有度
  goldClaimed?: boolean // 金币是否已领取（点击金币行后置 true，行消失且不重新展示）
  cardClaimed?: boolean // 卡牌是否已领取（领完卡后置 true，行消失）
}

// 通用选牌请求（挂起式）：由"从 N 张牌中选 1"类遗物/事件发起，UI 展示候选后玩家选完回传
// mode='cards' 展示候选单卡；mode='packs' 展示候选卡包（每包多张，选包整体加入）
interface PickRequest {
  id: number // 自增 id（区分并发/链式请求）
  title: string // 弹窗标题（如"精准剪刀：选择要移除的牌"）
  hint?: string // 副标题说明（补充代价/后果提示）
  mode: 'cards' | 'packs' // cards=候选单卡；packs=候选卡包
  cards?: Card[] // mode='cards' 时的候选卡牌（已去重/限定池）
  packs?: { label: string; cards: Card[] }[] // mode='packs' 时的候选卡包
  count: number // 需选数量
  min?: number // 最少选择数（默认=count；如"移除2张"允许只选1张时设 1）
  allowSkip?: boolean // 是否可跳过（默认 false）
  confirmless?: boolean // 免确认：点选一张立即结算（战斗奖励三选一用，跳过确认页）
}

export const useGameStore = defineStore('game', () => {
  // ===== 状态 =====
  const run = ref<RunState | null>(null) // 单局存档（null = 未开局）
  const battle = ref<CombatContext | null>(null) // 战斗上下文（BATTLE 阶段非空）
  const battleKind = ref<BattleKind>('normal') // 当前战斗类型（奖励分级依据）
  const pendingReward = ref<PendingReward | null>(null) // 战斗胜利待选奖励
  // 开局选中先古遗物后，屏幕正中的幕名提示（holding 当前幕 id；2 秒后自动清空触发缓慢淡出）
  const actSplash = ref<ActId | null>(null)
  let actSplashTimer: ReturnType<typeof setTimeout> | null = null
  // "首次进入地图"引导标志：本局首次进入地图（RUN 视图）时播放幕名提示 + 地图慢滚到当前层，
  // 之后完成节点/重新进入地图不再重复（mapIntroDone true 则跳过）
  const mapIntroDone = ref(false)
  const currentEvent = ref<string | null>(null) // 当前事件 id（EVENT 阶段）
  const battleResult = ref<CombatResult | null>(null) // 战斗结算结果
  // 商店状态：商品各自带"进店时定价"的价格（含会员卡折扣），UI 直接显示并据此购买
  // cards=上方战士卡(6) colorless=下方无色卡(2) relics=右侧遗物(3)，removeX=卡牌移除
  // originalPrice：随机打折卡的原价（保留用于 UI 显示删除线 + 绿色折后价，此时 price 已是折后价）
  const shopState = ref<{
    cards: Array<{ card: Card; price: number; originalPrice?: number }>
    colorless: Array<{ card: Card; price: number }>
    relics: Array<{ relic: Relic; price: number }>
    removeCount: number
    removeCost: number
    // 送货员：商品永远不会卖光（购买后不移除该商品）
    neverSell?: boolean
  } | null>(null)
  // 通用选牌请求（挂起式）：队列支持链式多轮（如树叶药膏先选打击再选防御）
  // UI 读取 pendingPicks[0] 渲染，玩家选完调用 resolvePick/skipPick 回传并弹出下一项
  const pendingPicks = ref<PickRequest[]>([])
  // 选牌请求自增序号（区分并发/链式请求的 id）
  const pickSeq = ref(0)
  // id → 玩家选完后的回传回调（非响应式，避免把函数塞进响应式状态；由 resolvePick 取出执行）
  const pickResolvers = new Map<number, (result: string[]) => void>()
  const eliteLoop = ref<string[]>([]) // 精英循环抽取池（3→2→1 重置）
  const message = ref('') // 顶部提示（遗物/事件/系统消息）
  const log = ref<string[]>([]) // 战斗日志（调试控制台/战斗记录）

  // 卡牌居中预览（事件/遗物获得卡牌时展示）：屏幕上居中显示获得的牌，1 秒后自动消失
  // 注意：消失的是"展示浮层"，卡牌本身已加入牌组（r.deck），不随浮层消失
  const revealedCards = ref<Card[] | null>(null)
  let revealTimer: ReturnType<typeof setTimeout> | null = null
  // 展示 1 组获得的卡牌；多次调用会重置计时，最后一次展示覆盖之前的（避免连续获得时闪现混乱）
  function revealCards(cards: Card[]): void {
    if (!cards.length) return
    revealedCards.value = cards
    if (revealTimer) clearTimeout(revealTimer)
    revealTimer = setTimeout(() => {
      revealedCards.value = null
      revealTimer = null
    }, 1000)
  }

  // 全卡组选卡请求（按"牌组实例"选择）：移除/变化/升级/附魔等需"指定某一张拷贝"的动作走此处
  // 与 pendingPicks(按候选卡 id) 不同，这里可选择到具体某一张（可区分 打击+ 与 打击）。
  // 支持多选：玩家反复"点卡→确认"，达到 count 后自动结算；达到 min 后可提前完成；allowSkip 可跳过。
  interface DeckChoiceRequest {
    id: number
    title: string
    hint?: string
    count: number // 需选张数（达到后自动结算）
    min: number // 可提前完成的最少张数
    allowSkip: boolean // 是否允许跳过
    filter: ((entry: DeckCard) => boolean) | null // 牌组实例过滤（排除"永恒"/仅未升级等）
    results: number[] // 已选牌组索引
    resolve: (indices: number[]) => void // 结算回调：交回所选"牌组索引数组"执行动作
  }
  const deckPicks = ref<DeckChoiceRequest[]>([])
  const deckPickSeq = ref(0)
  // 当前激活的全卡组选卡请求（队首；链式选卡在结算后弹出下一项）
  const activeDeckPick = computed(() => deckPicks.value[0] ?? null)
  // 当前请求可选（未选中）的牌组索引（按 filter 过滤，供 UI 渲染卡组网格）
  const activeDeckPickIndices = computed<number[]>(() => {
    const req = activeDeckPick.value
    const r = run.value
    if (!req || !r) return []
    const out: number[] = []
    r.deck.forEach((e, i) => {
      if ((!req.filter || req.filter(e)) && !req.results.includes(i)) out.push(i)
    })
    return out
  })
  // 挂起一次全卡组选卡；候选为空返回 false（不弹窗，调用方自行通知/跳链）
  function pickDeckCards(opts: {
    title: string
    hint?: string
    count: number
    min?: number
    allowSkip?: boolean
    filter?: (entry: DeckCard) => boolean
    resolve: (indices: number[]) => void
  }): boolean {
    const r = run.value
    if (!r) return false
    const candidateCount = r.deck.reduce(
      (acc, e) => acc + (opts.filter ? (opts.filter(e) ? 1 : 0) : 1),
      0,
    )
    if (candidateCount === 0) return false
    deckPicks.value.push({
      id: ++deckPickSeq.value,
      title: opts.title,
      hint: opts.hint,
      count: Math.min(opts.count, candidateCount),
      min: opts.min ?? opts.count,
      allowSkip: opts.allowSkip ?? false,
      filter: opts.filter ?? null,
      results: [],
      resolve: opts.resolve,
    })
    return true
  }
  // UI"选中/取消一张"（选卡阶段 toggle）：已选则移除、未选则加入（可再次点击取消选择）。
  // 不再在 store 层达到 count 即自动结算——改为由组件切到"确认页"，玩家点绿勾确认后才 finishDeckPick 结算。
  function confirmDeckPick(index: number): void {
    const req = activeDeckPick.value
    if (!req) return
    const at = req.results.indexOf(index)
    if (at >= 0)
      req.results.splice(at, 1) // 再次点击：取消选择
    else req.results.push(index)
  }
  // 提前完成（结果 ≥ min）或达到 count 后的统一结算
  function finishDeckPick(): void {
    const req = deckPicks.value.shift()
    if (!req) return
    req.resolve([...req.results])
  }
  // 跳过/取消当前全卡组选卡（allowSkip 时 UI"跳过"调用）
  function skipDeckPick(): void {
    const req = deckPicks.value.shift()
    if (!req) return
    req.resolve([])
  }

  // "进入当前节点前" 的快照（供暂停菜单→重打，PRD §3.11）
  // 保存 run 全文 + 精英循环池；重打时恢复该快照并重新进入节点（敌人重置、玩家 HP/金币/牌组/遗物恢复到进入前）
  const nodeSnapshot = ref<{ targetId: string; run: RunState; eliteLoop: string[] } | null>(null)

  // 深拷贝 RunState：run 是 Pinia 响应式对象，structuredClone 会因 Proxy 符号属性抛 DataCloneError，
  // 而 RunState 为纯 JSON 数据，用 JSON 序列化克隆既安全又可保留 Proxy 外部（快照/重打恢复用）
  function cloneRun(r: RunState): RunState {
    return JSON.parse(JSON.stringify(r)) as RunState
  }

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
  // @param act 选择的幕（缺省密林丘 overgrowth；暗港 underdocks 为第二幕）
  function newRun(seed?: number, act: ActId = 'overgrowth'): void {
    const s = seed ?? Math.floor(Math.random() * 0xffffffff)
    const map = generateMap(s, true)
    run.value = {
      version: SAVE.version,
      act,
      seed: s,
      floor: 1,
      nodeId: 'f1-r0',
      map,
      hp: PLAYER.maxHp,
      maxHp: PLAYER.maxHp,
      gold: PLAYER.startingGold,
      deck: PLAYER.startingDeck.map((id) => ({ id, upgrade: false })), // 初始牌组：每张独立为"未升级"实例
      relics: [...PLAYER.startingRelic],
      potions: [],
      fightCount: 0,
      bossDefeated: false,
      meta: { kills: 0, elitesKilled: 0 },
    }
    eliteLoop.value = [...ACT_ENCOUNTERS[act].eliteLoop]
    // 重置"首次进入地图"引导标志：本局首次进入地图时播放幕名提示 + 地图慢滚到当前层动画
    mapIntroDone.value = false
    unlockFloor(map, 1)
    stateMachine.force('RUN')
    // 开局直接触发先古之民：新局伊始即弹出第 1 层先古节点的遗物三选一浮层，
    // 选定后 claimRelicReward 才返回地图并解锁第 2 层（无需玩家先在地图上手动点击先古节点）
    offerNeow()
    persist()
  }

  // 继续存档：校验通过则恢复，失败提示
  function continueRun(): boolean {
    const saved = loadRun()
    if (!saved) return false
    run.value = saved
    // 续档（回到已进行的地图）：不再播放"首次进入地图"引导动画/幕名提示
    mapIntroDone.value = true
    // 兜底：当前节点已结算（visited，如奖励页退出时）但下一层尚未解锁时，直接解锁下一层，
    // 否则"当前节点不可重进 + 下一层 locked"双重拦截会让续档卡死在地图（正常已解锁时此操作幂等无副作用）
    const cur = saved.map.find((n) => n.id === saved.nodeId)
    if (cur?.visited) unlockFloor(saved.map, cur.floor + 1)
    stateMachine.force('RUN')
    persist()
    return true
  }

  // 丢弃当前局（返回主菜单）：清空存档 + 运行态
  // 使用 force('MENU') 而非 transition —— 调用方可能处于 BATTLE/SHOP 等阶段，
  // 这些阶段 TRANSITIONS 不含 MENU，用 transition 会抛"非法迁移"；放弃本局属受控操作，允许强制退出
  function abandonRun(): void {
    clearRun()
    run.value = null
    battle.value = null
    nodeSnapshot.value = null
    stateMachine.force('MENU')
  }

  // 重打当前节点（PRD §3.11）：恢复"进入该节点前"快照并重新进入该节点
  // 用于战斗/事件/商店/篝火/未知等：敌人重置为初始、玩家 HP/金币/牌组/遗物恢复到进入前，胜负/内容重打
  function restartNode(): boolean {
    const snap = nodeSnapshot.value
    const target = snap?.targetId
    if (!snap || !target) return false
    run.value = cloneRun(snap.run) // 恢复 run 全文（含 HP/金币/牌组/遗物/地图原状）
    eliteLoop.value = [...snap.eliteLoop] // 恢复精英循环抽取池
    battle.value = null // 清空旧战斗上下文（重新进入时重建）
    battleResult.value = null
    pendingReward.value = null
    currentEvent.value = null
    shopState.value = null
    message.value = ''
    stateMachine.force('RUN') // 先回地图层（受控），再重新进入以重建 BATTLE/EVENT/SHOP 等
    enterNode(target)
    return true
  }

  // 存档退出（PRD §3.11）：保存当前局返回主菜单
  // MVP 不保存节点现场（战斗/商店/篝火/事件）：进行中退出后继续游戏会重进该节点（等效重打），故 battle 一并清空。
  // 关键：节点进行中退出时须把当前节点 visited 重置回 false 再持久化——RunView 进入节点时已置 visited，
  // 若原样保存，续档后 useMap.isEnterable 要求 !visited，当前节点将永远无法重进（续档即卡死在地图）。
  // 已结算完（RUN/REWARD）退出时不动 visited，保持地图正常流转（当前节点不可重进、点下一层）。
  function saveAndExit(): void {
    const r = run.value
    const inNode = ['BATTLE', 'SHOP', 'CAMPFIRE', 'EVENT'].includes(stateMachine.current)
    if (r && inNode) {
      const node = r.map.find((n) => n.id === r.nodeId)
      if (node) node.visited = false
    }
    persist()
    battle.value = null
    stateMachine.force('MENU')
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
    // 保存"进入该节点前"完整快照（供重打，PRD §3.11）：
    // 仅当目标与当前不同节点时更新；此时 nodeId/floor 尚未被改，故拍下的是正确的"进入前"状态（HP/金币/牌组/遗物/地图全文）
    if (nodeId !== r.nodeId) {
      nodeSnapshot.value = {
        targetId: nodeId,
        run: cloneRun(r),
        eliteLoop: [...eliteLoop.value],
      }
    }
    const node = r.map.find((n) => n.id === nodeId)
    if (!node || node.locked) return
    // 可达性校验：只能进入"当前节点连线指向的下一层节点"，或开局尚未结算的当前节点本身；
    // 连通性由地图连线保证（中间层只连相邻节点、端点边可发散/汇聚跨列），故只校验连线而非硬性行差，
    // 防止绕过 UI 进入同层/上层/非连线节点
    const cur = r.map.find((n) => n.id === r.nodeId)
    if (
      cur &&
      node.id !== cur.id &&
      !(node.floor === cur.floor + 1 && cur.next.includes(node.id))
    ) {
      return
    }
    r.nodeId = nodeId
    r.floor = node.floor
    // 固定层：Boss 战（按幕取 Boss 池，三选一）
    if (node.type === 'boss') {
      startBattle([...ACT_ENCOUNTERS[r.act].boss], 'boss')
      return
    }
    if (node.type === 'monster') {
      startBattle(pickEncounter(), 'normal')
      return
    }
    if (node.type === 'unknown') {
      // 活动星图：每当你进入？房间的时候，回复 5 点生命（relic.md §活动星图，PASSIVE）
      if (r.relics.includes('astral_chart')) {
        const heal = Math.min(5, r.maxHp - r.hp)
        r.hp += heal
        if (heal > 0) message.value = `活动星图：回复 ${heal} 点生命`
      }
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
      startBattle(pickEliteEncounter(), 'elite') // 精英遭遇：单怪或同种多只（花园幽灵鳗×4）
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

  // 随机遭遇（前 3 场弱怪池，之后强怪池；按幕取池，PRD §3.2.2）
  function pickEncounter(): string[] {
    const r = run.value!
    const pools = ACT_ENCOUNTERS[r.act]
    const pool = r.fightCount < 3 ? pools.weak : pools.strong
    const idx = Math.floor(mulberry32(r.seed + r.fightCount * 7919)() * pool.length)
    return pool[idx] ?? pool[0] ?? ['fuzzy_wurm_crawler']
  }

  // 精英循环抽取（3→2→1 后重置，不重复；按幕取精英池）
  function pickElite(): string {
    if (eliteLoop.value.length === 0)
      eliteLoop.value = [...ACT_ENCOUNTERS[run.value!.act].eliteLoop]
    const r = run.value!
    const idx = Math.floor(mulberry32(r.seed + r.fightCount * 104729)() * eliteLoop.value.length)
    return eliteLoop.value.splice(idx, 1)[0]!
  }

  // 精英战斗遭遇：部分精英为多只同种怪（暗港·花园幽灵鳗 ×4，Underdocks.md §3.3）。
  // pickElite 仅返回单 ID，此处按需扩展为实际的遭遇数组
  function pickEliteEncounter(): string[] {
    const id = pickElite()
    return id === 'phantasmal_gardener' ? [id, id, id, id] : [id]
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
      {
        id: 'ironclad',
        name: '铁甲战士',
        hp: r.hp,
        maxHp: r.maxHp,
        deck: r.deck,
        gold: r.gold,
        relics: r.relics,
      },
      enemies.map((e) => ({ id: e.id, name: e.name, hp: e.hp, maxHp: e.maxHp })),
      mulberry32(r.seed + r.fightCount * 104729 + 7),
    )
    // 同步敌人完整数据（AI/招式/衍生物）
    ctx.enemies = enemies
    // 敌人实例 id 唯一化：多胞胎（同 def 复现）id 相同会破坏拖拽选目标与效果定位
    // uses 记录已占用 id，保证同一场战斗中每个敌人都有唯一可定位的 id（defId 保留原始 def）
    const uses = new Set<string>()
    for (const e of ctx.enemies) {
      e.id = uniqueEnemyId(e.id, (id) => uses.has(id))
      uses.add(e.id)
    }
    startCombat(ctx)
    // 已解锁剧情类上古遗物的战斗开始效果（relic.md §四；trigger 为 ON_COMBAT_START 的直接在此就地处理，
    // 避免触发 applyRelicEffect 默认空分支造成重复）
    // 皮草大衣：剩余 N 场战斗敌人仅 1 点生命（逐场递减）
    if ((r.meta.furCoatBattles ?? 0) > 0) {
      r.meta.furCoatBattles = (r.meta.furCoatBattles ?? 0) - 1
      for (const e of ctx.enemies) e.hp = 1
      log.value.push(`[皮草大衣] 敌人仅 1 点生命（剩余 ${r.meta.furCoatBattles} 场）`)
    }
    // 发光珍珠：每场战斗开始将一张「冷光」加入手牌
    if (r.relics.includes('glowing_pearl')) {
      ctx.hand.push({ id: 'cold_light', upgrade: false })
      log.value.push('[发光珍珠] 冷光加入手牌')
    }
    // 宝石面具：从抽牌堆将一张随机能力牌放入手牌，本回合免费打出
    if (r.relics.includes('gem_mask')) {
      const powerIdx = ctx.drawPile.findIndex((en) => getCard(en.id)?.type === 'power')
      if (powerIdx >= 0) {
        const moved = ctx.drawPile.splice(powerIdx, 1)[0]!
        ctx.hand.push(moved)
        ctx.freeThisTurn.add(moved.id)
        log.value.push('[宝石面具] 一张能力牌入手并本回合免费')
      }
    }
    // 大～抱抱：每场战斗开始向抽牌堆加入一张「煤灰」
    if (r.relics.includes('big_hug')) {
      ctx.drawPile.push({ id: 'soot', upgrade: false })
      log.value.push('[大～抱抱] 抽牌堆加入一张煤灰')
    }
    battle.value = ctx
    battleResult.value = null
    log.value = ['战斗开始！']
    stateMachine.transition('BATTLE')
    // 战斗开始遗物（灯笼/弹珠袋等）
    triggerRelicsOnCombatStart(ctx)
    // 壶铃：休息处获得的永久力量在每场战斗开始附加到玩家（relic.md §壶铃）
    if (r.relics.includes('kettlebell') && (r.meta.kettlebellStrength ?? 0) > 0) {
      ctx.player.strength += r.meta.kettlebellStrength ?? 0
      log.value.push(`[壶铃] 获得 ${r.meta.kettlebellStrength} 点力量`)
    }
    // 工具箱：战斗开始从 3 张随机无色牌中选择 1 张加入手牌（挂起选牌，战斗界面弹出）
    if (r.relics.includes('toolbox') && battle.value && ctx.hand.length < 10) {
      const pool = shuffleLocal(cardsData.colorless).slice(0, 3)
      ctx.pendingPicks.push({
        pickId: ++ctx.pickSeq,
        title: '工具箱',
        cards: pool,
        action: 'addToHand', // 选中入手（无保留）
      })
    }
    // 轰鸣海螺：精英战开始时额外抽 2 张牌并获得 1 点能量（relic.md）
    if (kind === 'elite' && r.relics.includes('booming_conch')) {
      ctx.energy += 1
      for (let i = 0; i < 2; i++) {
        if (ctx.drawPile.length === 0 && ctx.discardPile.length > 0) {
          ctx.drawPile.push(...shuffleLocal(ctx.discardPile))
          ctx.discardPile.length = 0
        }
        const card = ctx.drawPile.pop()
        if (card) ctx.hand.push(card)
      }
      log.value.push('[轰鸣海螺] 精英战：额外 1 点能量并抽 2 张')
    }
    // 选择悖论：每场战斗开始时，从 5 张随机牌中选择 1 张放入手牌，被选中的牌获得保留
    if (r.relics.includes('choice_paradox') && battle.value && ctx.hand.length < 10) {
      const pool = shuffleLocal(cardsData.warrior.filter((c) => c.rarity !== 'basic')).slice(0, 5)
      ctx.pendingPicks.push({
        pickId: ++ctx.pickSeq,
        title: '选择悖论',
        cards: pool,
        action: 'addToHandRetain', // 选中入手并获得保留
      })
    }
    // 桥接战斗内选牌请求到通用选牌浮层（选择悖论等在开局挂起的选牌立即弹出）
    bridgeCombatPicks()
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
      case 'whetstone':
      case 'war_paint':
      case 'mango':
      case 'pear':
      case 'old_coin':
      case 'waffle':
      case 'nutritious_oyster':
      case 'golden_pearl':
      case 'cursed_pearl':
      case 'fragrant_mushroom':
      case 'stone_humidifier':
        // 这些在拾起（onRelicGained ON_PICKUP）或战斗内钩子中处理，此处跳过
        break
      // —— 战斗开始型通用遗物 ——
      case 'throat_guard':
        // 护喉甲：战斗开始 +4 层覆甲
        ctx.player.armor += 4
        log.value.push('[护喉甲] 获得 4 层覆甲')
        break
      case 'confetti_cannon':
        // 节日拉炮：战斗开始对所有敌人造成 9 点伤害
        for (const e of ctx.enemies) {
          if (!e.alive) continue
          const dealt = Math.min(e.hp, Math.max(0, e.hp - 9))
          const dmg = e.hp - dealt
          e.hp = dealt
          if (e.hp <= 0) e.alive = false
          log.value.push(`[节日拉炮] 对 ${e.name} 造成 ${dmg} 点伤害`)
        }
        break
      case 'copper_scales':
        // 铜质鳞片：战斗开始 +3 层荆棘
        ctx.player.statuses.push({ id: 'thorns', amount: 3, turns: 999 })
        log.value.push('[铜质鳞片] 获得 3 层荆棘')
        break
      case 'smooth_stone':
        // 意外光滑的石头：战斗开始 +1 敏捷
        ctx.player.dexterity += 1
        log.value.push('[意外光滑的石头] 获得 1 点敏捷')
        break
      case 'prep_bag':
        // 准备背包：战斗开始额外抽 2 张牌
        for (let i = 0; i < 2; i++) {
          if (ctx.drawPile.length === 0 && ctx.discardPile.length > 0) {
            ctx.drawPile.push(...shuffleLocal(ctx.discardPile))
            ctx.discardPile.length = 0
          }
          const card = ctx.drawPile.pop()
          if (card) ctx.hand.push(card)
        }
        log.value.push('[准备背包] 额外抽 2 张牌')
        break
      case 'blood_vial':
        // 小血瓶：战斗开始回复 2 点生命
        ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + 2)
        log.value.push('[小血瓶] 回复 2 点生命')
        break
      case 'red_bull':
        // 赤牛：战斗开始 +8 层活力
        ctx.player.statuses.push({ id: 'vigor', amount: 8, turns: 2 })
        log.value.push('[赤牛] 获得 8 层活力')
        break
      case 'jade_sword':
        // 玉之剑：战斗开始 +3 力量
        ctx.player.strength += 3
        log.value.push('[玉之剑] 获得 3 点力量')
        break
      case 'royal_poison':
        // 王室猛毒：战斗开始失去 4 点生命
        ctx.player.hp = Math.max(1, ctx.player.hp - 4)
        log.value.push('[王室猛毒] 失去 4 点生命')
        break
      case 'courage_sling':
        // 勇气投石索：与精英敌人战斗时 +2 力量
        if (battleKind.value === 'elite') {
          ctx.player.strength += 2
          log.value.push('[勇气投石索] 精英战获得 2 点力量')
        }
        break
      case 'big_mushroom': {
        // 大蘑菇：战斗开始少抽 2 张牌（将初始手牌末尾 2 张放回抽牌堆）
        const mushroomRemoved = ctx.hand.splice(Math.max(0, ctx.hand.length - 2), ctx.hand.length)
        ctx.drawPile.push(...mushroomRemoved)
        log.value.push('[大蘑菇] 战斗开始少抽 2 张牌')
        break
      }
      // —— 事件/先古战斗开始类遗物 ——
      case 'rude_tea':
        // 无礼之茶：将 2 张晕眩放入抽牌堆（未升级实例）
        ctx.drawPile.push({ id: 'dizzy', upgrade: false }, { id: 'dizzy', upgrade: false })
        log.value.push('[无礼之茶] 将 2 张晕眩放入抽牌堆')
        break
      case 'ember_tea': {
        // 余烬茶：接下来 5 场战斗开始时 +2 力量（逐场递减剩余场数）
        const r = run.value!
        const left = r.meta.emberTeaLeft ?? 5
        if (left > 0) {
          ctx.player.strength += 2
          r.meta.emberTeaLeft = left - 1
          log.value.push(`[余烬茶] 获得 2 点力量（剩余 ${left - 1} 场）`)
        }
        break
      }
      case 'old_tea_set': {
        // 古茶具套装：到达休息处后的下一场战斗开始 +2 能量
        const r = run.value!
        if (r.meta.oldTeaReady) {
          ctx.energy += 2
          r.meta.oldTeaReady = false
          log.value.push('[古茶具套装] 获得 2 点能量')
        }
        break
      }
      case 'old_tea_set_ev': {
        // 古茶具套装（？？？变体）：到达休息处后的下一场战斗开始 +1 能量
        const r = run.value!
        if (r.meta.oldTeaReadyEv) {
          ctx.energy += 1
          r.meta.oldTeaReadyEv = false
          log.value.push('[古茶具套装（？？？）] 获得 1 点能量')
        }
        break
      }
      case 'bone_tea': {
        // 骨茶：升级本场战斗的初始手牌（按实例标记升级）
        for (const en of ctx.hand) {
          en.upgrade = true
        }
        log.value.push('[骨茶] 升级初始手牌')
        break
      }
      case 'anchor_ev':
        // 锚？？？（事件变体）：战斗开始获得 4 点格挡
        ctx.player.block += 4
        log.value.push('[锚？？？] 获得 4 点格挡')
        break
      case 'blood_vial_ev':
        // 小血瓶？？？（事件变体）：战斗开始回复 1 点生命
        ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + 1)
        log.value.push('[小血瓶？？？] 回复 1 点生命')
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
    // 取手牌中该 id 的卡实例（决定该张是否已升级；同名多张取最先匹配，MVP 简化）
    const entry = ctx.hand.find((en) => en.id === cardId) ?? { id: cardId, upgrade: false }
    const ok = enginePlayCard(ctx, entry, targetId)
    if (ok) {
      // 结算产生战斗内选牌（发现/秘密技法等）→ 桥接给通用选牌浮层
      bridgeCombatPicks()
      log.value.push(...ctx.log.slice(-8))
      const result = checkResult(ctx)
      battleResult.value = result
      if (result.status === 'victory') onVictory()
      else if (result.status === 'defeat') onDefeat()
    }
    return ok
  }

  // 把战斗上下文里挂起的选牌请求（chooseAdd 效果产生）转发给通用选牌浮层
  // 玩家选完后把选中牌回填到手牌（免费标记则由 action 决定加入 freeThisTurn）
  function bridgeCombatPicks(): void {
    const ctx = battle.value
    if (!ctx || ctx.pendingPicks.length === 0) return
    for (const req of ctx.pendingPicks) {
      offerPick(
        { title: req.title, mode: 'cards' as const, cards: req.cards, count: 1, allowSkip: true },
        (ids) => {
          const chosen = ids[0]
          if (!chosen || !ctx) return
          const card = getCard(chosen)
          const inst = { id: chosen, upgrade: false }
          ctx.hand.push(inst)
          if (req.action === 'addToHandFree') ctx.freeThisTurn.add(chosen)
          // 选择悖论：被选出牌获得"保留"（跨回合留手）
          if (req.action === 'addToHandRetain') ctx.retainHandCards?.add(chosen)
          log.value.push(`选择【${card?.name ?? chosen}】加入手牌`)
        },
      )
    }
    ctx.pendingPicks = []
  }

  // 结束玩家回合：敌人行动 → 新回合（PRD §3.3.2）
  // 复用引擎 startPlayerTurn 完成"回能量 + 抽牌 + 遗物回合开始钩子（红头骨/硫磺/灯笼/开心小花/冰淇淋结转等）+ 坚固钳子保留格挡"
  function endTurn(): void {
    const ctx = battle.value
    if (!ctx) return
    // 回合结束手牌结算（引擎统一处理）：手牌内在触发（灼伤/毒素/悔恨等）+ 虚无消耗 + 保留留手 + 其余弃牌
    // 符文金字塔或"本回合保留手牌"（均衡/箭雨）：全员保留手牌（retainAll）
    resolveHandEndOfTurn(ctx, {
      retainAll: (run.value?.relics.includes('runic_pyramid') ?? false) || ctx.retainHandThisTurn,
    })
    enemyTurn(ctx)
    log.value.push(...ctx.log.slice(-8))
    const result = checkResult(ctx)
    battleResult.value = result
    if (result.status === 'victory') return onVictory()
    if (result.status === 'defeat') return onDefeat()
    // 新回合：能量重置 + 遗物回合开始 + 抽牌（引擎统一处理）
    startPlayerTurn(ctx, 5)
    for (const e of ctx.enemies) if (e.alive) e.block = 0
    setEnemyIntents(ctx)
    log.value.push(...ctx.log.slice(-12))
    log.value.push(`—— 第 ${ctx.turn} 回合 ——`)
  }

  // 战斗胜利：燃烧之血回血 + 生成奖励（PRD §3.3.5 / §3.13）
  function onVictory(): void {
    const r = run.value
    const ctx = battle.value
    if (!r || !ctx) return
    // 战斗结束回血遗物（通用机制，不硬编码数值——数值含义见 relic.md / gameConfig）
    const bloodHeal = r.relics.includes('black_blood')
      ? RELIC.relicHeal.blackBlood
      : r.relics.includes('burning_blood')
        ? REWARD.bloodHeal
        : 0
    if (bloodHeal > 0) {
      r.hp = Math.min(r.maxHp, r.hp + bloodHeal)
      log.value.push(
        `[${r.relics.includes('black_blood') ? '黑暗之血' : '燃烧之血'}] 回复 ${bloodHeal} 点生命`,
      )
    }
    // 带骨肉：战斗结束时生命 ≤50% 回复 12（PRD §3.8）
    if (r.relics.includes('meat_on_the_bone') && r.hp <= r.maxHp / 2) {
      const heal = RELIC.relicHeal.meatOnTheBone
      r.hp = Math.min(r.maxHp, r.hp + heal)
      log.value.push(`[带骨肉] 回复 ${heal} 点生命`)
    }
    // 统计击杀
    const dead = ctx.enemies.filter((e) => !e.alive).length
    r.meta.kills += dead
    r.fightCount++
    // 天选芝士：战斗结束获得 1 点最大生命
    if (r.relics.includes('chosen_cheese')) {
      r.maxHp += 1
      r.hp += 1
      log.value.push('[天选芝士] 最大生命 +1')
    }
    // 紫水晶茄子：敌人额外掉落 15 金币（按击杀数累加）
    if (r.relics.includes('amethyst_eggplant') && dead > 0) {
      const g = 15 * dead
      gainGold(g)
      log.value.push(`[紫水晶茄子] 额外掉落 ${g} 金币`)
    }
    // 钓鱼竿：每打完 3 场普通战斗，随机升级牌组中一张牌（relic.md）
    if (battleKind.value === 'normal' && r.relics.includes('fishing_rod')) {
      r.meta.fishingStreak = (r.meta.fishingStreak ?? 0) + 1
      if ((r.meta.fishingStreak ?? 0) % 3 === 0) {
        const idx = randomUpgradableIndex(() => () => Math.random())
        if (idx >= 0) {
          upgradeAt(idx)
          log.value.push('[钓鱼竿] 随机升级了一张牌')
        }
      }
    }
    // 疯狂科学（事件卡变体9，能力卡）：战斗结束时升级牌组中一张随机牌（类比钓鱼竿逻辑）
    if (ctx.powers?.has('crazy_science_9')) {
      const sci9Idx = randomUpgradableIndex(() => () => Math.random())
      if (sci9Idx >= 0) {
        upgradeAt(sci9Idx)
        log.value.push('[疯狂科学] 战斗结束升级了一张随机牌')
      }
    }
    // 石之剑：击败 5 名精英后变化为玉之剑（relic.md §石之剑→玉之剑；elitesKilled 由精英战结算累加）
    if (r.relics.includes('stone_sword') && r.meta.elitesKilled >= 5) {
      const si = r.relics.indexOf('stone_sword')
      r.relics[si] = 'jade_sword'
      log.value.push('[石之剑] 已击败 5 名精英，变化为玉之剑')
      message.value = '石之剑在经历 5 场精英战后变成了玉之剑！'
    }
    // 神秘券：打满 5 场战斗后一次性获得 3 件随机遗物（relic.md §神秘券，PASSIVE）
    if (r.relics.includes('mystery_ticket') && !r.meta.mysteryTicketDone && r.fightCount >= 5) {
      r.meta.mysteryTicketDone = true
      message.value = '神秘券：获得 3 件随机遗物'
      for (let k = 0; k < 3; k++) {
        const mr = rollRelicDrop()
        if (mr) {
          r.relics.push(mr.id)
          onRelicGained(mr.id) // 拾起即生效（草莓等立即效果）
          log.value.push(`[神秘券] 获得遗物【${mr.name}】`)
        }
      }
    }
    r.hp = ctx.player.hp
    r.gold = ctx.gold
    // 佩尔之牙：每场战斗结束时，从已移除牌中随机取 1 张升级后返还牌组（relic.md §四·佩尔）
    if (r.relics.includes('percy_tooth') && (r.meta.percyToothRemoved?.length ?? 0) > 0) {
      const pool = r.meta.percyToothRemoved!
      const chosen = pool.splice(
        Math.floor(mulberry32(r.seed + r.fightCount * 449)() * pool.length),
        1,
      )[0]
      if (chosen) {
        // 佩尔之牙返还：按新"卡实例"入组（upgrade 默认为 false），随后升级该实例
        r.deck.push({ id: chosen, upgrade: false })
        upgradeAt(r.deck.length - 1)
        log.value.push(`[佩尔之牙] 返还并升级了「${getCard(chosen)?.name ?? chosen}」`)
      }
    }
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
    // 浮木：每次新奖励时重置"是否已重掷"标记（许可每奖励至多重掷一次）
    r.meta.flotsamRerolled = false
    const rng = mulberry32(r.seed + r.fightCount * 217)
    const [gMin, gMax] = kind === 'elite' ? REWARD.gold.elite : REWARD.gold.monster
    const gold = Math.floor(rng() * (gMax - gMin + 1)) + gMin
    // 圆顶礼帽：额外获得 25% 的金币（向下取整）
    const goldFinal = r.relics.includes('bowler_hat') ? gold + Math.floor(gold * 0.25) : gold
    gainGold(goldFinal)
    // 卡牌奖励"白/蓝/金"档位（PRD §3.3.5 + 需求）：按战斗类型重量随机抽档，决定保底稀有度
    const tier = rollCardRewardTier(rng, kind)
    // 抽 3 张奖励卡（保底档位稀有度，每张小概率升一级：白→罕见、蓝→稀有、金保持稀有）
    let cards = pickCardRewards(rng, tier)
    // 白银熔炉：前 3 次卡牌奖励会被升级（relic.md；扣除剩余次数）
    if (r.relics.includes('silver_crucible') && (r.meta.silverRewards ?? 0) > 0) {
      r.meta.silverRewards = (r.meta.silverRewards ?? 0) - 1
      cards = cards.map((c) => {
        c.upgrade = true // 标记升级，渲染时用 upgradeEffects/upgradeDesc
        return c
      })
    }
    // 金币已入账（含圆顶礼帽加成计入 goldFinal），goldClaimed 供"点击金币行领取后消失"标记
    const result: PendingReward = {
      kind: 'card',
      cards,
      gold: goldFinal,
      cardTier: tier,
      goldClaimed: false,
      cardClaimed: false,
    }
    // 精英必掉 1 件遗物（PRD §3.3.5；黑星→+1 件）：直接入库，页面展示
    if (kind === 'elite') {
      const dropped = rollRelicDrop()
      if (dropped) {
        r.relics.push(dropped.id)
        onRelicGained(dropped.id) // 拾起即生效（草莓等）
        result.relics = []
        pushRewardRelic(result, dropped)
      }
      // 黑星：精英战额外掉落 1 件遗物（relic.md）
      if (r.relics.includes('black_star')) {
        const extra = rollRelicDrop()
        if (extra) {
          r.relics.push(extra.id)
          onRelicGained(extra.id)
          pushRewardRelic(result, extra)
        }
      }
    }
    return result
  }

  // 把掉落遗物追加到奖励列表并记录消息（黑星可能多件）
  function pushRewardRelic(result: PendingReward, relic: Relic): void {
    result.relics = result.relics ?? []
    result.relics.push(relic)
  }

  // 遗物掉落（从通用/战士池抽取未拥有的）
  function rollRelicDrop(): Relic | undefined {
    const r = run.value!
    const pool = [...relicsData.general, ...relicsData.warrior].filter(
      (x) => !x.excluded && !r.relics.includes(x.id) && !isFakeRelic(x.id),
    )
    if (pool.length === 0) return undefined
    const idx = Math.floor(mulberry32(r.seed + r.fightCount * 331)() * pool.length)
    return pool[idx]
  }

  // 稀有度阶梯（卡牌奖励档位用）：common → uncommon → rare（金档为顶不再升级）
  const RARITY_STEP: CardRarity[] = ['common', 'uncommon', 'rare']

  // "下一级稀有度"：白→蓝(罕见)、蓝→金(稀有)、金保持稀有（无更高档）
  function nextRarity(r: CardRarity): CardRarity {
    const i = RARITY_STEP.indexOf(r)
    return i < 0 || i >= RARITY_STEP.length - 1 ? r : RARITY_STEP[i + 1]!
  }

  // 随机决定本次卡牌奖励档位（白/蓝/金）：按战斗类型权重抽 common/uncommon/rare
  function rollCardRewardTier(rng: () => number, kind: BattleKind): CardRarity {
    const w = REWARD.cardRarityChance[kind]
    const roll = rng()
    return roll < w.common ? 'common' : roll < w.common + w.uncommon ? 'uncommon' : 'rare'
  }

  // 抽 3 张奖励卡（按档位）：每张候选卡"保底档位稀有度，小概率（tierUpgradeChance）升一级"，
  // 保证三张互不相同（同 id 去重），金档保持稀有不再升级
  function pickCardRewards(rng: () => number, tier: CardRarity): Card[] {
    const pool = cardsData.warrior.filter((c) => c.rarity !== 'basic' && c.rarity !== 'ancient')
    const picked: Card[] = []
    const used = new Set<string>()
    while (picked.length < REWARD.cardChoices) {
      // 每张卡独立判定：命中小概率则升一级稀有度，否则保持档位稀有度
      const rarity = rng() < REWARD.tierUpgradeChance ? nextRarity(tier) : tier
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

  // 领取卡牌奖励：把选中的卡加入牌组后标记"卡牌已领取"（行消失），但不出奖励页——
  // 玩家随后可继续领金币或点"前往地图"统一离开（需求：获得卡牌后回到奖励页面）
  function claimCardReward(cardId: string | null): void {
    const r = run.value
    const pr = pendingReward.value
    if (!r || !pr || pr.kind !== 'card') return
    if (!cardId) return // 无 cardId（跳过）不消耗奖励；跳过由 openCardRewardChoice 的 onPick([]) 保持奖励实现
    // 熔火之蛋/冻结之蛋/毒素之蛋：获得对应类型的牌时自动升级（relic.md）——仅该新实例升级
    const c = getCard(cardId)
    const autoUpgrade =
      c !== undefined &&
      c !== null &&
      ((r.relics.includes('molten_egg') && c.type === 'attack') ||
        (r.relics.includes('frozen_egg') && c.type === 'power') ||
        (r.relics.includes('toxic_egg') && c.type === 'skill'))
    // 附魔类遗物被动：菲涅耳透镜（带格挡→灵巧）在加入牌组入口统一处理
    applyRelicEnchantOnAdd(cardId)
    // 新增为独立"卡实例"（upgrade 依据三蛋遗物判定），不再影响牌组中已有同名卡
    r.deck.push({ id: cardId, upgrade: !!autoUpgrade })
    // 附魔类遗物被动：羽翼护符/亮片/华美发束（对领取的牌挂载附魔）
    applyRelicEnchantOnClaim(cardId)
    // 标记已领取（行消失）并清空候选；停留奖励页等待玩家"前往地图"
    pr.cardClaimed = true
    pr.cards = []
  }

  // 领取金币：金币在奖励生成时已入账（含圆顶礼帽加成），此处仅标记"已领取"使金币行消失
  function claimGold(): void {
    const pr = pendingReward.value
    if (!pr || pr.kind !== 'card') return
    pr.goldClaimed = true
  }

  // 领取金币（无卡可选时）
  function claimGoldOnly(): void {
    pendingReward.value = null
    advanceAfterReward()
  }

  // 打开"卡牌奖励"三选一：把当前奖励的 3 张候选卡直接交给通用选牌浮层（PickCardsModal）展示。
  // 免确认（confirmless）：点任意一张立即领取入组（无需确认页），随后回到奖励页；点"跳过"→回到奖励页且奖励保留。
  function openCardRewardChoice(): void {
    const pr = pendingReward.value
    if (!pr || pr.kind !== 'card' || !pr.cards || pr.cards.length === 0) return
    offerPick(
      {
        title: '战斗奖励：选择一张卡牌',
        mode: 'cards',
        cards: pr.cards,
        count: 1, // 3 选 1：点选即领取（confirmless 免确认）
        allowSkip: true, // 跳过：返回奖励页且卡牌奖励不消失
        confirmless: true, // 免确认：点击任意一张直接结算
      },
      (ids) => {
        // 选中一张即领取；跳过（ids 为空）则保持奖励不变，仅关闭浮层回到奖励页
        if (ids.length > 0) claimCardReward(ids[0]!)
      },
    )
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
  // 星系仪/玻璃眼珠：若还有"额外卡牌奖励"剩余，先消费 1 次并弹出纯卡牌奖励页，而非直接去地图
  function forwardToMap(): void {
    const r = run.value
    if (!r || !pendingReward.value) return
    pendingReward.value = null
    if ((r.meta.extraCardRewards ?? 0) > 0) {
      grantExtraCardReward()
      return
    }
    advanceAfterReward()
  }

  // 提供一次"仅卡牌"的额外奖励（星系仪 +5 / 玻璃眼珠 +5 的逐次消费落地）
  // 与普通奖励页共用 REWARD 界面：无金币、无遗物，只展示 3 张卡牌供三选一
  function grantExtraCardReward(): void {
    const r = run.value
    if (!r) return
    r.meta.extraCardRewards = (r.meta.extraCardRewards ?? 0) - 1
    // 以"剩余次数"为盐生成确定性随机数，保证每次额外奖励内容可复现且不重复
    const rng = mulberry32(r.seed + r.fightCount * 317 + (r.meta.extraCardRewards ?? 0))
    const tier = rollCardRewardTier(rng, 'normal')
    let cards = pickCardRewards(rng, tier)
    // 白银熔炉：额外奖励同样享受前几次升级
    if (r.relics.includes('silver_crucible') && (r.meta.silverRewards ?? 0) > 0) {
      r.meta.silverRewards = (r.meta.silverRewards ?? 0) - 1
      cards = cards.map((c) => {
        c.upgrade = true // 标记升级，渲染时用 upgradeEffects/upgradeDesc
        return c
      })
    }
    pendingReward.value = {
      kind: 'card',
      cards,
      gold: undefined, // 无金币：RewardPanel 以 gold !== undefined 判断是否显示金币行
      cardTier: tier,
      goldClaimed: false,
      cardClaimed: false,
    }
    // 已是 REWARD（奖励页直接推进）则原地更新；否则（如战斗胜直接结算）显式进入 REWARD
    if (stateMachine.current !== 'REWARD') {
      stateMachine.transition('REWARD')
    }
    persist()
  }

  // 奖励后推进：解锁下一层并回到地图
  // 调用方可能已处于 RUN（如事件直接结算后仍在 RUN），transition('RUN') 需先判断当前状态，
  // 避免从 RUN 迁移到 RUN 触发"非法状态迁移"报错
  function advanceAfterReward(): void {
    const r = run.value
    if (!r) return
    const node = r.map.find((n) => n.id === r.nodeId)
    const nextFloor = node ? node.floor + 1 : r.floor + 1
    unlockFloor(r.map, nextFloor)
    battle.value = null
    if (stateMachine.current !== 'RUN') {
      stateMachine.transition('RUN')
    }
    persist()
  }

  // ===== 事件 =====
  // 进入事件：从事件池随机（按幕过滤：任意阶段 + 本幕专属；剔除依赖药水/多人的）
  function enterEvent(): void {
    const r = run.value!
    const stage = ACTS[r.act].stage
    const pool = eventsData.events.filter(
      (e) => !e.excluded && (e.stage === 'any' || e.stage === stage),
    )
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
        // 事件专属战斗：按事件配置敌方（茂密的植被 4 扭动虫；重拳出击 2 强盗；灯火钥匙 虚空泰坦）
        const roster: Record<string, string[]> = {
          dense_vegetation: ['wriggler', 'wriggler', 'wriggler', 'wriggler'],
          punch_off: ['fuzzy_wurm_crawler', 'shrinker_beetle'],
          the_lantern_key: ['vantom'],
        }
        startBattle(roster[evId] ?? ['wriggler'], 'normal')
        currentEvent.value = null
        return
      }
      applyEventEffect(ev.id, optionText)
    }
    currentEvent.value = null
    // 事件完成后推进：解锁下一层并回到地图
    // （修复"未知节点进入事件后无法走进下一层"：此前仅切回 RUN，从未 unlockFloor）
    advanceAfterReward()
  }

  // 事件效果执行（按事件 ID 精确分发，覆盖 document/event.md 全部 57 个事件）
  // 能由现有系统（金币/生命/遗物/加减牌/升级/变化/复制/降级/交换遗物/附魔）实现的效果全部实现；
  // 依赖未实现子系统（药水/事件战斗之特殊/自定义卡等）的选项保留中文提示
  function applyEventEffect(eventId: string, option: string): void {
    const r = run.value!
    // 本事件确定性随机源：以楼层为盐、以不同事件字段加盐，保证可复现
    const rand = (salt: number): number => mulberry32(r.seed + r.floor * (101 + salt))()
    // 柯里化随机源（供 removeRandomCards/transformFirst/randomUpgradableIndex 这类
    // "() => () => number" 签名的辅助函数复用，避免与 rand 直接返回数值冲突）
    const gen = (salt: number): (() => number) => mulberry32(r.seed + r.floor * (101 + salt))
    // 区间随机整数 [lo, hi]
    const range = (lo: number, hi: number): number => lo + Math.floor(rand(hi) * (hi - lo + 1))
    const notify = (msg: string): void => void (message.value = msg)

    // —— 卡池（数据驱动，取自 cards.json 分组） ——
    const commonPool = cardsData.warrior.filter((c) => c.rarity === 'common') // 普通牌池
    const powerPool = cardsData.warrior.filter((c) => c.type === 'power') // 能力牌池
    const zeroCostPool = cardsData.warrior.filter((c) => c.cost === 0) // 耗能 0 牌池

    // —— 通用结算小工具（数值取自事件选项文本） ——
    // 金币变动：dir 为 -1 表示失去/支付，+1 表示获得
    const gold = (lo: number, hi: number, dir: 1 | -1): void => {
      const g = range(lo, hi)
      // 失去/支付直接扣减；获得走 gainGold（结算火龙果等"获得金币"遗物）
      if (dir === -1) r.gold = Math.max(0, r.gold - g)
      else gainGold(g)
      notify(`金币 ${dir === -1 ? '-' : '+'}${g}`)
    }
    // 失去生命（下限 0）
    const loseHp = (n: number, msg?: string): void => {
      r.hp = Math.max(0, r.hp - n)
      notify(msg ?? `失去 ${n} 点生命`)
    }
    // 回复生命（不超最大生命）
    const heal = (n: number): void => {
      r.hp = Math.min(r.maxHp, r.hp + n)
      notify(`回复 ${n} 点生命`)
    }
    // 按最大生命的百分比回复（深渊浴场/螺旋漩涡/茂密植被等"回复 X%最大生命"）
    const healPct = (pct: number): void => {
      const n = Math.floor((r.maxHp * pct) / 100)
      r.hp = Math.min(r.maxHp, r.hp + n)
      notify(`回复 ${pct}% 最大生命（${n} 点）`)
    }
    // 最大生命变动（n 可为正/负，下限 1，并夹紧当前生命）
    const maxHp = (n: number): void => {
      r.maxHp = Math.max(1, r.maxHp + n)
      r.hp = Math.min(r.hp, r.maxHp)
      notify(n >= 0 ? `最大生命 +${n}` : `最大生命 ${n}`)
    }
    // 随机发放一件未持有遗物（含拾起即生效结算）；note 用于标注未具名的专属遗物
    const grantRelic = (note = ''): void => {
      const pool = relicsData.general.filter(
        (x) => !x.excluded && !r.relics.includes(x.id) && !isFakeRelic(x.id),
      )
      const relic = pool[Math.floor(rand(17) * pool.length)]
      if (relic) {
        r.relics.push(relic.id)
        onRelicGained(relic.id) // ON_PICKUP（草莓等）
        notify(`获得遗物【${relic.name}】${note}`)
      } else {
        notify('没有可以获得的遗物')
      }
    }
    // 随机升级一张未升级牌
    const upgradeRandom = (): void => {
      const idx = randomUpgradableIndex(() => gen(53))
      if (idx >= 0) {
        upgradeAt(idx)
        notify('随机升级一张牌')
      } else {
        notify('没有可以升级的牌')
      }
    }
    // 变化一张随机牌
    const transformRandom = (msg = '变化一张牌'): void => {
      transformFirst(() => gen(59))
      notify(msg)
    }
    // 移除 n 张随机牌，提示实际移除数量
    const removeRandom = (n: number, msg = ''): void => {
      const before = r.deck.length
      removeRandomCards(() => gen(61), n)
      notify(msg || `移除 ${before - r.deck.length} 张牌`)
    }
    // 从牌组中按 id 移除 n 张（含重复；返回实际移除数；熔合者/修禅织网者等）；"永恒"牌不可移除
    const removeFromDeckById = (id: string, n: number): number => {
      let done = 0
      for (let i = r.deck.length - 1; i >= 0 && done < n; i--) {
        if (r.deck[i]!.id === id && !isUniqueCard(id)) {
          r.deck.splice(i, 1)
          done++
        }
      }
      return done
    }
    // 加入一张卡，卡数据缺失时跳过并提示
    const addCard = (id: string, idName: string): void => {
      if (getCard(id)) {
        r.deck.push({ id, upgrade: false })
        // 卡牌居中展示：把新获得的这张牌在屏幕正中展示 1 秒（浮层消失，牌留在牌组）
        revealCards([getCard(id) as Card])
        notify(`将一张【${idName}】加入牌组`)
      } else {
        notify(`【${idName}】卡数据缺失，暂未加入`)
      }
    }

    // —— 按事件 ID 分发结算（全部 57 个事件） ——
    switch (eventId) {
      // ===== 任意阶段 =====
      // 自助指南：读完整本→能力牌附魔迅速；随便读→技能牌附魔灵巧；读封底→攻击牌附魔锋利
      case 'self_help_book':
        if (option === '读完整本书') {
          pickEnchantCards({
            title: '自助指南',
            hint: '选择 1 张能力牌附魔「迅速」',
            enchant: 'swift',
            count: 1,
            filter: (c) => c.type === 'power',
          })
        } else if (option === '随便读个一段') {
          pickEnchantCards({
            title: '自助指南',
            hint: '选择 1 张技能牌附魔「灵巧」',
            enchant: 'nimble',
            count: 1,
            filter: (c) => c.type === 'skill',
          })
        } else if (option === '读下封底') {
          pickEnchantCards({
            title: '自助指南',
            hint: '选择 1 张攻击牌附魔「锋利」',
            enchant: 'sharp',
            count: 1,
            filter: (c) => c.type === 'attack',
          })
        }
        break

      // 滑脚木桥：跨越移除 1 随机牌；再撑一会失去 3 生命并重掷（重掷逻辑简化）
      case 'slippery_bridge':
        if (option === '跨越') removeRandom(1)
        else loseHp(3, '再撑一会：失去 3 点生命，并重新随机(简化)')
        break

      // 药水的未来？：整事件被剔除（依赖药水系统）
      case 'the_future_of_potions':
        notify('药水的未来？：依赖药水系统，当前不可用')
        break

      // 这个还是那个？：失去 6 生命得 41-68 金币；或得笨拙+随机遗物
      case 'this_or_that':
        if (option === '这个') {
          loseHp(6)
          gold(41, 68, 1)
        } else {
          addDeckCard('clumsy')
          grantRelic()
        }
        break

      // ===== 密林幕（overgrowth） =====
      // 混沌芳香：变化 1 牌 / 升级 1 牌
      case 'aroma_of_chaos':
        if (option === '放任自流') transformRandom()
        else upgradeRandom()
        break

      // 多尼斯异鸟巢：最大生命 +7；或带走一颗蛋（蛋卡数据缺失则提示）
      case 'byrdonis_nest':
        if (option === '吃掉这颗蛋') maxHp(7)
        else addCard('byrdonis_egg', '多尼斯异鸟蛋')
        break

      // 茂密的植被：坚持跋涉得 61-99 金币并失去 8 生命；「休息」为事件战斗另一分支处理
      case 'dense_vegetation':
        gold(61, 99, 1)
        loseHp(8)
        break

      // 丛林迷宫奇遇：结伴 35-64 金币；独行 135-164 金币且失去 18 生命
      case 'jungle_maze_adventure':
        if (option === '结伴同行') gold(35, 64, 1)
        else {
          gold(135, 164, 1)
          loseHp(18)
        }
        break

      // 冷光合唱团：支付 100-149 金币得遗物；或移除 2 牌并加孢子心灵
      case 'luminous_choir':
        if (option === '供奉') {
          gold(100, 149, -1)
          grantRelic()
        } else {
          removeRandom(2)
          addCard('spore_mind', '孢子心灵')
        }
        break

      // 变形灵林谷：失去所有金币并变化 2 牌；或最大生命 +5
      case 'morphic_grove':
        if (option === '大群变形灵') {
          r.gold = 0
          transformFirst(() => gen(71))
          transformFirst(() => gen(73))
          notify('大群变形灵：失去所有金币，变化 2 张牌')
        } else {
          maxHp(5)
        }
        break

      // 蓝宝石种子：回复 9 生命并升级 1 牌；或给 1 张牌附魔「播种」
      case 'sapphire_seed':
        if (option === '吃下') {
          heal(9)
          upgradeRandom()
        } else {
          pickEnchantCards({
            title: '蓝宝石种子',
            hint: '选择 1 张牌附魔「播种」',
            enchant: 'sown',
            count: 1,
          })
        }
        break

      // 真理石板：失去 3 最大生命并随机升级 1 牌；或回复 20 生命（连续解读的递增代价未做多阶段）
      case 'tablet_of_truth':
        if (option === '解读') {
          maxHp(-3)
          upgradeRandom()
        } else {
          heal(20)
        }
        break

      // 无休之处：失去 8 最大生命得遗物；或回复全部生命并得睡眠不佳
      case 'unrest_site':
        if (option === '杀死树木') {
          maxHp(-8)
          grantRelic()
        } else {
          r.hp = r.maxHp
          addCard('bad_sleep', '睡眠不佳')
        }
        break

      // 泉水：移除 1 牌加 1 张愧疚；或装瓶（药水）
      case 'wellspring':
        if (option === '沐浴') {
          removeRandom(1)
          addCard('guilt', '愧疚')
        } else {
          notify('装瓶：获得 1 瓶随机药水(药水系统未实现)')
        }
        break

      // 低语空谷：失去 26-44 金币得 2 瓶药水；或失去 9 生命变化 1 牌
      case 'whispering_hollow':
        if (option === '交换金币') {
          gold(26, 44, -1)
          notify('获得 2 瓶随机药水(药水系统未实现)')
        } else {
          loseHp(9)
          transformRandom()
        }
        break

      // 木雕：初始牌→啄击/坚韧之环；蛇则给 1 张牌附魔「蛇行」
      case 'wood_carvings':
        if (option === '鸟') {
          transformBasicTo('peck')
          notify('鸟：将 1 张初始牌变化为啄击')
        } else if (option === '圆环') {
          transformBasicTo('tough_ring')
          notify('圆环：将 1 张初始牌变化为坚韧之环')
        } else {
          pickEnchantCards({
            title: '木雕',
            hint: '选择 1 张牌附魔「蛇行」',
            enchant: 'slither',
            count: 1,
          })
        }
        break

      // ===== 第一阶段·通用（phase1） =====
      // 脑蛭：失去 5 生命得无色卡牌；或从随机无色牌中选 1 加入（简化随机）
      case 'brain_leech':
        // 把它扯下来：失去 5 生命，获得一次"无色卡牌奖励"（event.md：无色卡牌奖励 = 卡牌奖励，MVP 简化为从随机无色牌中选 1）
        if (option === '把它扯下来') {
          loseHp(5)
          offerCardChoice({
            title: '脑蛭',
            hint: '选择 1 张无色牌加入牌组（已失去 5 点生命）',
            pool: cardsData.colorless,
            offer: 3,
            count: 1,
            rand: gen(83),
            onPick: (ids) => {
              if (ids[0]) addDeckCard(ids[0])
            },
          })
        } else {
          // 分享知识：从 5 张随机牌中选择 1 张加入牌组（event.md：必须选择 1 张，不可取消）
          offerCardChoice({
            title: '脑蛭',
            hint: '从 5 张随机牌中选择 1 张加入牌组（必须选择）',
            pool: cardsData.warrior,
            offer: 5,
            count: 1,
            allowSkip: false, // 数据要求必须选择 1 张
            rand: gen(85),
            onPick: (ids) => {
              if (ids[0]) addDeckCard(ids[0])
            },
          })
        }
        break

      // 满屋芝士：加入 2 张随机普通牌；或失去 14 生命得天选芝士（遗物缺失→随机遗物）
      case 'room_full_of_cheese':
        // 大快朵颐：从 8 张随机普通牌中选择 2 张加入牌组（event.md；8 张候选互不重复，必选 2 张）
        if (option === '大快朵颐') {
          offerCardChoice({
            title: '满屋芝士',
            hint: '从 8 张随机普通牌中选择 2 张加入牌组',
            pool: commonPool,
            offer: 8,
            count: 2,
            allowSkip: false, // 数据要求必须选择 2 张
            rand: gen(87),
            onPick: (ids) => {
              for (const id of ids) addDeckCard(id)
            },
          })
        } else {
          loseHp(14)
          grantRelic('（天选芝士数据缺失，改发随机遗物）')
        }
        break

      // 沉没雕像：得 101-121 金币失去 7 生命；或拿石之剑（遗物缺失→随机遗物）
      case 'sunken_statue':
        if (option === '潜水') {
          gold(101, 121, 1)
          loseHp(7)
        } else {
          grantRelic('（石之剑数据缺失，改发随机遗物）')
        }
        break

      // 茶艺大师：付费购买战斗开始增益（buf 未实现，仅扣费并提示）；无礼之茶无费提示
      case 'tea_master':
        if (option === '骨茶') {
          gold(50, 50, -1)
          notify('骨茶：下一场战斗开始时升级初始手牌(战斗开始增益未实现)')
        } else if (option === '余烬茶') {
          gold(150, 150, -1)
          notify('余烬茶：接下来 5 场战斗开始时获得 2 点力量(未实现)')
        } else {
          notify('无礼之茶：下一场战斗开始时抽牌堆放入 2 张眩晕(未实现)')
        }
        break

      // 传说是真的：获得藏宝图（遗物缺失→随机遗物）；或失去 8 生命得一瓶药水
      case 'the_legends_were_true':
        if (option === '顺走地图') grantRelic('（藏宝图数据缺失，改发随机遗物）')
        else {
          loseHp(8)
          notify('获得 1 瓶随机药水(药水系统未实现)')
        }
        break

      // ===== 暗港幕（harbor） =====
      // 深渊浴场：回复 10 生命；或投身其中最大生命 +2 失去 3 生命（排序沉溺多阶段未做）
      case 'abyssal_baths':
        if (option === '敬而远之') heal(10)
        else {
          maxHp(2)
          loseHp(3)
        }
        break

      // 光与暗的门扉：移除 1 张选中的牌；或随机升级 2 张牌
      case 'doors_of_light_and_dark':
        if (option === '暗之门') removeRandom(1, '暗之门：移除 1 张牌(简化随机)')
        else upgradeRandomN(gen(89), 2)
        break

      // 淹水灯塔：装瓶得发光水（药水）；或攀爬得菲涅耳透镜失去 13 最大生命
      case 'drowning_beacon':
        if (option === '装瓶') notify('装瓶：获得 1 瓶发光水(药水系统未实现)')
        else {
          grantRelic('（菲涅耳透镜数据缺失，改发随机遗物）')
          maxHp(-13)
        }
        break

      // 无尽传送带：支付 40 金币(料理效果未实现)；或观察主厨随机升级一张
      case 'endless_conveyor':
        if (option === '观察主厨') upgradeRandom()
        else {
          gold(40, 40, -1)
          notify('吃下料理(料理效果未实现)')
        }
        break

      // 重拳出击：战斗分支另处理；顺走得受伤+随机遗物
      case 'punch_off':
        addCard('injured', '受伤')
        grantRelic()
        break

      // 螺旋漩涡：回复 33% 最大生命；观察为一张基础打击/防御附魔「涡旋」；Reach In 得遗物+苦恼
      case 'spiraling_whirlpool':
        if (option === '饮用') healPct(33)
        else if (option === '观察') {
          pickEnchantCards({
            title: '螺旋漩涡',
            hint: '选择 1 张基础打击/防御附魔「涡旋」',
            enchant: 'spiral',
            count: 1,
            filter: (c) => c.rarity === 'basic' && (c.name === '打击' || c.name === '防御'),
          })
        } else {
          grantRelic()
          addCard('anguish', '苦恼')
        }
        break

      // 淹水金库：金箱子得 52-67 金币；宝箱得 303-363 金币并加入贪婪
      case 'sunken_treasury':
        if (option === '第一个箱子') gold(52, 67, 1)
        else {
          gold(303, 363, 1)
          addCard('greed', '贪婪')
        }
        break

      // 垃圾堆：失去 8 生命得旧日遗物；或得 100 金币与旧日卡牌
      case 'trash_heap':
        if (option === '扎进垃圾堆') {
          loseHp(8)
          grantRelic('（旧日遗物数据缺失，改发随机遗物）')
        } else {
          gold(100, 100, 1)
          addRandomFromPool(commonPool, gen(91), 1)
          notify('获得一张旧日卡牌(简化随机普通牌)')
        }
        break

      // 水漫缮写室：得 6 最大生命；或付费给 2/1 张牌附魔「稳定」
      case 'waterlogged_scriptorium':
        if (option === '血液墨水') maxHp(6)
        else if (option === '扎手海绵') {
          gold(99, 99, -1)
          pickEnchantCards({
            title: '水漫缮写室',
            hint: '选择 2 张牌附魔「稳定」',
            enchant: 'steady',
            count: 2,
            min: 1,
          })
        } else {
          gold(55, 55, -1)
          pickEnchantCards({
            title: '水漫缮写室',
            hint: '选择 1 张牌附魔「稳定」',
            enchant: 'steady',
            count: 1,
          })
        }
        break

      // ===== 巢穴幕（nest） =====
      // 熔合者：移除 2 张防御/打击并加入一张究极牌（究极牌数据缺失则仅移除）
      case 'amalgamator':
        if (option === '融合防御') {
          removeFromDeckById('defend_ironclad', 2)
          addCard('super_defend', '究极防御')
        } else {
          removeFromDeckById('strike_ironclad', 2)
          addCard('super_strike', '究极打击')
        }
        break

      // 害虫杀手：加入一张杀灭或压扁（数据缺失则提示）
      case 'bugslayer':
        if (option === '学习杀灭的技巧') addCard('kill', '杀灭')
        else addCard('squash', '压扁')
        break

      // 色彩哲学家：按选择的三种卡牌奖励各一次（从非基础/先古战士牌中选择 3 张加入；MVP 仅战士卡池）
      case 'colorful_philosophers':
        offerCardChoice({
          title: '色彩哲学家',
          hint: '依照三种卡牌奖励选择 3 张战士牌加入牌组',
          pool: cardsData.warrior.filter((c) => c.rarity !== 'basic' && c.rarity !== 'ancient'),
          offer: 9,
          count: 3,
          allowSkip: false,
          rand: gen(93),
          onPick: (ids) => {
            for (const id of ids) addDeckCard(id)
          },
        })
        break

      // 巨大花卉：采集花蜜得 35 金币；或深入探索失去 5 生命（多阶段递进简化）
      case 'colossal_flower':
        if (option === '采集花蜜') gold(35, 35, 1)
        else loseHp(5)
        break

      // 人形洞穴之地：进入你的洞→附魔「完美契合」；或抵抗诱惑移除 2 牌加凡庸
      case 'field_of_man_sized_holes':
        if (option === '进入你的洞') {
          pickEnchantCards({
            title: '人形洞穴之地',
            hint: '选择 1 张牌附魔「完美契合」',
            enchant: 'perfect_fit',
            count: 1,
          })
        } else {
          removeRandom(2)
          addCard('mediocrity', '凡庸')
        }
        break

      // 被寄生的自动机械：随机能力牌；或随机耗能 0 牌
      case 'infested_automaton':
        if (option === '学习') {
          addRandomFromPool(powerPool, gen(95), 1)
          notify('随机获得一张能力牌')
        } else {
          addRandomFromPool(zeroCostPool, gen(97), 1)
          notify('随机获得一张耗能为 0 的牌')
        }
        break

      // 迷失鬼火：得腐朽+迷失鬼火（遗物缺失→随机）；或得 45-75 金币
      case 'lost_wisp':
        if (option === '抓住这团鬼火') {
          addCard('decay', '腐朽')
          grantRelic('（迷失鬼火遗物数据缺失，改发随机遗物）')
        } else {
          gold(45, 75, 1)
        }
        break

      // 灵魂嫁接者：回复 25 生命并加羽化；或失去 10 生命升级 1 张
      case 'spirit_grafter':
        if (option === '接纳') {
          heal(25)
          addCard('pupate', '羽化')
        } else {
          loseHp(10)
          upgradeRandom()
        }
        break

      // 灯火钥匙：留下钥匙为事件战斗（分支处理）；交还钥匙得 100 金币
      case 'the_lantern_key':
        gold(100, 100, 1)
        break

      // 修禅织网者：按价位移除/加入（开悟加入）
      case 'zen_weaver':
        if (option === '蜘蛛针灸') {
          gold(250, 250, -1)
          removeRandom(2)
        } else if (option === '呼吸技法') {
          gold(50, 50, -1)
          addDeckCard('enlightenment')
          addDeckCard('enlightenment')
          notify('将 2 张开悟加入牌组')
        } else if (option === '情绪觉察') {
          gold(125, 125, -1)
          removeRandom(1)
        }
        break

      // ===== 第二阶段·通用（phase2） =====
      // 水晶球：分期付款得债务+占卜（占卜未实现）；或支付 51-99 金币占卜
      case 'crystal_sphere':
        if (option === '分期付款') {
          addCard('debt', '债务')
          notify('占卜 6 次(占卜系统未实现)')
        } else {
          gold(51, 99, -1)
          notify('占卜 3 次(占卜系统未实现)')
        }
        break

      // 玩偶室：失去生命后拿一尊玩偶遗物（玩偶数据缺失→随机遗物）
      case 'doll_room':
        if (option === '仔细检查然后挑选最好的那个') {
          loseHp(15)
          grantRelic('（玩偶遗物数据缺失，改发随机遗物）')
        } else if (option === '随机拿走一尊') {
          grantRelic('（玩偶遗物数据缺失，改发随机遗物）')
        } else {
          loseHp(5)
          grantRelic('（玩偶遗物数据缺失，改发随机遗物）')
        }
        break

      // 商人？？？：赝品商人无一级选项（独立商店型事件）
      case 'fake_merchant':
        notify('商人？？？：赝品商店事件(需其专属商店 UI)')
        break

      // 药水快递员：获得药水（系统未实现）
      case 'potion_courier':
        if (option === '拿走这批药水') notify('拿走 3 瓶污浊药水(药水系统未实现)')
        else notify('洗劫：获得 1 瓶随机罕见药水(药水系统未实现)')
        break

      // 长者兰伟德：付费/给遗物换随机遗物
      case 'ranwid_the_elder':
        if (option === '给他100金币') {
          gold(100, 100, -1)
          grantRelic()
        } else if (option === '给他遗物') {
          swapRandomRelic(gen(105))
        } else {
          notify('给他药水换遗物(需药水，简化仍给一件随机遗物)')
          grantRelic()
        }
        break

      // 遗物交换商：三件商品均以随机遗物交换随机遗物
      case 'relic_trader':
        swapRandomRelic(gen(107))
        break

      // 永恒之石：失去药水得 10 最大生命；或失去 6 生命并附魔 1 张攻击牌「活力」
      case 'stone_of_all_time':
        if (option === '喝药抬起') {
          notify('失去 1 瓶随机药水(药水系统未实现)')
          maxHp(10)
        } else {
          loseHp(6)
          pickEnchantCards({
            title: '永恒之石',
            hint: '失去 6 点生命，选择 1 张攻击牌附魔「活力」',
            enchant: 'vigorous',
            count: 1,
            filter: (c) => c.type === 'attack',
          })
        }
        break

      // 共生体：靠近→附魔「腐化」；或选择一张变化
      case 'symbiote':
        if (option === '靠近') {
          pickEnchantCards({
            title: '共生体',
            hint: '选择 1 张牌附魔「腐化」',
            enchant: 'corrupted',
            count: 1,
          })
        } else transformRandom()
        break

      // 欢迎来到旺购百货：按价位购遗物/降级
      case 'welcome_to_wongos':
        if (option === '旺购的打折货物') {
          gold(100, 100, -1)
          grantRelic('（普通遗物）')
        } else if (option === '旺购的特选商品') {
          gold(200, 200, -1)
          grantRelic('（稀有遗物）')
        } else if (option === '离开') {
          downgradeRandomN(gen(109), 1)
          notify('随机降级一张牌')
        } else {
          gold(300, 300, -1)
          notify('神秘盲盒：5 场战斗后获得 3 个随机遗物(延迟结算未实现)')
        }
        break

      // ===== 荣耀幕（glory） =====
      // 战痕累累的训练假人：战斗取胜并按档位给奖励（战斗分支+奖励简化）
      case 'battleworn_dummy':
        if (option === '第1档') notify('与 75 生命假人战斗并获 1 瓶随机药水(假人战斗/药水未实现)')
        else if (option === '第2档') {
          notify('与 150 生命假人战斗')
          upgradeRandomN(gen(111), 2)
        } else {
          notify('与 300 生命假人战斗(假人战斗未实现)')
          grantRelic()
        }
        break

      // 遗忘之墓：得遗忘之魂（遗物缺失→随机）；或加腐朽并附魔 1 张消耗牌「灵魂之力」
      case 'grave_of_the_forgotten':
        if (option === '接受这颗遗忘之魂') grantRelic('（遗忘之魂数据缺失，改发随机遗物）')
        else {
          addCard('decay', '腐朽')
          pickEnchantCards({
            title: '遗忘之墓',
            hint: '选择 1 张消耗牌附魔「灵魂之力」',
            enchant: 'souls_power',
            count: 1,
            filter: (c) => c.keywords.includes('exhaust'),
          })
        }
        break

      // 蘑菇饥渴：大蘑菇/芳香蘑菇（遗物缺失→随机，含其数值效果）
      case 'hungry_for_mushrooms':
        if (option === '大蘑菇') {
          maxHp(20)
          notify('大蘑菇：最大生命 +20(少抽 2 张牌未实现)')
        } else {
          loseHp(15)
          upgradeRandomN(gen(113), 2)
          notify('芳香蘑菇：失去 15 生命，随机升级 2 张牌')
        }
        break

      // 镜中倒影：复制牌组并加霉运；或降级 2 随机牌并升级 4 随机牌
      case 'reflections':
        if (option === '打碎') {
          const len = copyDeck()
          addCard('misfortune', '霉运')
          notify(`打碎：复制整个牌组(+${len} 张)，获得霉运`)
        } else {
          downgradeRandomN(gen(115), 2)
          const n = upgradeRandomN(gen(117), 4)
          notify(`触碰镜子：降级 2 张并升级 ${n} 张`)
        }
        break

      // 圆桌茶会：喝好茶得王储猛毒+回满；或挑事斗殴失去 11 生命得遗物
      case 'round_tea_party':
        if (option === '喝杯好茶') {
          r.hp = r.maxHp
          grantRelic('（王室猛毒数据缺失，改发随机遗物）')
        } else {
          loseHp(11)
          grantRelic()
        }
        break

      // 打造时间：定制卡牌（自定义流程图未实现）
      case 'tinker_time':
        notify('打造时间：制作一张定制卡牌(自定义卡牌流程未实现)')
        break

      // 审判：多阶段判决（未实现）
      case 'trial':
        notify('审判：担当判决者(多阶段判决流程未实现)')
        break

      // 战史学家 付袭：打开笼子/宝箱（灯火钥匙权属与遗物数据缺失，简化处理）
      case 'war_historian_repy':
        if (option === '打开笼子') {
          notify('失去灯火钥匙，获得历史课(历史课数据缺失)')
        } else {
          notify('失去灯火钥匙，获得 2 瓶药水与 2 件遗物(药水数据缺失)')
          grantRelic()
          grantRelic()
        }
        break

      default:
        notify('该事件效果待实现')
        break
    }
  }

  // ===== 商店（PRD §3.5） =====
  function setupShop(): void {
    const r = run.value!
    const rng = mulberry32(r.seed + r.floor * 131)
    // 战士卡池：排除 basic/ancient 起始牌，供上方 6 张战士卡随机抽取
    const warriorPool = cardsData.warrior.filter(
      (c) => c.rarity !== 'basic' && c.rarity !== 'ancient',
    )
    const cards: Array<{ card: Card; price: number; originalPrice?: number }> = []
    for (let i = 0; i < SHOP.cardWarrior; i++) {
      const card = warriorPool[Math.floor(rng() * warriorPool.length)]!
      cards.push({ card, price: priceOf(card) })
    }
    // 特价机制（PRD 商店）：每次进店随机一张战士卡打 5 折——记录原价(originalPrice)用于显示删除线，
    // price 更新为折后价(取整)，UI 购买直接按折后价结算
    const discountIdx = Math.floor(rng() * cards.length)
    const discountCard = cards[discountIdx]
    if (discountCard) {
      discountCard.originalPrice = discountCard.price
      discountCard.price = Math.ceil(discountCard.price / 2)
    }
    // 无色卡池：供下方 2 张无色卡随机抽取
    const colorless: Array<{ card: Card; price: number }> = []
    for (let i = 0; i < SHOP.cardColorless; i++) {
      const card = cardsData.colorless[Math.floor(rng() * cardsData.colorless.length)]!
      colorless.push({ card, price: priceOf(card) })
    }
    // 遗物池：从通用+战士池挑取玩家尚未获得且非剔除的遗物
    // 排除"???"假遗物（id 以 _ev 结尾，供假商人事件 fake_merchant 专属出售，不应流入普通商店）
    const relicPool = [...relicsData.general, ...relicsData.warrior].filter(
      (x) => !x.excluded && !r.relics.includes(x.id) && !x.id.endsWith('_ev'),
    )
    const relics: Array<{ relic: Relic; price: number }> = []
    for (let i = 0; i < SHOP.relicCount; i++) {
      const idx = Math.floor(rng() * relicPool.length)
      const relic = relicPool[idx]
      if (relic) {
        // 遗物定价：进店时在 [150,300] 区间随机一个底价，再套会员卡折扣
        const base =
          SHOP.relicPrice[0] + Math.floor(rng() * (SHOP.relicPrice[1] - SHOP.relicPrice[0] + 1))
        relics.push({ relic, price: shopPrice(base) })
      }
    }
    shopState.value = {
      cards,
      colorless,
      relics,
      removeCount: SHOP.removeCount,
      removeCost: SHOP.removeBaseCost,
      neverSell: r.relics.includes('deliverer'), // 送货员：商品不会卖光
    }
    // 送货员：所有商品额外打 8 折（relic.md §送货员：全商城 20% 折扣）
    if (r.relics.includes('deliverer')) {
      for (const c of shopState.value.cards) c.price = Math.max(1, Math.ceil(c.price * 0.8))
      for (const c of shopState.value.colorless) c.price = Math.max(1, Math.ceil(c.price * 0.8))
      for (const re of shopState.value.relics) re.price = Math.max(1, Math.ceil(re.price * 0.8))
      shopState.value.removeCost = Math.max(1, Math.ceil(shopState.value.removeCost * 0.8))
    }
    // 餐券：每次进入商店回复 15 点生命（relic.md §餐券，ON_SHOP_ENTER）
    if (r.relics.includes('meal_ticket')) {
      const heal = Math.min(15, r.maxHp - r.hp)
      r.hp += heal
      if (heal > 0) message.value = `餐券：回复 ${heal} 点生命`
    }
    // 巨口储蓄罐：进入商店时按已攀爬层数获得金币（relic.md）；花费金币后失效
    if (r.relics.includes('giant_jaw')) {
      if (!r.meta.giantJawBroken) {
        gainGold(r.floor * 12)
        message.value = `巨口储蓄罐：获得 ${r.floor * 12} 金币`
      }
    }
    // 领主阳伞：当你遇见商人时，立刻获得他所出售的所有物品（relic.md §四·瓦库）；已实现为免费白拿全部商品
    if (r.relics.includes('lord_umbrella')) {
      for (const c of cards) r.deck.push({ id: c.card.id, upgrade: false })
      for (const c of colorless) r.deck.push({ id: c.card.id, upgrade: false })
      for (const re of relics) {
        r.relics.push(re.relic.id)
        onRelicGained(re.relic.id) // 拾起即触发（草莓等立即效果）
      }
      shopState.value = {
        cards: [],
        colorless: [],
        relics: [],
        removeCount: SHOP.removeCount,
        removeCost: SHOP.removeBaseCost,
      }
      message.value = '领主阳伞：白拿商店中所有物品'
      persist()
    }
  }

  // 购买战士卡（上方区域，价格已在 shopState 定价）
  function buyCard(index: number): boolean {
    const r = run.value
    const s = shopState.value
    if (!r || !s) return false
    const item = s.cards[index]
    if (!item) return false
    if (r.gold < item.price) return false
    r.gold -= item.price
    if (r.relics.includes('giant_jaw')) r.meta.giantJawBroken = true // 花费金币 → 储蓄罐失效
    r.deck.push({ id: item.card.id, upgrade: false })
    if (!s.neverSell) s.cards.splice(index, 1) // 送货员：商品不会卖光
    persist()
    return true
  }

  // 购买无色卡（下方区域，价格已在 shopState 定价）
  function buyColorless(index: number): boolean {
    const r = run.value
    const s = shopState.value
    if (!r || !s) return false
    const item = s.colorless[index]
    if (!item) return false
    if (r.gold < item.price) return false
    r.gold -= item.price
    if (r.relics.includes('giant_jaw')) r.meta.giantJawBroken = true
    r.deck.push({ id: item.card.id, upgrade: false })
    if (!s.neverSell) s.colorless.splice(index, 1)
    persist()
    return true
  }

  // 购买遗物（价格已在 shopState 定价，拾起即触发 onRelicGained）
  function buyRelic(index: number): boolean {
    const r = run.value
    const s = shopState.value
    if (!r || !s) return false
    const item = s.relics[index]
    if (!item) return false
    if (r.gold < item.price) return false
    r.gold -= item.price
    if (r.relics.includes('giant_jaw')) r.meta.giantJawBroken = true
    r.relics.push(item.relic.id)
    onRelicGained(item.relic.id) // 拾起即生效（草莓等立即效果）
    if (!s.neverSell) s.relics.splice(index, 1)
    persist()
    return true
  }

  // 移除卡牌（价格递增）
  function buyRemove(cardId: string): boolean {
    const r = run.value
    const s = shopState.value
    if (!r || !s) return false
    const removeCost = shopPrice(s.removeCost)
    if (s.removeCount <= 0 || r.gold < removeCost) return false
    // "永恒"牌不可被移除（PRD §3.3.6）
    if (isUniqueCard(cardId)) return false
    // 从后往前找第一个匹配 id 的牌实例下标（移除用；从后取以趋向移除"最晚获得的"）
    let idx = -1
    for (let i = r.deck.length - 1; i >= 0; i--) {
      if (r.deck[i]!.id === cardId) {
        idx = i
        break
      }
    }
    if (idx < 0) return false
    r.gold -= removeCost
    if (r.relics.includes('giant_jaw')) r.meta.giantJawBroken = true
    r.deck.splice(idx, 1)
    s.removeCount--
    s.removeCost += SHOP.removeIncrement
    persist()
    return true
  }

  // 按"牌组实例下标"移除并扣费（DeckChooseOverlay 选完回传的下标）；"永恒"牌不可移除
  function buyRemoveIndex(idx: number): boolean {
    const r = run.value
    const s = shopState.value
    if (!r || !s) return false
    const en = r.deck[idx]
    if (!en) return false
    if (isUniqueCard(en.id)) return false
    const removeCost = shopPrice(s.removeCost)
    if (s.removeCount <= 0 || r.gold < removeCost) return false
    r.gold -= removeCost
    if (r.relics.includes('giant_jaw')) r.meta.giantJawBroken = true
    r.deck.splice(idx, 1)
    s.removeCount--
    s.removeCost += SHOP.removeIncrement
    persist()
    return true
  }

  // 发起商店"移除卡牌"：弹出全卡组选卡界面（DeckChooseOverlay）从中选一张非"永恒"牌移除
  function shopOpenRemove(): boolean {
    const r = run.value
    const s = shopState.value
    if (!r || !s) return false
    const ok = pickDeckCards({
      title: '移除卡牌',
      hint: `需 ${shopPrice(s.removeCost)} 金币，剩余 ${s.removeCount} 次`,
      count: 1,
      min: 1,
      allowSkip: true,
      // 仅"非永恒"牌可移除（PRD §3.3.6）
      filter: (e) => !isUniqueCard(e.id),
      // 选完调用按实例下标移除；成功且次数用尽不再弹
      resolve: (indices) => {
        if (indices[0] !== undefined) buyRemoveIndex(indices[0])
      },
    })
    return ok
  }

  // 本地随机洗牌（返回新数组，不修改入参）；用于回合/开战抽牌堆重建
  function shuffleLocal<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = a[i]
      a[i] = a[j]!
      a[j] = tmp!
    }
    return a
  }

  // 会员卡折扣：持有会员卡则按折扣比例立减（relic.md 会员卡）
  function shopPrice(base: number): number {
    const r = run.value
    const disc = r?.relics.includes('membership_card') ? RELIC.shopDiscount : 0
    return disc > 0 ? Math.max(1, Math.floor(base * (1 - disc))) : base
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
    return shopPrice(Math.round(base * factor))
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
    // 石炉加湿器：每次休息最大生命 +5（relic.md）
    let msg = `篝火休息：回复 ${heal} 点生命`
    if (r.relics.includes('stone_humidifier')) {
      r.maxHp += 5
      r.hp += 5
      msg += '；石炉加湿器使最大生命 +5'
    }
    // 皇家枕头：休息时额外回复 15 点生命
    if (r.relics.includes('royal_pillow')) {
      const extra = Math.min(15, r.maxHp - r.hp)
      r.hp += extra
      msg += `；皇家枕头额外回复 ${extra} 点生命`
    }
    // 永恒羽毛：牌组中每 5 张牌回复 3 点生命
    if (r.relics.includes('eternal_feather')) {
      const extra = Math.min(3 * Math.floor(r.deck.length / 5), r.maxHp - r.hp)
      r.hp += extra
      msg += `；永恒羽毛回复 ${extra} 点生命`
    }
    // 古茶具套装：到达休息处后，下一场战斗开始额外 +2 能量
    if (r.relics.includes('old_tea_set')) {
      r.meta.oldTeaReady = true
      msg += '；古茶具套装已就位（下一场战斗 +2 能量）'
    }
    // 古茶具套装（？？？变体）：到达休息处后，下一场战斗开始额外 +1 能量
    if (r.relics.includes('old_tea_set_ev')) {
      r.meta.oldTeaReadyEv = true
      msg += '；古茶具套装（？？？）已就位（下一场战斗 +1 能量）'
    }
    message.value = msg
    // 微型帐篷：休息后可继续其它动作（不离开休息处），否则正常推进（relic.md §微型帐篷）
    if (!r.relics.includes('mini_tent')) leaveCampfire()
  }

  // 锻造：升级牌组中一张卡实例（PRD §3.6）；animalCardIdx 为牌组下标，缺省时自动选第一张未升级牌
  function campfireSmith(deckIdx?: number): boolean {
    const r = run.value!
    // 根据索引取实例；未传索引则找第一张"未升级"的牌实例
    const entry = deckIdx !== undefined ? r.deck[deckIdx] : r.deck.find((en) => !en.upgrade)
    if (!entry) return false
    // 仅升级该实例（其他同名卡不受影响）
    entry.upgrade = true
    message.value = `锻造：升级【${getCard(entry.id)?.name ?? entry.id}】`
    // 微型帐篷：锻后停留休息处继续其它动作（relic.md §微型帐篷）
    if (!r.relics.includes('mini_tent')) leaveCampfire()
    return true
  }

  // campfireRest/campfireSmith/campfireDig/campfireKettlebell/campfireCook 在持有微型帐篷时均停留休息处，
  // 让玩家在同一个休息点完成多次动作后才手动离开。

  function leaveCampfire(): void {
    advanceAfterReward()
  }

  // 休息处"挖掘遗物"（铲子，ON_REST，relic.md）：挖出一件随机遗物并承受 3 点伤害。
  // 仅清理一层即可离开；若持有微型帐篷则停留休息处允许继续其他动作（见 campfireRest 判定）
  function campfireDig(): boolean {
    const r = run.value!
    const relic = rollRelicDrop()
    if (!relic) {
      message.value = '铲子：这次什么都没有挖到'
      return false
    }
    r.relics.push(relic.id)
    onRelicGained(relic.id) // 拾起即生效（草莓等）
    r.hp = Math.max(0, r.hp - 3) // 挖掘代价：3 点生命
    message.value = `铲子：挖掘到遗物【${relic.name}】，失去 3 点生命`
    log.value.push(`[铲子] 挖到遗物【${relic.name}】`)
    if (!r.relics.includes('mini_tent')) leaveCampfire()
    return true
  }

  // 休息处"举壶铃"（壶铃，ON_REST，relic.md）：获得 2 点永久力量，最多 3 次。
  // 永久力量存于 meta.kettlebellStrength，每场战斗开始由 startBattle 附加（见 壶铃 分支）
  function campfireKettlebell(): boolean {
    const r = run.value!
    const cur = r.meta.kettlebellStrength ?? 0
    if (cur >= 9) {
      message.value = '壶铃：力量已达上限（3 次）'
      return false
    }
    r.meta.kettlebellStrength = cur + 3
    message.value = `壶铃：获得 3 点永久力量（累计 ${r.meta.kettlebellStrength}，上限 9）`
    log.value.push('[壶铃] 获得 3 点永久力量')
    if (!r.relics.includes('mini_tent')) leaveCampfire()
    return true
  }

  // 休息处"烹饪"（切肉刀，ON_REST，relic.md）：烤制野味，获得 5 点最大生命。
  function campfireCook(): boolean {
    const r = run.value!
    r.maxHp += 5
    r.hp += 5
    message.value = '切肉刀：烹饪野味，最大生命 +5'
    log.value.push('[切肉刀] 最大生命 +5')
    if (!r.relics.includes('mini_tent')) leaveCampfire()
    return true
  }

  // ===== 宝箱 =====
  function giveChest(): void {
    const r = run.value!
    // 白银熔炉：你打开的第一个宝箱将是空的（relic.md）
    if (r.relics.includes('silver_crucible') && !r.meta.silverChestUsed) {
      r.meta.silverChestUsed = true
      message.value = '宝箱（白银熔炉）：宝箱是空的'
      stateMachine.transition('RUN')
      unlockFloor(r.map, r.floor + 1)
      persist()
      return
    }
    const pool = relicsData.general.filter(
      (x) => !x.excluded && !r.relics.includes(x.id) && !isFakeRelic(x.id),
    )
    const relic = pool[Math.floor(mulberry32(r.seed + r.floor * 193)() * pool.length)]
    if (relic) {
      r.relics.push(relic.id)
      onRelicGained(relic.id) // 拾起即生效（草莓等）
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
    // 标记第 1 层先古节点为"已访问"：本次先古遗物选择被消费后，玩家不应再点击该节点（isEnterable 依 visited 拦截）
    const f1 = r.map.find((n) => n.id === 'f1-r0')
    if (f1) f1.visited = true
    // 开局即已展示先古三选一（newRun 内自动 offerNeow 使 phase=REWARD 且 pendingReward 为 relic）时，
    // 重复进入先古节点（如测试 repeated enterNode）避免再次 transition REWARD→REWARD 抛非法迁移——直接复用现有 offer 返回
    if (stateMachine.current === 'REWARD' && pendingReward.value?.kind === 'relic') return
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

  // 遗物"拾起即生效"结算（ON_PICKUP）：完整覆盖涅奥先古遗物（relic.md 先古之民）
  // 由所有"获得遗物"入口统一调用（开局选择/精英掉落/商店购买/宝箱/事件），保证不重不漏
  // 凡"从 N 张中选 1/移除/升级/变化"类遗物：改为挂起选牌（offerPick → PickCardsModal 选择 → resolvePick 结算），
  // 由玩家真正选择；无可用候选时优雅降级（跳过并提示）
  function onRelicGained(relicId: string, depth = 0): void {
    const r = run.value
    if (!r) return
    // 拾取随机种子：随已获遗物数变化，可复现
    const rng = () => mulberry32(r.seed + r.relics.length * 97)
    const notify = (msg: string): void => void (message.value = msg)
    // —— 最大生命/金币类 ——
    if (relicId === 'strawberry') {
      r.maxHp += RELIC.maxHpBonus.strawberry
      r.hp += RELIC.maxHpBonus.strawberry
      notify(`草莓：最大生命提升 ${RELIC.maxHpBonus.strawberry}`)
      return
    }
    if (relicId === 'nutritious_oyster') {
      r.maxHp += RELIC.maxHpBonus.oyster
      r.hp += RELIC.maxHpBonus.oyster
      notify(`营养牡蛎：最大生命提升 ${RELIC.maxHpBonus.oyster}`)
      return
    }
    if (relicId === 'silver_crucible') {
      // 白银熔炉：记录剩余"将升级的卡牌奖励"次数；首箱为空在 giveChest 判断
      r.meta.silverRewards = RELIC.silverRewardCount
      r.meta.silverChestUsed = false
      notify('白银熔炉：前 3 次卡牌奖励将被升级')
      return
    }
    if (relicId === 'golden_pearl') {
      gainGold(150)
      notify('金色珍珠：获得 150 金币')
      return
    }
    if (relicId === 'cursed_pearl') {
      // 诅咒珍珠：+333 金币并加入一张贪婪诅咒（relic.md）
      gainGold(333)
      addDeckCard('greed')
      notify('诅咒珍珠：获得 333 金币，并加入一张贪婪')
      return
    }
    if (relicId === 'silken_tress') {
      // 华美发束：失去所有金币，并置位"第一次卡牌奖励附魔华彩"（领取时在 applyRelicEnchantOnClaim 消耗）
      r.gold = 0
      r.meta.silkenTressPending = true
      notify('华美发束：失去所有金币，下一次卡牌奖励附魔「华彩」')
      return
    }
    // —— 卡牌复制/奖励/变化类（ON_PICKUP，relic.md） ——
    if (relicId === 'mirror') {
      // 多利之镜：从"全卡组"选择 1 张牌进行复制（新拷贝加入牌组，保留原升级状态）
      notify('多利之镜：选择 1 张牌复制')
      pickDeckCards({
        title: '多利之镜',
        hint: '选择 1 张卡牌进行复制',
        count: 1,
        min: 0,
        allowSkip: true,
        resolve: (indices) => {
          if (indices.length === 0) return
          const en = r.deck[indices[0]!]
          if (!en) return
          r.deck.push({ id: en.id, upgrade: en.upgrade })
          const card = getCard(en.id)
          if (card) revealCards([card])
          message.value = `多利之镜：复制了【${card?.name ?? en.id}】`
        },
      })
      return
    }
    if (relicId === 'star_chart') {
      // 星系仪：拾起时获得 5 次额外卡牌奖励（战斗奖励页逐次消费，见 forwardToMap）
      r.meta.extraCardRewards = (r.meta.extraCardRewards ?? 0) + 5
      notify('星系仪：获得 5 次卡牌奖励')
      return
    }
    if (relicId === 'glass_eye') {
      // 玻璃眼珠：拾起时获得 2 组普通、2 组罕见、1 组稀有卡牌奖励——落地为 5 次奖励档位递增
      // （简化：按奖励页逐次消费的通用次数实现，与星系仪一致；数据不含"分组调档"队列故取通用奖励）
      r.meta.extraCardRewards = (r.meta.extraCardRewards ?? 0) + 5
      notify('玻璃眼珠：获得 5 次卡牌奖励')
      return
    }
    if (relicId === 'ancient_tooth') {
      // 古老牙齿：将 1 张初始卡牌（打击/防御）变化为先古版本。
      // 数据中暂无"先古版打击/防御"，降级为：选 1 张基础牌变化为随机非基础战士牌（与记忆降级约定一致）
      notify('古老牙齿：选择 1 张初始卡牌变化')
      pickDeckCards({
        title: '古老牙齿',
        hint: '选择 1 张基础卡牌（打击/防御）进行变化',
        count: 1,
        min: 0,
        allowSkip: true,
        filter: (e) => getCard(e.id)?.rarity === 'basic',
        resolve: (indices) => {
          if (indices.length === 0) return
          const idx = indices[0]!
          const before = r.deck[idx]
          if (!before) return
          const t = transformAt(idx)
          message.value = t
            ? `古老牙齿：将【${getCard(before.id)?.name ?? before.id}】变化为【${t.name}】`
            : '古老牙齿：无可变化的目标'
        },
      })
      return
    }
    if (relicId === 'bird_baby') {
      // 异鸟宝宝：拾起时获得一张"异鸟扑击"（专属卡数据缺失 → 降级为随机战士攻击牌，与记忆降级约定一致）
      const pool = cardsData.warrior.filter((c) => c.type === 'attack')
      const strike = pool[Math.floor(Math.random() * pool.length)]
      if (strike) {
        r.deck.push({ id: strike.id, upgrade: false })
        revealCards([strike])
        message.value = `异鸟宝宝：获得伴生攻击牌【${strike.name}】（专属卡数据缺失，已降级）`
      } else {
        message.value = '异鸟宝宝：未找到可加入的攻击牌'
      }
      return
    }
    // —— 附魔类遗物（ON_PICKUP：选牌附魔/全体附魔，document/enchantments.md §四遗物来源） ——
    if (relicId === 'wooden_piece') {
      // 木札：选择至多 3 张牌附魔「伶俐」
      pickEnchantCards({
        title: '木札',
        hint: '选择至多 3 张牌附魔「伶俐」',
        enchant: 'adroit',
        count: 3,
      })
      return
    }
    if (relicId === 'twisted_hammer') {
      // 扭曲锤子：选择至多 3 张攻击牌附魔「锋利」
      pickEnchantCards({
        title: '扭曲锤子',
        hint: '选择至多 3 张攻击牌附魔「锋利」',
        enchant: 'sharp',
        count: 3,
        filter: (c) => c.type === 'attack',
      })
      return
    }
    if (relicId === 'punch_dagger') {
      // 拳刃：选择 1 张攻击牌附魔「动量」
      pickEnchantCards({
        title: '拳刃',
        hint: '选择 1 张攻击牌附魔「动量」',
        enchant: 'momentum',
        count: 1,
        filter: (c) => c.type === 'attack',
      })
      return
    }
    if (relicId === 'royal_seal') {
      // 王室印章：选择 1 张攻击或技能牌附魔「王室认证」
      pickEnchantCards({
        title: '王室印章',
        hint: '选择 1 张攻击或技能牌附魔「王室认证」',
        enchant: 'royally_approved',
        count: 1,
        filter: (c) => c.type === 'attack' || c.type === 'skill',
      })
      return
    }
    if (relicId === 'static_shrimp') {
      // 放电异虾：选择 1 张技能牌附魔「注能」
      pickEnchantCards({
        title: '放电异虾',
        hint: '选择 1 张技能牌附魔「注能」',
        enchant: 'imbued',
        count: 1,
        filter: (c) => c.type === 'skill',
      })
      return
    }
    if (relicId === 'percy_growth') {
      // 佩尔的增生组织：选择 1 张牌附魔「克隆」
      pickEnchantCards({
        title: '佩尔的增生组织',
        hint: '选择 1 张牌附魔「克隆」',
        enchant: 'clone',
        count: 1,
      })
      return
    }
    if (relicId === 'percy_claw') {
      // 佩尔之爪：为牌组中所有"防御"附魔「黏糊」（按卡名匹配，作用于该 id 全部副本）
      const n = enchantAllByFilter((c) => c.name === '防御', 'goopy')
      notify(`佩尔之爪：为 ${n} 张防御牌附魔「黏糊」`)
      return
    }
    if (relicId === 'nourishing_soup') {
      // 营养汤：为牌组中所有"打击"附魔「特兹卡塔拉的余烬」
      const n = enchantAllByFilter((c) => c.name === '打击', 'tezcataras_ember')
      notify(`营养汤：为 ${n} 张打击牌附魔「特兹卡塔拉的余烬」`)
      return
    }
    if (relicId === 'gorgeous_bracelet') {
      // 华美手镯：选择至多 3 张牌附魔「迅速」
      pickEnchantCards({
        title: '华美手镯',
        hint: '选择至多 3 张牌附魔「迅速」',
        enchant: 'swift',
        count: 3,
      })
      return
    }
    if (relicId === 'tri_blade_boomerang') {
      // 三刃回旋镖：选择至多 3 张攻击牌附魔「本能」
      pickEnchantCards({
        title: '三刃回旋镖',
        hint: '选择至多 3 张攻击牌附魔「本能」',
        enchant: 'instinct',
        count: 3,
        filter: (c) => c.type === 'attack',
      })
      return
    }
    // —— 加入指定/随机卡牌类（改为直接随机获得 + 居中展示，不再挂起选卡界面） ——
    if (relicId === 'arcane_scroll') {
      // 奥术卷轴：随机获得 1 张稀有牌（居中展示，不再弹"从 3 张中选 1"的选卡界面）
      const picked = randomCardFrom(rarePool(rng), rng())
      if (picked) addDeckCard(picked.id)
      notify('奥术卷轴：获得 1 张随机稀有牌')
      return
    }
    if (relicId === 'hefty_tablet') {
      // 沉重石板：从 3 张稀有牌中选择 1 张加入，同时将 1 张受伤加入牌组（relic.md）
      // 交互：先弹"从 3 张稀有牌选 1"的选择界面；选中后才把受伤 + 稀有牌一起加入并居中展示
      offerCardChoice({
        title: '沉重石板',
        hint: '从 3 张稀有牌中选择 1 张加入牌组（同时加入 1 张受伤）',
        pool: rarePool(rng),
        offer: 3,
        count: 1,
        allowSkip: false, // 数据要求必须选择 1 张稀有牌
        rand: rng(),
        onPick: (ids) => {
          // 先入组受伤，再入组所选稀有牌；最后统一居中展示"受伤 + 稀有牌"两张
          // （addDeckCard 各自的中间 reveal 被这句覆盖，最终只显示这一组）
          addDeckCard('injured')
          if (ids[0]) addDeckCard(ids[0])
          revealCards([getCard('injured') as Card, ...(ids[0] ? [getCard(ids[0]) as Card] : [])])
          notify('沉重石板：选择 1 张稀有牌并加入 1 张受伤')
        },
      })
      return
    }
    if (relicId === 'neows_torment') {
      addDeckCard('neows_anger')
      notify('涅奥的苦痛：加入一张涅奥之怒')
      return
    }
    if (relicId === 'scroll_boxes') {
      // 卷轴箱：从 2 个卡牌包中选择 1 包加入牌组（relic.md"从 2 个卡牌包中选择 1 包"）
      // 每包 3 张非基础战士牌；玩家选包后，把该包全部卡加入并整包居中展示
      const packs = [0, 1].map((i) => ({
        label: `卡包 ${i + 1}`,
        // 每个卡包用"不同盐"的随机源：rng() 每次都返回同种子(seed+relics数)的新流，
        // 若不加盐，两个卡包会生成完全相同的一组牌。加 i*盐使两包内容不同。
        cards: makeCardPack(mulberry32(r.seed + r.relics.length * 97 + i * 7919)),
      }))
      offerPick(
        // mode='packs'：候选为卡包，点击某包整包加入（PickCardsModal 按包索引回传）
        {
          title: '卷轴箱',
          hint: '从 2 个卡牌包中选择 1 包加入牌组',
          mode: 'packs',
          packs,
          count: 1,
        },
        (result) => {
          const idx = Number(result[0])
          const chosen = packs[idx]
          if (chosen) {
            for (const c of chosen.cards) addDeckCard(c.id)
            revealCards(chosen.cards) // 整包牌居中展示
          }
          notify('卷轴箱：将一个卡牌包加入牌组')
        },
      )
      return
    }
    if (relicId === 'dowsing_rod') {
      // 寻龙尺：加入一张随机无色牌（原"探寻"卡在数据中缺失，随机无色兜底）
      addDeckCard(randomCardFrom(colorlessPool(rng), rng())?.id)
      notify('寻龙尺：加入一张随机无色牌')
      return
    }
    if (relicId === 'lead_paperweight') {
      // 铅制镇纸：从 2 张无色牌中选择 1 张加入牌组（relic.md"从 2 张无色牌中选择 1 张"）
      offerCardChoice({
        title: '铅制镇纸',
        hint: '从 2 张无色牌中选择 1 张加入牌组',
        pool: colorlessPool(rng),
        offer: 2,
        count: 1,
        rand: rng(),
        onPick: (ids) => {
          if (ids[0]) addDeckCard(ids[0])
          notify('铅制镇纸：加入所选无色牌')
        },
      })
      return
    }
    // —— 移除类（选牌类：挂起 offerPick） ——
    if (relicId === 'precise_scissors') {
      // 精准剪刀：从"全卡组"中选择 1 张牌移除（DeckChooseOverlay 显示全部卡实例）；"永恒"牌不可移除
      const ok = pickDeckCards({
        title: '精准剪刀',
        hint: '选择 1 张牌从牌组中移除',
        count: 1,
        min: 1,
        filter: (e) => !isUniqueCard(e.id),
        resolve: (indices) => {
          removeAtIndices(indices)
          notify('精准剪刀：移除 1 张牌')
        },
      })
      if (!ok) notify('精准剪刀：牌组为空，无可移除的牌')
      return
    }
    if (relicId === 'precarious_shears') {
      // 松动羊毛剪：从"全卡组"选择 1~2 张牌移除并失去 16 点生命（min=1 允许只选 1 张）；"永恒"牌不可移除
      const ok = pickDeckCards({
        title: '松动羊毛剪',
        hint: '选择 1~2 张牌移除（失去 16 点生命）',
        count: 2,
        min: 1,
        filter: (e) => !isUniqueCard(e.id),
        resolve: (indices) => {
          removeAtIndices(indices)
          r.hp = Math.max(1, r.hp - 16)
          notify('松动羊毛剪：移除牌并失去 16 点生命')
        },
      })
      if (!ok) notify('松动羊毛剪：无可移除的牌')
      return
    }
    // —— 升级类 ——
    if (relicId === 'neows_talisman') {
      // 涅奥的护符：拾起时自动升级 1 张打击和 1 张防御（不弹选卡界面）。
      // 优先升级"未升级"的该类型实例，其次任一该类型实例；只作用于那一张拷贝。
      const upgradeOneOf = (id: string): void => {
        const uni = r.deck.findIndex((e) => e.id === id && !e.upgrade)
        const at = uni >= 0 ? uni : r.deck.findIndex((e) => e.id === id)
        if (at >= 0) upgradeAt(at)
      }
      upgradeOneOf('strike_ironclad')
      upgradeOneOf('defend_ironclad')
      notify('涅奥的护符：升级打击与防御')
      return
    }
    if (relicId === 'pomander') {
      // 橙型香盒：升级 1 张未升级的牌。改用"全卡组选卡"界面(DeckChooseOverlay)按牌组实例选择，
      // 可直观看到全部牌（含重复、已升级标记），而非按 id 去重的候选列表
      const ok = pickDeckCards({
        title: '橙型香盒',
        hint: '选择 1 张未升级的牌进行升级',
        count: 1,
        min: 1,
        allowSkip: true,
        filter: (e) => !e.upgrade, // 仅可选中"未升级"的实例
        resolve: (indices) => {
          if (indices[0] !== undefined) upgradeAt(indices[0]) // 升级选中的那张实例（独立于其他同名卡）
          notify('橙型香盒：升级 1 张牌')
        },
      })
      if (ok) return
      // 无候选（牌组中已无未升级的牌）时提示并跳过
      notify('橙型香盒：所有牌均已升级')
      return
    }
    // —— 变化类（选牌类：挂起 offerPick） ——
    if (relicId === 'new_leaf') {
      // 新叶：从"全卡组"选择 1 张牌变化为随机战士牌；"永恒"牌不可变化
      const ok = pickDeckCards({
        title: '新叶',
        hint: '选择 1 张牌进行变化',
        count: 1,
        min: 1,
        filter: (e) => !isUniqueCard(e.id),
        resolve: (indices) => {
          if (indices[0] !== undefined) transformAt(indices[0])
          notify('新叶：变化 1 张牌')
        },
      })
      if (!ok) notify('新叶：牌组为空，无可变化的牌')
      return
    }
    if (relicId === 'leafy_poultice') {
      // 树叶药膏：拾起时自动变化 1 张打击和 1 张防御（不弹选卡界面），然后失去 12 点最大生命。
      const transformed: Card[] = []
      const transformOneOf = (id: string): void => {
        const idx = r.deck.findIndex((e) => e.id === id)
        if (idx >= 0) {
          const c = transformAt(idx) // 将对应 id 的指定张拷贝变化为随机战士牌
          if (c) transformed.push(c)
        }
      }
      transformOneOf('strike_ironclad')
      transformOneOf('defend_ironclad')
      // 两块变化后的新牌一起居中展示（浮层 1s 后消失，牌组中已替换）
      if (transformed.length) revealCards(transformed)
      r.maxHp = Math.max(1, r.maxHp - 12)
      r.hp = Math.min(r.hp, r.maxHp)
      notify('树叶药膏：变化打击与防御，失去 12 点最大生命')
      return
    }
    if (relicId === 'pandoras_box') {
      // 潘多拉魔盒：变化所有"打击"和"防御"为随机非基础战士牌（保留原升级状态，仅换 id）
      const changed: Card[] = []
      r.deck = r.deck.map((entry) => {
        if (entry.id === 'strike_ironclad' || entry.id === 'defend_ironclad') {
          const t = randomCardFrom(transformPool(entry.id), rng()) as Card | undefined
          if (t && t.id !== entry.id) {
            changed.push(t)
            return { id: t.id, upgrade: entry.upgrade }
          }
        }
        return entry
      })
      // 全部变化后的新牌一起居中展示
      if (changed.length) revealCards(changed)
      notify('潘多拉魔盒：变化所有打击与防御')
      return
    }
    // —— 已解锁剧情类上古遗物（relic.md §四，先古池；不依赖药水/其他角色等未实现子系统） ——
    // 故事书：将一张「至亮之焰」加入牌组
    if (relicId === 'storybook') {
      addDeckCard('brightest_flame')
      notify('故事书：将一张「至亮之焰」加入牌组')
      return
    }
    // 珠宝盒：将一张「神化」加入牌组
    if (relicId === 'jewel_box') {
      addDeckCard('apotheosis')
      notify('珠宝盒：将一张「神化」加入牌组')
      return
    }
    // 坦克斯的哨子：将一张「吹哨」加入牌组
    if (relicId === 'tanks_whistle') {
      addDeckCard('whistle')
      notify('坦克斯的哨子：将一张「吹哨」加入牌组')
      return
    }
    // 原初之爪：将 3 张「许愿」与 2 张随机诅咒加入牌组
    if (relicId === 'primordial_claw') {
      addDeckCard('wish')
      addDeckCard('wish')
      addDeckCard('wish')
      // randomCurse 接收"返回 PRNG 的函数"（rng 工厂），两次用不同盐种子取不同诅咒
      const c1 = randomCurse(rng)
      const c2 = randomCurse(() => mulberry32(r.seed + r.relics.length * 97 + 1))
      if (c1?.id) addDeckCard(c1.id)
      if (c2?.id && c2.id !== c1?.id) addDeckCard(c2.id)
      notify('原初之爪：加入 3 张「许愿」与 2 张随机诅咒')
      return
    }
    // 卓越斗篷：失去 9 点最大生命，将 3 张「灵体」加入牌组
    if (relicId === 'paramount_cloak') {
      r.maxHp = Math.max(1, r.maxHp - 9)
      r.hp = Math.min(r.hp, r.maxHp)
      addDeckCard('apparition')
      addDeckCard('apparition')
      addDeckCard('apparition')
      notify('卓越斗篷：失去 9 点最大生命，加入 3 张「灵体」')
      return
    }
    // 腌制活雾：移除 3 张牌，将一张「愚行」加入牌组
    if (relicId === 'pickled_mist') {
      // 腌制活雾：从"全卡组"选择 3 张牌移除，并将一张「愚行」加入牌组；"永恒"牌不可移除
      addDeckCard('folly')
      const ok = pickDeckCards({
        title: '腌制活雾',
        hint: '选择 3 张牌移除（加入一张愚行）',
        count: Math.min(3, run.value!.deck.length),
        min: 1,
        filter: (e) => !isUniqueCard(e.id),
        resolve: (indices) => {
          removeAtIndices(indices)
          notify('腌制活雾：移除牌并加入一张「愚行」')
        },
      })
      if (!ok) notify('腌制活雾：加入一张「愚行」')
      return
    }
    // 空鸟笼：移除牌组中的 2 张牌（"永恒"牌不可移除）
    if (relicId === 'empty_birdcage') {
      // 空鸟笼：从"全卡组"选择 2 张牌移除；"永恒"牌不可移除
      const ok = pickDeckCards({
        title: '空鸟笼',
        hint: '选择 2 张牌移除',
        count: Math.min(2, run.value!.deck.length),
        min: 1,
        filter: (e) => !isUniqueCard(e.id),
        resolve: (indices) => {
          removeAtIndices(indices)
          notify('空鸟笼：移除牌')
        },
      })
      if (!ok) notify('空鸟笼：牌组为空')
      return
    }
    // 利爪：将至多 6 张牌变化为「撕咬」
    if (relicId === 'claws') {
      // 利爪：从"全卡组"选择至多 6 张牌变化为「撕咬」（保留其升级状态）
      const ok = pickDeckCards({
        title: '利爪',
        hint: '选择至多 6 张牌变化为「撕咬」',
        count: Math.min(6, run.value!.deck.length),
        min: 1,
        filter: (e) => e.id !== 'bite' && !isUniqueCard(e.id), // 撕咬与"永恒"牌不可选
        resolve: (indices) => {
          for (const idx of indices) {
            const entry = run.value!.deck[idx]
            if (entry && !isUniqueCard(entry.id)) entry.id = 'bite' // 保留升级状态，仅换 id
          }
          notify('利爪：将所选牌变化为撕咬')
        },
      })
      if (!ok) notify('利爪：无可变化的牌')
      return
    }
    // 大～抱抱：移除 4 张牌；每场战斗开始向抽牌堆加入一张煤灰（战斗效果在 startBattle 处理）
    if (relicId === 'big_hug') {
      // 大～抱抱：从"全卡组"选择 4 张牌移除；每场战斗开始向抽牌堆加入一张煤灰（战斗效果在 startBattle 处理）
      const ok = pickDeckCards({
        title: '大～抱抱',
        hint: '选择 4 张牌移除',
        count: Math.min(4, run.value!.deck.length),
        min: 1,
        filter: (e) => !isUniqueCard(e.id),
        resolve: (indices) => {
          removeAtIndices(indices)
          notify('大～抱抱：移除牌')
        },
      })
      if (!ok) notify('大～抱抱：牌组为空')
      return
    }
    // 血染玫瑰：将一张「执迷」加入牌组；每回合开始 +1 能量（能量效果在 relicSystem 处理）
    if (relicId === 'blood_rose') {
      addDeckCard('obsession')
      notify('血染玫瑰：加入一张「执迷」，每回合开始获得 1 点能量')
      return
    }
    // 皮草大衣：之后 7 场战斗的敌人将只有 1 点生命（startBattle 逐场递减并生效）
    if (relicId === 'fur_coat') {
      r.meta.furCoatBattles = 7
      notify('皮草大衣：之后 7 场战斗的敌人将只有 1 点生命')
      return
    }
    // 星盘：选择 3 张牌进行变化，然后升级（relic.md §四·达弗）；"永恒"牌不可选
    if (relicId === 'astrolabe') {
      // 星盘：从"全卡组"选择 3 张牌进行变化并升级（可只选 1~3 张）；"永恒"牌不可选
      const ok = pickDeckCards({
        title: '星盘',
        hint: '选择 3 张牌变化并升级（可只选 1~3 张）',
        count: Math.min(3, run.value!.deck.length),
        min: 1,
        filter: (e) => !isUniqueCard(e.id),
        resolve: (indices) => {
          for (const idx of indices) transformAt(idx, true) // 变化为随机非基础战士牌，并置为已升级
          notify('星盘：选中的牌已变化并升级')
        },
      })
      if (!ok) notify('星盘：牌组为空')
      return
    }
    // 佩尔之牙：选择牌移除，每场战斗结束随机 1 张升级返还（relic.md §四·佩尔）
    if (relicId === 'percy_tooth') {
      // 佩尔之牙：从"全卡组"选择牌移除（每场战斗结束随机 1 张升级返还）；"永恒"牌不可移除
      const ok = pickDeckCards({
        title: '佩尔之牙',
        hint: '选择牌移除（每场战斗结束随机 1 张升级返还）',
        count: Math.min(5, run.value!.deck.length),
        min: 1,
        filter: (e) => !isUniqueCard(e.id),
        resolve: (indices) => {
          // 记录被移除牌的 id（供每场战斗结束按池抽取一张返回），再按索引从牌组移除
          const removedIds: string[] = []
          for (const idx of [...indices].sort((a, b) => b - a)) {
            const entry = run.value!.deck[idx]
            if (entry && !isUniqueCard(entry.id)) {
              removedIds.push(entry.id)
              run.value!.deck.splice(idx, 1)
            }
          }
          r.meta.percyToothRemoved = [...(r.meta.percyToothRemoved ?? []), ...removedIds]
          notify(`佩尔之牙：移除 ${removedIds.length} 张牌`)
        },
      })
      if (!ok) notify('佩尔之牙：牌组为空')
      return
    }
    // —— 遗物发放类（递归发放，深度保护防循环） ——
    if (relicId === 'small_capsule') {
      grantRandomRelics(rng, 1, depth)
      notify('小型扭蛋：获得 1 件随机遗物')
      return
    }
    if (relicId === 'large_capsule') {
      addDeckCard('strike_ironclad')
      addDeckCard('defend_ironclad')
      grantRandomRelics(rng, 2, depth)
      notify('巨大扭蛋：获得 2 件随机遗物，并加入打击/防御')
      return
    }
    if (relicId === 'neows_bones') {
      grantRandomRelics(rng, 2, depth)
      addDeckCard(randomCurse(rng)?.id)
      notify('涅奥骨骰：获得 2 件随机涅奥遗物与 1 张随机诅咒')
      return
    }
    // —— 最大生命/金币类（补全） ——
    if (relicId === 'pear') {
      // 梨子：最大生命 +10
      r.maxHp += 10
      r.hp += 10
      notify('梨子：最大生命提升 10')
      return
    }
    if (relicId === 'mango') {
      // 芒果：最大生命 +14
      r.maxHp += 14
      r.hp += 14
      notify('芒果：最大生命提升 14')
      return
    }
    if (relicId === 'mango_ev') {
      // 芒果？？？（事件变体）：最大生命 +3
      r.maxHp += 3
      r.hp += 3
      notify('芒果？？？：最大生命提升 3')
      return
    }
    if (relicId === 'waffle_ev') {
      // 李家华夫饼？？？（事件变体）：回复 10% 最大生命
      const heal = Math.floor((r.maxHp * 10) / 100)
      r.hp = Math.min(r.maxHp, r.hp + heal)
      notify('李家华夫饼？？？：回复 10% 生命')
      return
    }
    if (relicId === 'waffle') {
      // 李家华夫饼：最大生命 +7 并回复所有生命
      r.maxHp += 7
      r.hp = r.maxHp
      notify('李家华夫饼：最大生命提升 7，并回复所有生命')
      return
    }
    if (relicId === 'cloth_fruit') {
      // 布质果实：最大生命 +31
      r.maxHp += 31
      r.hp += 31
      notify('布质果实：最大生命提升 31')
      return
    }
    if (relicId === 'big_mushroom') {
      // 大蘑菇：拾起时最大生命 +20（战斗开始少抽 2 张在 ON_COMBAT_START 处理）
      r.maxHp += 20
      r.hp += 20
      notify('大蘑菇：最大生命提升 20')
      return
    }
    if (relicId === 'old_coin') {
      // 古钱币：获得 300 金币
      gainGold(300)
      notify('古钱币：获得 300 金币')
      return
    }
    if (relicId === 'signet_ring') {
      // 图章戒指：获得 999 金币
      gainGold(999)
      notify('图章戒指：获得 999 金币')
      return
    }
    // —— 升级类（补全，MVP 随机选取匹配类型的未升级牌） ——
    if (relicId === 'whetstone') {
      // 磨刀石：随机升级 2 张攻击牌
      const n = upgradeRandomNByType(rng(), 2, 'attack')
      notify(`磨刀石：升级 ${n} 张攻击牌`)
      return
    }
    if (relicId === 'war_paint') {
      // 战纹涂料：随机升级 2 张技能牌
      const n = upgradeRandomNByType(rng(), 2, 'skill')
      notify(`战纹涂料：升级 ${n} 张技能牌`)
      return
    }
    if (relicId === 'fragrant_mushroom') {
      // 芳香蘑菇：失去 15 点生命，随机升级 2 张牌
      r.hp = Math.max(1, r.hp - 15)
      upgradeRandomN(rng(), 2)
      notify('芳香蘑菇：失去 15 点生命，升级 2 张牌')
      return
    }
    if (relicId === 'sandcastle') {
      // 沙堡：随机升级 6 张牌
      upgradeRandomN(rng(), 6)
      notify('沙堡：升级 6 张牌')
      return
    }
    if (relicId === 'delicious_cookie') {
      // 美味饼干：升级 4 张牌
      upgradeRandomN(rng(), 4)
      notify('美味饼干：升级 4 张牌')
      return
    }
    // —— 加入指定卡牌/遗物类（补全，先古） ——
    if (relicId === 'percy_horn') {
      // 佩尔之角：2 张放松加入牌组
      addDeckCard('relax')
      addDeckCard('relax')
      notify('佩尔之角：2 张放松加入牌组')
      return
    }
    if (relicId === 'dusty_tome') {
      // 尘封魔典：获得一张随机先古牌（先古池：sunder/腐蚀）
      const ancientCards = cardsData.warrior.filter((c) => c.rarity === 'ancient')
      addDeckCard(randomCardFrom(ancientCards, rng())?.id)
      notify('尘封魔典：获得一张随机先古牌')
      return
    }
    if (relicId === 'ember_tea') {
      // 余烬茶：记录剩余 5 场战斗 +2 力量（在 ON_COMBAT_START 递减生效）
      r.meta.emberTeaLeft = 5
      notify('余烬茶：接下来 5 场战斗开始时 +2 力量')
      return
    }
    // —— 未实现需持续机制的（羽翼之靴为地图导航） ——
  }

  // ===== 遗物拾取辅助（确定性/随机，MVP 简化） =====
  // 随机选一张指定池卡牌并加入牌组（卡不存在时静默跳过，避免脏数据）
  // 共用的"加入牌组"入口，在此集中结算加入类遗物副作用（宾邦复制/招财异鱼金币等）
  // 通行金币获得入口：增加金币并结算"获得金币"类遗物（火龙果：每次获得金币时最大生命 +1）
  // 所有正向金币来源（战斗奖励/事件/拾取/金鱼等）统一走此入口，避免火龙果漏触发
  function gainGold(amount: number): void {
    const r = run.value
    if (!r || amount <= 0) return
    r.gold += amount
    if (r.relics.includes('dragon_fruit')) {
      r.maxHp += 1
      r.hp += 1
      log.value.push('[火龙果] 获得金币，最大生命提升 1 点')
    }
  }

  function addDeckCard(id?: string): void {
    const r = run.value
    if (!r || !id || !getCard(id)) return
    // 附魔类遗物被动：菲涅耳透镜（带格挡的牌→灵巧）
    applyRelicEnchantOnAdd(id)
    // 新增为独立"卡实例"（upgrade 默认 false，仅升级操作单独置位）
    r.deck.push({ id, upgrade: false })
    // 宾邦：往牌组增添卡牌时额外添加一张相同的牌（同样为独立实例）
    if (r.relics.includes('bing_bang')) r.deck.push({ id, upgrade: false })
    // 招财异鱼：加入卡牌时获得 15 金币
    if (r.relics.includes('goldfish')) gainGold(15)
    // 黑石护符：获得诅咒时最大生命 +6
    if (r.relics.includes('black_stele') && cardsData.curse.some((c) => c.id === id)) {
      r.maxHp += 6
      r.hp += 6
    }
    // 五轮书：每加入 5 张牌回复 20 点生命（自拾起后计数）
    if (r.relics.includes('five_layers')) {
      r.meta.fiveLayersCounter = (r.meta.fiveLayersCounter ?? 0) + 1
      if ((r.meta.fiveLayersCounter ?? 0) % 5 === 0) {
        r.hp = Math.min(r.maxHp, r.hp + 20)
      }
    }
    // 卡牌居中展示：把新加入的这张牌（及宾邦复制的第二张）在屏幕正中展示 1 秒
    // 仅展示浮层消失，卡牌留在 r.deck 中
    if (r.relics.includes('bing_bang')) {
      revealCards([getCard(id) as Card, getCard(id) as Card])
    } else {
      revealCards([getCard(id) as Card])
    }
  }

  // 稀有牌池（战士池），供奥术卷轴/沉重石板随机选取
  function rarePool(rng: () => () => number): Card[] {
    const pool = cardsData.warrior.filter((c) => c.rarity === 'rare')
    return shuffleRare(rng(), pool)
  }

  // 无色牌池，供寻龙尺/铅制镇纸随机选取
  function colorlessPool(rng: () => () => number): Card[] {
    return shuffleRare(rng(), cardsData.colorless)
  }

  // 诅咒池，供涅奥骨骰随机选取
  function randomCurse(rng: () => () => number): Card | undefined {
    const pool = cardsData.curse
    return pool.length ? shuffleRare(rng(), pool)[0] : undefined
  }

  // Fisher-Yates 洗牌返回副本（不修改原池）
  function shuffleRare(rng: () => number, arr: Card[]): Card[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = a[i]
      a[i] = a[j]!
      a[j] = tmp!
    }
    return a
  }

  // 从稀有/无色池取一张随机卡（供"加入随机卡牌"）
  function randomCardFrom(pool: Card[], rng: () => number): Card | undefined {
    return pool.length ? pool[Math.floor(rng() * pool.length)] : undefined
  }

  // 判断某张牌是否带"永恒"关键词（不可被移除或变化，PRD §3.3.6 关键词表）
  function isUniqueCard(id: string): boolean {
    return getCard(id)?.keywords.includes('unique') ?? false
  }

  // 变化牌组第 idx 张为随机非基础战士牌（按卡实例索引，供全卡组选卡 resolve 用）；
  // "永恒"牌不可变化；toUpgrade 为 true 时(星盘)新牌直接置为已升级。
  // 变化后把新牌在屏幕正中展示 1 秒（浮层消失，牌组中已替换）；返回新牌供多张场景聚合展示
  function transformAt(idx: number, toUpgrade = false): Card | undefined {
    const r = run.value!
    const entry = r.deck[idx]
    if (!entry || isUniqueCard(entry.id)) return undefined
    const target = randomCardFrom(transformPool(entry.id), Math.random)
    if (target && target.id !== entry.id) {
      r.deck[idx] = { id: target.id, upgrade: toUpgrade ? true : entry.upgrade }
      // 卡牌居中展示：把变化后的新牌在屏幕正中展示 1 秒（浮层消失，牌组中已替换）
      revealCards([target])
      return target
    }
    return undefined
  }

  // 按牌组索引移除多张牌（供全卡组选卡 resolve 用）：降序 splice 避免下标错位；"永恒"牌不删
  // 返回实际移除张数
  function removeAtIndices(indices: number[]): number {
    const r = run.value!
    let removed = 0
    for (const idx of [...indices].sort((a, b) => b - a)) {
      const entry = r.deck[idx]
      if (entry && !isUniqueCard(entry.id)) {
        r.deck.splice(idx, 1)
        removed++
      }
    }
    return removed
  }

  // 生成一个随机卡包（3 张不重复的非基础/先古战士牌），供卷轴箱"从 2 个卡包选 1 包"
  function makeCardPack(rand: () => number): Card[] {
    const pool = cardsData.warrior.filter((c) => c.rarity !== 'basic' && c.rarity !== 'ancient')
    const pack: Card[] = []
    const used = new Set<string>()
    while (pack.length < 3 && used.size < pool.length) {
      const c = pool[Math.floor(rand() * pool.length)]!
      if (used.has(c.id)) continue
      used.add(c.id)
      pack.push(c)
    }
    return pack
  }

  // 从牌组移除 n 张随机牌（精准剪刀/松动羊毛剪）；"永恒"牌不可被随机移除
  function removeRandomCards(rng: () => () => number, n: number): void {
    const r = run.value!
    for (let i = 0; i < n; i++) {
      // 收集可移除下标（跳过"永恒"牌）
      const removable: number[] = []
      r.deck.forEach((entry, idx) => {
        if (!isUniqueCard(entry.id)) removable.push(idx)
      })
      if (removable.length === 0) return
      r.deck.splice(removable[Math.floor(rng()() * removable.length)]!, 1)
    }
  }

  // 升级牌组第 idx 张（按"卡实例"独立升级：仅置位该张 private upgrade 标记）
  function upgradeAt(idx: number): void {
    const r = run.value!
    const entry = r.deck[idx]
    if (entry) entry.upgrade = true
  }

  // 找一个未升级牌的索引（橙型香盒），无则返回 -1
  function randomUpgradableIndex(rng: () => () => number): number {
    const r = run.value!
    const candidates: number[] = []
    r.deck.forEach((entry, i) => {
      if (!entry.upgrade) candidates.push(i)
    })
    return candidates.length ? candidates[Math.floor(rng()() * candidates.length)]! : -1
  }

  // 可变化的目标池（排除自身，避免"变化后仍是原牌"；排除基础打击/防御，保证有变化感）
  function transformPool(exceptId?: string): Card[] {
    return cardsData.warrior.filter((c) => c.rarity !== 'basic' && c.id !== exceptId)
  }

  // 变化牌组中的第一张匹配牌（fromId 缺省则随机选一张非"永恒"牌）；新叶/树叶药膏/潘多拉魔盒
  function transformFirst(rng: () => () => number, fromId?: string): void {
    const r = run.value!
    let idx: number
    if (fromId) {
      if (isUniqueCard(fromId)) return
      idx = r.deck.findIndex((en) => en.id === fromId)
    } else {
      // 随机变化：仅在可变的（非"永恒"）牌中挑一张
      const candidates: number[] = []
      r.deck.forEach((entry, i) => {
        if (!isUniqueCard(entry.id)) candidates.push(i)
      })
      if (candidates.length === 0) return
      idx = candidates[Math.floor(rng()() * candidates.length)]!
    }
    if (idx < 0 || idx >= r.deck.length) return
    const src = r.deck[idx]!
    const target = randomCardFrom(transformPool(src.id), rng())
    if (target && target.id !== src.id) {
      r.deck[idx] = { id: target.id, upgrade: false }
      // 卡牌居中展示：把变化后的新牌在屏幕正中展示 1 秒（浮层消失，牌组中已替换）
      revealCards([target])
    }
  }

  // 将牌组中第一张基础牌（rarity === 'basic'，即打击/防御/痛击等初始牌）
  // 替换为指定目标牌；供木雕事件（初始牌→啄击/坚韧之环）
  function transformBasicTo(toId: string): void {
    const r = run.value!
    const idx = r.deck.findIndex((en) => getCard(en.id)?.rarity === 'basic')
    const target = getCard(toId)
    if (idx < 0 || !target) return
    r.deck[idx] = { id: toId, upgrade: false }
    // 卡牌居中展示：把变化后的新牌在屏幕正中展示 1 秒（浮层消失，牌组中已替换）
    revealCards([target])
  }

  // ===== 附魔辅助（document/enchantments.md / agent.md §5.1 数据驱动） =====

  // 为某张牌挂载附魔 id（作用于该 id 全部副本的 MVP 简化，与 card.upgrade 一致）；
  // 已挂载同 id 附魔时跳过避免重复；返回是否新增
  function applyEnchant(cardId: string, enchantId: string): boolean {
    const card = getCard(cardId)
    if (!card || card.enchantments?.includes(enchantId)) return false
    card.enchantments = [...(card.enchantments ?? []), enchantId]
    return true
  }

  // 为牌组中所有符合过滤条件的牌附魔（按 id 去重后逐个挂载；返回实际新增数）
  // 供佩尔之爪（防御→黏糊）/营养汤（打击→特兹卡塔拉的余烬）这类"全体附魔"遗物使用
  function enchantAllByFilter(filter: (c: Card) => boolean, enchantId: string): number {
    const r = run.value!
    const seen = new Set<string>()
    let n = 0
    for (const entry of r.deck) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      const c = getCard(entry.id)
      if (c && filter(c) && applyEnchant(entry.id, enchantId)) n++
    }
    return n
  }

  // 通用"选牌附魔"：从牌组中选择至多 count 张符合 filter 的牌附魔 enchantId；
  // 供 ON_PICKUP 附魔遗物（木札/扭曲锤子等）与附魔类事件（自助指南/永恒之石等）复用；
  // 无候选牌时提示并跳过；玩家在选牌浮层确认后统一挂载
  function pickEnchantCards(opts: {
    title: string // 弹窗标题（遗物/事件名）
    hint: string // 副标题说明（限定牌型与代价提示）
    enchant: string // 附魔 id
    count: number // 需选数量（至多）
    min?: number // 最少选择数（默认 0 可跳过）
    allowSkip?: boolean // 是否可跳过（默认 true，附魔可选）
    filter?: (c: Card) => boolean // 牌型过滤（攻击/技能/能力/带消耗等）
  }): void {
    const enchantName = getEnchantment(opts.enchant)?.name ?? opts.enchant
    const r = run.value
    if (!r) return
    // 全卡组选牌附魔：展示完整牌组（含重复实例与升级标记，而非按 id 去重的列表），
    // filter 限定可附魔的牌型；选中任一实例后 applyEnchant（附魔作用于该卡 id 的全部副本，
    // 因此选择哪一张实例不影响结果，只是让玩家能看清牌组全貌）
    const ok = pickDeckCards({
      title: opts.title,
      hint: opts.hint,
      count: opts.count,
      min: opts.min ?? 0,
      allowSkip: opts.allowSkip ?? true,
      filter: (e) => (opts.filter ? opts.filter(getCard(e.id)!) : true),
      resolve: (indices) => {
        // 按不同卡 id 去重统计实际新增附魔张数（同名多实例选任意一张效果相同）
        const appliedIds = new Set<string>()
        for (const idx of indices) {
          const entry = r.deck[idx]
          if (entry && applyEnchant(entry.id, opts.enchant)) appliedIds.add(entry.id)
        }
        void (message.value = `${opts.title}：为 ${appliedIds.size} 张牌附魔「${enchantName}」`)
      },
    })
    if (!ok) {
      void (message.value = `${opts.title}：牌组中没有符合条件的牌，无法附魔「${enchantName}」`)
    }
  }

  // 加入牌组时的附魔类遗物被动钩子（菲涅耳透镜：带格挡的牌→灵巧）；
  // 在领取卡牌奖励（claimCardReward）与 addDeckCard 两处"加入牌组"入口统一调用
  function applyRelicEnchantOnAdd(cardId: string): void {
    const r = run.value
    const c = getCard(cardId)
    if (!r || !c) return
    // 菲涅耳透镜：效果链含"格挡"的牌加入牌组时为它附魔「灵巧」
    if (r.relics.includes('fresnel_lens') && c.effects.some((e) => e.type === 'block')) {
      if (applyEnchant(cardId, 'nimble'))
        void (message.value = '菲涅耳透镜：为带格挡的牌附魔「灵巧」')
    }
  }

  // 领取卡牌奖励时的附魔类遗物被动（羽翼护符/亮片/华美发束）：对刚领取的牌挂载附魔
  function applyRelicEnchantOnClaim(cardId: string): void {
    const r = run.value
    if (!r) return
    // 羽翼护符：每次卡牌奖励中随机一张牌附魔「迅速」→ MVP 对领取的这张牌生效
    if (r.relics.includes('feather_amulet') && applyEnchant(cardId, 'swift')) {
      void (message.value = '羽翼护符：为领取的牌附魔「迅速」')
    }
    // 亮片：之后所有卡牌奖励附魔「华彩」
    if (r.relics.includes('sequins') && applyEnchant(cardId, 'glam')) {
      void (message.value = '亮片：为领取的牌附魔「华彩」')
    }
    // 华美发束：第一次卡牌奖励附魔「华彩」（拾起置位，首次领取消耗）
    if (r.meta.silkenTressPending) {
      r.meta.silkenTressPending = false
      if (applyEnchant(cardId, 'glam')) void (message.value = '华美发束：为领取的牌附魔「华彩」')
    }
  }

  // —— 事件全量结算辅助（document/event.md 全部 57 个事件所需的基础操作） ——

  // 从指定卡池随机加入 n 张牌到牌组（返回实际加入数；脑蛭/满屋芝士等）
  // 卡数据缺失时自动跳过，保证无脏数据
  function addRandomFromPool(pool: Card[], rand: () => number, n: number): number {
    const r = run.value!
    let added = 0
    const gained: Card[] = []
    for (let i = 0; i < n; i++) {
      const c = randomCardFrom(pool, rand)
      if (c) {
        r.deck.push({ id: c.id, upgrade: false })
        gained.push(c)
        added++
      }
    }
    // 卡牌居中展示：把新获得的随机牌在屏幕正中展示 1 秒（浮层消失，牌留在牌组）
    if (gained.length) revealCards(gained)
    return added
  }

  // 随机升级 n 张未升级牌（返回实际升级数；光与暗之门/灵魂嫁接者/真理石板等）
  function upgradeRandomN(rand: () => number, n: number): number {
    let done = 0
    for (let i = 0; i < n; i++) {
      const idx = randomUpgradableIndex(() => () => rand())
      if (idx < 0) break
      upgradeAt(idx)
      done++
    }
    return done
  }

  // 随机升级 n 张指定类型（attack/skill）且未升级的牌（磨刀石/战纹涂料；返回实际升级数）
  function upgradeRandomNByType(rand: () => number, n: number, type: Card['type']): number {
    const r = run.value!
    let done = 0
    for (let i = 0; i < n; i++) {
      const candidates = r.deck
        .map((entry, idx) => ({ entry, idx }))
        .filter(({ entry }) => {
          const c = getCard(entry.id)
          return c && c.type === type && !entry.upgrade
        })
      if (candidates.length === 0) break
      const pick = candidates[Math.floor(rand() * candidates.length)]!
      upgradeAt(pick.idx)
      done++
    }
    return done
  }

  // 随机降级 n 张已升级牌（返回降级数；镜中倒影触碰镜子/旺购离开）
  function downgradeRandomN(rand: () => number, n: number): number {
    const r = run.value!
    const upgraded = r.deck
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) => entry.upgrade)
      .sort(() => rand() - 0.5) // 随机打乱位置
    let done = 0
    for (let k = 0; k < n && k < upgraded.length; k++) {
      r.deck[upgraded[k]!.i]!.upgrade = false
      done++
    }
    return done
  }

  // 复制整个牌组（返回原牌组数；镜中倒影"打碎"）
  function copyDeck(): number {
    const r = run.value!
    const len = r.deck.length
    const copies = r.deck.slice()
    r.deck.push(...copies)
    // 卡牌居中展示：把复制的全部牌在屏幕正中展示 1 秒（浮层消失，副本已留在牌组）
    const shown = copies.map((c) => getCard(c.id)).filter((c): c is Card => !!c)
    if (shown.length) revealCards(shown)
    return len
  }

  // 遗物交换：移除自身一件随机遗物（初始遗物除外），换入一件随机新遗物（遗物交换商/长者兰伟德）
  function swapRandomRelic(rand: () => number): boolean {
    const r = run.value!
    const own = r.relics.filter((x) => x !== 'burning_blood')
    if (own.length === 0) return false
    const dropIdx = Math.floor(rand() * own.length)
    const dropped = own[dropIdx]!
    r.relics.splice(r.relics.indexOf(dropped), 1)
    const pool = relicsData.general.filter(
      (x) => !x.excluded && !r.relics.includes(x.id) && !isFakeRelic(x.id),
    )
    const relic = pool[Math.floor(rand() * pool.length)]
    if (relic) {
      r.relics.push(relic.id)
      onRelicGained(relic.id) // 拾起即生效
      message.value = `遗物交换：失去【${getRelic(dropped)?.name ?? dropped}】，获得【${relic.name}】`
    }
    return true
  }

  // 随机发放 n 件未拥有遗物（小型/巨大扭蛋、涅奥骨骰）；带深度保护防"遗物再发遗物"死循环
  function grantRandomRelics(rng: () => () => number, n: number, depth: number): void {
    if (depth > 5) return
    const r = run.value!
    const pool = [
      ...relicsData.neowPool,
      ...relicsData.general,
      ...relicsData.warrior,
      ...relicsData.ancient,
    ].filter((x) => !x.excluded && !r.relics.includes(x.id) && !isFakeRelic(x.id))
    if (pool.length === 0) return
    for (let i = 0; i < n; i++) {
      const relic = pool[Math.floor(rng()() * pool.length)]
      if (!relic) continue
      r.relics.push(relic.id)
      onRelicGained(relic.id, depth + 1) // 递归结算该遗物自身的拾起效果
    }
  }

  // 选择遗物（先古/事件）
  function claimRelicReward(relicId: string | null): void {
    const r = run.value
    const pr = pendingReward.value
    if (!r || !pr) return
    if (relicId) {
      r.relics.push(relicId)
      onRelicGained(relicId) // 拾起即生效（草莓等）
    }
    pendingReward.value = null
    // 开局遗物选择后解锁第 2 层
    unlockFloor(r.map, 2)
    stateMachine.transition('RUN')
    persist()
  }

  // 屏幕正中的幕名提示：记录当前幕并启动定时器，到时清空以触发 UI 缓慢淡出
  // （由 RunView 首次进入地图时调用，与地图慢滚动画同步播放）
  // @param durationMs 展示时长（毫秒）：由调用方传入"滚动动画时长 + 余量"，保证幕名在滚动到当前层后即开始淡出
  function showActSplash(durationMs = 3000): void {
    actSplash.value = run.value?.act ?? null
    if (actSplashTimer) clearTimeout(actSplashTimer)
    actSplashTimer = setTimeout(() => {
      actSplash.value = null
    }, durationMs)
  }

  // 重掷当前卡牌奖励（浮木遗物：每个卡牌奖励可重掷一次；relic.md §四·欧洛巴斯）
  function rerollCardReward(): void {
    const r = run.value
    const pr = pendingReward.value
    if (!r || !pr || pr.kind !== 'card' || !r.relics.includes('flotsam')) return
    if (r.meta.flotsamRerolled) return // 已重掷过（每奖励一次）
    r.meta.flotsamRerolled = true
    // 换一个种子重新随机卡牌池，保证与首次不同；档位（白/蓝/金）一并重掷
    const rng = mulberry32(r.seed + r.fightCount * 217 + 13)
    pr.cardTier = rollCardRewardTier(rng, battleKind.value)
    pr.cards = pickCardRewards(rng, pr.cardTier)
    log.value.push('[浮木] 重掷了卡牌奖励')
  }

  // ===== 通用选牌（ON_PICKUP 遗物/事件"从 N 张中选 1/若干张"，PRD §3.1 先古之民） =====

  // 通用"从若干张候选卡中获得 1/若干张"选牌请求（事件/遗物获得卡牌类奖励共用）：
  // 从 pool 用 rand 打乱后取前 offer 张互不相同的牌作为候选，弹 PickCardsModal（mode='cards'），
  // 玩家选中 count 张后 onPick(ids) 收到所选卡 id 列表；池空时直接 onPick([])。
  function offerCardChoice(opts: {
    title: string
    hint?: string
    pool: Card[]
    offer: number // 展示候选张数（从池中不重复抽取）
    count: number // 需选张数
    allowSkip?: boolean
    rand: () => number
    onPick: (ids: string[]) => void
  }): void {
    // 用传入随机源把池洗乱，取出前 offer 张互不相同的牌作候选（保证选牌界面无重复 id）
    const shuffled = shuffleRare(opts.rand, opts.pool)
    const seen = new Set<string>()
    const candidates: Card[] = []
    for (const c of shuffled) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      candidates.push(c)
      if (candidates.length >= opts.offer) break
    }
    // 无候选时直接回传空列表（优雅降级）
    if (!candidates.length) {
      opts.onPick([])
      return
    }
    offerPick(
      {
        title: opts.title,
        hint: opts.hint,
        mode: 'cards',
        cards: candidates,
        count: opts.count,
        allowSkip: opts.allowSkip,
      },
      (ids) => opts.onPick(ids),
    )
  }

  // 发起一次选牌请求：push 到队列并由 UI（PickCardsModal）展示，玩家选完后调用
  // resolvePick/skipPick 回传；result 为选中卡 id 数组（packs 模式为包索引字符串数组）
  function offerPick(req: Omit<PickRequest, 'id'>, resolve: (result: string[]) => void): void {
    const id = ++pickSeq.value
    pendingPicks.value.push({ ...req, id })
    pickResolvers.set(id, resolve)
  }

  // 玩家完成选择：取出并执行回传回调，然后从队列移除该项（回调内可再 offerPick 实现链式多轮）
  // 注意先执行回调再移除：回调里若发起下一轮，新请求 id 不同，不会被本项移除误删
  function resolvePick(id: number, result: string[]): void {
    const resolver = pickResolvers.get(id)
    if (resolver) resolver(result)
    pickResolvers.delete(id)
    pendingPicks.value = pendingPicks.value.filter((p) => p.id !== id)
  }

  // 跳过当前选牌（allowSkip 时可用），回传空数组
  function skipPick(id: number): void {
    resolvePick(id, [])
  }

  return {
    run,
    battle,
    battleKind,
    pendingReward,
    actSplash,
    mapIntroDone,
    showActSplash,
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
    restartNode, // 重打当前节点（供暂停菜单，PRD §3.11）
    saveAndExit, // 存档退出返回主菜单（供暂停菜单，PRD §3.11）
    enterNode,
    startBattle,
    playCard,
    endTurn,
    claimCardReward,
    claimGold,
    claimGoldOnly,
    openCardRewardChoice,
    backToBattle,
    backToReward,
    forwardToMap,
    enterEvent,
    resolveEventOption,
    buyCard,
    buyColorless,
    buyRelic,
    buyRemove,
    leaveShop,
    shopPriceOf: shopPrice, // 商店折扣价计算（UI 显示剔除价/遗物价用）
    isCardUnique: isUniqueCard, // 判断卡牌是否"永恒"（不可移除），供移除界面禁用显示
    campfireRest,
    campfireSmith,
    campfireDig,
    campfireKettlebell,
    campfireCook,
    leaveCampfire,
    offerNeow,
    claimRelicReward,
    pendingPicks,
    offerPick,
    resolvePick,
    skipPick,
    rerollCardReward, // 浮木遗物：重掷当前卡牌奖励（每奖励一次）
    applyEnchant, // 为某张牌挂载附魔（供调试控制台 `ench` 命令）
    // —— 全卡组选卡（DeckChooseOverlay） ——
    activeDeckPick, // 当前激活的全卡组选卡请求
    activeDeckPickIndices, // 当前可选的牌组实例下标（供卡组网格渲染）
    pickDeckCards, // 挂起一次全卡组选卡
    confirmDeckPick, // UI 确认选中一张（达到 count 自动结算）
    finishDeckPick, // 提前完成当前全卡组选卡（已选 ≥ min 时，UI 绿色 ✓ 调用）
    skipDeckPick, // 跳过/取消当前全卡组选卡
    shopOpenRemove, // 发起商店移除卡牌（弹 DeckChooseOverlay 选一张非永恒牌）
    addRelicPickup: onRelicGained, // 调试/控制台入口：添加遗物并触发 ON_PICKUP 拾起效果（供 `relic` 命令）
    // —— 卡牌居中预览（事件/遗物获得卡牌时展示） ——
    revealedCards, // 当前居中展示的卡牌组（null = 无展示）
    revealCards, // 居中展示一组获得卡牌，1 秒后自动消失（卡牌留在牌组）
  }
})
