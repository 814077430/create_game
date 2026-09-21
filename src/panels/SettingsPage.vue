<template>
  <div class="settings-page">
    <div class="settings-container">
      <!-- 关闭按钮 -->
      <button class="settings-close" @click="emit('close')" title="关闭设置">✕</button>
      <!-- 侧边导航 -->
      <nav class="settings-nav">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="nav-item"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <span class="nav-icon">{{ tab.icon }}</span>
          <span class="nav-label">{{ tab.label }}</span>
          <span class="nav-status" :class="tab.statusClass">{{ tab.status }}</span>
        </button>
      </nav>

      <!-- 内容区 -->
      <div class="settings-content">
       <!-- 平台介绍 -->
        <section v-if="activeTab === 'about'" class="tab-panel">
          <div class="panel-header">
            <h3>平台介绍</h3>
            <p class="panel-desc">GameForge —— AI 驱动的无代码游戏创作平台</p>
          </div>
          <div class="about-section">
            <h4>平台简介</h4>
            <p>GameForge 是一个基于 AI 的游戏快速生成平台，通过自然语言描述即可自动完成从创意构思到可运行游戏的全流程。无需编程基础，只需要一个好点子！</p>
          </div>
          <div class="about-section">
            <h4>核心流程</h4>
            <div class="flow-steps">
              <div class="flow-step"><span class="step-num">1</span><div class="step-body"><strong>创意/玩法</strong><p>在画布中双击创建项目，输入游戏创意描述，AI 会生成完整的设计文档</p></div></div>
              <div class="flow-step"><span class="step-num">2</span><div class="step-body"><strong>模块拆分</strong><p>AI 自动将游戏设计拆分为功能模块：核心玩法、UI、音效等</p></div></div>
              <div class="flow-step"><span class="step-num">3</span><div class="step-body"><strong>美术生成</strong><p>AI 根据设计文档自动生成角色、场景、UI 等美术资源</p></div></div>
              <div class="flow-step"><span class="step-num">4</span><div class="step-body"><strong>代码生成</strong><p>AI 结合设计与美术，生成完整可运行的游戏代码</p></div></div>
              <div class="flow-step"><span class="step-num">5</span><div class="step-body"><strong>部署/测试</strong><p>自动打包为可运行的 HTML 游戏，支持在线预览和分享</p></div></div>
            </div>
          </div>
          <div class="about-section">
            <h4>使用方式</h4>
            <ul class="about-list">
              <li><strong>开始创作：</strong>在「创意画布」页签中，双击空白处即可创建项目并开始</li>
              <li><strong>输入创意：</strong>在创意节点中描述你想要的游戏（如"横版三消游戏"、"太空射击"）</li>
              <li><strong>一键生成：</strong>点击节点上的生成按钮，AI 会自动流转到下一阶段</li>
              <li><strong>预览游戏：</strong>生成完成后在「游戏广场」中打开游戏预览</li>
              <li><strong>配置 API：</strong>首次使用请先在「API 配置」中填入百炼 API Key</li>
            </ul>
          </div>
          <div class="about-section">
            <h4>支持的游戏类型</h4>
            <div class="tag-list">
              <span class="about-tag">三消/消除</span>
              <span class="about-tag">跑酷/躲避</span>
              <span class="about-tag">射击/弹幕</span>
              <span class="about-tag">平台跳跃</span>
              <span class="about-tag">塔防/策略</span>
              <span class="about-tag">卡牌/养成</span>
              <span class="about-tag">物理弹射</span>
              <span class="about-tag">解谜/冒险</span>
            </div>
          </div>
          <!-- 项目信息 -->
          <div class="about-section">
            <h4>当前项目</h4>
            <div v-if="projStore.hasProject" class="project-card">
              <div class="project-info">
                <span class="project-name">{{ projStore.projectName }}</span>
                <span class="project-time">{{ formatDate(projStore.project?.createdAt) }}</span>
              </div>
              <span class="orient-badge" :class="projStore.orientation">{{ orientationLabel(projStore.orientation) }}</span>
            </div>
            <p v-else style="font-size:13px;color:#64748b;margin:0;">还未创建项目，在「创意画布」中双击即可自动创建</p>
          </div>
          <div class="about-section">
            <h4>项目目录结构</h4>
            <div class="dir-tree">
              <div class="tree-item" v-for="d in dirPreview" :key="d.name">
                <span class="tree-icon">{{ d.icon }}</span>
                <span class="tree-name">{{ d.name }}/</span>
                <span class="tree-desc">{{ d.desc }}</span>
              </div>
            </div>
          </div>
          <div class="about-section">
            <h4>快捷键</h4>
            <div class="shortcut-list">
              <div class="shortcut-item"><kbd>双击画布</kbd><span>创建新项目 / 新建创意节点</span></div>
              <div class="shortcut-item"><kbd>双击项目名</kbd><span>编辑项目名称</span></div>
              <div class="shortcut-item"><kbd>滚轮</kbd><span>缩放画布</span></div>
              <div class="shortcut-item"><kbd>拖拽空白</kbd><span>平移画布</span></div>
            </div>
          </div>
        </section>

        <!-- 百炼 API 配置 -->
        <section v-if="activeTab === 'api'" class="tab-panel">
          <div class="panel-header">
            <h3>百炼 API 配置</h3>
            <p class="panel-desc">统一使用阿里云百炼平台，一个 Key 即可使用所有模型</p>
          </div>
          <div class="field-group">
            <label class="field-label">API KEY</label>
            <input class="input-field input-password" v-model="localSettings.apiKey" type="password" placeholder="sk-..." />
            <p class="field-hint">在 <a href="https://bailian.console.aliyun.com" target="_blank">百炼控制台</a> 获取 API Key</p>
          </div>
          <div class="field-group">
            <label class="field-label">LLM 模型（创意推理）</label>
            <input class="input-field" v-model="localSettings.llmModel" placeholder="例如 qwen-max" />
            <div class="model-hints">
              <span class="hint-chip" v-for="m in llmModels" :key="m" @click="localSettings.llmModel = m">{{ m }}</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">代码模型（代码生成）</label>
            <input class="input-field" v-model="localSettings.codeModel" placeholder="例如 qwen-coder-plus" />
            <div class="model-hints">
              <span class="hint-chip" v-for="m in codeModels" :key="m" @click="localSettings.codeModel = m">{{ m }}</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">图像模型（美术生成）</label>
            <input class="input-field" v-model="localSettings.imageModel" placeholder="例如 wanx2.1-t2i-turbo" />
            <div class="model-hints">
              <span class="hint-chip" v-for="m in imageModels" :key="m" @click="localSettings.imageModel = m">{{ m }}</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">视频模型（序列帧动画）</label>
            <input class="input-field" v-model="localSettings.videoModel" placeholder="例如 wan3.0-video-prime" />
            <div class="model-hints">
              <span class="hint-chip" v-for="m in videoModels" :key="m" @click="localSettings.videoModel = m">{{ m }}</span>
            </div>
            <p class="field-hint">用于角色/怪物的高质量序列帧动画（静图→视频→抽帧），留空则回退到纯图片序列帧</p>
          </div>
          <div class="action-row">
            <button class="btn-primary" @click="onSaveSettings">保存配置</button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useSettingsStore, type AppSettings } from '@/stores/settings'
