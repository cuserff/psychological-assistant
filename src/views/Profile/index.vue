<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useUserStore } from '../../store/userStore'
import { updateUserInfoApi, updatePasswordApi } from '../../api/user'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'

const userStore = useUserStore()

// 基本信息
const infoFormRef = ref(null)
const infoForm = reactive({
  nickname: ''
})
const infoLoading = ref(false)

// 修改密码
const passwordFormRef = ref(null)
const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const passwordLoading = ref(false)

const passwordRules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能少于 6 个字符', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value !== passwordForm.newPassword) {
          callback(new Error('两次输入密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

onMounted(() => {
  if (userStore.userInfo) {
    infoForm.nickname = userStore.userInfo.nickname || ''
  }
})

async function handleUpdateInfo() {
  infoLoading.value = true
  try {
    const res = await updateUserInfoApi({ nickname: infoForm.nickname })
    userStore.userInfo = res.data
    ElMessage.success('昵称更新成功')
  } catch (error) {
    ElMessage.error(error.message || '更新失败')
  } finally {
    infoLoading.value = false
  }
}

async function handleUpdatePassword() {
  const valid = await passwordFormRef.value.validate().catch(() => false)
  if (!valid) return

  passwordLoading.value = true
  try {
    await updatePasswordApi({
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword
    })
    ElMessage.success('密码修改成功')
    passwordFormRef.value.resetFields()
  } catch (error) {
    ElMessage.error(error.message || '密码修改失败')
  } finally {
    passwordLoading.value = false
  }
}
</script>

<template>
  <div class="profile-container">
    <el-row :gutter="20">
      <!-- 用户信息卡片 -->
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <el-icon><User /></el-icon>
              <span>基本信息</span>
            </div>
          </template>

          <div class="user-avatar-section">
            <el-avatar :size="80" class="user-avatar">
              {{ userStore.userInfo?.nickname?.charAt(0) || 'U' }}
            </el-avatar>
          </div>

          <el-descriptions :column="1" border class="user-desc">
            <el-descriptions-item label="用户名">
              {{ userStore.userInfo?.username || '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="注册时间">
              {{ userStore.userInfo?.createdAt
                ? new Date(userStore.userInfo.createdAt).toLocaleDateString('zh-CN')
                : '-' }}
            </el-descriptions-item>
          </el-descriptions>

          <el-form
            ref="infoFormRef"
            :model="infoForm"
            label-width="60px"
            style="margin-top: 20px;"
          >
            <el-form-item label="昵称">
              <el-input v-model="infoForm.nickname" placeholder="请输入昵称" />
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :loading="infoLoading"
                @click="handleUpdateInfo"
              >
                保存修改
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <!-- 修改密码卡片 -->
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <el-icon><Lock /></el-icon>
              <span>修改密码</span>
            </div>
          </template>

          <el-form
            ref="passwordFormRef"
            :model="passwordForm"
            :rules="passwordRules"
            label-width="90px"
          >
            <el-form-item label="原密码" prop="oldPassword">
              <el-input
                v-model="passwordForm.oldPassword"
                type="password"
                placeholder="请输入原密码"
                show-password
              />
            </el-form-item>
            <el-form-item label="新密码" prop="newPassword">
              <el-input
                v-model="passwordForm.newPassword"
                type="password"
                placeholder="请输入新密码（至少 6 位）"
                show-password
              />
            </el-form-item>
            <el-form-item label="确认密码" prop="confirmPassword">
              <el-input
                v-model="passwordForm.confirmPassword"
                type="password"
                placeholder="请再次输入新密码"
                show-password
              />
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :loading="passwordLoading"
                @click="handleUpdatePassword"
              >
                修改密码
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.profile-container {
  max-width: 960px;
  margin: 0 auto;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.user-avatar-section {
  display: flex;
  justify-content: center;
  margin-bottom: 20px;
}

.user-avatar {
  background-color: #0284c7;
  font-size: 32px;
  font-weight: 600;
}

.user-desc {
  margin-bottom: 10px;
}
</style>
