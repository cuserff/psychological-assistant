<script setup>
</script>

<template>
  <div class="about-container">
    <h2>关于系统</h2>
    <div class="about-content">
      <h3>技术栈</h3>
      <ul>
        <li>Vue 3 + Composition API</li>
        <li>Vue Router（路由管理）</li>
        <li>Pinia（状态管理）</li>
        <li>Element Plus（UI 组件库）</li>
        <li>Vite（构建工具）</li>
      </ul>
      
      <h3>功能模块</h3>
      <ul>
        <li>AI 智能对话（基于大语言模型）</li>
        <li>心理健康档案管理</li>
        <li>流式响应（SSE）</li>
        <li>响应式布局</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.about-container {
  padding: 20px;
}

.about-container h2 {
  color: var(--app-color-text);
}

.about-content {
  margin-top: 20px;
}

.about-content h3 {
  margin-top: 20px;
  color: var(--app-color-text);
}

.about-content ul {
  list-style-type: disc;
  padding-left: 20px;
  margin-top: 10px;
}

.about-content li {
  margin-bottom: 5px;
  color: var(--app-color-text-secondary);
}
</style>
