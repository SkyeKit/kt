/**
 * 元进度 Store（PRD §3.9）：跨局持久化数据（胜利次数/击杀统计/解锁）
 * localStorage 键 sts2_meta_v1，与单局存档分离。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

const META_KEY = 'sts2_meta_v1'

interface MetaState {
  runs: number // 总游戏局数
  victories: number // 胜利局数
  kills: number // 累计击杀
  elitesKilled: number // 累计精英/Boss 击杀
  bestFloor: number // 最高到达楼层
}

// 读取元进度（损坏回退默认值）
function loadMeta(): MetaState {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (raw) return JSON.parse(raw) as MetaState
  } catch {
    // 忽略损坏数据
  }
  return { runs: 0, victories: 0, kills: 0, elitesKilled: 0, bestFloor: 0 }
}

export const useMetaStore = defineStore('meta', () => {
  const meta = ref<MetaState>(loadMeta())

  // 记录一局结束（胜利/失败），结算界面调用
  function recordRun(victory: boolean, floor: number, kills: number, elitesKilled: number): void {
    meta.value.runs++
    if (victory) meta.value.victories++
    meta.value.kills += kills
    meta.value.elitesKilled += elitesKilled
    meta.value.bestFloor = Math.max(meta.value.bestFloor, floor)
    persist()
  }

  function persist(): void {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta.value))
    } catch {
      // 隐私模式下静默忽略
    }
  }

  return { meta, recordRun }
})
