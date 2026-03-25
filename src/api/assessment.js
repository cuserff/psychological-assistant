import { request } from './config'

/**
 * 提交测评结果
 * @param {{ scaleId: string, answers: number[], rawScore: number, standardScore: number|null, level: string, severity: string }} data
 */
export function submitAssessment(data) {
  return request('/api/assessment', {
    method: 'POST',
    body: JSON.stringify(data)
  })
}

/**
 * 获取当前用户的历史测评记录（按时间倒序）
 * @returns {Promise<{code: number, data: Array}>}
 */
export function fetchAssessmentHistory() {
  return request('/api/assessment/history')
}

/**
 * 获取单条测评详情
 * @param {string} id 测评记录 ID
 */
export function fetchAssessmentDetail(id) {
  return request(`/api/assessment/${id}`)
}

/**
 * 删除单条测评记录
 * @param {string} id 测评记录 ID
 */
export function deleteAssessment(id) {
  return request(`/api/assessment/${id}`, {
    method: 'DELETE'
  })
}
