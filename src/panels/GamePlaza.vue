<template>
  <div class="plaza-page">
    <div class="plaza-header">
      <div class="plaza-title-area">
        <h2>我的作品</h2>
        <p>管理你的所有游戏项目，包括已完成和创作中的作品</p>
      </div>
    </div>

    <!-- 未发布区 -->
    <div class="plaza-section">
      <div class="section-header">
        <span class="section-icon">🔨</span>
        <h3>创作中</h3>
        <span class="section-count">{{ unpublishedGames.length }}</span>
      </div>
      <div class="plaza-grid">
        <!-- 创建项目卡片 -->
        <div class="game-card create-card" @click="onCreateProject">
          <div class="card-preview create-preview">
            <div class="plus-icon">+</div>
          </div>
          <div class="card-info">
            <span class="card-name">创建新项目</span>
            <span class="card-time">开始你的下一个作品</span>
          </div>
        </div>

        <div
          class="game-card"
          :class="{ landscape: game.orientation === 'landscape' }"
          v-for="game in unpublishedGames"
          :key="game.name"
        >
          <div
            class="card-preview"
            :class="{ 'has-thumb': game.thumbUrl, landscape: game.orientation === 'landscape' }"
            :style="game.thumbUrl ? { backgroundImage: `url(${game.thumbUrl})` } : undefined"
          >
            <div class="card-thumb" v-if="!game.thumbUrl">🎮</div>
            <div class="card-overlay">
              <span class="play-btn" v-if="game.hasHtml" @click.stop="onPlayGame(game)">▶ 打开游戏</span>
              <span class="play-btn wip" :class="{ disabled: loadingContinue }" @click.stop="!loadingContinue && onContinue(game)">✏️ {{ loadingContinue ? '加载中...' : '继续创作' }}</span>
              <span class="play-btn danger" @click.stop="onDeleteGame(game)">🗑️ 删除</span>
            </div>
          </div>
          <div class="card-info">
            <span class="card-name">{{ game.displayName }}</span>
            <div class="card-actions">
              <button
                class="btn-publish-sm"
                v-if="game.hasHtml"
                @click.stop="onPublish(game)"
              >🚀 发布</button>
              <span class="card-time">{{ formatDate(game.createdAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 已发布区 -->
    <div class="plaza-section" v-if="publishedGames.length > 0">
      <div class="section-header">
        <span class="section-icon">✅</span>
        <h3>已发布</h3>
        <span class="section-count">{{ publishedGames.length }}</span>
      </div>
      <div class="plaza-grid">
        <div
          class="game-card"
          :class="{ landscape: game.orientation === 'landscape' }"
          v-for="game in publishedGames"
          :key="game.name"
        >
          <div
            class="card-preview"
            :class="{ 'has-thumb': game.thumbUrl, landscape: game.orientation === 'landscape' }"
            :style="game.thumbUrl ? { backgroundImage: `url(${game.thumbUrl})` } : undefined"
          >
            <div class="card-thumb" v-if="!game.thumbUrl">🎮</div>
            <div class="card-overlay">
              <span class="play-btn" v-if="game.hasHtml" @click.stop="onPlayGame(game)">▶ 打开游戏</span>
              <span class="play-btn wip" :class="{ disabled: loadingContinue }" @click.stop="!loadingContinue && onContinue(game)">✏️ {{ loadingContinue ? '加载中...' : '继续创作' }}</span>
              <span class="play-btn danger" @click.stop="onDeleteGame(game)">🗑️ 删除</span>
            </div>
            <span class="published-badge">✓ 已发布</span>
          </div>
          <div class="card-info">
            <span class="card-name">{{ game.displayName }}</span>
            <div class="card-actions">
              <span class="card-time">{{ formatDate(game.createdAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div class="confirm-modal" v-if="deletingGame" @click.self="deletingGame = null">
      <div class="confirm-box">
        <div class="confirm-icon">⚠️</div>
        <h4>确认删除</h4>
        <p>确定要删除「{{ deletingGame.displayName }}」吗？<br/>此操作不可恢复，项目的所有文件将被清除。</p>
        <div class="confirm-actions">
          <button class="btn-cancel" @click="deletingGame = null">取消</button>
          <button class="btn-confirm-delete" @click="confirmDelete">确认删除</button>
        </div>
      </div>
    </div>

    <!-- 游戏播放弹窗 -->
    <div class="game-modal" v-if="playingGame" @click.self="playingGame = null">
      <div class="modal-content" :class="{ 'landscape-modal': playingGame.orientation === 'landscape' }">
        <div class="modal-header">
          <span class="modal-title">{{ playingGame.displayName }}</span>
          <button class="modal-close" @click="playingGame = null">✕</button>
        </div>
        <div class="phone-stage">
          <div class="phone-frame-lg" :class="{ landscape: playingGame.orientation === 'landscape' }">
            <div class="phone-notch-lg"></div>
            <div class="phone-screen-lg">
              <iframe
                v-if="playingGameUrl"
                :src="playingGameUrl"
                class="game-iframe"
                sandbox="allow-scripts allow-same-origin"
              ></iframe>
            </div>
            <div class="phone-home-lg"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useProjectStore } from '@/stores/project'
import { useCanvasStore } from '@/stores/canvas'
import { useAuthStore } from '@/stores/auth'
import { readFileFromLocal } from '@/api/storage'

interface GameInfo {
  name: string
  displayName: string
  createdAt: string
  hasHtml: boolean
  thumbUrl: string
  orientation: 'portrait' | 'landscape'
}

const projStore = useProjectStore()
const canvasStore = useCanvasStore()
const authStore = useAuthStore()
const games = ref<GameInfo[]>([])
const playingGame = ref<GameInfo | null>(null)
const playingGameUrl = ref('')
const publishedSet = ref<Set<string>>(new Set())
const deletingGame = ref<GameInfo | null>(null)
const loadingContinue = ref(false)

// 内存缓存，避免重复加载
let cachedOnce = false

const emit = defineEmits<{ (e: 'navigate', tab: string): void }>()

// 响应式计算已发布/未发布列表，解决并行加载竞态问题
const unpublishedGames = computed(() => games.value.filter((g) => !publishedSet.value.has(g.name)))
const publishedGames = computed(() => games.value.filter((g) => publishedSet.value.has(g.name)))

function onCreateProject() {
  projStore.createProject()
  emit('navigate', 'canvas')
}

onMounted(async () => {
  // 并行加载发布列表和项目摘要
  await Promise.all([loadPublishedGames(), loadGames()])
})

/** 加载已发布列表，用于标记已发布状态 */
async function loadPublishedGames() {
  try {
    const resp = await fetch('/__game-show/list')
    if (resp.ok) {
      const data = await resp.json()
      const myGames = (data.games || []).filter((g: any) => g.author === authStore.username)
      publishedSet.value = new Set(myGames.map((g: any) => g.id?.replace(`${authStore.username}_`, '') || ''))
    }
  } catch {}
}

async function loadGames() {
  try {
    // 使用批量接口，一次返回所有项目元数据
    const resp = await fetch(`/__api/project-summaries?user=${encodeURIComponent(authStore.username)}`)
    if (!resp.ok) return
    const data = await resp.json()
    const projects: Array<{ name: string; displayName: string; hasHtml: boolean; orientation: string; thumbFile: string }> = data.projects || []

    const result: GameInfo[] = projects.map((p) => {
      const thumbUrl = p.thumbFile
        ? `/__asset/${authStore.username}/${p.name}/assets/${p.thumbFile}`
        : ''
      return {
        name: p.name,
        displayName: p.displayName || p.name,
        createdAt: '',
        hasHtml: p.hasHtml,
        thumbUrl,
        orientation: (p.orientation as 'portrait' | 'landscape') || 'portrait',
      }
    })
    games.value = result
    cachedOnce = true
  } catch {}
}

async function onPublish(game: GameInfo) {
  try {
    const resp = await fetch('/__game-show/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: authStore.username,
        projectName: game.name,
        title: game.displayName,
        orientation: game.orientation,
      }),
    })
    const data = await resp.json()
    if (data.ok) {
      publishedSet.value.add(game.name)
      ElMessage.success(`游戏「${game.displayName}」已发布到推荐页！`)
    } else {
      ElMessage.error(data.error || '发布失败')
    }
  } catch {
    ElMessage.error('发布失败')
  }
}

async function onContinue(game: GameInfo) {
  // 防止重复点击：如果已在加载中，先清除之前的加载再开始新的
  loadingContinue.value = true
  // 先清空当前画布（同时使任何正在进行的异步加载失效）
  canvasStore.clearCanvas()
  try {
    await projStore.openProject(game.name)
    await canvasStore.loadFromProject()
    emit('navigate', 'canvas')
    if (canvasStore.nodes.length === 0) {
      ElMessage.warning(`「${game.displayName}」暂无流程文件，空画布已打开`)
    } else {
      ElMessage.success(`已进入「${game.displayName}」创作画布`)
    }
  } catch (e: any) {
    ElMessage.error('加载项目失败：' + (e?.message || e))
  } finally {
    loadingContinue.value = false
  }
}

async function onPlayGame(game: GameInfo) {
  playingGame.value = game
  try {
    const content = await readFileFromLocal(`${game.name}/deploy/game.html`)
    if (content) {
      const blob = new Blob([content], { type: 'text/html' })
      playingGameUrl.value = URL.createObjectURL(blob)
    }
  } catch {
    ElMessage.error('加载游戏失败')
  }
}

function onDeleteGame(game: GameInfo) {
  deletingGame.value = game
}

async function confirmDelete() {
  if (!deletingGame.value) return
  const name = deletingGame.value.name
  const wasPublished = publishedSet.value.has(deletingGame.value.name)
  try {
    const resp = await fetch('/__api/delete-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: authStore.username, projectName: name }),
    })
    const data = await resp.json()
    if (data.ok) {
      // 如果该作品已发布，同步删除游戏广场中的对应游戏
      if (wasPublished) {
        const gameId = `${authStore.username}_${name}`
        try {
          await fetch('/__game-show/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: authStore.username, gameId }),
          })
        } catch {}
        publishedSet.value.delete(name)
      }
      games.value = games.value.filter((g) => g.name !== name)
      ElMessage.success(`已删除「${deletingGame.value.displayName}」`)
    } else {
      ElMessage.error(data.error || '删除失败')
    }
  } catch {
    ElMessage.error('删除失败')
  }
  deletingGame.value = null
}

function formatDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<style lang="scss" scoped>
.plaza-page {
  width: 100%; height: 100%;
  padding: 32px 40px;
  overflow-y: auto;
  background: radial-gradient(ellipse at top center, rgba(99,102,241,0.04) 0%, transparent 50%);
}

.plaza-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 32px;
}
.plaza-title-area {
  h2 { margin: 0 0 4px; font-size: 22px; font-weight: 700; color: #f1f5f9; }
  p { margin: 0; font-size: 13px; color: #64748b; }
}

.btn-publish-sm {
  padding: 4px 10px; font-size: 11px; font-weight: 600;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; border: none; border-radius: 6px;
  cursor: pointer; transition: all 0.15s;
  &:hover { opacity: 0.85; }
}

.btn-publish-corner {
  position: absolute; bottom: 8px; right: 8px;
  padding: 4px 12px; font-size: 11px; font-weight: 600;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; border: none; border-radius: 6px;
  cursor: pointer; transition: all 0.15s;
  z-index: 2;
  box-shadow: 0 2px 8px rgba(99,102,241,0.4);
  &:hover { opacity: 0.9; transform: scale(1.05); }
}

.published-badge {
  position: absolute; top: 8px; left: 8px;
  font-size: 10px; padding: 2px 8px; border-radius: 6px;
  background: rgba(16,185,129,0.9); color: #fff; font-weight: 600;
}

.play-btn.wip {
  background: rgba(245,158,11,0.9);
}
.play-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
.play-btn.danger {
  background: rgba(239,68,68,0.9);
  &:hover { background: rgba(220,38,38,1); }
}

.card-actions {
  display: flex; align-items: center; gap: 6px;
}

.plaza-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
}

// ─── 分区样式 ───
.plaza-section {
  margin-bottom: 36px;
}
.section-header {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.section-icon { font-size: 18px; }
.section-header h3 {
  margin: 0; font-size: 15px; font-weight: 600; color: #e2e8f0;
}
.section-count {
  font-size: 11px; padding: 2px 10px; border-radius: 10px;
  background: rgba(99,102,241,0.15); color: #a5b4fc; font-weight: 600;
}

// ─── 创建项目卡片 ───
.create-card {
  border: 2px dashed rgba(99,102,241,0.3) !important;
  background: rgba(99,102,241,0.04) !important;
  &:hover {
    border-color: rgba(99,102,241,0.6) !important;
    background: rgba(99,102,241,0.08) !important;
    transform: translateY(-4px);
    box-shadow: 0 12px 30px rgba(99,102,241,0.15);
    .plus-icon { transform: scale(1.15) rotate(90deg); color: #a5b4fc; }
  }
}
.create-preview {
  height: 140px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, rgba(99,102,241,0.05), rgba(139,92,246,0.03)) !important;
}
.plus-icon {
  font-size: 72px; line-height: 1;
  color: rgba(99,102,241,0.5); font-weight: 200;
  transition: all 0.3s ease;
}

.game-card {
  border-radius: 12px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  overflow: hidden; cursor: pointer;
  transition: all 0.2s;
  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 30px rgba(0,0,0,0.3);
    border-color: rgba(99,102,241,0.2);
    .card-overlay { opacity: 1; }
  }
}

.card-preview {
  position: relative; height: 140px;
  background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.05));
  display: flex; align-items: center; justify-content: center;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}
