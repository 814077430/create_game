<template>
  <div ref="rootRef" class="node deploy-node" :class="{ selected, processing: isFixing }">
    <div class="node-header stage-5">
      <span class="node-icon">🚀</span>
      <span class="node-title">部署 / 测试</span>
      <span class="node-status">{{ statusLabel }}</span>
    </div>
    <div class="node-body">
      <div class="test-results" v-if="node.data.testResults">
        <div
          v-for="t in node.data.testResults"
          :key="t.name"
          class="test-item"
          :class="t.status"
        >
          <span class="test-icon">{{ t.status === 'pass' ? '✓' : t.status === 'warn' ? '⚠' : '✗' }}</span>
          <span class="test-name">{{ t.name }}</span>
          <span class="test-value">{{ t.value }}</span>
        </div>
      </div>

      <!-- 内嵌游戏预览 iframe（手机屏幕样式） -->
      <div class="game-preview" v-if="node.data.htmlBlobUrl && showPreview" @click.stop>
        <div class="preview-toolbar">
          <span class="preview-spec">{{ realSize ? DEVICE.label : '缩略预览' }} · {{ frameW }}×{{ frameH }}</span>
          <button class="btn-link" @click.stop="realSize = !realSize">
            {{ realSize ? '⤡ 缩略' : '⤢ 真机 1:1' }}
          </button>
        </div>
        <div class="phone-frame" :class="{ landscape: isLandscape }">
          <div class="phone-notch"></div>
          <div class="phone-screen">
            <iframe ref="gameFrame" :src="node.data.htmlBlobUrl" sandbox="allow-scripts allow-same-origin" />
          </div>
          <div class="phone-home"></div>
        </div>
      </div>

      <!-- 运行时错误展示 -->
      <div class="runtime-errors" v-if="runtimeErrors.length" @click.stop>
        <div class="err-header">
          <span class="err-badge">⚠ {{ runtimeErrors.length }} 个运行时错误</span>
          <span class="err-actions">
            <button class="btn-link" @click.stop="copyErrorsToClipboard">📋 复制报错</button>
            <button class="btn-link" @click.stop="autoPasteErrors">🔧 一键填入修复</button>
          </span>
        </div>
        <div class="err-list">
          <div class="err-item" v-for="(e, i) in runtimeErrors.slice(0, 5)" :key="i">• {{ e }}</div>
          <div class="err-item more" v-if="runtimeErrors.length > 5">…还有 {{ runtimeErrors.length - 5 }} 个错误</div>
        </div>
      </div>

      <div class="deploy-actions" v-if="node.data.htmlBlobUrl">
        <button class="btn btn-sm btn-primary" @click.stop="togglePreview">
          {{ showPreview ? '⏹ 关闭预览' : '▶ 试玩' }}
        </button>
        <a class="btn btn-sm btn-secondary" :href="node.data.htmlBlobUrl" target="_blank">↗ 新窗口</a>
        <a class="btn btn-sm btn-secondary" :href="node.data.htmlBlobUrl" :download="node.data.fileName || 'game.html'">💾 下载</a>
        <button class="btn btn-sm btn-fix" @click.stop="showFixPanel = !showFixPanel" :disabled="isFixing">
          🛠 修复代码
        </button>
        <button class="btn btn-sm btn-layout" @click.stop="openLayoutEditor" :disabled="isFixing">
          ✥ 布局编辑
        </button>
      </div>

      <!-- 修复/优化面板 -->
      <div class="fix-panel" v-if="showFixPanel" @click.stop>
        <!-- 报错信息粘贴区 -->
        <div class="fix-section">
          <label class="fix-label">📋 报错信息（粘贴控制台错误或运行时报错）：</label>
          <textarea
            class="fix-input fix-error-input"
            v-model="errorPaste"
            placeholder="粘贴浏览器控制台报错、运行时错误信息…&#10;例如：TypeError: Cannot read property 'x' of undefined&#10;      Uncaught ReferenceError: player is not defined"
            :disabled="isFixing"
          />
        </div>
        <!-- 修复说明 -->
        <div class="fix-section">
          <label class="fix-label">🛠 补充说明（可选，描述游戏运行问题）：</label>
          <textarea
            ref="fixTextarea"
            class="fix-input"
            v-model="fixInput"
            placeholder="例如：打开游戏黑屏、角色不会移动、碰撞检测失效…"
            :disabled="isFixing"
            @keydown.ctrl.enter="runCustomFix"
          />
        </div>
        <!-- 快捷问题标签 -->
        <div class="fix-presets">
          <button
            v-for="preset in fixPresets"
            :key="preset.label"
            class="fix-preset-tag"
            @click="runFix(preset.instruction)"
            :disabled="isFixing"
          >
            {{ preset.icon }} {{ preset.label }}
          </button>
        </div>
        <div class="fix-actions">
          <button class="btn btn-sm btn-fix-submit" @click="runCustomFix" :disabled="(!fixInput.trim() && !errorPaste.trim()) || isFixing">
            🚀 AI 修复
          </button>
          <span class="fix-tip" v-if="isFixing">修复完成后将自动重新部署…</span>
          <button class="btn btn-sm btn-ghost" @click="showFixPanel = false" :disabled="isFixing">取消</button>
        </div>
      </div>
    </div>

    <!-- 游戏内可视化布局编辑（1:1 真机浮层） -->
    <LayoutEditor
      :visible="showLayoutEditor"
      :source-url="node.data.htmlBlobUrl"
      :is-landscape="isLandscape"
      @close="showLayoutEditor = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import type { CanvasNode } from '@/types'
