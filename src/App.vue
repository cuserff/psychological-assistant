<script setup>
import { ref, onMounted, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from './store/userStore'
import { useChatStore } from './store/chatStore'
import { ElMessage } from 'element-plus'
import {
  HomeFilled,
  ChatRound,
  User,
  Document,
  Setting,
  SwitchButton,
  Management,
  Fold,
  Expand,
  EditPen
} from '@element-plus/icons-vue'
import avatarBoy from './assets/images/avatar-boy.svg'
import avatarGirl from './assets/images/avatar-girl.svg'

const avatarMap = { boy: avatarBoy, girl: avatarGirl }

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const sidebarCollapsed = ref(false)

// ==================== 10 分钟无操作自动退出（隐私保护） ====================
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000
const ACTIVITY_THROTTLE_MS = 1000

// 跨标签页同步：使用 localStorage 通知所有窗口共享同一份“最后活动时间”
const LAST_ACTIVITY_KEY = 'last_activity_ts'
const LOGOUT_EVENT_KEY = 'auto_logout_event_id'

let inactivityTimerId = null

let isActivityListenersBound = false
let lastThrottleTs = 0
let lastActivityTs = 0

function clearInactivityTimer() {
  if (inactivityTimerId) {
    clearTimeout(inactivityTimerId)
    inactivityTimerId = null
  }
}

function getLastActivityTsFromStorage() {
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY)
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function scheduleAutoLogout() {
  clearInactivityTimer()
  if (!userStore.token) return

  const elapsed = Date.now() - lastActivityTs
  const remaining = INACTIVITY_TIMEOUT_MS - elapsed

  // 如果已经超时，立即触发
  if (remaining <= 0) {
    triggerAutoLogout('long_inactive')
    return
  }

  inactivityTimerId = setTimeout(() => {
    // 再次校验：避免重复触发或用户已经退出
    if (!userStore.token) return
    triggerAutoLogout('long_inactive')
  }, remaining)
}

function triggerAutoLogout(reason) {
  if (!userStore.token) return

  const chatStore = useChatStore()
  chatStore.resetStore()
  userStore.logout()

  // 广播给其他标签页：它们会收到 storage 事件并同步登出
  const eventId = `logout_${Date.now()}_${Math.random().toString(16).slice(2)}`
  localStorage.setItem(LOGOUT_EVENT_KEY, JSON.stringify({ eventId, reason }))

  ElMessage.warning('已因长时间未操作自动退出登录')
  router.push('/login')
}

function bindActivityListeners() {
  if (isActivityListenersBound) return

  // 鼠标移动/点击 + 键盘输入（满足你的要求）
  window.addEventListener('mousemove', handleUserActivity, { passive: true })
  window.addEventListener('mousedown', handleUserActivity)
  window.addEventListener('keydown', handleUserActivity)

  isActivityListenersBound = true
}

function unbindActivityListeners() {
  if (!isActivityListenersBound) return
  window.removeEventListener('mousemove', handleUserActivity)
  window.removeEventListener('mousedown', handleUserActivity)
  window.removeEventListener('keydown', handleUserActivity)
  isActivityListenersBound = false
}

function handleUserActivity() {
  // 有 token 才需要启动隐私保护计时
  if (!userStore.token) return

  const now = Date.now()
  // 节流：避免 mousemove 高频导致频繁 clearTimeout/setTimeout
  if (now - lastThrottleTs < ACTIVITY_THROTTLE_MS) return
  lastThrottleTs = now

  lastActivityTs = now
  localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
  scheduleAutoLogout()
}

function handleStorageEvent(event) {
  if (!userStore.token) return
  if (!event || !event.key) return

  if (event.key === LAST_ACTIVITY_KEY) {
    const ts = getLastActivityTsFromStorage()
    if (ts && ts !== lastActivityTs) {
      lastActivityTs = ts
      scheduleAutoLogout()
    }
  }

  if (event.key === LOGOUT_EVENT_KEY) {
    // 其他标签页已自动登出
    triggerAutoLogout('cross_tab_logout')
  }
}

// 进入 AI 对话页时自动收起侧边栏，离开时自动展开
watch(() => route.path, (path) => {
  sidebarCollapsed.value = path === '/chat'
}, { immediate: true })

watch(
  () => userStore.token,
  (token) => {
    if (token) {
      bindActivityListeners()
      // 新登录重置计时，避免读取到上次会话很久之前的活动时间导致立刻超时
      lastActivityTs = Date.now()
      localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivityTs))
      scheduleAutoLogout()
    } else {
      unbindActivityListeners()
      clearInactivityTimer()
    }
  },
  { immediate: true }
)

