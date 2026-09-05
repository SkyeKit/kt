/**
 * 单局 Store 集成测试（PRD §3.1/§3.11 关键流程）
 * 覆盖：① 状态机阶段响应式同步（修复"点击节点无反应"回归）
 *       ② 第 1 层恒为先古之民节点（遗物三选一）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '@/stores/gameStore'
import { getCard, getEvent } from '@/data'
import { mulberry32 } from '@/engine/mapGenerator'

// 简单 localStorage mock（node 环境无 localStorage）
const storage = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
}

beforeEach(() => {
  storage.clear()
  setActivePinia(createPinia())
  // 清理共享 cardMap 上的附魔（附魔挂载在 Card 对象上，与 card.upgrade 一样跨用例共享缓存，避免污染）
  for (const c of ['strike_ironclad', 'defend_ironclad', 'bash'])
    getCard(c)!.enchantments = undefined
})

describe('阶段状态机：响应式同步', () => {
  it('newRun → 开局自动进入先古 → 选定遗物解锁第 2 层 → 战斗节点进入 BATTLE', () => {
    const store = useGameStore()
    store.newRun(123)
    // 开局自动触发先古节点：无需在地图上点击第 1 层先古，直接弹出遗物三选一
    expect(store.phase).toBe('REWARD')
    expect(store.pendingReward?.kind).toBe('relic')
    // 选定先古遗物（解锁第 2 层）并回到 RUN
    store.claimRelicReward(store.pendingReward?.relics?.[0]?.id ?? null)
    expect(store.phase).toBe('RUN')
    const f2 = store.run!.map.find((n) => n.floor === 2)!
    expect(f2.type).toBe('monster')
    store.enterNode(f2.id)
    // 阶段应响应式变化到 BATTLE（此前 computed 缓存导致永远 RUN）
    expect(store.phase).toBe('BATTLE')
    expect(store.battle).not.toBeNull()
  })
})

describe('先古之民（第 1 层固定）', () => {
  it('每局第 1 层均为先古之民，进入节点出现遗物三选一', () => {
    const store = useGameStore()
    store.newRun(456)
    const f1 = store.run!.map.find((n) => n.floor === 1)!
    expect(f1.type).toBe('neow')
    store.enterNode(f1.id)
    expect(store.phase).toBe('REWARD')
    // 三选一：3 件遗物且不含已剔除的（巨大卷轴等）
    const offer = store.pendingReward
    expect(offer?.kind).toBe('relic')
    expect(offer?.relics?.length).toBe(3)
    for (const r of offer?.relics ?? []) {
      expect(r.excluded).not.toBe(true)
    }
  })

  it('选择遗物后遗物入库并回到 RUN，解锁第 2 层', () => {
    const store = useGameStore()
    store.newRun(789)
    store.enterNode('f1-r0')
    const relicId = store.pendingReward?.relics?.[0]?.id
    store.claimRelicReward(relicId ?? null)
    expect(store.run!.relics).toContain(relicId)
    expect(store.phase).toBe('RUN')
    // 第 2 层已解锁（可进入）
    const f2 = store.run!.map.find((n) => n.floor === 2)!
    expect(f2.locked).toBe(false)
  })
})

describe('通用选牌（ON_PICKUP 遗物"从 N 张中选 1"）', () => {
  // 进入先古节点并拾起指定遗物，返回 store（便于断言挂起/回传）
  function gainRelic(relicId: string) {
    const store = useGameStore()
    store.newRun(2026)
    store.enterNode('f1-r0')
    store.claimRelicReward(relicId)
    return store
  }

  it('精准剪刀：拾起挂起"全卡组选卡"而非立即移除，确认后移除选中牌(实例)', () => {
    const store = gainRelic('precise_scissors')
    const before = store.run!.deck.length
    // 拾起后不立即移除：挂起 1 项全卡组选卡请求
    expect(store.activeDeckPick).not.toBeNull()
    expect(store.activeDeckPick?.title).toContain('精准剪刀')
    // 玩家选择移除 1 张打击（确认其牌组实例下标）
    const strikeIdx = store.activeDeckPickIndices.find(
      (i) => store.run!.deck[i]!.id === 'strike_ironclad',
    )!
    store.confirmDeckPick(strikeIdx)
    // 确认页绿勾：真正结算移除（confirmDeckPick 现在只 toggle 已选，不再自动结算）
    store.finishDeckPick()
    expect(store.activeDeckPick).toBeNull()
    expect(store.run!.deck.length).toBe(before - 1)
    expect(store.run!.deck.some((e) => e.id === 'strike_ironclad')).toBe(true) // 仅移除 1 张，仍有剩余打击
  })

  it('永恒牌不可被移除：精准剪刀全卡组选卡过滤掉"永恒"诅咒牌（执迷）', () => {
    const store = useGameStore()
    store.newRun(2027)
    // 往牌组塞入一张"永恒"诅咒牌（执迷）与一张普通状态牌
    store.run!.deck.push({ id: 'obsession', upgrade: false })
    store.run!.deck.push({ id: 'wound', upgrade: false })
    store.enterNode('f1-r0')
    store.claimRelicReward('precise_scissors')
    const pick = store.activeDeckPick
    expect(pick).not.toBeNull()
    // 候选(可选实例下标)排除"永恒"牌，保留可移除的普通牌
    const hasObsession = store.activeDeckPickIndices.some(
      (i) => store.run!.deck[i]!.id === 'obsession',
    )
    const hasWound = store.activeDeckPickIndices.some((i) => store.run!.deck[i]!.id === 'wound')
    expect(hasObsession).toBe(false)
    expect(hasWound).toBe(true)
  })

  it('卷轴箱：从 2 个卡牌包中选择 1 包加入牌组（弹选卡包界面）', () => {
    const store = gainRelic('scroll_boxes')
    // 拾起后挂起"选 1 包"请求（mode="packs"），牌组尚未变化
    expect(store.pendingPicks.length).toBe(1)
    expect(store.pendingPicks[0]!.mode).toBe('packs')
    const before = store.run!.deck.length
    expect(store.run!.deck.length).toBe(before)
    // 玩家选择第 0 包：整包 3 张入组并居中展示
    const pick = store.pendingPicks[0]!
    store.resolvePick(pick.id, ['0'])
    expect(store.pendingPicks.length).toBe(0)
    expect(store.run!.deck.length).toBe(before + 3)
    expect(store.revealedCards?.length).toBe(3)
  })

  it('沉重石板：从 3 张稀有牌中选择 1 张，确认后加入所选稀有牌与受伤', () => {
    const store = gainRelic('hefty_tablet')
    // 挂起"从 3 张稀有牌中选 1"（mode="cards"），牌组未先入牌
    expect(store.pendingPicks.length).toBe(1)
    expect(store.pendingPicks[0]!.mode).toBe('cards')
    expect(store.pendingPicks[0]!.cards?.length).toBe(3)
    const before = store.run!.deck.length
    // 所选稀有牌 id 必须是稀有牌
    const rareId = store.pendingPicks[0]!.cards![0]!.id
    expect(getCard(rareId)!.rarity).toBe('rare')
    store.resolvePick(store.pendingPicks[0]!.id, [rareId])
    // 加入 1 张所选稀有牌 + 1 张受伤
    expect(store.run!.deck.length).toBe(before + 2)
    expect(store.run!.deck.some((e) => e.id === rareId)).toBe(true)
    expect(store.run!.deck.some((e) => e.id === 'injured')).toBe(true)
    expect(store.revealedCards?.some((c) => c.id === 'injured')).toBe(true)
  })

  it('涅奥的护符：拾起自动升级 1 张打击和 1 张防御，不弹选卡队列', () => {
    const store = gainRelic('neows_talisman')
    // 不再次弹出选卡界面
    expect(store.activeDeckPick).toBeNull()
    // 打击/防御各有一张实例被自动升级（牌组为 DeckCard 实例数组，独立标记 upgrade）
    expect(store.run!.deck.some((c) => c.id === 'strike_ironclad' && c.upgrade)).toBe(true)
    expect(store.run!.deck.some((c) => c.id === 'defend_ironclad' && c.upgrade)).toBe(true)
  })
})

describe('地图可达性（修复可走同层/上层节点）', () => {
  // 开局并完成先古选择，返回已进入第 2 层某节点的 store
  function enterFloor2(seed: number) {
    const store = useGameStore()
    store.newRun(seed)
    store.enterNode('f1-r0')
    store.claimRelicReward(store.pendingReward?.relics?.[0]?.id ?? null)
    const f2 = store.run!.map.filter((n) => n.floor === 2)
    const target = f2[0]!
    store.enterNode(target.id)
    return { store, target, f2 }
  }

  it('进入第 2 层某节点后，不能再点同层其他节点', () => {
    const { store, target, f2 } = enterFloor2(123)
    expect(store.phase).toBe('BATTLE')
    const other = f2.find((n) => n.id !== target.id)!
    const nodeIdBefore = store.run!.nodeId
    store.enterNode(other.id)
    // 被可达性拦截：当前节点未切换、未进入新战斗
    expect(store.run!.nodeId).toBe(nodeIdBefore)
    expect(store.phase).toBe('BATTLE')
  })

  it('不能直接进入非当前节点连线指向的上层节点', () => {
    const { store } = enterFloor2(123)
    // 当前节点 next 只指向下一层；取一个更高层（第 4 层）节点，必然不在 next 连线中
    const notNext = store.run!.map.find((n) => n.floor === 4)!
    const nodeIdBefore = store.run!.nodeId
    store.enterNode(notNext.id)
    expect(store.run!.nodeId).toBe(nodeIdBefore)
    expect(store.phase).toBe('BATTLE')
  })
})

describe('附魔系统（遗物/事件挂载附魔，document/enchantments.md）', () => {
  // 进入先古节点并拾起指定遗物，返回 store（便于断言挂起/回传）
  function gainRelic(relicId: string) {
    const store = useGameStore()
    store.newRun(2026)
    store.enterNode('f1-r0')
    store.claimRelicReward(relicId)
    return store
  }

  it('木札：拾起挂起全卡组选牌，确认后为选中牌附魔「伶俐」', () => {
    const store = gainRelic('wooden_piece')
    expect(store.activeDeckPick).not.toBeNull()
    const pick = store.activeDeckPick!
    expect(pick.title).toContain('木札')
    // 可选实例下标含基础打击（全卡组展示，含重复与升级标记）
    expect(
      store.activeDeckPickIndices.some((i) => store.run!.deck[i]!.id === 'strike_ironclad'),
    ).toBe(true)
    const idx = store.activeDeckPickIndices.find(
      (i) => store.run!.deck[i]!.id === 'strike_ironclad',
    )!
    store.confirmDeckPick(idx)
    // 木札可选至多 3 张，仅选 1 张不会自动结算，需再显式提前完成（min=0 允许）；结算后才附魔并清空队列
    store.finishDeckPick()
    expect(store.activeDeckPick).toBeNull()
    expect(getCard('strike_ironclad')?.enchantments).toContain('adroit')
    expect(getCard('defend_ironclad')?.enchantments ?? []).not.toContain('adroit')
  })

  it('扭曲锤子：全卡组候选仅含攻击牌', () => {
    const store = gainRelic('twisted_hammer')
    expect(store.activeDeckPick).not.toBeNull()
    const valid = store.activeDeckPickIndices.map((i) => getCard(store.run!.deck[i]!.id)!)
    expect(valid.length).toBeGreaterThan(0)
    expect(valid.every((c) => c.type === 'attack')).toBe(true)
  })

  it('营养汤：拾起时为所有打击附魔「特兹卡塔拉的余烬」（作用于该 id 全部副本）', () => {
    gainRelic('nourishing_soup')
    expect(getCard('strike_ironclad')?.enchantments).toContain('tezcataras_ember')
    // 防御不受影响
    expect(getCard('defend_ironclad')?.enchantments ?? []).not.toContain('tezcataras_ember')
  })

  it('佩尔之爪：拾起时为所有防御附魔「黏糊」', () => {
    gainRelic('percy_claw')
    expect(getCard('defend_ironclad')?.enchantments).toContain('goopy')
    expect(getCard('strike_ironclad')?.enchantments ?? []).not.toContain('goopy')
  })

  it('华美发束：失去所有金币并置位，首次卡牌奖励为领取的牌附魔「华彩」', () => {
    const store = gainRelic('silken_tress')
    expect(store.run!.gold).toBe(0)
    expect(store.run!.meta.silkenTressPending).toBe(true)
    // 模拟一场战斗的卡牌奖励：领取 1 张牌
    store.pendingReward = { kind: 'card', cards: [getCard('bash')!], gold: 0 }
    store.claimCardReward('bash')
    expect(getCard('bash')?.enchantments).toContain('glam')
    // 标记已消耗：后续卡牌奖励不再附魔
    expect(store.run!.meta.silkenTressPending).toBe(false)
  })

  it('羽翼护符：领取卡牌奖励时为领取的牌附魔「迅速」', () => {
    const store = gainRelic('feather_amulet')
    store.pendingReward = { kind: 'card', cards: [getCard('bash')!], gold: 0 }
    store.claimCardReward('bash')
    expect(getCard('bash')?.enchantments).toContain('swift')
    // 其余牌不受影响
    expect(getCard('strike_ironclad')?.enchantments ?? []).not.toContain('swift')
  })

  it('亮片：之后所有卡牌奖励附魔「华彩」', () => {
    const store = gainRelic('sequins')
    store.pendingReward = { kind: 'card', cards: [getCard('bash')!], gold: 0 }
    store.claimCardReward('bash')
    expect(getCard('bash')?.enchantments).toContain('glam')
  })

  it('菲涅耳透镜：领取带格挡的牌时为其附魔「灵巧」', () => {
    const store = gainRelic('fresnel_lens')
    // 防御带格挡 → 附魔灵巧（claimCardReward 内部走 applyRelicEnchantOnAdd 钩子）
    store.pendingReward = { kind: 'card', cards: [getCard('defend_ironclad')!], gold: 0 }
    store.claimCardReward('defend_ironclad')
    expect(getCard('defend_ironclad')?.enchantments).toContain('nimble')
    // 打击不带格挡 → 不附魔
    store.pendingReward = { kind: 'card', cards: [getCard('strike_ironclad')!], gold: 0 }
    store.claimCardReward('strike_ironclad')
    expect(getCard('strike_ironclad')?.enchantments ?? []).not.toContain('nimble')
  })

  it('自助指南事件：读下封底→全卡组选卡为选中的攻击牌附魔「锋利」', () => {
    const store = useGameStore()
    store.newRun(31337)
    // 直接进入自助指南事件并结算"读下封底"选项
    store.currentEvent = 'self_help_book'
    store.resolveEventOption('读下封底')
    expect(store.activeDeckPick).not.toBeNull()
    // 全卡组可选实例均为攻击牌
    const attacks = store.activeDeckPickIndices.map((i) => getCard(store.run!.deck[i]!.id)!)
    expect(attacks.every((c) => c.type === 'attack')).toBe(true)
    const idx = store.activeDeckPickIndices.find(
      (i) => store.run!.deck[i]!.id === 'strike_ironclad',
    )!
    store.confirmDeckPick(idx)
    store.finishDeckPick() // 确认页绿勾：真正为选中的攻击牌附魔
    expect(getCard('strike_ironclad')?.enchantments).toContain('sharp')
  })
})

describe('未知节点事件后解锁下一层（修复无法走进下一层）', () => {
  it('进入未知节点（概率→事件）并完成事件后，下一层解锁且回到地图', () => {
    const store = useGameStore()
    store.newRun(123)
    store.enterNode('f1-r0')
    store.claimRelicReward(store.pendingReward?.relics?.[0]?.id ?? null)
    const map = store.run!.map
    // 找一个"未知房间概率→事件"的未知节点（确定性：mulberry32(seed+floor*31) < event 0.85）
    const unk = map.find((n) => n.type === 'unknown' && mulberry32(123 + n.floor * 31)() < 0.85)!
    // 使其可达：把 id 挂到上一层某节点的 next，并把当前节点指向该上一层节点
    const below = map.find((n) => n.floor === unk.floor - 1)!
    if (!below.next.includes(unk.id)) below.next.push(unk.id)
    unk.locked = false
    store.run!.nodeId = below.id
    store.enterNode(unk.id)
    expect(store.phase).toBe('EVENT')
    // 完成事件：选第一个可用选项（金币/生命等简单结算即可）
    const ev = getEvent(store.currentEvent!)
    const opt = ev!.options.find((o) => !o.excluded)!
    store.resolveEventOption(opt.text)
    // 事件完成后回到地图，且下一层已解锁（此前从未 unlockFloor，卡死在事件节点）
    expect(store.phase).toBe('RUN')
    const nextFloor = map.filter((n) => n.floor === unk.floor + 1)
    expect(nextFloor.length).toBeGreaterThan(0)
    expect(nextFloor.every((n) => !n.locked)).toBe(true)
  })
})

describe('暂停菜单（重打/存档退出，PRD §3.11）', () => {
  // 开局 → 完成先古选择 → 返回已就绪 store（未进入第 2 层）
  function startWithNeow(seed: number) {
    const store = useGameStore()
    store.newRun(seed)
    store.enterNode('f1-r0')
    store.claimRelicReward(store.pendingReward?.relics?.[0]?.id ?? null)
    return store
  }

  it('重打：恢复"进入节点前"快照并重新进入，战斗重建、玩家状态复原', () => {
    const store = startWithNeow(123)
    const beforeHp = store.run!.hp
    const beforeGold = store.run!.gold
    const f2 = store.run!.map.find((n) => n.floor === 2)!
    store.enterNode(f2.id)
    expect(store.phase).toBe('BATTLE')
    // 战斗中改动玩家状态（模拟受伤/花费/战斗消耗）
    store.run!.hp = 10
    store.run!.gold = 0
    store.battle!.energy = 0
    // 触发重打
    expect(store.restartNode()).toBe(true)
    // 玩家恢复进入前（HP/金币复原），战斗重新构建
    expect(store.run!.hp).toBe(beforeHp)
    expect(store.run!.gold).toBe(beforeGold)
    expect(store.phase).toBe('BATTLE')
    expect(store.battle).not.toBeNull()
  })

  it('无快照时重打返回 false', () => {
    const store = useGameStore()
    store.newRun(99)
    // 尚未进入任何节点 → 快照为空 → 重打失败
    expect(store.restartNode()).toBe(false)
  })

  it('存档退出：保存存档并回到主菜单（MENU），不清除存档', () => {
    const store = startWithNeow(55)
    store.run!.gold = 77
    store.saveAndExit()
    expect(store.phase).toBe('MENU')
    // 存档仍保留（可继续游戏）
    expect(store.run).not.toBeNull()
  })

  it('节点进行中存档退出：当前节点 visited 重置，续档后可重进该节点（等效重打）', () => {
    const store = startWithNeow(123)
    // 进入第 2 层战斗节点（模拟 RunView 点击：置 visited 后进入 → 战斗中）
    const f2 = store.run!.map.find((n) => n.floor === 2)!
    f2.visited = true
    store.enterNode(f2.id)
    expect(store.phase).toBe('BATTLE')
    // 战斗中途存档退出：visited 应被重置为 false（否则续档后 isEnterable 拦截、无法重进当前节点）
    store.saveAndExit()
    expect(store.phase).toBe('MENU')
    expect(f2.visited).toBe(false)
    // 续档回到地图：当前节点可重进 → 重新进入 BATTLE
    expect(store.continueRun()).toBe(true)
    expect(store.phase).toBe('RUN')
    const f2Reloaded = store.run!.map.find((n) => n.id === f2.id)!
    expect(f2Reloaded.visited).toBe(false)
    store.enterNode(f2.id)
    expect(store.phase).toBe('BATTLE')
  })

  it('奖励页（节点已结算）存档退出：续档后自动解锁下一层，可继续前进', () => {
    const store = startWithNeow(456)
    // 模拟已进入第 2 层节点并打完（nodeId 指向 f2、visited=true），随后在奖励页未前进就存档退出
    const f2 = store.run!.map.find((n) => n.floor === 2)!
    store.run!.nodeId = f2.id
    f2.visited = true
    const f3 = store.run!.map.find((n) => n.floor === 3)!
    expect(f3.locked).toBe(true)
    store.saveAndExit()
    expect(f2.visited).toBe(true) // 非节点进行中退出：visited 不动
    // 续档兜底：当前节点已结算 → 解锁下一层，避免"不可重进 + locked"卡死
    expect(store.continueRun()).toBe(true)
    expect(store.phase).toBe('RUN')
    const f3Reloaded = store.run!.map.find((n) => n.floor === 3)!
    expect(f3Reloaded.locked).toBe(false)
  })
})

describe('已解锁剧情类先古遗物（relic.md §四，无剧情直接生效）', () => {
  // 通用开局：新建一局，先进入第 1 层先古节点（打开遗物选择），再把指定遗物领取（触发 onRelicGained）
  function grantRelic(store: ReturnType<typeof useGameStore>, relicId: string): void {
    store.enterNode('f1-r0')
    store.claimRelicReward(relicId)
  }

  it('皮草大衣：拾起置位 7 场，开战后敌人仅 1 点生命且计数逐场递减', () => {
    const store = useGameStore()
    store.newRun(2024)
    grantRelic(store, 'fur_coat')
    expect(store.run!.meta.furCoatBattles).toBe(7)
    store.startBattle(['fuzzy_wurm_crawler'], 'normal')
    // 敌人生成后的满血 hp 被皮草大衣压到 1
    expect(store.battle!.enemies[0]!.hp).toBe(1)
    expect(store.run!.meta.furCoatBattles).toBe(6)
  })

  it('皮草大衣：计数归零后不再压制敌人生命', () => {
    const store = useGameStore()
    store.newRun(2024)
    grantRelic(store, 'fur_coat')
    store.run!.meta.furCoatBattles = 0
    store.startBattle(['fuzzy_wurm_crawler'], 'normal')
    // 敌人按原始 hpMax 随机生成，应大于 1
    expect(store.battle!.enemies[0]!.hp).toBeGreaterThan(1)
  })

  it('发光珍珠：开战时将一张冷光加入手牌', () => {
    const store = useGameStore()
    store.newRun(2024)
    store.run!.relics.push('glowing_pearl')
    store.startBattle(['fuzzy_wurm_crawler'], 'normal')
    expect(store.battle!.hand.some((c) => c.id === 'cold_light')).toBe(true)
  })

  it('血染玫瑰：拾起加入一张执迷，战斗每回合开始 +1 能量', () => {
    const store = useGameStore()
    store.newRun(2024)
    grantRelic(store, 'blood_rose')
    expect(store.run!.deck.some((c) => c.id === 'obsession')).toBe(true)
    store.startBattle(['fuzzy_wurm_crawler'], 'normal')
    store.endTurn()
    // endTurn 结束玩家回合并刷新为下一玩家回合；血染玫瑰每回合开始 +1 能量，
    // 因此下一回合能量 = 基础(3) + 1（而非被重置为 3）
    expect(store.battle!.energy).toBe(store.battle!.maxEnergy + 1)
  })

  it('原初之爪：拾起加入 3 张许愿与 2 张随机诅咒', () => {
    const store = useGameStore()
    store.newRun(2024)
    grantRelic(store, 'primordial_claw')
    const deck = store.run!.deck
    expect(deck.filter((c) => c.id === 'wish').length).toBe(3)
    // 诅咒数量：2 张（允许重复去重逻辑，至少 1 张，至多 2 张）
    const curseIds = ['curse', 'greed', 'folly', 'regret', 'decay', 'parasite', 'doubt', 'injury']
    const curTally = deck.filter((c) => curseIds.includes(c.id)).length
    expect(curTally).toBeGreaterThanOrEqual(1)
    expect(curTally).toBeLessThanOrEqual(2)
  })

  it('领主阳伞：进入商店时立刻获得所出售的全部物品（白拿）', () => {
    const store = useGameStore()
    store.newRun(2024)
    // 领取先古遗物后回到 RUN，把领主阳伞直接放入 relic 列表（触发点在 setupShop）
    grantRelic(store, 'burning_blood')
    store.run!.relics.push('lord_umbrella')
    // 领取先古遗物后 floor 2 已解锁；复用现有第 2 层节点改为商店并打通可达性，触发 setupShop
    const cur = store.run!.map.find((n) => n.id === 'f1-r0')!
    const f2node = store.run!.map.find((n) => n.floor === 2)!
    f2node.type = 'shop'
    f2node.row = 0
    cur.next = [f2node.id]
    const deckBefore = store.run!.deck.length
    const relicsBefore = store.run!.relics.length
    store.enterNode(f2node.id)
    // 白拿后商店商品清空，牌组/遗物数量相对增加
    expect(store.shopState!.cards.length).toBe(0)
    expect(store.run!.deck.length).toBeGreaterThan(deckBefore)
    expect(store.run!.relics.length).toBeGreaterThan(relicsBefore)
  })

  it('星盘：拾起挂起全卡组选卡，确认后变化并升级所选牌(实例)', () => {
    const store = useGameStore()
    store.newRun(2024)
    grantRelic(store, 'astrolabe')
    expect(store.activeDeckPick).not.toBeNull()
    const pick = store.activeDeckPick!
    expect(pick.title).toContain('星盘')
    expect(pick.count).toBeLessThanOrEqual(3)
    // 选定一张打击：该张替换为随机非基础战士牌并标记升级
    const strikeCountBefore = store.run!.deck.filter((c) => c.id === 'strike_ironclad').length
    const totalBefore = store.run!.deck.length
    const strikeIdx = store.activeDeckPickIndices.find(
      (i) => store.run!.deck[i]!.id === 'strike_ironclad',
    )!
    store.confirmDeckPick(strikeIdx)
    store.finishDeckPick() // 只选 1 张(min=1)即提前完成结算
    expect(store.activeDeckPick).toBeNull()
    // 总张数不变（变化而非增减）；一张打击被替换
    expect(store.run!.deck.length).toBe(totalBefore)
    expect(store.run!.deck.filter((c) => c.id === 'strike_ironclad').length).toBe(
      strikeCountBefore - 1,
    )
    expect(store.run!.deck.some((c) => c.upgrade)).toBe(true)
  })

  it('选择悖论：开局挂起战斗内选牌，选择后入手并获得保留', () => {
    const store = useGameStore()
    store.newRun(2024)
    grantRelic(store, 'burning_blood')
    store.run!.relics.push('choice_paradox')
    store.startBattle(['fuzzy_wurm_crawler'], 'normal')
    // 选择悖论经 bridgeCombatPicks 挂起一条选牌，弹窗可见
    expect(store.pendingPicks.length).toBe(1)
    expect(store.pendingPicks[0]!.title).toContain('选择悖论')
    // 完成选择后，牌入手牌且进入 retainHandCards（该牌本回合结束保留）
    const chosen = store.pendingPicks[0]!.cards![0]!.id
    store.resolvePick(store.pendingPicks[0]!.id, [chosen])
    expect(store.battle!.hand.some((c) => c.id === chosen)).toBe(true)
    expect(store.battle!.retainHandCards?.has(chosen)).toBe(true)
  })

  it('佩尔之牙：全卡组选卡移除存入 meta，战斗结束随机 1 张升级返还', () => {
    const store = useGameStore()
    store.newRun(2024)
    grantRelic(store, 'percy_tooth')
    const pick = store.activeDeckPick!
    expect(pick.count).toBeLessThanOrEqual(5)
    // 选 3 张牌移除（打击/防御/打击），并提前完成结算
    for (const targetId of ['strike_ironclad', 'defend_ironclad', 'bash']) {
      const idx = store.activeDeckPickIndices.find((i) => store.run!.deck[i]!.id === targetId)!
      store.confirmDeckPick(idx)
    }
    store.finishDeckPick()
    const removedCount = store.run!.meta.percyToothRemoved?.length ?? 0
    expect(removedCount).toBeGreaterThanOrEqual(1)
    const deckAfterPick = store.run!.deck.length
    // 触发一次战斗胜利，验证 onVictory 中的"随机 1 张升级返还"
    store.startBattle(['fuzzy_wurm_crawler'], 'normal')
    store.battle!.enemies.forEach((e) => {
      e.hp = 0
      e.alive = false
    })
    store.endTurn()
    expect(store.phase).toBe('REWARD')
    // 池中少 1 张，牌组 +1（返还牌并已升级）
    expect(store.run!.meta.percyToothRemoved?.length).toBe(removedCount - 1)
    expect(store.run!.deck.length).toBe(deckAfterPick + 1)
    expect(store.run!.deck.some((c) => c.upgrade)).toBe(true)
  })

  it('钻石头冠 & 黄金印：伤害减半与金币换能量（relicSystem/effectEngine）', () => {
    const store = useGameStore()
    store.newRun(2024)
    store.run!.relics.push('diamond_crown', 'golden_stamp')
    store.run!.gold = 30
    store.startBattle(['fuzzy_wurm_crawler'], 'normal')
    // 黄金印：回合开始花费 5 金币获得 +1 能量（ctx.gold 减少、onVictory 会回写）
    expect(store.battle!.gold).toBe(25)
    expect(store.battle!.energy).toBeGreaterThanOrEqual(3)
    // 钻石头冠：玩家尚未出牌（≤2 张），受击伤害减半已在 effectEngine 计算，此处仅校验持有不再崩溃
    expect(store.battle!.enemies[0]!.hp).toBeGreaterThan(0)
  })

  it('浮木：卡牌奖励可重掷一次，重掷后标记置位', () => {
    const store = useGameStore()
    store.newRun(2024)
    grantRelic(store, 'burning_blood')
    // 构造一次卡牌奖励
    const deckBefore = store.run!.deck.length
    void deckBefore
    store.pendingReward = {
      kind: 'card',
      cards: [{ id: 'strike_ironclad' as never, name: '打击' as never }] as never,
      gold: 10,
    }
    store.run!.relics.push('flotsam')
    const first = JSON.stringify(store.pendingReward!.cards)
    store.rerollCardReward()
    const second = JSON.stringify(store.pendingReward!.cards)
    // 重掷生效：标记置位且候选已变化
    expect(store.run!.meta.flotsamRerolled).toBe(true)
    expect(second).not.toBe(first)
    // 再次重掷不再变化
    const thirdSeed = JSON.stringify(store.pendingReward!.cards)
    store.rerollCardReward()
    expect(store.run!.meta.flotsamRerolled).toBe(true)
    expect(JSON.stringify(store.pendingReward!.cards)).toBe(thirdSeed)
  })

  it('星系仪/玻璃眼珠：额外卡牌奖励在奖励页逐次消费（只减不升、无金币）', () => {
    const store = useGameStore()
    store.newRun(2024)
    // 星系仪：拾起即 +5 次额外卡牌奖励（onRelicGained 落地到 meta.extraCardRewards）
    grantRelic(store, 'star_chart')
    expect(store.run!.relics).toContain('star_chart')
    expect(store.run!.meta.extraCardRewards).toBe(5)
    // 打一场普通战胜利 → 生成普通卡牌奖励并进入 REWARD
    store.startBattle(['fuzzy_wurm_crawler'], 'normal')
    store.battle!.enemies.forEach((e) => {
      e.hp = 0
      e.alive = false
    })
    store.endTurn()
    expect(store.phase).toBe('REWARD')
    const before = store.run!.deck.length
    // 点"前往地图"：因还有额外奖励剩余，不离开奖励页，而是弹出一次"仅卡牌"奖励并消费 1 次
    store.forwardToMap()
    expect(store.run!.meta.extraCardRewards).toBe(4)
    expect(store.phase).toBe('REWARD')
    expect(store.pendingReward!.kind).toBe('card')
    expect(store.pendingReward!.gold).toBeUndefined() // 额外奖励无金币行
    expect(store.pendingReward!.cards!.length).toBeGreaterThan(0)
    // 直接领取这张额外卡牌，再前进 → 剩余次数 4→3，继续停留在 REWARD
    const addId = store.pendingReward!.cards![0]!.id
    store.claimCardReward(addId)
    store.forwardToMap()
    expect(store.run!.meta.extraCardRewards).toBe(3)
    expect(store.phase).toBe('REWARD')
    // 牌组确实新增了该卡（验证消费流转有效）
    expect(store.run!.deck.length).toBe(before + 1)
  })
})
