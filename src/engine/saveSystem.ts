/**
 * 存档系统（agent.md §5.4 / PRD §3.12）
 * 单局存档经 localStorage 持久化：键名 sts2_run_v1（含版本号），损坏自动回退。
 * 版本号不匹配/解析失败时丢弃存档，返回 null（安全降级）。
 */
import type { RunState } from '@/types'
import { SAVE } from '@/config/gameConfig'

// 序列化并写入 localStorage；写入失败（隐私模式等）时静默忽略
export function saveRun(state: RunState): boolean {
  try {
    const payload = { version: SAVE.version, savedAt: Date.now(), state }
    localStorage.setItem(SAVE.storageKey, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

// 读取存档：校验版本号 + 结构完整性，损坏返回 null（回退到新开局）
export function loadRun(): RunState | null {
  try {
    const raw = localStorage.getItem(SAVE.storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: number; state?: RunState }
    if (parsed.version !== SAVE.version || !parsed.state) return null
    if (!isValidRun(parsed.state)) return null
    // 幕字段缺省兼容：旧档无 act 时默认为密林丘（overgrowth），避免按幕查询越界
    if (parsed.state.act !== 'overgrowth' && parsed.state.act !== 'underdocks')
      parsed.state.act = 'overgrowth'
    return parsed.state
  } catch {
    return null
  }
}

// 清除当前存档
export function clearRun(): void {
  localStorage.removeItem(SAVE.storageKey)
}

// 结构完整性校验：关键字段存在且类型正确（防止半损坏存档进入游戏）
function isValidRun(run: RunState): boolean {
  return (
    typeof run.floor === 'number' &&
    Array.isArray(run.map) &&
    Array.isArray(run.deck) &&
    typeof run.hp === 'number' &&
    typeof run.gold === 'number'
  )
}
