<template>
  <Teleport to="body">
    <div class="layout-editor" v-if="visible" @pointerdown.stop @wheel.stop>
      <!-- 顶栏 -->
      <div class="le-topbar">
        <span class="le-title">✥ 布局编辑</span>
        <span class="le-sub">{{ device.label }} · {{ frameW }}×{{ frameH }} · 设计 {{ designSize.width }}×{{ designSize.height }}</span>

        <div class="le-spacer"></div>

        <button class="le-btn" :class="{ on: editMode }" @click="toggleEdit">
          {{ editMode ? '✥ 编辑中' : '▶ 试玩中' }}
        </button>
        <button class="le-btn" :class="{ on: paused }" :disabled="!editMode" @click="togglePause">
          {{ paused ? '⏸ 已暂停' : '⏵ 运行' }}
        </button>

        <select class="le-select" v-model="deviceId">
          <option v-for="d in DEVICE_PRESETS" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>

        <label class="le-check"><input type="checkbox" v-model="opts.grid" @change="pushOptions" />网格</label>
        <label class="le-check"><input type="checkbox" v-model="opts.snap" @change="pushOptions" />吸附</label>
        <label class="le-check"><input type="checkbox" v-model="opts.safeArea" @change="pushOptions" />安全区</label>
        <label class="le-check"><input type="checkbox" v-model="opts.outlineAll" @change="pushOptions" />全部轮廓</label>
        <label class="le-check" title="拦截绘制调用，把静态文字 / 图标也变成可拖拽元素">
          <input type="checkbox" v-model="opts.paintProbe" @change="pushOptions" />文字/图标
        </label>

        <span class="le-zoom">显示 {{ Math.round(scale * 100) }}%</span>

        <button class="le-btn" :disabled="!store.canUndo" @click="doUndo">↶ 撤销</button>
        <button class="le-btn" :disabled="!store.canRedo" @click="doRedo">↷ 重做</button>
        <button class="le-btn" @click="reload">⟳ 重载</button>
        <button class="le-btn primary" :disabled="!store.dirty || store.saving" @click="doSave">
          {{ store.saving ? '保存中…' : store.dirty ? '💾 保存 (' + store.overrideCount + ')' : '✓ 已保存' }}
        </button>
        <button class="le-btn close" @click="requestClose">✕</button>
      </div>

      <div class="le-main">
        <!-- 左：1:1 设备框 -->
        <div class="le-stage" ref="stageRef">
          <div class="le-device-wrap" :style="{ width: frameW * scale + 'px', height: frameH * scale + 'px' }">
            <div
              class="le-device"
              :style="{
                width: frameW + 'px',
                height: frameH + 'px',
                borderRadius: device.radius + 'px',
                transform: 'scale(' + scale + ')',
              }"
            >
              <div class="le-notch" :class="{ landscape: isLandscape }"></div>
              <iframe
                v-if="frameSrc"
                ref="frameRef"
                class="le-frame"
                :src="frameSrc"
                sandbox="allow-scripts allow-same-origin"
                @load="onFrameLoad"
              />
              <div class="le-loading" v-else>正在装载游戏…</div>
              <div class="le-home" :class="{ landscape: isLandscape }"></div>
            </div>
          </div>
          <div class="le-stage-tip" v-if="!ready">等待游戏运行时就绪（G）…</div>
        </div>

        <!-- 右：Inspector -->
        <div class="le-inspector">
          <div class="le-sec">
            <div class="le-sec-title">画面</div>
            <select class="le-select w100" :value="currentScope" @change="onScopeChange">
              <optgroup label="场景">
                <option v-for="s in scopes" :key="s" :value="s">{{ scopeLabel(s) }}</option>
              </optgroup>
              <optgroup label="弹窗" v-if="popups.length">
                <option v-for="p in popups" :key="p" :value="'popup:' + p">popup:{{ p }}</option>
              </optgroup>
            </select>
            <div class="le-hint">
              每个画面都可选中编辑；切过去即可，不用在游戏里玩到那一步。<br />
              模式：{{ registry ? 'registry（源码已接入 G.Layout）' : 'probe（运行时扫描 *Rect）' }}
            </div>
          </div>

          <div class="le-sec grow">
            <div class="le-sec-title">
              元素 <span class="le-count">{{ shownElements.length }}/{{ elements.length }}</span>
              <input class="le-search" v-model="filterText" placeholder="筛选名称/文字" />
            </div>
            <div class="le-list">
              <div
                v-for="e in shownElements"
                :key="e.id"
                class="le-item"
                :class="{ active: e.id === selectedId, dirty: e.dirty, hidden: e.visible === false }"
                @click="selectElement(e.id)"
              >
                <span class="le-kind" :data-kind="e.kind">{{ kindIcon(e.kind) }}</span>
                <span class="le-name">{{ e.label }}</span>
                <span class="le-rect">{{ e.rect.w }}×{{ e.rect.h }}</span>
                <button
                  v-if="e.editable?.hide"
                  class="le-eye"
                  :title="e.visible === false ? '显示' : '隐藏'"
                  @click.stop="toggleVisible(e)"
                >{{ e.visible === false ? '⊘' : '◉' }}</button>
              </div>
              <div class="le-empty" v-if="!shownElements.length">
                {{ elements.length ? '无匹配的元素，清空筛选试试。'
                  : '当前画面未发现可编辑元素。切换画面，或开启「文字/图标」。' }}
              </div>
            </div>
          </div>

          <div class="le-sec" v-if="selected">
            <div class="le-sec-title">{{ selected.label }} <span class="le-id">{{ selected.id }}</span></div>
            <div class="le-hint" v-if="selected.origin === 'paint'">
              {{ selected.kind === 'text' ? '绘制文字' : '绘制图标' }}（探针捕获）·
              {{ selected.kind === 'text' ? '缩放即改字号' : '可自由改尺寸' }}
            </div>
            <div class="le-row">
              <label>锚点</label>
              <select class="le-select" :value="selected.anchor" @change="onAnchorChange">
                <option v-for="a in ANCHORS" :key="a" :value="a">{{ a }}</option>
              </select>
            </div>
            <div class="le-grid2">
              <div class="le-row"><label>X</label><input type="number" :value="selected.rect.x" @change="onNum('x', $event)" /></div>
              <div class="le-row"><label>Y</label><input type="number" :value="selected.rect.y" @change="onNum('y', $event)" /></div>
              <template v-if="isScaleMode">
                <div class="le-row">
                  <label>缩放</label>
                  <input type="number" step="5" :value="scalePercent" @change="onScale($event)" />
                </div>
                <div class="le-row ro"><label>尺寸</label><span>{{ selected.rect.w }}×{{ selected.rect.h }}</span></div>
              </template>
              <template v-else>
                <div class="le-row"><label>W</label><input type="number" :value="selected.rect.w" @change="onNum('w', $event)" /></div>
                <div class="le-row"><label>H</label><input type="number" :value="selected.rect.h" @change="onNum('h', $event)" /></div>
              </template>
            </div>
            <div class="le-align">
              <button class="le-btn xs" @click="align('left')">⇤ 左</button>
              <button class="le-btn xs" @click="align('hcenter')">↔ 水平居中</button>
              <button class="le-btn xs" @click="align('right')">右 ⇥</button>
              <button class="le-btn xs" @click="align('top')">⇧ 上</button>
              <button class="le-btn xs" @click="align('vcenter')">↕ 垂直居中</button>
              <button class="le-btn xs" @click="align('bottom')">下 ⇩</button>
            </div>
            <div class="le-align">
              <button class="le-btn xs" :disabled="!selected.dirty" @click="resetElement">↺ 复位此元素</button>
              <button class="le-btn xs" @click="resetScope">↺ 复位本画面</button>
              <button class="le-btn xs danger" @click="resetAll">↺ 全部复位</button>
            </div>
            <div class="le-hint">
              拖拽移动 · 拖手柄缩放（Shift 等比）· 方向键 1px / Shift 10px
            </div>
          </div>

          <div class="le-sec warn" v-if="warnings.length">
            <div class="le-sec-title">提示 <button class="le-btn xs" @click="warnings = []">清空</button></div>
            <div class="le-warn-item" v-for="(w, i) in warnings.slice(0, 6)" :key="i">⚠ {{ w }}</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUiLayoutStore } from '@/stores/uiLayout'
