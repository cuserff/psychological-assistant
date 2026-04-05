<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { useCheckinStore } from '../../store/checkinStore'
import { getTodayLocalDate } from '../../utils/date'
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
  },
  /**
   * 是否在「今日已打卡」时锁定编辑（用于首页避免重复提交）
   * - true：默认展示“已完成”，需要点击“修改”才可更新
   * - false：保持原行为（允许直接更新）
   */
  lockWhenCheckedIn: {
    type: Boolean,
    default: false
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
const isEditing = ref(true)

const isLocked = computed(() => props.lockWhenCheckedIn && props.todayCheckedIn && !isEditing.value)
const submitButtonText = computed(() => {
  if (props.todayCheckedIn && props.lockWhenCheckedIn && !isEditing.value) return '已完成'
  return props.todayCheckedIn ? '更新打卡' : '提交打卡'
})

// 已打卡时回填数据
onMounted(() => {
  if (props.todayRecord) {
    selectedMood.value = props.todayRecord.mood
    noteText.value = props.todayRecord.note || ''
  }
  // 首页锁定模式：今日已打卡则默认锁定；个人中心保持可编辑
  if (props.lockWhenCheckedIn && props.todayCheckedIn) {
    isEditing.value = false
  }
})

// 监听 todayRecord 变化（如父组件刷新数据后更新）
watch(() => props.todayRecord, (record) => {
  if (record) {
    selectedMood.value = record.mood
    noteText.value = record.note || ''
  }
})

watch(() => props.todayCheckedIn, (checked) => {
  if (props.lockWhenCheckedIn) {
    isEditing.value = !checked
  }
})

/**
 * 提交打卡
 * 前端计算今天的本地日期，传给后端，避免时区问题
 */
async function handleSubmit() {
  if (isLocked.value) return
  if (selectedMood.value === 0) return

  submitting.value = true
  try {
    const localDate = getTodayLocalDate()

    await checkinStore.checkin({
      date: localDate,
      mood: selectedMood.value,
      note: noteText.value.trim()
    })

    ElMessage.success(props.todayCheckedIn ? '打卡已更新' : '打卡成功')
    emit('checkin-success')

    if (props.lockWhenCheckedIn) {
      isEditing.value = false
    }
  } catch (error) {
    ElMessage.error(error.message || '打卡失败')
  } finally {
    submitting.value = false
  }
}

function enableEditing() {
  isEditing.value = true
}
</script>

<template>
  <el-card shadow="hover" class="mood-checkin-card">
    <template #header>
      <div class="card-header">
        <el-icon><EditPen /></el-icon>
        <span>今日情绪打卡</span>
        <el-tag v-if="todayCheckedIn" type="success" size="small" style="margin-left: auto;">
          已打卡
        </el-tag>
        <el-button
          v-if="lockWhenCheckedIn && todayCheckedIn && !isEditing"
          link
          type="primary"
          size="small"
          style="margin-left: 8px;"
          @click="enableEditing"
        >
          修改
        </el-button>
      </div>
    </template>

    <!-- 情绪等级选择 -->
    <div class="mood-selector">
      <div
        v-for="item in moodOptions"
        :key="item.value"
        class="mood-item"
        :class="{ active: selectedMood === item.value, locked: isLocked }"
        @click="!isLocked && (selectedMood = item.value)"
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
      :disabled="isLocked"
      style="margin-top: 16px;"
    />

    <!-- 提交按钮 -->
    <el-button
      type="primary"
      :loading="submitting"
      :disabled="isLocked || selectedMood === 0"
      style="margin-top: 16px; width: 100%;"
      @click="handleSubmit"
    >
      {{ submitButtonText }}
    </el-button>
  </el-card>
</template>

<style scoped>
.mood-checkin-card {
  --el-card-bg-color: var(--app-color-fill-muted);
  --el-card-border-color: var(--app-color-border);
  color: var(--app-color-text);
}

.mood-checkin-card :deep(.el-card__header) {
  background-color: transparent;
}

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
  background-color: var(--app-color-bg-elevated);
  opacity: 0.6;
}

.mood-item.locked {
  cursor: not-allowed;
  opacity: 0.55;
}

.mood-item:hover {
  opacity: 0.85;
  background-color: color-mix(in srgb, var(--app-color-primary) 10%, var(--app-color-bg-elevated));
}

/* 选中态：柔和阴影 + 轻微放大 + 全透明度 */
.mood-item.active {
  opacity: 1;
  background-color: color-mix(in srgb, var(--app-color-primary) 20%, var(--app-color-bg-elevated));
  box-shadow: 0 2px 12px color-mix(in srgb, var(--app-color-primary) 28%, transparent);
  transform: scale(1.05);
}

.mood-emoji {
  font-size: 28px;
  line-height: 1;
}

.mood-label {
  font-size: 12px;
  color: var(--app-color-text-secondary);
  margin-top: 6px;
}

.mood-item.active .mood-label {
  color: var(--app-color-primary);
  font-weight: 600;
}
</style>
