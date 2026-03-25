# Markdown 渲染功能 —— 面试要点

## 一、为什么要做这个功能？

项目是一个基于大语言模型的智能心理助手系统，AI 的回复天然包含 Markdown 格式（标题、列表、代码块、加粗等）。
但前端最初用 `{{ message.content }}` 纯文本插值渲染，所有格式化内容都显示为原始符号，用户体验很差。
我负责实现 Markdown 实时渲染，同时要兼容 SSE 流式输出的逐字显示效果。

## 二、技术选型

| 库 | 作用 | 选择理由 |
|---|---|---|
| marked | Markdown → HTML | 轻量（~40KB），解析速度快，支持 GFM 语法，适合流式场景频繁调用 |
| highlight.js | 代码语法高亮 | 支持按需加载语言包，减小打包体积 |
| DOMPurify | XSS 防护 | 因为使用了 v-html 渲染 HTML，必须做安全过滤防止 XSS 注入 |

## 三、核心实现思路

### 1. 封装 renderMarkdown 工具函数

```javascript
import { marked } from 'marked'
import hljs from 'highlight.js/lib/core'
import DOMPurify from 'dompurify'

// 按需注册语言（JS、Python、CSS 等），避免全量引入
hljs.registerLanguage('javascript', javascript)

// 配置 marked：集成 highlight.js 做代码高亮
marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code).value
  },
  breaks: true,
  gfm: true
})

// 导出渲染函数：Markdown → HTML → DOMPurify 过滤
export function renderMarkdown(rawText) {
  if (!rawText) return ''
  const html = marked.parse(rawText)
  return DOMPurify.sanitize(html)
}
```

### 2. 区分 AI 消息和用户消息的渲染方式

```html
<!-- AI 消息：v-html 渲染 Markdown -->
<div v-if="message.role === 'assistant'"
     class="markdown-body"
     v-html="renderMarkdown(message.content)" />

<!-- 用户消息：纯文本插值，不做 HTML 渲染 -->
<div v-else>{{ message.content }}</div>
```

**为什么用户消息不渲染 Markdown？**
- 用户输入的内容不需要格式化展示
- 避免用户输入的 HTML 标签被渲染，减少安全风险

### 3. 流式输出兼容（零改动）

SSE 流式响应的处理链路：
```
后端 SSE 推送 delta → 前端 appendAssistantDelta() → message.content += delta → Vue 响应式更新
```

`message.content` 是 Pinia store 中的响应式数据，每次 delta 追加后，模板中的 `renderMarkdown(message.content)` 会自动重新计算，实现 Markdown 逐步渲染，**不需要修改任何 SSE 或 store 逻辑**。

### 4. 样式隔离策略

- Markdown 内容样式用**非 scoped 的 `<style>`** 标签引入，因为 `v-html` 生成的 DOM 不会带 scoped 的 data 属性，scoped 样式无法命中
- 通过 `.markdown-body` 类名做作用域限定，避免全局样式污染

## 四、安全考量

使用 `v-html` 存在 XSS 风险，所以每次渲染都经过 DOMPurify 过滤：
- 移除 `<script>`、`onerror`、`onclick` 等危险内容
- 白名单保留 `<code>`、`<pre>`、`<span>` 及 `class` 属性（代码高亮需要）
- 用户消息完全不走 v-html，从根本上杜绝用户侧注入

## 五、性能优化点

1. **highlight.js 按需加载**：只注册项目常用的 10 种语言，而非全量 190+ 语言包，减小约 1MB 打包体积
2. **marked 本身性能优秀**：解析速度远快于 markdown-it 等替代方案，适合流式场景的高频调用
3. **如果后续遇到性能瓶颈**：可以用 `computed` 缓存渲染结果，或对流式输入做 `requestAnimationFrame` 节流

## 六、面试话术示例

> "在心理助手项目中，AI 回复是流式输出的 Markdown 文本。我用 marked 做解析，highlight.js 按需加载做代码高亮，DOMPurify 防 XSS。核心设计是只对 AI 消息做 v-html 渲染，用户消息保持纯文本插值。流式兼容不需要额外处理，因为 Vue 的响应式系统会在每次 content 变化时自动重新调用 renderMarkdown。样式上用非 scoped 的 style 标签配合 .markdown-body 类名限定作用域，解决了 v-html 内容无法命中 scoped 样式的问题。"
