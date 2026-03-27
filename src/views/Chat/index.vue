<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed } from 'vue'
import { useChatStore } from '../../store/chatStore'
import { useUserStore } from '../../store/userStore'
import { useChat } from '../../composables/useChat'
import { useTtsPlayer, TTS_MIN_SEGMENT_CHARS } from '../../composables/useTtsPlayer'
import { renderMarkdown } from '../../utils/markdown'
import { compressImageFileToBlob } from '../../utils/imageCompress'
import { resolveUploadUrl } from '../../api/config'
import { uploadChatImages } from '../../api/chat'
import VoiceRecorder from '../../components/input/VoiceRecorder.vue'
import { analyzeLocalPsychRiskText } from '../../utils/psychSafetyLocal'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Plus,
  Delete,
  ChatLineSquare,
  CloseBold
} from '@element-plus/icons-vue'
import {
  loadClientObservabilityFromStorage,
  getClientObservabilitySnapshot,
  recordInterruptResult
} from '../../utils/chatObservability'
import avatarBoy from '../../assets/images/avatar-boy.svg'
import avatarGirl from '../../assets/images/avatar-girl.svg'
// ?url：确保得到字符串 URL，供 img 使用（避免 .svg 在某些构建链下非常规导出）
import avatarAiCompanion from '../../assets/images/avatar-ai-companion.svg?url'

const chatStore = useChatStore()
const userStore = useUserStore()

const userAvatarMap = { boy: avatarBoy, girl: avatarGirl }
/** 与顶栏 / 个人中心一致的头像（用于聊天气泡旁） */
const userChatAvatarSrc = computed(
  () => userAvatarMap[userStore.avatar] || avatarGirl
)
const { sendMessage, stopGeneration: stopChatGeneration } = useChat()
const ttsPlayer = useTtsPlayer()

/** 高风险命中时语音播报固定温和模板（不朗读模型原文，减少二次暴露） */
const CRISIS_SAFE_TTS_TEXT =
  '谢谢你愿意说出来，你现在一定很不容易。我没办法代替身边的紧急与专业帮助，但你的安全非常重要。'
  + '如果感觉自己或他人可能面临紧急危险，请立即拨打一二零或一一零，或请亲友陪同前往医院急诊。'
  + '你也可以拨打一二三二零卫生健康热线，或一二三五五青少年服务台，了解你所在地的心理援助方式。'
  + '请尽量联系一位你信任的家人或朋友陪伴你，你不必独自面对。'

/** 心理安全顶栏：用户关闭后仅隐藏横幅，不改变已记录的扫描结果 */
const crisisBannerDismissed = ref(false)

const showCrisisSafetyBanner = computed(
  () =>
    !crisisBannerDismissed.value
    && chatStore.lastMentalHealthSafety?.riskLevel === 'high'
)

watch(
  () => chatStore.lastMentalHealthSafety,
  (meta) => {
    if (meta?.riskLevel === 'high') {
      crisisBannerDismissed.value = false
    }
  },
  { deep: true }
)

function dismissCrisisSafetyBanner() {
  crisisBannerDismissed.value = true
}

/** 后端短语音识别返回的 safety 与发消息路径统一写入 Store */
function handleSttResultDetail(detail) {
  const safety = detail?.safety
  if (safety && typeof safety === 'object') {
    chatStore.ingestMentalHealthSafety(safety)
  }
}

/** 语音会话总状态：供输入区旁提示 */
const voiceRecorderListening = ref(false)
/** STT 收尾：已停录、等待服务端 final */
const voiceRecognizing = ref(false)
/** 语音识别短时间错误态（与 TTS 无关） */
const voiceInputError = ref(false)
/** 录音中点击发送：先停录，待识别收尾后自动发送 */
const pendingSendAfterVoiceStop = ref(false)
/** 语音实时回填：开始录音前输入框基线文本 */
const voiceInputLiveBaseText = ref('')
/** 语音实时回填：最新识别文本（中间态/定稿） */
const voiceInputLiveText = ref('')
/** 语音实时回填是否激活 */
const isVoiceInputLiveActive = ref(false)
/** 胶囊麦克风 ref：统一打断时调用 interruptListening */
const voiceRecorderRef = ref(null)
/**
 * 实时听写首选后端 WS；连接/上游失败时自动降为浏览器 Speech API（同页内保持）
 */
const voiceSttEffectiveMode = ref('backend')

/**
 * 输入区「说完发送/仅回填」「播报开/关」胶囊：产品未就绪时隐藏，开发完成后改为 true
 */
const SHOW_VOICE_COMPOSER_CHIPS = false

/**
 * 是否开启「助手语音播报」：
 * - 默认关闭（避免第一次进入就突然出声）
 * - 按用户隔离存储
 * （须早于 voiceSessionPhase 计算属性，避免 TDZ）
 */
const voiceReplyEnabled = ref(false)
const voiceReplyStorageKey = computed(() => {
  const userId = userStore.userInfo?.id || 'anonymous'
  return `mental_health_voice_reply_on_${userId}`
})

/** 说完识别完成后是否自动发消息（否则仅回填输入框） */
const voiceAutoSendEnabled = ref(true)
const voiceAutoSendStorageKey = computed(() => {
  const userId = userStore.userInfo?.id || 'anonymous'
  return `mental_health_voice_auto_send_${userId}`
})

function loadVoiceReplySetting() {
  try {
    const raw = localStorage.getItem(voiceReplyStorageKey.value)
    voiceReplyEnabled.value = raw === '1'
  } catch {
    voiceReplyEnabled.value = false
  }
}

function persistVoiceReplySetting() {
  try {
    localStorage.setItem(voiceReplyStorageKey.value, voiceReplyEnabled.value ? '1' : '0')
  } catch {
    // ignore
  }
}

function loadVoiceAutoSendSetting() {
  try {
    const raw = localStorage.getItem(voiceAutoSendStorageKey.value)
    voiceAutoSendEnabled.value = raw !== '0'
  } catch {
    voiceAutoSendEnabled.value = true
  }
}

function persistVoiceAutoSendSetting() {
  try {
    localStorage.setItem(
      voiceAutoSendStorageKey.value,
      voiceAutoSendEnabled.value ? '1' : '0'
    )
  } catch {
    // ignore
  }
}

function getTailAssistantMessageIndex() {
  const list = chatStore.activeSession?.messages ?? []
  if (!list.length) return -1
  const lastIdx = list.length - 1
  return list[lastIdx].role === 'assistant' ? lastIdx : -1
}

/**
 * 语音链路：idle → listening → recognizing → generating → speaking（error 优先）
 */
const voiceSessionPhase = computed(() => {
  if (voiceInputError.value) return 'error'
  if (voiceRecognizing.value) return 'recognizing'
  if (voiceRecorderListening.value) return 'listening'
  if (chatStore.isGenerating) return 'generating'
  if (
    voiceReplyEnabled.value
    && (ttsPlayer.isPlaying.value || ttsPlayer.queuedCount.value > 0)
  ) {
    return 'speaking'
  }
  return 'idle'
})

watch(
  voiceSessionPhase,
  (phase) => {
    chatStore.setVoiceSessionPhase(phase)
  },
  { immediate: true }
)

