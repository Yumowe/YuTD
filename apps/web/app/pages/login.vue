<script setup lang="ts">
// 页面配置与类型
useHead({ title: '登录 · YuTD' })

// 系统变量读取
const route = useRoute()
const authToken = useCookie<string | null>('yutd-auth-token', { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 })

// API 读取
const client = reactive(useApi({
  key: 'auth:login',
  write: async (api, password: string) => {
    const result = await requestApiData(api.api.auth.login.post({ password }))
    if (!result.token) throw new Error('服务器未返回登录凭证')
    return result
  }
}))

// 页面变量：响应式数据
const state = reactive({ password: '', error: '' })

// 计算属性
const pending = computed(() => client.write.saving.value)

// 方法
async function login() {
  if (pending.value || !state.password) return
  state.error = ''
  const result = await client.write(state.password).catch((error) => {
    state.error = error instanceof Error ? error.message : '验证失败，请重试'
    return undefined
  })
  if (!result) return
  authToken.value = result.token
  state.password = ''
  await nextTick()
  const redirect = route.query.redirect
  const target = typeof redirect === 'string' && /^\/(?!\/)/.test(redirect) && !/[\\\r\n]/.test(redirect)
    && !/^\/login\/?(?:[?#]|$)/.test(redirect)
    ? redirect
    : '/'
  await navigateTo(target, { external: true, replace: true })
}
</script>

<template>
  <main class="login-page">
    <form
      class="login-form"
      :aria-busy="pending"
      @submit.prevent="login"
    >
      <h1>登录 YuTD</h1>
      <p class="muted">
        权限不足，请输入服务器密码以继续访问。
      </p>
      <label for="password">服务器密码</label>
      <input
        id="password"
        v-model="state.password"
        type="password"
        autocomplete="current-password"
        autofocus
        required
        :disabled="pending"
      >
      <p
        v-if="state.error"
        class="login-error"
        role="alert"
      >
        {{ state.error }}
      </p>
      <button
        class="button"
        type="submit"
        :disabled="pending || !state.password"
      >
        {{ pending ? '正在验证……' : '验证并返回' }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.login-page { display: grid; min-height: 100dvh; place-items: center; padding: calc(24px + var(--app-safe-top)) calc(24px + var(--app-safe-right)) calc(24px + var(--app-safe-bottom)) calc(24px + var(--app-safe-left)); }
.login-form { display: grid; gap: 16px; width: min(100%, 380px); padding: 28px; border: 1px solid var(--border-color); border-radius: 16px; background: var(--background-secondary); }
.login-form h1 { margin: 0; font-size: 24px; }
.login-form label { font-size: 14px; }
.login-form input { width: 100%; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--background-primary); color: var(--text-primary); }
.login-error { margin: 0; color: #b42336; font-size: 14px; }
</style>
