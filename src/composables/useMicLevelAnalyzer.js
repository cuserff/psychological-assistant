/**
 * 麦克风 RMS 电平 0..1，供语音通话粒子等可视化使用。
 * 与 STT 使用独立的一条 getUserMedia（浏览器允许多路采集）。
 */
import { ref, watch, onBeforeUnmount } from 'vue'

/**
 * @param {import('vue').Ref<boolean>} isActiveRef 为 true 时采集并更新 level
 */
export function useMicLevelAnalyzer(isActiveRef) {
  const level = ref(0)

  let mediaStream = null
  /** @type {AudioContext|null} */
  let audioContext = null
  /** @type {AnalyserNode|null} */
  let analyserNode = null
  /** @type {Uint8Array|null} */
  let timeDomainData = null
  /** @type {number|null} */
  let rafId = null

  function stopAnalysis() {
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop())
      mediaStream = null
    }
    if (audioContext) {
      audioContext.close().catch(() => {})
      audioContext = null
    }
    analyserNode = null
    timeDomainData = null
    level.value = 0
  }

  function tick() {
    if (!analyserNode || !timeDomainData) return
    analyserNode.getByteTimeDomainData(timeDomainData)
    let sumSquares = 0
    const bufferLength = timeDomainData.length
    for (let index = 0; index < bufferLength; index++) {
      const amplitude = (timeDomainData[index] - 128) / 128
      sumSquares += amplitude * amplitude
    }
    const rms = Math.sqrt(sumSquares / bufferLength)
    const instant = Math.min(1, rms * 4.2)
    level.value = level.value * 0.65 + instant * 0.35
    rafId = requestAnimationFrame(tick)
  }

  async function startAnalysis() {
    stopAnalysis()
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      })
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext
      audioContext = new AudioContextCtor()
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }
      const sourceNode = audioContext.createMediaStreamSource(mediaStream)
      analyserNode = audioContext.createAnalyser()
      analyserNode.fftSize = 1024
      analyserNode.smoothingTimeConstant = 0.62
      sourceNode.connect(analyserNode)
      timeDomainData = new Uint8Array(analyserNode.fftSize)
      rafId = requestAnimationFrame(tick)
    } catch {
      stopAnalysis()
    }
  }

  function syncActive() {
    if (isActiveRef.value) {
      void startAnalysis()
    } else {
      stopAnalysis()
    }
  }

  watch(isActiveRef, syncActive, { immediate: true })

  onBeforeUnmount(() => {
    stopAnalysis()
  })

  return { level }
}
