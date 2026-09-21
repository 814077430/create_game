/**
 * Dev-mode CORS workaround: 已知 API 域名走 Vite 代理转发，
 * 避免浏览器 CORS 拦截直接请求。
 * 生产环境部署时需换成自己的反向代理。
 */
const PROVIDERS: Array<{ host: string; prefix: string }> = [
  { host: 'https://dashscope.aliyuncs.com', prefix: '/__proxy/dashscope' },
  { host: 'https://api.openai.com', prefix: '/__proxy/openai' },
  { host: 'https://api.deepseek.com', prefix: '/__proxy/deepseek' },
  // 百炼图像结果 OSS 桶
  { host: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com', prefix: '/__proxy/oss-bj' },
  { host: 'https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com', prefix: '/__proxy/oss-sh' },
  { host: 'https://dashscope-result-zjk.oss-cn-zhangjiakou.aliyuncs.com', prefix: '/__proxy/oss-zjk' },
  { host: 'https://dashscope-result-wlcb.oss-cn-wulanchabu.aliyuncs.com', prefix: '/__proxy/oss-wlcb' }
]

export function maybeProxyUrl(url: string): string {
  if (!import.meta.env.DEV) return url
  for (const p of PROVIDERS) {
    if (url.startsWith(p.host)) {
      return url.replace(p.host, p.prefix)
    }
  }
  return url
}

/**
 * 反向解析：将 dev-mode proxy URL 还原为原始公开 URL。
 * 用于需要传 URL 给服务端 API 的场景（如视频生成），
 * 因为服务端无法访问浏览器的 Vite 代理路径。
 * 非 dev 环境直接返回原值。
 */
export function unproxyUrl(url: string): string {
  if (!import.meta.env.DEV) return url
  for (const p of PROVIDERS) {
    if (url.startsWith(p.prefix)) {
      return url.replace(p.prefix, p.host)
    }
  }
  return url
}

/**
 * 判断一个 URL 是否可以作为公开 HTTP(S) URL 传给外部服务端 API。
 * data: / blob: / 相对路径 都不行。
 */
export function isPublicHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** 为 fetch 异常添加友好提示 */
export function explainFetchError(err: any, label: string): Error {
  const msg = err?.message ?? String(err)
  if (/Failed to fetch|NetworkError|CORS/i.test(msg)) {
    return new Error(
      `${label}: 网络请求被拦截 (${msg})。可能原因：API 域名未启用 CORS，开发环境请确保 Vite 代理已配置。`
    )
  }
  return err instanceof Error ? err : new Error(msg)
}
