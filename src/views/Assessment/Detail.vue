<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { SCALES } from '../../data/scales'
import { useAssessmentStore } from '../../store/assessmentStore'
import { fetchAssessmentDetail } from '../../api/assessment'
import { readCssVar } from '../../utils/cssVar'

const route = useRoute()
const router = useRouter()
const assessmentStore = useAssessmentStore()

const recordId = String(route.params.id || '')
const loading = ref(false)
const record = ref(null)

function getTagType(severity) {
  const tagTypeMap = {
    normal: 'success',
    mild: 'warning',
    moderate: 'danger',
    'moderately-severe': 'danger',
    severe: 'danger'
  }
  return tagTypeMap[severity] || 'info'
}

function getSeverityColor(severity, scaleId) {
  const scale = SCALES[scaleId]
  const level = scale?.levels?.find(l => l.severity === severity)
  return level?.color || readCssVar('--app-color-text-muted', '#94a3b8')
}

function getScale(scaleId) {
  return SCALES[scaleId] || null
}

function formatTime(isoString) {
  if (!isoString) return '-'
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const displayScore = computed(() => {
  if (!record.value) return '-'
  const { rawScore, standardScore } = record.value
  if (standardScore !== null && standardScore !== undefined) return standardScore
  return rawScore
})

const suggestionText = computed(() => {
  if (!record.value) return ''
  const scale = SCALES[record.value.scaleId]
  const level = scale?.levels?.find(l => l.severity === record.value.severity)
  return level?.suggestion || ''
})

const answersDetail = computed(() => {
  if (!record.value) return []
  const scale = SCALES[record.value.scaleId]
  if (!scale) return []
  if (!Array.isArray(record.value.answers)) return []

  const answers = record.value.answers
  return answers.map((answerIndex, idx) => {
    const question = scale.questions?.[idx]
    const questionText =
      typeof question === 'string'
        ? question
        : question?.text || '-'

    const option = typeof answerIndex === 'number' ? scale.options?.[answerIndex] : null
    const answerLabel = option?.label || (answerIndex === null ? '未作答' : '-')

    return {
      index: idx + 1,
      questionText,
      answerLabel,
      answerIndex
    }
  })
})

async function loadRecord() {
  loading.value = true
  try {
    // 先保证 store 有数据：支持后端不可用时的本地兜底
    if (assessmentStore.records.length === 0) {
      await assessmentStore.loadHistory()
    }

    const localFound = assessmentStore.records.find(r => r.id === recordId) || null

    try {
      const res = await fetchAssessmentDetail(recordId)
      record.value = res?.data || localFound
    } catch {
      record.value = localFound
    }
  } finally {
    loading.value = false
  }
}

async function handleDelete() {
  if (!recordId) return

  try {
    await ElMessageBox.confirm('确定删除该条测评记录？此操作无法撤销。', '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }

  await assessmentStore.deleteHistoryRecord(recordId)
  ElMessage.success('删除成功')
  router.push('/assessment')
}

onMounted(loadRecord)
</script>

<template>
  <div class="assessment-detail">
    <div class="detail-header">
      <el-button text @click="router.push('/assessment')">返回</el-button>
      <div class="detail-title">测评详情</div>
      <div class="detail-actions">
        <el-button type="danger" text :disabled="loading" @click="handleDelete">
          删除
        </el-button>
      </div>
    </div>

    <div v-if="loading" class="loading-wrap">
      <el-skeleton :rows="8" animated />
    </div>

    <el-empty v-else-if="!record" description="未找到该测评记录" />

    <div v-else class="detail-content">
      <el-card shadow="never" class="summary-card">
        <template #header>
          <div class="summary-header">
            <span class="summary-scale-icon">{{ getScale(record.scaleId)?.icon || '📋' }}</span>
            <span class="summary-header-title">{{ record.scaleName || record.scaleId }}</span>
          </div>
        </template>

        <div class="summary-grid">
          <div class="summary-item">
            <div class="summary-label">得分</div>
            <div class="summary-value">{{ displayScore }}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">粗分</div>
            <div class="summary-value">{{ record.rawScore }}</div>
          </div>
          <div v-if="record.standardScore !== null && record.standardScore !== undefined" class="summary-item">
            <div class="summary-label">标准分</div>
            <div class="summary-value highlight">{{ record.standardScore }}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">测评时间</div>
            <div class="summary-value">{{ formatTime(record.createdAt) }}</div>
          </div>
        </div>

        <div class="level-row">
          <el-tag
            :type="getTagType(record.severity)"
            :color="getSeverityColor(record.severity, record.scaleId)"
            effect="dark"
          >
            {{ record.level }} ({{ record.severity }})
          </el-tag>
        </div>

        <div v-if="suggestionText" class="suggestion-box">
          <div class="suggestion-title">专业建议</div>
          <div class="suggestion-text">{{ suggestionText }}</div>
        </div>
      </el-card>

      <el-card shadow="never" class="answers-card" style="margin-top: 14px;">
        <template #header>
          <div class="answers-header">作答明细</div>
        </template>

        <el-empty v-if="answersDetail.length === 0" description="暂无作答明细" />

        <div v-else class="answers-list">
          <div v-for="item in answersDetail" :key="item.index" class="answer-item">
            <div class="answer-question">Q{{ item.index }}：{{ item.questionText }}</div>
            <div class="answer-answer">你的选择：{{ item.answerLabel }}</div>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.assessment-detail {
  max-width: 900px;
  margin: 0 auto;
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.detail-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--app-color-text);
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.loading-wrap {
  padding: 18px 0;
}

.detail-content {
  padding-bottom: 14px;
}

.summary-header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--app-color-text);
}

.summary-scale-icon {
  font-size: 18px;
  margin-right: 8px;
}

.summary-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 10px;
}

.summary-item {
  flex: 1 1 200px;
  background: var(--app-color-fill-muted);
  border: 1px solid var(--app-color-border);
  border-radius: 10px;
  padding: 12px 14px;
}

.summary-label {
  font-size: 12px;
  color: var(--app-color-text-muted);
  margin-bottom: 6px;
}

.summary-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--app-color-text);
}

.summary-value.highlight {
  color: var(--app-color-primary);
}

.level-row {
  margin-top: 4px;
  margin-bottom: 10px;
}

.suggestion-box {
  background: var(--app-color-primary-soft-bg);
  border: 1px solid var(--app-color-primary-muted);
  border-radius: 12px;
  padding: 12px 14px;
}

.suggestion-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-color-text);
  margin-bottom: 8px;
}

.suggestion-text {
  font-size: 14px;
  color: var(--app-color-el-text-regular);
  line-height: 1.8;
}

.answers-header {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-color-text);
}

.answers-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.answer-item {
  padding: 12px 14px;
  border: 1px solid var(--app-color-border);
  border-radius: 10px;
  background: var(--app-color-bg-elevated);
}

.answer-question {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-color-text);
  margin-bottom: 6px;
}

.answer-answer {
  font-size: 13px;
  color: var(--app-color-el-text-regular);
}
</style>

