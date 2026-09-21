<template>
  <div class="app-container">
    <!-- 顶部导航栏 -->
    <header class="app-header">
      <div class="header-left">
        <h1 class="app-logo">🎮 GameForge</h1>
        <span class="project-badge" v-if="authStore.isLoggedIn && projStore.hasProject">
          <span class="badge-dot"></span>
          <input
            v-if="editingName"
            ref="nameInputRef"
            class="project-name-input"
            v-model="editNameValue"
            @blur="finishEditName"
            @keydown.enter="finishEditName"
            @keydown.escape="editingName = false"
          />
          <span v-else class="project-name-text">{{ projStore.projectName }}</span>
          <button class="edit-name-btn" @click="startEditName" title="修改项目名称">✏️</button>
        </span>
      </div>
      <nav class="header-nav">
        <button
          v-for="tab in visibleTabs"
          :key="tab.key"
          class="nav-tab"
          :class="{ active: activeTab === tab.key }"
          @click="onTabClick(tab.key)"
        >
          <span class="tab-icon">{{ tab.icon }}</span>
          <span class="tab-label">{{ tab.label }}</span>
        </button>
      </nav>
      <div class="header-right">
        <div class="pipeline-status" v-if="authStore.isLoggedIn && store.pipeline.status !== 'idle'">
          <span class="status-dot" :class="store.pipeline.status"></span>
          <span class="status-msg">{{ store.pipeline.message }}</span>
        </div>
        <!-- 未登录：显示登录按钮 -->
        <button v-if="!authStore.isLoggedIn" class="btn-login" @click="showLoginModal = true">登录</button>
        <!-- 已登录：显示用户信息 -->
        <div v-else class="user-info">
          <span class="user-name">{{ authStore.username }}</span>
          <button class="btn-logout" @click="onLogout">登出</button>
        </div>
      </div>
    </header>

    <!-- 页面内容 -->
    <main class="app-main">
      <CanvasEngine v-if="authStore.isLoggedIn" v-show="activeTab === 'canvas'" />
      <GamePlaza v-if="authStore.isLoggedIn && activeTab === 'plaza'" @navigate="activeTab = $event" />
      <GameRecommend v-if="activeTab === 'recommend'" />
      <SettingsPage v-if="authStore.isLoggedIn && activeTab === 'settings'" @close="activeTab = 'canvas'" />
    </main>
  </div>

  <!-- 登录弹窗 -->
  <div class="login-modal-overlay" v-if="showLoginModal" @click.self="showLoginModal = false">
    <LoginPage @success="onLoginSuccess" @close="showLoginModal = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useCanvasStore } from '@/stores/canvas'
import { useSettingsStore } from '@/stores/settings'
import { useProjectStore } from '@/stores/project'
import { useAuthStore } from '@/stores/auth'
import CanvasEngine from '@/canvas/CanvasEngine.vue'
import GamePlaza from '@/panels/GamePlaza.vue'
import GameRecommend from '@/panels/GameRecommend.vue'
import SettingsPage from '@/panels/SettingsPage.vue'
import LoginPage from '@/panels/LoginPage.vue'
import { ElMessage } from 'element-plus'

const store = useCanvasStore()
const settingsStore = useSettingsStore()
const projStore = useProjectStore()
const authStore = useAuthStore()

const activeTab = ref('recommend')
const showLoginModal = ref(false)
const editingName = ref(false)
const editNameValue = ref('')
const nameInputRef = ref<HTMLInputElement>()

const allTabs = [
  { key: 'canvas', icon: '🎨', label: '创意画布', auth: true },
  { key: 'plaza', icon: '📂', label: '我的作品', auth: true },
  { key: 'recommend', icon: '🔥', label: '游戏广场', auth: false },
  { key: 'settings', icon: '⚙️', label: '设置', auth: true },
]

const visibleTabs = computed(() => allTabs)

function onTabClick(key: string) {
  const tab = allTabs.find(t => t.key === key)
  if (tab?.auth && !authStore.isLoggedIn) {
    showLoginModal.value = true
    return
  }
  activeTab.value = key
}


onMounted(async () => {
  // Check existing session
  if (authStore.token) {
    await authStore.checkSession()
  }
  if (authStore.isLoggedIn) {
    await initApp()
  }
})

async function onLoginSuccess() {
  showLoginModal.value = false
  await initApp()
  // 登录成功后切到创意画布
  activeTab.value = 'canvas'
}

