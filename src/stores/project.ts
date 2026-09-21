import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { saveFileToLocal, isLocalStorageAvailable, listProjects as apiListProjects, readFileFromLocal, listLocalDir } from '@/api/storage'
import { useCanvasStore } from '@/stores/canvas'

export type GameOrientation = 'portrait' | 'landscape'

export interface ProjectInfo {
  name: string
  createdAt: string
  /** 游戏画面方向：portrait 竖版（默认） / landscape 横版 */
  orientation?: GameOrientation
}

const STORAGE_KEY = 'gameforge_project'

function generateDefaultName() {
  const adj = ['pro', 'neo', 'max', 'ultra', 'hyper', 'super', 'mini', 'turbo']
  const noun = ['fly', 'dash', 'jump', 'rush', 'blast', 'spark', 'bolt', 'wave']
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]
  const ts = Date.now().toString(36).slice(-4)
  return `${pick(adj)}-${pick(noun)}-${ts}`
}

function loadProject(): ProjectInfo | null {
  // 不自动加载上次项目，每次打开画布默认空状态
  return null
}

export const useProjectStore = defineStore('project', () => {
  const project = ref<ProjectInfo | null>(loadProject())
  const showCreateDialog = ref(false)
  const projectList = ref<ProjectInfo[]>([])

  const projectName = computed(() => project.value?.name || '')
  const hasProject = computed(() => !!project.value)
  /** 当前项目的画面方向，未设置时默认竖版（兼容老项目） */
  const orientation = computed<GameOrientation>(() => project.value?.orientation || 'portrait')

  // 项目目录结构
  const DIRS = {
    design: 'design',     // Stage 1: 创意/玩法设计文档
    modules: 'modules',   // Stage 2: 模块拆分文档
    assets: 'assets',     // Stage 3: 美术资源
    code: 'code',         // Stage 4: 游戏代码
    deploy: 'deploy',     // Stage 5: 部署产出
  } as const

  function createProject(name?: string, orientation: GameOrientation = 'portrait') {
    const projectName = name?.trim() || generateDefaultName()
    project.value = {
      name: projectName,
      createdAt: new Date().toISOString(),
      orientation,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project.value))

    // 新建项目时清空创意画布，避免上一项目的节点/连线被调用者看到或被 autoSave 写入新项目目录
    // useCanvasStore() 在函数体内调用，Pinia 会处理循环引用
    try {
      useCanvasStore().clearCanvas()
    } catch {
      // canvas store 未就绪（理论上不应发生）时静默忽略
    }

    // 创建项目目录结构（通过 Vite 端点）
    initProjectDirs(projectName)
    // 持久化项目元信息（含画面方向），供重新打开时恢复
    saveProjectMeta(project.value)
    return projectName
  }

  /** 打开已有项目 */
  async function openProject(name: string) {
    const existing = projectList.value.find((p) => p.name === name)
    // 优先从磁盘 meta 恢复画面方向，其次用列表缓存，最后回退竖版
    const meta = await readProjectMeta(name)
    project.value = {
      name,
      createdAt: meta?.createdAt || existing?.createdAt || new Date().toISOString(),
      orientation: meta?.orientation || existing?.orientation || 'portrait',
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project.value))
  }

  /** 刷新项目列表（并尽力补全各项目的画面方向） */
  async function refreshProjectList() {
    const list = await apiListProjects()
    const enriched = await Promise.all(
      list.map(async (p) => {
        const meta = await readProjectMeta(p.name)
        return { ...p, orientation: meta?.orientation || 'portrait' } as ProjectInfo
      })
    )
    projectList.value = enriched
  }

  /** 写项目元信息文件（project.json，位于项目根目录） */
  async function saveProjectMeta(info: ProjectInfo) {
    const available = await isLocalStorageAvailable()
    if (!available) return
    await saveFileToLocal(`${info.name}/project.json`, JSON.stringify(info, null, 2))
  }

  /** 读项目元信息文件，失败返回 null */
  async function readProjectMeta(name: string): Promise<ProjectInfo | null> {
    try {
      const raw = await readFileFromLocal(`${name}/project.json`)
      if (!raw) return null
      return JSON.parse(raw) as ProjectInfo
    } catch {
      return null
    }
  }

  async function initProjectDirs(name: string) {
    const available = await isLocalStorageAvailable()
    if (!available) return

    // 创建各阶段子目录的 .gitkeep 占位文件
    for (const dir of Object.values(DIRS)) {
      await saveFileToLocal(`${name}/${dir}/.gitkeep`, '')
    }
  }

  /**
   * 保存文件到项目对应阶段目录
   * @param stage 阶段目录名（design/modules/assets/code/deploy）
   * @param fileName 文件名
   * @param data 文件内容
   */
  async function saveToProject(stage: keyof typeof DIRS, fileName: string, data: Blob | string): Promise<boolean> {
    if (!project.value) return false
    const path = `${project.value.name}/${DIRS[stage]}/${fileName}`
    return saveFileToLocal(path, data)
  }

  /**
   * 从项目目录读取文件内容
   */
  async function readFromProject(stage: keyof typeof DIRS, fileName: string): Promise<string | null> {
    if (!project.value) return null
    const path = `${project.value.name}/${DIRS[stage]}/${fileName}`
    return readFileFromLocal(path)
  }

  /**
   * 列出项目某个阶段目录下的文件
   */
  async function listProjectDir(stage: keyof typeof DIRS): Promise<Array<{ name: string; isDir: boolean }>> {
    if (!project.value) return []
    const path = `${project.value.name}/${DIRS[stage]}`
    return listLocalDir(path)
  }

  function getProjectPath(stage?: keyof typeof DIRS): string {
    if (!project.value) return ''
    if (stage) return `${project.value.name}/${DIRS[stage]}`
    return project.value.name
  }

  function resetProject() {
    project.value = null
    localStorage.removeItem(STORAGE_KEY)
  }

  /**
   * 重命名当前项目：调用后端 API 重命名服务器目录，同步更新内存对象与 localStorage
   * @param newName 新项目名
   * @param username 当前登录用户名（用于定位项目目录）
   * @returns true=成功 / Error 消息=失败原因
   */
  async function renameProject(newName: string, username: string): Promise<true | string> {
    if (!project.value) return '当前无项目'
    const oldName = project.value.name
    const trimmed = newName.trim()
    if (!trimmed) return '项目名不能为空'
    if (trimmed === oldName) return true
    try {
      const resp = await fetch('/__api/rename-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, oldName, newName: trimmed }),
      })
      const data = await resp.json()
      if (!data.ok) return data.error || '重命名失败'
      project.value = { ...project.value, name: trimmed }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project.value))
      return true
    } catch (e: any) {
      return e.message || '网络错误'
    }
  }

  return {
    project, showCreateDialog, projectName, hasProject, projectList, orientation,
    DIRS, createProject, openProject, refreshProjectList,
    saveToProject, readFromProject, listProjectDir,
    getProjectPath, resetProject, renameProject,
  }
})
