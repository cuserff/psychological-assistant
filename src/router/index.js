import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from '../utils/storage'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/Login/index.vue'),
    meta: { hideLayout: true }
  },
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue')
  },
  {
    path: '/chat',
    name: 'chat',
    component: () => import('../views/Chat/index.vue')
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('../views/Profile/index.vue')
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('../views/Admin/index.vue'),
    meta: { requiresAdmin: true }
  },
  {
    path: '/about',
    name: 'about',
    component: () => import('../views/AboutView.vue')
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'error',
    component: () => import('../views/Error/index.vue'),
    meta: { hideLayout: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const token = getToken()

  // 未登录且目标页不是登录页 → 重定向到登录
  if (!token && to.name !== 'login') {
    return { name: 'login' }
  }

  // 已登录但访问登录页 → 重定向到首页
  if (token && to.name === 'login') {
    return { name: 'home' }
  }

  // 管理员页面权限由 App.vue 挂载后的 userInfo.role 判断，
  // 路由层只做基础 token 检查，角色检查在页面层处理
})

export default router