async function initApp() {
  // 登录成功后加载当前用户专属的设置（API Key 按用户隔离）
  settingsStore.reloadForCurrentUser()
  await store.hydrateFromStorage()
  if (!settingsStore.isConfigured()) {
    activeTab.value = 'settings'
  }
}

function onLogout() {
  authStore.logout()
  activeTab.value = 'recommend'
}

function startEditName() {
  editNameValue.value = projStore.projectName
  editingName.value = true
  nextTick(() => {
    nameInputRef.value?.focus()
    nameInputRef.value?.select()
  })
}

function finishEditName() {
  const newName = editNameValue.value.trim()
  editingName.value = false
  if (!newName || newName === projStore.projectName || !projStore.project) return
  projStore.renameProject(newName, authStore.username).then((result) => {
    if (result !== true) {
      ElMessage.error(typeof result === 'string' ? result : '重命名失败')
    } else {
      ElMessage.success('项目已重命名为「' + newName + '」')
    }
  })
}
</script>

<style lang="scss" scoped>
.app-container {
  width: 100vw; height: 100vh;
  display: flex; flex-direction: column;
  background: #0a0a14;
  color: #e2e8f0;
}

.app-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; height: 52px; min-height: 52px;
  background: linear-gradient(180deg, rgba(15,15,30,0.98) 0%, rgba(10,10,20,0.95) 100%);
  border-bottom: 1px solid rgba(99,102,241,0.08);
  backdrop-filter: blur(12px);
  z-index: 100;
}

.header-left { display: flex; align-items: center; gap: 12px; }
.app-logo {
  font-size: 16px; font-weight: 800; margin: 0;
  background: linear-gradient(135deg, #a5b4fc, #818cf8);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  letter-spacing: -0.3px;
}

.project-badge {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: #94a3b8;
  background: rgba(99,102,241,0.06); padding: 4px 10px;
  border-radius: 6px; border: 1px solid rgba(99,102,241,0.12);
}
.project-name-text {
  cursor: default;
}
.edit-name-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; margin-left: 4px;
  border: none; border-radius: 4px;
  background: rgba(255,255,255,0.06);
  font-size: 10px; cursor: pointer;
  transition: all 0.15s;
  &:hover { background: rgba(99,102,241,0.2); transform: scale(1.1); }
}
.project-name-input {
  background: rgba(0,0,0,0.4); border: 1px solid rgba(99,102,241,0.4);
  border-radius: 4px; color: #e2e8f0; font-size: 11px;
  padding: 2px 6px; width: 100px; outline: none;
}
.badge-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #10b981;
}

.header-nav {
  display: flex; gap: 2px;
  background: rgba(255,255,255,0.03);
  border-radius: 10px; padding: 3px;
}

.nav-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 16px; border-radius: 8px;
  border: none; background: transparent;
  color: #64748b; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.2s;
  &:hover { color: #94a3b8; background: rgba(255,255,255,0.04); }
  &.active {
    color: #e2e8f0; background: rgba(99,102,241,0.12);
    box-shadow: 0 1px 3px rgba(99,102,241,0.15);
    .tab-icon { transform: scale(1.1); }
  }
}
.tab-icon { font-size: 14px; transition: transform 0.2s; }

.header-right { display: flex; align-items: center; gap: 12px; }

.user-info {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: #94a3b8;
}
.user-name { font-weight: 500; }
.btn-logout {
  padding: 4px 10px; font-size: 11px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px; color: #94a3b8; cursor: pointer;
  &:hover { background: rgba(239,68,68,0.1); color: #f87171; border-color: rgba(239,68,68,0.3); }
}

.pipeline-status {
  display: flex; align-items: center; gap: 6px; font-size: 11px;
}
.status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  &.running { background: #f59e0b; animation: blink 1s infinite; }
  &.completed { background: #10b981; }
  &.error { background: #ef4444; }
}
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.status-msg { color: #64748b; }

.app-main { flex: 1; overflow: hidden; }

.btn-login {
  padding: 6px 16px; font-size: 12px; font-weight: 600;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; border: none; border-radius: 8px;
  cursor: pointer; transition: all 0.2s;
  &:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(99,102,241,0.3); }
}

.login-modal-overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.65);
  backdrop-filter: blur(4px);
}
</style>
