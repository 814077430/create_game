import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { saveFilePlugin } from './vite-plugin-save-file'

// Dev-only CORS proxy: 浏览器直连 LLM/图像 API 会被 CORS 拦截，
// 走 Vite dev server 转发可以绕过。
const proxyTargets: Record<string, string> = {
  '/__proxy/dashscope': 'https://dashscope.aliyuncs.com',
  '/__proxy/openai': 'https://api.openai.com',
  '/__proxy/deepseek': 'https://api.deepseek.com',
  '/__proxy/oss-bj': 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com',
  '/__proxy/oss-sh': 'https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com',
  '/__proxy/oss-zjk': 'https://dashscope-result-zjk.oss-cn-zhangjiakou.aliyuncs.com',
  '/__proxy/oss-wlcb': 'https://dashscope-result-wlcb.oss-cn-wulanchabu.aliyuncs.com'
}

// 游戏产出目录：美术资源、代码、HTML 都保存在这里
const gameOutputDir = resolve(__dirname, 'game-output')

export default defineConfig({
  plugins: [vue(), saveFilePlugin(gameOutputDir)],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    host: true,
    proxy: Object.fromEntries(
      Object.entries(proxyTargets).map(([prefix, target]) => [
        prefix,
        {
          target,
          changeOrigin: true,
          secure: true,
          rewrite: (p: string) => p.replace(prefix, '')
        }
      ])
    )
  },
})