import { useProjectStore } from '@/stores/project'
import {
  GF_NS,
  GF_VER,
  DEVICE_PRESETS,
  DEFAULT_DEVICE_ID,
  getDevice,
  newSessionId,
  upsertEditorBlock,
  upsertLayoutBlock,
  type GFAnchor,
  type GFLayoutElement,
  type GFRect,
} from '@/api/liveEdit'

const props = defineProps<{
  visible: boolean
  /** 部署节点的 blob url，作为读取 deploy/game.html 失败时的兜底来源 */
  sourceUrl?: string
  /** 横版游戏：设备框旋转 90° */
  isLandscape?: boolean
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const ANCHORS: GFAnchor[] = [
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]

/** 场景 id → 人话名称（匹不上就直接显示 id） */
const SCOPE_LABELS: Record<string, string> = {
  boot: '加载页', loading: '加载页',
  title: '标题页', home: '主页', menu: '菜单页',
  gameplay: '游戏中', game: '游戏中', battle: '战斗中',
  settle: '结算页', result: '结算页', gameover: '结算页', over: '结算页',
  shop: '商店', level: '关卡选择', levels: '关卡选择', select: '选择页',
}
function scopeLabel(s: string) {
  const name = SCOPE_LABELS[s]
  return name ? `${s}（${name}）` : s
}

const store = useUiLayoutStore()
const projStore = useProjectStore()

const frameRef = ref<HTMLIFrameElement | null>(null)
const stageRef = ref<HTMLDivElement | null>(null)

const deviceId = ref(DEFAULT_DEVICE_ID)
const device = computed(() => getDevice(deviceId.value))
/** 设备框像素尺寸（横版交换宽高，保证 1:1 呈现真实屏幕） */
const frameW = computed(() => (props.isLandscape ? device.value.height : device.value.width))
const frameH = computed(() => (props.isLandscape ? device.value.width : device.value.height))

const sid = ref('')
const frameSrc = ref('')
let blobUrl = ''

const ready = ref(false)
const editMode = ref(true)
const paused = ref(true)
const opts = reactive({ grid: true, gridSize: 8, snap: true, safeArea: true, outlineAll: true, paintProbe: true })

const registry = ref(false)
const designSize = ref({ width: 750, height: 1334 })
const currentScope = ref('')
const scopes = ref<string[]>([])
const popups = ref<string[]>([])
const elements = ref<GFLayoutElement[]>([])
const selectedId = ref<string | null>(null)
const warnings = ref<string[]>([])
/** 元素列表筛选（文字探针打开后元素会变多） */
const filterText = ref('')
/** 重载后需要恢复的画面 */
let restoreScope = ''

const selected = computed(() => elements.value.find((e) => e.id === selectedId.value) || null)

const shownElements = computed(() => {
  const kw = filterText.value.trim().toLowerCase()
  if (!kw) return elements.value
  return elements.value.filter((e) =>
    `${e.label} ${e.id} ${e.sample || ''}`.toLowerCase().includes(kw)
  )
})

/** 文字类元素：改尺寸等于整体改字号，只暴露一个缩放比 */
const isScaleMode = computed(() => selected.value?.resizeMode === 'scale' && !!selected.value?.baseRect)
const scalePercent = computed(() => {
  const el = selected.value
  if (!el?.baseRect?.h) return 100
  return Math.round((el.rect.h / el.baseRect.h) * 100)
})

// 视口不足时整体等比缩小（仅视觉缩放，坐标由 agent 按实时 rect 换算，无偏移）
const scale = ref(1)
function recalcScale() {
  const el = stageRef.value
  if (!el) return
  const availW = el.clientWidth - 48
  const availH = el.clientHeight - 48
  if (availW <= 0 || availH <= 0) return
  scale.value = Math.min(1, availW / frameW.value, availH / frameH.value)
}

// ───── 通信 ─────

function post(type: string, payload: Record<string, any> = {}) {
  const w = frameRef.value?.contentWindow
  if (!w || !sid.value) return
  w.postMessage({ ns: GF_NS, v: GF_VER, sid: sid.value, type, payload }, '*')
}

function onMessage(e: MessageEvent) {
  const d: any = e.data
  if (!d || d.ns !== GF_NS || d.sid !== sid.value) return
  const p = d.payload || {}
  switch (d.type) {
    case 'ready':
      ready.value = true
      registry.value = !!p.registry
      if (p.designSize) applyDesignSize(p.designSize)
      scopes.value = p.scopes || []
      popups.value = p.popups || []
      post('applyOverrides', { scenes: store.plainScenes() })
      pushOptions()
      post('setMode', { edit: editMode.value, paused: paused.value })
      if (restoreScope) {
        post('gotoScope', { scope: restoreScope })
        restoreScope = ''
      }
      post('snapshot')
      break
    case 'snapshot':
      registry.value = !!p.registry
      if (p.designSize) applyDesignSize(p.designSize)
      if (p.scopes?.length) scopes.value = p.scopes
      if (p.popups) popups.value = p.popups
      currentScope.value = p.scope || ''
      elements.value = p.elements || []
      if (selectedId.value && !elements.value.some((el) => el.id === selectedId.value)) {
        selectedId.value = null
      }
      break
    case 'scopeChanged':
      currentScope.value = p.scope || ''
      selectedId.value = null
      break
    case 'selection':
      selectedId.value = p.id || null
      break
    case 'rectChanged': {
      store.setRect(p.scope, p.id, p.rect, p.anchor, !!p.commit)
      const el = elements.value.find((x) => x.id === p.id)
      if (el) {
        el.rect = p.rect
        el.anchor = p.anchor || el.anchor
        el.dirty = true
      }
      break
    }
    case 'hotkey':
      if (p.key === 'z') p.shift ? doRedo() : doUndo()
      else if (p.key === 'y') doRedo()
      else if (p.key === 's') doSave()
      break
    case 'warn':
      if (p.message && !warnings.value.includes(p.message)) warnings.value.unshift(p.message)
      break
  }
}

function applyDesignSize(size: { width: number; height: number }) {
  designSize.value = size
  store.setDesignSize(size)
}

function pushOptions() {
  post('setOptions', { ...opts })
}

// ───── 装载 / 重建 ─────

/** 取部署产物 HTML：优先项目目录（可跨会话），失败回退部署节点的 blob */
async function loadHtml(): Promise<string | null> {
  const fromDisk = await projStore.readFromProject('deploy', 'game.html')
  if (fromDisk && fromDisk.length > 200) return fromDisk
  if (props.sourceUrl) {
    try {
      const resp = await fetch(props.sourceUrl)
      if (resp.ok) return await resp.text()
    } catch {
      /* ignore */
    }
  }
  return null
}

let building = false
async function buildFrame() {
  if (building) return
  building = true
  ready.value = false
  elements.value = []
  selectedId.value = null
  try {
    const html = await loadHtml()
    if (!html) {
      ElMessage.error('未找到部署产物 game.html，请先完成部署阶段')
      emit('close')
      return
    }
    const injected = upsertEditorBlock(upsertLayoutBlock(html, store.plainLayout()))
    revokeBlob()
    blobUrl = URL.createObjectURL(new Blob([injected], { type: 'text/html' }))
    sid.value = newSessionId()
    frameSrc.value = `${blobUrl}#gfedit=${sid.value}`
    await nextTick()
    recalcScale()
  } finally {
    building = false
  }
}

function revokeBlob() {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl)
    blobUrl = ''
  }
}