.card-preview.has-thumb::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(10,10,18,0) 40%, rgba(10,10,18,0.55) 100%);
  pointer-events: none;
}
.card-thumb { font-size: 48px; }
.card-overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: rgba(0,0,0,0.5); opacity: 0;
  transition: opacity 0.2s;
}
.play-btn {
  padding: 6px 20px; border-radius: 20px;
  background: rgba(99,102,241,0.9); color: #fff;
  font-size: 12px; font-weight: 600;
  min-width: 110px; text-align: center;
}

.card-info {
  padding: 8px 10px;
  display: flex; justify-content: space-between; align-items: center;
}
.card-name { font-size: 13px; font-weight: 600; color: #e2e8f0; }
.card-time { font-size: 10px; color: #64748b; }

.plaza-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 20px; text-align: center;
}
.empty-icon { font-size: 64px; margin-bottom: 16px; opacity: 0.6; }
.plaza-empty h3 { margin: 0 0 8px; font-size: 18px; color: #94a3b8; font-weight: 600; }
.plaza-empty p { margin: 0; font-size: 13px; color: #64748b; max-width: 300px; }

// ─── 删除确认弹窗 ────────────────────────────────────────────────────────────
.confirm-modal {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(4px);
}
.confirm-box {
  width: 360px; padding: 32px;
  background: #1a1a2e; border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  text-align: center;
}
.confirm-icon { font-size: 40px; margin-bottom: 12px; }
.confirm-box h4 { margin: 0 0 8px; font-size: 18px; color: #f1f5f9; font-weight: 700; }
.confirm-box p { margin: 0 0 24px; font-size: 13px; color: #94a3b8; line-height: 1.7; }
.confirm-actions { display: flex; gap: 12px; justify-content: center; }
.btn-cancel {
  padding: 8px 20px; font-size: 13px; font-weight: 500;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px; color: #94a3b8; cursor: pointer; transition: all 0.15s;
  &:hover { background: rgba(255,255,255,0.1); color: #e2e8f0; }
}
.btn-confirm-delete {
  padding: 8px 20px; font-size: 13px; font-weight: 600;
  background: rgba(239,68,68,0.9); border: none;
  border-radius: 8px; color: #fff; cursor: pointer; transition: all 0.15s;
  &:hover { background: #dc2626; }
}

// ─── 游戏播放弹窗 ────────────────────────────────────────────────────────────
.game-modal {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.85);
  backdrop-filter: blur(4px);
}
.modal-content {
  width: auto; max-width: 95vw; height: 92vh;
  display: flex; flex-direction: column;
  background: #0f0f1a; border-radius: 16px;
  border: 1px solid rgba(99,102,241,0.15);
  box-shadow: 0 30px 80px rgba(0,0,0,0.6);
  overflow: hidden;
}
/* 横版弹窗：填满视窗，横屏手机尽量大 */
.modal-content.landscape-modal {
  width: 96vw;
  max-width: 96vw;
  height: 96vh;
  max-height: 96vh;
  .phone-stage {
    padding: 8px 12px;
  }
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.modal-title { font-size: 14px; font-weight: 600; color: #e2e8f0; }
.modal-close {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 6px; background: rgba(255,255,255,0.04);
  color: #64748b; cursor: pointer; font-size: 14px;
  &:hover { background: rgba(239,68,68,0.12); color: #f87171; }
}

// ─── 手机屏幕样式 ────────────────────────────────────────────────────────────
.phone-stage {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background:
    radial-gradient(ellipse at center, rgba(99,102,241,0.06) 0%, transparent 60%),
    #07070d;
}
.phone-frame-lg {
  position: relative;
  height: 100%;
  aspect-ratio: 9 / 19.5;
  max-width: 100%;
  background: linear-gradient(160deg, #1a1a22, #0d0d14);
  border-radius: 44px;
  padding: 16px 10px;
  box-sizing: border-box;
  box-shadow:
    inset 0 0 0 2px rgba(255,255,255,0.06),
    inset 0 0 0 4px rgba(0,0,0,0.6),
    0 30px 60px rgba(0,0,0,0.6),
    0 0 0 1px rgba(255,255,255,0.04);
}
/* 横版试玩：横屏手机外形 — 宽度优先撑满，高度自适应 */
.phone-frame-lg.landscape {
  width: 100%;
  height: auto;
  max-height: 100%;
  aspect-ratio: 19.5 / 9;
  border-radius: 44px;
  padding: 10px 18px;
  .phone-notch-lg {
    top: 50%; left: 12px; right: auto; bottom: auto;
    transform: translateY(-50%) translateX(0);
    width: 22px; height: 100px;
    border-radius: 0 14px 14px 0;
  }
  .phone-home-lg {
    top: 50%; left: auto; right: 8px; bottom: auto;
    transform: translateY(-50%);
    width: 4px; height: 90px;
    border-radius: 3px;
  }
  .phone-screen-lg {
    border-radius: 28px;
  }
}
.phone-notch-lg {
  position: absolute;
  top: 10px; left: 50%; transform: translateX(-50%);
  width: 110px; height: 22px;
  background: #000; border-radius: 0 0 16px 16px;
  z-index: 2;
}
.phone-home-lg {
  position: absolute;
  bottom: 6px; left: 50%; transform: translateX(-50%);
  width: 100px; height: 4px;
  background: rgba(255,255,255,0.4); border-radius: 3px;
}
.phone-screen-lg {
  width: 100%; height: 100%;
  border-radius: 30px;
  overflow: hidden;
  background: #000;
}
.game-iframe {
  width: 100%; height: 100%; border: none;
  background: #000;
  display: block;
}
</style>
