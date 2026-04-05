import { BASE_URL } from './config'
import { getToken } from '../utils/storage'

/**
 * 语音相关 HTTP/WS 工具。
 *
 * - 实时麦克风：`composables/useSpeech` 在 **backend** 模式下使用 {@link createSttStreamClient}（`/ws/stt`）；
 *   **browser** 模式下使用 Web Speech API（不经此文件）。
 * - {@link transcribeShortAudio}：`POST /api/voice/stt` 短音频整段转写。
 */

/**
 * 将 HTTP API 根地址转为 WebSocket 源（ws / wss）
 * @param {string} httpBase
 * @returns {string}
 */
export function httpBaseToWsOrigin(httpBase) {
  const trimmed = String(httpBase || '').replace(/\/$/, '')
  return trimmed
    .replace(/^http:/i, 'ws:')
    .replace(/^https:/i, 'wss:')
}

/**
 * @param {string} code
 * @param {string} [fallback]
 * @returns {string}
 */
export function mapSttWsCodeToMessage(code, fallback) {
  const table = {
    missing_token: '缺少登录凭证，请重新登录后再试。',
    invalid_token: '登录已失效，请重新登录后再试。',
    bad_json: '数据格式错误，请重试。',
    session_closed: '语音识别会话已结束，请再说一次。',
    not_started: '语音识别未正确开始，请重试。',
    invalid_state: '语音识别状态冲突，请稍后再试。',
    idle_timeout: '长时间未发送语音，已自动结束，请再说一次。',
    session_timeout: '单次录音时间过长已结束，请分段说话。',
    upstream_connect_timeout: '连接语音服务超时，请检查网络或稍后重试。',
    upstream_connect_failed: '无法连接语音服务，请检查网络或稍后重试。',
    upstream_stt: fallback ? String(fallback) : '语音转写服务返回错误，请稍后重试。',
    upstream_error: '语音服务连接异常，请稍后重试。',
    upstream_closed: '语音服务连接已断开，请重试。',
    stt_not_configured: '服务端未配置语音识别，请联系管理员。',
    ws_error: '无法建立实时语音识别连接，请检查网络。',
    network: '网络异常，请检查网络后重试。',
    timeout: '连接语音识别超时，请重试。',
    aborted: '已取消。',
    unknown_type: fallback ? String(fallback) : '协议错误，请重试。',
    frame_too_large: '单帧语音数据过大，请重试或联系管理员。',
    audio_rate_limit: '语音发送过快，请稍后再试。',
    session_audio_quota: '本轮语音数据量已达上限，请停止后重新开始。'
  }
  const key = String(code || '')
  if (table[key]) return table[key]
  if (fallback && String(fallback).trim()) return String(fallback)
  return '语音识别失败，请重试。'
}

/**
 * 实时听写 WebSocket 客户端（协议与 backend /ws/stt 一致）。
 * 与 HTTP `/api/voice/stt` 无关；短音频整段请用 {@link transcribeShortAudio}。
 *
 * @param {Object} [callbacks]
 * @param {(text: string) => void} [callbacks.onPartial]
 * @param {(text: string) => void} [callbacks.onFinal]
 * @param {(payload: { code: string, message: string }) => void} [callbacks.onError]
 * @param {(state: string) => void} [callbacks.onStateChange]
 * @returns {{
 *   connect: () => Promise<void>,
 *   start: () => Promise<void>,
 *   sendAudioChunk: (base64Pcm: string) => void,
 *   stop: () => Promise<void>,
 *   close: () => void,
 *   getState: () => string
 * }}
 */
/** 等待服务端 final 的最长时间（需略大于后端 STT_WS_STOP_WAIT_MS，以便收到兜底 final） */
const STT_CLIENT_FINAL_WAIT_MS = 16000

