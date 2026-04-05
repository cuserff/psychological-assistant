/**
 * 语音通话：短回复约束文案 + 流式结束后的后处理兜底（与 useChat / VoiceCall 共用）。
 * 图片仍为对话页同源上传接口（按用户隔离）；本模块不涉及音频落盘。
 */

/** 拼入 system 提示的「语音模式」段落（主约束） */
export const VOICE_CALL_SYSTEM_APPEND = `## 语音通话模式（必须严格遵守）

- 每次回复只输出 **1～2 句中文**；优先 **总共不超过约 50 字**（硬上限尽量不超过 70 字）。
- 单句尽量 **不超过 24 字**，便于语音播报。
- **优先带 1 个温和的开放式问题**，引导用户继续说；不要超过 2 句话。
- 涉及高风险、自伤或紧急安全时：仍遵守安全规范，回复 **同样保持极短**，先共情与转介，勿展开长篇。
- 禁止使用多段列表、「首先/其次」结构或长篇论述。`

/** 后处理兜底：若无问句则追加固定引导（短模板） */
export const VOICE_CALL_FOLLOWUP_FALLBACK = '你现在最想先说哪一点？'

/**
 * 按 。！？及换行切句（保留标点在各段末尾）
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentencesForBrief(text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  const sentences = []
  let buffer = ''
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index]
    buffer += character
    if (/[。！？\n]/.test(character)) {
      const piece = buffer.trim()
      if (piece) sentences.push(piece)
      buffer = ''
    }
  }
  const tail = buffer.trim()
  if (tail) sentences.push(tail)
  return sentences
}

/**
 * 后处理：最多保留前 2 句；过长截断；若无问句则补一句引导
 * @param {string} raw
 * @returns {string}
 */
export function postProcessVoiceAssistantBrief(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return trimmed

  const sentences = splitSentencesForBrief(trimmed)
  let merged =
    sentences.length <= 2
      ? sentences.join('')
      : sentences.slice(0, 2).join('')

  merged = merged.trim()
  if (!merged) merged = trimmed.slice(0, 70)

  const maxChars = 72
  if (merged.length > maxChars) {
    merged = `${merged.slice(0, maxChars - 1).replace(/[。！？，、\s]+$/, '')}…`
  }

  if (!/(\?|？)/.test(merged)) {
    const withFallback = `${merged}${merged.endsWith('。') ? '' : '。'}${VOICE_CALL_FOLLOWUP_FALLBACK}`
    return withFallback.length > 140 ? withFallback.slice(0, 140) : withFallback
  }

  return merged.length > 140 ? merged.slice(0, 140) : merged
}

/**
 * TTS 只入队至多两段（前 1～2 句），避免长篇排队
 * @param {string} text
 * @returns {string[]}
 */
export function splitForVoiceTtsChunks(text) {
  const sentences = splitSentencesForBrief(String(text || '').trim())
  if (sentences.length === 0) return []
  if (sentences.length === 1) return [sentences[0]]
  return [sentences[0], sentences[1]]
}
