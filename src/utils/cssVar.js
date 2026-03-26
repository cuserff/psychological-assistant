/**
 * 读取当前 document 上已生效的 CSS 变量（供 ECharts 等无法写 var() 的 JS 使用）
 * @param {string} name 如 '--app-chart-donut-track'
 * @param {string} [fallback]
 * @returns {string}
 */
export function readCssVar(name, fallback = '') {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

