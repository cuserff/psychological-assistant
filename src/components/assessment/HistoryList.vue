<script setup>
/**
 * 历史测评记录列表
 * 支持：筛选（量表/时间段/严重等级）、排序、分页、删除、跳转详情页
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElConfigProvider, ElMessage, ElMessageBox } from 'element-plus'
import { SCALES } from '../../data/scales'
import { useAssessmentStore } from '../../store/assessmentStore'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

const props = defineProps({
  /** 历史记录数组 */
  records: {
    type: Array,
    default: () => []
  },
  /** 是否加载中 */
  loading: {
    type: Boolean,
    default: false
  }
})

const router = useRouter()
const assessmentStore = useAssessmentStore()

// ==================== 筛选/排序/分页状态 ====================
const selectedScaleId = ref('all')
const selectedSeverity = ref('all')
const selectedDateRange = ref([]) // [start, end]，格式：YYYY-MM-DD
const selectedSortKey = ref('createdAt_desc')

const currentPage = ref(1)
const pageSize = ref(5)
const pageSizeOptions = [5, 10, 50]

function resetFilters() {
  selectedScaleId.value = 'all'
  selectedSeverity.value = 'all'
  selectedDateRange.value = []
  selectedSortKey.value = 'createdAt_desc'
  currentPage.value = 1
}

// ==================== 工具函数 ====================
/** 获取 el-tag type */
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

/** 格式化时间 */
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

function getScale(scaleId) {
  return SCALES[scaleId] || null
}

function getScoreValue(record) {
  if (!record) return 0
  if (record.standardScore !== null && record.standardScore !== undefined) return record.standardScore
  return record.rawScore || 0
}

const severityRank = {
  normal: 0,
  mild: 1,
  moderate: 2,
  'moderately-severe': 3,
  severe: 4
}

const scaleOptions = computed(() => Object.values(SCALES))

const severityOptions = computed(() => {
  const uniqueSeverityMap = new Map()
  for (const scale of Object.values(SCALES)) {
    for (const level of scale.levels || []) {
      if (!uniqueSeverityMap.has(level.severity)) {
        uniqueSeverityMap.set(level.severity, {
          severity: level.severity,
          label: level.label,
          color: level.color
        })
      }
    }
  }

  return Array.from(uniqueSeverityMap.values()).sort((a, b) => {
    return (severityRank[b.severity] ?? -1) - (severityRank[a.severity] ?? -1)
  })
})

const severityColorMap = computed(() => {
  const map = {}
  for (const option of severityOptions.value) map[option.severity] = option.color
  return map
})

function getSeverityColor(severity) {
  return severityColorMap.value[severity] || '#909399'
}

function getRecordCreatedAtMs(record) {
  const time = new Date(record?.createdAt).getTime()
  return Number.isFinite(time) ? time : null
}

function getDateRangeMsRange(dateRange) {
  if (!Array.isArray(dateRange) || dateRange.length !== 2) return { startMs: null, endMs: null }
  const [startStr, endStr] = dateRange
  const startMs = startStr ? new Date(`${startStr}T00:00:00`).getTime() : null
  const endMs = endStr ? new Date(`${endStr}T23:59:59`).getTime() : null
  return {
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs: Number.isFinite(endMs) ? endMs : null
  }
}

// ==================== 过滤/排序后数据 ====================
const filteredRecords = computed(() => {
  let result = Array.isArray(props.records) ? props.records.slice() : []

  if (selectedScaleId.value !== 'all') {
    result = result.filter(record => record.scaleId === selectedScaleId.value)
  }

  if (selectedSeverity.value !== 'all') {
    result = result.filter(record => record.severity === selectedSeverity.value)
  }

  const { startMs, endMs } = getDateRangeMsRange(selectedDateRange.value)
  if (startMs !== null || endMs !== null) {
    result = result.filter(record => {
      const createdAtMs = getRecordCreatedAtMs(record)
      if (createdAtMs === null) return false
      if (startMs !== null && createdAtMs < startMs) return false
      if (endMs !== null && createdAtMs > endMs) return false
      return true
    })
  }

  return result
})

const sortedRecords = computed(() => {
  const result = filteredRecords.value.slice()

  result.sort((a, b) => {
    if (selectedSortKey.value === 'createdAt_desc') {
      return (getRecordCreatedAtMs(b) ?? 0) - (getRecordCreatedAtMs(a) ?? 0)
    }
    if (selectedSortKey.value === 'createdAt_asc') {
      return (getRecordCreatedAtMs(a) ?? 0) - (getRecordCreatedAtMs(b) ?? 0)
    }
    if (selectedSortKey.value === 'score_desc') {
      return getScoreValue(b) - getScoreValue(a)
    }
    if (selectedSortKey.value === 'score_asc') {
      return getScoreValue(a) - getScoreValue(b)
    }
    if (selectedSortKey.value === 'severity_desc') {
      return (severityRank[b.severity] ?? -1) - (severityRank[a.severity] ?? -1)
    }
    if (selectedSortKey.value === 'severity_asc') {
      return (severityRank[a.severity] ?? -1) - (severityRank[b.severity] ?? -1)
    }
    return 0
  })

  return result
})

