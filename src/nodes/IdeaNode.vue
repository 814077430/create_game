<template>
  <div class="node idea-node" :class="{ selected, processing: node.status === 'processing' }">
    <div class="node-header stage-1">
      <span class="node-icon">💡</span>
      <span class="node-title">创意 / 玩法</span>
      <span class="node-status">{{ statusLabel }}</span>
    </div>
    <div class="node-body">
      <!-- 横竖版选择 -->
      <div class="orient-row" v-if="!node.data.expandedDesign">
        <button
          class="orient-btn"
          :class="{ active: currentOrientation === 'portrait' }"
          @click.stop="setOrientation('portrait')"
        >
          <span class="orient-icon portrait">▮</span>
          <span>竖版</span>
        </button>
        <button
          class="orient-btn"
          :class="{ active: currentOrientation === 'landscape' }"
          @click.stop="setOrientation('landscape')"
        >
          <span class="orient-icon landscape">▮</span>
          <span>横版</span>
        </button>
      </div>
      <textarea
        class="idea-input"
        v-model="localInput"
        placeholder="用一句话描述你的游戏创意…"
        @blur="saveInput"
        @keydown.enter.ctrl="onSubmit"
        :disabled="node.status === 'processing'"
      />
      <div class="idea-actions" v-if="node.data.expandedDesign">
        <!-- 一句话概要：双击编辑 -->
        <div
          v-if="!editingConcept"
          class="design-summary"
          :title="'双击编辑概要'"
          @dblclick.stop="startEditConcept"
        >
          {{ design?.gameConcept || '（双击编辑游戏概要）' }}
        </div>
        <textarea
          v-else
          ref="conceptInputRef"
          class="edit-input edit-input-concept"
          v-model="localConcept"
          @blur="saveConcept"
          @keydown.escape.prevent="cancelEditConcept"
          @click.stop
        />

        <!-- 详细玩法折叠展示（带编辑模式） -->
        <div v-if="design?.detailedGameplay || editingDetail" class="design-detail">
          <div class="detail-toggle">
            <span class="toggle-clickable" @click.stop="showDetail = !showDetail">
              {{ showDetail ? '▼' : '▶' }} 详细玩法 / 规则
            </span>
            <span class="toggle-actions" v-if="showDetail">
              <button v-if="!editingDetail" class="btn-link" @click.stop="startEditDetail">✏️ 编辑</button>
              <template v-else>
                <button class="btn-link btn-save" @click.stop="saveDetail">💾 保存</button>
                <button class="btn-link" @click.stop="cancelEditDetail">取消</button>
              </template>
            </span>
          </div>

          <!-- 查看模式 -->
          <div v-if="showDetail && !editingDetail" class="detail-body">
            <div class="detail-row" v-if="design?.detailedGameplay?.startup"><b>起始：</b>{{ design.detailedGameplay.startup }}</div>
            <div class="detail-row" v-if="design?.detailedGameplay?.coreLoop"><b>核心循环：</b>{{ design.detailedGameplay.coreLoop }}</div>
            <div class="detail-row" v-if="design?.detailedGameplay?.progression"><b>难度递进：</b>{{ design.detailedGameplay.progression }}</div>
            <div class="detail-row" v-if="design?.detailedGameplay?.controls"><b>操作：</b>{{ design.detailedGameplay.controls }}</div>
            <div class="detail-row" v-if="design?.detailedGameplay?.feedback"><b>反馈：</b>{{ design.detailedGameplay.feedback }}</div>
            <div v-if="design?.winConditions?.length" class="detail-row">
              <b>胜利条件：</b>
              <ul><li v-for="(c, i) in design.winConditions" :key="'w' + i">{{ c }}</li></ul>
            </div>
            <div v-if="design?.loseConditions?.length" class="detail-row">
              <b>失败条件：</b>
              <ul><li v-for="(c, i) in design.loseConditions" :key="'l' + i">{{ c }}</li></ul>
            </div>
            <div v-if="design?.rules?.length" class="detail-row">
              <b>规则细则（{{ design.rules.length }}）：</b>
              <ul>
                <li v-for="(r, i) in design.rules" :key="'r' + i">
                  {{ r.trigger }} → {{ r.action }}
                  <em v-if="r.description">（{{ r.description }}）</em>
                </li>
              </ul>
            </div>
          </div>

          <!-- 编辑模式 -->
          <div v-else-if="showDetail && editingDetail" class="detail-body edit-body" @click.stop>
            <div class="edit-row">
              <label>起始</label>
              <textarea class="edit-input" v-model="editDraft.detailedGameplay.startup" placeholder="开局画面、出生位置、初始资源…" />
            </div>
            <div class="edit-row">
              <label>核心循环</label>
              <textarea class="edit-input" v-model="editDraft.detailedGameplay.coreLoop" placeholder="玩家行动 → 反馈 → 奖励 → 下一步…" />
            </div>
            <div class="edit-row">
              <label>难度递进</label>
              <textarea class="edit-input" v-model="editDraft.detailedGameplay.progression" placeholder="时间/分数/关卡如何推进难度…" />
            </div>
            <div class="edit-row">
              <label>操作方式</label>
              <textarea class="edit-input" v-model="editDraft.detailedGameplay.controls" placeholder="鼠标/触屏/键盘按键映射…" />
            </div>
            <div class="edit-row">
              <label>反馈手感</label>
              <textarea class="edit-input" v-model="editDraft.detailedGameplay.feedback" placeholder="视觉/音效/震屏/粒子…" />
            </div>

            <div class="edit-row">
              <label>
                胜利条件
                <button class="btn-mini" @click.stop="addWin">+ 添加</button>
              </label>
              <div class="list-editor">
                <div v-for="(_, i) in editDraft.winConditions" :key="'we' + i" class="list-row">
                  <input class="edit-input" v-model="editDraft.winConditions[i]" placeholder="例如：累计分数达到 10000 通关" />
                  <button class="btn-mini btn-danger" @click.stop="editDraft.winConditions.splice(i, 1)">×</button>
                </div>
                <div v-if="!editDraft.winConditions.length" class="empty-tip">暂无胜利条件，点击 + 添加</div>
              </div>
            </div>

            <div class="edit-row">
              <label>
                失败条件
                <button class="btn-mini" @click.stop="addLose">+ 添加</button>
              </label>
              <div class="list-editor">
                <div v-for="(_, i) in editDraft.loseConditions" :key="'le' + i" class="list-row">
                  <input class="edit-input" v-model="editDraft.loseConditions[i]" placeholder="例如：护甲降至 0" />
                  <button class="btn-mini btn-danger" @click.stop="editDraft.loseConditions.splice(i, 1)">×</button>
                </div>
                <div v-if="!editDraft.loseConditions.length" class="empty-tip">暂无失败条件，点击 + 添加</div>
              </div>
            </div>

            <div class="edit-row">
              <label>
                规则细则
                <button class="btn-mini" @click.stop="addRule">+ 添加</button>
              </label>
              <div class="list-editor">
                <div v-for="(rule, i) in editDraft.rules" :key="'re' + i" class="rule-row">
                  <div class="rule-row-line">
                    <input class="edit-input rule-trigger" v-model="rule.trigger" placeholder="触发：玩家碰到障碍物" />
                    <span class="rule-arrow">→</span>
                    <input class="edit-input rule-action" v-model="rule.action" placeholder="动作：扣血并震屏" />
                    <button class="btn-mini btn-danger" @click.stop="editDraft.rules.splice(i, 1)">×</button>
                  </div>
                  <textarea class="edit-input rule-desc" v-model="rule.description" placeholder="详细说明（边界条件、数值、连锁反应…）" />
                </div>
                <div v-if="!editDraft.rules.length" class="empty-tip">暂无规则，点击 + 添加</div>
              </div>
            </div>
          </div>
        </div>
        <div class="action-row">
          <button class="btn btn-sm btn-primary" @click.stop="onAutoBreakdown" :disabled="isBreakingDown">
            🤖 一键拆分模块
          </button>
          <button
            v-if="hasModules"
            class="btn btn-sm btn-art"
            @click.stop="onGenerateAllArt"
          >
            🎨 一键生成美术
          </button>
        </div>
        <p v-if="hasModules" class="hint-text">💡 双击此节点可手动添加模块</p>
      </div>
      <button v-else class="btn btn-sm btn-primary full-w" @click.stop="onSubmit" :disabled="!localInput.trim()">
        🚀 AI 推理玩法
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, reactive } from 'vue'
import type { CanvasNode, GameDesign, RuleDef, DetailedGameplay } from '@/types'
import { useCanvasStore } from '@/stores/canvas'
import { chatCompletion, extractJSON } from '@/api/llm'
import { GAMEPLAY_SYSTEM_PROMPT, buildGameplayUserPrompt } from '@/api/prompts'
import { useSettingsStore } from '@/stores/settings'
import { ElMessage } from 'element-plus'
import { autoBreakdownModules, generateAllArt } from '@/api/pipeline'
import { useProjectStore } from '@/stores/project'