function onFrameLoad() {
  // agent 会主动发 ready；此处仅兜底再拉一次快照
  window.setTimeout(() => post('snapshot'), 600)
}

/** 重新装载（复位 / 撤销后需要还原源码默认值时使用） */
async function rebuild(keepScope = true) {
  if (keepScope) restoreScope = currentScope.value
  await buildFrame()
}

function reload() {
  rebuild(true)
}

// ───── 操作 ─────

function toggleEdit() {
  editMode.value = !editMode.value
  if (!editMode.value) paused.value = false
  post('setMode', { edit: editMode.value, paused: paused.value })
}
function togglePause() {
  paused.value = !paused.value
  post('setMode', { edit: editMode.value, paused: paused.value })
}

function selectElement(id: string) {
  selectedId.value = id
  post('setFlag', { scope: currentScope.value, id, select: true })
}

function commitRect(rect: GFRect, anchor?: GFAnchor) {
  const el = selected.value
  if (!el) return
  const a = anchor || el.anchor
  store.setRect(el.scope || currentScope.value, el.id, rect, a, true)
  post('setRect', { scope: el.scope || currentScope.value, id: el.id, rect, anchor: a })
  el.rect = rect
  el.anchor = a
  el.dirty = true
}

function onNum(key: keyof GFRect, ev: Event) {
  const el = selected.value
  if (!el) return
  const v = Math.round(Number((ev.target as HTMLInputElement).value))
  if (!Number.isFinite(v)) return
  const rect: GFRect = { ...el.rect, [key]: key === 'w' || key === 'h' ? Math.max(8, v) : v }
  commitRect(rect)
}

