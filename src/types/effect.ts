/**
 * 效果链类型（agent.md §5.2 / PRD §3.3）
 * 卡牌/怪物招式/事件选项的效果统一用"效果链数组"表达，由 effectEngine.ts 解析执行。
 * 新增效果类型时：effectEngine 实现执行逻辑 + tests/effectEngine.spec.ts 补测试，禁止在组件里临时实现。
 */

// 效果目标：单体敌人 / 全体敌人 / 自己 / 随机敌人
export type EffectTarget = 'enemy' | 'allEnemies' | 'self' | 'randomEnemy'

// 攻击伤害的倍率修正来源（PRD §3.3.3 结算顺序：基础+力量 → 易伤 → 虚弱 → 其他倍率）
export type DamageModifier = 'vulnerable' | 'weak' | 'shrink' | 'brutality'

// 效果链：判别联合（discriminated union），按 type 区分
export type Effect =
  | { type: 'damage'; target: EffectTarget; amount: number; hits?: number; hitsFromX?: boolean }
  | { type: 'block'; amount: number }
  | { type: 'draw'; count: number }
  | {
      type: 'applyStatus'
      target: 'enemy' | 'allEnemies' | 'self'
      status: string
      amount: number
    }
  | { type: 'gainEnergy'; amount: number }
  | { type: 'loseEnergy'; amount: number }
  | { type: 'heal'; amount: number }
  | { type: 'loseHp'; amount: number }
  | { type: 'exhaust' }
  | { type: 'addCard'; cardId: string; to: 'hand' | 'draw' | 'discard' | 'exhaust' }
  | { type: 'upgrade'; count: number }
  | { type: 'transform'; count: number }
  | { type: 'removeCard'; count: number }
  | { type: 'gainGold'; amount: number }
  | { type: 'loseGold'; amount: number }
  | { type: 'gainMaxHp'; amount: number }
  | { type: 'loseMaxHp'; amount: number }
  // 多段随机/条件类复杂效果：scaling 描述数值来源，由 effectEngine 在运行时求值
  | {
      type: 'damageScaling'
      target: EffectTarget
      base: number
      scaling:
        'block' | 'cardsPlayed' | 'exhaustPile' | 'deckSize' | 'statusOnTarget' | 'strikeCount'
      hits?: number
    }
  // 将目标身上某状态的层数翻倍（熔融之拳：将敌人身上易伤层数翻倍）
  | { type: 'doubleStatus'; target: 'enemy' | 'self'; status: string }
  // 依据目标身上的易伤层数，按层数获得力量（主宰：敌人每有一层易伤，就获得 1 点力量）
  | { type: 'strengthFromTargetVulnerable'; target: 'enemy' }
  // 每张手牌攻击牌获得 amount 能量，并禁止本回合后续额外能量（跃跃欲试）
  | { type: 'gainEnergyPerHandAttack'; amount: number; blockFurther: boolean }
  // 本回合不再抽牌（战斗专注）：设置禁抽标记
  | { type: 'noDraw' }
  // 抽牌直到抽到一张非攻击牌（劫掠）
  | { type: 'drawUntilNonAttack' }
  // 本回合消耗过卡牌时才生效的增益（被遗忘的仪式=能量 / 邪眼=格挡）
  | { type: 'gainIfExhausted'; gain: 'energy' | 'block'; amount: number }
  // 消耗手牌中所有非攻击牌，每张获得 amount 格挡（重振精神）
  | { type: 'blockPerNonAttackExhausted'; amount: number }
  // 内在/触发类效果：状态牌或某些卡在特定时机自动结算，而非打出时生效
  | {
      type: 'intrinsic'
      // 触发时机：endOfTurn = 回合结束时且在手牌中；onDraw = 抽到这张牌时
      trigger: 'endOfTurn' | 'onDraw'
      // 触发的效果链（如"你受到X点伤害"→ loseHp、"获得1层虚弱"→ applyStatus self、失去金币→ loseGold）
      effects: EffectChain
    }
  // 失去等同于手牌数量的生命（诅咒·悔恨）
  | { type: 'loseHpHandSize' }
  // 本回合保留手牌（均衡/箭雨等：回合结束时手牌不弃入弃牌堆，仅当回合生效）
  | { type: 'retainHandThisTurn' }
  // 赋予"重放"层数（未掘宝石）：给抽牌堆中一张无重放的随机牌加重放，打出时自动再结算 N 次
  | { type: 'grantReplay'; count: number }
  // 选择一张牌加入手牌（无色卡"发现/秘密技法/许愿"等交互类效果）
  // 由 effectEngine 构造候选列表挂到 ctx.pendingPicks，UI 选完后通过 store 回填到手牌
  | {
      type: 'chooseAdd'
      // 候选来源：
      //   seek=抽牌堆随机 N 张 | random=全局随机 N 张 | attack=本职业随机 N 张攻击
      //   skillInDraw/attackInDraw/anyInDraw=抽牌堆中的指定类型/任意牌
      filter: 'seek' | 'random' | 'attack' | 'skillInDraw' | 'attackInDraw' | 'anyInDraw'
      count?: number
      free?: boolean // 选出的牌本回合可免费打出（发现/飞溅）
    }
  // 本回合接下来"攻击额外生效"次数（连环拳：打出后下一张/两张攻击牌效果结算一次）
  | { type: 'nextAttacksExtra'; count: number }
  // 升级手牌中的卡牌（武装：本卡升级后升级手牌中所有牌，未升级则随机升级 count 张）
  | { type: 'upgradeHand'; count: number; all?: boolean }
  // 将弃牌堆中的随机 count 张牌放到抽牌堆顶部（头槌：优先保留可用，MVP 按随机处理）
  | { type: 'moveDiscardToTop'; count?: number }
  // 你打出的下一张/后 count 张攻击牌耗能变为 0（无情猛攻）；由 combatEngine.playCard 在出牌时消费
  | { type: 'nextAttackFree'; count: number }
  // 打出抽牌堆顶部 N 张牌（倾泻：N = 本卡投入的 X 能量 + plus）
  | { type: 'playTopXCards'; plus?: number }
  // 从抽牌堆中随机打出 count 张牌（无色·横祸：洗乱后打顶部 count 张，等效随机）
  | { type: 'playRandomFromDraw'; count: number }
  // 打出弃牌堆中的 count 张随机攻击牌（无色·狠揍；复活牌通常带消耗）
  | { type: 'playRandomAttacksFromDiscard'; count: number }
  // 将手牌中的所有攻击牌变化成一张随机战士攻击牌（原始力量：巨石数据缺失，按项目降级约定随机攻击牌）
  | { type: 'transformHandAttacks' }
  // 召唤衍生物登入战斗（雾菇 虚幻孢子 召唤 1 只利齿之眼等）；count 缺省为 1
  | { type: 'spawnEnemy'; enemyId: string; count?: number }

// 效果链 = 一组顺序执行的效果
export type EffectChain = Effect[]
