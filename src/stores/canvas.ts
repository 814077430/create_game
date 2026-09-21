import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type {
  CanvasNode,
  CanvasEdge,
  PipelineState,
  GameDesign,
  IdeaNodeData,
  ModuleNodeData,
  ModuleArtAsset,
  CodeNodeData,
  DeployNodeData,
} from '@/types'
import { useProjectStore } from '@/stores/project'
import { useAuthStore } from '@/stores/auth'

export const useCanvasStore = defineStore('canvas', () => {
  const viewport = ref({ x: 0, y: 0, zoom: 1 })
  const nodes = ref<CanvasNode[]>([])
  const edges = ref<CanvasEdge[]>([])
  const selectedNodeId = ref<string | null>(null)
  const pipeline = ref<PipelineState>({ currentStage: 0, status: 'idle', progress: 0, message: '' })
  const loaded = ref(false)
  /** 加载版本号：每次 loadFromProject/clearCanvas 时递增，用于中止过期的异步加载 */
  let _loadVersion = 0

  const selectedNode = computed(() => nodes.value.find((n) => n.id === selectedNodeId.value) || null)

  function addNode(node: CanvasNode) { nodes.value.push(node) }

  function updateNode(id: string, data: Partial<CanvasNode>) {
    const node = nodes.value.find((n) => n.id === id)
    if (node) Object.assign(node, data)
  }

  function removeNode(id: string) {
    nodes.value = nodes.value.filter((n) => n.id !== id)
    edges.value = edges.value.filter((e) => e.sourceId !== id && e.targetId !== id)
    if (selectedNodeId.value === id) selectedNodeId.value = null
  }

  function addEdge(edge: CanvasEdge) {
    if (!edges.value.find((e) => e.sourceId === edge.sourceId && e.targetId === edge.targetId)) {
      edges.value.push(edge)
    }
  }

  function selectNode(id: string | null) { selectedNodeId.value = id }

  function moveNode(id: string, x: number, y: number) {
    const node = nodes.value.find((n) => n.id === id)
    if (node) { node.position.x = x; node.position.y = y }
  }

  function setViewport(x: number, y: number, zoom?: number) {
    viewport.value.x = x; viewport.value.y = y
    if (zoom !== undefined) viewport.value.zoom = Math.max(0.2, Math.min(3, zoom))
  }

  function zoom(delta: number) {
    viewport.value.zoom = Math.max(0.2, Math.min(3, viewport.value.zoom + delta))
  }

  function setPipeline(state: Partial<PipelineState>) {
    Object.assign(pipeline.value, state)
  }

  function getDownstream(nodeId: string): CanvasNode[] {
    const targetIds = edges.value.filter((e) => e.sourceId === nodeId).map((e) => e.targetId)
    return nodes.value.filter((n) => targetIds.includes(n.id))
  }

  function getUpstream(nodeId: string): CanvasNode[] {
    const sourceIds = edges.value.filter((e) => e.targetId === nodeId).map((e) => e.sourceId)
    return nodes.value.filter((n) => sourceIds.includes(n.id))
  }

  /** 保存画布状态到项目目录 */
  async function saveState() {
    const projStore = useProjectStore()
    if (!projStore.hasProject) return
    const state = {
      viewport: viewport.value,
      nodes: nodes.value,
      edges: edges.value,
      pipeline: { currentStage: pipeline.value.currentStage, status: 'idle', progress: 0, message: '' },
    }
    projStore.saveToProject('design', '_canvas.json', JSON.stringify(state, null, 2))
  }

  /** 从项目目录加载画布状态 */
  async function loadFromProject() {
    const projStore = useProjectStore()
    if (!projStore.hasProject) {
      loaded.value = true
      return
    }
    // 递增版本号，使之前未完成的加载中止
    const version = ++_loadVersion
    let restored = false
    try {
      const content = await projStore.readFromProject('design', '_canvas.json')
      if (_loadVersion !== version) return // 已被新操作取代，中止
      if (content) {
        const state = JSON.parse(content)
        viewport.value = state.viewport || { x: 0, y: 0, zoom: 1 }
        nodes.value = state.nodes || []
        edges.value = state.edges || []
        if (state.pipeline) {
          // 保留 currentStage 信息用于右上角显示，但状态设为 loaded（非 running）避免触发自动流转
          const stage = state.pipeline.currentStage || 0
          pipeline.value = {
            currentStage: stage,
            status: stage > 0 ? 'completed' : 'idle',
            progress: stage > 0 ? 100 : 0,
            message: stage > 0 ? `已加载项目（Stage ${stage}）` : '',
          }
        }
        // 恢复模块节点中美术资源的 URL（使用静态服务 URL，无需读取文件）
        await restoreAssetUrls(projStore, version)
        if (_loadVersion !== version) return
        restored = nodes.value.length > 0
      }
    } catch { /* 快照损坏，下面尝试从阶段文件重建 */ }

    if (_loadVersion !== version) return
    // 快照缺失或为空时，从 design/modules/assets/code/deploy 各阶段文件重建画布
    if (!restored) {
      await rebuildFromStageFiles(version)
    }
    if (_loadVersion !== version) return
    loaded.value = true
  }

  /**
   * 从项目阶段文件（design/modules/assets/code/deploy）重建画布节点。
   * 当 _canvas.json 不存在/损坏时使用，确保「继续创作」总能加载完整流程。
   */
  async function rebuildFromStageFiles(version?: number) {
    const projStore = useProjectStore()
    if (!projStore.hasProject) return

    // 版本检查辅助函数
    const stale = () => version !== undefined && _loadVersion !== version

    // ─── Stage 1：design/game-design.json → idea 节点 ───
    let design: GameDesign | null = null
    try {
      const txt = await projStore.readFromProject('design', 'game-design.json')
      if (stale()) return
      if (txt) design = JSON.parse(txt) as GameDesign
    } catch {}
    if (stale()) return

    // 没有 design 文件视为空项目，保持空画布让用户从头开始
    if (!design) {
      nodes.value = []
      edges.value = []
      pipeline.value = { currentStage: 0, status: 'idle', progress: 0, message: '' }
      return
    }

    const newNodes: CanvasNode[] = []
    const newEdges: CanvasEdge[] = []
    let lastStage: PipelineState['currentStage'] = 1
    const baseTs = Date.now()

    const ideaId = `idea_${baseTs}`
    const ideaNode: CanvasNode = {
      id: ideaId,
      type: 'idea',
      position: { x: 200, y: 200 },
      size: { width: 360, height: 200 },
      stage: 1,
      status: 'completed',
      data: { userInput: design.gameConcept || '', expandedDesign: design } as IdeaNodeData,
      createdAt: new Date().toISOString(),
    }
    newNodes.push(ideaNode)

    // ─── Stage 2：modules/_overview.json → module 节点 ───
    let modulesData: Array<{ id?: string; name: string; description: string; relatedEntities: string[] }> = []
    try {
      const txt = await projStore.readFromProject('modules', '_overview.json')
      if (stale()) return
      if (txt) {
        const overview = JSON.parse(txt)
        modulesData = overview.modules || []
      }
    } catch {}
    if (stale()) return

    // ─── Stage 3：assets/*.{png,jpg,...} → 收集已生成的实体资源 id → 后缀映射 ───
    const assetExtMap = new Map<string, string>()
    try {
      const files = await projStore.listProjectDir('assets')
      if (stale()) return
      for (const f of files) {
        if (f.isDir || f.name.startsWith('.')) continue
        const m = f.name.match(/^(.+)\.(png|jpe?g|webp|svg)$/i)
        if (m) assetExtMap.set(m[1], m[2].toLowerCase())
      }
    } catch {}
    if (stale()) return

    const moduleIds: string[] = []
    const baseX = ideaNode.position.x + ideaNode.size.width + 180
    const baseY = ideaNode.position.y
    const entities = (design.entities || []) as Array<any>

    let anyAssetDone = false
    modulesData.forEach((mod, i) => {
      const moduleId = `module_${baseTs}_${i}`
      moduleIds.push(moduleId)

      // 根据 relatedEntities 在全局 entities 中查找具体定义，重建模块内的 art assets
      const relatedSet = new Set(mod.relatedEntities || [])
      const entityDefs = entities.filter((e) => relatedSet.has(e.id) || relatedSet.has(e.name))
      const assets: ModuleArtAsset[] = entityDefs.map((e) => {
        const aid = e.id || e.name
        const hasAsset = assetExtMap.has(aid)
        if (hasAsset) anyAssetDone = true
        return {
          id: aid,
          entityName: e.name,
          prompt: e.visuals || '',
          style: design!.suggestedArtStyle || '',
          url: '',
          status: hasAsset ? 'done' : 'idle',
          role: e.role,
          animationType: e.animationType || 'static',
          frameCount: e.frameCount,
          frameWidth: e.frameWidth,
          frameHeight: e.frameHeight,
          tileable: e.tileable,
          facing: e.facing,
          movementDir: e.movementDir,
          scrollDir: e.scrollDir,
          needsVideo: e.needsVideo,
          videoUseCase: e.videoUseCase,
        } as ModuleArtAsset
      })

      newNodes.push({
        id: moduleId,
        type: 'module',
        position: { x: baseX, y: baseY + i * 220 },
        size: { width: 380, height: 280 },
        stage: 2,
        status: 'completed',
        data: {
          name: mod.name,
          description: mod.description,
          relatedEntities: mod.relatedEntities || [],
          userInput: '',
          assets,
          source: 'auto',
        } as ModuleNodeData,
        createdAt: new Date().toISOString(),
      })
      newEdges.push({ id: `edge_idea_${moduleId}`, sourceId: ideaId, targetId: moduleId, type: 'pipeline' })
    })
    if (modulesData.length > 0) lastStage = 2
    if (anyAssetDone) lastStage = 3

    // ─── Stage 4：code/game.js → code 节点 ───
    let codeSource = ''
    try {
      const txt = await projStore.readFromProject('code', 'game.js')
      if (stale()) return
      if (txt) codeSource = txt
    } catch {}
    if (stale()) return

    let codeNodeId = ''
    if (codeSource) {
      codeNodeId = `code_${baseTs}`
      const moduleNodesArr = newNodes.filter((n) => n.type === 'module')
      const lastModule = moduleNodesArr[moduleNodesArr.length - 1]
      const codeX = lastModule ? lastModule.position.x + lastModule.size.width + 180 : baseX + 600
      const codeY = lastModule ? lastModule.position.y : baseY
      newNodes.push({
        id: codeNodeId,
        type: 'code',
        position: { x: codeX, y: codeY },
        size: { width: 360, height: 240 },
        stage: 4,
        status: 'completed',
        data: {
          codeType: 'frontend',
          fileName: 'game.js',
          language: 'javascript',
          source: codeSource,
          buildStatus: 'success',
          history: [],
          activeVersionId: undefined,
          optimizeInstruction: '',
        } as CodeNodeData,
        createdAt: new Date().toISOString(),
      })
      moduleIds.forEach((mid) =>
        newEdges.push({ id: `edge_${mid}_${codeNodeId}`, sourceId: mid, targetId: codeNodeId, type: 'pipeline' })
      )
      lastStage = 4
    }

    // ─── Stage 5：deploy/game.html → deploy 节点 ───
    let html = ''
    try {
      const txt = await projStore.readFromProject('deploy', 'game.html')
      if (stale()) return
      if (txt) html = txt
    } catch {}
    if (stale()) return

    if (html && codeNodeId) {
      const blob = new Blob([html], { type: 'text/html' })
      const blobUrl = URL.createObjectURL(blob)
      const codeNodeRef = newNodes.find((n) => n.id === codeNodeId)!
      const deployHeight = 500
      const deployY = codeNodeRef.position.y + codeNodeRef.size.height / 2 - deployHeight / 2
      const deployId = `deploy_${baseTs}`
      newNodes.push({
        id: deployId,
        type: 'deploy',
        position: { x: codeNodeRef.position.x + codeNodeRef.size.width + 80, y: deployY },
        size: { width: 420, height: deployHeight },
        stage: 5,
        status: 'completed',
        data: {
          platform: 'web',
          htmlBlobUrl: blobUrl,
          fileName: 'game.html',
          bundleSize: html.length,
          testResults: [],
        } as DeployNodeData,
        createdAt: new Date().toISOString(),
      })
      newEdges.push({ id: `edge_${codeNodeId}_${deployId}`, sourceId: codeNodeId, targetId: deployId, type: 'pipeline' })
      lastStage = 5
    }

    nodes.value = newNodes
    edges.value = newEdges
    pipeline.value = {
      currentStage: lastStage,
      status: 'completed',
      progress: 100,
      message: lastStage >= 5 ? '已加载完整项目' : `已加载到 Stage ${lastStage}`,
    }

    // 恢复模块节点中美术资源的 dataUrl
    await restoreAssetUrls(projStore, version)
  }

  /** 从项目 assets 目录构建静态 URL，恢复模块节点的 asset.url（无需读取文件内容） */
  async function restoreAssetUrls(projStore: ReturnType<typeof useProjectStore>, version?: number) {
    const stale = () => version !== undefined && _loadVersion !== version
    const authStore = useAuthStore()
    const username = authStore.username
    const projectName = projStore.projectName
    if (!username || !projectName) return

    // 一次性列出 assets 目录，构建 id → 扩展名映射
    let assetExtMap: Map<string, string>
    try {
      const files = await projStore.listProjectDir('assets')
      if (stale()) return
      assetExtMap = new Map()
      for (const f of files) {
        if (f.isDir || f.name.startsWith('.')) continue
        const m = f.name.match(/^(.+)\.(png|jpe?g|webp|svg)$/i)
        if (m) assetExtMap.set(m[1], f.name)
      }
    } catch { return }
    if (stale()) return

    // 遍历所有模块节点，为 done 状态的资源构建静态服务 URL
    const moduleNodes = nodes.value.filter((n) => n.type === 'module')
    let anyChanged = false
    for (const node of moduleNodes) {
      const assets = node.data?.assets as Array<{ id: string; url: string; status: string }> | undefined
      if (!assets?.length) continue
      let changed = false
      for (const asset of assets) {
        if (asset.status !== 'done') continue
        const fileName = assetExtMap.get(asset.id)
        if (fileName) {
          const newUrl = `/__asset/${username}/${projectName}/assets/${fileName}`
          if (asset.url !== newUrl) {
            asset.url = newUrl
            changed = true
          }
        }
      }
      if (changed) {
        anyChanged = true
        const idx = nodes.value.findIndex((n) => n.id === node.id)
        if (idx >= 0) nodes.value[idx] = { ...node }
      }
    }
  }

  /** 初始化：加载并开始自动保存 */
  async function hydrateFromStorage() {
    await loadFromProject()
    // 变更后自动保存到项目目录（节流）
    let timer: ReturnType<typeof setTimeout> | null = null
    watch(
      [viewport, nodes, edges],
      () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => saveState(), 1500)
      },
      { deep: true }
    )
  }

  /** 清空画布（同时使任何正在进行的异步加载失效） */
  function clearCanvas() {
    ++_loadVersion // 中止任何正在进行的异步加载
    nodes.value = []
    edges.value = []
    selectedNodeId.value = null
    pipeline.value = { currentStage: 0, status: 'idle', progress: 0, message: '' }
    viewport.value = { x: 0, y: 0, zoom: 1 }
  }

  return {
    viewport, nodes, edges, selectedNodeId, selectedNode, pipeline, loaded,
    addNode, updateNode, removeNode, addEdge, selectNode, moveNode,
    setViewport, zoom, setPipeline, getDownstream, getUpstream,
    hydrateFromStorage, loadFromProject, rebuildFromStageFiles, clearCanvas, saveState,
  }
})
