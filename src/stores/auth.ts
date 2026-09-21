import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const TOKEN_KEY = 'gameforge_auth_token'
const USER_KEY = 'gameforge_auth_user'

export const useAuthStore = defineStore('auth', () => {
  const username = ref(sessionStorage.getItem(USER_KEY) || '')
  const token = ref(sessionStorage.getItem(TOKEN_KEY) || '')
  const isLoggedIn = computed(() => !!token.value && !!username.value)

  function setSession(t: string, u: string) {
    token.value = t
    username.value = u
    sessionStorage.setItem(TOKEN_KEY, t)
    sessionStorage.setItem(USER_KEY, u)
  }

  function clearSession() {
    token.value = ''
    username.value = ''
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
  }

  async function checkSession(): Promise<boolean> {
    if (!token.value) return false
    try {
      const resp = await fetch(`/__auth/check-session?token=${encodeURIComponent(token.value)}`)
      if (resp.ok) {
        const data = await resp.json()
        if (data.ok) {
          username.value = data.username
          return true
        }
      }
    } catch {}
    clearSession()
    return false
  }

  async function login(user: string, password: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const resp = await fetch('/__auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password }),
      })
      const data = await resp.json()
      if (data.ok) {
        setSession(data.token, data.username)
        return { ok: true }
      }
      return { ok: false, error: data.error || '登录失败' }
    } catch (err: any) {
      return { ok: false, error: err.message || '网络错误' }
    }
  }

  async function register(user: string, password: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const resp = await fetch('/__auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password }),
      })
      const data = await resp.json()
      if (data.ok) {
        setSession(data.token, data.username)
        return { ok: true }
      }
      return { ok: false, error: data.error || '注册失败' }
    } catch (err: any) {
      return { ok: false, error: err.message || '网络错误' }
    }
  }

  function logout() {
    clearSession()
  }

  async function guestLogin(): Promise<{ ok: boolean; error?: string }> {
    try {
      const resp = await fetch('/__auth/guest', { method: 'POST' })
      const data = await resp.json()
      if (data.ok) {
        setSession(data.token, data.username)
        return { ok: true }
      }
      return { ok: false, error: data.error || '游客登录失败' }
    } catch (err: any) {
      return { ok: false, error: err.message || '网络错误' }
    }
  }

  const isGuest = computed(() => username.value.startsWith('guest_'))

  return {
    username, token, isLoggedIn, isGuest,
    checkSession, login, register, logout, guestLogin,
  }
})
