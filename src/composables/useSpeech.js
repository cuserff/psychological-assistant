/**
 * 语音识别（双路径）：
 * - **backend**：`WebSocket /ws/stt` + 麦克风 PCM（服务端讯飞 IAT 或 RTASR）
 * - **browser**：`SpeechRecognition` / `webkitSpeechRecognition`，`continuous` + `interimResults`
 * 实时文案统一写入 **currentSubtitle**（`transcript` 为同一 ref）。
 */
import { ref, computed, onBeforeUnmount, watch } from 'vue'
import { createSttStreamClient } from '../api/voice'
import {
  markSttUtteranceEndedForMetrics,
  maybeRecordSttFirstTextLatency,
  maybeRecordSttFinalLatency,
  resetSttUtteranceMark,
  recordErrorCode
} from '../utils/chatObservability'

const STT_STREAM_CHUNK_MS = 280
const VAD_RMS_THRESHOLD = 0.012
const VAD_SILENCE_END_MS = 1400

/**
 * @param {Object} [options]
 * @param {() => 'browser'|'backend'} [options.getMode]
 * @param {() => void} [options.beforeStartListening]
 * @param {(detail: { text: string, durationMs: number, safety: object }) => void} [options.onBackendTranscribeResult]
 * @param {(recognizing: boolean) => void} [options.onRecognizingChange]
 */
