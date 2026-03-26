import { useChatStore } from '../store/chatStore'
import {
  buildContextMessages,
  buildContextMessagesTextOnly,
  streamLLMResponse,
  isVisionEnabled,
  DEFAULT_MAX_ROUNDS
} from '../api/llm'

/**
 * 聊天核心组合式函数
 *
 * 编排完整的「发送 → 上下文截取 → 流式接收 → 状态更新 → 持久化」流程。
 * View 层只需调用 sendMessage(content)，所有中间环节在此处闭环。
 *
 * @param {Object}  [options]
 * @param {number}  [options.maxRounds=5]      上下文保留的最大轮数
 * @param {string}  [options.systemPrompt]     自定义系统提示词（不传则用默认）
 * @returns {{ sendMessage: (content: string, options?: { imageDataUrls?: string[] }) => Promise<void> }}
 */
export function useChat(options = {}) {
  const chatStore = useChatStore()
  const { maxRounds = DEFAULT_MAX_ROUNDS, systemPrompt } = options

  /**
   * 发送一条用户消息并流式接收 LLM 回复
   * @param {string} content 用户输入文本（可与图片同时发）
   * @param {Object} [sendOptions]
   * @param {string[]} [sendOptions.imageDataUrls] 已压缩的图片 data URL
   * @throws {Error} 网络或 API 错误（由调用方 catch 处理 UI 提示）
   */
  async function sendMessage(content, sendOptions = {}) {
    const text = (content || '').trim()
    const imageDataUrls = Array.isArray(sendOptions.imageDataUrls)
      ? sendOptions.imageDataUrls.filter(
        (item) => typeof item === 'string' && item.length > 0
      )
      : []

    if ((!text && imageDataUrls.length === 0) || chatStore.isGenerating) return

    // 1. 确保有活跃会话
    if (!chatStore.activeSession) {
      chatStore.createSession()
    }

    // 2. 将用户消息写入 Store
    chatStore.addUserMessage(content, { images: imageDataUrls })

    // 3. 创建 assistant 占位消息，拿到索引
    const assistantMsgIndex = chatStore.createAssistantPlaceholder()

    // 4. 先占住生成态与 Abort，避免多图内联阶段重复发送
    chatStore.isGenerating = true
    const abortController = new AbortController()
    chatStore.setCurrentAbortController(abortController)

    let aborted = false

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

      // 6. 流式请求；多模态不被当前模型支持时自动改发纯文本
      await streamLLMResponse(contextMessages, {
        fallbackContextMessages: textOnlyFallback,
        onDelta(delta) {
          chatStore.appendAssistantDelta(assistantMsgIndex, delta)
        },
        signal: abortController.signal
      })
    } catch (error) {
      if (error?.name === 'AbortError') {
        aborted = true
      } else {
        throw error
      }
    } finally {
      chatStore.finalizeReply(assistantMsgIndex, { aborted })
      chatStore.isGenerating = false
      chatStore.clearCurrentAbortController()
    }
  }

  return { sendMessage }
}
