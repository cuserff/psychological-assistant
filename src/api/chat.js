import { BASE_URL } from './config'
import { getToken } from '../utils/storage'

/**
 * 发送对话请求，返回原始 Response（用于 SSE 流式读取）
 *
 * @param {Array<{role: string, content: string}>} messages 完整的多轮对话消息列表
 * @returns {Promise<Response>}
 */
export function sendChatRequest(messages) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages })
  })
}

/**
 * 解析单行 SSE data，提取 delta content
 * @param {string} line 原始 SSE 行
 * @returns {string|null} 增量文本，null 表示流结束或无效行
 */
export function parseSSELine(line) {
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6).trim()
  if (data === '[DONE]') return null

  try {
    const json = JSON.parse(data)
    if (json.error) throw new Error(json.error)
    return json.choices?.[0]?.delta?.content || null
  } catch {
    return null
  }
}
