/**
 * 存档组合函数（PRD §3.12）：封装存档读写，供主菜单/暂停菜单使用
 */
import { useGameStore } from '@/stores/gameStore'

export function useSave() {
  const store = useGameStore()

  // 是否可继续（存在有效存档）
  function hasSave(): boolean {
    const raw = localStorage.getItem('sts2_run_v1')
    return Boolean(raw)
  }

  // 继续存档；无存档时返回 false
  function load(): boolean {
    return store.continueRun()
  }

  // 存档（返回是否成功）
  function save(): boolean {
    return store.run ? true : false
  }

  // 清除存档
  function clear(): void {
    store.abandonRun()
  }

  return { hasSave, load, save, clear }
}
