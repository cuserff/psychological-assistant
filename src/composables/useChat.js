import { useChatStore } from '../store/chatStore'
import {
  buildContextMessages,
  buildContextMessagesTextOnly,
  streamLLMResponse,
  isVisionEnabled,
  DEFAULT_MAX_ROUNDS
} from '../api/llm'
import { useTtsPlayer } from './useTtsPlayer'
import { recordLatencySample, recordErrorCode } from '../utils/chatObservability'

/**
 * 流式展示节奏（减轻「字蹦得太快」）：每隔若干毫秒往界面贴不超过指定字符数。
 * 在 .env.development 中可配：VITE_STREAM_REVEAL_MS、VITE_STREAM_CHARS_PER_TICK
 * 任一为 0 则关闭节流（与上游分包同速刷新，最省延迟）。
 */
function getStreamRevealConfig() {
  const rawInterval =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_STREAM_REVEAL_MS
  const rawChunk =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_STREAM_CHARS_PER_TICK
  const intervalMs =
    rawInterval !== undefined && rawInterval !== ''
      ? Number(rawInterval)
      : 36
  const charsPerTick =
    rawChunk !== undefined && rawChunk !== ''
      ? Number(rawChunk)
      : 2
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

/**
 * 聊天核心组合式函数
 *
 * 编排完整的「发送 → 上下文截取 → 流式接收 → 状态更新 → 持久化」流程。
 * View 层只需调用 sendMessage(content)，所有中间环节在此处闭环。
 *
 * @param {Object}  [options]
 * @param {number}  [options.maxRounds=5]      上下文保留的最大轮数
 * @param {string}  [options.systemPrompt]     自定义系统提示词（不传则用默认）
 * @returns {{
 *   sendMessage: (content: string, options?: { imageDataUrls?: string[] }) => Promise<void>,
 *   stopGeneration: () => void
 * }}
 */
export function useChat(options = {}) {
  const chatStore = useChatStore()
  const ttsPlayer = useTtsPlayer()
  const { maxRounds = DEFAULT_MAX_ROUNDS, systemPrompt } = options

  /** 停止流式生成并立即清空 TTS 队列与当前播放 */
  function stopGeneration() {
    chatStore.stopGeneration()
    ttsPlayer.stop()
    const session = chatStore.activeSession
    if (!session?.messages?.length) return
    const lastIdx = session.messages.length - 1
    if (session.messages[lastIdx]?.role === 'assistant') {
      chatStore.setAssistantVoiceStatus(lastIdx, 'none')
    }
  }

  /**
   * 发送一条用户消息并流式接收 LLM 回复
   * @param {string} content 用户输入文本（可与图片同时发）
   * @param {Object} [sendOptions]
   * @param {string[]} [sendOptions.imageDataUrls] 已压缩的图片 data URL
   * @param {boolean} [sendOptions.fromVoice] 是否来自麦克风说完即发（写入 user 消息 voiceInputChannel）
   * @throws {Error} 网络或 API 错误（由调用方 catch 处理 UI 提示）
   */
  async function sendMessage(content, sendOptions = {}) {
    const text = (content || '').trim()
    const imageDataUrls = Array.isArray(sendOptions.imageDataUrls)
      ? sendOptions.imageDataUrls.filter(
        (item) => typeof item === 'string' && item.length > 0
      )
      : []
    const fromVoiceInput = Boolean(sendOptions.fromVoice)

    if ((!text && imageDataUrls.length === 0) || chatStore.isGenerating) return

    // 新对话开始前停止旧一轮 TTS，避免与流式新回复叠播
    ttsPlayer.stop()

    // 1. 确保有活跃会话
    if (!chatStore.activeSession) {
      chatStore.createSession()
    }

    // 2. 将用户消息写入 Store
    chatStore.addUserMessage(content, {
      images: imageDataUrls,
      voiceInputChannel: fromVoiceInput ? 'mic' : undefined
    })

    // 3. 创建 assistant 占位消息，拿到索引
    const assistantMsgIndex = chatStore.createAssistantPlaceholder()

    // 4. 先占住生成态与 Abort，避免多图内联阶段重复发送
    chatStore.lastReplyAborted = false
    chatStore.isGenerating = true
    const abortController = new AbortController()
    chatStore.setCurrentAbortController(abortController)

    let aborted = false

    const revealConfig = getStreamRevealConfig()
    let pendingReveal = ''
    let revealTimerId = null

    function clearRevealTimer() {
      if (revealTimerId != null) {
        clearTimeout(revealTimerId)
        revealTimerId = null
      }
    }

    function flushAllPendingReveal() {
      if (pendingReveal.length > 0) {
        chatStore.appendAssistantDelta(assistantMsgIndex, pendingReveal)
        pendingReveal = ''
      }
    }

    function runRevealTick() {
      revealTimerId = null
      if (pendingReveal.length === 0) return
      const take = Math.min(revealConfig.charsPerTick, pendingReveal.length)
      chatStore.appendAssistantDelta(
        assistantMsgIndex,
        pendingReveal.slice(0, take)
      )
      pendingReveal = pendingReveal.slice(take)
      if (pendingReveal.length > 0) {
        revealTimerId = setTimeout(runRevealTick, revealConfig.intervalMs)
      }
    }

    function pushRevealDelta(delta) {
      if (!revealConfig.useThrottle) {
        chatStore.appendAssistantDelta(assistantMsgIndex, delta)
        return
      }
      pendingReveal += delta
      if (revealTimerId == null) {
        revealTimerId = setTimeout(runRevealTick, revealConfig.intervalMs)
      }
    }

    /** 上游流已结束，但打字队列可能仍很长：轮询直到吐完，避免 onComplete 里一次性 flush 造成「突然全文」 */
    function waitUntilRevealQueueEmpty() {
      return new Promise((resolve) => {
        const poll = () => {
          if (pendingReveal.length === 0 && revealTimerId == null) {
            resolve()
            return
          }
          setTimeout(poll, 20)
        }
        poll()
      })
    }

    try {
      // 5. 截取上下文并把历史中的图片内联为多模态 content（异步）
      const contextMessages = await buildContextMessages(
        chatStore.activeSession.messages,
        { maxRounds, systemPrompt, signal: abortController.signal }
      )

      const textOnlyFallback = isVisionEnabled()
        ? buildContextMessagesTextOnly(chatStore.activeSession.messages, {
          maxRounds,
          systemPrompt
        })
        : undefined

      const llmStreamT0 =
        typeof performance !== 'undefined' ? performance.now() : Date.now()
      let llmFirstTokenRecorded = false
      function onDeltaWithObs(delta) {
        if (
          !llmFirstTokenRecorded
          && delta
          && String(delta).replace(/\s/g, '').length > 0
        ) {
          llmFirstTokenRecorded = true
          const now =
            typeof performance !== 'undefined' ? performance.now() : Date.now()
          recordLatencySample('llmFirstTokenMs', Math.round(now - llmStreamT0))
        }
        pushRevealDelta(delta)
      }

      // 6. 流式请求；多模态不被当前模型支持时自动改发纯文本
      await streamLLMResponse(contextMessages, {
        fallbackContextMessages: textOnlyFallback,
        onDelta: onDeltaWithObs,
        onMentalHealthSafety: (meta) => chatStore.ingestMentalHealthSafety(meta),
        onComplete() {
          if (!revealConfig.useThrottle) return
          // 禁止在此处 flushAll：否则缓冲区内尚未展示的正文会一次性贴出
          if (pendingReveal.length > 0 && revealTimerId == null) {
            revealTimerId = setTimeout(runRevealTick, revealConfig.intervalMs)
          }
        },
        signal: abortController.signal
      })
      if (revealConfig.useThrottle) {
        await waitUntilRevealQueueEmpty()
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        aborted = true
      } else {
        const errLabel =
          typeof error?.message === 'string' && error.message
            ? error.message.slice(0, 64)
            : error?.name || 'unknown'
        recordErrorCode('llm', errLabel)
        throw error
      }
    } finally {
      clearRevealTimer()
      flushAllPendingReveal()
      chatStore.finalizeReply(assistantMsgIndex, { aborted })
      chatStore.isGenerating = false
      chatStore.clearCurrentAbortController()
    }
  }

  return { sendMessage, stopGeneration }
}
