<template>
  <div
    class="canvas-engine"
    ref="canvasEl"
    @wheel.prevent="onWheel"
    @mousedown="onCanvasMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @dblclick="onDoubleClick"
  >
    <div class="canvas-grid" :style="gridStyle"></div>

    <div class="canvas-transform" :style="transformStyle">
      <svg class="edges-layer" :style="svgStyle">
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1" opacity="0.7" />
          </marker>
        </defs>
        <path
          v-for="edge in store.edges"
          :key="edge.id"
          :d="getEdgePath(edge)"
          class="edge-path"
          :class="{ active: isEdgeActive(edge) }"
          marker-end="url(#arrowhead)"
        />
      </svg>

      <component
        v-for="node in store.nodes"
        :key="node.id"
        :is="getNodeComponent(node.type)"
        :node="node"
        :selected="store.selectedNodeId === node.id"
        @mousedown.stop="onNodeMouseDown(node, $event)"
        @dblclick.stop="onNodeDblClick(node)"
        @select="store.selectNode(node.id)"
        @trigger="onTriggerPipeline(node)"
      />
    </div>

    <!-- 自动流转倒计时提示 -->
    <Transition name="countdown-fade">
      <div v-if="countdown > 0" class="auto-advance-toast">
        <span class="toast-icon">⏳</span>
        <span class="toast-text">将在 <strong>{{ countdown }}s</strong> 后自动进入下一阶段</span>
        <button class="toast-skip" @click="skipAutoAdvance">立即跳转</button>
        <button class="toast-cancel" @click="cancelAutoAdvance">取消</button>
      </div>
    </Transition>

    <div v-if="!store.nodes.length" class="empty-hint">
      <div class="hint-content">
        <div class="hint-icon">
          <el-icon :size="48"><MagicStick /></el-icon>
        </div>
        <h2>双击画布开始创作</h2>
        <p>双击创建「创意节点」，输入游戏想法，AI 全自动完成 5 阶段流水线</p>
        <div class="hint-steps">
          <span class="step" style="--c: var(--stage-1)">1. 玩法创意</span>
          <span class="arrow">→</span>
          <span class="step" style="--c: var(--stage-2)">2. 模块拆分</span>
          <span class="arrow">→</span>
          <span class="step" style="--c: var(--stage-3)">3. 美术生成</span>
          <span class="arrow">→</span>
          <span class="step" style="--c: var(--stage-4)">4. 代码生成</span>
          <span class="arrow">→</span>
          <span class="step" style="--c: var(--stage-5)">5. 部署测试</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onBeforeUnmount } from 'vue'
import { useCanvasStore } from '@/stores/canvas'
import type { CanvasNode, CanvasEdge } from '@/types'
import IdeaNode from '@/nodes/IdeaNode.vue'
import ModuleNode from '@/nodes/ModuleNode.vue'
import AssetNode from '@/nodes/AssetNode.vue'
import CodeNode from '@/nodes/CodeNode.vue'
import DeployNode from '@/nodes/DeployNode.vue'
import { addManualModule, runStage4_code, runStage5_deploy, generateAllArt, autoBreakdownModules } from '@/api/pipeline'
import { useProjectStore } from '@/stores/project'

const store = useCanvasStore()
const canvasEl = ref<HTMLElement>()

const isPanning = ref(false)
const isDragging = ref(false)
const dragNodeId = ref<string | null>(null)
const lastMouse = ref({ x: 0, y: 0 })

const transformStyle = computed(() => ({
  transform: `translate(${store.viewport.x}px, ${store.viewport.y}px) scale(${store.viewport.zoom})`,
  transformOrigin: '0 0',
}))

const gridStyle = computed(() => {
  const size = 50 * store.viewport.zoom
  const ox = store.viewport.x % size
  const oy = store.viewport.y % size
  return { backgroundSize: `${size}px ${size}px`, backgroundPosition: `${ox}px ${oy}px` }
})

const svgStyle = computed(() => ({
  width: '10000px', height: '10000px', left: '-5000px', top: '-5000px',
}))

function getNodeComponent(type: string) {
  const map: Record<string, any> = { idea: IdeaNode, module: ModuleNode, asset: AssetNode, code: CodeNode, deploy: DeployNode }
  return map[type] || IdeaNode
}

