<script setup>
/**
 * 心理测评主页
 *
 * 采用状态机控制三个阶段：
 * - select：量表选择（默认）
 * - test：答题中
 * - result：结果展示
 *
 * 同时提供「历史记录」标签页查看过往测评
 */
import { ref, onMounted } from 'vue'
import { useAssessmentStore } from '../../store/assessmentStore'
import { SCALE_LIST } from '../../data/scales'
import ScaleCard from '../../components/assessment/ScaleCard.vue'
import ScaleTest from '../../components/assessment/ScaleTest.vue'
import ScaleResult from '../../components/assessment/ScaleResult.vue'
import HistoryList from '../../components/assessment/HistoryList.vue'
import { List, EditPen } from '@element-plus/icons-vue'

const assessmentStore = useAssessmentStore()

// 当前激活的 Tab
const activeTab = ref('start')

// 状态机：select → test → result
const phase = ref('select')

// 当前选中的量表 ID
const currentScaleId = ref('')

// 测评结果数据
const currentResult = ref(null)

onMounted(() => {
  // 进入页面时加载历史记录
  assessmentStore.loadHistory()
})

/** 开始测评：从量表选择进入答题 */
function handleStartTest(scaleId) {
  currentScaleId.value = scaleId
  phase.value = 'test'
}

/** 答题完成：进入结果展示 */
function handleTestComplete(result) {
  currentResult.value = result
  phase.value = 'result'
}

/** 返回量表选择 */
function handleBackToSelect() {
  phase.value = 'select'
  currentScaleId.value = ''
  currentResult.value = null
}

/** 重新测评当前量表 */
function handleRetry() {
  currentResult.value = null
  phase.value = 'test'
}
</script>

<template>
  <div class="assessment-container">
    <el-tabs v-model="activeTab" class="assessment-tabs">
      <!-- Tab 1: 开始测评 -->
      <el-tab-pane name="start">
        <template #label>
          <span class="tab-label">
            <el-icon><EditPen /></el-icon>
            开始测评
          </span>
        </template>

        <!-- 阶段1：量表选择 -->
        <div v-if="phase === 'select'" class="select-phase">
          <div class="phase-header">
            <h2 class="phase-title">选择测评量表</h2>
            <p class="phase-desc">请选择一个心理测评量表开始评估，所有量表均为国际通用标准化工具</p>
          </div>

          <el-row :gutter="20">
            <el-col v-for="scale in SCALE_LIST" :key="scale.id" :xs="24" :sm="12" :lg="6">
              <ScaleCard :scale="scale" @start="handleStartTest" />
            </el-col>
          </el-row>
        </div>

        <!-- 阶段2：答题中 -->
        <ScaleTest
          v-else-if="phase === 'test'"
          :scale-id="currentScaleId"
          @complete="handleTestComplete"
          @back="handleBackToSelect"
        />

        <!-- 阶段3：结果展示 -->
        <ScaleResult
          v-else-if="phase === 'result'"
          :result="currentResult"
          @back="handleBackToSelect"
          @retry="handleRetry"
        />
      </el-tab-pane>

      <!-- Tab 2: 历史记录 -->
      <el-tab-pane name="history">
        <template #label>
          <span class="tab-label">
            <el-icon><List /></el-icon>
            历史记录
          </span>
        </template>

        <div class="history-phase">
          <div class="phase-header">
            <h2 class="phase-title">测评历史</h2>
            <p class="phase-desc">查看您的历史心理测评记录和评估结果</p>
          </div>

          <HistoryList
            :records="assessmentStore.records"
            :loading="assessmentStore.loading"
          />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.assessment-container {
  max-width: 1200px;
  margin: 0 auto;
}

.assessment-tabs {
  background: #fff;
  border-radius: 8px;
  padding: 16px 20px;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.phase-header {
  margin-bottom: 24px;
}

.phase-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 6px;
}

.phase-desc {
  font-size: 14px;
  color: #909399;
  margin: 0;
}

.select-phase :deep(.el-col) {
  margin-bottom: 20px;
}
</style>
