import { useSettingsStore } from '@/stores/settings'
import { maybeProxyUrl, explainFetchError } from './proxy'

export interface ImageGenOptions {
  prompt: string
  n?: number
  size?: string
  signal?: AbortSignal
}

export interface GeneratedImage {
  url: string
  isDataUrl: boolean
}

/**
 * 尺寸格式统一：百炼用 "*"，OpenAI 用 "x"
 */
function normalizeSize(size: string, provider: 'openai' | 'bailian'): string {
  if (provider === 'bailian') return size.replace(/x/gi, '*')
  return size.replace(/\*/g, 'x')
}

function detectProvider(baseUrl: string, model: string): 'bailian' | 'openai' {
  if (/dashscope|aliyuncs/i.test(baseUrl)) return 'bailian'
  if (/^(wan|wanx|qwen)/i.test(model)) return 'bailian'
  return 'openai'
}

/** 从 base URL 提取主机根 (去掉 path) */
function hostRoot(baseUrl: string): string {
  try {
    const u = new URL(baseUrl)
    return `${u.protocol}//${u.host}`
  } catch {
    return baseUrl.replace(/\/.*$/, '')
  }
}

/**
 * 判断是否走 multimodal-generation 同步接口的模型
 * 包括：qwen-image 系列、z-image 系列、wan2.7-image 系列
 */
function isMultimodalGenModel(model: string): boolean {
  return /^(qwen-image|z-image|wan2\.\d+-image)/i.test(model)
}

/**
 * 入口：根据配置自动选择合适的图像生成 API
 * - qwen-image / z-image / wan2.7-image 系列：走 multimodal-generation 同步接口
 * - wanx/wanx2.1 等旧模型：走原生异步 image-synthesis 接口
 */
export async function generateImage(options: ImageGenOptions): Promise<GeneratedImage[]> {
  const settingsStore = useSettingsStore()
  const { baseUrl, apiKey, model } = settingsStore.getImageConfig()

  if (!apiKey) {
    throw new Error('未配置 API Key，请在设置 → API 配置中填写百炼 API Key')
  }

  const sizeRaw = options.size ?? '1024*1024'
  const size = normalizeSize(sizeRaw, 'bailian')
  const baseRoot = hostRoot(baseUrl)

  // 新模型走 multimodal-generation 同步接口
  if (isMultimodalGenModel(model)) {
    return generateImageQwen({
      prompt: options.prompt,
      size,
      n: options.n ?? 1,
      model,
      apiKey,
      baseRoot,
      signal: options.signal
    })
  }

  // wanx/wan 等模型走原生异步 API
  return generateImageBailian({
    prompt: options.prompt,
    size,
    n: options.n ?? 1,
    model,
    apiKey,
    baseRoot,
    signal: options.signal
  })
}