export function createSttStreamClient(callbacks = {}) {
  const onPartial =
    typeof callbacks.onPartial === 'function' ? callbacks.onPartial : () => {}
  const onFinal =
    typeof callbacks.onFinal === 'function' ? callbacks.onFinal : () => {}
  const onError =
    typeof callbacks.onError === 'function' ? callbacks.onError : () => {}
  const onStateChange =
    typeof callbacks.onStateChange === 'function' ? callbacks.onStateChange : () => {}

  /** @type {WebSocket|null} */
  let socket = null
  /** @type {'idle'|'connecting'|'ready'|'started'|'stopping'|'closed'} */
  let clientState = 'idle'

  /** @type {{ resolve: () => void, reject: (e: Error) => void } | null} */
  let awaitingConnect = null
  /** @type {{ resolve: () => void, reject: (e: Error) => void } | null} */
  let awaitingStarted = null
  /** @type {{ resolve: () => void } | null} */
  let awaitingFinal = null

  let connectTimeoutId = null
  let finalTimeoutId = null
  let startedTimeoutId = null

  /** 最近一条 partial 文案，stop 超时或断连时作兜底 final */
  let lastSttPartialText = ''
  /** 已发送 stop，等待本轮 final */
  let awaitingStopFinal = false
  /** 本轮是否已收到服务端 final（避免超时重复 onFinal） */
  let stopRoundGotServerFinal = false

  function setClientState(next) {
    clientState = next
    onStateChange(next)
  }

  function getState() {
    return clientState
  }

  function buildWsUrl() {
    const token = getToken()
    if (!token || !String(token).trim()) {
      throw new Error('未登录或缺少令牌，无法使用实时语音识别')
    }
    const wsOrigin = httpBaseToWsOrigin(BASE_URL)
    return `${wsOrigin}/ws/stt?token=${encodeURIComponent(String(token).trim())}`
  }

  function clearConnectTimeout() {
    if (connectTimeoutId != null) {
      clearTimeout(connectTimeoutId)
      connectTimeoutId = null
    }
  }

  function clearStartedTimeout() {
    if (startedTimeoutId != null) {
      clearTimeout(startedTimeoutId)
      startedTimeoutId = null
    }
  }

  function clearFinalTimeout() {
    if (finalTimeoutId != null) {
      clearTimeout(finalTimeoutId)
      finalTimeoutId = null
    }
  }

  function rejectAwaitingConnect(error) {
    if (awaitingConnect) {
      const pending = awaitingConnect
      awaitingConnect = null
      pending.reject(error)
    }
  }

  function rejectAwaitingStarted(error) {
    if (awaitingStarted) {
      const pending = awaitingStarted
      awaitingStarted = null
      clearStartedTimeout()
      pending.reject(error)
    }
  }

  function resolveAwaitingFinal() {
    if (awaitingFinal) {
      const pending = awaitingFinal
      awaitingFinal = null
      clearFinalTimeout()
      pending.resolve()
    }
  }

  /** stop 收尾：若无服务端 final，则用当前 partial 触发一次 onFinal，并结束等待 */
  function finalizeStopRoundWithFallback() {
    if (awaitingStopFinal && !stopRoundGotServerFinal) {
      onFinal(String(lastSttPartialText || '').trim())
      stopRoundGotServerFinal = true
    }
    awaitingStopFinal = false
  }

  /** 请求关闭；真正清理在 socket.onclose 内完成，避免与浏览器事件竞态 */
  function cleanupSocketSoft() {
    clearConnectTimeout()
    if (!socket) return
    try {
      socket.close()
    } catch {
      // ignore
    }
  }

  function routePayload(parsed) {
    const messageType = parsed && parsed.type

    if (messageType === 'ready') {
      setClientState('ready')
      if (awaitingConnect) {
        const pending = awaitingConnect
        awaitingConnect = null
        clearConnectTimeout()
        pending.resolve()
      }
      return
    }

    if (messageType === 'started') {
      setClientState('started')
      if (awaitingStarted) {
        const pending = awaitingStarted
        awaitingStarted = null
        clearStartedTimeout()
        pending.resolve()
      }
      return
    }

    if (messageType === 'partial') {
      const piece = String(parsed.text ?? '')
      lastSttPartialText = piece
      onPartial(piece)
      return
    }

    if (messageType === 'final') {
      const piece = String(parsed.text ?? '').trim()
      lastSttPartialText = piece
      if (awaitingStopFinal) {
        awaitingStopFinal = false
        stopRoundGotServerFinal = true
      }
      onFinal(piece)
      setClientState('ready')
      resolveAwaitingFinal()
      return
    }

    if (messageType === 'error') {
      const code = String(parsed.code || 'unknown')
      const message = mapSttWsCodeToMessage(code, parsed.message)
      finalizeStopRoundWithFallback()
      resolveAwaitingFinal()
      onError({ code, message })
      const errorObject = new Error(code)
      rejectAwaitingConnect(errorObject)
      rejectAwaitingStarted(errorObject)
      return
    }
  }

  function attachSocketHandlers() {
    if (!socket) return

    socket.onmessage = (event) => {
      let parsed
      try {
        parsed = JSON.parse(String(event.data || ''))
      } catch {
        return
      }
      routePayload(parsed)
    }

    socket.onerror = () => {
      onError({
        code: 'ws_error',
        message: mapSttWsCodeToMessage('ws_error')
      })
      rejectAwaitingConnect(new Error('ws_error'))
      rejectAwaitingStarted(new Error('ws_error'))
    }

    socket.onclose = () => {
      clearConnectTimeout()
      clearStartedTimeout()
      const wasActive = clientState === 'started' || clientState === 'stopping'
      const needFallbackFinal = clientState === 'stopping' || awaitingStopFinal
      socket = null
      if (awaitingConnect) {
        rejectAwaitingConnect(new Error('aborted'))
      }
      rejectAwaitingStarted(new Error('aborted'))
      let closedWithStopFallback = false
      if (needFallbackFinal && !stopRoundGotServerFinal) {
        onFinal(String(lastSttPartialText || '').trim())
        stopRoundGotServerFinal = true
        closedWithStopFallback = true
      }
      awaitingStopFinal = false
      resolveAwaitingFinal()
      // 已在断连时补过 final 的不再弹网络错，避免误报
      if (wasActive && !closedWithStopFallback) {
        onError({
          code: 'network',
          message: '与语音识别服务的连接已断开，请检查网络后重试'
        })
      }
      setClientState('idle')
    }
  }

  /**
   * 建立连接并等待服务端 ready
   * @returns {Promise<void>}
   */
  function connect() {
    cleanupSocketSoft()
    setClientState('connecting')
    let wsUrl
    try {
      wsUrl = buildWsUrl()
    } catch (error) {
      const message = error?.message || '无法连接语音识别'
      onError({ code: 'missing_token', message })
      setClientState('idle')
      return Promise.reject(error)
    }

    return new Promise((resolve, reject) => {
      awaitingConnect = { resolve, reject }
      connectTimeoutId = setTimeout(() => {
        connectTimeoutId = null
        if (awaitingConnect) {
          const pending = awaitingConnect
          awaitingConnect = null
          onError({
            code: 'timeout',
            message: mapSttWsCodeToMessage('timeout')
          })
          cleanupSocketSoft()
          setClientState('idle')
          pending.reject(new Error('timeout'))
        }
      }, 15000)

      try {
        socket = new WebSocket(wsUrl)
      } catch (connectError) {
        clearConnectTimeout()
        awaitingConnect = null
        setClientState('idle')
        const message =
          connectError?.message || mapSttWsCodeToMessage('network')
        onError({ code: 'network', message })
        reject(connectError)
        return
      }

      attachSocketHandlers()

      socket.onopen = () => {
        // 等待首包 ready，由 onmessage 触发 resolve
      }
    })
  }

  /**
   * 发送 start 并等待 started
   * @returns {Promise<void>}
   */
  function start() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      const error = new Error('socket_not_open')
      onError({
        code: 'network',
        message: '实时语音识别未连接，请重试'
      })
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      awaitingStarted = { resolve, reject }
      startedTimeoutId = setTimeout(() => {
        startedTimeoutId = null
        if (awaitingStarted) {
          const pending = awaitingStarted
          awaitingStarted = null
          const message = '等待语音识别就绪超时，请重试'
          onError({ code: 'timeout', message })
          pending.reject(new Error('started_timeout'))
        }
      }, 15000)
      try {
        lastSttPartialText = ''
        stopRoundGotServerFinal = false
        awaitingStopFinal = false
        socket.send(JSON.stringify({ type: 'start' }))
      } catch (sendError) {
        clearStartedTimeout()
        awaitingStarted = null
        reject(sendError)
      }
    })
  }

  /**
   * 发送一帧 PCM base64（与后端 encoding=raw 一致）
   * @param {string} base64Pcm
   */
  function sendAudioChunk(base64Pcm) {
    if (
      !socket
      || socket.readyState !== WebSocket.OPEN
      || clientState !== 'started'
    ) {
      return
    }
    if (!base64Pcm) return
    try {
      socket.send(JSON.stringify({ type: 'audio', data: base64Pcm }))
    } catch {
      onError({
        code: 'network',
        message: '发送语音数据失败，请检查网络后重试'
      })
    }
  }

  /**
   * 发送 stop 并等待 final（或超时收尾）
   * @returns {Promise<void>}
   */
  function stop() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (awaitingStopFinal) {
        finalizeStopRoundWithFallback()
      }
      setClientState('idle')
      return Promise.resolve()
    }
    awaitingStopFinal = true
    stopRoundGotServerFinal = false
    setClientState('stopping')
    return new Promise((resolve) => {
      awaitingFinal = { resolve }
      finalTimeoutId = setTimeout(() => {
        finalTimeoutId = null
        finalizeStopRoundWithFallback()
        setClientState('idle')
        resolveAwaitingFinal()
      }, STT_CLIENT_FINAL_WAIT_MS)
      try {
        socket.send(JSON.stringify({ type: 'stop' }))
      } catch {
        finalizeStopRoundWithFallback()
        setClientState('idle')
        resolveAwaitingFinal()
      }
    })
  }

  /** 关闭连接（用户取消或组件卸载） */
  function close() {
    clearConnectTimeout()
    clearStartedTimeout()
    clearFinalTimeout()
    awaitingConnect = null
    awaitingStarted = null
    awaitingFinal = null
    awaitingStopFinal = false
    stopRoundGotServerFinal = false
    cleanupSocketSoft()
    setClientState('idle')
  }

  return {
    connect,
    start,
    sendAudioChunk,
    stop,
    close,
    getState
  }
}

