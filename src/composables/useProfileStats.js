import { ref, onMounted } from 'vue'
import { useCheckinStore } from '../store/checkinStore'

/**
 * 个人中心数据加载组合式函数
 *
 * 编排统计数据和打卡记录的并行加载，
 * 提供统一的 loading 状态供视图层使用。
 *
 * 为什么独立成 composable：
 * 遵循项目中 useChat.js 的模式 —— composable 编排流程，
 * Store 管理状态，API 层负责通信。Profile 页面只需调用
 * useProfileStats() 即可获得全部数据和加载状态。
 */
export function useProfileStats() {
  const checkinStore = useCheckinStore()
  const pageLoading = ref(true)

  /**
   * 初始化加载：并行请求统计数据 + 打卡记录
   */
  async function initData() {
    pageLoading.value = true
    try {
      await Promise.all([
        checkinStore.loadStats(),
        checkinStore.loadRecords()
      ])
    } catch (error) {
      console.error('加载个人中心数据失败:', error)
    } finally {
      pageLoading.value = false
    }
  }

  /**
   * 打卡成功后刷新统计数据和打卡记录
   */
  async function refreshAfterCheckin() {
    await Promise.all([
      checkinStore.loadStats(),
      checkinStore.loadRecords()
    ])
  }

  onMounted(initData)

  return {
    pageLoading,
    refreshAfterCheckin
  }
}
