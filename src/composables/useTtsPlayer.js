import { ref } from 'vue'
import { synthesizeTts } from '../api/voice'
import { recordLatencySample, recordErrorCode } from '../utils/chatObservability'
import { getTtsPlaybackRate, getTtsSynthSpeed } from '../utils/ttsPlaybackConfig'

/**
 * 按标点切句后，字数不少于该阈值再单独入队，避免「一两字一停」。
 * 更短的分片由 Chat 与后续流式拼接；**流结束时的尾巴**可整段入队（不受此限）。
 */
export const TTS_MIN_SEGMENT_CHARS = 8

function normalizeSpeakText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 建单例播报器：全应用共用一个队列，便于「停止生成」等场景从任意处 stop
 */
function createSharedTtsPlayer() {
  const isPlaying = ref(false)
  const lastError = ref(null)
  /** 尚未播放的队列条数（用于 UI：排队/播报） */
  const queuedCount = ref(0)

  /** @type {Array<{ id: string, text: string }>} */
  const queue = []
  let currentAudioUrl = ''
  let audioEl = null
  let abortController = null

  function syncQueueSize() {
    queuedCount.value = queue.length
  }

  /**
   * 硬打断：清空队列、中止未完成合成、停止当前 Audio。
   * 与 STT 新开录前配合，避免「上一轮播报未停就开麦」。
   */
  function stop() {
    // 先掉播放态，便于 UI 与新一轮语音在数百毫秒内完成打断反馈
    isPlaying.value = false
    queue.length = 0
    syncQueueSize()
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    if (audioEl) {
      try {
        audioEl.pause()
      } catch {
        // ignore
      }
      audioEl = null
    }
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl)
      currentAudioUrl = ''
    }
  }

  async function playNext() {
    if (isPlaying.value) return
    const next = queue.shift()
    syncQueueSize()
    if (!next) return

    const text = normalizeSpeakText(next.text)
    if (!text) {
      return playNext()
    }

    isPlaying.value = true
    lastError.value = null
    abortController = new AbortController()

    const ttsStartPerf =
      typeof performance !== 'undefined' ? performance.now() : Date.now()
    let ttsFirstPlayRecorded = false

    const defaultSynthSpeed = getTtsSynthSpeed()

    try {
      const blob = await synthesizeTts(text, {
        signal: abortController.signal,
        ...(defaultSynthSpeed != null ? { speed: defaultSynthSpeed } : {})
      })
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl)
        currentAudioUrl = ''
      }
      currentAudioUrl = URL.createObjectURL(blob)
      audioEl = new Audio(currentAudioUrl)
      audioEl.preload = 'auto'
      const playbackRate = getTtsPlaybackRate()
      if (playbackRate !== 1 && Number.isFinite(playbackRate)) {
        audioEl.playbackRate = playbackRate
      }
      await audioEl.play()
      if (!ttsFirstPlayRecorded) {
        ttsFirstPlayRecorded = true
        const now =
          typeof performance !== 'undefined' ? performance.now() : Date.now()
        recordLatencySample('ttsFirstAudioMs', Math.round(now - ttsStartPerf))
      }

      await new Promise((resolve) => {
        if (!audioEl) return resolve()
        audioEl.onended = () => resolve()
        audioEl.onerror = () => resolve()
      })
    } catch (error) {
      if (error?.name !== 'AbortError') {
        lastError.value = error
        const errCode =
          typeof error?.message === 'string' && error.message
            ? error.message.slice(0, 64)
            : error?.name || 'tts_failed'
        recordErrorCode('tts', errCode)
      }
    } finally {
      abortController = null
      isPlaying.value = false
      if (audioEl) {
        audioEl.onended = null
        audioEl.onerror = null
        audioEl = null
      }
      if (queue.length > 0) {
        void playNext()
      }
    }
  }

  function enqueue(text) {
    const normalized = normalizeSpeakText(text)
    if (!normalized) return
    queue.push({ id: crypto.randomUUID(), text: normalized })
    syncQueueSize()
    if (!isPlaying.value) {
      void playNext()
    }
  }

  return {
    isPlaying,
    lastError,
    queuedCount,
    enqueue,
    stop
  }
}

/** 模块级单例，useChat / 对话页共用同一播放队列 */
const sharedTtsPlayer = createSharedTtsPlayer()

/**
 * 语音播报队列：文本片段依次合成并播放（避免并发播放）
 */
export function useTtsPlayer() {
  return sharedTtsPlayer
}

