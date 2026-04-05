import { request } from './config'

/**
 * @param {Object} [params]
 * @param {string} [params.keyword]
 * @param {number} [params.page]
 * @param {number} [params.pageSize]
 * @returns {Promise<{ total: number, list: Array }>}
 */
export function fetchDiaryEntries(params = {}) {
  const query = new URLSearchParams()
  if (params.keyword) query.set('keyword', String(params.keyword).trim())
  if (params.page != null) query.set('page', String(params.page))
  if (params.pageSize != null) query.set('pageSize', String(params.pageSize))
  const suffix = query.toString() ? `?${query}` : ''
  return request(`/api/diary/entries${suffix}`).then((body) => body.data)
}

/**
 * @param {{ transcript: string }} payload
 * @returns {Promise<{
 *   moodKeywords: string[],
 *   coreEvents: string,
 *   aiEncouragement: string,
 *   moodCurve: { points: { label: string, score: number }[] }
 * }>}
 */
export function summarizeDiaryTranscript(payload) {
  return request('/api/diary/summarize', {
    method: 'POST',
    body: JSON.stringify({
      transcript: String(payload.transcript || '').trim()
    })
  }).then((body) => body.data)
}

/**
 * @param {{
 *   title?: string,
 *   content: string,
 *   source?: 'chat'|'voice',
 *   moodKeywords?: string[],
 *   coreEvents?: string,
 *   aiEncouragement?: string,
 *   moodCurve?: { points: { label: string, score: number }[] }
 * }} payload
 */
export function createDiaryEntry(payload) {
  return request('/api/diary/entries', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).then((body) => body.data)
}

export function getDiaryEntryDetail(id) {
  return request(`/api/diary/entries/${encodeURIComponent(id)}`).then(
    (body) => body.data
  )
}

export function deleteDiaryEntry(id) {
  return request(`/api/diary/entries/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}
