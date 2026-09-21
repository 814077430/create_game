<template>
  <div class="recommend-container" ref="containerRef">
    <!-- 空状态 -->
    <div class="recommend-empty" v-if="games.length === 0">
      <div class="empty-icon">🎮</div>
      <h3>暂无推荐</h3>
      <p>完成游戏创作并发布后，这里会展示你的作品</p>
    </div>

    <!-- 抖音风格全屏滑动 -->
    <div
      class="swipe-wrapper"
      v-else
      ref="swipeRef"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @wheel="onWheel"
      :style="{ transform: `translateY(${translateY}px)`, transition: isAnimating ? 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none' }"
    >
      <div
        class="swipe-page"
        v-for="(game, index) in games"
        :key="game.id"
        :class="{ active: index === currentIndex }"
      >
        <!-- 游戏画面区域（iPad 风格居中） -->
        <div class="game-showcase">
          <!-- 游戏运行画面 -->
          <div class="game-frame" :class="{ landscape: game.orientation === 'landscape' }">
            <iframe
              v-if="index === currentIndex && gameUrls[game.id]"
              :src="gameUrls[game.id]"
              class="game-iframe"
              frameborder="0"
              allow="autoplay"
              sandbox="allow-scripts"
            ></iframe>
            <div class="game-cover" v-else>
              <div
                class="cover-bg"
                :style="game.thumbUrl ? { backgroundImage: `url(${game.thumbUrl})` } : {}"
              ></div>
              <div class="cover-play" @click="playGame(game)">
                <span class="play-icon">▶</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧社交按钮（TikTok 风格） -->
        <div class="social-bar">
          <div class="social-btn" :class="{ liked: isLiked(game.id) }" @click="toggleLike(game.id)">
            <span class="btn-icon">{{ isLiked(game.id) ? '❤️' : '🤍' }}</span>
            <span class="btn-count">{{ getLikes(game.id) }}</span>
          </div>
          <div class="social-btn" @click="openComments(game)">
            <span class="btn-icon">💬</span>
            <span class="btn-count">{{ getComments(game.id).length }}</span>
          </div>
          <div class="social-btn" @click="shareGame(game)">
            <span class="btn-icon">↗</span>
            <span class="btn-count">分享</span>
          </div>
          <div class="social-btn delete-btn" v-if="isMyGame(game)" @click="onDeleteGame(game)">
            <span class="btn-icon">🗑️</span>
            <span class="btn-count">删除</span>
          </div>
        </div>

        <!-- 底部游戏信息 -->
        <div class="game-info-bar">
          <div class="game-author">
            <div class="author-avatar">🧑‍💻</div>
            <span class="author-name">@{{ game.author }}</span>
          </div>
          <div class="game-title">{{ game.displayName }}</div>
          <div class="game-desc">{{ game.orientation === 'landscape' ? '横版游戏' : '竖版游戏' }} · 本地创作</div>
        </div>

        <!-- 底部进度指示器 -->
        <div class="page-indicator">
          <span class="current">{{ index + 1 }}</span>
          <span class="sep">/</span>
          <span class="total">{{ games.length }}</span>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div class="confirm-modal" v-if="deletingGame" @click.self="deletingGame = null">
      <div class="confirm-box">
        <div class="confirm-icon">⚠️</div>
        <h4>确认删除</h4>
        <p>确定要从游戏广场删除「{{ deletingGame.displayName }}」吗？<br/>此操作会将该游戏从推荐列表移除。</p>
        <div class="confirm-actions">
          <button class="btn-cancel" @click="deletingGame = null">取消</button>
          <button class="btn-confirm-delete" @click="confirmDeleteGame">确认删除</button>
        </div>
      </div>
    </div>

    <!-- 评论弹窗 -->
    <div class="comment-modal" v-if="showComments" @click.self="showComments = false">
      <div class="comment-panel">
        <div class="comment-header">
          <h3>评论 ({{ currentComments.length }})</h3>
          <button class="close-btn" @click="showComments = false">✕</button>
        </div>
        <div class="comment-list">
          <div class="comment-item" v-for="(c, i) in currentComments" :key="i">
            <div class="comment-avatar">😊</div>
            <div class="comment-body">
              <div class="comment-name">玩家</div>
              <div class="comment-text">{{ c.text }}</div>
              <div class="comment-time">{{ c.time }}</div>
            </div>
          </div>
          <div class="comment-empty" v-if="currentComments.length === 0">
            暂无评论，来说点什么吧~
          </div>
        </div>
        <div class="comment-input">
          <input
            v-model="commentText"
            placeholder="说点什么..."
            @keyup.enter="submitComment"
          />
          <button class="send-btn" @click="submitComment">发送</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

