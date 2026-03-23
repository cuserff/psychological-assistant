import { useChatStore } from '../store/chatStore'
import { buildContextMessages, streamLLMResponse, DEFAULT_MAX_ROUNDS } from '../api/llm'

/**
 * 聊天核心组合式函数
 *
 * 编排完整的「发送 → 上下文截取 → 流式接收 → 状态更新 → 持久化」流程。
 * View 层只需调用 sendMessage(content)，所有中间环节在此处闭环。
 *
 * @param {Object}  [options]
 * @param {number}  [options.maxRounds=5]      上下文保留的最大轮数
 * @param {string}  [options.systemPrompt]     自定义系统提示词（不传则用默认）
 * @returns {{ sendMessage: (content: string) => Promise<void> }}
 */
export function useChat(options = {}) {
  const chatStore = useChatStore()
  const { maxRounds = DEFAULT_MAX_ROUNDS, systemPrompt } = options

  /**
   * 发送一条用户消息并流式接收 LLM 回复
   * @param {string} content 用户输入文本
   * @throws {Error} 网络或 API 错误（由调用方 catch 处理 UI 提示）
   */
  async function sendMessage(content) {
    if (!content.trim() || chatStore.isGenerating) return

    // 1. 确保有活跃会话
    if (!chatStore.activeSession) {
      chatStore.createSession()
    }

    // 2. 将用户消息写入 Store
    chatStore.addUserMessage(content)

    // 3. 创建 assistant 占位消息，拿到索引
    const assistantMsgIndex = chatStore.createAssistantPlaceholder()

    // 4. 从当前会话完整消息中截取最近 N 轮上下文
    const contextMessages = buildContextMessages(
      chatStore.activeSession.messages,
      { maxRounds, systemPrompt }
    )

    // 5. 标记生成中
    chatStore.isGenerating = true

    try {
      // 6. 流式请求，增量文本通过回调写入 Store
      await streamLLMResponse(contextMessages, {
        onDelta(delta) {
          chatStore.appendAssistantDelta(assistantMsgIndex, delta)
        }
      })
    } finally {
      // 7. 无论成功或失败，收尾：补错误提示 + 持久化 + 解除生成锁
      chatStore.finalizeReply(assistantMsgIndex)
      chatStore.isGenerating = false
    }
  }

  return { sendMessage }
}
