<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { HeatmapChart } from 'echarts/charts'
import {
  CalendarComponent,
  VisualMapComponent,
  TooltipComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { Calendar } from '@element-plus/icons-vue'
import { readCssVar } from '../../utils/cssVar'

// 按需注册 ECharts 模块，减小打包体积
echarts.use([
  HeatmapChart,
  CalendarComponent,
  VisualMapComponent,
  TooltipComponent,
  CanvasRenderer
])

const props = defineProps({
  /** 打卡记录数组，每条: { date: 'YYYY-MM-DD', mood: 1-5 } */
  records: {
    type: Array,
    default: () => []
  }
})

// 情绪等级对应的文字标签
const MOOD_LABELS = { 1: '很差', 2: '较差', 3: '一般', 4: '不错', 5: '很好' }

const chartContainer = ref(null)
// ECharts 实例不用 ref 包裹，避免 Vue 对其内部属性做深度代理导致性能损耗
let chartInstance = null

/**
 * 构建 ECharts 配置对象
 * 使用日历热力图（calendar + heatmap）展示全年情绪数据
 */
function buildChartOption(records) {
  const currentYear = new Date().getFullYear()

  // 将打卡记录转为 ECharts 需要的 [date, value] 格式
  const heatmapData = records
    .filter(r => r.date.startsWith(String(currentYear)))
    .map(r => [r.date, r.mood])

  const cellBg = readCssVar('--app-heatmap-cell-bg', '#ebedf0')
  const cellBorder = readCssVar('--app-heatmap-cell-border', '#ffffff')
  const splitLine = readCssVar('--app-heatmap-split', '#e5e7eb')

  return {
    tooltip: {
      formatter(params) {
        const [date, mood] = params.data || []
        if (!mood) return `${date}<br/>未打卡`
        return `${date}<br/>情绪：${MOOD_LABELS[mood]}（${mood} 分）`
      }
    },
    visualMap: {
      min: 1,
      max: 5,
      type: 'piecewise',
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      pieces: [
        { min: 1, max: 1, label: '很差', color: readCssVar('--app-mood-1', '#ef4444') },
        { min: 2, max: 2, label: '较差', color: readCssVar('--app-mood-2', '#f97316') },
        { min: 3, max: 3, label: '一般', color: readCssVar('--app-mood-3', '#eab308') },
        { min: 4, max: 4, label: '不错', color: readCssVar('--app-mood-4', '#22c55e') },
        { min: 5, max: 5, label: '很好', color: readCssVar('--app-mood-5', '#16a34a') }
      ]
    },
    calendar: {
      top: 60,
      left: 50,
      right: 30,
      cellSize: ['auto', 16],
      range: String(currentYear),
      itemStyle: {
        color: cellBg,
        borderWidth: 3,
        borderColor: cellBorder
      },
      yearLabel: { show: true, position: 'top' },
      dayLabel: {
        firstDay: 1,
        nameMap: 'ZH'
      },
      monthLabel: {
        nameMap: 'ZH'
      },
      splitLine: {
        show: true,
        lineStyle: { color: splitLine, width: 1 }
      }
    },
    series: [{
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data: heatmapData,
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.3)'
        }
      }
    }]
  }
}

function handleResize() {
  chartInstance?.resize()
}

onMounted(() => {
  if (!chartContainer.value) return
  chartInstance = echarts.init(chartContainer.value)
  chartInstance.setOption(buildChartOption(props.records))
  window.addEventListener('resize', handleResize)
})

// 监听 records 变化时重绘热力图（打卡后实时更新）
watch(() => props.records, (newRecords) => {
  if (chartInstance) {
    chartInstance.setOption(buildChartOption(newRecords))
  }
}, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
  chartInstance = null
})
</script>

<template>
  <el-card shadow="hover">
    <template #header>
      <div class="card-header">
        <el-icon><Calendar /></el-icon>
        <span>情绪热力图</span>
      </div>
    </template>
    <div ref="chartContainer" class="heatmap-chart"></div>
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

.heatmap-chart {
  width: 100%;
  height: 220px;
}
</style>
