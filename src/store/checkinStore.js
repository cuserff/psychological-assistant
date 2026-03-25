import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchCheckinRecords, submitCheckin, fetchUserStats } from '../api/checkin'
import { useUserStore } from './userStore'
import { getItem, setItem } from '../utils/storage'

export const useCheckinStore = defineStore('checkin', () => {
  /** @type {import('vue').Ref<Array<{date: string, mood: number, note: string, createdAt: string}>>} */
  const records = ref([])

  /** @type {import('vue').Ref<{chatDays: number, sessionCount: number, messageCount: number, checkinDays: number, streakDays: number, avgMood7d: number|null}|null>} */
  const stats = ref(null)

  const loading = ref(false)

  /**
   * 获取用于本地兜底的用户隔离 key 后缀
   * - 优先使用已登录用户信息
   * - 再回退到 localStorage 中保存的 current_user_id/current_user
   * - 最后才使用 anonymous
   */
  function resolveUserSuffix() {
    const userStore = useUserStore()
    const memoryUserId = userStore.userInfo?.id
    const storedUserId = getItem('current_user_id')
    const storedUser = getItem('current_user')

    const resolved =
      memoryUserId
      || storedUserId
      || storedUser?.id
      || storedUser?.userId
      || storedUser?._id
      || storedUser?.username
      || storedUser?.userName
      || storedUser?.email

    return resolved ? String(resolved) : 'anonymous'
  }

  function getLocalRecordsKey() {
    return `checkin_local_records_${resolveUserSuffix()}`
  }

  function getLocalStatsKey() {
    return `checkin_local_stats_${resolveUserSuffix()}`
  }

  function loadLocalRecords() {
    const data = getItem(getLocalRecordsKey())
    return Array.isArray(data) ? data : []
  }

  function saveLocalRecords(localRecords) {
    setItem(getLocalRecordsKey(), localRecords)
  }

  function loadLocalStats() {
    const data = getItem(getLocalStatsKey())
    return data && typeof data === 'object' ? data : null
  }

  function saveLocalStats(localStats) {
    setItem(getLocalStatsKey(), localStats)
  }

  /**
   * 从后端加载全部打卡记录
   */
  async function loadRecords() {
    // 先展示本地兜底，避免后端不可用时刷新后瞬间空白
    records.value = loadLocalRecords()

    try {
      const res = await fetchCheckinRecords()
      const serverRecords = res.data || []
      records.value = serverRecords
      // 同步写入本地缓存，供离线/失败兜底
      saveLocalRecords(serverRecords)
    } catch {
      // 后端失败时保留本地兜底，不向上抛出
      records.value = loadLocalRecords()
    }
  }

  /**
   * 提交打卡（新增或更新同一天的记录）
   * @param {{ date: string, mood: number, note?: string }} data
   */
  async function checkin(data) {
    try {
      const res = await submitCheckin(data)
      // 提交成功后，更新本地记录
      const index = records.value.findIndex(r => r.date === data.date)
      if (index !== -1) {
        records.value[index] = res.data
      } else {
        records.value.unshift(res.data)
      }
      saveLocalRecords(records.value)
      return res
    } catch {
      // 后端不可用：写入本地兜底记录，保证刷新后仍可见且不串用户
      const localRecord = {
        date: data.date,
        mood: data.mood,
        note: data.note || '',
        createdAt: new Date().toISOString()
      }

      const index = records.value.findIndex(r => r.date === data.date)
      if (index !== -1) {
        records.value[index] = localRecord
      } else {
        records.value.unshift(localRecord)
      }

      saveLocalRecords(records.value)
      return { code: 0, data: localRecord, offline: true }
    }
  }

  /**
   * 从后端加载统计数据
   */
  async function loadStats() {
    // 先展示本地兜底 stats（如果有），避免页面一直空
    stats.value = loadLocalStats()

    try {
      const res = await fetchUserStats()
      const serverStats = res.data || null
      stats.value = serverStats
      saveLocalStats(serverStats)
    } catch {
      stats.value = loadLocalStats()
    }
  }

  /**
   * 检查今天是否已打卡
   */
  function isTodayCheckedIn() {
    const today = new Date().toISOString().slice(0, 10)
    return records.value.some(r => r.date === today)
  }

  /**
   * 获取今天的打卡记录（如果有的话）
   */
  function getTodayRecord() {
    const today = new Date().toISOString().slice(0, 10)
    return records.value.find(r => r.date === today) || null
  }

  return {
    records,
    stats,
    loading,
    loadRecords,
    checkin,
    loadStats,
    isTodayCheckedIn,
    getTodayRecord
  }
})
