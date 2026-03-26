import { BASE_URL, request } from './config'
import { getToken } from '../utils/storage'

/**
 * 发送对话请求，返回原始 Response（用于 SSE 流式读取）
 *
 * @param {Array<{role: string, content: string}>} messages 完整的多轮对话消息列表
 * @returns {Promise<Response>}
 */
export function sendChatRequest(messages, { signal } = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages }),
    signal
  })
}

/**
 * 解析单行 SSE data，提取 delta content
 * @param {string} line 原始 SSE 行
 * @returns {string|null} 增量文本，null 表示流结束或无效行
 */
export function parseSSELine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(':')) return null
  if (!trimmed.startsWith('data:')) return null
  // 兼容 data: 与 data:<无空格>
  const payload = trimmed.slice(5).replace(/^\s*/, '')
  if (payload === '[DONE]') return null

  try {
    const json = JSON.parse(payload)
    if (json.error) {
      const err = json.error
      const message =
        typeof err === 'string'
          ? err
          : (err.message || err.msg || JSON.stringify(err))
      const businessError = new Error(message)
      businessError.isUpstreamSseError = true
      throw businessError
    }
    const choice = json.choices?.[0]
    const delta = choice?.delta
    const piece =
      (typeof delta?.content === 'string' ? delta.content : '')
      || (typeof delta?.text === 'string' ? delta.text : '')
      || (typeof choice?.text === 'string' ? choice.text : '')
    return piece || null
  } catch (parseOrBusinessError) {
    if (
      parseOrBusinessError instanceof Error
      && parseOrBusinessError.isUpstreamSseError
    ) {
      throw parseOrBusinessError
    }
    return null
  }
}

// ==================== 聊天会话持久化 API ====================

/** 从后端获取当前用户的所有会话 */
export function fetchSessions() {
  return request('/api/chat/sessions')
}

/** 全量保存当前用户的所有会话到后端 */
export function saveSessionsToServer(sessions) {
  return request('/api/chat/sessions', {
    method: 'PUT',
    body: JSON.stringify({ sessions })
  })
}

/** 删除后端指定会话 */
export function deleteSessionFromServer(sessionId) {
  return request(`/api/chat/sessions/${sessionId}`, {
    method: 'DELETE'
  })
}

/**
 * 上传聊天配图（multipart，字段名 files）
 * @param {Array<{ blob: Blob, name?: string }>} items
 * @returns {Promise<{ url: string, originalName?: string, mime?: string, size?: number }[]>}
 */
export async function uploadChatImages(items) {
  const token = getToken()
  const formData = new FormData()
  for (const item of items) {
    if (!item?.blob) continue
    const fileName = item.name || `image-${Date.now()}.jpg`
    formData.append('files', item.blob, fileName)
  }

  const headers = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let response
  try {
    response = await fetch(`${BASE_URL}/api/chat/upload`, {
      method: 'POST',
      headers,
      body: formData
    })
  } catch (networkError) {
    throw new Error(networkError?.message || '网络异常，上传失败')
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new Error('服务器返回非 JSON')
  }

  if (!response.ok) {
    throw new Error(body?.message || `上传失败 (${response.status})`)
  }

  const files = body?.data?.files
  return Array.isArray(files) ? files : []
}