const projStore = useProjectStore()

const currentOrientation = computed(() => projStore.orientation)

function setOrientation(o: 'portrait' | 'landscape') {
  if (projStore.project) {
    projStore.project.orientation = o
    localStorage.setItem('gameforge_project', JSON.stringify(projStore.project))
    // 保存到磁盘元信息
    projStore.saveToProject('design', '../project.json', JSON.stringify(projStore.project, null, 2))
  }
}

const props = defineProps<{ node: CanvasNode; selected: boolean }>()
defineEmits<{ (e: 'select'): void; (e: 'trigger', node: CanvasNode): void; (e: 'dblclick-node', node: CanvasNode): void }>()

const store = useCanvasStore()
const localInput = ref(props.node.data.userInput || '')
const isBreakingDown = ref(false)
const showDetail = ref(false)

const design = computed(() => props.node.data.expandedDesign as GameDesign | null)

watch(() => props.node.data.userInput, (v) => { localInput.value = v || '' })

const hasModules = computed(() => store.nodes.some((n) => n.type === 'module'))

const statusLabel = computed(() => {
  if (props.node.status === 'processing') return '推理中…'
  if (props.node.data.expandedDesign) return '已完成'
  return '待推理'
})

function saveInput() {
  store.updateNode(props.node.id, { data: { ...props.node.data, userInput: localInput.value } })
}

