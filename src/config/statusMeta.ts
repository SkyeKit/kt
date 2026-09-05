/**
 * 状态元数据（PRD §3.3.6）：为每个 StatusId 提供"中文名 + 类别 + 说明"。
 * 供战斗界面在单位下方渲染状态徽章（点击徽章可查看说明），也供 effectEngine 复用。
 * 类别决定 UI 配色：buff=金、debuff=红、neutral=灰。
 */
import type { StatusId } from '@/types'

// 状态类别：buff=正面增益 / debuff=负面减益 / neutral=中性或机制类
export type StatusKind = 'buff' | 'debuff' | 'neutral'

export interface StatusMeta {
  name: string // 中文名（UI/日志展示）
  type: StatusKind // 类别（决定配色）
  desc: string // 效果说明（点击徽章时浮层展示；与 PRD/技能实现一致）
}

// 状态 ID → 元数据表（覆盖 types/status.ts 全部 StatusId）
export const STATUS_META: Record<StatusId, StatusMeta> = {
  // ① 数值状态（多为正面）
  strength: { name: '力量', type: 'buff', desc: '每段攻击伤害 +层数' },
  dexterity: { name: '敏捷', type: 'buff', desc: '每次获得格挡额外 +层数' },
  block: { name: '格挡', type: 'buff', desc: '抵挡等量伤害，回合结束时清除' },
  armor: { name: '覆甲', type: 'buff', desc: '回合开始时层数 -1，回合结束时获得等同层数的格挡' },
  thorns: { name: '荆棘', type: 'buff', desc: '每次受到攻击时对攻击方反弹层数伤害' },
  vigor: { name: '活力', type: 'buff', desc: '下一次进行的攻击伤害 +层数' },
  intangible: { name: '无实体', type: 'buff', desc: '本回合受到的伤害降到 1（无视格挡）' },
  // ② 负面状态（玩家）
  vulnerable: { name: '易伤', type: 'debuff', desc: '受到的攻击伤害 ×1.5（回合结束减少）' },
  weak: { name: '虚弱', type: 'debuff', desc: '造成的攻击伤害 ×0.75（回合结束减少）' },
  frail: { name: '脆弱', type: 'debuff', desc: '获得的格挡 -25%（回合结束减少）' },
  confused: { name: '混乱', type: 'debuff', desc: '打出卡牌时随机变化其效果' },
  constricted: { name: '紧缠', type: 'debuff', desc: '回合结束时受到等同层数的伤害（格挡可挡）' },
  tangled: { name: '缠结', type: 'debuff', desc: '被缠绕后在几回合内难以行动' },
  shrink: { name: '缩小', type: 'debuff', desc: '攻击伤害随阶数递减' },
  ringing: { name: '昏眩', type: 'debuff', desc: '攻击命中时有一定概率眩晕目标' },
  stunned: { name: '击晕', type: 'debuff', desc: '跳过本回合行动' },
  // ③ 怪物机制状态
  slippery: { name: '滑溜', type: 'debuff', desc: '每次受击减免层数伤害并削弱该状态' },
  illusion: { name: '幻象', type: 'neutral', desc: '受到的攻击有一定概率偏斜不掉血' },
  territorial: { name: '领地', type: 'buff', desc: '位于领地时攻击伤害提升' },
  slow: { name: '缓慢', type: 'neutral', desc: '每回合行动次数随层数增加' },
  parasitic: { name: '寄生物', type: 'neutral', desc: '每次受击向牌组植入寄生卡' },
  artifact: { name: '人工制品', type: 'buff', desc: '抵消下一次受到的负面状态（不掉层数）' },
  rampage: { name: '横冲直撞', type: 'neutral', desc: '每次攻击使下次攻击的伤害提升' },
  metallicize: { name: '金属化', type: 'buff', desc: '回合结束时获得等同层数的格挡' },
  ritual: { name: '仪式', type: 'buff', desc: '回合开始时获得等同层数的力量' },
  noDraw: { name: '无法抽牌', type: 'debuff', desc: '本回合跳过抽牌阶段' },
  energized: { name: '能量化', type: 'buff', desc: '本回合获得能量 +层数' },
  // ④ 暗港（Underdocks）专属机制（名字/说明对照 Underdocks.md §4）
  smoggy: { name: '烟雾弥漫', type: 'debuff', desc: '本回合只能打出 1 张技能牌' },
  plating: { name: '覆甲', type: 'buff', desc: '回合开始层数 -1，回合结束获等量格挡' },
  hard_shell: { name: '硬化外壳', type: 'neutral', desc: '每回合受到的伤害不超过层数' },
  suck: { name: '吮吸', type: 'neutral', desc: '造成未被格挡的伤害时获得层数力量' },
  shriek: { name: '尖叫', type: 'neutral', desc: '生命低于层数时眩晕一回合' },
  steam: { name: '蒸汽', type: 'neutral', desc: '生命归零时不死，下回合自爆' },
  timid: { name: '胆小', type: 'neutral', desc: '每回合开始时获得等同层数的格挡' },
}

// 从战斗单位提取"可显示的状态徽章列表"：统一格挡(字段)+statuses(含覆甲/力量/敏捷/各类状态)，过滤 amount<=0
export interface StatusChip {
  key: string // 状态 key（statuses 用 id，格挡用 'block'）
  name: string // 中文名
  amount: number // 层数/数值
  type: StatusKind // 类别（配色）
  desc: string // 效果说明（点击徽章浮层展示）
}

// 注意：仅 type-only 引入 CombatUnit，避免运行时循环依赖
export function unitStatusChips(unit: {
  block: number
  statuses: Array<{ id: StatusId; amount: number; turns: number }>
}): StatusChip[] {
  const chips: StatusChip[] = []
  // 格挡是字段（不在 statuses 内），单独合成条目
  if (unit.block > 0)
    chips.push({
      key: 'block',
      name: '格挡',
      amount: unit.block,
      type: 'buff',
      desc: '抵挡等量伤害，回合结束时清除',
    })
  for (const s of unit.statuses) {
    if (s.amount <= 0) continue
    const meta = STATUS_META[s.id]
    chips.push({
      key: s.id,
      name: meta?.name ?? s.id,
      amount: s.amount,
      type: meta?.type ?? 'neutral',
      desc: meta?.desc ?? '',
    })
  }
  return chips
}
