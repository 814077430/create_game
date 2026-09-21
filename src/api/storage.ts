/**
 * IndexedDB-based storage layer that mimics SQLite tables + filesystem.
 * - Tables: canvas_state, canvas_nodes, canvas_edges, assets, deployments
 * - Assets blob storage simulates the filesystem.
 */

const DB_NAME = 'gameforge'
const DB_VERSION = 1

const STORES = ['canvas_state', 'canvas_nodes', 'canvas_edges', 'assets', 'deployments'] as const
type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const s = t.objectStore(store)
    const r = fn(s)
    if (r instanceof IDBRequest) {
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    } else {
      Promise.resolve(r).then(resolve, reject)
    }
  })
}

export async function putItem<T extends { id: string }>(store: StoreName, item: T) {
  return tx(store, 'readwrite', (s) => s.put(item))
}

export async function getItem<T = any>(store: StoreName, id: string): Promise<T | undefined> {
  return tx(store, 'readonly', (s) => s.get(id) as IDBRequest<T>)
}

export async function deleteItem(store: StoreName, id: string) {
  return tx(store, 'readwrite', (s) => s.delete(id))
}

export async function getAll<T = any>(store: StoreName): Promise<T[]> {
  return tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
}

export async function clearStore(store: StoreName) {
  return tx(store, 'readwrite', (s) => s.clear())
}

/**
 * Save canvas state (single row, id='current').
 */
export async function saveCanvasState(state: {
  viewport: { x: number; y: number; zoom: number }
  nodes: any[]
  edges: any[]
  pipeline: any
}) {
  await putItem('canvas_state', { id: 'current', ...state, updatedAt: Date.now() })
}

export async function loadCanvasState(): Promise<{
  viewport: { x: number; y: number; zoom: number }
  nodes: any[]
  edges: any[]
  pipeline: any
} | null> {
  const row = await getItem<any>('canvas_state', 'current')
  if (!row) return null
  return { viewport: row.viewport, nodes: row.nodes, edges: row.edges, pipeline: row.pipeline }
}

/**
 * Fetch a remote/data URL and return a local blob URL for display.
 * Also returns the blob so callers can save it to the project directory.
 */
export async function persistAssetFromUrl(remoteUrl: string, _assetId: string): Promise<{ blobUrl: string; blob: Blob | null }> {
  // data URL 直接转 Blob（多帧拼接 / videoToSpriteSheet 等本地生成路径返回 data URL）
  if (remoteUrl.startsWith('data:')) {
    try {
      const resp = await fetch(remoteUrl)
      const blob = await resp.blob()
      console.log('[persistAssetFromUrl] data URL 转 Blob, size:', blob.size, 'type:', blob.type)
      return { blobUrl: URL.createObjectURL(blob), blob }
    } catch (err) {
      console.warn('[persistAssetFromUrl] data URL 转换失败:', err)
      return { blobUrl: remoteUrl, blob: null }
    }
  }
  try {
    // 通过 Vite dev server 代理下载远程图片（彻底避免浏览器 CORS 问题）
    const fetchUrl = `/__save-file/fetch-image?url=${encodeURIComponent(remoteUrl)}`
    const resp = await fetch(fetchUrl)
    if (!resp.ok) throw new Error(`server-proxy fetch ${resp.status}`)
    const blob = await resp.blob()
    console.log('[persistAssetFromUrl] 成功下载, size:', blob.size, 'type:', blob.type)
    return { blobUrl: URL.createObjectURL(blob), blob }
  } catch (err) {
    // 降级：直接使用原始 URL（图片仍可显示但无法保存到本地）
    console.warn('[persistAssetFromUrl] 无法下载图片，使用原始URL:', err)
    return { blobUrl: remoteUrl, blob: null }
  }
}

export async function getAssetUrl(_assetId: string): Promise<string | null> {
  return null
}

// ─── 本地文件系统存储（通过 Vite dev-server 中间件） ────────────────────────

import { useAuthStore } from '@/stores/auth'

/** 获取当前登录用户名作为路径前缀 */
function getUserPrefix(): string {
  const auth = useAuthStore()
  return auth.username ? `${auth.username}/` : ''
}

/**
 * 将文件保存到本地 game-output 目录。
 * @param filePath 相对路径，如 "assets/player.png" 或 "game.js"
 * @param data     文件内容（Blob 或字符串）
 * @returns        保存是否成功
 */
export async function saveFileToLocal(filePath: string, data: Blob | string): Promise<boolean> {
  try {
    const fullPath = getUserPrefix() + filePath
    const body = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data
    const resp = await fetch('/__save-file', {
      method: 'POST',
      headers: { 'X-File-Path': fullPath },
      body,
    })
    if (!resp.ok) {
      console.warn(`[saveFileToLocal] 保存失败: ${filePath}`, await resp.text())
      return false
    }
    return true
  } catch (err) {
    console.warn(`[saveFileToLocal] 保存失败: ${filePath}`, err)
    return false
  }
}

/**
 * 检查本地存储端点是否可用（仅 dev 模式可用）
 */
export async function isLocalStorageAvailable(): Promise<boolean> {
  try {
    const resp = await fetch('/__save-file/status')
    return resp.ok
  } catch {
    return false
  }
}

/**
 * 列出项目目录
 */
export async function listProjects(): Promise<Array<{ name: string; createdAt: string }>> {
  try {
    const auth = useAuthStore()
    const resp = await fetch(`/__save-file/list-projects?user=${encodeURIComponent(auth.username)}`)
    if (!resp.ok) return []
    const data = await resp.json()
    return data.projects || []
  } catch {
    return []
  }
}

/**
 * 列出某个目录下的文件/子目录
 */
export async function listLocalDir(dirPath: string): Promise<Array<{ name: string; isDir: boolean }>> {
  try {
    const fullPath = getUserPrefix() + dirPath
    const resp = await fetch(`/__save-file/list-dir?path=${encodeURIComponent(fullPath)}`)
    if (!resp.ok) return []
    const data = await resp.json()
    return data.files || []
  } catch {
    return []
  }
}

/**
 * 从本地项目目录读取文件内容（文本）
 */
export async function readFileFromLocal(filePath: string): Promise<string | null> {
  try {
    const fullPath = getUserPrefix() + filePath
    const resp = await fetch(`/__save-file/read-file?path=${encodeURIComponent(fullPath)}`)
    if (!resp.ok) return null
    const data = await resp.json()
    return data.content || null
  } catch {
    return null
  }
}

/**
 * 从本地项目目录读取二进制文件为 data URL
 */
export async function readFileAsDataUrl(filePath: string): Promise<string | null> {
  try {
    const fullPath = getUserPrefix() + filePath
    const resp = await fetch(`/__save-file/read-file?path=${encodeURIComponent(fullPath)}&mode=base64`)
    if (!resp.ok) return null
    const data = await resp.json()
    return data.dataUrl || null
  } catch {
    return null
  }
}
