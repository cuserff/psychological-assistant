// 封装 Web Speech API 相关的语音录制与识别逻辑
import { ref, onBeforeUnmount } from 'vue'

/**
 * 语音识别组合函数，基于浏览器原生 SpeechRecognition API
 * @returns {{ isSupported, isListening, transcript, startListening, stopListening }}
 */
export function useSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

  // 浏览器是否支持语音识别
  const isSupported = ref(!!SpeechRecognition)
  // 是否正在录音
  const isListening = ref(false)
  // 识别到的文字
  const transcript = ref('')

  let recognition = null

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
      // 用户拒绝麦克风权限或其他错误，静默停止
      if (event.error !== 'aborted') {
        console.warn('语音识别错误:', event.error)
      }
      isListening.value = false
    }

    recognition.onend = () => {
      isListening.value = false
    }
  }

  /** 开始录音 */
  function startListening() {
    if (!recognition || isListening.value) return
    transcript.value = ''
    recognition.start()
    isListening.value = true
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
    startListening,
    stopListening
  }
}
