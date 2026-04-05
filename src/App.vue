<script setup>
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from './store/userStore'
import { useChatStore } from './store/chatStore'
import { ElMessage } from 'element-plus'
import AppSidebarMenu from './components/layout/AppSidebarMenu.vue'
import {
  User,
  Setting,
  SwitchButton,
  Fold,
  Expand,
  Menu,
  Sunny,
  Moon
} from '@element-plus/icons-vue'
import avatarBoy from './assets/images/avatar-boy.svg'
import avatarGirl from './assets/images/avatar-girl.svg'

const avatarMap = { boy: avatarBoy, girl: avatarGirl }

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const sidebarCollapsed = ref(false)

const THEME_STORAGE_KEY = 'app_theme'
const MOBILE_BREAKPOINT_QUERY = '(max-width: 992px)'

const mobileNavOpen = ref(false)
const isMobileLayout = ref(false)
const isDarkTheme = ref(false)

let mobileMediaQuery = null

function updateMobileLayout() {
  isMobileLayout.value = mobileMediaQuery?.matches ?? false
  if (!isMobileLayout.value) {
    mobileNavOpen.value = false
  }
}

/** 与 Element Plus 的 html.dark 及 global.css 中 data-theme 选择器对齐 */
function applyTheme(useDark) {
  const root = document.documentElement
  if (useDark) {
    root.classList.add('dark')
    root.dataset.theme = 'dark'
  } else {
    root.classList.remove('dark')
    root.dataset.theme = 'light'
  }
  isDarkTheme.value = useDark
  localStorage.setItem(THEME_STORAGE_KEY, useDark ? 'dark' : 'light')
}

function toggleTheme() {
  applyTheme(!isDarkTheme.value)
}

function initTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'dark') {
    applyTheme(true)
  } else if (stored === 'light') {
    applyTheme(false)
  } else {
    applyTheme(false)
  }
}

/** 顶栏左侧当前页标题（侧栏已有品牌全称，此处避免重复大标题） */
const pageTitle = computed(() => route.meta?.title || '智能心理助手')

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

// 进入 AI 对话页时自动收起侧边栏；路由变化时关闭移动端抽屉
watch(() => route.path, (path) => {
  sidebarCollapsed.value = path === '/chat'
  mobileNavOpen.value = false
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
  initTheme()
  mobileMediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY)
  updateMobileLayout()
  mobileMediaQuery.addEventListener('change', updateMobileLayout)

  // 全局监听跨标签页同步登出/活动时间（无需依赖某个具体页面）
  window.addEventListener('storage', handleStorageEvent)

  if (userStore.token) {
    try {
      await userStore.fetchUserInfo()
    } catch (error) {
      // 仅在 token 无效（已被 fetchUserInfo 清除）时跳登录；后端不可达时保留本地状态
      if (!userStore.token) {
        router.push('/login')
      }
    }
  }
})

