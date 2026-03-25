<script setup>
/**
 * 量表选择卡片
 * 展示单个量表的概要信息，点击进入答题
 */
defineProps({
  /** 量表数据对象 */
  scale: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['start'])
</script>

<template>
  <el-card
    shadow="hover"
    class="scale-card"
    :style="{ '--card-color': scale.color }"
    @click="emit('start', scale.id)"
  >
    <div class="card-icon">{{ scale.icon }}</div>
    <h3 class="card-title">{{ scale.name }}</h3>
    <p class="card-subtitle">{{ scale.subtitle }}</p>
    <p class="card-desc">{{ scale.description }}</p>
    <div class="card-meta">
      <el-tag size="small" type="info">{{ scale.questionCount }} 题</el-tag>
      <el-tag size="small" type="info">约 {{ scale.estimatedTime }}</el-tag>
    </div>
    <el-button type="primary" class="card-btn" :color="scale.color">
      开始测评
    </el-button>
  </el-card>
</template>

<style scoped>
.scale-card {
  cursor: pointer;
  transition: all 0.3s ease;
  text-align: center;
  border-top: 3px solid var(--card-color);
}

.scale-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.card-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 4px;
}

.card-subtitle {
  font-size: 12px;
  color: #909399;
  margin: 0 0 10px;
}

.card-desc {
  font-size: 13px;
  color: #606266;
  line-height: 1.5;
  margin: 0 0 14px;
  min-height: 40px;
}

.card-meta {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 16px;
}

.card-btn {
  width: 100%;
}
</style>
