<script setup>
import { ref, onMounted, watch } from 'vue'
import { useCheckinStore } from '../../store/checkinStore'
import { ElMessage } from 'element-plus'
import { EditPen } from '@element-plus/icons-vue'

const props = defineProps({
  /** 今天是否已打卡 */
  todayCheckedIn: {
    type: Boolean,
    default: false
  },
  /** 今天的打卡记录（已打卡时用于回显） */
  todayRecord: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['checkin-success'])

const checkinStore = useCheckinStore()

// 情绪等级选项
const moodOptions = [
  { value: 1, label: '很差', emoji: '\u{1F622}' },
  { value: 2, label: '较差', emoji: '\u{1F614}' },
  { value: 3, label: '一般', emoji: '\u{1F610}' },
  { value: 4, label: '不错', emoji: '\u{1F60A}' },
  { value: 5, label: '很好', emoji: '\u{1F604}' }
]

const selectedMood = ref(0)
const noteText = ref('')
const submitting = ref(false)

// 已打卡时回填数据
onMounted(() => {
  if (props.todayRecord) {
    selectedMood.value = props.todayRecord.mood
    noteText.value = props.todayRecord.note || ''
  }
})

// 监听 todayRecord 变化（如父组件刷新数据后更新）
watch(() => props.todayRecord, (record) => {
  if (record) {
    selectedMood.value = record.mood
    noteText.value = record.note || ''
  }
})

/**
 * 提交打卡
 * 前端计算今天的本地日期，传给后端，避免时区问题
 */
async function handleSubmit() {
  if (selectedMood.value === 0) return

  submitting.value = true
  try {
    // 使用本地日期，避免 UTC 时区偏移导致日期不一致
    const now = new Date()
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    await checkinStore.checkin({
      date: localDate,
      mood: selectedMood.value,
      note: noteText.value.trim()
    })

    ElMessage.success(props.todayCheckedIn ? '打卡已更新' : '打卡成功')
    emit('checkin-success')
  } catch (error) {
    ElMessage.error(error.message || '打卡失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-card shadow="hover">
    <template #header>
      <div class="card-header">
        <el-icon><EditPen /></el-icon>
        <span>今日情绪打卡</span>
        <el-tag v-if="todayCheckedIn" type="success" size="small" style="margin-left: auto;">
          已打卡
        </el-tag>
      </div>
    </template>

    <!-- 情绪等级选择 -->
    <div class="mood-selector">
      <div
        v-for="item in moodOptions"
        :key="item.value"
        class="mood-item"
        :class="{ active: selectedMood === item.value }"
        @click="selectedMood = item.value"
      >
        <span class="mood-emoji">{{ item.emoji }}</span>
        <span class="mood-label">{{ item.label }}</span>
      </div>
    </div>

    <!-- 备注输入 -->
    <el-input
      v-model="noteText"
      type="textarea"
      :rows="2"
      placeholder="记录一下今天的心情吧...（选填）"
      maxlength="200"
      show-word-limit
      style="margin-top: 16px;"
    />

    <!-- 提交按钮 -->
    <el-button
      type="primary"
      :loading="submitting"
      :disabled="selectedMood === 0"
      style="margin-top: 16px; width: 100%;"
      @click="handleSubmit"
    >
      {{ todayCheckedIn ? '更新打卡' : '提交打卡' }}
    </el-button>
  </el-card>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.mood-selector {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.mood-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 4px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.25s ease;
  background-color: #f8fafc;
  opacity: 0.6;
}

.mood-item:hover {
  opacity: 0.85;
  background-color: #f1f5f9;
}

/* 选中态：柔和阴影 + 轻微放大 + 全透明度 */
.mood-item.active {
  opacity: 1;
  background-color: #e0f2fe;
  box-shadow: 0 2px 12px rgba(2, 132, 199, 0.2);
  transform: scale(1.05);
}

.mood-emoji {
  font-size: 28px;
  line-height: 1;
}

.mood-label {
  font-size: 12px;
  color: #64748b;
  margin-top: 6px;
}

.mood-item.active .mood-label {
  color: #0284c7;
  font-weight: 600;
}
</style>
