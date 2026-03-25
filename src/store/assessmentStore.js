import { defineStore } from 'pinia'
import { ref } from 'vue'
import { submitAssessment, fetchAssessmentHistory, deleteAssessment } from '../api/assessment'
import { getItem, setItem, getToken } from '../utils/storage'
import { useUserStore } from './userStore'

export const useAssessmentStore = defineStore('assessment', () => {
  /** 历史测评记录 */
  const records = ref([])

  /** 加载状态 */
  const loading = ref(false)

  /**
   * 本地兜底存储（后端不可用时保证刷新不丢）
   * 关键点：key 需要按当前登录用户隔离，避免切换账号后串用户数据
   */
  function getLocalRecordsKey() {
    const userStore = useUserStore()
    const currentUserIdFromMemory = userStore.userInfo?.id
    const currentUserIdFromStorage = getItem('current_user_id')
    const currentUserFromStorage = getItem('current_user')
    const currentUsernameFromStorage = getItem('current_username')
    const resolvedUserId =
      currentUserIdFromMemory
      || currentUserIdFromStorage
      || currentUserFromStorage?.id
      || currentUserFromStorage?.userId
      || currentUserFromStorage?._id
      || currentUserFromStorage?.username
      || currentUserFromStorage?.userName
      || currentUserFromStorage?.email
      || currentUsernameFromStorage

    // 若用户标识缺失，回退使用 token 隔离
    if (resolvedUserId) return `assessment_local_records_user_${resolvedUserId}`
    return `assessment_local_records_${getToken() || 'anonymous'}`
  }

  /**
   * 本地删除墓碑 key：用于后端不可用/不支持删除时，保证刷新后不再展示已删除记录
   */
  function getDeletedRecordsKey() {
    const userStore = useUserStore()
    const currentUserIdFromMemory = userStore.userInfo?.id
    const currentUserIdFromStorage = getItem('current_user_id')
    const currentUserFromStorage = getItem('current_user')
    const currentUsernameFromStorage = getItem('current_username')

    const resolvedUserId =
      currentUserIdFromMemory
      || currentUserIdFromStorage
      || currentUserFromStorage?.id
      || currentUserFromStorage?.userId
      || currentUserFromStorage?._id
      || currentUserFromStorage?.username
      || currentUserFromStorage?.userName
      || currentUserFromStorage?.email
      || currentUsernameFromStorage

    if (resolvedUserId) return `assessment_deleted_records_user_${resolvedUserId}`
    return `assessment_deleted_records_${getToken() || 'anonymous'}`
  }

  function loadDeletedRecordIdsSet() {
    const key = getDeletedRecordsKey()
    const data = getItem(key)
    const ids = Array.isArray(data) ? data : []
    return new Set(ids.filter(Boolean))
  }

  function saveDeletedRecordIdsSet(idSet) {
    const key = getDeletedRecordsKey()
    setItem(key, Array.from(idSet))
  }

  function loadLocalRecords() {
    const data = getItem(getLocalRecordsKey())
    return Array.isArray(data) ? data : []
  }

  function saveLocalRecords(localRecords) {
    setItem(getLocalRecordsKey(), localRecords)
  }

  function mergeRecords(serverRecords, localRecords) {
    const mergedMap = new Map()
    for (const record of [...serverRecords, ...localRecords]) {
      if (!record || !record.id) continue
      // 保留优先级：先遇到的记录（通常是后端）优先
      if (!mergedMap.has(record.id)) mergedMap.set(record.id, record)
    }
    const merged = Array.from(mergedMap.values())
    merged.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    return merged
  }

  /**
   * 从后端加载历史测评记录
   */
  async function loadHistory() {
    loading.value = true
    try {
      const deletedRecordIdSet = loadDeletedRecordIdsSet()
      const localRecords = loadLocalRecords()
      // 先展示本地兜底，避免刷新后瞬间空白（同时过滤已删除墓碑）
      records.value = localRecords.filter(r => !deletedRecordIdSet.has(r.id))

      const res = await fetchAssessmentHistory()
      const serverRecords = res?.data || []
      const merged = mergeRecords(serverRecords, localRecords)
      records.value = merged.filter(r => !deletedRecordIdSet.has(r.id))
    } catch (error) {
      console.warn('加载测评历史失败，可能后端未就绪:', error.message)
      // 后端失败时使用本地兜底，保证刷新后不丢失
      const deletedRecordIdSet = loadDeletedRecordIdsSet()
      records.value = loadLocalRecords().filter(r => !deletedRecordIdSet.has(r.id))
    } finally {
      loading.value = false
    }
  }

  /**
   * 提交测评结果
   * @param {{ scaleId: string, answers: number[], rawScore: number, standardScore: number|null, level: string, severity: string }} data
   */
  async function submitResult(data) {
    try {
      const res = await submitAssessment(data)
      // 提交成功后将新记录追加到列表头部
      if (res.data) {
        records.value.unshift(res.data)
      }
      return res
    } catch (error) {
      console.warn('提交测评结果失败，可能后端未就绪:', error.message)
      // 后端未就绪时，构造本地记录保证前端流程正常
      const localRecord = {
        id: `local_${Date.now()}`,
        ...data,
        createdAt: new Date().toISOString()
      }
      records.value.unshift(localRecord)
      // 落盘本地记录，避免刷新丢失
      const localRecords = loadLocalRecords()
      const mergedLocalRecords = mergeRecords([], [...localRecords, localRecord])
      saveLocalRecords(mergedLocalRecords)
      return { code: 0, data: localRecord }
    }
  }

  /**
   * 删除单条测评记录（后端优先，后端失败则保底仅删除本地展示）
   * @param {string} id
   */
  async function deleteHistoryRecord(id) {
    if (!id) return

    // 先乐观更新 UI，提升体验
    records.value = records.value.filter(r => r.id !== id)

    // 记录墓碑：保证刷新后不再展示
    try {
      const deletedRecordIdSet = loadDeletedRecordIdsSet()
      deletedRecordIdSet.add(id)
      saveDeletedRecordIdsSet(deletedRecordIdSet)
    } catch {
      // 墓碑写入失败不影响删除体验
    }

    // 更新本地兜底缓存（只影响本地数据，不影响后端返回的数据）
    try {
      const localRecords = loadLocalRecords()
      const filteredLocalRecords = localRecords.filter(r => r.id !== id)
      saveLocalRecords(filteredLocalRecords)
    } catch {
      // 本地缓存失败不影响删除流程
    }

    // 后端删除：若接口不存在/失败，前端仍保留已更新的 UI 状态
    try {
      await deleteAssessment(id)
    } catch {
      // 忽略错误：后续刷新可能由后端再拉取出该记录
    }
  }

  return {
    records,
    loading,
    loadHistory,
    submitResult,
    deleteHistoryRecord
  }
})