/**
 * 在线 TTS：服务端转发合成语音
 * @param {string} text
 * @param {Object} [options]
 * @param {string} [options.voice]
 * @param {number} [options.speed]
 * @param {number} [options.volume]
 * @param {number} [options.pitch]
 * @param {string} [options.aue] 输出编码（由后端/上游决定）
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Blob>}
 */
export async function synthesizeTts(text, options = {}) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${BASE_URL}/api/voice/tts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text,
      voice: options.voice,
      speed: options.speed,
      volume: options.volume,
      pitch: options.pitch,
      aue: options.aue
    }),
    signal: options.signal
  })

  if (!response.ok) {
    let message = `TTS 失败 (HTTP ${response.status})`
    try {
      const body = await response.json()
      if (body?.message) message = String(body.message)
    } catch {
      // ignore
    }
    throw new Error(message)
  }

  return await response.blob()
}

/**
 * 短音频整段转写：multipart/form-data，字段名 audio（WAV 16kHz 单声道 16bit）。
 * **非实时链路**：用于补转写、回放等；实时听写请用 {@link createSttStreamClient}（/ws/stt）。
 * @param {Blob} audioBlob
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ text: string, durationMs: number, safety: { riskLevel: string, hitRules: string[], safeReplyMode: boolean } }>}
 */