interface GameInfo {
  id: string
  name: string
  displayName: string
  thumbUrl: string
  orientation: 'portrait' | 'landscape'
  author: string
}

interface CommentData {
  text: string
  time: string
}

interface SocialData {
  likes: Record<string, number>
  liked: Record<string, boolean>
  comments: Record<string, CommentData[]>
}

const containerRef = ref<HTMLElement>()
const swipeRef = ref<HTMLElement>()
const games = ref<GameInfo[]>([])
const gameUrls = ref<Record<string, string>>({})
const currentIndex = ref(0)
const translateY = ref(0)
const isAnimating = ref(false)
const showComments = ref(false)
const commentText = ref('')
const commentingGame = ref<GameInfo | null>(null)
const deletingGame = ref<GameInfo | null>(null)

// 触摸滑动相关
let touchStartY = 0
let touchStartTime = 0
let isSwiping = false
let touchMoved = false  // 是否产生了有效移动

// localStorage 社交数据
const SOCIAL_KEY = 'gameforge_social_data'
const socialData = ref<SocialData>(loadSocialData())

function loadSocialData(): SocialData {
  try {
    const raw = localStorage.getItem(SOCIAL_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { likes: {}, liked: {}, comments: {} }
}

function saveSocialData() {
  localStorage.setItem(SOCIAL_KEY, JSON.stringify(socialData.value))
}

// 从 game-show 加载游戏列表
onMounted(async () => {
  await loadGames()
  if (games.value.length > 0) {
    await loadGameForIndex(0)
  }
})

onUnmounted(() => {
  Object.values(gameUrls.value).forEach((url) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  })
})

async function loadGames() {
  try {
    const resp = await fetch('/__game-show/list')
    if (!resp.ok) return
    const data = await resp.json()
    const result: GameInfo[] = []
    for (const g of (data.games || [])) {
      result.push({
        id: g.id,
        name: g.id,
        displayName: g.title || g.id,
        thumbUrl: g.thumbUrl || '',
        orientation: g.orientation || 'portrait',
        author: g.author || '匿名',
      })
    }
    games.value = result
  } catch {}
}

async function loadGameForIndex(index: number) {
  const game = games.value[index]
  if (!game || gameUrls.value[game.id]) return
  try {
    const resp = await fetch(`/__game-show/read?path=${encodeURIComponent(game.id + '/game.html')}`)
    if (resp.ok) {
      const data = await resp.json()
      if (data.content) {
        const blob = new Blob([data.content], { type: 'text/html' })
        gameUrls.value[game.id] = URL.createObjectURL(blob)
      }
    }
  } catch {}
}

function playGame(game: GameInfo) {
  loadGameForIndex(games.value.indexOf(game))
}

// 滑动逻辑
function getPageHeight(): number {
  return containerRef.value?.clientHeight || window.innerHeight
}

function goToIndex(index: number) {
  if (index < 0 || index >= games.value.length) return
  isAnimating.value = true
  currentIndex.value = index
  translateY.value = -index * getPageHeight()
  loadGameForIndex(index)
  // 预加载前后
  if (index > 0) loadGameForIndex(index - 1)
  if (index < games.value.length - 1) loadGameForIndex(index + 1)
  setTimeout(() => { isAnimating.value = false }, 420)
}

function onTouchStart(e: TouchEvent) {
  if (showComments.value) return
  touchStartY = e.touches[0].clientY
  touchStartTime = Date.now()
  isSwiping = true
  touchMoved = false
  isAnimating.value = false
}

function onTouchMove(e: TouchEvent) {
  if (!isSwiping || showComments.value) return
  const deltaY = e.touches[0].clientY - touchStartY
  // 超过 10px 才算有效移动（区分点击和滑动）
  if (Math.abs(deltaY) > 10) touchMoved = true
  if (!touchMoved) return
  const base = -currentIndex.value * getPageHeight()
  // 阻尼效果
  const damped = deltaY * 0.4
  translateY.value = base + damped
}

function onTouchEnd(e: TouchEvent) {
  if (!isSwiping || showComments.value) return
  isSwiping = false
  // 没有有效移动 = 点击，不做任何切换
  if (!touchMoved) return
  const deltaY = e.changedTouches[0].clientY - touchStartY
  const elapsed = Date.now() - touchStartTime
  const velocity = Math.abs(deltaY) / elapsed
  const threshold = getPageHeight() * 0.25

  // 提高快速滑动的最小距离要求（80px），避免短距离误触
  if (deltaY < -threshold || (deltaY < -80 && velocity > 0.5)) {
    goToIndex(currentIndex.value + 1)
  } else if (deltaY > threshold || (deltaY > 80 && velocity > 0.5)) {
    goToIndex(currentIndex.value - 1)
  } else {
    goToIndex(currentIndex.value)
  }
}

function onWheel(e: WheelEvent) {
  if (showComments.value || isAnimating.value) return
  e.preventDefault()
  if (e.deltaY > 40) {
    goToIndex(currentIndex.value + 1)
  } else if (e.deltaY < -40) {
    goToIndex(currentIndex.value - 1)
  }
}

// 社交功能
function isLiked(name: string) { return !!socialData.value.liked[name] }
function getLikes(name: string) { return socialData.value.likes[name] || 0 }
function getComments(name: string) { return socialData.value.comments[name] || [] }

function toggleLike(name: string) {
  if (socialData.value.liked[name]) {
    socialData.value.liked[name] = false
    socialData.value.likes[name] = Math.max(0, (socialData.value.likes[name] || 1) - 1)
  } else {
    socialData.value.liked[name] = true
    socialData.value.likes[name] = (socialData.value.likes[name] || 0) + 1
  }
  saveSocialData()
}

const currentComments = computed(() => {
  if (!commentingGame.value) return []
  return getComments(commentingGame.value.id)
})

function openComments(game: GameInfo) {
  commentingGame.value = game
  showComments.value = true
}

function submitComment() {
  if (!commentText.value.trim() || !commentingGame.value) return
  const name = commentingGame.value.id
  if (!socialData.value.comments[name]) socialData.value.comments[name] = []
  socialData.value.comments[name].push({
    text: commentText.value.trim(),
    time: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  })
  commentText.value = ''
  saveSocialData()
}

function isMyGame(game: GameInfo): boolean {
  return game.author === authStore.username
}

function onDeleteGame(game: GameInfo) {
  deletingGame.value = game
}

async function confirmDeleteGame() {
  if (!deletingGame.value) return
  const game = deletingGame.value
  try {
    const resp = await fetch('/__game-show/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: authStore.username, gameId: game.id }),
    })
    const data = await resp.json()
    if (data.ok) {
      games.value = games.value.filter((g) => g.id !== game.id)
      // 清理 blob URL
      if (gameUrls.value[game.id]) {
        URL.revokeObjectURL(gameUrls.value[game.id])
        delete gameUrls.value[game.id]
      }
      ElMessage.success(`已从游戏广场删除「${game.displayName}」`)
      // 调整当前索引
      if (currentIndex.value >= games.value.length) {
        currentIndex.value = Math.max(0, games.value.length - 1)
      }
      translateY.value = -currentIndex.value * getPageHeight()
    } else {
      ElMessage.error(data.error || '删除失败')
    }
  } catch {
    ElMessage.error('删除失败')
  }
  deletingGame.value = null
}

