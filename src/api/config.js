import { getToken } from '../utils/storage'

const BASE_URL = 'http://localhost:3000'

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

  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers
  })

  const data = await response.json()

  if (!response.ok) {
    const error = new Error(data.message || '请求失败')
    error.code = data.code || response.status
    error.data = data
    throw error
  }

  return data
}

export { BASE_URL }
