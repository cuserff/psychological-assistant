<script setup>
/**
 * 日记详情：结构化摘要 + 对话时心情曲线 + 归档正文
 */
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import { useDiaryStore } from '../../store/diaryStore'
import { readCssVar } from '../../utils/cssVar'

const route = useRoute()
const router = useRouter()
const diaryStore = useDiaryStore()
const loadError = ref('')

const moodChartRef = ref(null)
/** @type {echarts.ECharts|null} */
let moodChartInstance = null

function sourceLabel(source) {
  return source === 'voice' ? '语音通话' : 'AI 对话'
}

function formatDateTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return String(iso)
  }
}

function disposeMoodChart() {
  if (moodChartInstance) {
    moodChartInstance.dispose()
    moodChartInstance = null
  }
}

function initMoodChart(detailRow) {
  disposeMoodChart()
  const points = detailRow?.moodCurve?.points
  if (!Array.isArray(points) || points.length === 0 || !moodChartRef.value) {
    return
  }
  moodChartInstance = echarts.init(moodChartRef.value)
  const labels = points.map((pointItem) => String(pointItem.label || ''))
  const scores = points.map((pointItem) => Number(pointItem.score))
  const lineColor = readCssVar('--el-color-primary', '#409eff')
  const axisColor = readCssVar('--el-text-color-secondary', '#909399')
  const splitLineColor = readCssVar('--el-border-color-lighter', '#ebeef5')

  moodChartInstance.setOption({
    grid: { left: 48, right: 20, top: 28, bottom: 40 },
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const firstParam = Array.isArray(params) ? params[0] : params
        if (!firstParam) return ''
        return `${firstParam.name}<br/>心情指数：${firstParam.value} / 10`
      }
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: axisColor, rotate: labels.some((label) => label.length > 4) ? 28 : 0 },
      axisLine: { lineStyle: { color: splitLineColor } }
    },
    yAxis: {
      type: 'value',
      min: 1,
      max: 10,
      splitNumber: 9,
      axisLabel: { color: axisColor },
      splitLine: { lineStyle: { color: splitLineColor, type: 'dashed' } }
    },
    series: [
      {
        type: 'line',
        smooth: 0.35,
        symbol: 'circle',
        symbolSize: 8,
        data: scores,
        lineStyle: { width: 2, color: lineColor },
        itemStyle: { color: lineColor },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${lineColor}44` },
              { offset: 1, color: `${lineColor}06` }
            ]
          }
        }
      }
    ]
  })
}

function onWindowResize() {
  moodChartInstance?.resize()
}

watch(
  () => diaryStore.detail,
  (detailRow) => {
    if (!detailRow) return
    nextTick(() => {
      initMoodChart(detailRow)
    })
  }
)

onMounted(async () => {
  loadError.value = ''
  diaryStore.clearDetail()
  try {
    await diaryStore.loadDetail(route.params.id)
  } catch (error) {
    loadError.value = error?.message || '加载失败'
    ElMessage.error(loadError.value)
  }
  window.addEventListener('resize', onWindowResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  disposeMoodChart()
  diaryStore.clearDetail()
})

function goBack() {
  router.push({ name: 'diary' })
}

const hasStructured = (row) =>
  Boolean(
    row
      && (
        (Array.isArray(row.moodKeywords) && row.moodKeywords.length > 0)
        || row.coreEvents
        || row.aiEncouragement
        || (row.moodCurve?.points && row.moodCurve.points.length > 0)
      )
  )
</script>

<template>
  <div class="diary-detail-page">
    <header class="diary-detail-top">
      <el-button text :icon="ArrowLeft" @click="goBack">返回列表</el-button>
    </header>

    <el-empty v-if="loadError" :description="loadError" />

    <template v-else-if="diaryStore.detail">
      <h1 class="diary-detail-title">{{ diaryStore.detail.title }}</h1>
      <div class="diary-detail-meta">
        <el-tag size="small" type="info">{{ sourceLabel(diaryStore.detail.source) }}</el-tag>
        <span class="diary-detail-time">{{ formatDateTime(diaryStore.detail.updatedAt) }}</span>
      </div>

      <div v-if="hasStructured(diaryStore.detail)" class="diary-structured">
        <div
          v-if="diaryStore.detail.moodKeywords?.length"
          class="diary-block diary-block--tags"
        >
          <h2 class="diary-block-title">今日心情关键词</h2>
          <div class="diary-tag-row">
            <el-tag
              v-for="(keywordItem, keywordIndex) in diaryStore.detail.moodKeywords"
              :key="`${keywordIndex}-${keywordItem}`"
              size="small"
              effect="plain"
              class="diary-keyword-tag"
            >
              {{ keywordItem }}
            </el-tag>
          </div>
        </div>

        <div v-if="diaryStore.detail.coreEvents" class="diary-block">
          <h2 class="diary-block-title">核心事件</h2>
          <p class="diary-block-text">{{ diaryStore.detail.coreEvents }}</p>
        </div>

        <div v-if="diaryStore.detail.aiEncouragement" class="diary-block diary-block--encourage">
          <h2 class="diary-block-title">小愈的寄语</h2>
          <p class="diary-block-text diary-encourage-body">
            {{ diaryStore.detail.aiEncouragement }}
          </p>
        </div>

        <div
          v-if="diaryStore.detail.moodCurve?.points?.length"
          class="diary-block diary-block--chart"
        >
          <h2 class="diary-block-title">对话心情曲线</h2>
          <p class="diary-chart-hint">横轴为对话阶段，纵轴 1～10 表示情绪积极程度（越高越正向、平稳）。</p>
          <div ref="moodChartRef" class="diary-mood-chart" />
        </div>
      </div>

      <div class="diary-archive">
        <h2 class="diary-block-title">归档正文</h2>
        <pre class="diary-detail-body">{{ diaryStore.detail.content }}</pre>
      </div>
    </template>

    <el-skeleton v-else :rows="10" animated />
  </div>
</template>

<style scoped>
.diary-detail-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 16px 0 40px;
}

.diary-detail-top {
  margin-bottom: 16px;
}

.diary-detail-title {
  margin: 0 0 12px;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
}

.diary-detail-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.diary-structured {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.diary-block {
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--app-color-bg-elevated, var(--el-fill-color-light));
  border: 1px solid var(--el-border-color-lighter);
}

.diary-block-title {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.diary-block-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-break: break-word;
}

.diary-block--encourage {
  border-color: color-mix(in srgb, var(--el-color-primary) 22%, var(--el-border-color-lighter));
  background: color-mix(in srgb, var(--el-color-primary) 6%, var(--app-color-bg-elevated, #fff));
}

.diary-encourage-body {
  font-style: italic;
}

.diary-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.diary-keyword-tag {
  border-radius: 999px;
}

.diary-chart-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.diary-mood-chart {
  width: 100%;
  height: 260px;
}

.diary-archive .diary-block-title {
  margin-bottom: 12px;
}

.diary-detail-body {
  margin: 0;
  padding: 16px;
  border-radius: 12px;
  background: var(--app-color-bg-elevated, var(--el-fill-color-light));
  border: 1px solid var(--el-border-color-lighter);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--el-text-color-primary);
}
</style>
