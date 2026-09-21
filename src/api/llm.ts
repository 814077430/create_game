import { useSettingsStore } from '@/stores/settings'
import { maybeProxyUrl, explainFetchError } from './proxy'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMOptions {
  temperature?: number
  responseFormat?: 'text' | 'json_object'
  signal?: AbortSignal
  onChunk?: (text: string) => void
  /**
   * 空闲超时（毫秒）：在该时间内若没有收到任何新数据（流式分片或最终响应），
   * 则主动中断请求并抛出超时错误，避免界面长时间卡在“正在生成…”。默认 90s。
   */
  idleTimeoutMs?: number
}

// ─── 内部：通用 OpenAI 兼容调用 ────────────────────────────────────────────────

async function _callCompletion(
  messages: ChatMessage[],
  baseUrl: string,
  apiKey: string,
  model: string,
  options: LLMOptions,
  tag: string
): Promise<string> {
  const useStream = !!options.onChunk
  const url = maybeProxyUrl(`${baseUrl.replace(/\/$/, '')}/chat/completions`)

  const body: any = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    stream: useStream,
  }
  if (options.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' }
  }

  // ── 空闲超时看门狗 ──────────────────────────────────────────────
  // 流式响应若中途断流（服务端未发 [DONE] 就静默断开）或网络卡死，
  // reader.read() 会永远 pending，导致界面卡在“正在生成…”。
  // 这里用一个可重置的看门狗：每收到一片新数据就重置计时，
  // 超过 idleTimeoutMs 没有任何进展则主动 abort 并抛超时错误。
  const idleTimeoutMs = options.idleTimeoutMs ?? 90000
  const controller = new AbortController()
  let timedOut = false
  let externallyAborted = false
  if (options.signal) {
    if (options.signal.aborted) {
      externallyAborted = true
      controller.abort()
    } else {
      options.signal.addEventListener(
        'abort',
        () => {
          externallyAborted = true
          controller.abort()
        },
        { once: true }
      )
    }
  }
  let watchdog: ReturnType<typeof setTimeout> | null = null
  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, idleTimeoutMs)
  }
  const disarmWatchdog = () => {
    if (watchdog) {
      clearTimeout(watchdog)
      watchdog = null
    }
  }

  const timeoutError = () =>
    new Error(`${tag} 超时：${Math.round(idleTimeoutMs / 1000)}s 内无响应。请重试，或检查网络与 API 配置。`)

  try {
    armWatchdog()
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch((err) => {
      if (timedOut) throw timeoutError()
      if (externallyAborted) throw new Error(`${tag} 已取消`)
      throw explainFetchError(err, tag)
    })

    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`${tag} 失败 (${resp.status}): ${errText.slice(0, 300)}`)
    }

    if (!useStream) {
      const data = await resp.json()
      disarmWatchdog()
      return data.choices?.[0]?.message?.content ?? ''
    }

    // SSE streaming
    const reader = resp.body!.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let full = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      armWatchdog() // 收到新数据，重置看门狗
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            full += delta
            options.onChunk?.(delta)
          }
        } catch {
          // ignore malformed lines
        }
      }
    }
    disarmWatchdog()
    return full
  } catch (err: any) {
    disarmWatchdog()
    if (timedOut) throw timeoutError()
    if (externallyAborted || err?.name === 'AbortError') throw new Error(`${tag} 已取消`)
    throw err
  } finally {
    disarmWatchdog()
  }
}

// ─── Stage 1：玩法推理 LLM（读取 llm* 配置） ──────────────────────────────────

/**
 * Stage 1 专用：调用 OpenAI 兼容接口（读取 settings.llm* 配置）。
 * 支持 SSE 流式输出（onChunk）。
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: LLMOptions = {}
): Promise<string> {
  const settingsStore = useSettingsStore()
  const { baseUrl, apiKey, model } = settingsStore.getLLMConfig()

  if (!apiKey) {
    throw new Error('未配置 API Key，请在设置 → API 配置中填写百炼 API Key')
  }

  return _callCompletion(messages, baseUrl, apiKey, model, options, 'LLM 请求')
}

// ─── Stage 3：代码生成/优化（读取 code* 配置，独立于 Stage 1） ──────────────────

/**
 * Stage 3 专用：调用代码生成/优化模型（读取 settings.code* 独立配置）。
 * 支持 SSE 流式输出（onChunk）。
 * 与 chatCompletion 使用完全独立的 Base URL / Key / Model，
 * 允许接入 DeepSeek-Coder、Qwen-Coder 等编程专用模型。
 */
export async function codeCompletion(
  messages: ChatMessage[],
  options: LLMOptions = {}
): Promise<string> {
  const settingsStore = useSettingsStore()
  const { baseUrl, apiKey, model } = settingsStore.getCodeConfig()

  if (!apiKey) {
    throw new Error('未配置 API Key，请在设置 → API 配置中填写百炼 API Key')
  }

  return _callCompletion(messages, baseUrl, apiKey, model, options, '代码模型请求')
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

/**
 * Extract a JSON object from a string that may contain code fences or extra text.
 */
export function extractJSON<T = any>(text: string): T {
  // Try to find JSON wrapped in ```json ... ``` or ``` ... ```
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenceMatch ? fenceMatch[1] : text
  // Find the first { ... } block
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) {
    throw new Error('无法从 LLM 响应中提取 JSON: ' + text.slice(0, 200))
  }
  return JSON.parse(candidate.slice(start, end + 1))
}