const totalRecords = computed(() => sortedRecords.value.length)
const pagedRecords = computed(() => {
  const startIndex = (currentPage.value - 1) * pageSize.value
  return sortedRecords.value.slice(startIndex, startIndex + pageSize.value)
})

watch([selectedScaleId, selectedSeverity, selectedDateRange, selectedSortKey], () => {
  currentPage.value = 1
}, { deep: true })

watch(totalRecords, () => {
  const maxPage = Math.max(1, Math.ceil(totalRecords.value / pageSize.value))
  if (currentPage.value > maxPage) currentPage.value = maxPage
})

function handlePageChange(newPage) {
  currentPage.value = newPage
}

function handleSizeChange(newSize) {
  pageSize.value = newSize
  currentPage.value = 1
}

// ==================== 行为：详情/删除 ====================
function handleGoDetail(recordId) {
  if (!recordId) return
  router.push({ name: 'assessmentDetail', params: { id: recordId } })
}

async function handleDeleteRecord(recordId) {
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

  try {
    await assessmentStore.deleteHistoryRecord(recordId)
    ElMessage.success('删除成功')
  } catch {
    ElMessage.error('删除失败，请稍后重试')
  }
}
</script>

<template>
  <div class="history-list">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-wrap">
      <el-skeleton :rows="6" animated />
    </div>

    <!-- 过滤器 -->
    <div v-else>
      <div class="filter-bar">
        <div class="filter-title">筛选与排序</div>
        <el-form :inline="true" class="filter-form">
          <el-form-item label="量表">
            <el-select v-model="selectedScaleId" style="width: 220px">
              <el-option value="all" label="全部量表" />
              <el-option
                v-for="scale in scaleOptions"
                :key="scale.id"
                :value="scale.id"
                :label="scale.name"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="时间段">
            <el-date-picker
              v-model="selectedDateRange"
              type="daterange"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              range-separator="至"
              value-format="YYYY-MM-DD"
              clearable
              style="width: 300px"
            />
          </el-form-item>

          <el-form-item label="严重等级">
            <el-select v-model="selectedSeverity" style="width: 200px">
              <el-option value="all" label="全部等级" />
              <el-option
                v-for="severityOption in severityOptions"
                :key="severityOption.severity"
                :value="severityOption.severity"
                :label="severityOption.label"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="排序">
            <el-select v-model="selectedSortKey" style="width: 200px">
              <el-option value="createdAt_desc" label="时间倒序" />
              <el-option value="createdAt_asc" label="时间正序" />
              <el-option value="score_desc" label="得分高到低" />
              <el-option value="score_asc" label="得分低到高" />
              <el-option value="severity_desc" label="严重程度高到低" />
              <el-option value="severity_asc" label="严重程度低到高" />
            </el-select>
          </el-form-item>

          <el-form-item>
            <el-button @click="resetFilters">重置</el-button>
          </el-form-item>
        </el-form>
      </div>

      <!-- 空状态 -->
      <el-empty v-if="totalRecords === 0" description="暂无匹配的测评记录" />

      <!-- 表格 -->
      <el-table
        v-else
        :data="pagedRecords"
        stripe
        style="width: 100%;"
      >
        <el-table-column label="量表" min-width="220">
          <template #default="{ row }">
            <div class="scale-name-cell">
              <span class="scale-icon">{{ getScale(row.scaleId)?.icon || '📋' }}</span>
              <span class="scale-name">{{ row.scaleName || row.scaleId }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="得分" width="120" align="center">
          <template #default="{ row }">
            <span class="score-text">{{ getScoreValue(row) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="严重等级" width="140" align="center">
          <template #default="{ row }">
            <el-tag
              :type="getTagType(row.severity)"
              :color="getSeverityColor(row.severity)"
              effect="dark"
              size="small"
            >
              {{ row.level || row.severity }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="测评时间" width="200" align="center">
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="180" align="center">
          <template #default="{ row }">
            <el-button
              text
              type="primary"
              size="small"
              @click="handleGoDetail(row.id)"
            >
              详情
            </el-button>
            <el-button
              text
              type="danger"
              size="small"
              @click="handleDeleteRecord(row.id)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-wrap">
        <el-config-provider :locale="zhCn">
          <el-pagination
            background
            :current-page="currentPage"
            :page-size="pageSize"
            :total="totalRecords"
            layout="total, sizes, prev, pager, next, jumper"
            :page-sizes="pageSizeOptions"
            prev-text="上一页"
            next-text="下一页"
            @current-change="handlePageChange"
            @size-change="handleSizeChange"
          />
        </el-config-provider>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-list {
  width: 100%;
}

.loading-wrap {
  padding: 20px;
}

.filter-bar {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 14px;
}

.filter-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 10px;
}

.filter-form :deep(.el-form-item__label) {
  color: #606266;
  font-weight: 500;
}

.scale-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scale-icon {
  font-size: 20px;
}

.scale-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.score-text {
  font-size: 16px;
  font-weight: 700;
  color: #303133;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  padding: 14px 0 0;
}
</style>
