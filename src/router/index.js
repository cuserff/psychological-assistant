import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getToken } from '../utils/storage'
import { useUserStore } from '../store/userStore'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/Login/index.vue'),
    meta: { hideLayout: true, title: '登录' }
  },
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
    meta: { title: '首页' }
  },
  {
    path: '/chat',
    name: 'chat',
    component: () => import('../views/Chat/index.vue'),
    meta: { title: 'AI 对话' }
  },
  {
    path: '/assessment',
    name: 'assessment',
    component: () => import('../views/Assessment/index.vue'),
    meta: { title: '心理测评' }
  },
  {
    path: '/assessment/:id',
    name: 'assessmentDetail',
    component: () => import('../views/Assessment/Detail.vue'),
    meta: { title: '测评详情' }
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('../views/Profile/index.vue'),
    meta: { title: '个人中心' }
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('../views/Admin/index.vue'),
    meta: { requiresAdmin: true, title: '用户管理' }
  },
  {
    path: '/about',
    name: 'about',
    component: () => import('../views/AboutView.vue'),
    meta: { title: '关于系统' }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'error',
    component: () => import('../views/Error/index.vue'),
    meta: { hideLayout: true, title: '页面不存在' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to) => {
  const token = getToken()
  const userStore = useUserStore()

  // 未登录且目标页不是登录页 → 重定向到登录
  if (!token && to.name !== 'login') {
    return { name: 'login' }
  }

  // 已登录但访问登录页 → 重定向到首页
  if (token && to.name === 'login') {
    return { name: 'home' }
  }

  // 管理员路由：路由层强校验（与 meta.requiresAdmin 一致），避免改地址栏仅靠接口兜底
  if (token && to.meta.requiresAdmin) {
    // 刷新或直接打开 /admin 时，守卫早于 App.onMounted 拉用户信息，需先补全 userInfo
    if (!userStore.userInfo) {
      try {
        await userStore.fetchUserInfo()
      } catch {
        return { name: 'login' }
      }
    }
    if (!userStore.isAdmin) {
      ElMessage.warning('无权访问管理后台')
      return { name: 'home' }
    }
  }
})

export default router
