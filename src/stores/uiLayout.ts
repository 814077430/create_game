/**
 * 游戏内可视化布局编辑 —— 布局覆盖状态管理
 *
 * 职责：
 * - 持有当前项目的 ui-layout.json（override 集合）
 * - 维护撤销/重做栈（快照式，简单可靠）
 * - 落盘：design/ui-layout.json + 热替换 deploy/game.html 的布局数据块
 * - 已发布游戏同步：调用 dev-server 端点把 deploy/game.html 覆盖到 game-show
 *
 * 设计文档：docs/live-ui-editor-design.md
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useAuthStore } from '@/stores/auth'
import {
  emptyLayout,
  countOverrides,
  toAnchored,
  autoAnchor,
  upsertLayoutBlock,
  stripEditorBlock,
  LAYOUT_FILE_NAME,
  type GFAnchor,
  type GFLayoutFile,
  type GFOverride,
  type GFRect,
} from '@/api/liveEdit'

export const LAYOUT_FILE = LAYOUT_FILE_NAME

/** 撤销栈深度 */
const HISTORY_MAX = 50

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export const useUiLayoutStore = defineStore('uiLayout', () => {
  const layout = ref<GFLayoutFile>(emptyLayout({ width: 750, height: 1334 }))
  /** 有未落盘的修改 */
  const dirty = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const lastError = ref('')
  /** 最近一次落盘时间 */
  const savedAt = ref('')

  // 快照式撤销栈：history[cursor] 恒等于当前 layout.scenes
  const history = ref<string[]>([])
  const cursor = ref(-1)

  const overrideCount = computed(() => countOverrides(layout.value))
  const canUndo = computed(() => cursor.value > 0)
  const canRedo = computed(() => cursor.value >= 0 && cursor.value < history.value.length - 1)

  function resetHistory() {
    history.value = [JSON.stringify(layout.value.scenes)]
    cursor.value = 0
  }

  /** 把当前 scenes 压入撤销栈（连续拖拽时只在 commit 时调用） */
  function pushHistory() {
    const snap = JSON.stringify(layout.value.scenes)
    if (cursor.value >= 0 && history.value[cursor.value] === snap) return
    history.value = history.value.slice(0, cursor.value + 1)
    history.value.push(snap)
    if (history.value.length > HISTORY_MAX) history.value.shift()
    cursor.value = history.value.length - 1
  }

  /**
   * 载入当前项目的布局文件。设计尺寸由运行时上报，用于校正锚点解析基准。
   * 文件不存在时返回空布局（不视为错误）。
   */
  async function load(designSize?: { width: number; height: number }): Promise<GFLayoutFile> {
    loading.value = true
    lastError.value = ''
    try {
      const projStore = useProjectStore()
      const raw = await projStore.readFromProject('design', LAYOUT_FILE)
      let parsed: GFLayoutFile | null = null
      if (raw) {
        try {
          const obj = JSON.parse(raw)
          if (obj && typeof obj === 'object' && obj.scenes) parsed = obj as GFLayoutFile
        } catch {
          lastError.value = 'ui-layout.json 解析失败，已按空布局处理'
        }
      }
      const size = designSize || parsed?.designSize || { width: 750, height: 1334 }
      layout.value = parsed
        ? { ...parsed, designSize: size, scenes: parsed.scenes || {} }
        : emptyLayout(size, projStore.orientation)
      dirty.value = false
      resetHistory()
      return layout.value
    } finally {
      loading.value = false
    }
  }

  /** 运行时上报设计尺寸后校正（老布局文件可能缺字段） */
  function setDesignSize(size: { width: number; height: number }) {
    if (!size?.width || !size?.height) return
    layout.value.designSize = { width: size.width, height: size.height }
  }

  function scopeMap(scope: string): Record<string, GFOverride> {
    if (!layout.value.scenes[scope]) layout.value.scenes[scope] = {}
    return layout.value.scenes[scope]
  }

  function getOverride(scope: string, id: string): GFOverride | null {
    return layout.value.scenes[scope]?.[id] || null
  }

  /**
   * 记录一次矩形变更（绝对设计像素 → 锚点式存储）
   * @param commit true 时压入撤销栈（拖拽结束/数值输入），false 为拖拽过程中的中间态
   */
  function setRect(
    scope: string,
    id: string,
    rect: GFRect,
    anchor?: GFAnchor,
    commit = true
  ) {
    const { width: W, height: H } = layout.value.designSize
    const a = anchor || getOverride(scope, id)?.anchor || autoAnchor(rect, W, H)
    const prev = getOverride(scope, id)
    const next = toAnchored(rect, a, W, H)
    scopeMap(scope)[id] = { ...prev, ...next }
    dirty.value = true
    if (commit) pushHistory()
  }

  /** 只改锚点：保持元素在画面上的绝对位置不变 */
  function setAnchor(scope: string, id: string, anchor: GFAnchor, rect: GFRect) {
    setRect(scope, id, rect, anchor, true)
  }

  /**
   * 改标记位（visible / locked）。
   * paint 类元素（静态文字/图标）通常还没有 override 记录，需用当前矩形先建一条。
   */
  function setFlag(
    scope: string,
    id: string,
    flag: 'visible' | 'locked',
    value: boolean,
    seedRect?: GFRect,
    seedAnchor?: GFAnchor
  ) {
    let o = getOverride(scope, id)
    if (!o) {
      if (!seedRect) return
      const { width: W, height: H } = layout.value.designSize
      o = toAnchored(seedRect, seedAnchor || autoAnchor(seedRect, W, H), W, H)
      scopeMap(scope)[id] = o
    }
    o[flag] = value
    dirty.value = true
    pushHistory()
  }

  function resetElement(scope: string, id: string) {
    if (layout.value.scenes[scope]) {
      delete layout.value.scenes[scope][id]
      if (!Object.keys(layout.value.scenes[scope]).length) delete layout.value.scenes[scope]
    }
    dirty.value = true
    pushHistory()
  }

  function resetScope(scope: string) {
    delete layout.value.scenes[scope]
    dirty.value = true
    pushHistory()
  }

  function resetAll() {
    layout.value.scenes = {}
    dirty.value = true
    pushHistory()
  }

  /** 撤销/重做：返回新的 scenes，调用方负责推送给运行时 */
  function undo(): Record<string, Record<string, GFOverride>> | null {
    if (!canUndo.value) return null
    cursor.value--
    layout.value.scenes = JSON.parse(history.value[cursor.value])
    dirty.value = true
    return layout.value.scenes
  }

  function redo(): Record<string, Record<string, GFOverride>> | null {
    if (!canRedo.value) return null
    cursor.value++
    layout.value.scenes = JSON.parse(history.value[cursor.value])
    dirty.value = true
    return layout.value.scenes
  }

  /** 供 postMessage 下发的纯对象（避免把 reactive proxy 结构化克隆失败） */
  function plainScenes(): Record<string, Record<string, GFOverride>> {
    return clone(layout.value.scenes)
  }

  function plainLayout(): GFLayoutFile {
    return clone({ ...layout.value, updatedAt: new Date().toISOString() })
  }

  /**
   * 落盘：
   *  1. design/ui-layout.json —— 唯一数据源，Stage5 重跑时会读它
   *  2. deploy/game.html —— 原地热替换布局数据块，无需重新打包（产物可达 1.5MB）
   *  3. game-show —— 若该项目已发布，同步覆盖已发布的 game.html
   */
  async function save(): Promise<{ ok: boolean; message: string }> {
    saving.value = true
    lastError.value = ''
    try {
      const projStore = useProjectStore()
      if (!projStore.hasProject) return { ok: false, message: '当前无项目' }

      const data = plainLayout()
      layout.value.updatedAt = data.updatedAt

      const jsonOk = await projStore.saveToProject('design', LAYOUT_FILE, JSON.stringify(data, null, 2))
      if (!jsonOk) return { ok: false, message: '写入 design/ui-layout.json 失败' }

      // 热替换部署产物中的布局块（顺带确保编辑代理不会被固化进产物）
      const html = await projStore.readFromProject('deploy', 'game.html')
      let htmlSynced = false
      if (html) {
        const next = stripEditorBlock(upsertLayoutBlock(html, data))
        htmlSynced = await projStore.saveToProject('deploy', 'game.html', next)
      }

      // 已发布则同步（未发布时端点返回 skipped，不算失败）
      let published = false
      if (htmlSynced) {
        published = await syncPublished(projStore.projectName)
      }

      dirty.value = false
      savedAt.value = new Date().toLocaleTimeString()
      resetHistory()
      const parts = [`已保存 ${countOverrides(data)} 项调整`]
      if (htmlSynced) parts.push('部署产物已同步')
      if (published) parts.push('已发布版本已更新')
      return { ok: true, message: parts.join('，') }
    } catch (err: any) {
      const msg = String(err?.message || err)
      lastError.value = msg
      return { ok: false, message: msg }
    } finally {
      saving.value = false
    }
  }

  /** 同步到 game-show（仅当该项目已发布）。返回是否真正更新了已发布文件 */
  async function syncPublished(projectName: string): Promise<boolean> {
    try {
      const auth = useAuthStore()
      if (!auth.username || !projectName) return false
      const resp = await fetch('/__game-show/sync-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: auth.username, projectName }),
      })
      if (!resp.ok) return false
      const data = await resp.json()
      return !!data.synced
    } catch {
      return false
    }
  }

  return {
    layout,
    dirty,
    loading,
    saving,
    lastError,
    savedAt,
    overrideCount,
    canUndo,
    canRedo,
    load,
    setDesignSize,
    getOverride,
    setRect,
    setAnchor,
    setFlag,
    resetElement,
    resetScope,
    resetAll,
    undo,
    redo,
    plainScenes,
    plainLayout,
    save,
  }
})