watch(
  [voiceRecorderListening, voiceRecognizing],
  ([isListeningNow, isRecognizingNow]) => {
    if (!pendingSendAfterVoiceStop.value) return
    if (isListeningNow || isRecognizingNow) return
    pendingSendAfterVoiceStop.value = false
    void handleSend()
  }
)

const voiceSessionHint = computed(() => {
  const hints = {
    idle: '',
    listening: '聆听中…',
    recognizing: '识别中…',
    generating: '正在生成回复…',
    speaking: '语音播报中…',
    error: '语音识别出错，可重试麦克风'
  }
  return hints[voiceSessionPhase.value] || ''
})

function handleVoiceListeningChange(isListeningNow) {
  voiceRecorderListening.value = isListeningNow
  if (isListeningNow) {
    voiceInputError.value = false
    isVoiceInputLiveActive.value = true
    voiceInputLiveBaseText.value = inputMessage.value
    voiceInputLiveText.value = ''
    return
  }
  // 进入 recognizing 阶段时仍可能收到 final 文本，这里不立即关闭实时回填
}

function handleVoiceRecognizingChange(isRecognizingNow) {
  voiceRecognizing.value = isRecognizingNow
  if (!isRecognizingNow && !voiceRecorderListening.value && isVoiceInputLiveActive.value) {
    const hasVoiceText = String(voiceInputLiveText.value || '').trim().length > 0
    if (!hasVoiceText) {
      inputMessage.value = voiceInputLiveBaseText.value
    }
    isVoiceInputLiveActive.value = false
    voiceInputLiveText.value = ''
  }
}

/** 停止 LLM + 清空 TTS + 结束实时听写（再点麦克风或点「停止」时调用） */
function interruptVoiceAndAi() {
  const hadRelevantWork =
    chatStore.isGenerating
    || ttsPlayer.isPlaying.value
    || ttsPlayer.queuedCount.value > 0
    || voiceRecorderListening.value
    || voiceRecognizing.value

  stopChatGeneration()
  ttsPlayer.stop()
  voiceRecorderRef.value?.interruptListening?.()

  if (!hadRelevantWork) return

  nextTick(() => {
    requestAnimationFrame(() => {
      const settledOk =
        !chatStore.isGenerating
        && !ttsPlayer.isPlaying.value
        && ttsPlayer.queuedCount.value === 0
        && !voiceRecorderListening.value
        && !voiceRecognizing.value
      recordInterruptResult(true, settledOk)
    })
  })
}

function beforeVoiceStart() {
  interruptVoiceAndAi()
}

/** WS/STT 不可用时的降级码：不视为用户操作错误 */
const STT_FALLBACK_ERROR_CODES = new Set([
  'ws_error',
  'network',
  'timeout',
  'upstream_connect_failed',
  'upstream_connect_timeout',
  'upstream_error',
  'upstream_stt',
  'stt_not_configured',
  'upstream_closed',
  'invalid_token',
  'missing_token',
  'ws-start-failed',
  'stt-failed'
])

/**
 * @param {{ code?: string, message?: string }|undefined} errPayload
 */
function handleVoiceSpeechError(errPayload) {
  const errorCode = String(errPayload?.code || '')
  if (
    voiceSttEffectiveMode.value === 'backend'
    && STT_FALLBACK_ERROR_CODES.has(errorCode)
  ) {
    voiceSttEffectiveMode.value = 'browser'
    voiceInputError.value = false
    ElMessage.warning(
      '实时听写不可用，已切换为浏览器语音识别（效果因浏览器而异）'
    )
    return
  }
  voiceInputError.value = true
  if (isVoiceInputLiveActive.value) {
    // 出错时回滚到录音前的输入内容，避免残留半句中间态
    inputMessage.value = voiceInputLiveBaseText.value
  }
  isVoiceInputLiveActive.value = false
  voiceInputLiveText.value = ''
}

function composeVoiceLiveInput(baseText, liveText) {
  const cleanBase = String(baseText || '')
  const cleanLive = String(liveText || '').trim()
  if (!cleanLive) return cleanBase
  if (!cleanBase) return cleanLive
  if (/\s$/.test(cleanBase)) {
    return `${cleanBase}${cleanLive}`
  }
  return `${cleanBase} ${cleanLive}`
}

function handleVoiceTranscriptChange(text) {
  if (!isVoiceInputLiveActive.value) return
  voiceInputLiveText.value = String(text || '')
  inputMessage.value = composeVoiceLiveInput(
    voiceInputLiveBaseText.value,
    voiceInputLiveText.value
  )
}

/** 发送前本地高风险词提示，并与 Store 安全态对齐（流式首包仍会带服务端扫描） */
function applyLocalPsychRiskHintBeforeSend(plainText) {
  const trimmed = String(plainText || '').trim()
  if (!trimmed) return
  const localMeta = analyzeLocalPsychRiskText(trimmed)
  if (localMeta.riskLevel !== 'high') return
  chatStore.ingestMentalHealthSafety({
    riskLevel: 'high',
    hitRules: localMeta.hitRules,
    safeReplyMode: true
  })
  ElMessage({
    message:
      '检测到可能涉及自身或他人安全的表述。若你正处于危机中，请尽快联系身边亲友或拨打 120、110。',
    type: 'warning',
    duration: 8000,
    showClose: true
  })
}

/** 助手气泡下方：语音播报状态文案 */
function assistantVoiceStatusLabel(message) {
  if (message?.role !== 'assistant') return ''
  const status = message.voiceStatus
  if (!status || status === 'none') return ''
  const labels = {
    queued: '语音排队中',
    playing: '正在播报',
    failed: '语音播报失败'
  }
  return labels[status] || ''
}

/**
 * 流式阶段：末条助手消息一旦收到字符，隐藏底部「正在思考」，避免用户误以为没有逐字输出
 */
const hasStreamingAssistantText = computed(() => {
  if (!chatStore.isGenerating) {
    return false
  }
  const list = chatStore.activeSession?.messages ?? []
  const lastMessage = list[list.length - 1]
  return (
    lastMessage?.role === 'assistant'
    && String(lastMessage?.content ?? '').length > 0
  )
})

/**
 * 生成中且助手占位仍为空时不渲染空白气泡，只保留底部思考指示
 * @param {{ role: string, content?: string }} message
 */
function isMessageRowVisible(message) {
  if (
    message.role === 'assistant'
    && chatStore.isGenerating
    && !String(message.content ?? '').trim()
  ) {
    return false
  }
  return true
}

const inputMessage = ref('')
const chatContainer = ref(null)
const fileInputRef = ref(null)
/** 待发送的图片：后端返回的相对路径，如 /uploads/chat/{userId}/xxx.jpg */
const composerImageUrls = ref([])
/** 读取本地文件 / 上传图片中，避免重复点击 */
const isReadingFiles = ref(false)

/** 待发图片预览放大：与缩略图顺序一致的 URL 列表（el-image preview-src-list） */
const composerPreviewUrlList = computed(() =>
  composerImageUrls.value.map((urlRef) => displayImageUrl(urlRef))
)

/** 单条用户消息内的图片预览列表 */
function getMessageImagePreviewList(message) {
  if (!message?.images?.length) return []
  return message.images.map((ref) => displayImageUrl(ref))
}