/** 文字缩放：以源码默认尺寸为基准按百分比等比放缩，左上角不动 */
function onScale(ev: Event) {
  const el = selected.value
  const base = el?.baseRect
  if (!el || !base?.w || !base?.h) return
  const pct = Math.round(Number((ev.target as HTMLInputElement).value))
  if (!Number.isFinite(pct)) return
  const k = Math.min(600, Math.max(10, pct)) / 100
  commitRect({
    x: el.rect.x,
    y: el.rect.y,
    w: Math.max(8, Math.round(base.w * k)),
    h: Math.max(8, Math.round(base.h * k)),
  })
}

/** 隐藏 / 显示（仅绘制探针元素支持：直接跳过该次绘制） */
function toggleVisible(el: GFLayoutElement) {
  const scope = el.scope || currentScope.value
  const next = el.visible === false
  store.setFlag(scope, el.id, 'visible', next, el.rect, el.anchor)
  post('setFlag', { scope, id: el.id, visible: next })
  el.visible = next
  el.dirty = true
}

function onAnchorChange(ev: Event) {
  const el = selected.value
  if (!el) return
  commitRect({ ...el.rect }, (ev.target as HTMLSelectElement).value as GFAnchor)
}

function align(kind: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
  const el = selected.value
  if (!el) return
  const { width: W, height: H } = designSize.value
  const pad = Math.round(W * 0.045)
  const r = { ...el.rect }
  if (kind === 'left') r.x = pad
  else if (kind === 'hcenter') r.x = Math.round((W - r.w) / 2)
  else if (kind === 'right') r.x = W - pad - r.w
  else if (kind === 'top') r.y = Math.round(pad * 1.6)
  else if (kind === 'vcenter') r.y = Math.round((H - r.h) / 2)
  else r.y = Math.round(H - pad * 1.6 - r.h)
  commitRect(r)
}

