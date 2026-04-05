/**
 * LLM 流式回复在界面上的「打字」节奏（与语音播报对齐时可调慢）。
 *
 * 环境变量（Vite，需 `VITE_` 前缀）：
 * - **VITE_STREAM_REVEAL_MODE**（可选）
 *   - `normal`：默认，约每 36ms 显示 2 字（与现网接近）
 *   - `slow` | `voice` | `tts` | `sync`：偏慢，约每 56ms 1 字，更接近 TTS
 *   - `fast`：约每 24ms 3 字
 *   - `off` | `none`：关闭节流，与 SSE 同速（字会一下出完）
 * - **VITE_STREAM_REVEAL_MS**：定时节拍毫秒数（12～280），与 MODE 同时配时优先于 MODE 里的间隔
 * - **VITE_STREAM_CHARS_PER_TICK**：每节拍最多贴出字数（1～24），同上可覆盖 MODE
 *
 * 任一生效值为 ≤0 则等价于关闭节流。
 */

function readEnv() {
  if (typeof import.meta === 'undefined' || !import.meta.env) {
    return {}
  }
  return import.meta.env
}

export function getStreamRevealConfig() {
  const env = readEnv()
  const rawMode =
    env.VITE_STREAM_REVEAL_MODE != null && env.VITE_STREAM_REVEAL_MODE !== ''
      ? String(env.VITE_STREAM_REVEAL_MODE).toLowerCase().trim()
      : ''

  const rawInterval = env.VITE_STREAM_REVEAL_MS
  const rawChunk = env.VITE_STREAM_CHARS_PER_TICK
  const hasExplicitInterval =
    rawInterval !== undefined && rawInterval !== ''
  const hasExplicitChunk = rawChunk !== undefined && rawChunk !== ''
  const hasExplicit = hasExplicitInterval || hasExplicitChunk

  let intervalMs = 36
  let charsPerTick = 2

  if (hasExplicit) {
    intervalMs = hasExplicitInterval ? Number(rawInterval) : 36
    charsPerTick = hasExplicitChunk ? Number(rawChunk) : 2
  } else {
    switch (rawMode) {
      case 'off':
      case 'none':
      case '0':
        return { useThrottle: false, intervalMs: 0, charsPerTick: 0 }
      case 'fast':
        intervalMs = 24
        charsPerTick = 3
        break
      case 'slow':
      case 'voice':
      case 'tts':
      case 'sync':
        intervalMs = 56
        charsPerTick = 1
        break
      default:
        break
    }
  }

  if (!Number.isFinite(intervalMs)) intervalMs = 36
  if (!Number.isFinite(charsPerTick)) charsPerTick = 2
  if (intervalMs <= 0 || charsPerTick <= 0) {
    return { useThrottle: false, intervalMs: 0, charsPerTick: 0 }
  }

  return {
    useThrottle: true,
    intervalMs: Math.min(280, Math.max(12, intervalMs)),
    charsPerTick: Math.min(24, Math.max(1, charsPerTick))
  }
}
