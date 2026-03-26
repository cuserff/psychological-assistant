<script setup>
/**
 * 测评结果展示组件
 * 展示评分、等级、环形图表、专业建议和免责声明
 */
import { ref, onMounted, computed } from 'vue'
import * as echarts from 'echarts'
import { WarningFilled, RefreshRight, Back } from '@element-plus/icons-vue'
import { readCssVar } from '../../utils/cssVar'

const props = defineProps({
  /** 测评结果数据 */
  result: {
    type: Object,
    required: true
    // { scaleId, scaleName, rawScore, standardScore, level, severity, levelInfo, scale }
  }
})

const emit = defineEmits(['retry', 'back'])

const chartRef = ref(null)

// 用于展示的得分（SDS/SAS 用标准分，其他用粗分）
const displayScore = computed(() =>
  props.result.standardScore !== null ? props.result.standardScore : props.result.rawScore
)

// 满分
const displayTotal = computed(() =>
  props.result.scale.useStandardScore ? props.result.scale.standardTotalScore : props.result.scale.totalScore
)

// 得分百分比
const scorePercent = computed(() =>
  Math.round((displayScore.value / displayTotal.value) * 100)
)

onMounted(() => {
  initChart()
})

/** 初始化 ECharts 环形图 */
function initChart() {
  if (!chartRef.value) return

  const chart = echarts.init(chartRef.value)
  const levelColor = props.result.levelInfo.color
  const remainColor = readCssVar('--app-chart-donut-track', '#e2e8f0')

  chart.setOption({
    series: [
      {
        type: 'pie',
        radius: ['60%', '80%'],
        avoidLabelOverlap: false,
        label: {
          show: true,
          position: 'center',
          formatter: () => `${displayScore.value} 分`,
          fontSize: 28,
          fontWeight: 'bold',
          color: levelColor
        },
        emphasis: { scale: false },
        data: [
          {
            value: displayScore.value,
            name: '得分',
            itemStyle: { color: levelColor }
          },
          {
            value: displayTotal.value - displayScore.value,
            name: '剩余',
            itemStyle: { color: remainColor }
          }
        ],
        animationDuration: 1200,
        animationEasing: 'cubicOut'
      }
    ]
  })

  // 响应容器尺寸变化
  window.addEventListener('resize', () => chart.resize())
}
</script>

<template>
  <div class="scale-result">
    <!-- 标题 -->
    <div class="result-header">
      <h2 class="result-title">{{ result.scaleName }}</h2>
      <p class="result-subtitle">测评结果报告</p>
    </div>

    <!-- 图表 + 分数信息 -->
    <div class="result-main">
      <div class="chart-section">
        <div ref="chartRef" class="chart-container"></div>
        <p class="chart-label">总分 {{ displayTotal }}</p>
      </div>

      <div class="score-detail">
        <!-- 等级标签 -->
        <div class="level-badge" :style="{ background: result.levelInfo.color }">
          {{ result.level }}
        </div>

        <!-- 分数明细 -->
        <div class="score-items">
          <div class="score-item">
            <span class="score-label">{{ result.scale.useStandardScore ? '粗分' : '总分' }}</span>
            <span class="score-value">{{ result.rawScore }}</span>
          </div>
          <div v-if="result.standardScore !== null" class="score-item">
            <span class="score-label">标准分</span>
            <span class="score-value highlight">{{ result.standardScore }}</span>
          </div>
          <div class="score-item">
            <span class="score-label">满分</span>
            <span class="score-value">{{ displayTotal }}</span>
          </div>
        </div>

        <!-- 进度条可视化 -->
        <div class="score-bar">
          <div class="bar-track">
            <div
              class="bar-fill"
              :style="{ width: scorePercent + '%', background: result.levelInfo.color }"
            ></div>
          </div>
          <span class="bar-percent">{{ scorePercent }}%</span>
        </div>
      </div>
    </div>

    <!-- 分级标尺 -->
    <div class="level-scale">
      <div
        v-for="lvl in result.scale.levels"
        :key="lvl.severity"
        class="level-segment"
        :class="{ active: lvl.severity === result.severity }"
        :style="{
          flex: lvl.max - lvl.min + 1,
          background: lvl.severity === result.severity ? lvl.color : lvl.color + '30'
        }"
      >
        <span class="segment-label">{{ lvl.label }}</span>
        <span class="segment-range">{{ lvl.min }}-{{ lvl.max }}</span>
      </div>
    </div>

    <!-- 专业建议 -->
    <el-card shadow="never" class="suggestion-card">
      <template #header>
        <div class="suggestion-header">
          <el-icon class="suggestion-warn-icon" :size="18"><WarningFilled /></el-icon>
          <span>专业建议</span>
        </div>
      </template>
      <p class="suggestion-text">{{ result.levelInfo.suggestion }}</p>
    </el-card>

    <!-- 免责声明 -->
    <div class="disclaimer">
      <el-icon class="disclaimer-warn-icon"><WarningFilled /></el-icon>
      <p>本测评结果仅供参考，不构成临床诊断。如您感到严重不适，请及时寻求专业精神科医生或心理治疗师的帮助。24小时心理援助热线：400-161-9995</p>
    </div>

    <!-- 操作按钮 -->
    <div class="action-buttons">
      <el-button @click="emit('back')">
        <el-icon><Back /></el-icon>
        返回量表列表
      </el-button>
      <el-button type="primary" @click="emit('retry')">
        <el-icon><RefreshRight /></el-icon>
        重新测评
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.scale-result {
  max-width: 700px;
  margin: 0 auto;
}

