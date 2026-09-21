<template>
  <div ref="rootRef" class="node code-node" :class="{ selected, processing: isProcessing }">
    <div class="node-header stage-4">
      <span class="node-icon">⚙️</span>
      <span class="node-title">游戏代码</span>
      <span class="node-badge" v-if="versionCount > 0">v{{ versionCount }}</span>
      <span class="node-status">{{ statusLabel }}</span>
    </div>

    <div class="node-body">
      <!-- 代码预览 -->
      <div class="code-preview" v-if="hasRealCode">
        <pre><code>{{ previewCode }}</code></pre>
        <div class="code-meta">
          {{ lineCount }} 行 / {{ charCount }} 字符
        </div>
      </div>
      <div class="code-placeholder" v-else>
        <span v-if="isProcessing" class="typing-indicator">
          <span></span><span></span><span></span>
        </span>
        <span v-else>暂无代码</span>
      </div>

      <!-- 操作区 -->
      <div class="code-actions" v-if="node.status === 'completed' || node.status === 'error'">
        <button class="btn btn-sm btn-primary" @click.stop="$emit('trigger', node)" title="打包部署">
          → 部署
        </button>
        <button class="btn btn-sm btn-secondary" @click.stop="onRegenerate" title="完全重新生成">
          🔄 重新生成
        </button>
      </div>

      <!-- 版本历史 -->
      <div class="version-history" v-if="showHistory && history.length > 1">
        <div class="history-title">版本历史 ({{ history.length }})</div>
        <div
          class="history-item"
          v-for="ver in reversedHistory"
          :key="ver.id"
          :class="{ active: ver.id === codeData.activeVersionId }"
          @click.stop="onRollback(ver.id)"
        >
          <span class="ver-label">{{ ver.label }}</span>
          <span class="ver-time">{{ formatTime(ver.createdAt) }}</span>
        </div>
      </div>
      <button
        v-if="history.length > 1 && node.status === 'completed'"
        class="btn btn-xs btn-ghost toggle-history"
        @click.stop="showHistory = !showHistory"
      >
        {{ showHistory ? '收起历史' : `📜 ${history.length} 个版本` }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { CanvasNode, CodeNodeData, CodeVersion } from '@/types'
import { regenerateCode, rollbackToVersion } from '@/api/pipeline'
import { useCanvasStore } from '@/stores/canvas'

const props = defineProps<{ node: CanvasNode; selected: boolean }>()
defineEmits<{ (e: 'select'): void; (e: 'trigger', node: CanvasNode): void }>()

const store = useCanvasStore()
const showHistory = ref(false)
const rootRef = ref<HTMLDivElement | null>(null)
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  // 动态同步节点高度到 store，使连接箭头始终指向实际垂直中心
  if (rootRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      const h = Math.round(entries[0].contentRect.height)
      if (h > 0 && Math.abs((props.node.size?.height ?? 0) - h) > 2) {
        store.updateNode(props.node.id, { size: { ...props.node.size, height: h } })
      }
    })
    resizeObserver.observe(rootRef.value)
  }
})
onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

const codeData = computed(() => props.node.data as CodeNodeData)
const isProcessing = computed(() => props.node.status === 'processing')
const history = computed<CodeVersion[]>(() => codeData.value.history || [])
const versionCount = computed(() => history.value.length)
const reversedHistory = computed(() => [...history.value].reverse())

const statusLabel = computed(() => {
  switch (props.node.status) {
    case 'processing': return '生成中…'
    case 'completed': return '已完成'
    case 'error': return '错误'
    default: return '待生成'
  }
})

// 判断是否有真实代码（超过 50 字符或多于 2 行视为真实代码）
const hasRealCode = computed(() => {
  const src = codeData.value.source || ''
  return src.length > 50 || src.split('\n').length > 2
})

const previewCode = computed(() => {
  const src = codeData.value.source || ''
  const lines = src.split('\n')
  return lines.slice(0, 8).join('\n') + (lines.length > 8 ? '\n…' : '')
})