// === 概要编辑 ===
const editingConcept = ref(false)
const localConcept = ref('')
const conceptInputRef = ref<HTMLTextAreaElement | null>(null)

function startEditConcept() {
  localConcept.value = design.value?.gameConcept || ''
  editingConcept.value = true
  nextTick(() => conceptInputRef.value?.focus())
}
function saveConcept() {
  const v = localConcept.value.trim()
  if (!v) {
    ElMessage.warning('概要不能为空')
    cancelEditConcept()
    return
  }
  const next: GameDesign = { ...(design.value as GameDesign), gameConcept: v }
  store.updateNode(props.node.id, { data: { ...props.node.data, expandedDesign: next } })
  editingConcept.value = false
}
function cancelEditConcept() {
  editingConcept.value = false
}

// === 详情编辑 ===
const editingDetail = ref(false)

interface EditDraft {
  detailedGameplay: DetailedGameplay
  winConditions: string[]
  loseConditions: string[]
  rules: RuleDef[]
}
const editDraft = reactive<EditDraft>({
  detailedGameplay: { startup: '', coreLoop: '', progression: '', controls: '', feedback: '' },
  winConditions: [],
  loseConditions: [],
  rules: [],
})

function startEditDetail() {
  const d = design.value
  const dg = d?.detailedGameplay
  editDraft.detailedGameplay = {
    startup: dg?.startup || '',
    coreLoop: dg?.coreLoop || '',
    progression: dg?.progression || '',
    controls: dg?.controls || '',
    feedback: dg?.feedback || '',
  }
  editDraft.winConditions = Array.isArray(d?.winConditions) ? [...d!.winConditions!] : []
  editDraft.loseConditions = Array.isArray(d?.loseConditions) ? [...d!.loseConditions!] : []
  editDraft.rules = Array.isArray(d?.rules)
    ? d!.rules.map((r) => ({ trigger: r.trigger, action: r.action, description: r.description || '' }))
    : []
  editingDetail.value = true
  showDetail.value = true
}

function cancelEditDetail() {
  editingDetail.value = false
}

function saveDetail() {
  const cleanWin = editDraft.winConditions.map((s) => s.trim()).filter(Boolean)
  const cleanLose = editDraft.loseConditions.map((s) => s.trim()).filter(Boolean)
  const cleanRules: RuleDef[] = editDraft.rules
    .map((r) => ({
      trigger: (r.trigger || '').trim(),
      action: (r.action || '').trim(),
      description: (r.description || '').trim(),
    }))
    .filter((r) => r.trigger || r.action)

  const next: GameDesign = {
    ...(design.value as GameDesign),
    detailedGameplay: {
      startup: editDraft.detailedGameplay.startup.trim(),
      coreLoop: editDraft.detailedGameplay.coreLoop.trim(),
      progression: editDraft.detailedGameplay.progression.trim(),
      controls: editDraft.detailedGameplay.controls.trim(),
      feedback: editDraft.detailedGameplay.feedback.trim(),
    },
    winConditions: cleanWin,
    loseConditions: cleanLose,
    rules: cleanRules,
  }
  store.updateNode(props.node.id, { data: { ...props.node.data, expandedDesign: next } })
  editingDetail.value = false
  ElMessage.success('详细玩法已保存')
}

