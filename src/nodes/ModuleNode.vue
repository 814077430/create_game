<template>
  <div class="node module-node" :class="{ selected, processing: node.status === 'processing' }">
    <div class="node-header stage-2">
      <span class="node-icon">🧩</span>
      <!-- 可编辑名称 -->
      <input
        v-if="editingName"
        ref="nameInputRef"
        class="name-input"
        v-model="localName"
        @blur="saveName"
        @keydown.enter.prevent="saveName"
        @keydown.escape.prevent="cancelEditName"
        @click.stop
      />
      <span
        v-else
        class="node-title"
        :title="moduleData.name || '点击编辑名称'"
        @dblclick.stop="startEditName"
      >{{ moduleData.name || '功能模块' }}</span>
      <span class="node-status">{{ statusLabel }}</span>
      <button
        class="btn-icon btn-delete"
        title="删除模块"
        @click.stop="onDeleteModule"
      >🗑</button>
    </div>
    <div class="node-body">
      <!-- 模块描述（可编辑） -->
      <div class="desc-section">
        <div class="section-label">
          <span>📝 模块描述</span>
          <button
            v-if="!editingDesc"
            class="btn-link"
            @click.stop="startEditDesc"
          >编辑</button>
        </div>
        <div v-if="!editingDesc" class="module-desc" @dblclick.stop="startEditDesc">
          <span v-if="moduleData.description">{{ moduleData.description }}</span>
          <span v-else class="placeholder-text">（双击编辑模块描述）</span>
        </div>
        <textarea
          v-else
          ref="descInputRef"
          class="module-input"
          v-model="localDesc"
          placeholder="输入模块描述…"
          @blur="saveDesc"
          @click.stop
        />
      </div>

      <!-- 用户备注（可编辑） -->
      <div class="desc-section" v-if="showUserInput || moduleData.userInput">
        <div class="section-label">
          <span>💬 备注</span>
          <button class="btn-link" @click.stop="showUserInput = !showUserInput">
            {{ showUserInput ? '收起' : '展开' }}
          </button>
        </div>
        <textarea
          v-if="showUserInput"
          class="module-input"
          v-model="localInput"
          placeholder="补充说明、特殊需求…"
          :disabled="node.status === 'processing'"
          @blur="saveInput"
          @click.stop
        />
        <div v-else-if="moduleData.userInput" class="module-desc" @click.stop="showUserInput = true">
          {{ moduleData.userInput }}
        </div>
      </div>

      <!-- 美术资源区域 -->
      <div class="art-section">
        <div class="art-section-header">
          <span class="art-label">🎨 美术资源（{{ doneCount }}/{{ moduleData.assets.length }}）</span>
          <div class="art-header-actions">
            <button
              class="btn btn-xs btn-add"
              title="新增美术资源"
              @click.stop="onAddAsset"
            >＋</button>
            <button
              v-if="hasIdleAssets"
              class="btn btn-xs btn-art"
              @click.stop="onGenerateArt"
              :disabled="node.status === 'processing'"
            >生成美术</button>
          </div>
        </div>
        <div v-if="moduleData.assets.length === 0" class="empty-art">
          点击 ＋ 添加美术资源
        </div>
        <div v-else class="art-grid">
          <div
            class="art-item"
            v-for="asset in moduleData.assets"
            :key="asset.id"
            :class="asset.status"
          >
            <div class="art-thumb-wrap" :title="asset.prompt || asset.entityName">
              <img v-if="asset.url" :src="asset.url" :alt="asset.entityName" class="art-thumb" />
              <div v-else class="art-placeholder">
                <span v-if="asset.status === 'generating'" class="loading-dot">⏳</span>
                <span v-else-if="asset.status === 'error'" class="error-icon" :title="asset.errorMessage">❌</span>
                <span v-else class="idle-icon">🖼️</span>
              </div>
              <button
                class="btn-remove-asset"
                title="移除该资源"
                @click.stop="onRemoveAsset(asset.id)"
              >×</button>
            </div>
            <div class="art-info">
              <input
                class="art-name-input"
                :value="asset.entityName"
                :title="asset.entityName"
                @change="(e) => onRenameAsset(asset.id, (e.target as HTMLInputElement).value)"
                @click.stop
              />
              <button
                class="btn-edit-asset"
                @click.stop="onEditAsset(asset.id)"
                title="编辑名称与详细要求"
              >✏️</button>
              <button
                v-if="asset.status === 'done' || asset.status === 'error'"
                class="btn-regen"
                @click.stop="onRegenAsset(asset.id)"
                title="重新生成"
              >🔄</button>
            </div>
            <!-- 详细要求摘要（一行） -->
            <div
              v-if="asset.prompt"
              class="art-req-preview"
              :title="asset.prompt"
              @click.stop="onEditAsset(asset.id)"
            >{{ asset.prompt }}</div>
            <div
              v-else
              class="art-req-preview empty"
              @click.stop="onEditAsset(asset.id)"
            >点击补充详细要求</div>
          </div>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="module-actions">
        <button
          v-if="allArtDone"
          class="btn btn-sm btn-primary"
          @click.stop="$emit('trigger', node)"
        >→ 生成代码</button>
        <button
          v-if="moduleData.source === 'manual' && node.status === 'idle'"
          class="btn btn-sm btn-secondary"
          @click.stop="onMarkComplete"
        >✓ 标记完成</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import type { CanvasNode, ModuleNodeData, ModuleArtAsset, GameDesign } from '@/types'