function shareGame(game: GameInfo) {
  // 模拟分享：复制链接到剪贴板
  const text = `来玩我做的游戏「${game.displayName}」！- GameForge 创作`
  navigator.clipboard?.writeText(text)
  // 简单反馈
  const el = document.createElement('div')
  el.textContent = '已复制分享文案 ✓'
  el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:#fff;padding:12px 24px;border-radius:8px;z-index:9999;font-size:14px;'
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 1500)
}
</script>

<style lang="scss" scoped>
.recommend-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
  position: relative;
}

.recommend-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #64748b;
  .empty-icon { font-size: 64px; margin-bottom: 16px; }
  h3 { font-size: 18px; color: #94a3b8; margin: 0 0 8px; }
  p { font-size: 13px; margin: 0; }
}

.swipe-wrapper {
  width: 100%;
  will-change: transform;
}

.swipe-page {
  width: 100%;
  height: calc(100vh - 52px); // 减去顶部导航高度
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

// 游戏展示区
.game-showcase {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 40px 80px 80px 40px;
}

.game-frame {
  position: relative;
  background: #000;
  border-radius: 0;
  overflow: hidden;
  // 竖版 iPad 风格
  width: 380px;
  height: 680px;
  max-height: 80vh;

  &.landscape {
    width: 760px;
    height: 380px;
    max-width: 80vw;
    max-height: 50vh;
  }
}

.game-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #000;
}

