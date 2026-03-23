import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getToken, setToken, removeToken } from '../utils/storage'
import { loginApi, registerApi, getUserInfoApi } from '../api/user'

export const useUserStore = defineStore('user', () => {
  const token = ref(getToken() || '')
  const userInfo = ref(null)

  const isLoggedIn = computed(() => !!token.value)
  const nickname = computed(() => userInfo.value?.nickname || '')
  const isAdmin = computed(() => userInfo.value?.role === 'admin')

  async function login(loginData) {
    const res = await loginApi(loginData)
    token.value = res.data.token
    userInfo.value = res.data.user
    setToken(res.data.token)
    return res
  }

  async function register(registerData) {
    const res = await registerApi(registerData)
    token.value = res.data.token
    userInfo.value = res.data.user
    setToken(res.data.token)
    return res
  }

  async function fetchUserInfo() {
    try {
      const res = await getUserInfoApi()
      userInfo.value = res.data
      return res
    } catch (error) {
      logout()
      throw error
    }
  }

  function logout() {
    token.value = ''
    userInfo.value = null
    removeToken()
  }

  return {
    token,
    userInfo,
    isLoggedIn,
    nickname,
    isAdmin,
    login,
    register,
    fetchUserInfo,
    logout
  }
})