import { useCanvasStore } from '@/stores/canvas'
import { useProjectStore } from '@/stores/project'
import { generateModuleArt, regenerateAsset } from '@/api/pipeline'

const props = defineProps<{ node: CanvasNode; selected: boolean }>()
defineEmits<{ (e: 'select'): void; (e: 'trigger', node: CanvasNode): void }>()

const store = useCanvasStore()
const projStore = useProjectStore()
const moduleData = computed(() => props.node.data as ModuleNodeData)

/** 保存模块信息到项目 modules/ 目录 */
function persistModuleToProject() {
  const d = moduleData.value
  const doc = {
    id: props.node.id,
    name: d.name,
    description: d.description,
    userInput: d.userInput,
    relatedEntities: d.relatedEntities,
    assets: d.assets.map((a) => ({ id: a.id, entityName: a.entityName, prompt: a.prompt, style: a.style })),
    updatedAt: new Date().toISOString(),
  }
  projStore.saveToProject('modules', `${props.node.id}.json`, JSON.stringify(doc, null, 2))
}

// 名称编辑
const editingName = ref(false)
const localName = ref(moduleData.value.name || '')
const nameInputRef = ref<HTMLInputElement | null>(null)

// 描述编辑
const editingDesc = ref(false)
const localDesc = ref(moduleData.value.description || '')
const descInputRef = ref<HTMLTextAreaElement | null>(null)

// 用户备注
const showUserInput = ref(!!moduleData.value.userInput)
const localInput = ref(moduleData.value.userInput || '')

watch(() => moduleData.value.userInput, (v) => { localInput.value = v || '' })
watch(() => moduleData.value.name, (v) => { localName.value = v || '' })
watch(() => moduleData.value.description, (v) => { localDesc.value = v || '' })

const doneCount = computed(() => moduleData.value.assets.filter((a) => a.status === 'done').length)
const hasIdleAssets = computed(() => moduleData.value.assets.some((a) => a.status === 'idle' || a.status === 'error'))
const allArtDone = computed(() => moduleData.value.assets.length > 0 && moduleData.value.assets.every((a) => a.status === 'done'))

const statusLabel = computed(() => {
  if (props.node.status === 'processing') return '生成中…'
  if (allArtDone.value) return '就绪'
  if (doneCount.value > 0) return `${doneCount.value}/${moduleData.value.assets.length}`
  if (props.node.status === 'completed') return '已拆分'
  return '待配置'
})

