/**
 * 由聊天消息列表生成保存日记用的纯文本（图片用 [图片] 占位）
 * @param {Array<{ role?: string, content?: string, images?: string[] }>} messages
 * @returns {string}
 */
export function buildDiaryPlainTextFromMessages(messages) {
  if (!Array.isArray(messages)) return ''
  const blocks = []
  for (const msg of messages) {
    if (!msg || msg.role === 'system') continue
    if (msg.role === 'user') {
      const text = (msg.content || '').trim()
      const images = Array.isArray(msg.images)
        ? msg.images.filter((item) => typeof item === 'string' && item.length > 0)
        : []
      const parts = []
      if (text) parts.push(`我：${text}`)
      if (images.length > 0) parts.push('[图片]')
      if (parts.length > 0) blocks.push(parts.join('\n'))
    } else if (msg.role === 'assistant') {
      const text = (msg.content || '').trim()
      if (text) blocks.push(`小愈：${text}`)
    }
  }
  return blocks.join('\n\n')
}

/**
 * 默认日记标题：YYYY-MM-DD 对话日记（本地日历）
 */
export function getDefaultDiaryTitle() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day} 对话日记`
}

/**
 * 将 LLM 摘要与对话纯文本合并为日记正文（含短节选，避免全量几千字）
 * @param {{
 *   moodKeywords?: string[],
 *   coreEvents?: string,
 *   aiEncouragement?: string,
 *   moodCurve?: { points?: { label: string, score: number }[] }
 * }} summary
 * @param {string} plainTranscript 由 buildDiaryPlainTextFromMessages 生成
 * @param {number} [excerptMax]
 * @returns {string}
 */
export function formatDiaryContentFromSummary(summary, plainTranscript, excerptMax = 800) {
  const lines = []
  if (Array.isArray(summary?.moodKeywords) && summary.moodKeywords.length > 0) {
    lines.push(`【今日心情关键词】${summary.moodKeywords.join('、')}`)
  }
  if (summary?.coreEvents) {
    lines.push(`【核心事件】\n${String(summary.coreEvents).trim()}`)
  }
  if (summary?.aiEncouragement) {
    lines.push(`【小愈的寄语】\n${String(summary.aiEncouragement).trim()}`)
  }
  const raw = String(plainTranscript || '').trim()
  const excerpt =
    raw.length > excerptMax ? `${raw.slice(0, excerptMax)}\n……（节选）` : raw
  if (excerpt) {
    lines.push(`【对话节选】\n${excerpt}`)
  }
  return lines.filter(Boolean).join('\n\n')
}