function addWin() { editDraft.winConditions.push('') }
function addLose() { editDraft.loseConditions.push('') }
function addRule() { editDraft.rules.push({ trigger: '', action: '', description: '' }) }

async function onSubmit() {
  const settings = useSettingsStore()
  if (!settings.isLLMConfigured()) {
    ElMessage.warning('请先配置 LLM API Key')
    settings.show()
    return
  }
  saveInput()
  const input = localInput.value.trim()
  if (!input) return

  store.updateNode(props.node.id, { status: 'processing' })
  store.setPipeline({ currentStage: 1, status: 'running', progress: 5, message: '正在推理游戏设计…' })

  try {
    let accLen = 0
    const text = await chatCompletion(
      [
        { role: 'system', content: GAMEPLAY_SYSTEM_PROMPT },
        { role: 'user', content: buildGameplayUserPrompt(input, useProjectStore().orientation) },
      ],
      {
        temperature: 0.8,
        responseFormat: 'json_object',
        onChunk: (chunk) => {
          accLen += chunk.length
          // 平滑进度：5% → 90%，大约按字符量估算
          store.setPipeline({ progress: Math.min(90, 5 + accLen / 25) })
        },
      }
    )
    const design = extractJSON(text)
    store.updateNode(props.node.id, {
      status: 'completed',
      data: { ...props.node.data, userInput: input, expandedDesign: design },
    })
    store.setPipeline({ status: 'completed', progress: 100, message: '游戏设计推理完成' })

    // 保存设计文档到项目目录
    const projStore = useProjectStore()
    projStore.saveToProject('design', 'game-design.json', JSON.stringify(design, null, 2))

    // 不再自动调用拆分模块：由 CanvasEngine 统一调度「手动点击 / 60s 超时」逻辑
  } catch (err: any) {
    store.updateNode(props.node.id, { status: 'error' })
    store.setPipeline({ status: 'error', message: err.message })
    ElMessage.error('推理失败: ' + err.message)
  }
}

async function onAutoBreakdown() {
  isBreakingDown.value = true
  try {
    await autoBreakdownModules(props.node)
  } finally {
    isBreakingDown.value = false
  }
}

function onGenerateAllArt() {
  generateAllArt()
}
</script>