.game-cover {
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  filter: blur(2px) brightness(0.6);
}

.cover-play {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);

  &:hover {
    transform: scale(1.1);
    background: rgba(99, 102, 241, 1);
  }

  .play-icon {
    font-size: 28px;
    color: #fff;
    margin-left: 4px;
  }
}

// 右侧社交栏（TikTok 风格）
.social-bar {
  position: absolute;
  right: 16px;
  bottom: 140px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  align-items: center;
}

.social-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  transition: transform 0.15s;

  &:hover { transform: scale(1.15); }
  &:active { transform: scale(0.9); }
  &.liked .btn-icon { animation: likeAnim 0.4s ease; }

  .btn-icon {
    font-size: 28px;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 50%;
    backdrop-filter: blur(8px);
  }

  .btn-count {
    font-size: 11px;
    color: #ccc;
    font-weight: 500;
  }
}

@keyframes likeAnim {
  0% { transform: scale(1); }
  50% { transform: scale(1.4); }
  100% { transform: scale(1); }
}

// 底部游戏信息
.game-info-bar {
  position: absolute;
  left: 20px;
  bottom: 40px;
  max-width: 60%;
}

.game-author {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.author-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border: 2px solid rgba(255, 255, 255, 0.2);
}

.author-name {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.game-title {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 4px;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}

.game-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

// 页码指示器
.page-indicator {
  position: absolute;
  top: 16px;
  right: 20px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(0, 0, 0, 0.3);
  padding: 4px 12px;
  border-radius: 12px;
  backdrop-filter: blur(4px);

  .current { color: #fff; font-weight: 600; }
  .sep { margin: 0 2px; }
}

// 评论弹窗
.comment-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.comment-panel {
  width: 100%;
  max-width: 480px;
  height: 55vh;
  background: #1a1a2e;
  border-radius: 16px 16px 0 0;
  display: flex;
  flex-direction: column;
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.comment-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);

  h3 { margin: 0; font-size: 15px; color: #e2e8f0; }
  .close-btn {
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    &:hover { background: rgba(255, 255, 255, 0.06); }
  }
}

.comment-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 20px;
}

.comment-item {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.comment-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.comment-body {
  flex: 1;
}

.comment-name {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 3px;
}

.comment-text {
  font-size: 14px;
  color: #e2e8f0;
  line-height: 1.4;
}

.comment-time {
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
}

.comment-empty {
  text-align: center;
  color: #64748b;
  font-size: 13px;
  padding: 40px 0;
}

.comment-input {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);

  input {
    flex: 1;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    padding: 8px 16px;
    color: #e2e8f0;
    font-size: 13px;
    outline: none;
    &:focus { border-color: rgba(99, 102, 241, 0.4); }
    &::placeholder { color: #64748b; }
  }

  .send-btn {
    background: #6366f1;
    border: none;
    color: #fff;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    &:hover { background: #4f46e5; }
  }
}

// 删除按钮样式
.delete-btn {
  .btn-icon {
    background: rgba(239, 68, 68, 0.15) !important;
  }
  .btn-count { color: #f87171 !important; }
  &:hover .btn-icon { background: rgba(239, 68, 68, 0.3) !important; }
}

// 删除确认弹窗
.confirm-modal {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
}
.confirm-box {
  background: #1a1a2e; border-radius: 16px;
  padding: 32px; text-align: center;
  max-width: 360px; width: 90%;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  .confirm-icon { font-size: 40px; margin-bottom: 12px; }
  h4 { margin: 0 0 8px; font-size: 17px; color: #e2e8f0; }
  p { margin: 0 0 20px; font-size: 13px; color: #94a3b8; line-height: 1.6; }
}
.confirm-actions {
  display: flex; gap: 12px; justify-content: center;
}
.btn-cancel {
  padding: 8px 20px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1);
  color: #94a3b8; font-size: 13px; cursor: pointer;
  &:hover { background: rgba(255, 255, 255, 0.1); }
}
.btn-confirm-delete {
  padding: 8px 20px; border-radius: 8px;
  background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4);
  color: #f87171; font-size: 13px; font-weight: 500; cursor: pointer;
  &:hover { background: rgba(239, 68, 68, 0.35); }
}
</style>
