/**
 * 浏览器侧 TTS 播放与上游合成参数（`.env` 中为 VITE_ 前缀）。
 *
 * - **VITE_TTS_PLAYBACK_RATE**：`HTMLAudioElement.playbackRate`，默认 1。
 *   大于 1 加快播放（例如 1.15～1.35 可拉近与「快字」的差距），建议 0.85～1.5。
 * - **VITE_TTS_SPEED**：讯飞合成语速 0～100（默认后台 50），不传则不覆盖。
 *   略高于 50 会略加快成片语速（仍可与 playbackRate 叠用）。
 */

function readEnv() {
  if (typeof import.meta === 'undefined' || !import.meta.env) {
    return {}
  }
  return import.meta.env
}

/** @returns {number} 用于 audio.playbackRate */
export function getTtsPlaybackRate() {
  const raw = readEnv().VITE_TTS_PLAYBACK_RATE
  if (raw === undefined || raw === '') return 1
  const value = Number(raw)
  if (!Number.isFinite(value)) return 1
  return Math.min(1.5, Math.max(0.85, value))
}

/** @returns {number|undefined} 讯飞 speed，未配置则 undefined */
export function getTtsSynthSpeed() {
  const raw = readEnv().VITE_TTS_SPEED
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(100, Math.round(value)))
}
