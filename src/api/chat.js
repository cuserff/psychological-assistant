import { BASE_URL, request } from './config'
import { getToken } from '../utils/storage'

/**
 * 发送对话请求，返回原始 Response（用于 SSE 流式读取）
 *
 * @param {Array<{role: string, content: string}>} messages 完整的多轮对话消息列表
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.max_tokens] 传给上游的最大生成 token（由后端裁剪合法范围）
 * @param {number} [options.temperature]
 * @returns {Promise<Response>}
 */
export function sendChatRequest(messages, { signal, max_tokens, temperature } = {}) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream'
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const payload = { messages }
  if (max_tokens !== undefined && max_tokens !== null) {
    payload.max_tokens = max_tokens
  }
  if (temperature !== undefined && temperature !== null) {
    payload.temperature = temperature
  }

  return fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal
  })
}

/**
 * 从类 OpenAI 流式/非流式 JSON 对象中提取应展示给用户的文本增量（或整段）
 * @param {Record<string, unknown>} json
 * @returns {string|null}
 */
function extractTextFromOpenAiStyleChunk(json) {
  if (!json || typeof json !== 'object') return null
  if (json.error) {
    const err = json.error
    const message =
      typeof err === 'string'
        ? err
        : (err?.message || err?.msg || JSON.stringify(err))
    const businessError = new Error(message)
    businessError.isUpstreamSseError = true
    throw businessError
  }

  const choiceList = Array.isArray(json.choices)
    ? json.choices
    : Array.isArray(json.data?.choices)
      ? json.data.choices
      : null
  const choice = choiceList?.[0]
  if (!choice || typeof choice !== 'object') return null

  const delta = choice.delta
  let piece = ''
  if (delta !== undefined && delta !== null && typeof delta === 'object') {
    const rawContent = delta.content
    if (typeof rawContent === 'string') {
      piece = rawContent
    } else if (Array.isArray(rawContent)) {
      piece = rawContent
        .map((part) => {
          if (!part || typeof part !== 'object') return ''
          if (typeof part.text === 'string') return part.text
          return ''
        })
        .join('')
    }
    if (!piece && typeof delta.text === 'string') piece = delta.text
  }
  if (!piece && typeof choice.text === 'string') piece = choice.text
  if (
    !piece
    && choice.message
    && typeof choice.message === 'object'
    && typeof choice.message.content === 'string'
  ) {
    piece = choice.message.content
  }

  return piece.length > 0 ? piece : null
}

/**
 * 解析 SSE 中单个 data 事件负载（可为多行 data: 拼接后的字符串）或裸 JSON 行
 * @param {string} payload
 * @returns {string|null}
 */
export function parseStreamDataPayload(payload) {
  const trimmed = String(payload || '').trim()
  if (!trimmed || trimmed === '[DONE]') return null
  try {
    const json = JSON.parse(trimmed)
    return extractTextFromOpenAiStyleChunk(json)
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

/**
 * 解析单行：SSE data: 行、或 NDJSON（整行 JSON），忽略 event:/id:/注释
 * @param {string} line 原始行
 * @returns {string|null} 增量文本；null 表示本行无有效增量
 */
export function parseSSELine(line) {
  const trimmed = line.replace(/\r$/, '').trim()
  if (!trimmed || trimmed.startsWith(':')) return null
  if (
    trimmed.startsWith('event:')
    || trimmed.startsWith('id:')
    || trimmed.startsWith('retry:')
  ) {
    return null
  }
  if (trimmed.startsWith('data:')) {
    const payload = trimmed.slice(5).replace(/^\s*/, '')
    return parseStreamDataPayload(payload)
  }
  if (trimmed.startsWith('{')) {
    return parseStreamDataPayload(trimmed)
  }
  return null
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