// === 名称编辑 ===
function startEditName() {
  localName.value = moduleData.value.name || ''
  editingName.value = true
  nextTick(() => nameInputRef.value?.focus())
}
function saveName() {
  const v = localName.value.trim()
  if (!v) {
    ElMessage.warning('模块名称不能为空')
    cancelEditName()
    return
  }
  store.updateNode(props.node.id, { data: { ...props.node.data, name: v } })
  editingName.value = false
  persistModuleToProject()
}
function cancelEditName() {
  localName.value = moduleData.value.name || ''
  editingName.value = false
}

// === 描述编辑 ===
function startEditDesc() {
  localDesc.value = moduleData.value.description || ''
  editingDesc.value = true
  nextTick(() => descInputRef.value?.focus())
}
function saveDesc() {
  store.updateNode(props.node.id, { data: { ...props.node.data, description: localDesc.value.trim() } })
  editingDesc.value = false
  persistModuleToProject()
}

// === 备注 ===
function saveInput() {
  store.updateNode(props.node.id, { data: { ...props.node.data, userInput: localInput.value } })
  persistModuleToProject()
}

// === 美术资源 - 添加 ===
async function onAddAsset() {
  try {
    const { value: name } = await ElMessageBox.prompt('输入新美术资源的名称（如：玩家飞船）', '新增美术资源 (1/2) — 名称', {
      confirmButtonText: '下一步',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    })

    const { value: requirement } = await ElMessageBox.prompt(
      '输入该美术资源的详细要求：\n\n• 形态/姿态（例如：正面站立、3/4 视角飞行）\n• 颜色与材质（例如：金属反光、卡通描边）\n• 用途（例如：玩家主角、Boss、收集物）\n• 其他细节（贴图、特效、装饰）',
      '新增美术资源 (2/2) — 详细要求',
      {
        confirmButtonText: '添加',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputValue: name,
        inputPattern: /\S+/,
        inputErrorMessage: '详细要求不能为空',
      }
    )

    // 从上游创意节点获取风格建议
    const upstream = store.getUpstream(props.node.id)
    const ideaNode = upstream.find((n) => n.type === 'idea')
    const design = ideaNode?.data?.expandedDesign as GameDesign | undefined
    const style = design?.suggestedArtStyle || 'flat cartoon, vibrant colors, game asset, transparent background'

    const newAsset: ModuleArtAsset = {
      id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      entityName: name.trim(),
      prompt: requirement.trim(),
      style,
      url: '',
      status: 'idle',
    }
    const newAssets = [...moduleData.value.assets, newAsset]
    store.updateNode(props.node.id, { data: { ...props.node.data, assets: newAssets } })
    ElMessage.success(`已添加「${name}」`)
  } catch {
    // 用户取消
  }
}

// === 美术资源 - 编辑（名称 + 详细要求） ===
async function onEditAsset(assetId: string) {
  const asset = moduleData.value.assets.find((a) => a.id === assetId)
  if (!asset) return
  try {
    const { value: name } = await ElMessageBox.prompt('修改美术资源名称', '编辑美术资源 (1/2) — 名称', {
      confirmButtonText: '下一步',
      cancelButtonText: '取消',
      inputValue: asset.entityName,
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    })
    const { value: requirement } = await ElMessageBox.prompt(
      '修改详细要求（描述形态、颜色、材质、用途、特殊细节等）',
      '编辑美术资源 (2/2) — 详细要求',
      {
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputValue: asset.prompt,
        inputPattern: /\S+/,
        inputErrorMessage: '详细要求不能为空',
      }
    )
    const newAssets = moduleData.value.assets.map((a) =>
      a.id === assetId ? { ...a, entityName: name.trim(), prompt: requirement.trim() } : a
    )
    store.updateNode(props.node.id, { data: { ...props.node.data, assets: newAssets } })
    ElMessage.success(`已更新「${name}」`)
  } catch {
    // 用户取消
  }
}

// === 美术资源 - 删除 ===
async function onRemoveAsset(assetId: string) {
  const asset = moduleData.value.assets.find((a) => a.id === assetId)
  if (!asset) return
  try {
    await ElMessageBox.confirm(`确定移除资源「${asset.entityName}」？`, '确认移除', {
      type: 'warning',
      confirmButtonText: '移除',
      cancelButtonText: '取消',
    })
    const newAssets = moduleData.value.assets.filter((a) => a.id !== assetId)
    store.updateNode(props.node.id, { data: { ...props.node.data, assets: newAssets } })
    ElMessage.success('已移除')
  } catch {
    // 用户取消
  }
}