const lineCount = computed(() => (codeData.value.source || '').split('\n').length)
const charCount = computed(() => (codeData.value.source || '').length)

function onRegenerate() {
  regenerateCode(props.node)
}

function onRollback(versionId: string) {
  rollbackToVersion(props.node, versionId)
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch { return '' }
}
</script>

<style lang="scss" scoped>
.code-node {
  width: 360px;
  position: absolute;
  left: v-bind('node.position.x + "px"');
  top: v-bind('node.position.y + "px"');
  border-radius: 12px;
  background: var(--node-bg, #1a1a2e);
  border: 2px solid var(--stage-4, #10b981);
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  transition: border-color 0.2s, box-shadow 0.2s;
  font-size: 12px;
  user-select: none;
  cursor: pointer;

  &.selected { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.3); }
  &.processing { border-color: rgba(16, 185, 129, 0.5); animation: pulse-border 1.5s infinite; }
}

@keyframes pulse-border {
  0%, 100% { border-color: rgba(16, 185, 129, 0.5); }
  50% { border-color: rgba(16, 185, 129, 1); }
}

.node-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  font-weight: 600;
}

.node-icon { font-size: 14px; }
.node-title { flex: 1; color: var(--text-primary, #e2e8f0); }
.node-badge {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
}
.node-status {
  font-size: 10px; color: var(--text-muted, #64748b);
}

.node-body {
  padding: 10px 12px;
  max-height: 360px;
  overflow-y: auto;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
  &::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
}

.code-preview {
  background: rgba(0,0,0,0.3);
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 8px;
  overflow: hidden;

  pre {
    margin: 0; font-size: 10px; line-height: 1.4;
    color: #a5f3b4; font-family: 'JetBrains Mono', 'Fira Code', monospace;
    white-space: pre-wrap; word-break: break-all;
    max-height: 100px; overflow: hidden;
  }
}

.code-meta {
  margin-top: 4px; font-size: 10px; color: var(--text-muted, #64748b);
}

.code-placeholder {
  text-align: center; padding: 16px 0;
  color: var(--text-muted, #64748b);
}

.typing-indicator {
  display: inline-flex; gap: 3px;
  span {
    width: 6px; height: 6px; border-radius: 50%;
    background: #10b981; animation: typing-bounce 1.2s infinite;
    &:nth-child(2) { animation-delay: 0.2s; }
    &:nth-child(3) { animation-delay: 0.4s; }
  }
}

@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
}

.code-actions {
  display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;
}

.btn {
  border: none; border-radius: 6px; cursor: pointer;
  font-size: 11px; font-weight: 500;
  transition: all 0.15s;
  &:hover { transform: translateY(-1px); }
  &:active { transform: translateY(0); }
  &:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
}
.btn-sm { padding: 5px 10px; }
.btn-xs { padding: 3px 8px; font-size: 10px; }
.btn-primary { background: #6366f1; color: #fff; &:hover { background: #4f46e5; } }
.btn-secondary { background: rgba(255,255,255,0.08); color: #e2e8f0; &:hover { background: rgba(255,255,255,0.15); } }
.btn-accent { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); &:hover { background: rgba(16,185,129,0.25); } }
.btn-ghost { background: none; color: var(--text-muted, #64748b); &:hover { color: #e2e8f0; } }

.version-history {
  margin-top: 8px; padding: 6px;
  background: rgba(0,0,0,0.2); border-radius: 6px;
  max-height: 120px; overflow-y: auto;
}

.history-title {
  font-size: 10px; color: var(--text-muted); margin-bottom: 4px; font-weight: 600;
}

.history-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 3px 6px; border-radius: 4px;
  cursor: pointer; transition: background 0.1s;
  &:hover { background: rgba(255,255,255,0.05); }
  &.active { background: rgba(16,185,129,0.1); border-left: 2px solid #10b981; }
}

.ver-label { font-size: 10px; color: #e2e8f0; }
.ver-time { font-size: 9px; color: var(--text-muted); }

.toggle-history { margin-top: 6px; width: 100%; text-align: center; }
</style>