/** 纯图片、无文字：用于去掉外层气泡，仅展示图片 */
function isUserImageOnlyMessage(message) {
  return Boolean(
    message?.role === 'user'
    && message.images?.length
    && !String(message.content || '').trim()
  )
}

/** 输入框内有文字或已选图片即可发送（不含「生成中」判断，由按钮另行禁用） */
const canSendComposer = computed(
  () =>
    Boolean(inputMessage.value.trim())
    || composerImageUrls.value.length > 0
)

/** 待发图片张数上限 */
const MAX_COMPOSER_IMAGES = 6
/** 原图最大体积（压缩前） */
const MAX_IMAGE_ORIGIN_BYTES = 8 * 1024 * 1024

/** 单文件写入输入框的最大字符数（过大易导致卡顿） */
const TEXT_FILE_MAX_CHARS = 32000
/** 单文件体积上限，超出则跳过（避免一次性读入过大） */
const MAX_FILE_BYTES = 2 * 1024 * 1024

const TEXT_FILE_EXTENSION_RE =
  /\.(txt|md|markdown|csv|json|log|yml|yaml|xml|html?|htm|rtf)$/i

const IMAGE_FILE_EXTENSION_RE =
  /\.(jpe?g|jpe|jfif|pjpeg|pjp|png|gif|webp|bmp|heic|heif|svg|tiff?)$/i

function isImageLikeFile(file) {
  if (!file) return false
  const mime = (file.type || '').toLowerCase()
  if (mime.startsWith('image/')) return true
  const name = file.name || ''
  if (IMAGE_FILE_EXTENSION_RE.test(name)) return true
  // Windows 等环境下常见：无类型或 application/octet-stream，需结合扩展名判断
  if (
    mime === 'application/octet-stream'
    || mime === 'binary/octet-stream'
    || mime === ''
  ) {
    return IMAGE_FILE_EXTENSION_RE.test(name)
  }
  return false
}

function isTextLikeFile(file) {
  const mime = file?.type || ''
  if (mime.startsWith('text/')) return true
  if (
    mime === 'application/json'
    || mime === 'application/xml'
    || mime === 'text/xml'
    || mime === 'application/javascript'
    || mime === 'text/javascript'
  ) {
    return true
  }
  const name = file?.name || ''
  return TEXT_FILE_EXTENSION_RE.test(name)
}

/** 去 BOM、统一换行，便于与模型对话 */
function stripBomAndNormalizeNewlines(text) {
  let result = text
  if (result.length > 0 && result.charCodeAt(0) === 0xfeff) {
    result = result.slice(1)
  }
  return result.replace(/\r\n/g, '\n')
}

/** 将文件按 UTF-8 读成字符串 */
function readFileAsUtf8Text(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = () => reject(new Error('read-failed'))
    reader.readAsText(file, 'UTF-8')
  })
}

/**
 * 压缩后上传图片，将返回的相对路径加入待发列表
 * @param {FileList|File[]} rawList
 */
async function uploadComposerImages(rawList) {
  const list = Array.from(rawList || []).filter(isImageLikeFile)
  if (list.length === 0 || chatStore.isGenerating) return

  const remainingSlots =
    MAX_COMPOSER_IMAGES - composerImageUrls.value.length
  if (remainingSlots <= 0) {
    ElMessage.warning(
      `最多添加 ${MAX_COMPOSER_IMAGES} 张图片，请先发送或删除缩略图`
    )
    return
  }

  isReadingFiles.value = true
  try {
    const toProcess = list.slice(0, remainingSlots)
    if (list.length > remainingSlots) {
      ElMessage.warning(`仅上传前 ${remainingSlots} 张图片`)
    }

    const uploadItems = []
    for (const file of toProcess) {
      if (file.size > MAX_IMAGE_ORIGIN_BYTES) {
        ElMessage.warning(`「${file.name}」超过 8MB，已跳过`)
        continue
      }
      try {
        const blob = await compressImageFileToBlob(file)
        const baseName = (file.name || 'image').replace(/\.[^.]+$/, '')
        uploadItems.push({ blob, name: `${baseName}.jpg` })
      } catch {
        ElMessage.warning(`「${file.name}」无法处理，已跳过`)
      }
    }

    if (uploadItems.length === 0) {
      return
    }

    const uploadedMeta = await uploadChatImages(uploadItems)
    let addedCount = 0
    for (const meta of uploadedMeta) {
      if (meta?.url) {
        composerImageUrls.value.push(meta.url)
        addedCount += 1
      }
    }

    if (addedCount > 0) {
      ElMessage.success(`已上传 ${addedCount} 张图片，可补充文字后发送`)
    } else if (uploadItems.length > 0) {
      ElMessage.warning('上传未返回可用的图片地址，请检查登录状态或稍后重试')
    }
  } catch (error) {
    ElMessage.error(error?.message || '图片上传失败')
  } finally {
    isReadingFiles.value = false
  }
}

function removeComposerImage(index) {
  composerImageUrls.value.splice(index, 1)
}

/** 会话与预览：相对上传路径需拼 API 基址；历史 data URL / 绝对链保持不变 */
function displayImageUrl(imageRef) {
  if (!imageRef || typeof imageRef !== 'string') {
    return ''
  }
  if (
    imageRef.startsWith('data:')
    || imageRef.startsWith('http://')
    || imageRef.startsWith('https://')
  ) {
    return imageRef
  }
  return resolveUploadUrl(imageRef)
}

async function ingestTextFiles(rawList) {
  const list = Array.from(rawList || []).filter(Boolean)
  if (list.length === 0 || chatStore.isGenerating) return

  const accepted = []
  for (const file of list) {
    if (isImageLikeFile(file)) continue
    if (!isTextLikeFile(file)) {
      continue
    }
    if (file.size > MAX_FILE_BYTES) {
      ElMessage.warning(`「${file.name}」超过 2MB，已跳过`)
      continue
    }
    accepted.push(file)
  }

  if (accepted.length === 0) {
    const hadOnlyImages = list.every(isImageLikeFile)
    if (!hadOnlyImages) {
      ElMessage.warning(
        '未识别到可导入的文本文件（如 .txt、.md、.json、.csv 等；单文件 ≤ 2MB）'
      )
    }
    return
  }

  isReadingFiles.value = true
  try {
    const segments = []
    let approxChars = 0

    for (let fileIndex = 0; fileIndex < accepted.length; fileIndex++) {
      const file = accepted[fileIndex]
      let text = await readFileAsUtf8Text(file)
      text = stripBomAndNormalizeNewlines(text)

      if (!text.trim()) {
        ElMessage.warning(`「${file.name}」内容为空，已跳过`)
        continue
      }

      let piece = text
      if (piece.length > TEXT_FILE_MAX_CHARS) {
        piece = piece.slice(0, TEXT_FILE_MAX_CHARS)
        ElMessage.warning(`「${file.name}」过长，已截取前 ${TEXT_FILE_MAX_CHARS} 字`)
      }

      const divider =
        fileIndex > 0 ? `\n\n【附件：${file.name}】\n` : ''
      segments.push(divider + piece)
      approxChars += piece.length
    }

    if (segments.length === 0) {
      ElMessage.warning('所选文件均无有效文本内容')
      return
    }

    const merged = segments.join('').replace(/^\n+/, '')
    const trimmedInput = inputMessage.value.trimEnd()
    const prefix = trimmedInput ? `${trimmedInput}\n\n` : ''
    inputMessage.value = prefix + merged

    if (accepted.length > 1 || segments.length > 1) {
      ElMessage.success(`已合并插入 ${segments.length} 个文件（约 ${approxChars} 字）`)
    } else {
      ElMessage.success(`已插入「${accepted[0].name}」（约 ${merged.length} 字）`)
    }
  } catch {
    ElMessage.error('读取文件失败，请重试')
  } finally {
    isReadingFiles.value = false
  }
}

