<script setup>
import { computed } from 'vue'
import {
  ChatRound,
  ChatLineSquare,
  Calendar,
  SuccessFilled,
  TrendCharts,
  Sunny
} from '@element-plus/icons-vue'

const props = defineProps({
  /** 后端返回的统计数据对象 */
  stats: {
    type: Object,
    default: null
  },
  /** 是否正在加载 */
  loading: {
    type: Boolean,
    default: false
  }
})

/**
 * 将情绪均值转为带满分标注和文字描述的展示格式
 * 例如: 4.5 → "4.5/5 不错"
 */
function getMoodDisplay(score) {
  const labels = ['很差', '较差', '一般', '不错', '很好']
  const label = labels[Math.round(score) - 1] || ''
  return `${score}/5 ${label}`
}

/**
 * 6 张统计卡片的配置列表
 * 每张卡片包含：标签、数值、图标、背景色
 */
const cardList = computed(() => [
  {
    label: '累计对话天数',
    value: props.stats?.chatDays ?? '-',
    icon: Calendar,
    bgColor: '#e0f2fe',
    iconColor: '#0284c7'
  },
  {
    label: '会话总数',
    value: props.stats?.sessionCount ?? '-',
    icon: ChatRound,
    bgColor: '#fef3c7',
    iconColor: '#d97706'
  },
  {
    label: '消息总条数',
    value: props.stats?.messageCount ?? '-',
    icon: ChatLineSquare,
    bgColor: '#ede9fe',
    iconColor: '#7c3aed'
  },
  {
    label: '已坚持打卡',
    value: props.stats?.checkinDays != null ? `${props.stats.checkinDays} 天` : '-',
    icon: SuccessFilled,
    bgColor: '#d1fae5',
    iconColor: '#059669'
  },
  {
    label: '连续打卡',
    value: props.stats?.streakDays != null ? `${props.stats.streakDays} 天` : '-',
    icon: TrendCharts,
    bgColor: '#fee2e2',
    iconColor: '#dc2626'
  },
  {
    label: '近7天平均情绪',
    value: props.stats?.avgMood7d != null ? getMoodDisplay(props.stats.avgMood7d) : '暂无数据',
    icon: Sunny,
    bgColor: '#fff7ed',
    iconColor: '#ea580c'
  }
])
</script>

<template>
  <el-row :gutter="16">
    <el-col :span="8" v-for="card in cardList" :key="card.label" style="margin-bottom: 16px;">
      <el-card shadow="hover" class="stat-card" body-style="padding: 20px;">
        <div class="stat-content">
          <div class="stat-icon" :style="{ backgroundColor: card.bgColor }">
            <el-icon :size="24" :style="{ color: card.iconColor }">
              <component :is="card.icon" />
            </el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">
              <template v-if="loading">
                <el-skeleton :rows="0" animated style="width: 60px; height: 28px;" />
              </template>
              <span v-else>{{ card.value }}</span>
            </div>
            <div class="stat-label">{{ card.label }}</div>
          </div>
        </div>
      </el-card>
    </el-col>
  </el-row>
</template>

<style scoped>
.stat-card {
  transition: transform 0.2s;
}

.stat-card:hover {
  transform: translateY(-2px);
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-info {
  flex: 1;
  min-width: 0;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: #1e293b;
  line-height: 1.3;
}

.stat-label {
  font-size: 13px;
  color: #94a3b8;
  margin-top: 4px;
}
</style>