// === 美术资源 - 重命名 ===
function onRenameAsset(assetId: string, newName: string) {
  const trimmed = newName.trim()
  if (!trimmed) {
    ElMessage.warning('资源名称不能为空')
    return
  }
  const newAssets = moduleData.value.assets.map((a) =>
    a.id === assetId ? { ...a, entityName: trimmed } : a
  )
  store.updateNode(props.node.id, { data: { ...props.node.data, assets: newAssets } })
}

function onGenerateArt() {
  generateModuleArt(props.node)
}

function onRegenAsset(assetId: string) {
  regenerateAsset(props.node, assetId)
}

function onMarkComplete() {
  store.updateNode(props.node.id, { status: 'completed' })
}

// === 删除整个模块 ===
async function onDeleteModule() {
  try {
    await ElMessageBox.confirm(
      `确定删除模块「${moduleData.value.name}」？此操作将移除该模块及其所有美术资源。`,
      '删除模块',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      }
    )
    store.removeNode(props.node.id)
    ElMessage.success('模块已删除')
  } catch {
    // 用户取消
  }
}
</script>

<style lang="scss" scoped>
.module-node {
  width: 380px; position: absolute;
  left: v-bind('node.position.x + "px"'); top: v-bind('node.position.y + "px"');
  border-radius: 12px; background: var(--node-bg, #1a1a2e);
  border: 2px solid var(--stage-2, #06b6d4);
  box-shadow: 0 4px 20px rgba(0,0,0,0.3); font-size: 12px;
  user-select: none; cursor: pointer;
  &.selected { box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.3); }
  &.processing { border-color: rgba(6, 182, 212, 0.5); animation: pulse-border 1.5s infinite; }
}
@keyframes pulse-border {
  0%, 100% { border-color: rgba(6, 182, 212, 0.5); }
  50% { border-color: rgba(6, 182, 212, 1); }
}
.node-header { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); font-weight: 600; }
.node-icon { font-size: 14px; }
.node-title {
  flex: 1; color: var(--text-primary, #e2e8f0);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  cursor: text;
  &:hover { color: #67e8f9; }
}
.name-input {
  flex: 1; background: rgba(0,0,0,0.4); border: 1px solid rgba(6, 182, 212, 0.5);
  border-radius: 4px; padding: 2px 6px; color: #e2e8f0; font-size: 12px;
  font-weight: 600; outline: none;
  &:focus { border-color: #06b6d4; }
}
.node-status { font-size: 10px; color: var(--text-muted, #64748b); }
.btn-icon {
  background: none; border: none; cursor: pointer; padding: 2px 4px;
  font-size: 12px; opacity: 0.5; color: #e2e8f0; border-radius: 4px;
  &:hover { opacity: 1; background: rgba(255,255,255,0.08); }
}
.btn-delete:hover { color: #f87171; background: rgba(248, 113, 113, 0.1); }
.node-body {
  padding: 10px 12px;
  max-height: 400px;
  overflow-y: auto;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
  &::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
}

.desc-section { margin-bottom: 8px; }
.section-label {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 10px; color: var(--text-muted, #64748b); margin-bottom: 4px;
}
.btn-link {
  background: none; border: none; color: #67e8f9; cursor: pointer;
  font-size: 10px; padding: 0 4px;
  &:hover { color: #06b6d4; text-decoration: underline; }
}

.module-desc {
  font-size: 11px; color: var(--text-secondary, #94a3b8); line-height: 1.5;
  padding: 6px 8px; background: rgba(6, 182, 212, 0.06); border-radius: 6px;
  border-left: 3px solid rgba(6, 182, 212, 0.3);
  max-height: 80px; overflow-y: auto;
  cursor: text;
  &:hover { background: rgba(6, 182, 212, 0.1); }
}
.placeholder-text { color: #64748b; font-style: italic; }

.module-input {
  width: 100%; min-height: 40px; max-height: 80px; resize: vertical;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; padding: 6px 8px; color: #e2e8f0; font-size: 11px;
  outline: none; font-family: inherit; line-height: 1.4;
  box-sizing: border-box;
  &:focus { border-color: rgba(6, 182, 212, 0.5); }
  &::placeholder { color: #64748b; }
}

.art-section {
  margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06);
}
.art-section-header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;
}
.art-label { font-size: 11px; color: var(--text-muted); font-weight: 500; }
.art-header-actions { display: flex; gap: 4px; }

.empty-art {
  text-align: center; padding: 16px; font-size: 11px; color: #64748b;
  background: rgba(255,255,255,0.02); border-radius: 6px;
  border: 1px dashed rgba(255,255,255,0.08);
}

.art-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px;
}
.art-item {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  &.generating .art-placeholder { animation: pulse-bg 1.5s infinite; }
}
@keyframes pulse-bg {
  0%, 100% { background: rgba(6, 182, 212, 0.1); }
  50% { background: rgba(6, 182, 212, 0.2); }
}
.art-thumb-wrap { position: relative; }
.art-thumb {
  width: 56px; height: 56px; border-radius: 6px; object-fit: cover;
  border: 1px solid rgba(255,255,255,0.1); display: block;
}
.art-placeholder {
  width: 56px; height: 56px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.04); border: 1px dashed rgba(255,255,255,0.15);
  font-size: 16px;
}
.btn-remove-asset {
  position: absolute; top: -4px; right: -4px;
  width: 16px; height: 16px; border-radius: 50%;
  background: rgba(15, 15, 25, 0.9); border: 1px solid rgba(248, 113, 113, 0.4);
  color: #f87171; font-size: 12px; line-height: 1; cursor: pointer;
  display: none; align-items: center; justify-content: center; padding: 0;
  &:hover { background: #ef4444; color: #fff; border-color: #ef4444; }
}
.art-thumb-wrap:hover .btn-remove-asset { display: flex; }

.art-info {
  display: flex; align-items: center; gap: 2px; width: 100%;
}
.art-name-input {
  flex: 1; background: transparent; border: none; outline: none;
  font-size: 9px; color: var(--text-muted); text-align: center;
  min-width: 0; padding: 2px;
  &:hover, &:focus { background: rgba(255,255,255,0.05); border-radius: 3px; color: #e2e8f0; }
}
.btn-regen { background: none; border: none; font-size: 10px; cursor: pointer; padding: 0; opacity: 0.6; &:hover { opacity: 1; } }
.btn-edit-asset {
  background: none; border: none; font-size: 10px; cursor: pointer; padding: 0;
  opacity: 0.55;
  &:hover { opacity: 1; }
}
.art-req-preview {
  width: 100%; font-size: 9px; color: #94a3b8; line-height: 1.3;
  margin-top: 2px; padding: 2px 4px; border-radius: 3px;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  cursor: pointer; max-width: 80px; text-align: center;
  &:hover { background: rgba(255,255,255,0.05); color: #cbd5e1; }
  &.empty { color: #64748b; font-style: italic; }
}

.btn-add {
  background: rgba(99, 102, 241, 0.15); color: #a5b4fc;
  border: 1px solid rgba(99, 102, 241, 0.3);
  font-weight: 700; line-height: 1;
  &:hover { background: rgba(99, 102, 241, 0.25); }
}

.module-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.btn { border: none; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 500; transition: all 0.15s; &:hover { transform: translateY(-1px); } &:disabled { opacity: 0.5; cursor: not-allowed; transform: none; } }
.btn-xs { padding: 3px 8px; font-size: 10px; }
.btn-sm { padding: 5px 10px; }
.btn-primary { background: #6366f1; color: #fff; &:hover { background: #4f46e5; } }
.btn-secondary { background: rgba(255,255,255,0.08); color: #e2e8f0; &:hover { background: rgba(255,255,255,0.15); } }
.btn-art { background: rgba(6, 182, 212, 0.15); color: #67e8f9; border: 1px solid rgba(6, 182, 212, 0.3); &:hover { background: rgba(6, 182, 212, 0.25); } }
</style>