// ===== Qwen-Image 系列（multimodal-generation 同步接口） =====
async function generateImageQwen(opts: {
  prompt: string
  size: string
  n: number
  model: string
  apiKey: string
  baseRoot: string
  signal?: AbortSignal
}): Promise<GeneratedImage[]> {
  const url = maybeProxyUrl(
    `${opts.baseRoot}/api/v1/services/aigc/multimodal-generation/generation`
  )
  const body = {
    model: opts.model,
    input: {
      messages: [
        { role: 'user', content: [{ text: opts.prompt }] }
      ]
    },
    parameters: { size: opts.size, n: opts.n }
  }

  console.log('[qwen-image] POST', url, JSON.stringify(body))

  let res: Response
  // 429 限流自动重试
  let attempt = 0
  const maxAttempts = 5
  while (true) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`
        },
        body: JSON.stringify(body),
        signal: opts.signal
      })
    } catch (err) {
      throw explainFetchError(err, 'Qwen-Image 请求')
    }
    if (res.status === 429 && attempt < maxAttempts - 1) {
      attempt++
      const wait = 2000 * Math.pow(2, attempt) + Math.random() * 1000
      console.warn(`[qwen-image] 429 rate-limited, retry ${attempt}/${maxAttempts} in ${wait | 0}ms`)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    break
  }

  if (!res!.ok) {
    const text = await res!.text().catch(() => '')
    console.error('[qwen-image] failed', res!.status, text)
    throw new Error(`Qwen-Image 请求失败 ${res!.status}: ${text.slice(0, 600)}`)
  }

  const json = await res!.json()
  console.log('[qwen-image] response:', JSON.stringify(json).slice(0, 300))

  // 解析 output.choices[].message.content[].image
  const choices: any[] = json.output?.choices ?? []
  const images: GeneratedImage[] = []
  for (const choice of choices) {
    const content: any[] = choice?.message?.content ?? []
    for (const item of content) {
      if (item.image) {
        images.push({ url: item.image, isDataUrl: false })
      } else if (item.b64_image) {
        images.push({ url: `data:image/png;base64,${item.b64_image}`, isDataUrl: true })
      }
    }
  }

  if (!images.length) {
    throw new Error(`Qwen-Image 返回为空: ${JSON.stringify(json).slice(0, 200)}`)
  }
  return images
}

// ===== OpenAI 兼容（DALL·E 等） =====
async function generateImageOpenAICompat(opts: {
  prompt: string
  size: string
  n: number
  model: string
  apiKey: string
  baseUrl: string
  signal?: AbortSignal
}): Promise<GeneratedImage[]> {
  const url = maybeProxyUrl(`${opts.baseUrl.replace(/\/$/, '')}/images/generations`)
  const isDalle3 = opts.model.includes('dall-e-3')
  const body: Record<string, any> = {
    model: opts.model,
    prompt: opts.prompt,
    size: opts.size,
    n: isDalle3 ? 1 : opts.n
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`
      },
      body: JSON.stringify(body),
      signal: opts.signal
    })
  } catch (err) {
    throw explainFetchError(err, '图像 API 请求')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`图像 API 请求失败 ${res.status}: ${text.slice(0, 240)}`)
  }
  const json = await res.json()
  const data: any[] = json.data ?? []
  if (!data.length) throw new Error(`图像 API 返回为空: ${JSON.stringify(json).slice(0, 200)}`)
  return data.map((d) => {
    if (d.b64_json) return { url: `data:image/png;base64,${d.b64_json}`, isDataUrl: true }
    return { url: (d.url ?? d.image_url) as string, isDataUrl: false }
  })
}