function onScopeChange(ev: Event) {
  const sel = ev.target as HTMLSelectElement
  const scope = sel.value
  // 切换可能被代理拒绝（比如游戏没有独立加载页），先回正，等代理上报真实画面
  sel.value = currentScope.value
  post('gotoScope', { scope })
}

/**
 * 复位需要还原源码默认值：probe 模式下运行时已无原始值，
 * 统一走「去掉 override 后重新装载」这条最可靠的路径。
 */
async function resetElement() {
  const el = selected.value
  if (!el) return
  store.resetElement(el.scope || currentScope.value, el.id)
  await rebuild()
}
async function resetScope() {
  store.resetScope(currentScope.value)
  await rebuild()
}
async function resetAll() {
  try {
    await ElMessageBox.confirm('将清除本项目所有布局调整并恢复代码默认布局，确认？', '全部复位', {
      type: 'warning',
      confirmButtonText: '全部复位',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  store.resetAll()
  await rebuild()
}

async function doUndo() {
  if (!store.canUndo) return
  store.undo()
  await rebuild()
}
async function doRedo() {
  if (!store.canRedo) return
  store.redo()
  await rebuild()
}

async function doSave() {
  if (!store.dirty || store.saving) return
  const res = await store.save()
  if (res.ok) ElMessage.success(res.message)
  else ElMessage.error(res.message)
}

async function requestClose() {
  if (store.dirty) {
    try {
      await ElMessageBox.confirm('有未保存的布局调整，关闭前是否保存？', '未保存', {
        type: 'warning',
        confirmButtonText: '保存并关闭',
        cancelButtonText: '直接关闭',
        distinguishCancelAndClose: true,
      })
      const res = await store.save()
      if (!res.ok) {
        ElMessage.error(res.message)
        return
      }
      ElMessage.success(res.message)
    } catch (action) {
      if (action === 'close') return // 点右上角 ✕：什么都不做
    }
  }
  emit('close')
}

function onKeydown(ev: KeyboardEvent) {
  if (!props.visible) return
  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')) {
    ev.preventDefault()
    ev.shiftKey ? doRedo() : doUndo()
  } else if ((ev.ctrlKey || ev.metaKey) && (ev.key === 's' || ev.key === 'S')) {
    ev.preventDefault()
    doSave()
  } else if (ev.key === 'Escape') {
    ev.preventDefault()
    requestClose()
  }
}

function kindIcon(kind: string) {
  return kind === 'button' ? '⬢' : kind === 'icon' ? '◉' : kind === 'panel' ? '▤' : kind === 'hud' ? '◫' : kind === 'text' ? 'T' : kind === 'slot' ? '▦' : '▫'
}

// ───── 生命周期 ─────

let ro: ResizeObserver | null = null

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      warnings.value = []
      await store.load()
      await buildFrame()
      await nextTick()
      recalcScale()
      if (stageRef.value && typeof ResizeObserver !== 'undefined') {
        ro?.disconnect()
        ro = new ResizeObserver(() => recalcScale())
        ro.observe(stageRef.value)
      }
    } else {
      ro?.disconnect()
      ro = null
      frameSrc.value = ''
      sid.value = ''
      revokeBlob()
    }
  },
  { immediate: true }
)