function getEdgePath(edge: CanvasEdge) {
  const source = store.nodes.find((n) => n.id === edge.sourceId)
  const target = store.nodes.find((n) => n.id === edge.targetId)
  if (!source || !target) return ''
  const sx = source.position.x + source.size.width + 5000
  const sy = source.position.y + source.size.height / 2 + 5000
  const tx = target.position.x + 5000
  const ty = target.position.y + target.size.height / 2 + 5000
  const cx = (sx + tx) / 2
  return `M ${sx} ${sy} C ${cx} ${sy}, ${cx} ${ty}, ${tx} ${ty}`
}

function isEdgeActive(edge: CanvasEdge) {
  return store.selectedNodeId === edge.sourceId || store.selectedNodeId === edge.targetId
}

function onWheel(e: WheelEvent) {
  const delta = e.deltaY > 0 ? -0.08 : 0.08
  store.zoom(delta)
}

function onCanvasMouseDown(e: MouseEvent) {
  if (e.button === 0 || e.button === 1) {
    isPanning.value = true
    lastMouse.value = { x: e.clientX, y: e.clientY }
    store.selectNode(null)
  }
}

function onNodeMouseDown(node: CanvasNode, e: MouseEvent) {
  store.selectNode(node.id)
  isDragging.value = true
  dragNodeId.value = node.id
  lastMouse.value = { x: e.clientX, y: e.clientY }
}

function onMouseMove(e: MouseEvent) {
  if (isPanning.value) {
    const dx = e.clientX - lastMouse.value.x
    const dy = e.clientY - lastMouse.value.y
    store.setViewport(store.viewport.x + dx, store.viewport.y + dy)
    lastMouse.value = { x: e.clientX, y: e.clientY }
  } else if (isDragging.value && dragNodeId.value) {
    const dx = (e.clientX - lastMouse.value.x) / store.viewport.zoom
    const dy = (e.clientY - lastMouse.value.y) / store.viewport.zoom
    const node = store.nodes.find((n) => n.id === dragNodeId.value)
    if (node) {
      store.moveNode(dragNodeId.value, node.position.x + dx, node.position.y + dy)
    }
    lastMouse.value = { x: e.clientX, y: e.clientY }
  }
}

function onMouseUp() {
  isPanning.value = false
  isDragging.value = false
  dragNodeId.value = null
}

function onDoubleClick(e: MouseEvent) {
  const projStore = useProjectStore()

  // 若无项目，先自动创建项目
  if (!projStore.hasProject) {
    projStore.createProject()
  }

  // 已存在创意节点时不再新建
  if (store.nodes.some((n) => n.type === 'idea')) return

  const rect = canvasEl.value!.getBoundingClientRect()
  const x = (e.clientX - rect.left - store.viewport.x) / store.viewport.zoom
  const y = (e.clientY - rect.top - store.viewport.y) / store.viewport.zoom
  const newNode: CanvasNode = {
    id: `idea_${Date.now()}`,
    type: 'idea',
    position: { x: x - 160, y: y - 80 },
    size: { width: 360, height: 200 },
    stage: 1,
    status: 'idle',
    data: { userInput: '', expandedDesign: null },
    createdAt: new Date().toISOString(),
  }
  store.addNode(newNode)
  store.selectNode(newNode.id)
}

/** 双击节点：IdeaNode 时添加手动模块 */
function onNodeDblClick(node: CanvasNode) {
  if (node.type === 'idea' && node.status === 'completed') {
    addManualModule(node)
  }
}

function onTriggerPipeline(node: CanvasNode) {
  // 模块节点触发 → 生成代码
  if (node.type === 'module') runStage4_code(node)
  // 代码节点触发 → 部署
  else if (node.type === 'code' && node.status === 'completed') runStage5_deploy(node)
}

/* ─── 自动流转：阶段完成后 30s 未操作则自动进入下一阶段 ─── */
const AUTO_ADVANCE_DELAY = 30_000 // 30 秒
const TICK_INTERVAL = 1_000
let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null
let countdownInterval: ReturnType<typeof setInterval> | null = null
const countdown = ref(0) // 倒计时秒数（0 = 隐藏）
let pendingStage = 0

function clearAutoAdvance() {
  if (autoAdvanceTimer) {
    clearTimeout(autoAdvanceTimer)
    autoAdvanceTimer = null
  }
  if (countdownInterval) {
    clearInterval(countdownInterval)
    countdownInterval = null
  }
  countdown.value = 0
  pendingStage = 0
}

