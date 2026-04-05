import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  fetchDiaryEntries,
  createDiaryEntry as apiCreateDiaryEntry,
  getDiaryEntryDetail,
  deleteDiaryEntry as apiDeleteDiaryEntry
} from '../api/diary'

export const useDiaryStore = defineStore('diary', () => {
  /** @type {import('vue').Ref<Array>} */
  const entries = ref([])
  const total = ref(0)
  const loading = ref(false)
  /** @type {import('vue').Ref<object|null>} */
  const detail = ref(null)
  const keyword = ref('')
  const page = ref(1)
  const pageSize = ref(20)

  async function loadEntries() {
    loading.value = true
    try {
      const res = await fetchDiaryEntries({
        keyword: keyword.value.trim() || undefined,
        page: page.value,
        pageSize: pageSize.value
      })
      entries.value = Array.isArray(res?.list) ? res.list : []
      total.value = typeof res?.total === 'number' ? res.total : 0
    } finally {
      loading.value = false
    }
  }

  /**
   * @param {{ title?: string, content: string, source?: 'chat'|'voice' }} payload
   */
  async function createEntry(payload) {
    return apiCreateDiaryEntry(payload)
  }

  async function loadDetail(id) {
    const row = await getDiaryEntryDetail(id)
    detail.value = row
    return row
  }

  async function removeEntry(id) {
    await apiDeleteDiaryEntry(id)
  }

  function clearDetail() {
    detail.value = null
  }

  return {
    entries,
    total,
    loading,
    detail,
    keyword,
    page,
    pageSize,
    loadEntries,
    createEntry,
    loadDetail,
    removeEntry,
    clearDetail
  }
})
