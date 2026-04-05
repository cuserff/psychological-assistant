import { TTS_MIN_SEGMENT_CHARS } from '../composables/useTtsPlayer'

/**
 * 按句末标点与换行切分可读文本；过短片段合并后再播（与 Chat / 语音通话共用）
 * @param {string} bufferText
 * @returns {{ segments: string[], rest: string }}
 */
export function splitSpeakableSegments(bufferText) {
  const text = String(bufferText || '')
  const segments = []
  let startIndex = 0
  let carryShort = ''
  for (let index = 0; index < text.length; index++) {
    const ch = text[index]
    const isSentenceEnd =
      ch === '。' || ch === '！' || ch === '？' || ch === '；' || ch === '\n'
    if (!isSentenceEnd) continue
    const piece = text.slice(startIndex, index + 1).trim()
    startIndex = index + 1
    if (!piece) continue
    const merged = carryShort + piece
    if (merged.length >= TTS_MIN_SEGMENT_CHARS) {
      segments.push(merged)
      carryShort = ''
    } else {
      carryShort = merged
    }
  }
  const rest = carryShort + text.slice(startIndex)
  return { segments, rest }
}
