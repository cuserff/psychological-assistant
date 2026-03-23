<script setup>
// 消息列表容器
</script>

<template>
  <div class="message-list">
    <slot />
  </div>
</template>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
</style>