watch([frameW, frameH], () => recalcScale())

onMounted(() => {
  window.addEventListener('message', onMessage)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', recalcScale)
})
onUnmounted(() => {
  window.removeEventListener('message', onMessage)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', recalcScale)
  ro?.disconnect()
  revokeBlob()
})
</script>

<style lang="scss" scoped>
.layout-editor {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(8, 10, 20, 0.94);
  backdrop-filter: blur(6px);
  display: flex; flex-direction: column;
  font-size: 12px; color: #e2e8f0;
  user-select: none;
}
.le-topbar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  background: rgba(20, 24, 40, 0.85);
  flex-wrap: wrap;
}
.le-title { font-weight: 700; color: #f0abfc; }
.le-sub { font-size: 11px; color: #94a3b8; }
.le-spacer { flex: 1; }
.le-zoom { font-size: 11px; color: #94a3b8; }

.le-btn {
  padding: 5px 10px; border-radius: 6px; cursor: pointer;
  font-size: 11px; font-weight: 500;
  background: rgba(255,255,255,0.07); color: #e2e8f0;
  border: 1px solid rgba(255,255,255,0.10);
  transition: all 0.15s;
  &:hover:not(:disabled) { background: rgba(255,255,255,0.14); }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
  &.on { background: rgba(236,72,153,0.22); border-color: rgba(236,72,153,0.55); color: #fbcfe8; }
  &.primary { background: #6366f1; border-color: #6366f1; color: #fff; &:hover:not(:disabled) { background: #4f46e5; } }
  &.close { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.35); color: #fca5a5; }
  &.danger { color: #fca5a5; border-color: rgba(239,68,68,0.3); }
  &.xs { padding: 3px 7px; font-size: 10px; }
}
.le-select {
  padding: 4px 6px; border-radius: 6px; font-size: 11px;
  background: rgba(0,0,0,0.35); color: #e2e8f0;
  border: 1px solid rgba(255,255,255,0.12); outline: none;
  &.w100 { width: 100%; }
}
.le-check {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; color: #cbd5e1; cursor: pointer;
  input { accent-color: #6366f1; }
}

.le-main { flex: 1; min-height: 0; display: flex; }
.le-stage {
  flex: 1; min-width: 0;
  display: flex; align-items: center; justify-content: center;
  position: relative; overflow: hidden;
  background:
    radial-gradient(circle at 50% 40%, rgba(99,102,241,0.10), transparent 60%),
    repeating-linear-gradient(45deg, rgba(255,255,255,0.015) 0 10px, transparent 10px 20px);
}
.le-device-wrap { position: relative; }
.le-device {
  position: absolute; top: 0; left: 0;
  transform-origin: top left;
  background: #0a0a12;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10), 0 24px 60px rgba(0,0,0,0.6), 0 0 0 6px #15151c;
  overflow: hidden;
}
.le-frame {
  width: 100%; height: 100%; border: none; display: block; background: #0a0a12;
}
.le-loading {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #64748b; font-size: 12px;
}
.le-notch {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  width: 110px; height: 26px; background: #000; border-radius: 14px; z-index: 5;
  pointer-events: none;
  &.landscape { top: 50%; left: 8px; transform: translateY(-50%); width: 26px; height: 110px; }
}
.le-home {
  position: absolute; bottom: 7px; left: 50%; transform: translateX(-50%);
  width: 130px; height: 4px; background: rgba(255,255,255,0.4); border-radius: 2px; z-index: 5;
  pointer-events: none;
  &.landscape { bottom: 50%; left: auto; right: 7px; transform: translateY(50%); width: 4px; height: 130px; }
}
.le-stage-tip {
  position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
  font-size: 11px; color: #94a3b8;
}

.le-inspector {
  width: 300px; flex: none;
  border-left: 1px solid rgba(255,255,255,0.08);
  background: rgba(16, 19, 32, 0.9);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.le-sec {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  &.grow { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  &.warn { background: rgba(245,158,11,0.06); }
}
.le-sec-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 600; color: #a5b4fc; margin-bottom: 6px;
}
.le-count, .le-id { font-weight: 400; color: #64748b; font-size: 10px; }
.le-hint { margin-top: 6px; font-size: 10px; color: #64748b; line-height: 1.5; }
.le-search {
  margin-left: auto; width: 96px; padding: 2px 6px;
  background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 5px; color: #e2e8f0; font-size: 10px; outline: none;
  &:focus { border-color: rgba(99,102,241,0.6); }
}

.le-list {
  flex: 1; min-height: 0; overflow-y: auto;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
}
.le-item {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 6px; border-radius: 5px; cursor: pointer;
  border: 1px solid transparent;
  &:hover { background: rgba(255,255,255,0.05); }
  &.active { background: rgba(236,72,153,0.16); border-color: rgba(236,72,153,0.45); }
  &.dirty .le-name { color: #fbbf24; }
  &.hidden .le-name { color: #64748b; text-decoration: line-through; }
}
.le-eye {
  padding: 0 3px; background: transparent; border: none; cursor: pointer;
  color: #64748b; font-size: 11px; line-height: 1;
  &:hover { color: #a5b4fc; }
}
.le-kind { width: 14px; text-align: center; color: #67e8f9; font-size: 11px; }
.le-name { flex: 1; font-size: 11px; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.le-rect { font-size: 10px; color: #64748b; font-family: 'JetBrains Mono', monospace; }
.le-empty { padding: 10px 4px; font-size: 10px; color: #64748b; line-height: 1.6; }

.le-row {
  display: flex; align-items: center; gap: 6px; margin-bottom: 6px;
  label { width: 30px; font-size: 10px; color: #94a3b8; }
  &.ro span { flex: 1; font-size: 10px; color: #94a3b8; font-family: 'JetBrains Mono', monospace; }
  input {
    flex: 1; min-width: 0; padding: 4px 6px;
    background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 5px; color: #e2e8f0; font-size: 11px; outline: none;
    font-family: 'JetBrains Mono', monospace;
    &:focus { border-color: rgba(99,102,241,0.6); }
  }
  select { flex: 1; }
}
.le-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }
.le-align { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.le-warn-item { font-size: 10px; color: #fcd34d; line-height: 1.6; }
</style>