export function useSpeech(options = {}) {
  const getMode =
    typeof options.getMode === 'function' ? options.getMode : () => 'browser'
  const runBeforeStartListening = () => {
    try {
      if (typeof options.beforeStartListening === 'function') {
        options.beforeStartListening()
      }
    } catch {
      // ignore
    }
  }
  const onBackendTranscribeResult =
    typeof options.onBackendTranscribeResult === 'function'
      ? options.onBackendTranscribeResult
      : null
  const onRecognizingChange =
    typeof options.onRecognizingChange === 'function'
      ? options.onRecognizingChange
      : null

  const SpeechRecognition =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null

  const isSupported = computed(() => {
    const mode = getMode()
    if (mode === 'backend') {
      return Boolean(
        typeof navigator !== 'undefined'
          && navigator.mediaDevices
          && typeof navigator.mediaDevices.getUserMedia === 'function'
          && typeof WebSocket !== 'undefined'
          && (typeof AudioContext !== 'undefined'
            || typeof window.webkitAudioContext !== 'undefined')
      )
    }
    return Boolean(SpeechRecognition)
  })

  const isListening = ref(false)
  const isRecognizing = ref(false)
  const currentSubtitle = ref('')
  /** @type {import('vue').Ref<{ code: string, message: string }|null>} */
  const error = ref(null)

  watch(isRecognizing, (value) => {
    onRecognizingChange?.(value)
  })

  let recognition = null

  let mediaStream = null
  let audioContext = null
  let scriptProcessor = null
  let gainNode = null
  /** @type {Float32Array[]} */
  const pcmFloatChunks = []
  /** @type {ReturnType<typeof createSttStreamClient>|null} */
  let streamClient = null
  /** @type {ReturnType<typeof setInterval>|null} */
  let streamFlushTimerId = null

  let vadSilenceAccumMs = 0
  let vadHasHeardSpeechFrame = false

  function resetVadState() {
    vadSilenceAccumMs = 0
    vadHasHeardSpeechFrame = false
  }

  function computeFloat32Rms(samples) {
    if (!samples || samples.length === 0) return 0
    let sumSquares = 0
    for (let index = 0; index < samples.length; index++) {
      const value = samples[index]
      sumSquares += value * value
    }
    return Math.sqrt(sumSquares / samples.length)
  }

  function clearError() {
    error.value = null
  }

  function setError(code, message) {
    error.value = { code, message }
  }

  function mapSpeechErrorToMessage(errorCode) {
    const messageMap = {
      'not-allowed': '麦克风权限被拒绝，请先授权后再试。',
      'service-not-allowed': '语音服务不可用或被禁用，请检查浏览器设置。',
      'audio-capture': '未检测到麦克风设备，请检查麦克风是否连接或被占用。',
      'no-speech': '没有识别到语音内容，请靠近麦克风再试一次。',
      network: '网络异常导致语音识别失败，请稍后重试。',
      'bad-grammar': '语音识别参数异常，请稍后重试。',
      'language-not-supported': '当前语言不支持语音识别。',
      aborted: '已取消语音识别。',
      'stt-failed': '语音识别服务异常，请稍后重试。',
      'stt-empty': '未识别到文字，请再说一次。',
      'start-failed': '无法启动语音识别，请检查浏览器麦克风权限后重试。',
      'ws-start-failed': '无法启动实时语音识别，请检查网络或登录状态后重试。',
      timeout: '语音识别等待超时，请重试。'
    }
    return messageMap[errorCode] || '语音识别失败，请重试。'
  }

  if (SpeechRecognition) {
    recognition = new SpeechRecognition()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index]
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }
      currentSubtitle.value = finalText + interimText
      maybeRecordSttFirstTextLatency(currentSubtitle.value)
    }

    recognition.onerror = (event) => {
      const errorCode = event?.error || 'unknown'
      recordErrorCode('stt', String(errorCode))
      resetSttUtteranceMark()
      setError(errorCode, mapSpeechErrorToMessage(errorCode))
      isListening.value = false
      isRecognizing.value = false
    }

    recognition.onend = () => {
      maybeRecordSttFinalLatency(currentSubtitle.value)
      resetSttUtteranceMark()
      isListening.value = false
      isRecognizing.value = false
    }
  }

  function stopStreamFlushTimer() {
    if (streamFlushTimerId != null) {
      clearInterval(streamFlushTimerId)
      streamFlushTimerId = null
    }
  }

  function resetPcmChunks() {
    pcmFloatChunks.length = 0
  }

  function teardownAudioNodesOnly() {
    if (scriptProcessor) {
      scriptProcessor.onaudioprocess = null
      try {
        scriptProcessor.disconnect()
      } catch {
        // ignore
      }
      scriptProcessor = null
    }
    if (gainNode) {
      try {
        gainNode.disconnect()
      } catch {
        // ignore
      }
      gainNode = null
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop())
      mediaStream = null
    }
  }

  async function closeAudioContextIfAny() {
    if (audioContext) {
      try {
        await audioContext.close()
      } catch {
        // ignore
      }
      audioContext = null
    }
  }

  function downsampleBuffer(inputBuffer, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) return inputBuffer
    const sampleRateRatio = inputSampleRate / outputSampleRate
    const newLength = Math.round(inputBuffer.length / sampleRateRatio)
    const result = new Float32Array(newLength)
    let offsetResult = 0
    let offsetBuffer = 0
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio)
      let accum = 0
      let count = 0
      for (
        let index = offsetBuffer;
        index < nextOffsetBuffer && index < inputBuffer.length;
        index++
      ) {
        accum += inputBuffer[index]
        count++
      }
      result[offsetResult] = count > 0 ? accum / count : 0
      offsetResult++
      offsetBuffer = nextOffsetBuffer
    }
    return result
  }

  function floatTo16BitPcm(float32) {
    const output = new Int16Array(float32.length)
    for (let index = 0; index < float32.length; index++) {
      const sample = Math.max(-1, Math.min(1, float32[index]))
      output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    }
    return output
  }

  async function shutdownExistingStreamClient() {
    const existingClient = takeStreamClientForForcedShutdown()
    if (!existingClient) return
    try {
      await Promise.race([
        existingClient.stop(),
        new Promise((resolve) => setTimeout(resolve, 4500))
      ])
    } catch {
      // ignore
    }
    try {
      existingClient.close()
    } catch {
      // ignore
    }
  }

  function takeStreamClientForForcedShutdown() {
    const existingClient = streamClient
    if (!existingClient) return null
    streamClient = null
    return existingClient
  }

  function pcm16ToBase64(int16) {
    const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength)
    let binary = ''
    const chunkSize = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const slice = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
      binary += String.fromCharCode.apply(null, slice)
    }
    return btoa(binary)
  }

  function mergePcmFloatChunksToSingleBuffer() {
    if (pcmFloatChunks.length === 0) return null
    let totalSamples = 0
    for (const chunk of pcmFloatChunks) {
      totalSamples += chunk.length
    }
    const merged = new Float32Array(totalSamples)
    let writeIndex = 0
    for (const chunk of pcmFloatChunks) {
      merged.set(chunk, writeIndex)
      writeIndex += chunk.length
    }
    pcmFloatChunks.length = 0
    return merged
  }

  async function stopBackendListening() {
    if (!isListening.value && !streamClient) return

    markSttUtteranceEndedForMetrics()
    isRecognizing.value = true
    try {
      stopStreamFlushTimer()

      const savedInputRate = audioContext ? audioContext.sampleRate : 48000

      teardownAudioNodesOnly()
      await closeAudioContextIfAny()

      const tailFloat = mergePcmFloatChunksToSingleBuffer()
      resetPcmChunks()
      resetVadState()

      if (
        streamClient
        && streamClient.getState() === 'started'
        && tailFloat
        && tailFloat.length > 0
      ) {
        const down = downsampleBuffer(tailFloat, savedInputRate, 16000)
        if (down.length > 0) {
          const pcm16 = floatTo16BitPcm(down)
          streamClient.sendAudioChunk(pcm16ToBase64(pcm16))
        }
      }

      if (streamClient) {
        try {
          await streamClient.stop()
        } catch {
          // ignore
        }
        streamClient.close()
        streamClient = null
      }

      isListening.value = false

      const textAfter = String(currentSubtitle.value || '').trim()
      if (!textAfter && !error.value) {
        setError('stt-empty', mapSpeechErrorToMessage('stt-empty'))
      }
    } finally {
      isRecognizing.value = false
    }
  }

  function flushPcmToStream() {
    if (!streamClient || streamClient.getState() !== 'started') return
    const contextSnapshot = audioContext
    const inputRate = contextSnapshot ? contextSnapshot.sampleRate : 48000
    const mergedFloat = mergePcmFloatChunksToSingleBuffer()
    if (!mergedFloat || mergedFloat.length === 0) return

    const chunkRms = computeFloat32Rms(mergedFloat)
    const isSilent = chunkRms < VAD_RMS_THRESHOLD

    if (isSilent) {
      vadSilenceAccumMs += STT_STREAM_CHUNK_MS
      if (
        vadHasHeardSpeechFrame
        && vadSilenceAccumMs >= VAD_SILENCE_END_MS
        && isListening.value
      ) {
        vadSilenceAccumMs = 0
        void stopBackendListening()
      }
      return
    }

    vadHasHeardSpeechFrame = true
    vadSilenceAccumMs = 0

    const down = downsampleBuffer(mergedFloat, inputRate, 16000)
    if (down.length === 0) return
    const pcm16 = floatTo16BitPcm(down)
    const base64 = pcm16ToBase64(pcm16)
    streamClient.sendAudioChunk(base64)
  }

  async function startBackendListening() {
    resetSttUtteranceMark()
    runBeforeStartListening()
    await shutdownExistingStreamClient()
    stopStreamFlushTimer()
    teardownAudioNodesOnly()
    await closeAudioContextIfAny()
    resetPcmChunks()
    resetVadState()
    clearError()
    currentSubtitle.value = ''

    if (typeof WebSocket === 'undefined') {
      recordErrorCode('stt', 'start-failed')
      setError('start-failed', '当前环境不支持 WebSocket，无法使用实时语音识别')
      return
    }

    streamClient = createSttStreamClient({
      onPartial: (text) => {
        currentSubtitle.value = text
        maybeRecordSttFirstTextLatency(text)
      },
      onFinal: (text) => {
        currentSubtitle.value = String(text || '').trim()
        maybeRecordSttFinalLatency(currentSubtitle.value)
        resetSttUtteranceMark()
        onBackendTranscribeResult?.({
          text: currentSubtitle.value,
          durationMs: 0,
          safety: { riskLevel: 'none', hitRules: [], safeReplyMode: false }
        })
      },
      onError: ({ code, message }) => {
        recordErrorCode('stt', String(code || 'stt-failed'))
        resetSttUtteranceMark()
        setError(
          code || 'stt-failed',
          message || mapSpeechErrorToMessage('stt-failed')
        )
        stopStreamFlushTimer()
        teardownAudioNodesOnly()
        void closeAudioContextIfAny()
        resetPcmChunks()
        if (streamClient) {
          streamClient.close()
          streamClient = null
        }
        isListening.value = false
        isRecognizing.value = false
      },
      onStateChange: () => {}
    })

    try {
      await streamClient.connect()
    } catch {
      recordErrorCode('stt', 'network')
      streamClient.close()
      streamClient = null
      if (!error.value) {
        setError('network', mapSpeechErrorToMessage('network'))
      }
      return
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      recordErrorCode('stt', 'not-allowed')
      streamClient.close()
      streamClient = null
      setError('not-allowed', mapSpeechErrorToMessage('not-allowed'))
      return
    }
    mediaStream = stream

    try {
      await streamClient.start()
    } catch {
      recordErrorCode('stt', 'ws-start-failed')
      streamClient.close()
      streamClient = null
      teardownAudioNodesOnly()
      if (!error.value) {
        setError('ws-start-failed', mapSpeechErrorToMessage('ws-start-failed'))
      }
      return
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    let context
    try {
      context = new AudioContextCtor()
    } catch {
      recordErrorCode('stt', 'start-failed')
      stream.getTracks().forEach((track) => track.stop())
      mediaStream = null
      streamClient.close()
      streamClient = null
      setError('start-failed', mapSpeechErrorToMessage('start-failed'))
      return
    }
    audioContext = context

    const sourceNode = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    scriptProcessor = processor
    gainNode = context.createGain()
    gainNode.gain.value = 0

    processor.onaudioprocess = (audioEvent) => {
      const channelData = audioEvent.inputBuffer.getChannelData(0)
      const copy = new Float32Array(channelData.length)
      copy.set(channelData)
      pcmFloatChunks.push(copy)
    }

    sourceNode.connect(processor)
    processor.connect(gainNode)
    gainNode.connect(context.destination)

    streamFlushTimerId = setInterval(() => {
      flushPcmToStream()
    }, STT_STREAM_CHUNK_MS)

    isListening.value = true
  }

  function startBrowserListening() {
    resetSttUtteranceMark()
    runBeforeStartListening()
    if (!recognition || isListening.value) return
    clearError()
    currentSubtitle.value = ''
    try {
      recognition.start()
      isListening.value = true
    } catch {
      recordErrorCode('stt', 'start-failed')
      setError('start-failed', mapSpeechErrorToMessage('start-failed'))
      isListening.value = false
    }
  }

  function stopBrowserListening() {
    if (!recognition || !isListening.value) return
    markSttUtteranceEndedForMetrics()
    isRecognizing.value = true
    try {
      recognition.stop()
    } catch {
      isRecognizing.value = false
      isListening.value = false
    }
  }

  function startListening() {
    if (getMode() === 'backend') {
      void startBackendListening()
      return
    }
    startBrowserListening()
  }

  function stopListening() {
    if (getMode() === 'backend') {
      void stopBackendListening()
      return
    }
    stopBrowserListening()
  }

  onBeforeUnmount(() => {
    stopStreamFlushTimer()
    teardownAudioNodesOnly()
    void closeAudioContextIfAny()
    resetPcmChunks()
    if (streamClient) {
      streamClient.close()
      streamClient = null
    }
    if (recognition && isListening.value) {
      try {
        recognition.abort()
      } catch {
        // ignore
      }
    }
    isListening.value = false
    isRecognizing.value = false
  })

  return {
    isSupported,
    isListening,
    isRecognizing,
    currentSubtitle,
    transcript: currentSubtitle,
    error,
    clearError,
    startListening,
    stopListening
  }
}