import { useCanvasStore } from '@/stores/canvas'
import { useProjectStore } from '@/stores/project'
import { optimizeCode } from '@/api/pipeline'
import { orientationFromDesign } from '@/api/prompts'
import type { OptimizeCodeOptions } from '@/api/pipeline'
import { ElMessage } from 'element-plus'
import LayoutEditor from '@/panels/LayoutEditor.vue'
import { getDevice, DEFAULT_DEVICE_ID } from '@/api/liveEdit'

const props = defineProps<{ node: CanvasNode; selected: boolean }>()
defineEmits<{ (e: 'select'): void; (e: 'trigger', node: CanvasNode): void }>()

const store = useCanvasStore()
const projStore = useProjectStore()
const showFixPanel = ref(false)
const showPreview = ref(false)
const showLayoutEditor = ref(false)
/** 预览框按真机 1:1 呈现（默认开启，方便直接在真实尺寸下调布局） */
const realSize = ref(true)
const fixInput = ref('')
const errorPaste = ref('')
const fixTextarea = ref<HTMLTextAreaElement | null>(null)
const isFixing = ref(false)
const runtimeErrors = ref<string[]>([])
const gameFrame = ref<HTMLIFrameElement | null>(null)
const rootRef = ref<HTMLDivElement | null>(null)
let resizeObserver: ResizeObserver | null = null

const statusLabel = computed(() => {
  if (isFixing.value) return '修复中…'
  return props.node.status === 'completed' ? '已就绪' : '处理中'
})

// 预览画面方向：优先取创意节点设计文档反推，其次项目设置
const isLandscape = computed(() => {
  const ideaNode = store.nodes.find((n) => n.type === 'idea' && n.data?.expandedDesign)
  if (ideaNode?.data?.expandedDesign) {
    return orientationFromDesign(ideaNode.data.expandedDesign) === 'landscape'
  }
  return projStore.orientation === 'landscape'
})

// 预览框尺寸：真机模式 = iPhone 17 Pro Max 逻辑分辨率 1:1；缩略模式保持原来的小窗
const DEVICE = getDevice(DEFAULT_DEVICE_ID)
const SMALL_W = 200
const frameW = computed(() => {
  if (!realSize.value) return isLandscape.value ? Math.round((SMALL_W * DEVICE.height) / DEVICE.width) : SMALL_W
  return isLandscape.value ? DEVICE.height : DEVICE.width
})
const frameH = computed(() => {
  if (!realSize.value) return isLandscape.value ? SMALL_W : Math.round((SMALL_W * DEVICE.height) / DEVICE.width)
  return isLandscape.value ? DEVICE.width : DEVICE.height
})
/** 手机外壳内边距（屏幕之外的黑边） */
const BEZEL = 10
const shellW = computed(() => frameW.value + BEZEL * 2)
const shellH = computed(() => frameH.value + BEZEL * 2)
/** 节点宽度随预览框放大，避免真机 1:1 时溢出 */
const nodeWidth = computed(() => (showPreview.value ? Math.max(420, shellW.value + 24) : 420))
/** 真机 1:1 时解除高度上限，否则维持原来的滚动区上限 */
const nodeMaxHeight = computed(() => (showPreview.value && realSize.value ? 'none' : '600px'))
const screenRadius = computed(() => (realSize.value ? DEVICE.radius - BEZEL : 18))