onMounted(() => {
  loadClientObservabilityFromStorage()
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__PA_OBS__ = getClientObservabilitySnapshot
  }
  /**
   * 生成中勿覆盖本地会话：否则占位消息与流式索引错位，会触发 message.content 空指针。
   * 等 isGenerating 结束后再由用户切换页面或刷新触发同步即可。
   */
  if (!chatStore.isGenerating) {
    chatStore.loadSessions()
  }
  scrollToBottom()
  loadVoiceReplySetting()
  loadVoiceAutoSendSetting()
})

/** 离开对话页即中止流式请求，避免后台空跑；useChat 的 finally 会收尾占位文案与 isGenerating */
onBeforeUnmount(() => {
  interruptVoiceAndAi()
})

// userInfo 异步到达后重新加载当前用户的会话数据（页面刷新场景）
watch(
  () => userStore.userInfo?.id,
  (userId) => {
    voiceSttEffectiveMode.value = 'backend'
    if (userId && !chatStore.isGenerating) {
      chatStore.loadSessions()
      scrollToBottom()
    }
    loadVoiceReplySetting()
    loadVoiceAutoSendSetting()
  }
)

watch(voiceAutoSendEnabled, () => {
  persistVoiceAutoSendSetting()
})

watch(voiceReplyEnabled, () => {
  persistVoiceReplySetting()
  if (!voiceReplyEnabled.value) {
    ttsPlayer.stop()
    const tailIdx = getTailAssistantMessageIndex()
    if (tailIdx >= 0) {
      chatStore.setAssistantVoiceStatus(tailIdx, 'none')
    }
  }
})

/** TTS 多条分片连续失败时合并提示，避免打断阅读正文 */
let lastTtsUserWarnAt = 0
watch(
  () => ttsPlayer.lastError.value,
  (err) => {
    if (!err) return
    const now = Date.now()
    if (now - lastTtsUserWarnAt > 8000) {
      lastTtsUserWarnAt = now
      ElMessage.warning(
        err?.message || '语音播报失败，文本回复不受影响'
      )
    }
    if (voiceReplyEnabled.value) {
      const tailIdx = getTailAssistantMessageIndex()
      if (tailIdx >= 0) {
        chatStore.setAssistantVoiceStatus(tailIdx, 'failed')
      }
    }
  }
)

watch(
  [
    () => ttsPlayer.isPlaying.value,
    () => ttsPlayer.queuedCount.value,
    voiceReplyEnabled
  ],
  () => {
    const tailIdx = getTailAssistantMessageIndex()
    if (tailIdx < 0) return
    if (!voiceReplyEnabled.value) {
      chatStore.setAssistantVoiceStatus(tailIdx, 'none')
      return
    }
    if (ttsPlayer.isPlaying.value) {
      chatStore.setAssistantVoiceStatus(tailIdx, 'playing')
    } else if (ttsPlayer.queuedCount.value > 0) {
      chatStore.setAssistantVoiceStatus(tailIdx, 'queued')
    } else {
      chatStore.setAssistantVoiceStatus(tailIdx, 'none')
    }
  }
)

// ==================== 流式文本 → 逐句触发在线 TTS ====================
const lastAssistantSpokenLen = ref(0)
const pendingSpeakBuffer = ref('')

function splitSpeakableSegments(bufferText) {
  // 按句末标点与换行切分；短于 TTS_MIN_SEGMENT_CHARS 的与前后合并后再播，避免零碎断句
  const text = String(bufferText || '')
  const segments = []
  let startIndex = 0
  let carryShort = ''
  for (let index = 0; index < text.length; index++) {
    const ch = text[index]
    const isSentenceEnd =
      ch === '。' || ch === '！' || ch === '？' || ch === '；' || ch === '\n'
    if (!isSentenceEnd) continue
    const piece = text.slice(startIndex, index + 1).trim()
    startIndex = index + 1
    if (!piece) continue
    const merged = carryShort + piece
    if (merged.length >= TTS_MIN_SEGMENT_CHARS) {
      segments.push(merged)
      carryShort = ''
    } else {
      carryShort = merged
    }
  }
  const rest = carryShort + text.slice(startIndex)
  return { segments, rest }
}

watch(
  () => {
    const list = chatStore.activeSession?.messages
    if (!Array.isArray(list) || list.length === 0) return ''
    const lastMessage = list[list.length - 1]
    return lastMessage?.role === 'assistant'
      ? String(lastMessage.content ?? '')
      : ''
  },
  (assistantText) => {
    if (!voiceReplyEnabled.value) return
    if (chatStore.crisisSafeTtsForNextAssistant) return
    if (!assistantText) return

    const newDelta = assistantText.slice(lastAssistantSpokenLen.value)
    if (!newDelta) return
    lastAssistantSpokenLen.value = assistantText.length

    pendingSpeakBuffer.value += newDelta
    const { segments, rest } = splitSpeakableSegments(pendingSpeakBuffer.value)
    pendingSpeakBuffer.value = rest

    for (const seg of segments) {
      ttsPlayer.enqueue(seg)
    }
  }
)

watch(
  () => chatStore.isGenerating,
  (generating) => {
    if (generating) {
      // 新一轮开始：重置游标与缓冲
      lastAssistantSpokenLen.value = 0
      pendingSpeakBuffer.value = ''
      return
    }
    // 用户点了「停止」时不应再把缓冲尾巴送入 TTS
    if (chatStore.lastReplyAborted) {
      pendingSpeakBuffer.value = ''
      return
    }
    // 高风险：流式阶段已跳过句级 TTS，结束时仅播固定温和模板（若用户关闭了语音则只清标记）
    if (chatStore.crisisSafeTtsForNextAssistant) {
      pendingSpeakBuffer.value = ''
      lastAssistantSpokenLen.value = 0
      if (voiceReplyEnabled.value) {
        ttsPlayer.enqueue(CRISIS_SAFE_TTS_TEXT)
      }
      chatStore.clearCrisisSafeTtsFlag()
      return
    }
    // 正常结束：剩余无句末标点的尾巴也播完
    if (voiceReplyEnabled.value && pendingSpeakBuffer.value.trim()) {
      ttsPlayer.enqueue(pendingSpeakBuffer.value)
      pendingSpeakBuffer.value = ''
    }
  }
)

watch(
  () => chatStore.activeMessages.length,
  () => scrollToBottom()
)

