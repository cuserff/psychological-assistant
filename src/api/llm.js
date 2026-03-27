import { sendChatRequest, parseSSELine, parseStreamDataPayload } from './chat'
import { BASE_URL, resolveUploadUrl } from './config'

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

## ⚠️ 安全与紧急转介（发往模型服务时请避免出现可被机审误判的用户原话式示例）

当用户透露出**可能危及自身或他人身心安全**、或**情绪处于紧急崩溃**等情形时，你应**优先于一般聊天**做简短、稳妥的回应：

1. **真诚表达关切**，承认对方处境沉重，避免否定或轻描淡写。  
2. **说明边界**：线上助手不能代替精神科、急救或线下心理危机处置。  
3. **引导求助**：温和建议对方尽快联系**当地公开心理援助渠道、亲友陪同就医**；若判断可能涉及**立即的人身危险**，应明确建议拨打 **120** 或就近前往**医院急诊**，并鼓励向身边可信成人求助。

上述情形下**不要**继续讲故事、做游戏化闲聊或给出「再扛一扛就好」类表述；仍需保持语气稳定、避免危言耸听。

## 边界声明

- 你是 AI 心理健康助手，不是持证心理咨询师或医生。
- 你不能做出任何心理或精神疾病的诊断。
- 你不能开具药物处方或建议用药调整。
- 对于需要长期系统治疗的情况，应积极建议用户寻求线下专业心理咨询或精神科就诊。
- 对话内容仅用于当前交流，你应在适当时提醒用户保护自身隐私。`

/** 默认保留的最大对话轮数（1 轮 = 1 次用户提问 + 1 次助手回复） */
export const DEFAULT_MAX_ROUNDS = 5

/**
 * 是否在请求中内联图片为多模态 content（依赖模型与网关支持）。
 * .env 中设置 VITE_LLM_VISION=false 或 0 可关闭，仅发纯文本（Markdown 说明 + 链接提示）。
 */
export function isVisionEnabled() {
  if (typeof import.meta === 'undefined' || !import.meta.env) {
    return true
  }
  const raw = import.meta.env.VITE_LLM_VISION
  if (raw === undefined || raw === '') {
    return true
  }
  const normalized = String(raw).toLowerCase()
  return normalized !== 'false' && normalized !== '0' && normalized !== 'no'
}

/**
 * 单张图多模态内联 base64 最大字符数（与前端压缩上传后的 JPEG 体积匹配）。
 * 原 120000 过小，会导致几乎所有上传图被丢弃，模型只能回复「看不见图」。
 */
const MAX_IMAGE_DATA_URL_IN_PROMPT = 2_600_000

/**
 * 将过大的 JPEG data URL 通过缩放与降质量压到上限内（仍失败则返回空串）
 * @param {string} dataUrl
 * @param {number} maxLen
 * @returns {Promise<string>}
 */
function shrinkImageDataUrlToMaxLength(dataUrl, maxLen) {
  return new Promise((resolve, reject) => {
    if (dataUrl.length <= maxLen) {
      resolve(dataUrl)
      return
    }
    if (!dataUrl.startsWith('data:image/')) {
      resolve('')
      return
    }
    const imageElement = new Image()
    imageElement.onload = () => {
      void (async () => {
        try {
          let naturalWidth = imageElement.naturalWidth
          let naturalHeight = imageElement.naturalHeight
          let maxEdge = 1280
          let quality = 0.82
          let bestFit = ''

          for (let attempt = 0; attempt < 22; attempt++) {
            const longest = Math.max(naturalWidth, naturalHeight)
            const scale = longest > 0 ? Math.min(1, maxEdge / longest) : 1
            const targetWidth = Math.max(1, Math.round(naturalWidth * scale))
            const targetHeight = Math.max(1, Math.round(naturalHeight * scale))

            const canvas = document.createElement('canvas')
            canvas.width = targetWidth
            canvas.height = targetHeight
            const context = canvas.getContext('2d')
            if (!context) {
              resolve('')
              return
            }
            context.drawImage(imageElement, 0, 0, targetWidth, targetHeight)
            const jpegUrl = canvas.toDataURL('image/jpeg', quality)
            if (jpegUrl.length <= maxLen) {
              bestFit = jpegUrl
              break
            }
            bestFit = jpegUrl
            if (quality > 0.35) {
              quality -= 0.06
            } else {
              maxEdge = Math.max(280, Math.floor(maxEdge * 0.85))
            }
          }

          resolve(bestFit.length <= maxLen ? bestFit : '')
        } catch {
          resolve('')
        }
      })()
    }
    imageElement.onerror = () => reject(new Error('图像解码失败'))
    imageElement.src = dataUrl
  })
}

/** 相对路径转绝对 URL，供模型侧可能拉取（本地开发多为 localhost） */
function toAbsoluteImageRef(stored) {
  if (!stored || typeof stored !== 'string') return ''
  if (/^https?:\/\//i.test(stored) || stored.startsWith('data:')) return stored
  return `${BASE_URL}${stored.startsWith('/') ? '' : '/'}${stored}`
}

/**
 * Blob 转 data URL（供多模态接口 inline 传图）
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = () => reject(reader.error || new Error('read-blob-failed'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 将用户消息里的图片引用转为多模态接口可用的 url（多为 data:）
 * 云端无法访问 localhost / 内网相对路径，必须在浏览器侧拉取后内联为 base64。
 *
 * @param {string} imageRef
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>} data URL 或可公网访问的 https URL
 */
async function imageRefToVisionUrl(imageRef, signal) {
  if (!imageRef || typeof imageRef !== 'string') return ''

  if (imageRef.startsWith('data:')) {
    return imageRef.length <= MAX_IMAGE_DATA_URL_IN_PROMPT ? imageRef : ''
  }

  const isPublicHttps =
    /^https:\/\//i.test(imageRef)
    && !/localhost|127\.0\.0\.1/i.test(imageRef)

  if (isPublicHttps) {
    return imageRef
  }

  const fetchUrl = /^https?:\/\//i.test(imageRef)
    ? imageRef
    : resolveUploadUrl(imageRef)

  const response = await fetch(fetchUrl, { signal })
  if (!response.ok) {
    throw new Error(`图片拉取失败 (${response.status})`)
  }
  const blob = await response.blob()
  let dataUrl = await blobToDataUrl(blob)
  if (dataUrl.length > MAX_IMAGE_DATA_URL_IN_PROMPT) {
    try {
      dataUrl = await shrinkImageDataUrlToMaxLength(
        dataUrl,
        MAX_IMAGE_DATA_URL_IN_PROMPT
      )
    } catch {
      return ''
    }
  }
  if (!dataUrl || dataUrl.length > MAX_IMAGE_DATA_URL_IN_PROMPT) {
    return ''
  }
  return dataUrl
}

/**
 * 构建单条 user 消息的 content：无图为 string；有图为 OpenAI / 讯飞 MaaS 兼容的多模态数组。
 * @param {{ content?: string, images?: string[] }} message
 * @param {AbortSignal} [signal]
 * @returns {Promise<string|Array<{type: string, text?: string, image_url?: { url: string }}>>}
 */
async function formatUserContentForLlm(message, signal) {
  const text = (message.content || '').trim()
  const images = Array.isArray(message.images)
    ? message.images.filter((item) => typeof item === 'string' && item.length > 0)
    : []

  if (images.length === 0) {
    return text
  }

  /** @type {Array<{type: string, text?: string, image_url?: { url: string }}>} */
  const imageParts = []

  for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
    const imageRef = images[imageIndex]
    try {
      const urlForApi = await imageRefToVisionUrl(imageRef, signal)
      if (!urlForApi) {
        imageParts.push({
          type: 'text',
          text: `（图片 ${imageIndex + 1} 无法内联，原始引用：${toAbsoluteImageRef(imageRef)}）`
        })
        continue
      }
      imageParts.push({
        type: 'image_url',
        image_url: { url: urlForApi }
      })
    } catch {
      imageParts.push({
        type: 'text',
        text: `（图片 ${imageIndex + 1} 加载失败，路径：${toAbsoluteImageRef(imageRef)}）`
      })
    }
  }

  const instruction =
    '请结合上述图片的具体画面内容回应（如实描述你看到的、与用户情绪相关的部分），避免重复使用相同套话；若无法辨认细节，再温和请用户补充。'
  const textBlock = text
    ? `${text}\n\n${instruction}`
    : `（本条仅含图片，用户未输入额外文字。）\n${instruction}`

  // 视觉模型常见习惯：先图后文，便于对齐图像与后续提问
  return [
    ...imageParts,
    { type: 'text', text: textBlock }
  ]
}

/**
 * @param {Array<{role: string, content?: string, images?: string[]}>} allMessages
 * @param {number} maxRounds
 */
function filterAndSliceContext(allMessages, maxRounds) {
  const validMessages = allMessages.filter((message) => {
    if (!message || typeof message !== 'object') return false
    if (message.role !== 'user' && message.role !== 'assistant') {
      return false
    }
    if (message.role === 'assistant') {
      return Boolean(message.content?.trim())
    }
    const hasText = Boolean(message.content?.trim())
    const hasImages =
      Array.isArray(message.images) && message.images.length > 0
    return hasText || hasImages
  })

  let roundCount = 0
  let sliceStart = 0

  for (let messageIndex = validMessages.length - 1; messageIndex >= 0; messageIndex--) {
    if (validMessages[messageIndex].role === 'user') {
      roundCount += 1
      if (roundCount >= maxRounds) {
        sliceStart = messageIndex
        break
      }
    }
  }

  return validMessages.slice(sliceStart)
}

/**
 * 纯文本上下文（无多模态内联），兼容不支持图文格式的模型
 *
 * @param {Array<{role: string, content?: string, images?: string[]}>} allMessages
 * @param {Object} [options]
 * @returns {Array<{role: string, content: string}>}
 */
export function buildContextMessagesTextOnly(allMessages, options = {}) {
  const {
    maxRounds = DEFAULT_MAX_ROUNDS,
    systemPrompt = SYSTEM_PROMPT
  } = options

  const sliced = filterAndSliceContext(allMessages, maxRounds)
  const contextSlice = sliced.map((message) => {
    if (message.role === 'user') {
      return {
        role: 'user',
        content: formatUserMessageForApi(message)
      }
    }
    return { role: 'assistant', content: message?.content ?? '' }
  })

  const result = []
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }
  result.push(...contextSlice)
  return result
}

/**
 * 将 Store 中的用户消息（含可选图片：服务器相对路径 / URL / data URL）拼成发给模型的纯文本
 * @param {{ content?: string, images?: string[] }} message
 * @returns {string}
 */
export function formatUserMessageForApi(message) {
  const text = (message.content || '').trim()
  const images = Array.isArray(message.images)
    ? message.images.filter((item) => typeof item === 'string' && item.length > 0)
    : []

  const segments = []
  if (text) {
    segments.push(text)
  }
  if (images.length > 0) {
    segments.push(
      '【系统说明】用户上传了图片（下列可能含 Markdown 图链或较短 base64）。'
        + '纯文本模型或无法访问内网/本机链接时，你看不到真实画面，请勿假装已浏览图片；'
        + '请结合用户文字提问回应，并友善邀请用户用一两句话描述画面或想讨论的重点。'
    )
    images.forEach((imageRef, index) => {
      const absolute = toAbsoluteImageRef(imageRef)
      if (imageRef.startsWith('data:')) {
        if (absolute.length <= MAX_IMAGE_DATA_URL_IN_PROMPT) {
          segments.push(`![用户上传图片${index + 1}](${absolute})`)
        } else {
          segments.push(
            `（图片 ${index + 1} 数据过长未写入本次请求，用户界面仍可见原图。）`
          )
        }
      } else {
        segments.push(`![用户上传图片${index + 1}](${absolute})`)
      }
    })
  }
  return segments.join('\n\n')
}

// ==================== 上下文截取 ====================

/**
 * 从完整消息历史中截取最近 N 轮对话，并在头部拼接 system 提示词。
 *
 * 「轮」的定义：从末尾向前扫描，每遇到一条 role=user 的消息计为一轮。
 * 最终返回这些轮次以及它们之间的 assistant 回复。
 *
 * 含图用户消息会转为讯飞 MaaS 等多模态服务兼容的 content 数组（含内联 data URL），
 * 避免仅发 Markdown 链接导致云端无法访问 localhost 图片、模型只能「套话」回复。
 *
 * @param {Array<{role: string, content?: string, images?: string[]}>} allMessages  Store 中的完整消息列表
 * @param {Object}  [options]
 * @param {number}  [options.maxRounds=5]          保留的最大轮数
 * @param {string}  [options.systemPrompt]         系统提示词，传空字符串可禁用
 * @param {AbortSignal} [options.signal]           取消拉取图片内联时传入
 * @returns {Promise<Array<{role: string, content: string | unknown}>>} 可直接发给后端的 messages 数组
 */
export async function buildContextMessages(allMessages, options = {}) {
  if (!isVisionEnabled()) {
    return buildContextMessagesTextOnly(allMessages, options)
  }

  const {
    maxRounds = DEFAULT_MAX_ROUNDS,
    systemPrompt = SYSTEM_PROMPT,
    signal
  } = options

  const sliced = filterAndSliceContext(allMessages, maxRounds)

  const contextSlice = await Promise.all(
    sliced.map(async (message) => {
      if (message.role === 'user') {
        return {
          role: 'user',
          content: await formatUserContentForLlm(message, signal)
        }
      }
      return { role: 'assistant', content: message?.content ?? '' }
    })
  )

  const result = []
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }
  result.push(...contextSlice)

  return result
}

/**
 * @param {Array<{role: string, content?: unknown}>} messages
 * @returns {boolean}
 */
function contextHasMultimodalUserContent(messages) {
  return messages.some(
    (message) =>
      message.role === 'user' && Array.isArray(message.content)
  )
}

// ==================== SSE 流式调度 ====================

/**
 * 解析 SSE data 中的心理安全首包（非模型文本增量）
 * @param {string} payload
 * @param {(meta: Record<string, unknown>) => void} [onMentalHealthSafety]
 * @returns {boolean} 是否已消费为安全元数据（消费后不应再当作文本增量）
 */
function tryConsumeMentalHealthSafetyPayload(payload, onMentalHealthSafety) {
  if (typeof onMentalHealthSafety !== 'function') return false
  const trimmed = String(payload || '').trim()
  if (!trimmed || trimmed === '[DONE]') return false
  try {
    const parsed = JSON.parse(trimmed)
    const safetyBlock = parsed?.mental_health_safety
    if (safetyBlock && typeof safetyBlock === 'object') {
      onMentalHealthSafety(safetyBlock)
      return true
    }
  } catch {
    // 非 JSON：交回常规解析
  }
  return false
}

/**
 * 向后端大模型发送上下文，流式读取 SSE 回复。
 * 通过回调将增量文本交给调用方处理（Store / Composable）。
 *
 * @param {Array<{role: string, content: string | unknown}>} contextMessages  buildContextMessages 的输出
 * @param {Object}   callbacks
 * @param {function(string): void}  callbacks.onDelta    每收到一段增量文本时调用
 * @param {function(Record<string, unknown>): void} [callbacks.onMentalHealthSafety] SSE 首包心理安全元数据
 * @param {function(): void}        [callbacks.onComplete] 流正常结束时调用
 * @param {function(Error): void}   [callbacks.onError]    出错时调用（之后仍会 throw）
 * @param {Array<{role: string, content: string}>} [callbacks.fallbackContextMessages] 多模态被拒或网关报错时改发纯文本再试一轮
 * @returns {Promise<void>}
 */
export async function streamLLMResponse(
  contextMessages,
  {
    onDelta,
    onMentalHealthSafety,
    onComplete,
    onError,
    signal,
    fallbackContextMessages
  } = {}
) {
  let response = await sendChatRequest(contextMessages, { signal })

  if (
    !response.ok
    && Array.isArray(fallbackContextMessages)
    && fallbackContextMessages.length > 0
    && contextHasMultimodalUserContent(contextMessages)
  ) {
    response = await sendChatRequest(fallbackContextMessages, { signal })
  }

  if (!response.ok) {
    let detail = ''
    try {
      const raw = await response.text()
      if (raw) {
        detail = raw.length > 320 ? `${raw.slice(0, 320)}…` : raw
      }
    } catch {
      /* 忽略无法读取的响应体 */
    }
    const errorMsg = detail
      ? `LLM 请求失败 (HTTP ${response.status})：${detail}`
      : `LLM 请求失败 (HTTP ${response.status})`
    const error = new Error(errorMsg)
    onError?.(error)
    throw error
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  /**
   * 跨分包缓存；同时兼容 SSE 空行事件分隔（\\n\\n）与仅单行 \\n 结尾 upstream
   */
  let sseLineBuffer = ''

  /**
   * 处理一个 SSE 事件块（由 \\n\\n 分隔），合并多条 data: 行后再解析
   * @param {string} block
   */
  function consumeSseEventBlock(block) {
    const lines = block.replace(/\r/g, '').split('\n')
    const dataPayloads = []
    for (const rawLine of lines) {
      const trimmedStart = rawLine.trimStart()
      if (trimmedStart.startsWith('data:')) {
        dataPayloads.push(trimmedStart.slice(5).replace(/^\s*/, ''))
      }
    }
    const deltaPayloads = []
    for (const payload of dataPayloads) {
      if (!tryConsumeMentalHealthSafetyPayload(payload, onMentalHealthSafety)) {
        deltaPayloads.push(payload)
      }
    }
    if (deltaPayloads.length === 0) return
    if (deltaPayloads.length === 1) {
      const singleDelta = parseStreamDataPayload(deltaPayloads[0])
      if (singleDelta) onDelta(singleDelta)
      return
    }
    const mergedPayload = deltaPayloads.join('\n')
    let mergedDelta = parseStreamDataPayload(mergedPayload)
    if (mergedDelta) {
      onDelta(mergedDelta)
      return
    }
    for (const part of deltaPayloads) {
      const piece = parseStreamDataPayload(part)
      if (piece) onDelta(piece)
    }
  }

  /**
   * @param {string} fragment
   */
  function consumeSseText(fragment) {
    if (!fragment) return
    sseLineBuffer += fragment.replace(/\r\n/g, '\n')
    while (true) {
      const doubleNl = sseLineBuffer.indexOf('\n\n')
      if (doubleNl === -1) break
      const eventBlock = sseLineBuffer.slice(0, doubleNl)
      sseLineBuffer = sseLineBuffer.slice(doubleNl + 2)
      consumeSseEventBlock(eventBlock)
    }
    let newlineIndex
    while ((newlineIndex = sseLineBuffer.indexOf('\n')) !== -1) {
      const rawLine = sseLineBuffer.slice(0, newlineIndex)
      sseLineBuffer = sseLineBuffer.slice(newlineIndex + 1)
      const delta = parseSSELine(rawLine)
      if (delta) {
        onDelta(delta)
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      consumeSseText(chunk)
    }
    consumeSseText(decoder.decode())
    if (sseLineBuffer.trim().length > 0) {
      const tail = sseLineBuffer.replace(/\r$/, '')
      if (!tryConsumeMentalHealthSafetyPayload(tail, onMentalHealthSafety)) {
        let delta = parseSSELine(tail)
        if (!delta && tail.trimStart().startsWith('{')) {
          delta = parseStreamDataPayload(tail)
        }
        if (delta) {
          onDelta(delta)
        }
      }
    }
    onComplete?.()
  } catch (error) {
    // 用户主动停止时，避免抛出错误提示
    if (error?.name !== 'AbortError') {
      onError?.(error)
    }
    throw error
  }
}
