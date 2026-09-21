<template>
  <div class="login-card">
    <button class="login-close" @click="emit('close')">✕</button>
    <h1 class="login-logo">🎮 GameForge</h1>
    <p class="login-subtitle">AI 游戏创作平台</p>

      <div class="login-form">
        <div class="field">
          <label>账号</label>
          <input
            v-model="username"
            type="text"
            placeholder="6~10位字母/数字/下划线"
            maxlength="10"
            @keyup.enter="onSubmit"
          />
          <span class="field-count" :class="{ valid: usernameValid }">{{ username.length }}/10</span>
        </div>
        <div class="field">
          <label>密码</label>
          <input
            v-model="password"
            type="password"
            placeholder="6~10位"
            maxlength="10"
            @keyup.enter="onSubmit"
          />
          <span class="field-count" :class="{ valid: passwordValid }">{{ password.length }}/10</span>
        </div>

        <p class="error-msg" v-if="errorMsg">{{ errorMsg }}</p>

        <button class="btn-submit" :disabled="!formValid || loading" @click="onSubmit">
          {{ loading ? '处理中...' : (isRegister ? '注册' : '登录') }}
        </button>

        <div class="divider"><span>或</span></div>

        <button class="btn-guest" :disabled="loading" @click="onGuestLogin">
          {{ loading ? '处理中...' : '游客登录（随机账号）' }}
        </button>

        <p class="toggle-mode">
          {{ isRegister ? '已有账号？' : '没有账号？' }}
          <a href="#" @click.prevent="isRegister = !isRegister; errorMsg = ''">
            {{ isRegister ? '去登录' : '去注册' }}
          </a>
        </p>
      </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits<{ (e: 'success'): void; (e: 'close'): void }>()

const authStore = useAuthStore()
const username = ref('')
const password = ref('')
const isRegister = ref(false)
const loading = ref(false)
const errorMsg = ref('')

const usernameValid = computed(() => username.value.length >= 6 && username.value.length <= 10)
const passwordValid = computed(() => password.value.length >= 6 && password.value.length <= 10)
const formValid = computed(() => usernameValid.value && passwordValid.value)

async function onSubmit() {
  if (!formValid.value || loading.value) return
  errorMsg.value = ''
  loading.value = true

  const result = isRegister.value
    ? await authStore.register(username.value, password.value)
    : await authStore.login(username.value, password.value)

  loading.value = false
  if (result.ok) {
    emit('success')
  } else {
    errorMsg.value = result.error || '操作失败'
  }
}

async function onGuestLogin() {
  if (loading.value) return
  errorMsg.value = ''
  loading.value = true
  const result = await authStore.guestLogin()
  loading.value = false
  if (result.ok) {
    emit('success')
  } else {
    errorMsg.value = result.error || '游客登录失败'
  }
}
</script>

<style lang="scss" scoped>
.login-card {
  position: relative;
  width: 380px; padding: 48px 40px;
  background: rgba(15,15,30,0.95);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.5);
  text-align: center;
}

.login-close {
  position: absolute; top: 14px; right: 14px;
  width: 28px; height: 28px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.04);
  color: #94a3b8; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
  &:hover { background: rgba(239,68,68,0.12); color: #f87171; border-color: rgba(239,68,68,0.3); }
}

.login-logo {
  font-size: 28px; font-weight: 800; margin: 0 0 8px;
  background: linear-gradient(135deg, #a5b4fc, #818cf8);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.login-subtitle {
  font-size: 13px; color: #64748b; margin: 0 0 32px;
}

.login-form {
  display: flex; flex-direction: column; gap: 16px; text-align: left;
}

.field {
  position: relative;
  label {
    display: block; font-size: 11px; font-weight: 600;
    color: #94a3b8; margin-bottom: 6px;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  input {
    width: 100%; box-sizing: border-box; padding: 12px 14px;
    background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px; color: #e2e8f0; font-size: 14px;
    outline: none; transition: all 0.2s;
    &:focus { border-color: rgba(99,102,241,0.5); box-shadow: 0 0 0 3px rgba(99,102,241,0.08); }
    &::placeholder { color: #475569; }
  }
  .field-count {
    position: absolute; right: 12px; top: 36px;
    font-size: 10px; color: #475569;
    &.valid { color: #34d399; }
  }
}

.error-msg {
  margin: 0; padding: 8px 12px; font-size: 12px;
  color: #f87171; background: rgba(239,68,68,0.08);
  border-radius: 8px; border: 1px solid rgba(239,68,68,0.2);
}

.btn-submit {
  width: 100%; padding: 12px; font-size: 14px; font-weight: 600;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; border: none; border-radius: 10px;
  cursor: pointer; transition: all 0.2s; margin-top: 8px;
  &:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(99,102,241,0.3); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.toggle-mode {
  text-align: center; font-size: 13px; color: #64748b; margin: 8px 0 0;
  a { color: #818cf8; text-decoration: none; &:hover { text-decoration: underline; } }
}

.divider {
  display: flex; align-items: center; text-align: center;
  color: #475569; font-size: 12px; margin: 4px 0;
  &::before, &::after {
    content: ''; flex: 1; height: 1px;
    background: rgba(255,255,255,0.08);
  }
  span { padding: 0 12px; }
}

.btn-guest {
  width: 100%; padding: 12px; font-size: 14px; font-weight: 600;
  background: rgba(255,255,255,0.05);
  color: #cbd5e1; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px;
  cursor: pointer; transition: all 0.2s;
  &:hover:not(:disabled) { background: rgba(255,255,255,0.1); border-color: rgba(129,140,248,0.4); color: #fff; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
</style>