function doAdvance(stage: number) {
  if (stage === 1) {
    const ideaNode = store.nodes.find((n) => n.type === 'idea' && n.data?.expandedDesign)
    if (ideaNode) autoBreakdownModules(ideaNode)
  } else if (stage === 2) {
    generateAllArt()
  } else if (stage === 3) {
    const moduleNode = store.nodes.find((n) => n.type === 'module')
    if (moduleNode) runStage4_code(moduleNode)
  } else if (stage === 4) {
    const codeNode = store.nodes.find((n) => n.type === 'code' && n.status === 'completed')
    if (codeNode) runStage5_deploy(codeNode)
  }
}

function scheduleAutoAdvance(stage: number) {
  clearAutoAdvance()
  pendingStage = stage
  countdown.value = Math.round(AUTO_ADVANCE_DELAY / 1000)

  countdownInterval = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      clearInterval(countdownInterval!)
      countdownInterval = null
    }
  }, TICK_INTERVAL)

  autoAdvanceTimer = setTimeout(() => {
    autoAdvanceTimer = null
    clearAutoAdvance()
    const p = store.pipeline
    if (p.status !== 'completed' || p.currentStage !== stage) return
    doAdvance(stage)
  }, AUTO_ADVANCE_DELAY)
}

/** 立即跳转 */
function skipAutoAdvance() {
  const stage = pendingStage
  clearAutoAdvance()
  doAdvance(stage)
}

/** 取消自动流转 */
function cancelAutoAdvance() {
  clearAutoAdvance()
}

watch(
  () => ({ stage: store.pipeline.currentStage, status: store.pipeline.status }),
  (newVal, oldVal) => {
    // 只在真正的阶段完成（running → completed）时触发自动流转
    // 加载项目时直接设为 completed 不应触发
    if (newVal.status === 'completed' && oldVal?.status === 'running' && newVal.stage >= 1 && newVal.stage <= 4) {
      scheduleAutoAdvance(newVal.stage)
    } else if (newVal.status === 'running') {
      clearAutoAdvance()
    }
  }
)

onUnmounted(() => clearAutoAdvance())
</script>

<style lang="scss" scoped>
.canvas-engine {
  width: 100%; height: 100%; position: relative;
  cursor: grab; overflow: hidden;
  &:active { cursor: grabbing; }
}

.canvas-grid {
  position: absolute; inset: 0;
  background-image: radial-gradient(circle, rgba(99, 102, 241, 0.15) 1px, transparent 1px);
  pointer-events: none;
}

.canvas-transform {
  position: absolute; top: 0; left: 0; width: 0; height: 0;
}

.edges-layer {
  position: absolute; pointer-events: none; overflow: visible;
}

.edge-path {
  fill: none; stroke: rgba(99, 102, 241, 0.35); stroke-width: 2;
  transition: stroke 0.2s;
  &.active { stroke: var(--primary); stroke-width: 3; }
}

.empty-hint {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}

.hint-content { text-align: center; opacity: 0.75; }
.hint-icon { margin-bottom: 16px; color: var(--primary); }
.hint-content h2 { font-size: 22px; margin-bottom: 8px; }
.hint-content p { font-size: 14px; color: var(--text-secondary); margin-bottom: 24px; }

.hint-steps {
  display: flex; align-items: center; gap: 8px; justify-content: center; flex-wrap: wrap;
}

.step {
  padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 500;
  background: color-mix(in srgb, var(--c) 15%, transparent);
  color: var(--c);
  border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
}

.arrow { color: var(--text-muted); font-size: 16px; }

/* ─── 自动流转倒计时提示 ─── */
.auto-advance-toast {
  position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px;
  padding: 10px 18px; border-radius: 12px;
  background: rgba(15, 15, 30, 0.92);
  border: 1px solid rgba(99, 102, 241, 0.3);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  z-index: 100; pointer-events: auto;
  font-size: 13px; color: #e2e8f0;
}
.toast-icon { font-size: 18px; }
.toast-text strong {
  color: #a5b4fc; font-variant-numeric: tabular-nums;
}
.toast-skip, .toast-cancel {
  padding: 4px 10px; border-radius: 6px; border: none;
  font-size: 12px; cursor: pointer; font-weight: 500;
  transition: background 0.15s;
}
.toast-skip {
  background: rgba(99, 102, 241, 0.25); color: #a5b4fc;
  &:hover { background: rgba(99, 102, 241, 0.4); }
}
.toast-cancel {
  background: rgba(255, 255, 255, 0.06); color: #9ca3af;
  &:hover { background: rgba(255, 255, 255, 0.12); }
}

.countdown-fade-enter-active,
.countdown-fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.countdown-fade-enter-from,
.countdown-fade-leave-to {
  opacity: 0; transform: translateX(-50%) translateY(10px);
}
</style>
