import { request } from './config'

export function loginApi(data) {
  return request('/api/user/login', {
    method: 'POST',
    body: JSON.stringify(data)
  })
}

export function registerApi(data) {
  return request('/api/user/register', {
    method: 'POST',
    body: JSON.stringify(data)
  })
}

export function getUserInfoApi() {
  return request('/api/user/info')
}

export function updateUserInfoApi(data) {
  return request('/api/user/info', {
    method: 'PUT',
    body: JSON.stringify(data)
  })
}

export function updatePasswordApi(data) {
  return request('/api/user/password', {
    method: 'PUT',
    body: JSON.stringify(data)
  })
}

// ==================== 管理员接口 ====================

export function getAdminUsersApi() {
  return request('/api/admin/users')
}

export function updateMentalStatusApi(userId, data) {
  return request(`/api/admin/users/${userId}/mental-status`, {
    method: 'PUT',
    body: JSON.stringify(data)
  })
}

export function deleteAdminUserApi(userId) {
  return request(`/api/admin/users/${userId}`, {
    method: 'DELETE'
  })
}

/** 管理员重置用户密码：响应内 data.temporaryPassword 仅出现一次，不落库 */
export function resetAdminUserPasswordApi(userId) {
  return request(`/api/admin/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({})
  })
}