/** 流式追加字数时 length 不变，需监听末条内容才能自动滚到底部 */
watch(
  () => {
    const list = chatStore.activeSession?.messages
    if (!Array.isArray(list) || list.length === 0) return ''
    const lastMessage = list[list.length - 1]
    return lastMessage?.role === 'assistant'
      ? String(lastMessage.content ?? '')
      : ''
  },
  () => {
    if (chatStore.isGenerating) {
      scrollToBottom()
    }
  }
)

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}

function openFilePicker() {
  if (chatStore.isGenerating || isReadingFiles.value) return
  fileInputRef.value?.click()
}

async function handleFileChange(event) {
  const input = event.target
  // 必须先拷贝为数组再清空 input：FileList 与控件绑定，清空 value 后原引用会变空
  const pickedFiles = input?.files?.length
    ? Array.from(input.files)
    : []
  if (input) input.value = ''
  if (pickedFiles.length === 0) return
  await processComposerPickedFiles(pickedFiles)
}

/**
 * 同一「+」入口：文本进输入框，图片走上传接口
 * @param {FileList|File[]} fileList
 */
async function processComposerPickedFiles(fileList) {
  const allFiles = Array.from(fileList || []).filter(Boolean)
  if (!allFiles.length || chatStore.isGenerating) return

  const imageFiles = allFiles.filter(isImageLikeFile)
  const textFiles = allFiles.filter((file) => !isImageLikeFile(file))

  if (imageFiles.length) {
    await uploadComposerImages(imageFiles)
  }
  if (textFiles.length) {
    await ingestTextFiles(textFiles)
  }
}

/** 将文本文件拖入胶囊条即可导入 */
function onComposerDragOver(event) {
  if (chatStore.isGenerating || isReadingFiles.value) return
  event.dataTransfer.dropEffect = 'copy'
}

async function onComposerDrop(event) {
  if (chatStore.isGenerating || isReadingFiles.value) return
  const dataTransfer = event.dataTransfer
  if (!dataTransfer?.files?.length) return
  const droppedFiles = Array.from(dataTransfer.files)
  await processComposerPickedFiles(droppedFiles)
}

async function handleSend() {
  if (voiceRecorderListening.value || voiceRecognizing.value) {
    pendingSendAfterVoiceStop.value = true
    voiceRecorderRef.value?.interruptListening?.()
    ElMessage.info('已停止录音，正在发送...')
    return
  }

  const content = inputMessage.value
  const imagePayload = [...composerImageUrls.value]
  if (!canSendComposer.value || chatStore.isGenerating) return
  inputMessage.value = ''
  composerImageUrls.value = []

  // 无活跃会话时自动创建
  if (!chatStore.activeSession) {
    chatStore.createSession()
  }

  try {
    applyLocalPsychRiskHintBeforeSend(content)
    await sendMessage(content, { imageDataUrls: imagePayload })
  } catch (error) {
    ElMessage.error(error?.message || '获取 AI 回复失败，请稍后重试')
  } finally {
    scrollToBottom()
  }
}

function handleComposerEnter(event) {
  if (event.shiftKey) return
  event.preventDefault()
  handleSend()
}

function handleStop() {
  interruptVoiceAndAi()
  scrollToBottom()
}

// 快捷操作：自动创建会话并发送预设消息
async function handleQuickAction(text) {
  if (chatStore.isGenerating) return
  if (!chatStore.activeSession) {
    chatStore.createSession()
  }
  try {
    applyLocalPsychRiskHintBeforeSend(text)
    await sendMessage(text)
  } catch (error) {
    ElMessage.error(error?.message || '获取 AI 回复失败，请稍后重试')
  } finally {
    scrollToBottom()
  }
}

function handleNewSession() {
  // 不立即创建会话，只取消选中，显示欢迎页
  chatStore.activeSessionId = null
}

function handleSwitchSession(sessionId) {
  chatStore.switchSession(sessionId)
  scrollToBottom()
}