onBeforeUnmount(() => {
  mobileMediaQuery?.removeEventListener('change', updateMobileLayout)
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
    <el-drawer
      v-model="mobileNavOpen"
      direction="ltr"
      size="var(--app-sidebar-width)"
      :with-header="false"
      append-to-body
      class="app-mobile-drawer"
    >
      <div class="app-mobile-drawer-inner">
        <div class="app-mobile-drawer-brand">智能心理助手</div>
        <AppSidebarMenu :collapse="false" @navigate="mobileNavOpen = false" />
      </div>
    </el-drawer>

    <el-container style="height: 100vh;">
      <el-aside
        v-show="!isMobileLayout"
        :width="sidebarCollapsed ? 'var(--app-sidebar-collapsed-width)' : 'var(--app-sidebar-width)'"
        class="app-sidebar"
      >
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

        <AppSidebarMenu :collapse="sidebarCollapsed" />
      </el-aside>

      <el-container>
        <el-header class="app-header">
          <div class="app-header-left">
            <el-button
              v-if="isMobileLayout"
              class="app-header-menu-btn"
              text
              circle
              aria-label="打开导航菜单"
              @click="mobileNavOpen = true"
            >
              <el-icon><Menu /></el-icon>
            </el-button>
            <span class="app-header-title" :title="pageTitle">{{ pageTitle }}</span>
          </div>

          <div class="app-header-right">
            <el-button
              class="app-header-theme-btn"
              text
              circle
              :title="isDarkTheme ? '切换浅色' : '切换深色'"
              @click="toggleTheme"
            >
              <el-icon><Moon v-if="!isDarkTheme" /><Sunny v-else /></el-icon>
            </el-button>
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
          </div>
        </el-header>

        <el-main
          class="app-main"
          :class="{ 'app-main--chat': route.path === '/chat' }"
        >
          <div class="app-main__shell">
            <router-view />
          </div>
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<style>
.app-container {
  height: 100%;
}

/* 主区域列（顶栏 + el-main）：占满剩余高度并允许子项收缩，避免整页滚动条影响侧栏 */
.app-container > .el-container > .el-container {
  flex: 1 1 0%;
  min-height: 0;
  overflow: hidden;
}

.el-main {
  background-color: var(--app-color-bg);
}

.el-main.app-main {
  padding: var(--app-space-2);
  min-height: 0;
}

/**
 * 对话页：主内容区参与 flex 收缩（min-height:0），滚动仅发生在会话列表 / 消息列表内部，
 * 避免整页出现纵向滚动条把布局「顶歪」或视觉上盖住左侧侧栏。
 */
.el-main.app-main--chat {
  background-color: var(--app-color-bg-chat);
  /* flex-basis: 0 避免嵌套 flex 下主区域高度被算成 0，导致对话页整片空白 */
  flex: 1 1 0%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 业务页内容区限宽居中；对话全宽 */
.app-main__shell {
  max-width: var(--app-content-max-width);
  margin: 0 auto;
  width: 100%;
  min-height: 100%;
}

.app-main--chat .app-main__shell {
  max-width: none;
  margin: 0;
  flex: 1 1 0%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 移动端抽屉：去内边距，与桌面侧栏视觉一致 */
.app-mobile-drawer.el-drawer {
  --el-drawer-padding-primary: 0;
}

.app-mobile-drawer .el-drawer__body {
  padding: 0;
  height: 100%;
}

.app-mobile-drawer-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--app-sidebar-bg);
}

.app-mobile-drawer-brand {
  flex-shrink: 0;
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--app-sidebar-border);
  color: var(--app-sidebar-text);
  font-size: 18px;
  font-weight: 600;
}
</style>

<style scoped>
/* ==================== 侧边栏 ==================== */

.app-sidebar {
  background-color: var(--app-sidebar-bg);
  transition: width 0.3s ease;
  overflow-x: hidden;
}

.logo-container {
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--app-sidebar-border);
  white-space: nowrap;
  overflow: hidden;
}

.logo-container.collapsed {
  justify-content: center;
  padding: 0;
}

.logo-text {
  color: var(--app-sidebar-text);
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  flex: 1;
}

.collapse-toggle {
  color: var(--app-sidebar-text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.2s;
}

.collapse-toggle:hover {
  color: var(--app-sidebar-text);
}

/* ==================== 顶栏 ==================== */

.app-header {
  --app-header-pad-x: var(--app-space-2);
  height: var(--app-header-height);
  min-height: var(--app-header-height);
  background-color: var(--app-color-bg-elevated);
  border-bottom: 1px solid var(--app-color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--app-header-pad-x);
  gap: var(--app-space-2);
}

.app-header-left {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--app-space-1);
}

.app-header-menu-btn {
  flex-shrink: 0;
  color: var(--app-color-text);
}

.app-header-right {
  display: flex;
  align-items: center;
  gap: var(--app-space-1);
  flex-shrink: 0;
}

.app-header-theme-btn {
  color: var(--app-color-text);
}

.app-header-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--app-color-text);
  letter-spacing: 0.02em;
}

.header-user {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.user-dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: var(--app-color-text);
  font-size: 14px;
}

.user-dropdown-trigger:hover {
  color: var(--app-color-primary);
}

.user-mini-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--app-color-border);
}

.user-name {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
