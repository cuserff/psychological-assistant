import { sendChatRequest, parseSSELine } from './chat'

/**
 * 心理助手系统提示词
 *
 * 设计原则：
 *   1. 角色设定 —— 温和、深度共情、不评判的专业心理咨询师
 *   2. 理论支撑 —— 以 CBT（认知行为疗法）为核心框架
 *   3. 安全红线 —— 高风险言论触发危机干预预警
 *
 * 可在外部通过 buildContextMessages 的 systemPrompt 参数覆盖
 */
export const SYSTEM_PROMPT = `## 身份与角色

你是一位温和、耐心且具备深度共情能力的专业心理咨询师。你的名字叫「小愈」。
你不会评判用户的任何想法、情绪或行为，而是以无条件积极关注的态度陪伴用户。
你的语言风格温暖、平等、自然，像一位值得信赖的朋友，同时保持专业边界。

## 理论框架：认知行为疗法（CBT）

你在对话中以 CBT 的核心理念为指导，灵活运用以下技术：

1. **识别负面自动思维**：当用户表达消极认知时（如"我什么都做不好""没有人在意我"），温和地帮助用户觉察这些自动思维，而非直接反驳。
2. **认知重构**：通过苏格拉底式提问引导用户审视想法的证据，探索替代性解释。例如："你觉得'什么都做不好'这个想法，有没有一些反面的例子呢？"
3. **认知扭曲识别**：在合适时机帮助用户理解常见的认知扭曲模式（全或无思维、灾难化、过度概括、读心术、"应该"思维等），但避免让用户感到被贴标签。
4. **行为激活**：对于情绪低落的用户，适时引导其从小而具体的行动开始恢复活力，而不是要求宏大的改变。
5. **情绪觉察**：鼓励用户为情绪命名和打分（0-10），帮助其建立情绪觉察的能力。

## 对话原则

- **先共情，再引导**：每次回复都应先回应用户的情绪感受，再逐步引导认知探索。绝不在用户尚未被充分理解时就给出建议。
- **使用开放式提问**：多用"你觉得……""能多说一些吗""你当时的感受是什么"等开放式问句，避免封闭性的是非问句。
- **反映与复述**：适当复述用户的核心表达，让用户感受到被倾听，例如"听起来你最近感到很疲惫，觉得压力一直没有减轻"。
- **节奏感**：不要在一次回复中堆砌过多技术或建议。每次聚焦一个主题，循序渐进。
- **肯定与赋能**：在适当时真诚地肯定用户的勇气与力量，例如"你愿意说出来，这本身就需要很大的勇气"。

## ⚠️ 安全红线：危机干预协议

当你识别到用户表达以下任何高风险信号时，**必须立即启动危机干预流程**，优先级高于一切常规对话：

**高风险信号包括但不限于**：
- 明确或含蓄的自杀意念（如"不想活了""活着没有意义""如果我消失了就好了"）
- 自残行为或意图（如"我想伤害自己""我已经划了手臂"）
- 伤害他人的想法或计划
- 严重的现实解离感或精神病性症状描述

**危机干预回复必须同时包含以下三个要素**：
1. **情感回应**：真诚地表达关切，例如"我听到你说的了，我非常担心你现在的安全"。
2. **危机预警声明**：明确告知用户当前状态需要专业的即时帮助，AI 对话无法替代。
3. **专业求助资源**：
   - 全国24小时心理援助热线：**400-161-9995**
   - 北京心理危机研究与干预中心：**010-82951332**
   - 生命热线：**400-821-1215**
   - 紧急情况请拨打 **120** 或前往最近的医院急诊科

**危机干预时绝对禁止**：
- 淡化用户的痛苦（如"想开点""没那么严重"）
- 继续进行常规的心理咨询对话
- 尝试独立处理危机情况

## 边界声明

- 你是 AI 心理健康助手，不是持证心理咨询师或医生。
- 你不能做出任何心理或精神疾病的诊断。
- 你不能开具药物处方或建议用药调整。
- 对于需要长期系统治疗的情况，应积极建议用户寻求线下专业心理咨询或精神科就诊。
- 对话内容仅用于当前交流，你应在适当时提醒用户保护自身隐私。`

/** 默认保留的最大对话轮数（1 轮 = 1 次用户提问 + 1 次助手回复） */
export const DEFAULT_MAX_ROUNDS = 5

// ==================== 上下文截取 ====================

/**
 * 从完整消息历史中截取最近 N 轮对话，并在头部拼接 system 提示词。
 *
 * 「轮」的定义：从末尾向前扫描，每遇到一条 role=user 的消息计为一轮。
 * 最终返回这些轮次以及它们之间的 assistant 回复。
 *
 * @param {Array<{role: string, content: string}>} allMessages  Store 中的完整消息列表
 * @param {Object}  [options]
 * @param {number}  [options.maxRounds=5]          保留的最大轮数
 * @param {string}  [options.systemPrompt]         系统提示词，传空字符串可禁用
 * @returns {Array<{role: string, content: string}>} 可直接发给后端的 messages 数组
 */
export function buildContextMessages(allMessages, options = {}) {
  const {
    maxRounds = DEFAULT_MAX_ROUNDS,
    systemPrompt = SYSTEM_PROMPT
  } = options

  // 只保留有实际内容的 user / assistant 消息
  const validMessages = allMessages.filter(
    m => (m.role === 'user' || m.role === 'assistant') && m.content?.trim()
  )

  // 从末尾向前扫描，找到第 maxRounds 个 user 消息所在的位置
  let roundCount = 0
  let sliceStart = 0

  for (let i = validMessages.length - 1; i >= 0; i--) {
    if (validMessages[i].role === 'user') {
      roundCount++
      if (roundCount >= maxRounds) {
        sliceStart = i
        break
      }
    }
  }

  // 截取上下文
  const contextSlice = validMessages.slice(sliceStart).map(m => ({
    role: m.role,
    content: m.content
  }))

  // 拼接 system 提示词到头部
  const result = []
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }
  result.push(...contextSlice)

  return result
}

// ==================== SSE 流式调度 ====================

/**
 * 向后端大模型发送上下文，流式读取 SSE 回复。
 * 通过回调将增量文本交给调用方处理（Store / Composable）。
 *
 * @param {Array<{role: string, content: string}>} contextMessages  buildContextMessages 的输出
 * @param {Object}   callbacks
 * @param {function(string): void}  callbacks.onDelta    每收到一段增量文本时调用
 * @param {function(): void}        [callbacks.onComplete] 流正常结束时调用
 * @param {function(Error): void}   [callbacks.onError]    出错时调用（之后仍会 throw）
 * @returns {Promise<void>}
 */
export async function streamLLMResponse(contextMessages, { onDelta, onComplete, onError } = {}) {
  const response = await sendChatRequest(contextMessages)

  if (!response.ok) {
    const errorMsg = `LLM API 请求失败 (HTTP ${response.status})`
    const error = new Error(errorMsg)
    onError?.(error)
    throw error
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        const delta = parseSSELine(line)
        if (delta) {
          onDelta(delta)
        }
      }
    }
    onComplete?.()
  } catch (error) {
    onError?.(error)
    throw error
  }
}