function openLayoutEditor() {
  if (!props.node.data.htmlBlobUrl) {
    ElMessage.error('请先完成部署阶段')
    return
  }
  showLayoutEditor.value = true
}

// 监听 htmlBlobUrl 变化（自动重新部署后），清空旧错误
watch(() => props.node.data.htmlBlobUrl, () => {
  runtimeErrors.value = []
})

// 监听来自 iframe 的错误 postMessage
function onGameMessage(e: MessageEvent) {
  if (e.data?.type === 'gameforge-error' && e.data.error) {
    if (!runtimeErrors.value.includes(e.data.error)) {
      runtimeErrors.value.push(e.data.error)
    }
  }
}
onMounted(() => {
  window.addEventListener('message', onGameMessage)
  // 动态同步节点实际尺寸到 store，使连接箭头始终指向真实中心（真机 1:1 预览时宽度也会变）
  if (rootRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      const box = entries[0].contentRect
      const h = Math.round(box.height)
      const w = Math.round(box.width)
      const dh = Math.abs((props.node.size?.height ?? 0) - h)
      const dw = Math.abs((props.node.size?.width ?? 0) - w)
      if ((h > 0 && dh > 2) || (w > 0 && dw > 2)) {
        store.updateNode(props.node.id, { size: { width: w > 0 ? w : props.node.size.width, height: h > 0 ? h : props.node.size.height } })
      }
    })
    resizeObserver.observe(rootRef.value)
  }
})
onUnmounted(() => {
  window.removeEventListener('message', onGameMessage)
  resizeObserver?.disconnect()
  resizeObserver = null
})

// 常见运行问题快捷预设
const fixPresets = [
  { label: '黑屏修复', icon: '🖥️', instruction: '游戏打开后完全黑屏无任何画面。请检查：1) Phaser config 是否正确（parent、width/height、scene 配置）；2) 是否有 preload 或 create 函数中的异常导致场景未启动；3) 资源加载是否失败阻塞了 create；4) 是否有未定义变量或语法错误导致脚本中断。逐一修复所有可能导致黑屏的问题。' },
  { label: '白屏/卡死', icon: '⚪', instruction: '游戏白屏或卡在加载界面不动。检查是否有死循环、资源路径错误、preload 完成但 create 未被调用的问题。' },
  { label: '画面异常', icon: '🎨', instruction: '画面可以显示但是元素位置错误、大小异常或超出画面范围。检查坐标系、锚点设置、缩放比例。' },
  { label: '操作失灵', icon: '🕹️', instruction: '游戏画面正常但无法操作（键盘/鼠标/触屏无响应）。检查输入事件绑定是否正确，是否在正确的 scene 生命周期中注册。' },
  { label: '碰撞失效', icon: '💥', instruction: '碰撞检测不触发或异常触发。检查物理引擎配置、碰撞体设置、overlap/collider 是否正确使用。' },
]

function togglePreview() {
  showPreview.value = !showPreview.value
  if (showPreview.value) {
    runtimeErrors.value = []
  }
}

function findCodeNode(): CanvasNode | undefined {
  return store.nodes.find((n) => n.type === 'code' && n.status === 'completed')
}

// 将运行时错误一键粘贴到报错输入框
function autoPasteErrors() {
  const errText = runtimeErrors.value.slice(0, 8).map((e) => `• ${e}`).join('\n')
  errorPaste.value = errText
  showFixPanel.value = true
}

