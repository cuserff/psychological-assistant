<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../../store/userStore'
import { ElMessage } from 'element-plus'
import { User, Lock, UserFilled } from '@element-plus/icons-vue'
// 与 AI 对话侧栏头像一致（小愈形象）
import avatarAiCompanion from '../../assets/images/avatar-ai-companion.svg?url'

const router = useRouter()
const userStore = useUserStore()

const activeTab = ref('login')
const loginLoading = ref(false)
const registerLoading = ref(false)

// 登录表单
const loginFormRef = ref(null)
const loginForm = reactive({
  username: '',
  password: ''
})
const loginRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

// 注册表单
const registerFormRef = ref(null)
const registerForm = reactive({
  username: '',
  nickname: '',
  password: '',
  confirmPassword: ''
})
const registerRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '长度在 3 到 20 个字符', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能少于 6 个字符', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value !== registerForm.password) {
          callback(new Error('两次输入密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

async function handleLogin() {
  const valid = await loginFormRef.value.validate().catch(() => false)
  if (!valid) return

  loginLoading.value = true
  try {
    await userStore.login({
      username: loginForm.username,
      password: loginForm.password
    })
    ElMessage.success('登录成功')
    router.push('/')
  } catch (error) {
    ElMessage.error(error.message || '登录失败')
  } finally {
    loginLoading.value = false
  }
}

async function handleRegister() {
  const valid = await registerFormRef.value.validate().catch(() => false)
  if (!valid) return

  registerLoading.value = true
  try {
    await userStore.register({
      username: registerForm.username,
      nickname: registerForm.nickname || registerForm.username,
      password: registerForm.password
    })
    ElMessage.success('注册成功,请登录！')
    //注册成功后将activeTab设置为login
    activeTab.value = 'login'
  } catch (error) {
    ElMessage.error(error.message || '注册失败')
  } finally {
    registerLoading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-header">
        <div class="logo-icon" aria-hidden="true">
          <img :src="avatarAiCompanion" alt="" class="login-brand-img" />
        </div>
        <h1 class="login-title">智能心理助手</h1>
        <p class="login-subtitle">基于大语言模型的心理健康辅助系统</p>
      </div>

      <el-tabs v-model="activeTab" class="login-tabs" stretch>
        <!-- 登录 -->
        <el-tab-pane label="登录" name="login">
          <el-form ref="loginFormRef" :model="loginForm" :rules="loginRules" size="large" @keyup.enter="handleLogin">
            <el-form-item prop="username">
              <el-input v-model="loginForm.username" placeholder="请输入用户名" :prefix-icon="User" />
            </el-form-item>
            <el-form-item prop="password">
              <el-input v-model="loginForm.password" type="password" placeholder="请输入密码" :prefix-icon="Lock"
                show-password />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="loginLoading" class="login-btn" @click="handleLogin">
                登 录
              </el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 注册 -->
        <el-tab-pane label="注册" name="register">
          <el-form ref="registerFormRef" :model="registerForm" :rules="registerRules" size="large"
            @keyup.enter="handleRegister">
            <el-form-item prop="username">
              <el-input v-model="registerForm.username" placeholder="请输入用户名（3-20 个字符）" :prefix-icon="User" />
            </el-form-item>
            <el-form-item prop="nickname">
              <el-input v-model="registerForm.nickname" placeholder="请输入昵称（选填）" :prefix-icon="UserFilled" />
            </el-form-item>
            <el-form-item prop="password">
              <el-input v-model="registerForm.password" type="password" placeholder="请输入密码（至少 6 位）" :prefix-icon="Lock"
                show-password />
            </el-form-item>
            <el-form-item prop="confirmPassword">
              <el-input v-model="registerForm.confirmPassword" type="password" placeholder="请再次输入密码" :prefix-icon="Lock"
                show-password />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="registerLoading" class="login-btn" @click="handleRegister">
                注 册
              </el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--app-space-2);
  background: linear-gradient(
    135deg,
    var(--app-color-primary-soft-bg) 0%,
    var(--app-color-bg) 45%,
    var(--app-color-primary-muted) 100%
  );
}

.login-card {
  width: 100%;
  max-width: 420px;
  padding: var(--app-space-4) var(--app-space-3) calc(var(--app-space-3) * 1.2);
  background: var(--app-color-bg-elevated);
  border-radius: var(--app-radius-lg);
  border: 1px solid var(--app-color-border);
  box-shadow:
    0 8px 32px color-mix(in srgb, var(--app-color-primary) 12%, transparent),
    0 1px 3px rgba(15, 23, 42, 0.06);
}

.login-header {
  text-align: center;
  margin-bottom: 28px;
}

.logo-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto var(--app-space-2);
  padding: 8px;
  box-sizing: border-box;
  background: linear-gradient(160deg, #ecfdf5, #d1fae5);
  border: 1px solid color-mix(in srgb, var(--app-color-primary) 35%, var(--app-color-border));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

html.dark .logo-icon,
html[data-theme='dark'] .logo-icon {
  background: linear-gradient(160deg, var(--app-color-primary-muted), var(--app-color-fill-muted));
}

.login-brand-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.login-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--app-color-text);
  margin: 0 0 var(--app-space-1);
}

.login-subtitle {
  font-size: 14px;
  color: var(--app-color-text-muted);
  margin: 0;
}

.login-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--app-space-2);
}

.login-tabs :deep(.el-tabs__item) {
  font-size: 16px;
  font-weight: 500;
}

.login-tabs :deep(.el-tabs__active-bar) {
  background-color: var(--el-color-primary);
}

.login-tabs :deep(.el-tabs__item.is-active) {
  color: var(--el-color-primary);
}

.login-btn {
  width: 100%;
  border-radius: var(--app-radius-md);
  font-size: 16px;
  letter-spacing: 4px;
}

:deep(.el-input__wrapper) {
  border-radius: var(--app-radius-md);
}
</style>
