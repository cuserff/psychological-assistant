<script setup>
// 404 等异常页面
</script>

<template>
  <div class="error-container">
    <h1>404</h1>
    <p>页面未找到</p>
    <router-link to="/">返回首页</router-link>
  </div>
</template>

<style scoped>
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  gap: 16px;
}

.error-container h1 {
  font-size: 72px;
  color: #909399;
}

.error-container p {
  font-size: 18px;
  color: #606266;
}
</style>