// 将运行时错误复制到剪贴板
function copyErrorsToClipboard() {
  const errText = runtimeErrors.value.map((e) => e).join('\n')
  navigator.clipboard.writeText(errText).then(() => {
    ElMessage.success('报错信息已复制到剪贴板')
  }).catch(() => {
    // fallback: 选中文本方式
    const textarea = document.createElement('textarea')
    textarea.value = errText
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    ElMessage.success('报错信息已复制到剪贴板')
  })
}

async function runFix(instruction: string) {
  const codeNode = findCodeNode()
  if (!codeNode) {
    ElMessage.error('找不到已完成的代码节点')
    return
  }
  isFixing.value = true

  // 预设按钮修复也附带当前捕获的运行时报错，让 AI 有更多上下文
  const currentErrors = runtimeErrors.value.slice(0, 10)
  runtimeErrors.value = []

  try {
    const fixOpts: OptimizeCodeOptions = {
      instruction,
      runtimeErrors: currentErrors.length > 0 ? currentErrors : undefined,
    }
    await optimizeCode(codeNode, fixOpts)
    // optimizeCode 成功后会自动触发 runStage5_deploy
  } finally {
    isFixing.value = false
  }
}

async function runCustomFix() {
  const errors = errorPaste.value.trim()
  const desc = fixInput.value.trim()
  if (!errors && !desc) return

  const codeNode = findCodeNode()
  if (!codeNode) {
    ElMessage.error('找不到已完成的代码节点')
    return
  }

  // 解析报错信息为数组
  const errorLines: string[] = errors
    ? errors.split('\n').map(line => line.replace(/^[•\-]\s*/, '').trim()).filter(Boolean)
    : []

  const fixOpts: OptimizeCodeOptions = {
    runtimeErrors: errorLines.length > 0 ? errorLines : undefined,
    description: desc || undefined,
  }

  errorPaste.value = ''
  fixInput.value = ''
  showFixPanel.value = false

  isFixing.value = true
  runtimeErrors.value = []
  try {
    await optimizeCode(codeNode, fixOpts)
  } finally {
    isFixing.value = false
  }
}
</script>