export async function transcribeShortAudio(audioBlob, options = {}) {
  const token = getToken()
  const formData = new FormData()
  formData.append('audio', audioBlob, 'speech.wav')

  const headers = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${BASE_URL}/api/voice/stt`, {
    method: 'POST',
    headers,
    body: formData,
    signal: options.signal
  })

  let body = {}
  try {
    body = await response.json()
  } catch {
    body = {}
  }

  if (!response.ok) {
    const message =
      typeof body.message === 'string' ? body.message : `STT 失败 (HTTP ${response.status})`
    throw new Error(message)
  }
  if (body.code !== 200) {
    throw new Error(typeof body.message === 'string' ? body.message : 'STT 失败')
  }
  const text = body.data && typeof body.data.text === 'string' ? body.data.text : ''
  const durationMs =
    body.data && Number.isFinite(Number(body.data.durationMs))
      ? Number(body.data.durationMs)
      : 0
  const rawSafety = body.data?.safety
  const safety =
    rawSafety && typeof rawSafety === 'object'
      ? {
          riskLevel: rawSafety.riskLevel === 'high' ? 'high' : 'none',
          hitRules: Array.isArray(rawSafety.hitRules) ? rawSafety.hitRules : [],
          safeReplyMode: Boolean(rawSafety.safeReplyMode)
        }
      : { riskLevel: 'none', hitRules: [], safeReplyMode: false }
  return { text, durationMs, safety }
}
