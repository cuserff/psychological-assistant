<script setup>
/**
 * 侧栏菜单（桌面 el-aside 与移动端 el-drawer 共用）
 */
import { useRoute } from 'vue-router'
import { useUserStore } from '../../store/userStore'
import {
  HomeFilled,
  ChatRound,
  User,
  Document,
  Management,
  EditPen
} from '@element-plus/icons-vue'

defineProps({
  collapse: {
    type: Boolean,
    default: false
  }
})

defineEmits(['navigate'])

const route = useRoute()
const userStore = useUserStore()
</script>

<template>
  <el-menu
    :default-active="route.path"
    :collapse="collapse"
    :collapse-transition="false"
    class="sidebar-menu"
    :background-color="'var(--app-sidebar-bg)'"
    :text-color="'var(--app-sidebar-text)'"
    :active-text-color="'var(--app-sidebar-active)'"
    router
    @select="$emit('navigate')"
  >
    <el-menu-item index="/">
      <el-icon><HomeFilled /></el-icon>
      <template #title>首页</template>
    </el-menu-item>

    <el-menu-item index="/chat">
      <el-icon><ChatRound /></el-icon>
      <template #title>AI 对话</template>
    </el-menu-item>

    <el-menu-item index="/assessment">
      <el-icon><EditPen /></el-icon>
      <template #title>心理测评</template>
    </el-menu-item>

    <el-menu-item index="/profile">
      <el-icon><User /></el-icon>
      <template #title>个人中心</template>
    </el-menu-item>

    <el-menu-item index="/about">
      <el-icon><Document /></el-icon>
      <template #title>关于系统</template>
    </el-menu-item>

    <el-divider v-if="userStore.isAdmin" class="sidebar-admin-divider" />
    <el-menu-item v-if="userStore.isAdmin" index="/admin">
      <el-icon><Management /></el-icon>
      <template #title>用户管理</template>
    </el-menu-item>
  </el-menu>
</template>

<style scoped>
.sidebar-menu {
  border-right: none;
}

.sidebar-menu:not(.el-menu--collapse) {
  width: var(--app-sidebar-width);
}

.sidebar-admin-divider {
  border-color: var(--app-sidebar-border) !important;
  margin: var(--app-space-1) 0 !important;
}
</style>