onMounted(async () => {
  // 全局监听跨标签页同步登出/活动时间（无需依赖某个具体页面）
  window.addEventListener('storage', handleStorageEvent)

  if (userStore.token) {
    try {
      await userStore.fetchUserInfo()
    } catch {
      router.push('/login')
    }
  }
})

onBeforeUnmount(() => {
  unbindActivityListeners()
  clearInactivityTimer()
  window.removeEventListener('storage', handleStorageEvent)
})

function handleDropdownCommand(command) {
  if (command === 'profile') {
    router.push('/profile')
  } else if (command === 'logout') {
    const chatStore = useChatStore()
    chatStore.resetStore()
    userStore.logout()
    ElMessage.success('已退出登录')
    router.push('/login')
  }
}
</script>

<template>
  <!-- 登录页等不需要主布局的页面 -->
  <router-view v-if="route.meta.hideLayout" />

  <!-- 主布局 -->
  <div v-else class="app-container">
    <el-container style="height: 100vh;">
      <el-aside :width="sidebarCollapsed ? '64px' : '200px'" class="app-sidebar">
        <div class="logo-container" :class="{ collapsed: sidebarCollapsed }">
          <h1 v-show="!sidebarCollapsed" class="logo-text">智能心理助手</h1>
          <el-icon
            class="collapse-toggle"
            :size="20"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <Expand v-if="sidebarCollapsed" />
            <Fold v-else />
          </el-icon>
        </div>

        <el-menu
          :default-active="route.path"
          :collapse="sidebarCollapsed"
          :collapse-transition="false"
          class="sidebar-menu"
          background-color="#001529"
          text-color="#fff"
          active-text-color="#ffd04b"
          router
        >
          <el-menu-item index="/">
            <el-icon><HomeFilled /></el-icon>
            <template #title>首页</template>
          </el-menu-item>

          <el-menu-item index="/chat">
            <el-icon><ChatRound /></el-icon>
            <template #title>AI 对话</template>
          </el-menu-item>

          <el-menu-item index="/assessment">
            <el-icon><EditPen /></el-icon>
            <template #title>心理测评</template>
          </el-menu-item>

          <el-menu-item index="/profile">
            <el-icon><User /></el-icon>
            <template #title>个人中心</template>
          </el-menu-item>

          <el-menu-item index="/about">
            <el-icon><Document /></el-icon>
            <template #title>关于系统</template>
          </el-menu-item>

          <!-- 管理员专属菜单 -->
          <el-divider v-if="userStore.isAdmin" style="border-color: #1f2d3d; margin: 8px 0;" />
          <el-menu-item v-if="userStore.isAdmin" index="/admin">
            <el-icon><Management /></el-icon>
            <template #title>用户管理</template>
          </el-menu-item>
        </el-menu>
      </el-aside>

      <el-container>
        <el-header class="app-header">
          <div style="flex: 1;"></div>
          <h2>智能心理助手</h2>
          <div style="flex: 1;"></div>

          <div class="header-user">
            <el-dropdown @command="handleDropdownCommand" trigger="click">
              <span class="user-dropdown-trigger">
                <img :src="avatarMap[userStore.avatar]" class="user-mini-avatar" alt="头像" />
                <span class="user-name">{{ userStore.nickname || '用户' }}</span>
                <el-icon class="el-icon--right"><Setting /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="profile" :icon="User">
                    个人中心
                  </el-dropdown-item>
                  <el-dropdown-item command="logout" :icon="SwitchButton" divided>
                    退出登录
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </el-header>

        <el-main style="padding: 20px;">
          <router-view />
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  height: 100%;
  font-family: Arial, sans-serif;
}

.app-container {
  height: 100%;
}

.el-main {
  background-color: #f5f7fa;
}
</style>

<style scoped>
/* ==================== 侧边栏 ==================== */

.app-sidebar {
  background-color: #001529;
  transition: width 0.3s ease;
  overflow-x: hidden;
}

.logo-container {
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid #1f2d3d;
  white-space: nowrap;
  overflow: hidden;
}

.logo-container.collapsed {
  justify-content: center;
  padding: 0;
}

.logo-text {
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  flex: 1;
}

.collapse-toggle {
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.2s;
}

.collapse-toggle:hover {
  color: #fff;
}

.sidebar-menu {
  border-right: none;
}

/* 修正收起状态下菜单的居中 */
.sidebar-menu:not(.el-menu--collapse) {
  width: 200px;
}

/* ==================== 顶栏 ==================== */

.app-header {
  background-color: #fff;
  border-bottom: 1px solid #e6e6e6;
  display: flex;
  align-items: center;
  padding: 0 20px;
}

.header-user {
  display: flex;
  align-items: center;
}

.user-dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: #333;
  font-size: 14px;
}

.user-dropdown-trigger:hover {
  color: #0284c7;
}

.user-mini-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #e0e0e0;
}

.user-name {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
