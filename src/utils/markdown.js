// Markdown 解析配置：marked + highlight.js + DOMPurify
import { marked } from 'marked'
import hljs from 'highlight.js/lib/core'
import DOMPurify from 'dompurify'

// 按需注册常用语言（减小打包体积）
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('java', java)

// 配置 marked 解析器
marked.setOptions({
  // 代码高亮
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    // 未指定语言时自动检测
    return hljs.highlightAuto(code).value
  },
  // 允许换行符转为 <br>
  breaks: true,
  // 关闭严格模式，兼容更多 Markdown 写法
  gfm: true
})

/**
 * 将 Markdown 文本渲染为安全的 HTML
 * @param {string} rawText - 原始 Markdown 文本
 * @returns {string} 经过 DOMPurify 过滤的 HTML 字符串
 */
export function renderMarkdown(rawText) {
  if (!rawText) return ''

  // marked 解析为 HTML
  const html = marked.parse(rawText)

  // DOMPurify 过滤 XSS，保留代码高亮所需的 class 属性
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['code', 'pre', 'span'],
    ADD_ATTR: ['class']
  })
}
