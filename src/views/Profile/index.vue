<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useUserStore } from '../../store/userStore'
import { useCheckinStore } from '../../store/checkinStore'
import { updateUserInfoApi, updatePasswordApi } from '../../api/user'
import { useProfileStats } from '../../composables/useProfileStats'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import StatsCards from '../../components/profile/StatsCards.vue'
import MoodCheckin from '../../components/profile/MoodCheckin.vue'
import MoodHeatmap from '../../components/profile/MoodHeatmap.vue'
import avatarBoy from '../../assets/images/avatar-boy.svg'
import avatarGirl from '../../assets/images/avatar-girl.svg'

// 头像选项映射
const avatarMap = { boy: avatarBoy, girl: avatarGirl }

const userStore = useUserStore()
const checkinStore = useCheckinStore()

// 编排页面数据加载（统计 + 打卡记录并行请求）
const { pageLoading, refreshAfterCheckin } = useProfileStats()

// ==================== 基本信息 ====================
const infoFormRef = ref(null)
const infoForm = reactive({
  nickname: ''
})
const infoLoading = ref(false)

// ==================== 修改密码 ====================
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
    <!-- 第一行：数据统计看板 -->
    <StatsCards :stats="checkinStore.stats" :loading="pageLoading" />

    <!-- 第二行：基本信息 + 修改密码 + 情绪打卡 -->
    <el-row :gutter="20" class="card-row">
      <!-- 用户信息卡片 -->
      <el-col :span="8" class="card-col">
        <el-card shadow="hover" class="full-height-card">
          <template #header>
            <div class="card-header">
              <el-icon><User /></el-icon>
              <span>基本信息</span>
            </div>
          </template>

          <div class="user-avatar-section">
            <img
              :src="avatarMap[userStore.avatar]"
              class="user-avatar-img"
              alt="用户头像"
            />
            <div class="avatar-picker">
              <span class="avatar-picker-label">选择头像：</span>
              <img
                v-for="key in ['boy', 'girl']"
                :key="key"
                :src="avatarMap[key]"
                :class="['avatar-option', { active: userStore.avatar === key }]"
                :title="key === 'boy' ? '男生头像' : '女生头像'"
                @click="userStore.setAvatar(key)"
              />
            </div>
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
      <el-col :span="8" class="card-col">
        <el-card shadow="hover" class="full-height-card">
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

      <!-- 情绪打卡卡片 -->
      <el-col :span="8" class="card-col">
        <MoodCheckin
          :today-checked-in="checkinStore.isTodayCheckedIn()"
          :today-record="checkinStore.getTodayRecord()"
          @checkin-success="refreshAfterCheckin"
        />
      </el-col>
    </el-row>

    <!-- 第三行：情绪热力图 -->
    <div style="margin-top: 20px;">
      <MoodHeatmap :records="checkinStore.records" />
    </div>
  </div>
</template>

<style scoped>
.profile-container {
  max-width: 1200px;
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
  flex-direction: column;
  align-items: center;
  margin-bottom: 20px;
}

.user-avatar-img {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid #e0e0e0;
  margin-bottom: 12px;
}

.avatar-picker {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar-picker-label {
  font-size: 13px;
  color: #666;
}

.avatar-option {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  cursor: pointer;
  border: 2.5px solid transparent;
  transition: all 0.25s ease;
  opacity: 0.6;
}

.avatar-option:hover {
  opacity: 0.9;
  transform: scale(1.1);
}

.avatar-option.active {
  border-color: #0284c7;
  opacity: 1;
  box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.2);
}

.user-desc {
  margin-bottom: 10px;
}

/* 第二行卡片等高对齐 */
.card-row {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
}

.card-col {
  display: flex;
}

.full-height-card {
  width: 100%;
}
</style>
