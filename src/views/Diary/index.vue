<script setup>
/**
 * 日记列表：搜索、分页、跳转详情、删除
 */
import { ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Document, Delete, View } from '@element-plus/icons-vue'
import { useDiaryStore } from '../../store/diaryStore'

const router = useRouter()
const diaryStore = useDiaryStore()

const searchInput = ref('')
let searchDebounceTimer = null

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

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.title}」？`, '删除日记', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
    await diaryStore.removeEntry(row.id)
    ElMessage.success('已删除')
    await diaryStore.loadEntries()
  } catch (error) {
    if (error === 'cancel') return
    ElMessage.error(error?.message || '删除失败')
  }
}

function goDetail(row) {
  router.push({ name: 'diaryDetail', params: { id: row.id } })
}

onMounted(() => {
  diaryStore.loadEntries()
})

watch(searchInput, () => {
  if (searchDebounceTimer != null) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = window.setTimeout(() => {
    searchDebounceTimer = null
    diaryStore.keyword = searchInput.value
    diaryStore.page = 1
    diaryStore.loadEntries()
  }, 320)
})

function onPageChange(pageNum) {
  diaryStore.page = pageNum
  diaryStore.loadEntries()
}
</script>

<template>
  <div class="diary-page">
    <div class="diary-page-header">
      <h1 class="diary-page-title">我的日记</h1>
      <el-input
        v-model="searchInput"
        class="diary-search"
        clearable
        placeholder="搜索标题或正文"
        :prefix-icon="Search"
      />
    </div>

    <el-skeleton v-if="diaryStore.loading && diaryStore.entries.length === 0" :rows="6" animated />

    <div v-else-if="diaryStore.entries.length === 0" class="diary-empty">
      <el-icon :size="48" class="diary-empty-icon"><Document /></el-icon>
      <p>暂无日记</p>
      <p class="diary-empty-hint">在 AI 对话页可一键保存当前会话为日记</p>
    </div>

    <div v-else class="diary-card-list">
      <el-card
        v-for="row in diaryStore.entries"
        :key="row.id"
        class="diary-card"
        shadow="hover"
      >
        <div class="diary-card-head">
          <h2 class="diary-card-title" :title="row.title">{{ row.title }}</h2>
          <el-tag size="small" type="info">{{ sourceLabel(row.source) }}</el-tag>
        </div>
        <div
          v-if="row.moodKeywords && row.moodKeywords.length"
          class="diary-card-keywords"
        >
          <el-tag
            v-for="(keywordItem, keywordIndex) in row.moodKeywords"
            :key="`${row.id}-kw-${keywordIndex}`"
            size="small"
            effect="plain"
            round
          >
            {{ keywordItem }}
          </el-tag>
        </div>
        <p class="diary-card-preview">{{ row.preview }}</p>
        <div class="diary-card-meta">
          <span>{{ formatDateTime(row.updatedAt) }}</span>
          <div class="diary-card-actions">
            <el-button type="primary" link :icon="View" @click="goDetail(row)">
              查看
            </el-button>
            <el-button type="danger" link :icon="Delete" @click="handleDelete(row)">
              删除
            </el-button>
          </div>
        </div>
      </el-card>
    </div>

    <div v-if="diaryStore.total > diaryStore.pageSize" class="diary-pagination">
      <el-pagination
        :current-page="diaryStore.page"
        layout="prev, pager, next, total"
        :total="diaryStore.total"
        :page-size="diaryStore.pageSize"
        background
        @current-change="onPageChange"
      />
    </div>
  </div>
</template>

<style scoped>
.diary-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 16px 0 32px;
}

.diary-page-header {
  margin-bottom: 20px;
}

.diary-page-title {
  margin: 0 0 12px;
  font-size: 20px;
  font-weight: 600;
}

.diary-search {
  max-width: 360px;
}

.diary-empty {
  text-align: center;
  padding: 48px 16px;
  color: var(--el-text-color-secondary);
}

.diary-empty-icon {
  margin-bottom: 12px;
  opacity: 0.45;
}

.diary-empty-hint {
  font-size: 13px;
  margin-top: 8px;
}

.diary-card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.diary-card {
  cursor: default;
}

.diary-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.diary-card-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.diary-card-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.diary-card-preview {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--el-text-color-regular);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.diary-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.diary-card-actions {
  display: flex;
  gap: 4px;
}

.diary-pagination {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}
</style>
