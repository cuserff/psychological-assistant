import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getToken, setToken, removeToken, setItem, removeItem } from '../utils/storage'
import { loginApi, registerApi, getUserInfoApi, updateUserInfoApi } from '../api/user'

export const useUserStore = defineStore('user', () => {
  const token = ref(getToken() || '')
  const userInfo = ref(null)
  const CURRENT_USER_ID_KEY = 'current_user_id'
  const CURRENT_USER_KEY = 'current_user'
  const CURRENT_USERNAME_KEY = 'current_username'

  const isLoggedIn = computed(() => !!token.value)
  const nickname = computed(() => userInfo.value?.nickname || '')
  const isAdmin = computed(() => userInfo.value?.role === 'admin')
  // 头像类型：'boy' | 'girl'，优先取后端数据，兜底取本地缓存
  const avatar = computed(() => userInfo.value?.avatar || localStorage.getItem('user_avatar') || 'boy')

  async function login(loginData) {
    const res = await loginApi(loginData)
    token.value = res.data.token
    userInfo.value = res.data.user
    setToken(res.data.token)
    // 用于前端本地数据隔离（避免不同用户互相看到兜底历史）
    if (res.data.user) {
      setItem(CURRENT_USER_KEY, res.data.user)
      const resolvedUserId = res.data.user.id || res.data.user.userId || res.data.user._id
      if (resolvedUserId) setItem(CURRENT_USER_ID_KEY, resolvedUserId)
    }
    if (loginData?.username) setItem(CURRENT_USERNAME_KEY, loginData.username)
    return res
  }

  async function register(registerData) {
    const res = await registerApi(registerData)
    token.value = res.data.token
    userInfo.value = res.data.user
    setToken(res.data.token)
    // 用于前端本地数据隔离（避免不同用户互相看到兜底历史）
    if (res.data.user) {
      setItem(CURRENT_USER_KEY, res.data.user)
      const resolvedUserId = res.data.user.id || res.data.user.userId || res.data.user._id
      if (resolvedUserId) setItem(CURRENT_USER_ID_KEY, resolvedUserId)
    }
    if (registerData?.username) setItem(CURRENT_USERNAME_KEY, registerData.username)
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

  // 切换头像类型，同时写入本地缓存（兜底）和后端
  async function setAvatar(type) {
    localStorage.setItem('user_avatar', type)
    if (userInfo.value) {
      userInfo.value = { ...userInfo.value, avatar: type }
    }
    try {
      await updateUserInfoApi({ avatar: type })
    } catch {
      // 后端暂不支持 avatar 字段也不影响本地使用
    }
  }

  function logout() {
    token.value = ''
    userInfo.value = null
    removeToken()
    removeItem(CURRENT_USER_ID_KEY)
    removeItem(CURRENT_USER_KEY)
    removeItem(CURRENT_USERNAME_KEY)
  }

  return {
    token,
    userInfo,
    isLoggedIn,
    nickname,
    isAdmin,
    avatar,
    login,
    register,
    fetchUserInfo,
    setAvatar,
    logout
  }
})
