<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Delete, EditPen } from '@element-plus/icons-vue'
import { getAdminUsersApi, updateMentalStatusApi, deleteAdminUserApi } from '../../api/user'
import avatarBoy from '../../assets/images/avatar-boy.svg'
import avatarGirl from '../../assets/images/avatar-girl.svg'

const avatarMap = { boy: avatarBoy, girl: avatarGirl }

const userList = ref([])
const tableLoading = ref(false)
const searchKeyword = ref('')

// 心理状态选项
const MENTAL_STATUS_OPTIONS = [
  { label: '未评估', value: '未评估', tagType: 'info' },
  { label: '状态良好', value: '状态良好', tagType: 'success' },
  { label: '轻度焦虑', value: '轻度焦虑', tagType: 'warning' },
  { label: '中度焦虑', value: '中度焦虑', tagType: 'warning' },
  { label: '重度焦虑', value: '重度焦虑', tagType: 'danger' },
  { label: '轻度抑郁', value: '轻度抑郁', tagType: 'warning' },
  { label: '中度抑郁', value: '中度抑郁', tagType: 'danger' },
  { label: '重度抑郁', value: '重度抑郁', tagType: 'danger' },
  { label: '需要关注', value: '需要关注', tagType: 'danger' }
]

function getTagType(status) {
  const found = MENTAL_STATUS_OPTIONS.find(opt => opt.value === status)
  return found ? found.tagType : 'info'
}

// 搜索过滤后的列表
const filteredUserList = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  if (!keyword) return userList.value
  return userList.value.filter(user =>
    user.username.toLowerCase().includes(keyword) ||
    user.nickname?.toLowerCase().includes(keyword)
  )
})

async function loadUsers() {
  tableLoading.value = true
  try {
    const res = await getAdminUsersApi()
    userList.value = res.data
  } catch (error) {
    ElMessage.error(error.message || '获取用户列表失败')
  } finally {
    tableLoading.value = false
  }
}

// 心理状态编辑弹窗
const editDialogVisible = ref(false)
const editingUser = ref(null)
const editForm = ref({ mentalHealthStatus: '', mentalHealthNote: '' })
const editLoading = ref(false)

function openEditDialog(user) {
  editingUser.value = user
  editForm.value = {
    mentalHealthStatus: user.mentalHealthStatus || '未评估',
    mentalHealthNote: user.mentalHealthNote || ''
  }
  editDialogVisible.value = true
}

async function handleSaveMentalStatus() {
  editLoading.value = true
  try {
    const res = await updateMentalStatusApi(editingUser.value.id, editForm.value)
    // 更新本地数据
    const index = userList.value.findIndex(u => u.id === editingUser.value.id)
    if (index !== -1) {
      userList.value[index] = res.data
    }
    ElMessage.success('心理状态更新成功')
    editDialogVisible.value = false
  } catch (error) {
    ElMessage.error(error.message || '更新失败')
  } finally {
    editLoading.value = false
  }
}

async function handleDeleteUser(user) {
  try {
    await ElMessageBox.confirm(
      `确定要删除用户「${user.nickname || user.username}」吗？此操作不可恢复。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  try {
    await deleteAdminUserApi(user.id)
    userList.value = userList.value.filter(u => u.id !== user.id)
    ElMessage.success('用户已删除')
  } catch (error) {
    ElMessage.error(error.message || '删除失败')
  }
}

// 密码显隐控制（每行独立）
const passwordVisibleMap = ref({})
function togglePasswordVisible(userId) {
  passwordVisibleMap.value[userId] = !passwordVisibleMap.value[userId]
}

onMounted(() => {
  loadUsers()
})
</script>

<template>
  <div class="admin-container">
    <!-- 页头 -->
    <div class="admin-header">
      <div class="admin-title">
        <h2>用户管理</h2>
        <el-tag type="info" size="small">共 {{ filteredUserList.length }} 名用户</el-tag>
      </div>
      <div class="admin-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索用户名或昵称"
          clearable
          style="width: 220px;"
        />
        <el-button :icon="Refresh" @click="loadUsers" :loading="tableLoading">
          刷新
        </el-button>
      </div>
    </div>

    <!-- 用户列表表格 -->
    <el-card shadow="never" class="table-card">
      <el-table
        :data="filteredUserList"
        v-loading="tableLoading"
        stripe
        border
        style="width: 100%"
      >
        <el-table-column type="index" label="#" width="50" align="center" />

        <el-table-column label="用户名" prop="username" min-width="120">
          <template #default="{ row }">
            <div class="username-cell">
              <img
                :src="avatarMap[row.avatar] || avatarMap['boy']"
                class="user-avatar-img"
                alt="头像"
              />
              <span>{{ row.username }}</span>
              <el-tag v-if="row.role === 'admin'" type="danger" size="small">管理员</el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="昵称" prop="nickname" min-width="100" />

        <el-table-column label="密码" min-width="200">
          <template #default="{ row }">
            <div class="password-cell">
              <template v-if="passwordVisibleMap[row.id]">
                <span v-if="row.displayPassword" class="password-text">
                  {{ row.displayPassword }}
                </span>
                <span v-else class="password-na">（历史账号，无记录）</span>
              </template>
              <span v-else class="password-text">••••••••</span>

              <el-button
                :type="passwordVisibleMap[row.id] ? 'warning' : 'primary'"
                size="small"
                link
                @click="togglePasswordVisible(row.id)"
              >
                {{ passwordVisibleMap[row.id] ? '隐藏' : '查看' }}
              </el-button>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="心理状态" min-width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="getTagType(row.mentalHealthStatus)" size="default">
              {{ row.mentalHealthStatus || '未评估' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="备注" prop="mentalHealthNote" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="note-text">{{ row.mentalHealthNote || '—' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="注册时间" min-width="140" align="center">
          <template #default="{ row }">
            {{ new Date(row.createdAt).toLocaleDateString('zh-CN') }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="140" align="center" fixed="right">
          <template #default="{ row }">
            <el-button
              type="primary"
              size="small"
              :icon="EditPen"
              @click="openEditDialog(row)"
            >
              心理评估
            </el-button>
            <el-button
              v-if="row.role !== 'admin'"
              type="danger"
              size="small"
              :icon="Delete"
              @click="handleDeleteUser(row)"
              style="margin-left: 4px;"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 心理状态编辑弹窗 -->
    <el-dialog
      v-model="editDialogVisible"
      :title="`心理状态评估 — ${editingUser?.nickname || editingUser?.username}`"
      width="460px"
    >
      <el-form :model="editForm" label-width="90px">
        <el-form-item label="心理状态">
          <el-select v-model="editForm.mentalHealthStatus" style="width: 100%;">
            <el-option
              v-for="opt in MENTAL_STATUS_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注说明">
          <el-input
            v-model="editForm.mentalHealthNote"
            type="textarea"
            :rows="3"
            placeholder="请输入评估备注（选填）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="editLoading" @click="handleSaveMentalStatus">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.admin-container {
  height: 100%;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.admin-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.admin-title h2 {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
}

.admin-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.table-card {
  border-radius: 8px;
}

.username-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-avatar-img {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  border: 1.5px solid #e0e0e0;
  flex-shrink: 0;
}

.password-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.password-text {
  font-family: monospace;
  color: #374151;
  letter-spacing: 1px;
}

.password-na {
  color: #9ca3af;
  font-size: 12px;
  font-style: italic;
}

.note-text {
  color: #6b7280;
  font-size: 13px;
}
</style>
