/**
 * 日期工具（打卡等场景需统一使用「本地日历日」，避免与 UTC 混用导致午夜前后判断不一致）
 */

/**
 * 将 Date 按本地时区格式化为 YYYY-MM-DD
 * @param {Date|number|string} [input=new Date()]
 * @returns {string}
 */
export function formatLocalDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 本地「今天」的 YYYY-MM-DD（与 MoodCheckin 提交 date 一致） */
export function getTodayLocalDate() {
  return formatLocalDate(new Date())
}

/**
 * 打卡记录在匹配「今天」时可能出现的 date 取值（本地 + 兼容历史误用 UTC 的日期串）
 * @returns {string[]}
 */
export function getCheckinTodayDateCandidates() {
  const localToday = getTodayLocalDate()
  const utcToday = new Date().toISOString().slice(0, 10)
  return localToday === utcToday ? [localToday] : [localToday, utcToday]
}
