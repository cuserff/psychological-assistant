<script setup>
// 单条消息气泡（AI 消息渲染 Markdown，用户消息纯文本）
import { renderMarkdown } from '../../utils/markdown'

defineProps({
  role: {
    type: String,
    default: 'user'
  },
  content: {
    type: String,
    default: ''
  }
})
</script>

<template>
  <div :class="['message-bubble', role === 'assistant' ? 'ai-bubble' : 'user-bubble']">
    <!-- AI 消息：渲染 Markdown -->
    <div
      v-if="role === 'assistant'"
      class="bubble-content markdown-body"
      v-html="renderMarkdown(content)"
    />
    <!-- 用户消息：纯文本 -->
    <div v-else class="bubble-content">{{ content }}</div>
  </div>
</template>

<style>
/* 引入 Markdown 样式（非 scoped） */
@import '../../assets/styles/markdown.css';
</style>

<style scoped>
.message-bubble {
  margin-bottom: 16px;
  display: flex;
}

.ai-bubble {
  justify-content: flex-start;
}

.user-bubble {
  justify-content: flex-end;
}

.bubble-content {
  max-width: 70%;
  padding: 12px 16px;
  border-radius: 16px;
  font-size: 15px;
  line-height: 1.5;
  word-wrap: break-word;
}

.ai-bubble .bubble-content {
  background-color: #fff;
  border: 1px solid #e8e8e8;
}

.user-bubble .bubble-content {
  background-color: var(--app-color-primary);
  color: white;
}
</style>