.result-header {
  text-align: center;
  margin-bottom: 28px;
}

.result-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--app-color-text);
  margin: 0 0 4px;
}

.result-subtitle {
  font-size: 14px;
  color: var(--app-color-text-muted);
  margin: 0;
}

/* 图表 + 分数 */
.result-main {
  display: flex;
  gap: 32px;
  align-items: center;
  margin-bottom: 28px;
  background: var(--app-color-bg-elevated);
  border: 1px solid var(--app-color-border);
  border-radius: 12px;
  padding: 24px;
}

.chart-section {
  text-align: center;
  flex-shrink: 0;
}

.chart-container {
  width: 200px;
  height: 200px;
}

.chart-label {
  font-size: 13px;
  color: var(--app-color-text-muted);
  margin: 4px 0 0;
}

.score-detail {
  flex: 1;
}

.level-badge {
  display: inline-block;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  padding: 6px 20px;
  border-radius: 20px;
  margin-bottom: 16px;
}

.score-items {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
}

.score-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.score-label {
  font-size: 12px;
  color: var(--app-color-text-muted);
}

.score-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--app-color-text);
}

.score-value.highlight {
  color: var(--app-color-primary);
}

.score-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bar-track {
  flex: 1;
  height: 8px;
  background: var(--app-color-fill-muted);
  border-radius: 4px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 1.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.bar-percent {
  font-size: 13px;
  color: var(--app-color-el-text-regular);
  font-weight: 600;
  min-width: 36px;
}

/* 分级标尺 */
.level-scale {
  display: flex;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 24px;
}

.level-segment {
  padding: 10px 4px;
  text-align: center;
  transition: all 0.3s;
  min-width: 0;
}

.level-segment.active {
  transform: scaleY(1.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 1;
}

.segment-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--app-color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.level-segment.active .segment-label {
  color: #fff;
}

.segment-range {
  display: block;
  font-size: 10px;
  color: var(--app-color-text-muted);
  margin-top: 2px;
}

.level-segment.active .segment-range {
  color: rgba(255, 255, 255, 0.8);
}

/* 建议卡片 */
.suggestion-card {
  margin-bottom: 16px;
}

.suggestion-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
}

.suggestion-warn-icon {
  color: var(--app-color-primary);
}

.suggestion-text {
  font-size: 14px;
  color: var(--app-color-el-text-regular);
  line-height: 1.8;
  margin: 0;
}

/* 免责声明 */
.disclaimer {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  background: var(--app-color-warning-bg);
  border: 1px solid var(--app-color-warning-border);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 24px;
}

.disclaimer-warn-icon {
  color: var(--app-color-text-muted);
  flex-shrink: 0;
}

.disclaimer p {
  font-size: 12px;
  color: var(--app-color-text-muted);
  line-height: 1.6;
  margin: 0;
}

/* 操作按钮 */
.action-buttons {
  display: flex;
  justify-content: center;
  gap: 16px;
}
</style>