async function handleDeleteSession(sessionId) {
  try {
    await ElMessageBox.confirm('确定删除该对话？', '提示', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  chatStore.deleteSession(sessionId)
}

// 语音识别定稿：自动发送 或 仅回填输入框（由 voiceAutoSendEnabled 控制）
async function handleVoiceResult(text) {
  voiceInputError.value = false
  const piece = String(text || '').trim()
  if (!piece) return

  if (voiceAutoSendEnabled.value && !pendingSendAfterVoiceStop.value) {
    if (!chatStore.activeSession) {
      chatStore.createSession()
    }
    try {
      applyLocalPsychRiskHintBeforeSend(piece)
      await sendMessage(piece, { fromVoice: true })
    } catch (error) {
      ElMessage.error(error?.message || '获取 AI 回复失败，请稍后重试')
    } finally {
      isVoiceInputLiveActive.value = false
      voiceInputLiveText.value = ''
      scrollToBottom()
    }
    return
  }

  // 非自动发送：输入框内通常已是“基线 + 最新识别文本”，仅做一次兜底修正
  inputMessage.value = composeVoiceLiveInput(voiceInputLiveBaseText.value, piece)
  isVoiceInputLiveActive.value = false
  voiceInputLiveText.value = ''
}

function toggleVoiceAutoSend() {
  voiceAutoSendEnabled.value = !voiceAutoSendEnabled.value
  if (voiceAutoSendEnabled.value) {
    ElMessage.success('已开启：说完后自动发送')
  } else {
    ElMessage.info('已改为：仅回填到输入框')
  }
}

function toggleVoiceReply() {
  voiceReplyEnabled.value = !voiceReplyEnabled.value
  if (voiceReplyEnabled.value) {
    ElMessage.success('已开启助手语音播报')
  } else {
    ElMessage.info('已关闭助手语音播报')
  }
}

function formatTime(isoString) {
  const date = new Date(isoString)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  return isToday
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
</script>

<template>
  <div class="chat-page">
    <!-- 左侧：会话列表 -->
    <div class="session-panel">
      <div class="session-header">
        <span class="session-header-title">历史会话</span>
        <el-button :icon="Plus" size="small" type="primary" @click="handleNewSession">
          新对话
        </el-button>
      </div>

      <div class="session-list">
        <div
          v-for="session in chatStore.sessions"
          :key="session.id"
          :class="['session-item', { active: session.id === chatStore.activeSessionId }]"
          @click="handleSwitchSession(session.id)"
        >
          <div class="session-item-content">
            <el-icon class="session-icon"><ChatLineSquare /></el-icon>
            <span class="session-title-fade" :title="session.title">
              <span class="session-title-text">{{ session.title }}</span>
            </span>
          </div>
          <div class="session-item-meta">
            <span class="session-time">{{ formatTime(session.updatedAt) }}</span>
            <el-button
              class="session-delete"
              :icon="Delete"
              size="small"
              link
              type="danger"
              @click.stop="handleDeleteSession(session.id)"
            />
          </div>
        </div>

        <div v-if="chatStore.sessions.length === 0" class="session-empty">
          <p>暂无对话记录</p>
          <p>点击「新对话」开始</p>
        </div>
      </div>
    </div>

    <!-- 右侧：对话区 -->
    <div class="chat-container">
      <el-alert
        v-if="showCrisisSafetyBanner"
        type="warning"
        :closable="true"
        show-icon
        class="crisis-safety-banner"
        title="安全提示"
        @close="dismissCrisisSafetyBanner"
      >
        <p class="crisis-safety-line">
          若你或他人正面临<strong>紧急人身危险</strong>，请立即拨打
          <strong>110</strong>（治安）或 <strong>120</strong>（急救），或由亲友陪同前往就近医院急诊。
        </p>
        <p class="crisis-safety-line">
          心理支持可尝试：<strong>12320</strong>（卫生健康热线）、<strong>12355</strong>（青少年服务台），以及你信任的亲友、老师或单位同事。
        </p>
        <p class="crisis-safety-line crisis-safety-muted">
          本提示由系统自动触发，不能替代专业评估；语音播报在该场景下将改为温和固定话术。
        </p>
      </el-alert>
      <!-- 消息列表 -->
      <div class="chat-messages" ref="chatContainer">
        <div
          v-for="message in chatStore.activeMessages"
          v-show="isMessageRowVisible(message)"
          :key="message.id"
          :class="['message-item', message.role === 'assistant' ? 'ai-message' : 'user-message']"
        >
          <template v-if="message.role === 'assistant'">
            <div class="message-avatar message-avatar--ai" aria-hidden="true">
              <img
                :src="avatarAiCompanion"
                alt=""
                class="message-avatar-img message-avatar-img--ai"
              />
            </div>
            <div class="message-content-stack">
              <div
                class="message-content markdown-body"
                v-html="renderMarkdown(message.content)"
              />
              <div
                v-if="assistantVoiceStatusLabel(message)"
                class="assistant-voice-status"
              >
                {{ assistantVoiceStatusLabel(message) }}
              </div>
            </div>
          </template>
          <template v-else>
            <div
              :class="[
                'message-content',
                'user-message-stack',
                { 'user-message-stack--media-only': isUserImageOnlyMessage(message) }
              ]"
            >
              <div
                v-if="message.images?.length"
                class="user-message-images"
              >
                <el-image
                  v-for="(imageSrc, imageIndex) in message.images"
                  :key="imageIndex"
                  :src="displayImageUrl(imageSrc)"
                  :preview-src-list="getMessageImagePreviewList(message)"
                  :initial-index="imageIndex"
                  fit="cover"
                  preview-teleported
                  class="user-message-img-el"
                />
              </div>
              <div
                v-if="message.voiceInputChannel === 'mic'"
                class="user-voice-input-channel"
                aria-label="本条用户消息为语音输入"
              >
                语音输入
              </div>
              <div v-if="message.content?.trim()" class="user-message-text">
                {{ message.content }}
              </div>
            </div>
            <div class="message-avatar message-avatar--user" aria-hidden="true">
              <img
                :src="userChatAvatarSrc"
                alt=""
                class="message-avatar-img"
              />
            </div>
          </template>
        </div>

        <!-- 正在思考指示器 -->
        <div
          v-if="chatStore.isGenerating && !hasStreamingAssistantText"
          class="message-item ai-message"
        >
          <div class="message-avatar message-avatar--ai" aria-hidden="true">
            <img
              :src="avatarAiCompanion"
              alt=""
              class="message-avatar-img message-avatar-img--ai"
            />
          </div>
          <div class="message-content generating">
            <div class="typing-indicator">
              <div class="typing-dot"></div>
              <div class="typing-dot"></div>
              <div class="typing-dot"></div>
            </div>
            <span class="typing-text">正在思考...</span>
          </div>
        </div>

        <!-- 无活跃会话时的欢迎界面 -->
        <div v-if="!chatStore.activeSession" class="welcome-page">
          <div class="welcome-greeting">你好，{{ userStore.userInfo?.nickname || '朋友' }}</div>
          <div class="welcome-title">需要我为你做些什么？</div>
          <div class="quick-actions">
            <div class="quick-action-item" @click="handleQuickAction('我最近心情不太好，想找人聊聊')">
              <span class="quick-action-icon">💬</span>
              <span>心理咨询</span>
            </div>
            <div class="quick-action-item" @click="handleQuickAction('给我讲个轻松有趣的小故事，帮我放松一下')">
              <span class="quick-action-icon">☀️</span>
              <span>轻松一下</span>
            </div>
            <div class="quick-action-item" @click="handleQuickAction('我想记录一下今天的情绪和感受')">
              <span class="quick-action-icon">📝</span>
              <span>情绪记录</span>
            </div>
            <div class="quick-action-item" @click="handleQuickAction('带我做一次简短的正念冥想练习')">
              <span class="quick-action-icon">🧘</span>
              <span>正念冥想</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 输入区域：胶囊条（加号上传 / 输入 / 麦克风 / 发送） -->
      <div class="input-area">
        <input
          ref="fileInputRef"
          type="file"
          class="composer-file-input"
          multiple
          accept=".txt,.md,.markdown,.csv,.json,.log,.yml,.yaml,.xml,.html,.htm,.rtf,text/plain,text/markdown,text/csv,application/json,text/xml,application/xml,image/jpeg,image/png,image/gif,image/webp,image/bmp,image/svg+xml"
          @change="handleFileChange"
        />

        <!-- 待发图片：缩略图 + 删除；点击缩略图用 Element 预览放大 -->
        <div v-if="composerImageUrls.length > 0" class="composer-pending-block">
          <p class="composer-pending-hint">
            待发图片 {{ composerImageUrls.length }} 张 · 点击缩略图可放大预览
          </p>
          <div class="composer-image-preview-row">
            <div
              v-for="(previewSrc, previewIndex) in composerImageUrls"
              :key="previewIndex"
              class="composer-image-thumb-wrap"
            >
              <el-image
                :src="displayImageUrl(previewSrc)"
                :preview-src-list="composerPreviewUrlList"
                :initial-index="previewIndex"
                fit="cover"
                preview-teleported
                class="composer-image-thumb-el"
              />
              <button
                type="button"
                class="composer-image-remove"
                aria-label="移除该图"
                :disabled="chatStore.isGenerating"
                @click="removeComposerImage(previewIndex)"
              >
                <el-icon :size="12"><CloseBold /></el-icon>
              </button>
            </div>
          </div>
        </div>

        <p
          v-if="voiceSessionPhase !== 'idle'"
          class="voice-session-hint"
          role="status"
        >
          {{ voiceSessionHint }}
        </p>

        <div
          class="composer-pill"
          @dragover.prevent="onComposerDragOver"
          @drop.prevent="onComposerDrop"
        >
          <button
            type="button"
            class="composer-add-btn"
            aria-label="选择或拖入附件"
            title="点击选择：文本文件将插入输入框，图片将上传；也可拖入到此条"
            :disabled="chatStore.isGenerating || isReadingFiles"
            @click="openFilePicker"
          >
            <el-icon :size="20"><Plus /></el-icon>
          </button>

          <el-input
            v-model="inputMessage"
            class="composer-text"
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 6 }"
            resize="none"
            placeholder="有什么我能帮您的吗？"
            :disabled="chatStore.isGenerating"
            @keydown.enter="handleComposerEnter"
          />

          <div class="composer-trail">
            <VoiceRecorder
              ref="voiceRecorderRef"
              variant="pill"
              :stt-mode="voiceSttEffectiveMode"
              :disabled="isReadingFiles"
              :before-start-listening="beforeVoiceStart"
              :on-stt-result-detail="handleSttResultDetail"
              @result="handleVoiceResult"
              @listening-change="handleVoiceListeningChange"
              @recognizing-change="handleVoiceRecognizingChange"
              @speech-error="handleVoiceSpeechError"
              @transcript-change="handleVoiceTranscriptChange"
            />

            <button
              v-if="SHOW_VOICE_COMPOSER_CHIPS"
              type="button"
              class="composer-voice-reply-chip"
              :class="{ on: voiceAutoSendEnabled }"
              :disabled="false"
              title="开启：识别结束自动发消息；关闭：仅填入输入框"
              @click="toggleVoiceAutoSend"
            >
              {{ voiceAutoSendEnabled ? '说完发送' : '仅回填' }}
            </button>

            <button
              v-if="SHOW_VOICE_COMPOSER_CHIPS"
              type="button"
              class="composer-voice-reply-chip"
              :class="{ on: voiceReplyEnabled }"
              :disabled="false"
              @click="toggleVoiceReply"
            >
              播报{{ voiceReplyEnabled ? '开' : '关' }}
            </button>

            <button
              v-if="chatStore.isGenerating"
              type="button"
              class="composer-stop-chip"
              @click="handleStop"
            >
              停止
            </button>
            <button
              v-else
              type="button"
              class="composer-send-btn"
              :disabled="chatStore.isGenerating || !canSendComposer"
              aria-label="发送"
              @click="handleSend"
            >
              <!-- 粗直角端「>」形发送图标（描边，非填充三角） -->
              <svg
                class="composer-send-icon"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  class="composer-send-chevron"
                  d="M9 6.75L15.25 12L9 17.25"
                  fill="none"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* 引入 Markdown 样式（非 scoped，让 v-html 内容能命中） */
@import '../../assets/styles/markdown.css';
</style>

<style scoped>
.chat-page {
  display: flex;
  flex: 1 1 0%;
  min-height: 0;
  width: 100%;
  overflow: hidden;
  gap: 0;
  background-color: var(--app-color-bg-chat);
}

/* ==================== 会话列表面板 ==================== */

.session-panel {
  width: 260px;
  flex-shrink: 0;
  min-height: 0;
  background: var(--app-color-bg-elevated);
  border-right: 1px solid var(--app-color-border);
  display: flex;
  flex-direction: column;
}

.session-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--app-color-border);
}