// ===== 阿里百炼 DashScope 原生异步 API =====
async function generateImageBailian(opts: {
  prompt: string
  size: string
  n: number
  model: string
  apiKey: string
  baseRoot: string
  signal?: AbortSignal
}): Promise<GeneratedImage[]> {
  const submitUrl = maybeProxyUrl(
    `${opts.baseRoot}/api/v1/services/aigc/text2image/image-synthesis`
  )
  const body = {
    model: opts.model,
    input: { prompt: opts.prompt },
    parameters: { size: opts.size, n: opts.n }
  }

  let submitRes: Response
  console.log('[bailian] POST', submitUrl, JSON.stringify(body))

  // 429 限流自动重试 (指数退避)
  let attempt = 0
  const maxAttempts = 5
  while (true) {
    try {
      submitRes = await fetch(submitUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
          'X-DashScope-Async': 'enable'
        },
        body: JSON.stringify(body),
        signal: opts.signal
      })
    } catch (err) {
      throw explainFetchError(err, '百炼任务提交')
    }
    if (submitRes.status === 429 && attempt < maxAttempts - 1) {
      attempt++
      const wait = 2000 * Math.pow(2, attempt) + Math.random() * 1000
      console.warn(`[bailian] 429 rate-limited, retry ${attempt}/${maxAttempts} in ${wait | 0}ms`)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    break
  }

  if (!submitRes!.ok) {
    const text = await submitRes!.text().catch(() => '')
    console.error('[bailian] submit failed', submitRes!.status, text)
    throw new Error(`百炼任务提交失败 ${submitRes!.status}: ${text.slice(0, 600)}`)
  }
  const submitJson = await submitRes!.json()
  const taskId: string | undefined = submitJson.output?.task_id
  if (!taskId) {
    throw new Error(`百炼未返回 task_id: ${JSON.stringify(submitJson).slice(0, 200)}`)
  }
  console.log('[bailian] task submitted:', taskId)

  // 轮询任务状态
  const startTs = Date.now()
  const maxMs = 120_000
  let intervalMs = 1500
  while (Date.now() - startTs < maxMs) {
    if (opts.signal?.aborted) throw new Error('已取消')
    await new Promise((r) => setTimeout(r, intervalMs))
    const pollUrl = maybeProxyUrl(`${opts.baseRoot}/api/v1/tasks/${taskId}`)
    let pollRes: Response
    try {
      pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${opts.apiKey}` },
        signal: opts.signal
      })
    } catch (err) {
      throw explainFetchError(err, '百炼任务轮询')
    }
    if (!pollRes.ok) {
      const text = await pollRes.text().catch(() => '')
      throw new Error(`百炼任务查询失败 ${pollRes.status}: ${text.slice(0, 240)}`)
    }
    const pollJson = await pollRes.json()
    const status: string = pollJson.output?.task_status ?? ''
    console.log('[bailian] poll', taskId, status)
    if (status === 'SUCCEEDED') {
      const results: any[] = pollJson.output?.results ?? []
      if (!results.length) {
        throw new Error(`百炼任务完成但无结果: ${JSON.stringify(pollJson).slice(0, 200)}`)
      }
      return results
        .map((r) => {
          if (r.url) return { url: r.url as string, isDataUrl: false }
          if (r.b64_image) {
            return { url: `data:image/png;base64,${r.b64_image}`, isDataUrl: true }
          }
          return null
        })
        .filter(Boolean) as GeneratedImage[]
    }
    if (status === 'FAILED' || status === 'UNKNOWN') {
      const code = pollJson.output?.code ?? ''
      const msg = pollJson.output?.message ?? '未知错误'
      throw new Error(`百炼任务失败 [${code}]: ${msg}`)
    }
    // PENDING / RUNNING — keep polling, gentle backoff
    intervalMs = Math.min(intervalMs + 500, 4000)
  }
  throw new Error('百炼任务超时（120s）')
}

// ===== 视频生成（图生视频 i2v）→ 用于 animationType='video' 资产 =====
export interface VideoGenOptions {
  /** 参考图片 URL（已生成好的静态角色图） */
  imageUrl: string
  /** 动作描述 prompt（如 "a cute robot walking smoothly, seamless loop"） */
  prompt: string
  /** 视频尺寸，默认 1280*720 */
  size?: string
  signal?: AbortSignal
}

export interface GeneratedVideo {
  url: string
}

/**
 * 调用百炼 DashScope 图生视频（i2v）异步接口
 * 模型：wan3.0-video-prime / wan2.7-i2v / happyhorse-1.0-i2v
 * 返回视频 URL（通常为 mp4）
 */
export async function generateVideo(options: VideoGenOptions): Promise<GeneratedVideo> {
  const settingsStore = useSettingsStore()
  const { apiKey, model, baseUrl } = settingsStore.getVideoConfig()
  const baseRoot = hostRoot(baseUrl)

  if (!apiKey) {
    throw new Error('未配置 API Key，无法生成视频')
  }
  if (!model) {
    throw new Error('未配置视频模型，请在设置 → API 配置中填写视频模型名称')
  }

  // wan2.7 及以上（含 wan3.x）用新版协议（video-generation），wan2.1 系列用旧版协议（image2video）
  const isNewProtocol = /^wan(2\.[7-9]|[3-9])/i.test(model)

  let submitUrl: string
  let body: Record<string, any>

  if (isNewProtocol) {
    // 新版协议: media 数组 + resolution 字符串 + duration
    submitUrl = maybeProxyUrl(
      `${baseRoot}/api/v1/services/aigc/video-generation/video-synthesis`
    )
    body = {
      model,
      input: {
        prompt: options.prompt,
        media: [{ type: 'first_frame', url: options.imageUrl }]
      },
      parameters: { resolution: '720P', duration: 5 }
    }
  } else {
    // wan2.1 / cogvideox 旧版协议: image_url + size
    submitUrl = maybeProxyUrl(
      `${baseRoot}/api/v1/services/aigc/image2video/video-synthesis`
    )
    body = {
      model,
      input: {
        image_url: options.imageUrl,
        prompt: options.prompt
      },
      parameters: { size: options.size ?? '1280*720' }
    }
  }

  console.log('[video-gen] POST', submitUrl, JSON.stringify(body).slice(0, 500))

  let submitRes: Response
  let attempt = 0
  const maxAttempts = 3
  while (true) {
    try {
      submitRes = await fetch(submitUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-DashScope-Async': 'enable'
        },
        body: JSON.stringify(body),
        signal: options.signal
      })
    } catch (err) {
      throw explainFetchError(err, '视频任务提交')
    }
    if (submitRes.status === 429 && attempt < maxAttempts - 1) {
      attempt++
      const wait = 3000 * Math.pow(2, attempt) + Math.random() * 1000
      console.warn(`[video-gen] 429 rate-limited, retry ${attempt}/${maxAttempts} in ${wait | 0}ms`)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    break
  }

  if (!submitRes!.ok) {
    const text = await submitRes!.text().catch(() => '')
    console.error('[video-gen] submit failed', submitRes!.status, text)
    throw new Error(`视频任务提交失败 ${submitRes!.status}: ${text.slice(0, 600)}`)
  }
  const submitJson = await submitRes!.json()
  const taskId: string | undefined = submitJson.output?.task_id
  if (!taskId) {
    throw new Error(`视频任务未返回 task_id: ${JSON.stringify(submitJson).slice(0, 200)}`)
  }
  console.log('[video-gen] task submitted:', taskId)

  // 轮询（视频生成通常 30-120s）
  const startTs = Date.now()
  const maxMs = 180_000 // 3 min timeout for video
  let intervalMs = 3000
  while (Date.now() - startTs < maxMs) {
    if (options.signal?.aborted) throw new Error('已取消')
    await new Promise((r) => setTimeout(r, intervalMs))
    const pollUrl = maybeProxyUrl(`${baseRoot}/api/v1/tasks/${taskId}`)
    let pollRes: Response
    try {
      pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: options.signal
      })
    } catch (err) {
      throw explainFetchError(err, '视频任务轮询')
    }
    if (!pollRes.ok) {
      const text = await pollRes.text().catch(() => '')
      throw new Error(`视频任务查询失败 ${pollRes.status}: ${text.slice(0, 240)}`)
    }
    const pollJson = await pollRes.json()
    const status: string = pollJson.output?.task_status ?? ''
    console.log('[video-gen] poll', taskId, status)
    if (status === 'SUCCEEDED') {
      // 新版协议: output.video_url 或 output.results[].url
      const videoUrl: string | undefined =
        pollJson.output?.video_url ||
        pollJson.output?.results?.[0]?.url ||
        pollJson.output?.results?.[0]?.video_url
      if (!videoUrl) {
        throw new Error(`视频任务完成但无 video_url: ${JSON.stringify(pollJson).slice(0, 300)}`)
      }
      return { url: videoUrl }
    }
    if (status === 'FAILED' || status === 'UNKNOWN') {
      const code = pollJson.output?.code ?? ''
      const msg = pollJson.output?.message ?? '未知错误'
      throw new Error(`视频任务失败 [${code}]: ${msg}`)
    }
    intervalMs = Math.min(intervalMs + 1000, 6000)
  }
  throw new Error('视频任务超时（180s）')
}

/**
 * 从视频 URL 抽取帧 → 拼成 2×2 十字格 sprite sheet
 * 使用 canvas + video element 在浏览器内完成
 * 布局：[Frame0][Frame1]
 *       [Frame2][Frame3]
 * @param videoUrl 视频文件 URL
 * @param frameCount 需要抽取的帧数（固定 4 帧）
 * @param frameSize 每帧目标尺寸 { width, height }
 * @returns sprite sheet 的 data URL (PNG)
 */
export async function videoToSpriteSheet(
  videoUrl: string,
  frameCount: number,
  frameSize: { width: number; height: number } = { width: 256, height: 256 }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'auto'

    video.onloadedmetadata = async () => {
      const duration = video.duration
      if (!duration || duration < 0.1) {
        reject(new Error('视频时长为 0 或无法解析'))
        return
      }

      // 2×2 十字格布局：总尺寸 = 2帧宽 × 2帧高
      const cols = 2
      const rows = 2
      const sheetWidth = frameSize.width * cols
      const sheetHeight = frameSize.height * rows
      const canvas = document.createElement('canvas')
      canvas.width = sheetWidth
      canvas.height = sheetHeight
      const ctx = canvas.getContext('2d')!

      // 均匀分布抽帧时间点（排除最后一帧以避免视频结尾黑帧）
      const interval = duration / (frameCount + 1)
      const times: number[] = []
      for (let i = 1; i <= frameCount; i++) {
        times.push(i * interval)
      }

      try {
        for (let i = 0; i < times.length; i++) {
          const col = i % cols
          const row = Math.floor(i / cols)
          const dx = col * frameSize.width
          const dy = row * frameSize.height
          await seekAndDraw(video, times[i], ctx, dx, dy, frameSize.width, frameSize.height)
        }
        // 绿幕抠图：将绿色背景像素转为透明，确保游戏中角色无绿色底
        chromaKeyRemoveGreen(ctx, sheetWidth, sheetHeight)
        const dataUrl = canvas.toDataURL('image/png')
        resolve(dataUrl)
      } catch (err) {
        reject(err)
      }
    }

    video.onerror = () => reject(new Error(`视频加载失败: ${videoUrl}`))
    video.src = videoUrl
    video.load()
  })
}

/** 绿幕抠图：将接近纯绿 (#00FF00) 的像素 alpha 设为 0，边缘像素半透明过渡 */
function chromaKeyRemoveGreen(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const imageData = ctx.getImageData(0, 0, w, h)
  const d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    // 绿色判定：G 通道显著高于 R 和 B
    if (g > 120 && g > r * 1.4 && g > b * 1.4) {
      // 绿色强度：越纯绿越透明
      const greenness = (g - Math.max(r, b)) / g
      if (greenness > 0.4) {
        // 纯绿像素 → 完全透明
        d[i + 3] = 0
      } else if (greenness > 0.2) {
        // 边缘像素 → 半透明过渡（消除绿边）
        const alpha = Math.round(255 * (1 - (greenness - 0.2) / 0.2))
        d[i + 3] = Math.min(d[i + 3], alpha)
      }
    }
  }
  ctx.putImageData(imageData, 0, 0)
}

/** 辅助：seek 到指定时间并保留完整画面绘制到 canvas（contain 模式，不裁切） */
function seekAndDraw(
  video: HTMLVideoElement,
  time: number,
  ctx: CanvasRenderingContext2D,
  dx: number, dy: number, dw: number, dh: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`seek 超时 at ${time}s`)), 10000)
    video.onseeked = () => {
      clearTimeout(timeout)
      const vw = video.videoWidth || 1280
      const vh = video.videoHeight || 720

      // contain 模式：将完整视频帧缩放到目标区域内（保持宽高比）
      // 绿色背景区域将由 chromaKeyRemoveGreen 后处理为透明
      const videoRatio = vw / vh
      const targetRatio = dw / dh

      // 先填充绿色背景（作为 chroma key 区域）
      ctx.fillStyle = '#00FF00'
      ctx.fillRect(dx, dy, dw, dh)

      let drawX = dx, drawY = dy, drawW = dw, drawH = dh
      if (videoRatio > targetRatio) {
        // 视频更宽 — 以宽度为基准缩放，上下留绿色边
        drawH = dw / videoRatio
        drawY = dy + (dh - drawH) / 2
      } else {
        // 视频更高 — 以高度为基准缩放，左右留绿色边
        drawW = dh * videoRatio
        drawX = dx + (dw - drawW) / 2
      }

      // 绘制完整视频帧（无裁切，角色保证完整）
      ctx.drawImage(video, 0, 0, vw, vh, drawX, drawY, drawW, drawH)
      resolve()
    }
    video.onerror = () => { clearTimeout(timeout); reject(new Error('seek 出错')) }
    video.currentTime = time
  })
}