<style lang="scss" scoped>
.deploy-node {
  width: v-bind('nodeWidth + "px"'); min-height: 120px; max-height: v-bind('nodeMaxHeight'); position: absolute;
  left: v-bind('node.position.x + "px"'); top: v-bind('node.position.y + "px"');
  border-radius: 12px; background: var(--node-bg, #1a1a2e);
  border: 2px solid var(--stage-5, #ef4444);
  box-shadow: 0 4px 20px rgba(0,0,0,0.3); font-size: 12px;
  user-select: none; cursor: pointer;
  display: flex; flex-direction: column; overflow: hidden;
  &.selected { box-shadow: 0 0 0 3px rgba(239,68,68,0.3); }
  &.processing { border-color: rgba(239,68,68,0.5); animation: pulse-fix 1.5s infinite; }
}
@keyframes pulse-fix {
  0%, 100% { border-color: rgba(239,68,68,0.5); }
  50% { border-color: rgba(239,68,68,1); }
}
.node-header { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); font-weight: 600; }
.node-icon { font-size: 14px; }
.node-title { flex: 1; color: var(--text-primary, #e2e8f0); }
.node-status { font-size: 10px; color: var(--text-muted, #64748b); }
.node-body {
  padding: 10px 12px;
  flex: 1; min-height: 0;
  overflow-y: auto;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
  &::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
}
.test-results { margin-bottom: 8px; }
.test-item {
  display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 11px;
  &.pass .test-icon { color: #10b981; }
  &.warn .test-icon { color: #f59e0b; }
  &.fail .test-icon { color: #ef4444; }
}
.test-name { flex: 1; color: #e2e8f0; }
.test-value { color: var(--text-muted); }

.game-preview {
  margin: 8px 0;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.preview-toolbar {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
}
.preview-spec { font-size: 10px; color: #94a3b8; }
.phone-frame {
  position: relative;
  width: v-bind('shellW + "px"');
  height: v-bind('shellH + "px"');
  background: #1a1a1f;
  border-radius: v-bind('(realSize ? DEVICE.radius : 26) + "px"');
  padding: v-bind('BEZEL + "px"');
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.08),
    0 8px 24px rgba(0,0,0,0.55);
  box-sizing: border-box;
}
/* 横版预览：手机横过来，划块/首条跟着旋转 */
.phone-frame.landscape {
  .phone-notch {
    top: 50%; left: 6px; transform: translateY(-50%);
    width: 14px; height: 60px;
    border-radius: 0 10px 10px 0;
  }
  .phone-home {
    bottom: 50%; left: auto; right: 4px; transform: translateY(50%);
    width: 3px; height: 56px;
  }
}
.phone-notch {
  position: absolute;
  top: 6px; left: 50%; transform: translateX(-50%);
  width: 60px; height: 14px;
  background: #000; border-radius: 0 0 10px 10px;
  z-index: 2;
}
.phone-home {
  position: absolute;
  bottom: 4px; left: 50%; transform: translateX(-50%);
  width: 56px; height: 3px;
  background: rgba(255,255,255,0.35); border-radius: 2px;
}
.phone-screen {
  width: 100%; height: 100%;
  border-radius: v-bind('screenRadius + "px"');
  overflow: hidden;
  background: #0a0a12;
  iframe {
    width: 100%; height: 100%;
    border: none;
    display: block;
    background: #0a0a12;
  }
}

.runtime-errors {
  margin: 8px 0; padding: 8px;
  background: rgba(239,68,68,0.06); border-radius: 6px;
  border: 1px solid rgba(239,68,68,0.2);
}
.err-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;
}
.err-actions { display: flex; gap: 6px; }
.err-badge { font-size: 11px; color: #f87171; font-weight: 600; }
.err-list { max-height: 80px; overflow-y: auto; }
.err-item { font-size: 10px; color: #fda4af; line-height: 1.5; }
.err-item.more { color: #94a3b8; font-style: italic; }

.btn-link {
  background: none; border: none; cursor: pointer; font-size: 10px;
  color: #67e8f9; padding: 2px 6px; border-radius: 4px;
  &:hover { background: rgba(103,232,249,0.1); }
}

.deploy-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.btn { border: none; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 500; text-decoration: none; transition: all 0.15s; display: inline-block;
  &:hover { transform: translateY(-1px); }
  &:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
}
.btn-sm { padding: 5px 10px; }
.btn-primary { background: #6366f1; color: #fff; &:hover { background: #4f46e5; } }
.btn-secondary { background: rgba(255,255,255,0.08); color: #e2e8f0; &:hover { background: rgba(255,255,255,0.15); } }
.btn-fix { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.3); &:hover { background: rgba(239,68,68,0.22); } }
.btn-layout { background: rgba(236,72,153,0.14); color: #f9a8d4; border: 1px solid rgba(236,72,153,0.35); &:hover { background: rgba(236,72,153,0.24); } }
.btn-fix-submit { background: rgba(239,68,68,0.2); color: #fca5a5; border: 1px solid rgba(239,68,68,0.4); &:hover { background: rgba(239,68,68,0.35); } }
.btn-ghost { background: none; color: var(--text-muted, #64748b); &:hover { color: #e2e8f0; } }

.fix-panel {
  margin-top: 10px; padding: 10px;
  background: rgba(239,68,68,0.04); border-radius: 8px;
  border: 1px solid rgba(239,68,68,0.15);
}
.fix-section { margin-bottom: 8px; }
.fix-label {
  display: block; font-size: 10px; color: #f87171; font-weight: 500; margin-bottom: 4px;
}
.fix-presets {
  display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;
}
.fix-preset-tag {
  padding: 3px 8px; font-size: 10px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px; color: #e2e8f0;
  cursor: pointer; transition: all 0.15s;
  &:hover { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.4); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
.fix-input-row { margin-bottom: 8px; }
.fix-input {
  width: 100%; min-height: 48px; resize: vertical; box-sizing: border-box;
  padding: 6px 8px;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; color: #e2e8f0; font-size: 11px;
  outline: none; font-family: inherit; line-height: 1.4;
  &:focus { border-color: rgba(239,68,68,0.5); }
  &::placeholder { color: #64748b; }
  &:disabled { opacity: 0.6; }
}
.fix-error-input {
  min-height: 72px; font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: #fda4af;
}
.fix-actions { display: flex; gap: 6px; align-items: center; }
.fix-tip { font-size: 10px; color: #94a3b8; flex: 1; }
</style>
