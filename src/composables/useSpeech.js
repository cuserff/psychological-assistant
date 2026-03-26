// 封装 Web Speech API 相关的语音录制与识别逻辑
import { ref, onBeforeUnmount } from 'vue'

/**
 * 语音识别组合函数，基于浏览器原生 SpeechRecognition API
 * @returns {{ isSupported, isListening, transcript, error, clearError, startListening, stopListening }}
 */
export function useSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

  // 浏览器是否支持语音识别
  const isSupported = ref(!!SpeechRecognition)
  // 是否正在录音
  const isListening = ref(false)
  // 识别到的文字
  const transcript = ref('')
  // 错误状态（用于 UI 提示与重试）
  const error = ref(null) // { code: string, message: string } | null

  let recognition = null

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
      'network': '网络异常导致语音识别失败，请稍后重试。',
      'bad-grammar': '语音识别参数异常，请稍后重试。',
      'language-not-supported': '当前语言不支持语音识别。',
      aborted: '已取消语音识别。'
    }
    return messageMap[errorCode] || '语音识别失败，请重试。'
  }

  if (SpeechRecognition) {
    recognition = new SpeechRecognition()
    // 中文识别
    recognition.lang = 'zh-CN'
    // 连续识别，不会在一句话后自动停止
    recognition.continuous = true
    // 返回中间结果，实时显示识别文字
    recognition.interimResults = true

    // 识别到结果时触发
    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }

      // 最终结果 + 中间结果拼接，实时更新
      transcript.value = finalText + interimText
    }

    recognition.onerror = (event) => {
      // 用户拒绝麦克风权限或其他错误：记录错误供 UI 提示
      const errorCode = event?.error || 'unknown'
      setError(errorCode, mapSpeechErrorToMessage(errorCode))
      isListening.value = false
    }

    recognition.onend = () => {
      isListening.value = false
    }
  }

  /** 开始录音 */
  function startListening() {
    if (!recognition || isListening.value) return
    clearError()
    transcript.value = ''
    try {
      recognition.start()
      isListening.value = true
    } catch (e) {
      // start() 在部分浏览器可能直接抛异常（比如权限问题/状态错误）
      setError('start-failed', '无法启动语音识别，请检查浏览器麦克风权限后重试。')
      isListening.value = false
    }
  }

  /** 停止录音 */
  function stopListening() {
    if (!recognition || !isListening.value) return
    recognition.stop()
    isListening.value = false
  }

  // 组件卸载时自动停止录音
  onBeforeUnmount(() => {
    stopListening()
  })

  return {
    isSupported,
    isListening,
    transcript,
    error,
    clearError,
    startListening,
    stopListening
  }
}
