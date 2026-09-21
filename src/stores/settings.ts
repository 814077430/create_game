import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

const STORAGE_KEY_PREFIX = 'gameforge_settings_'
const STORAGE_KEY_LEGACY = 'gameforge_settings'

// 模型配置版本号：升级默认模型时递增，旧缓存会被强制重置为新默认值
const MODEL_CONFIG_VERSION = 4

export interface AppSettings {
  // 百炼通义 API Key（统一，按用户隔离存储）
  apiKey: string

  // LLM 模型（Stage 1-2: 创意推理 + 模块拆分）
  llmModel: string

  // 代码模型（Stage 4: 代码生成）
  codeModel: string

  // 图像模型（Stage 3: 美术资源生成）
  imageModel: string

  // 视频模型（Stage 3: 序列帧动画 - 图生视频）
  videoModel: string
}

// 百炼统一 BaseURL
export const BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

const defaultSettings: AppSettings = {
  apiKey: '',
  llmModel: 'qwen3.8-max',
  codeModel: 'qwen3.8-max',
  imageModel: 'qwen-image-3.0',
  videoModel: 'wan3.0-video-prime',
}

/** 获取当前用户的 settings 存储 key（按用户名隔离） */
function getUserStorageKey(): string {
  const auth = useAuthStore()
  const username = auth.username
  if (username) return STORAGE_KEY_PREFIX + username
  return STORAGE_KEY_LEGACY // 未登录时使用旧 key（兜底）
}

function loadSettings(): AppSettings {
  try {
    const storageKey = getUserStorageKey()
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw)
      // 版本号不匹配：默认模型已升级，丢弃旧缓存的模型配置
      if (parsed.__v !== MODEL_CONFIG_VERSION) return { ...defaultSettings }
      // 不从缓存恢复 apiKey，每次会话需重新输入
      const { apiKey, llmApiKey, __v, ...modelConfig } = parsed
      return { ...defaultSettings, ...modelConfig, apiKey: '' }
    }
    // 如果用户专属 key 不存在，尝试从旧的全局 key 迁移模型配置（不迁移 apiKey）
    const legacyRaw = localStorage.getItem(STORAGE_KEY_LEGACY)
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw)
      if (parsed.__v !== MODEL_CONFIG_VERSION) return { ...defaultSettings }
      const { apiKey, __v, ...modelConfig } = parsed
      return { ...defaultSettings, ...modelConfig, apiKey: '' }
    }
  } catch {}
  return { ...defaultSettings }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(loadSettings())
  const visible = ref(false)

  watch(
    settings,
    (val) => {
      // 按用户隔离保存模型配置，不缓存 apiKey
      const storageKey = getUserStorageKey()
      const { apiKey, ...rest } = val
      localStorage.setItem(storageKey, JSON.stringify({ ...rest, __v: MODEL_CONFIG_VERSION }))
    },
    { deep: true }
  )

  /** 切换用户后重新加载对应用户的设置（登录成功后调用） */
  function reloadForCurrentUser() {
    settings.value = loadSettings()
  }

  function show() { visible.value = true }
  function hide() { visible.value = false }
  function reset() { settings.value = { ...defaultSettings } }

  function isConfigured() {
    return !!settings.value.apiKey
  }

  // 兼容性方法（pipeline 中使用）
  function isLLMConfigured() { return isConfigured() }
  function isImageConfigured() { return isConfigured() }
  function isCodeConfigured() { return isConfigured() }

  // 获取完整配置（供 API 调用）
  function getLLMConfig() {
    return { baseUrl: BAILIAN_BASE_URL, apiKey: settings.value.apiKey, model: settings.value.llmModel }
  }
  function getCodeConfig() {
    return { baseUrl: BAILIAN_BASE_URL, apiKey: settings.value.apiKey, model: settings.value.codeModel }
  }
  function getImageConfig() {
    return { baseUrl: BAILIAN_BASE_URL, apiKey: settings.value.apiKey, model: settings.value.imageModel }
  }
  function getVideoConfig() {
    return { baseUrl: BAILIAN_BASE_URL, apiKey: settings.value.apiKey, model: settings.value.videoModel }
  }
  function isVideoConfigured() { return isConfigured() && !!settings.value.videoModel }

  return {
    settings, visible, show, hide, reset, reloadForCurrentUser,
    isConfigured, isLLMConfigured, isImageConfigured, isCodeConfigured, isVideoConfigured,
    getLLMConfig, getCodeConfig, getImageConfig, getVideoConfig,
  }
})