import { useProjectStore, type GameOrientation } from '@/stores/project'

const settingsStore = useSettingsStore()
const projStore = useProjectStore()

const emit = defineEmits<{ (e: 'close'): void }>()

const activeTab = ref('about')
const localSettings = ref<AppSettings>({ ...settingsStore.settings })

function orientationLabel(o: GameOrientation) {
  return o === 'landscape' ? '横版' : '竖版'
}

watch(() => settingsStore.settings, (v) => { localSettings.value = { ...v } }, { deep: true })

// 打开设置页时刷新项目列表
projStore.refreshProjectList()

const tabs = computed(() => [
  { key: 'about', icon: '📖', label: '平台介绍', status: '', statusClass: '' },
  { key: 'api', icon: '🔑', label: 'API 配置', status: settingsStore.isConfigured() ? '已配置' : '未配置', statusClass: settingsStore.isConfigured() ? 'ok' : 'warn' },
])

const llmModels = ['qwen3.8-max', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-max', 'qwen3.6-plus']

const codeModels = ['qwen3.8-max', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-max', 'qwen3.6-plus']

const imageModels = ['qwen-image-3.0', 'qwen-image-2.0', 'z-image-turbo', 'wan2.7-image-pro']

const videoModels = ['wan3.0-video-prime', 'wan2.7-i2v', 'happyhorse-1.0-i2v']

const dirPreview = [
  { icon: '📝', name: 'design', desc: '创意/玩法设计文档' },
  { icon: '🧩', name: 'modules', desc: '功能模块拆分' },
  { icon: '🖼️', name: 'assets', desc: '美术资源图片' },
  { icon: '⚙️', name: 'code', desc: '游戏源代码' },
  { icon: '🚀', name: 'deploy', desc: '部署产出HTML' },
]

function onSaveSettings() {
  settingsStore.settings = { ...localSettings.value }
  ElMessage.success('配置已保存')
}

function formatDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`
}
</script>

<style lang="scss" scoped>
.settings-page {
  width: 100%; height: 100%;
  display: flex; align-items: flex-start; justify-content: center;
  padding: 40px 20px;
  overflow-y: auto;
  background: radial-gradient(ellipse at top, rgba(99,102,241,0.03) 0%, transparent 60%);
}

.settings-container {
  position: relative;
  display: flex; width: 100%; max-width: 800px;
  background: rgba(15,15,30,0.8);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  overflow: hidden;
}

.settings-close {
  position: absolute; top: 12px; right: 12px; z-index: 10;
  width: 28px; height: 28px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.04);
  color: #94a3b8; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
  &:hover { background: rgba(239,68,68,0.12); color: #f87171; border-color: rgba(239,68,68,0.3); }
}

.settings-nav {
  width: 180px; min-width: 180px;
  padding: 16px 8px;
  border-right: 1px solid rgba(255,255,255,0.04);
  background: rgba(0,0,0,0.2);
  display: flex; flex-direction: column; gap: 2px;
}
.nav-item {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 8px;
  border: none; background: transparent; color: #94a3b8;
  cursor: pointer; transition: all 0.15s; text-align: left; font-size: 13px;
  &:hover { background: rgba(255,255,255,0.04); color: #e2e8f0; }
  &.active { background: rgba(99,102,241,0.1); color: #a5b4fc; font-weight: 600; }
}
.nav-icon { font-size: 15px; }
.nav-label { flex: 1; }
.nav-status {
  font-size: 10px; padding: 2px 6px; border-radius: 6px;
  &.ok { background: rgba(16,185,129,0.12); color: #34d399; }
  &.warn { background: rgba(245,158,11,0.12); color: #fbbf24; }
}

.settings-content {
  flex: 1; padding: 28px 32px;
  overflow-y: auto; max-height: 600px;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
}

.tab-panel { animation: fadeIn 0.15s ease; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

.panel-header {
  margin-bottom: 24px;
  h3 { margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #f1f5f9; }
  .panel-desc { margin: 0; font-size: 13px; color: #64748b; }
}

.field-group { margin-bottom: 20px; }
.field-label {
  display: block; font-size: 11px; font-weight: 600; color: #94a3b8;
  margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;
}
.field-hint {
  margin-top: 6px; font-size: 11px; color: #64748b;
  a { color: #818cf8; text-decoration: none; &:hover { text-decoration: underline; } }
}
.input-field {
  width: 100%; box-sizing: border-box; padding: 10px 14px;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px; color: #e2e8f0; font-size: 13px;
  outline: none; transition: all 0.2s; font-family: 'JetBrains Mono', monospace;
  &:focus { border-color: rgba(99,102,241,0.5); box-shadow: 0 0 0 3px rgba(99,102,241,0.08); }
  &::placeholder { color: #475569; }
}
.input-password { letter-spacing: 2px; }

.model-hints { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.hint-chip {
  padding: 3px 10px; font-size: 11px;
  border: 1px solid rgba(255,255,255,0.06); border-radius: 6px;
  background: rgba(255,255,255,0.02); color: #64748b;
  cursor: pointer; transition: all 0.15s;
  &:hover { background: rgba(99,102,241,0.1); color: #a5b4fc; border-color: rgba(99,102,241,0.3); }
}

.action-row { margin-top: 24px; }

// ─── 项目 ────────────────────────────────────────────────────────────────────
.project-card {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-radius: 10px;
  background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.15);
}
.project-info { display: flex; flex-direction: column; gap: 2px; }
.project-name { font-size: 14px; font-weight: 600; color: #a5b4fc; }
.project-time { font-size: 11px; color: #64748b; }
.project-create { display: flex; gap: 8px; align-items: center; }
.project-name-input { flex: 1; min-width: 0; }
.btn-nowrap { white-space: nowrap; flex-shrink: 0; }

// ─── 画面方向选择 ──────────────────────────────────────────────────────────────
.orientation-picker { display: flex; gap: 10px; margin-bottom: 10px; }
.orient-card {
  flex: 1; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 10px; cursor: pointer;
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08);
  color: #94a3b8; transition: all 0.15s; text-align: left;
  &:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.14); }
  &.active {
    background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.45);
    box-shadow: 0 0 0 3px rgba(99,102,241,0.08);
  }
}
.orient-glyph {
  font-size: 20px; line-height: 1; color: #a5b4fc;
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  &.landscape { transform: scaleX(1.6) scaleY(0.7); }
  &.portrait { transform: scaleY(1.1); }
}
.orient-text { display: flex; flex-direction: column; gap: 2px; }
.orient-name { font-size: 13px; font-weight: 600; color: #e2e8f0; }
.orient-desc { font-size: 10px; color: #64748b; }

.orient-badge {
  font-size: 10px; padding: 2px 8px; border-radius: 6px; white-space: nowrap;
  background: rgba(99,102,241,0.14); color: #a5b4fc;
  &.landscape { background: rgba(16,185,129,0.14); color: #34d399; }
  &.sm { font-size: 9px; padding: 1px 6px; }
}

.project-list {
  display: flex; flex-direction: column; gap: 4px;
  max-height: 160px; overflow-y: auto;
}
.project-list-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-radius: 8px;
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
  transition: all 0.15s;
  &:hover { background: rgba(255,255,255,0.04); }
  &.current { background: rgba(99,102,241,0.06); border-color: rgba(99,102,241,0.2); }
}
.project-list-info { display: flex; flex-direction: column; gap: 1px; }
.project-list-name { font-size: 12px; color: #e2e8f0; font-weight: 500; }
.project-list-time { font-size: 10px; color: #64748b; }
.current-badge {
  font-size: 10px; padding: 2px 8px; border-radius: 6px;
  background: rgba(16,185,129,0.12); color: #34d399;
}

.dir-tree {
  background: rgba(0,0,0,0.2); border-radius: 8px; padding: 10px 14px;
}
.tree-item {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 0; font-size: 12px;
}
.tree-icon { font-size: 13px; }
.tree-name { color: #a5b4fc; font-family: 'JetBrains Mono', monospace; font-weight: 500; }
.tree-desc { color: #64748b; }

// ─── 按钮 ────────────────────────────────────────────────────────────────────
.btn-primary {
  padding: 8px 20px; font-size: 13px; font-weight: 600;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; border: none; border-radius: 8px;
  cursor: pointer; transition: all 0.15s;
  &:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(99,102,241,0.3); }
}
.btn-ghost {
  padding: 6px 14px; font-size: 12px; font-weight: 500;
  background: transparent; color: #94a3b8; border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px; cursor: pointer; transition: all 0.15s;
  &:hover { background: rgba(255,255,255,0.04); color: #e2e8f0; }
}
.btn-sm { padding: 6px 12px; font-size: 12px; }

// ─── 平台介绍 ────────────────────────────────────────────────────────────────────────
.about-section {
  margin-bottom: 20px;
  h4 { font-size: 14px; font-weight: 600; color: #e2e8f0; margin: 0 0 8px; }
  p { font-size: 13px; color: #94a3b8; line-height: 1.7; margin: 0; }
}
.flow-steps {
  display: flex; flex-direction: column; gap: 6px;
}
.flow-step {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 10px 14px; border-radius: 10px;
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
}
.step-num {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; flex-shrink: 0;
  border-radius: 50%; background: rgba(99,102,241,0.15);
  color: #a5b4fc; font-size: 12px; font-weight: 700;
}
.step-body {
  strong { font-size: 13px; color: #e2e8f0; }
  p { font-size: 12px; color: #64748b; margin: 2px 0 0; }
}
.about-list {
  margin: 0; padding: 0 0 0 16px;
  li { font-size: 12px; color: #94a3b8; line-height: 2; }
  strong { color: #e2e8f0; }
}
.tag-list {
  display: flex; flex-wrap: wrap; gap: 8px;
}
.about-tag {
  padding: 4px 12px; font-size: 11px; border-radius: 6px;
  background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2);
  color: #a5b4fc;
}
.shortcut-list {
  display: flex; flex-direction: column; gap: 6px;
}
.shortcut-item {
  display: flex; align-items: center; gap: 12px; font-size: 12px;
  kbd {
    display: inline-block; padding: 3px 8px; border-radius: 4px;
    background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);
    color: #a5b4fc; font-family: inherit; font-size: 11px; min-width: 72px; text-align: center;
  }
  span { color: #94a3b8; }
}
</style>
