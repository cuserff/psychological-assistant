import { getToken } from '../utils/storage'

/**
 * API 根地址：优先 Vite 环境变量，便于上线切换；未配置时默认本地后端
 */
const RAW_BASE =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE
    ? String(import.meta.env.VITE_API_BASE)
    : 'http://localhost:3000'

const BASE_URL = RAW_BASE.replace(/\/$/, '')

/**
 * 解析 fetch 响应体：兼容空体、非 JSON、HTML 错误页等，避免 response.json() 直接抛错导致崩溃
 * @param {Response} response
 * @returns {Promise<{ okJson: boolean, data: any, raw: string }>}
 */
async function parseResponseBody(response) {
  let raw = ''
  try {
    raw = await response.text()
  } catch {
    return { okJson: false, data: null, raw: '' }
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return { okJson: true, data: null, raw: '' }
  }

  try {
    return { okJson: true, data: JSON.parse(trimmed), raw: trimmed }
  } catch {
    return { okJson: false, data: null, raw: trimmed }
  }
}

function buildHttpErrorMessage(response, parsed) {
  if (parsed.okJson && parsed.data && typeof parsed.data === 'object' && parsed.data.message) {
    return String(parsed.data.message)
  }
  if (parsed.raw) {
    const snippet = parsed.raw.length > 200 ? `${parsed.raw.slice(0, 200)}…` : parsed.raw
    return `服务器返回非 JSON 或异常内容 (HTTP ${response.status})：${snippet}`
  }
  return `请求失败 (HTTP ${response.status})`
}

/**
 * 统一请求封装，自动注入 Authorization 头
 */
export async function request(url, options = {}) {
  const token = getToken()

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let response
  try {
    response = await fetch(`${BASE_URL}${url}`, {
      ...options,
      headers
    })
  } catch (networkError) {
    const err = new Error(networkError?.message || '网络异常，请检查网络或服务是否可用')
    err.code = 0
    err.cause = networkError
    throw err
  }

  let parsed
  try {
    parsed = await parseResponseBody(response)
  } catch {
    const err = new Error('无法解析响应内容')
    err.code = response.status
    throw err
  }

  if (!response.ok) {
    const msg = buildHttpErrorMessage(response, parsed)
    const err = new Error(msg)
    err.code =
      parsed.okJson && parsed.data && typeof parsed.data === 'object' && parsed.data.code != null
        ? parsed.data.code
        : response.status
    err.data = parsed.data
    err.raw = parsed.raw
    throw err
  }

  // 成功但非 JSON：降级为统一结构，避免调用方拿不到字段时报错
  if (!parsed.okJson) {
    return {
      code: response.status,
      message: '服务端返回了非 JSON 内容',
      data: null,
      _raw: parsed.raw
    }
  }

  if (parsed.data === null || parsed.data === undefined) {
    return { code: 200, message: 'ok', data: null }
  }

  return parsed.data
}

/**
 * 将后端返回的相对路径拼成可访问的绝对地址（用于上传文件、Markdown 图片等）
 * @param {string} relativePath 如 /uploads/chat/xxx/uuid.jpg
 */
export function resolveUploadUrl(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') return ''
  if (/^https?:\/\//i.test(relativePath)) return relativePath
  const normalized = relativePath.startsWith('/') ? relativePath : `/${relativePath}`
  return `${BASE_URL}${normalized}`
}

export { BASE_URL }
