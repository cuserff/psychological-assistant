<script setup>
// 单条消息气泡（后续集成 Markdown 与代码高亮）
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
    <div class="bubble-content">{{ content }}</div>
  </div>
</template>

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
  background-color: #0284c7;
  color: white;
}
</style>
