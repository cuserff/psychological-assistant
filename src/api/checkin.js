import { request } from './config'

/**
 * 获取当前用户的所有打卡记录
 * @returns {Promise<{code: number, data: Array<{date: string, mood: number, note: string, createdAt: string}>}>}
 */
export function fetchCheckinRecords() {
  return request('/api/checkin/records')
}

/**
 * 提交或更新打卡
 * @param {{ date: string, mood: number, note?: string }} data 打卡数据
 */
export function submitCheckin(data) {
  return request('/api/checkin', {
    method: 'POST',
    body: JSON.stringify(data)
  })
}

/**
 * 获取个人中心统计数据（聊天统计 + 打卡统计）
 * @returns {Promise<{code: number, data: {chatDays: number, sessionCount: number, messageCount: number, checkinDays: number, streakDays: number, avgMood7d: number|null}}>}
 */
export function fetchUserStats() {
  return request('/api/user/stats')
}