.session-header-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-color-text);
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--app-color-text-muted) 45%, transparent)
    transparent;
}

.session-list::-webkit-scrollbar {
  width: 7px;
}

.session-list::-webkit-scrollbar-track {
  background: transparent;
}

.session-list::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--app-color-text) 18%, transparent);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.session-list::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--app-color-text) 28%, transparent);
  background-clip: padding-box;
}

.session-item {
  padding: 14px 14px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-bottom: 6px;
}

.session-item:hover {
  background-color: var(--app-color-fill-muted);
}

.session-item.active {
  background-color: var(--app-color-primary-muted);
}

.session-item-content {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.session-icon {
  color: var(--app-color-text-muted);
  flex-shrink: 0;
  font-size: 14px;
}

.session-item.active .session-icon {
  color: var(--app-color-primary);
}

.session-title-fade {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  mask-image: linear-gradient(to right, #000 0%, #000 72%, transparent 100%);
  -webkit-mask-image: linear-gradient(to right, #000 0%, #000 72%, transparent 100%);
}

.session-title-text {
  display: block;
  font-size: 13px;
  line-height: 1.35;
  color: var(--app-color-text-secondary);
  white-space: nowrap;
}

.session-item.active .session-title-text {
  color: var(--app-color-text);
}

.session-item-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 22px;
}

.session-time {
  font-size: 11px;
  color: var(--app-color-text-muted);
}

.session-delete {
  opacity: 0;
  transition: opacity 0.2s;
}

.session-item:hover .session-delete {
  opacity: 1;
}

.session-empty {
  text-align: center;
  padding: 40px 16px;
  color: var(--app-color-text-muted);
  font-size: 13px;
  line-height: 2;
}

/* ==================== 对话区 ==================== */

/* 除消息气泡外主区域白底（与用户气泡区分） */
.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: var(--app-color-bg-chat);
  min-width: 0;
  min-height: 0;
}

.crisis-safety-banner {
  flex-shrink: 0;
  margin: 12px 20px 0;
}

.crisis-safety-line {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.55;
}

.crisis-safety-line:last-child {
  margin-bottom: 0;
}

.crisis-safety-muted {
  color: var(--app-color-text-muted);
  font-size: 12px;
}

.chat-messages {
  flex: 1 1 0%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 20px;
  background-color: var(--app-color-bg-chat);
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--app-color-text-muted) 45%, transparent)
    transparent;
}

.chat-messages::-webkit-scrollbar {
  width: 7px;
}

.chat-messages::-webkit-scrollbar-track {
  background: transparent;
}

.chat-messages::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--app-color-text) 18%, transparent);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--app-color-text) 28%, transparent);
  background-clip: padding-box;
}

/* ==================== 欢迎界面 ==================== */

.welcome-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 12rem;
  gap: 12px;
  animation: fadeIn 0.5s ease-in;
}

.welcome-greeting {
  font-size: 16px;
  color: var(--app-color-text-secondary);
}

.welcome-title {
  font-size: 32px;
  font-weight: 600;
  color: var(--app-color-text);
  margin-bottom: 32px;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  max-width: 560px;
}

.quick-action-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background-color: var(--app-color-bg-elevated);
  border: 1px solid var(--app-color-border);
  border-radius: 24px;
  cursor: pointer;
  font-size: 14px;
  color: var(--app-color-text-secondary);
  transition: all 0.2s;
  user-select: none;
}

.quick-action-item:hover {
  background-color: var(--app-color-primary-soft-bg);
  border-color: var(--app-color-primary);
  color: var(--app-color-primary);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--app-color-primary) 20%, transparent);
}

.quick-action-icon {
  font-size: 18px;
}

.message-item {
  margin-bottom: 20px;
  display: flex;
  gap: 10px;
  align-items: flex-end;
  flex-shrink: 0;
  animation: fadeIn 0.3s ease-in;
}

/* 头像：侧旁小圆，增强对话的陪伴感 */
.message-avatar {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  overflow: hidden;
  border: 1px solid var(--app-color-border);
  background: var(--app-color-bg-elevated);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--app-color-text) 8%, transparent);
}

.message-avatar--ai {
  background: linear-gradient(160deg, #ecfdf5, #d1fae5);
  border-color: color-mix(in srgb, var(--app-color-primary) 35%, var(--app-color-border));
}

.message-avatar--user {
  border-color: color-mix(in srgb, var(--app-chat-user-bubble-text) 15%, var(--app-color-border));
}

.message-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.message-avatar-img--ai {
  object-fit: contain;
  padding: 5px;
  box-sizing: border-box;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

.generating {
  display: flex;
  align-items: center;
  gap: 12px;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding-top: 2px;
}

.typing-dot {
  width: 8px;
  height: 8px;
  background-color: var(--app-color-primary);
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out;
}

.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }

.typing-text {
  color: var(--app-color-text-muted);
  font-style: italic;
}

@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-10px); opacity: 1; }
}

.ai-message {
  justify-content: flex-start;
}

