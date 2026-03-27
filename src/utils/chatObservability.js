/**
 * 前端最小可观测：环形样本 + 错误计数，可落盘 localStorage（不含原文、无 PII）。
 * 由 Chat / useChat / useSpeech / useTtsPlayer 调用；聚合结果可在控制台或后续上报网关使用。
 */

const STORAGE_KEY = 'pa_chat_obs_v1'
const MAX_SAMPLES_PER_METRIC = 120

/** @type {Record<string, number[]>} */
const histograms = {
  sttFirstTextMs: [],
  sttFinalTextMs: [],
  llmFirstTokenMs: [],
  ttsFirstAudioMs: []
}

/** @type {Record<string, Record<string, number>>} */
const errorCounts = {
  stt: {},
  tts: {},
  llm: {}
}

let interruptAttempts = 0
let interruptSuccess = 0

/**
 * @param {boolean} hadRelevantWork 本次打断前是否存在生成/播报/听写等可被打断的状态
 * @param {boolean} settledOk 短延迟后生成已停且 TTS 队列已空（尽力判定，不含 STT 细粒度）
 */
export function recordInterruptResult(hadRelevantWork, settledOk) {
  if (!hadRelevantWork) return
  interruptAttempts += 1
  if (settledOk) interruptSuccess += 1
  persistDebounced()
}

/** 本轮后端 STT：用户端「结束拾音」时间戳（performance.now），用于首字延迟 */
let sttUtteranceEndPerfMs = 0
let sttFirstTextRecordedForRound = false

function trimHistogram(name) {
  const bucket = histograms[name]
  if (bucket && bucket.length > MAX_SAMPLES_PER_METRIC) {
    bucket.splice(0, bucket.length - MAX_SAMPLES_PER_METRIC)
  }
}

/**
 * @param {string} name
 * @param {number} valueMs
 */
export function recordLatencySample(name, valueMs) {
  if (typeof valueMs !== 'number' || !Number.isFinite(valueMs) || valueMs < 0 || valueMs > 600000) {
    return
  }
  if (!histograms[name]) histograms[name] = []
  histograms[name].push(Math.round(valueMs))
  trimHistogram(name)
  persistDebounced()
}

/**
 * @param {'stt'|'tts'|'llm'} category
 * @param {string} code
 */
export function recordErrorCode(category, code) {
  const key = String(code || 'unknown').slice(0, 64)
  if (!errorCounts[category]) errorCounts[category] = {}
  errorCounts[category][key] = (errorCounts[category][key] || 0) + 1
  persistDebounced()
}

/**
 * 一轮拾音结束（如 stopBackendListening 入口）调用，用于测量「停录 → 首字」
 */
export function markSttUtteranceEndedForMetrics() {
  sttUtteranceEndPerfMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
  sttFirstTextRecordedForRound = false
}

/**
 * 收到首个非空 partial/final 文本时调用（后端 WS）
 * @param {string} text
 */
export function maybeRecordSttFirstTextLatency(text) {
  if (sttFirstTextRecordedForRound || !sttUtteranceEndPerfMs) return
  const piece = String(text || '').trim()
  if (!piece) return
  sttFirstTextRecordedForRound = true
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  recordLatencySample('sttFirstTextMs', now - sttUtteranceEndPerfMs)
}

/**
 * 停录时刻到定稿（final）文本已有：若首字未记录，可记一条 final 延迟作兜底
 * @param {string} text
 */
export function maybeRecordSttFinalLatency(text) {
  if (!sttUtteranceEndPerfMs) return
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  recordLatencySample('sttFinalTextMs', now - sttUtteranceEndPerfMs)
}

export function resetSttUtteranceMark() {
  sttUtteranceEndPerfMs = 0
  sttFirstTextRecordedForRound = false
}

/** @returns {object} */
export function getClientObservabilitySnapshot() {
  return {
    histograms: { ...histograms },
    errorCounts: JSON.parse(JSON.stringify(errorCounts)),
    interrupt: {
      attempts: interruptAttempts,
      success: interruptSuccess,
      rate:
        interruptAttempts > 0
          ? Math.round((interruptSuccess / interruptAttempts) * 1000) / 1000
          : null
    },
    updatedAt: new Date().toISOString()
  }
}

let persistTimerId = null
function persistDebounced() {
  if (typeof localStorage === 'undefined') return
  if (persistTimerId != null) clearTimeout(persistTimerId)
  persistTimerId = setTimeout(() => {
    persistTimerId = null
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(getClientObservabilitySnapshot())
      )
    } catch {
      // ignore 隐私模式等
    }
  }, 500)
}

export function loadClientObservabilityFromStorage() {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (parsed.histograms && typeof parsed.histograms === 'object') {
      Object.assign(histograms, parsed.histograms)
    }
    if (parsed.errorCounts && typeof parsed.errorCounts === 'object') {
      Object.assign(errorCounts, parsed.errorCounts)
    }
    if (parsed.interrupt) {
      interruptAttempts = Number(parsed.interrupt.attempts) || 0
      interruptSuccess = Number(parsed.interrupt.success) || 0
    }
  } catch {
    // ignore
  }
}
