<template>
  <div class="node asset-node" :class="{ selected, processing: node.status === 'processing' }">
    <div class="node-header stage-3">
      <span class="node-icon">🎨</span>
      <span class="node-title">{{ node.data.entityName || '美术资源' }}</span>
      <span class="node-status">{{ statusLabel }}</span>
    </div>
    <div class="node-body">
      <div class="asset-preview" v-if="previewUrl">
        <img :src="previewUrl" alt="asset" />
      </div>
      <div class="asset-placeholder" v-else>
        <span v-if="node.status === 'processing'">生成中…</span>
        <span v-else-if="node.data.errorMessage" class="error-text">{{ node.data.errorMessage }}</span>
        <span v-else>暂无图片</span>
      </div>
      <div class="asset-prompt" v-if="node.data.prompt">{{ node.data.prompt }}</div>
      <div class="asset-actions" v-if="node.status === 'completed'">
        <button class="btn btn-sm btn-primary" @click.stop="$emit('trigger', node)">→ 生成代码</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasNode } from '@/types'

const props = defineProps<{ node: CanvasNode; selected: boolean }>()
defineEmits<{ (e: 'select'): void; (e: 'trigger', node: CanvasNode): void }>()

const statusLabel = computed(() => {
  if (props.node.status === 'processing') return '生成中'
  if (props.node.status === 'completed') return '已完成'
  if (props.node.status === 'error') return '错误'
  return '待生成'
})

const previewUrl = computed(() => {
  const variants = props.node.data.variants || []
  const selected = variants.find((v: any) => v.selected) || variants[0]
  return selected?.url || ''
})
</script>

<style lang="scss" scoped>
.asset-node {
  width: 280px; position: absolute;
  left: v-bind('node.position.x + "px"'); top: v-bind('node.position.y + "px"');
  border-radius: 12px; background: var(--node-bg, #1a1a2e);
  border: 2px solid var(--stage-3, #8b5cf6);
  box-shadow: 0 4px 20px rgba(0,0,0,0.3); font-size: 12px;
  user-select: none; cursor: pointer;
  &.selected { box-shadow: 0 0 0 3px rgba(139,92,246,0.3); }
  &.processing { border-color: rgba(139,92,246,0.5); }
}
.node-header { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); font-weight: 600; }
.node-icon { font-size: 14px; }
.node-title { flex: 1; color: var(--text-primary, #e2e8f0); }
.node-status { font-size: 10px; color: var(--text-muted, #64748b); }
.node-body { padding: 10px 12px; }
.asset-preview {
  width: 100%; aspect-ratio: 1; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.3);
  img { width: 100%; height: 100%; object-fit: cover; }
}
.asset-placeholder { text-align: center; padding: 24px 0; color: var(--text-muted, #64748b); }
.error-text { color: #f87171; font-size: 10px; }
.asset-prompt { margin-top: 6px; font-size: 10px; color: var(--text-muted); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-actions { margin-top: 8px; }
.btn { border: none; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 500; transition: all 0.15s; &:hover { transform: translateY(-1px); } }
.btn-sm { padding: 5px 10px; }
.btn-primary { background: #6366f1; color: #fff; &:hover { background: #4f46e5; } }
</style>