<style lang="scss" scoped>
.idea-node {
  width: 360px; position: absolute;
  left: v-bind('node.position.x + "px"'); top: v-bind('node.position.y + "px"');
  border-radius: 12px; background: var(--node-bg, #1a1a2e);
  border: 2px solid var(--stage-1, #f59e0b);
  box-shadow: 0 4px 20px rgba(0,0,0,0.3); font-size: 12px;
  user-select: none; cursor: pointer;
  &.selected { box-shadow: 0 0 0 3px rgba(245,158,11,0.3); }
  &.processing { border-color: rgba(245,158,11,0.5); }
}
.node-header { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); font-weight: 600; }
.node-icon { font-size: 14px; }
.node-title { flex: 1; color: var(--text-primary, #e2e8f0); }
.node-status { font-size: 10px; color: var(--text-muted, #64748b); }
.node-body {
  padding: 10px 12px;
  max-height: 400px;
  overflow-y: auto;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
  &::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
}
.idea-input {
  width: 100%; min-height: 48px; resize: vertical;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; padding: 8px; color: #e2e8f0; font-size: 12px;
  outline: none; font-family: inherit;
  &:focus { border-color: rgba(245,158,11,0.5); }
  &::placeholder { color: #64748b; }
}
.design-summary {
  margin: 8px 0; padding: 6px 8px; background: rgba(245,158,11,0.08); border-radius: 6px;
  color: #fbbf24; font-size: 11px; line-height: 1.4; cursor: text;
  &:hover { background: rgba(245,158,11,0.13); }
}
.edit-input-concept {
  width: 100%; min-height: 50px; resize: vertical; box-sizing: border-box;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(245,158,11,0.5);
  border-radius: 6px; padding: 6px 8px; color: #fbbf24; font-size: 11px;
  font-family: inherit; outline: none; margin: 8px 0;
  &:focus { border-color: #f59e0b; }
}
.design-detail {
  margin-bottom: 8px; background: rgba(245,158,11,0.04); border-radius: 6px;
  border: 1px solid rgba(245,158,11,0.15);
}
.detail-toggle {
  padding: 6px 8px; font-size: 11px; color: #fbbf24; user-select: none;
  font-weight: 500; display: flex; justify-content: space-between; align-items: center;
}
.toggle-clickable { cursor: pointer; &:hover { color: #fde68a; } }
.toggle-actions { display: flex; gap: 8px; }
.btn-link {
  background: none; border: none; cursor: pointer; font-size: 10px;
  color: #67e8f9; padding: 2px 6px; border-radius: 4px;
  &:hover { background: rgba(103, 232, 249, 0.1); }
}
.btn-save { color: #34d399; &:hover { background: rgba(52, 211, 153, 0.1); } }

.detail-body {
  padding: 4px 10px 10px; font-size: 11px; color: #cbd5e1; line-height: 1.55;
  max-height: 320px; overflow-y: auto;
}
.edit-body { max-height: 420px; }
.detail-row { margin-top: 6px; }
.detail-row b { color: #fbbf24; font-weight: 600; }
.detail-row em { color: #94a3b8; font-style: normal; font-size: 10px; }
.detail-row ul { margin: 4px 0 0; padding-left: 18px; }
.detail-row li { margin: 2px 0; }

.edit-row { margin-top: 8px; }
.edit-row > label {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 10px; color: #fbbf24; font-weight: 600; margin-bottom: 3px;
}
.edit-input {
  width: 100%; box-sizing: border-box;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px; padding: 4px 6px; color: #e2e8f0; font-size: 11px;
  outline: none; font-family: inherit; line-height: 1.4;
  &:focus { border-color: rgba(245,158,11,0.5); }
  &::placeholder { color: #64748b; }
}
textarea.edit-input { min-height: 40px; resize: vertical; }

.list-editor { display: flex; flex-direction: column; gap: 4px; }
.list-row { display: flex; gap: 4px; align-items: center; }
.rule-row { display: flex; flex-direction: column; gap: 3px; padding: 4px; background: rgba(0,0,0,0.15); border-radius: 4px; }
.rule-row-line { display: flex; gap: 4px; align-items: center; }
.rule-trigger, .rule-action { flex: 1; min-width: 0; }
.rule-arrow { color: #64748b; font-size: 11px; }
.rule-desc { min-height: 30px; font-size: 10px; }

.btn-mini {
  background: rgba(99, 102, 241, 0.2); color: #a5b4fc; border: none;
  border-radius: 3px; cursor: pointer; padding: 2px 6px; font-size: 10px;
  &:hover { background: rgba(99, 102, 241, 0.35); }
}
.btn-danger {
  background: rgba(248, 113, 113, 0.15); color: #f87171;
  &:hover { background: rgba(248, 113, 113, 0.3); }
}
.empty-tip { font-size: 10px; color: #64748b; font-style: italic; padding: 4px 0; }

.action-row { display: flex; gap: 6px; flex-wrap: wrap; }
.btn { border: none; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 500; transition: all 0.15s; &:hover { transform: translateY(-1px); } &:disabled { opacity: 0.5; cursor: not-allowed; transform: none; } }
.btn-sm { padding: 5px 10px; }
.btn-primary { background: #6366f1; color: #fff; &:hover { background: #4f46e5; } }
.btn-art { background: rgba(6, 182, 212, 0.15); color: #67e8f9; border: 1px solid rgba(6, 182, 212, 0.3); &:hover { background: rgba(6, 182, 212, 0.25); } }
.full-w { width: 100%; margin-top: 8px; }
.hint-text { font-size: 10px; color: var(--text-muted, #64748b); margin-top: 6px; }
.orient-row {
  display: flex; gap: 8px; margin-bottom: 10px;
}
.orient-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 7px 10px; border-radius: 8px; cursor: pointer;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08);
  color: #94a3b8; font-size: 11px; font-weight: 500;
  transition: all 0.2s;
  &:hover {
    background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.15);
    color: #e2e8f0;
  }
  &.active {
    background: rgba(245,158,11,0.1); border-color: rgba(245,158,11,0.45);
    color: #fbbf24; font-weight: 600;
    box-shadow: 0 0 0 2px rgba(245,158,11,0.08);
  }
}
.orient-icon {
  font-size: 12px; line-height: 1; color: inherit;
  &.portrait { transform: scaleX(0.7) scaleY(1.1); }
  &.landscape { transform: scaleX(1.4) scaleY(0.65); }
}
</style>