.user-message {
  justify-content: flex-end;
}

.message-content {
  max-width: var(--app-chat-bubble-max);
  padding: 14px 18px;
  border-radius: 18px;
  font-size: 15px;
  line-height: 1.7;
  letter-spacing: 0.5px;
  word-wrap: break-word;
}

/* 用户纯文字气泡保留 pre-wrap */
.user-message .message-content:not(.user-message-stack) {
  white-space: pre-wrap;
}

.ai-message .message-content {
  background-color: var(--app-color-bg-elevated);
  border: 1px solid var(--app-color-border);
  color: var(--app-color-text);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--app-color-text) 8%, transparent);
}

.ai-message .message-content-stack {
  max-width: var(--app-chat-bubble-max);
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.assistant-voice-status {
  font-size: 12px;
  line-height: 1.4;
  color: var(--app-color-text-muted);
  padding: 0 4px;
}

.voice-session-hint {
  max-width: 920px;
  margin: 0 auto 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--app-color-primary);
}

/* 用户气泡：低饱和柔和底 + 深色字；纯图消息由 --media-only 覆盖为无底 */
.user-message .message-content.user-message-stack {
  background-color: var(--app-chat-user-bubble-bg);
  color: var(--app-chat-user-bubble-text);
  border: 1px solid var(--app-chat-user-bubble-border);
  box-shadow: var(--app-chat-user-bubble-shadow);
}

.user-message-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.user-message-stack--media-only {
  padding: 0 !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  max-width: min(360px, 85%);
}

.user-message-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* el-image：聊天气泡内缩略尺寸，点击预览由 Element 处理 */
.user-message-img-el {
  width: min(220px, 100%);
  max-width: 100%;
  height: 200px;
  border-radius: 8px;
  cursor: zoom-in;
}

.user-message-img-el :deep(.el-image__inner) {
  border-radius: 8px;
  object-fit: cover;
}

/* 图文同在柔和气泡内时，图片与底色略有区分 */
.user-message-stack:not(.user-message-stack--media-only) .user-message-img-el {
  border: 1px solid var(--app-chat-user-bubble-border);
}

.user-message-stack--media-only .user-message-img-el {
  box-shadow: var(--app-chat-user-img-shadow);
}

.user-message-stack--media-only .user-message-img-el :deep(.el-image__inner) {
  border-radius: 8px;
}

.user-voice-input-channel {
  font-size: 12px;
  line-height: 1.4;
  color: color-mix(in srgb, var(--app-chat-user-bubble-text) 72%, transparent);
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 6px;
  background-color: color-mix(in srgb, var(--app-chat-user-bubble-text) 10%, transparent);
}

.user-message-text {
  white-space: pre-wrap;
  word-break: break-word;
}

/* ==================== 输入区（胶囊条） ==================== */

.composer-pending-block {
  max-width: 920px;
  margin: 0 auto 10px;
}

.composer-pending-hint {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--app-color-text-muted);
}

.composer-image-preview-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.composer-image-thumb-wrap {
  position: relative;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
}

.composer-image-thumb-el {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  cursor: zoom-in;
  border: 1px solid var(--app-color-border);
}

.composer-image-thumb-el :deep(.el-image__inner),
.composer-image-thumb-el :deep(img) {
  border-radius: 7px;
  object-fit: cover;
}

.composer-image-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--app-color-text);
  color: var(--app-color-bg-elevated);
  cursor: pointer;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--app-color-text) 35%, transparent);
}

.composer-image-remove:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.input-area {
  flex-shrink: 0;
  padding: 16px 20px 20px;
  background-color: var(--app-color-bg-chat);
  overflow: visible;
}

.composer-file-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.composer-pill {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 8px 10px 8px 8px;
  background: var(--app-color-fill-muted);
  border-radius: 26px;
  border: 1px solid var(--app-color-border);
  max-width: 920px;
  margin: 0 auto;
  overflow: visible;
  position: relative;
  z-index: 1;
}

.composer-add-btn {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--app-color-bg-elevated);
  color: var(--app-color-text);
  cursor: pointer;
  margin-bottom: 2px;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--app-color-text) 10%, transparent);
  transition: background 0.2s, color 0.2s;
}

.composer-add-btn:hover:not(:disabled) {
  background: var(--app-color-fill-muted);
  color: var(--app-color-primary);
}

.composer-add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.composer-text {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.composer-text :deep(.el-textarea__inner) {
  border: none;
  background: transparent;
  box-shadow: none;
  padding: 10px 4px 12px;
  font-size: 15px;
  line-height: 1.5;
  color: var(--app-color-text);
  resize: none;
}

.composer-text :deep(.el-textarea__inner):focus {
  box-shadow: none;
}

.composer-text :deep(.el-textarea__inner)::placeholder {
  color: var(--app-color-text-muted);
}

.composer-trail {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
  position: relative;
  z-index: 2;
}

/* 与麦克风同系：浅灰圆钮 + 深灰箭头；可发送时变主题色 */
.composer-send-btn {
  width: 40px;
  height: 40px;
  padding: 0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--app-el-border-light);
  cursor: pointer;
  transition: background 0.2s, transform 0.15s;
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--app-color-bg-elevated) 55%, transparent);
}

.composer-send-icon {
  display: block;
}

/* 粗折线 chevron，平头端点 */
.composer-send-chevron {
  fill: none !important;
  stroke: var(--app-color-text) !important;
  stroke-width: 3px;
  stroke-linecap: square;
  stroke-linejoin: miter;
}

.composer-send-btn:hover:not(:disabled) {
  background: var(--app-color-border-strong);
}

.composer-send-btn:hover:not(:disabled) .composer-send-chevron {
  stroke: var(--app-color-text) !important;
}

.composer-send-btn:not(:disabled) {
  background: var(--app-color-primary);
  box-shadow: none;
}

.composer-send-btn:not(:disabled) .composer-send-chevron {
  stroke: var(--app-color-on-primary) !important;
}

.composer-send-btn:not(:disabled):hover {
  background: var(--app-color-primary-hover);
}

.composer-send-btn:not(:disabled):active {
  transform: scale(0.96);
}

.composer-send-btn:disabled {
  cursor: not-allowed;
  opacity: 0.9;
}

.composer-send-btn:disabled .composer-send-chevron {
  stroke: var(--app-color-text-muted) !important;
}

.composer-stop-chip {
  padding: 8px 14px;
  border: none;
  border-radius: 20px;
  background: color-mix(in srgb, var(--el-color-danger) 16%, var(--app-color-bg-elevated));
  color: var(--el-color-danger);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.composer-stop-chip:hover {
  background: color-mix(in srgb, var(--el-color-danger) 28%, var(--app-color-bg-elevated));
}

.composer-voice-reply-chip {
  padding: 8px 12px;
  border: 1px solid var(--app-color-border);
  border-radius: 999px;
  background: var(--app-color-bg-elevated);
  color: var(--app-color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}

.composer-voice-reply-chip.on {
  border-color: color-mix(in srgb, var(--app-color-primary) 55%, var(--app-color-border));
  background: color-mix(in srgb, var(--app-color-primary) 12%, var(--app-color-bg-elevated));
  color: var(--app-color-primary);
}

.composer-voice-reply-chip:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
