/**
 * 设置 Store（PRD §6 非功能性）：音量/动画/画质等偏好，localStorage 持久化
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const SETTINGS_KEY = 'sts2_settings_v1'

interface SettingsState {
  sound: boolean // 音效开关
  animations: boolean // 动画开关（可访问性，PRD §6.3）
  showDebugConsole: boolean // 调试控制台显隐
}

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw)
      return {
        sound: true,
        animations: true,
        showDebugConsole: false,
        ...(JSON.parse(raw) as Partial<SettingsState>),
      }
  } catch {
    // 忽略损坏数据
  }
  return { sound: true, animations: true, showDebugConsole: false }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<SettingsState>(loadSettings())

  // 设置变化自动持久化
  watch(settings, (s) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
    } catch {
      // 静默忽略
    }
  })

  return { settings }
})
