<script setup>
/**
 * 语音通话页：上区流沙+状态、中区滚动字幕、下区控制；
 * 进入后按住麦克风 STT，松开发送；按住前打断 TTS/生成。
 *
 * 隐私约定：麦克风音频仅在内存中识别、不落盘；本页不做通话录音持久化。
 */
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import {
  ArrowLeft,
  Microphone,
  VideoPause,
  Headset,
  SwitchButton
} from '@element-plus/icons-vue'
import avatarAiCompanion from '../../assets/images/avatar-ai-companion.svg?url'
import { useChatStore } from '../../store/chatStore'
import { useChat } from '../../composables/useChat'
import { useSpeech } from '../../composables/useSpeech'
import { useTtsPlayer } from '../../composables/useTtsPlayer'
import { splitForVoiceTtsChunks } from '../../utils/voiceCallBrief'
import { analyzeLocalPsychRiskText } from '../../utils/psychSafetyLocal'
import {
  buildDiaryPlainTextFromMessages,
  getDefaultDiaryTitle,
  formatDiaryContentFromSummary
} from '../../utils/diaryFromMessages'
import { summarizeDiaryTranscript } from '../../api/diary'
import { useDiaryStore } from '../../store/diaryStore'
import SandFlowMvpCanvas from '../../components/voice/SandFlowMvpCanvas.vue'
import { useMicLevelAnalyzer } from '../../composables/useMicLevelAnalyzer'

const router = useRouter()
const chatStore = useChatStore()
const diaryStore = useDiaryStore()
const { sendMessage, stopGeneration } = useChat()
const ttsPlayer = useTtsPlayer()

const CRISIS_SAFE_TTS_TEXT =
  '谢谢你愿意说出来，你现在一定很不容易。我没办法代替身边的紧急与专业帮助，但你的安全非常重要。'
  + '如果感觉自己或他人可能面临紧急危险，请立即拨打一二零或一一零，或请亲友陪同前往医院急诊。'
  + '你也可以拨打一二三二零卫生健康热线，或一二三五五青少年服务台，了解你所在地的心理援助方式。'
  + '请尽量联系一位你信任的家人或朋友陪伴你，你不必独自面对。'

const MAX_ROWS = 6

function resolveInitialVoiceSttMode() {
  const raw = String(import.meta.env.VITE_VOICE_STT_MODE || 'browser').toLowerCase()
  return raw === 'backend' ? 'backend' : 'browser'
}

/** 默认浏览器识别；VITE_VOICE_STT_MODE=backend 时用 /ws/stt；失败时静默降级 */
const voiceSttEffectiveMode = ref(resolveInitialVoiceSttMode())

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
  'stt-failed',
  'stt_provider_unsupported'
])

/** 播报：关闭则不入队 TTS（字幕仍更新） */
const ttsOutputEnabled = ref(true)
/** 麦克风：关闭则无法开始聆听（本页仍展示状态） */
const micInputEnabled = ref(true)

const {
  isListening,
  isRecognizing,
  currentSubtitle,
  error,
  clearError,
  startListening,
  stopListening
} = useSpeech({
  getMode: () => voiceSttEffectiveMode.value,
  beforeStartListening: () => {
    stopGeneration()
    clearAssistantSubtitleResidual()
  },
  onBackendTranscribeResult: (detail) => {
    const safety = detail?.safety
    if (safety && typeof safety === 'object') {
      chatStore.ingestMentalHealthSafety(safety)
    }
  }
})

/** 按住说话时 Web Audio 分析音量，驱动流沙粒子速度与连线（与 STT 独立第二路麦） */
const { level: micAudioLevelForSand } = useMicLevelAnalyzer(isListening)

/** 中区字幕行：你 / 小愈，最多保留 MAX_ROWS 条（流式时更新末条小愈） */
const subtitleRows = ref([])

const userTurnBusy = ref(false)
let listenEndedTimerId = null

/**
 * 通话状态机（UI）：ready | listening | recognizing | thinking | speaking | error
 */
const callPhase = computed(() => {
  if (error.value) return 'error'
  if (isListening.value) return 'listening'
  if (isRecognizing.value) return 'recognizing'
  if (chatStore.isGenerating) return 'thinking'
  if (ttsPlayer.isPlaying.value || ttsPlayer.queuedCount.value > 0) {
    return 'speaking'
  }
  return 'ready'
})

/** 流沙组件仅支持 idle | recording | thinking | playing */
const sandCanvasPhase = computed(() => {
  const phase = callPhase.value
  if (phase === 'listening' || phase === 'recognizing') return 'recording'
  if (phase === 'thinking') return 'thinking'
  if (phase === 'speaking') return 'playing'
  return 'idle'
})

const aiStateLabel = computed(() => {
  switch (callPhase.value) {
    case 'listening':
      return '正在聆听'
    case 'recognizing':
      return '识别中'
    case 'thinking':
      return '思考中'
    case 'speaking':
      return '正在说话'
    case 'error':
      return '请重试'
    default:
      return '就绪'
  }
})

const lastAssistantStreamText = computed(() => {
  const list = chatStore.activeSession?.messages
  if (!Array.isArray(list) || list.length === 0) return ''
  const lastMessage = list[list.length - 1]
  return lastMessage?.role === 'assistant'
    ? String(lastMessage.content ?? '')
    : ''
})

function trimSubtitleRows() {
  while (subtitleRows.value.length > MAX_ROWS) {
    subtitleRows.value.shift()
  }
}

/** 打断时去掉末行「小愈：」未播完的字幕，避免与下一轮叠字 */
function clearAssistantSubtitleResidual() {
  const rows = subtitleRows.value
  if (rows.length > 0 && rows[rows.length - 1].startsWith('小愈：')) {
    rows.pop()
  }
}

function setLiveUserSubtitle(text) {
  const prefix = '你：'
  const line = `${prefix}${String(text || '')}`
  const rows = subtitleRows.value
  if (rows.length > 0 && rows[rows.length - 1].startsWith(prefix)) {
    rows[rows.length - 1] = line
  } else {
    rows.push(line)
    trimSubtitleRows()
  }
}

function setLiveAssistantSubtitle(text) {
  const prefix = '小愈：'
  const piece = String(text || '')
  const brief =
    piece.length > 180 ? `${piece.slice(0, 180)}…` : piece
  const line = `${prefix}${brief}`
  const rows = subtitleRows.value
  if (rows.length > 0 && rows[rows.length - 1].startsWith(prefix)) {
    rows[rows.length - 1] = line
  } else {
    rows.push(line)
    trimSubtitleRows()
  }
}

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

/** 按住前：打断播报与生成（再次开口即时打断） */
function interruptAiForListen() {
  stopGeneration()
  clearAssistantSubtitleResidual()
}

function onMicPointerDown(downEvent) {
  if (downEvent.button !== 0 || !micInputEnabled.value) {
    return
  }
  if (typeof downEvent.currentTarget?.setPointerCapture === 'function') {
    downEvent.currentTarget.setPointerCapture(downEvent.pointerId)
  }
  interruptAiForListen()
  clearError()
  startListening()
}

function onMicPointerUp(upEvent) {
  if (typeof upEvent.currentTarget?.releasePointerCapture === 'function') {
    try {
      upEvent.currentTarget.releasePointerCapture(upEvent.pointerId)
    } catch {
      // 已释放时忽略
    }
  }
  if (!isListening.value) return
  stopListening()
}

function onMicPointerCancel() {
  if (isListening.value) {
    stopListening()
  }
}

async function handleUserTurnDone() {
  if (userTurnBusy.value) return
  const piece = String(currentSubtitle.value || '').trim()
  if (!piece) return
  if (chatStore.isGenerating) return

  userTurnBusy.value = true
  if (!chatStore.activeSession) {
    chatStore.createSession()
  }
  try {
    applyLocalPsychRiskHintBeforeSend(piece)
    await sendMessage(piece, {
      fromVoice: true,
      voiceCallBrief: true
    })
  } catch (err) {
    ElMessage.error(err?.message || '获取回复失败，请稍后重试')
  } finally {
    userTurnBusy.value = false
  }
}

watch(isListening, (listening) => {
  if (listening) return
  if (listenEndedTimerId != null) {
    clearTimeout(listenEndedTimerId)
    listenEndedTimerId = null
  }
  listenEndedTimerId = window.setTimeout(() => {
    listenEndedTimerId = null
    if (isListening.value || isRecognizing.value) return
    void handleUserTurnDone()
  }, 180)
})

watch(error, (err) => {
  if (!err) return
  const code = String(err.code || '')
  if (
    voiceSttEffectiveMode.value === 'backend'
    && STT_FALLBACK_ERROR_CODES.has(code)
  ) {
    voiceSttEffectiveMode.value = 'browser'
    clearError()
  }
})

watch(currentSubtitle, (text) => {
  if (isListening.value || isRecognizing.value) {
    setLiveUserSubtitle(text)
  }
})

watch(lastAssistantStreamText, (assistantText) => {
  const text = String(assistantText || '')

  if (!isListening.value && !isRecognizing.value) {
    if (text.length > 0) {
      setLiveAssistantSubtitle(text)
    }
  }
})

watch(
  () => chatStore.isGenerating,
  (generating) => {
    if (generating) return
    if (chatStore.lastReplyAborted) return
    if (chatStore.crisisSafeTtsForNextAssistant) {
      if (ttsOutputEnabled.value) {
        ttsPlayer.enqueue(CRISIS_SAFE_TTS_TEXT)
      }
      chatStore.clearCrisisSafeTtsFlag()
      return
    }
    if (!ttsOutputEnabled.value) return
    const messageList = chatStore.activeSession?.messages
    const lastMessage =
      Array.isArray(messageList) && messageList.length > 0
        ? messageList[messageList.length - 1]
        : null
    if (!lastMessage || lastMessage.role !== 'assistant') return
    const finalText = String(lastMessage.content || '').trim()
    if (!finalText) return
    const speakChunks = splitForVoiceTtsChunks(finalText)
    for (const chunk of speakChunks) {
      ttsPlayer.enqueue(chunk)
    }
  }
)

async function hangUp() {
  if (listenEndedTimerId != null) {
    clearTimeout(listenEndedTimerId)
    listenEndedTimerId = null
  }
  stopGeneration()
  ttsPlayer.stop()
  if (isListening.value || isRecognizing.value) {
    stopListening()
  }
  clearError()

  const messageList = chatStore.activeSession?.messages || []
  const plain = buildDiaryPlainTextFromMessages(messageList)
  if (plain.trim().length > 0) {
    try {
      await ElMessageBox.confirm(
        '是否将本次语音对话保存为日记？',
        '结束通话',
        {
          type: 'info',
          confirmButtonText: '保存并返回',
          cancelButtonText: '直接返回',
          distinguishCancelButton: true
        }
      )
      try {
        const { value } = await ElMessageBox.prompt(
          '日记标题（可留空使用默认）',
          '保存日记',
          {
            confirmButtonText: '保存',
            cancelButtonText: '取消',
            inputPlaceholder: getDefaultDiaryTitle(),
            inputValidator: (inputValue) => {
              if (inputValue && inputValue.length > 80) return '标题不能超过 80 字'
              return true
            }
          }
        )
        const trimmedTitle = (value || '').trim()
        const loading = ElLoading.service({
          lock: true,
          text: '正在生成智能摘要…'
        })
        try {
          let summary = null
          try {
            summary = await summarizeDiaryTranscript({ transcript: plain })
          } catch {
            summary = null
          }
          const hasStructured =
            summary
            && (
              (Array.isArray(summary.moodKeywords) && summary.moodKeywords.length > 0)
              || (summary.coreEvents && String(summary.coreEvents).trim())
              || (summary.aiEncouragement && String(summary.aiEncouragement).trim())
              || (summary.moodCurve?.points && summary.moodCurve.points.length > 0)
            )
          const content = hasStructured
            ? formatDiaryContentFromSummary(summary, plain)
            : plain
          await diaryStore.createEntry({
            ...(trimmedTitle ? { title: trimmedTitle } : {}),
            content,
            source: 'voice',
            ...(hasStructured
              ? {
                  moodKeywords: summary.moodKeywords,
                  coreEvents: summary.coreEvents,
                  aiEncouragement: summary.aiEncouragement,
                  moodCurve: summary.moodCurve
                }
              : {})
          })
          ElMessage.success(
            hasStructured ? '已保存到日记（含智能摘要与心情曲线）' : '已保存到日记'
          )
        } finally {
          loading.close()
        }
      } catch (innerError) {
        if (innerError !== 'cancel') {
          ElMessage.error(innerError?.message || '保存失败')
        }
      }
    } catch {
      /* 用户选择直接返回 */
    }
  }
  /* 本轮语音确有用户开口（麦克风提交的非空消息）时再新建会话；仅欢迎语或未说话返回则保持当前会话 */
  const hadVoiceUserTurn = messageList.some(
    (messageItem) =>
      messageItem
      && messageItem.role === 'user'
      && String(messageItem.content || '').trim().length > 0
      && messageItem.voiceInputChannel === 'mic'
  )
  if (hadVoiceUserTurn) {
    chatStore.createSession()
  }
  router.push('/chat')
}

function toggleTtsOutput() {
  ttsOutputEnabled.value = !ttsOutputEnabled.value
  if (!ttsOutputEnabled.value) {
    ttsPlayer.stop()
  }
}

function toggleMicInput() {
  micInputEnabled.value = !micInputEnabled.value
  if (!micInputEnabled.value && isListening.value) {
    stopListening()
  }
}

onMounted(() => {
  if (!chatStore.activeSession) {
    chatStore.createSession()
  }
})

onBeforeUnmount(() => {
  if (listenEndedTimerId != null) {
    clearTimeout(listenEndedTimerId)
    listenEndedTimerId = null
  }
  stopGeneration()
  ttsPlayer.stop()
  if (isListening.value || isRecognizing.value) {
    stopListening()
  }
})
</script>

<template>
  <div class="voice-call-page">
    <header class="voice-call-top-bar">
      <button type="button" class="voice-back-btn" aria-label="返回对话" @click="hangUp">
        <el-icon :size="22"><ArrowLeft /></el-icon>
      </button>
      <h1 class="voice-call-title">语音通话</h1>
      <span class="voice-call-spacer" />
    </header>

    <!-- 主界面：直接进入，按住麦克风说话 -->
    <section class="voice-visual" aria-hidden="false">
        <div class="sand-layer sand-layer--back" />
        <div class="sand-layer sand-layer--mid" />
        <div class="sand-layer sand-layer--front" />
        <SandFlowMvpCanvas
          :image-src="avatarAiCompanion"
          :phase="sandCanvasPhase"
          :audio-level="micAudioLevelForSand"
        />
        <div class="voice-state-badge" :data-phase="sandCanvasPhase">
          {{ aiStateLabel }}
        </div>
        <button
          type="button"
          class="voice-mic-button"
          :class="{
            'is-recording': sandCanvasPhase === 'recording',
            'is-playing': sandCanvasPhase === 'playing',
            'is-thinking': sandCanvasPhase === 'thinking'
          }"
          :disabled="!micInputEnabled"
          aria-label="按住说话，松开发送"
          @pointerdown="onMicPointerDown"
          @pointerup="onMicPointerUp"
          @pointercancel="onMicPointerCancel"
          @lostpointercapture="onMicPointerCancel"
        >
          <span class="voice-mic-ripple voice-mic-ripple--a" />
          <span class="voice-mic-ripple voice-mic-ripple--b" />
          <span class="voice-mic-core">
            <img
              :src="avatarAiCompanion"
              alt="小愈"
              class="voice-xiaoyu-avatar"
              draggable="false"
            >
          </span>
        </button>
        <p class="voice-mic-hint">
          按住说话 · 松开发送至小愈
          <template v-if="!micInputEnabled">（麦克风已关）</template>
        </p>
      </section>

      <!-- 字幕区 -->
      <section class="voice-transcript" aria-live="polite">
        <div class="voice-transcript-inner">
          <p
            v-for="(row, rowIndex) in subtitleRows"
            :key="`${rowIndex}-${row.slice(0, 12)}`"
            class="voice-transcript-row"
            :class="{
              'voice-transcript-row--user': row.startsWith('你：'),
              'voice-transcript-row--ai': row.startsWith('小愈：')
            }"
          >
            {{ row }}
          </p>
          <p
            v-if="subtitleRows.length === 0"
            class="voice-transcript-empty"
          >
            你说的话和小愈的回复会出现在这里
          </p>
        </div>
      </section>

      <!-- 控制区 -->
      <footer class="voice-controls">
        <div class="voice-control-row">
          <el-button
            size="small"
            :type="ttsOutputEnabled ? 'primary' : 'default'"
            plain
            @click="toggleTtsOutput"
          >
            <el-icon v-if="ttsOutputEnabled"><Headset /></el-icon>
            <el-icon v-else><SwitchButton /></el-icon>
            {{ ttsOutputEnabled ? '播报开' : '播报关' }}
          </el-button>
          <el-button
            size="small"
            :type="micInputEnabled ? 'default' : 'warning'"
            plain
            @click="toggleMicInput"
          >
            <el-icon><Microphone /></el-icon>
            {{ micInputEnabled ? '麦开' : '麦关' }}
          </el-button>
          <el-button type="danger" plain size="small" @click="hangUp">
            <el-icon><VideoPause /></el-icon>
            挂断
          </el-button>
        </div>
      </footer>
  </div>
</template>

<style scoped>
.voice-call-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--app-color-bg-chat, #f0f4f8);
  color: var(--app-color-text, #303133);
}

html.dark .voice-call-page {
  background: var(--app-color-bg-chat, #0f172a);
}

.voice-call-top-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--app-color-border, #e4e7ed) 65%, transparent);
  background: color-mix(in srgb, var(--app-color-bg-elevated, #fff) 78%, transparent);
  backdrop-filter: blur(16px) saturate(165%);
  -webkit-backdrop-filter: blur(16px) saturate(165%);
}

html.dark .voice-call-top-bar {
  background: color-mix(in srgb, var(--app-color-bg-elevated, #1e293b) 72%, transparent);
  border-color: rgba(148, 163, 184, 0.22);
}

.voice-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.voice-back-btn:hover {
  background: color-mix(in srgb, var(--el-color-primary, #409eff) 12%, transparent);
}

.voice-call-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  flex: 1;
  text-align: center;
}

.voice-call-spacer {
  width: 40px;
}

/* ========== 视觉区：流沙 ========== */
.voice-visual {
  position: relative;
  flex: 1 1 42vh;
  min-height: 200px;
  max-height: 52vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.sand-layer {
  position: absolute;
  inset: -20%;
  opacity: 0.35;
  pointer-events: none;
  border-radius: 40%;
  animation: sand-drift 14s ease-in-out infinite alternate;
}

.sand-layer--back {
  background: radial-gradient(
    ellipse 80% 60% at 30% 40%,
    color-mix(in srgb, #c4b5a0 45%, transparent),
    transparent 70%
  );
  animation-duration: 18s;
}

.sand-layer--mid {
  background: radial-gradient(
    ellipse 70% 55% at 65% 55%,
    color-mix(in srgb, #a8c4d4 40%, transparent),
    transparent 65%
  );
  animation-duration: 12s;
  animation-delay: -3s;
}

.sand-layer--front {
  background: radial-gradient(
    ellipse 55% 45% at 50% 70%,
    color-mix(in srgb, #d4c4a8 38%, transparent),
    transparent 60%
  );
  animation-duration: 10s;
  animation-delay: -5s;
}

@keyframes sand-drift {
  0% {
    transform: translate(-4%, -2%) rotate(0deg) scale(1);
  }
  100% {
    transform: translate(4%, 3%) rotate(4deg) scale(1.06);
  }
}

.voice-state-badge {
  position: relative;
  z-index: 2;
  margin-bottom: 12px;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  background: color-mix(in srgb, var(--app-color-bg-elevated, #fff) 62%, transparent);
  backdrop-filter: blur(14px) saturate(170%);
  -webkit-backdrop-filter: blur(14px) saturate(170%);
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 28%, transparent);
  color: var(--el-text-color-regular, #606266);
  box-shadow: 0 4px 20px color-mix(in srgb, #0f172a 6%, transparent);
}

html.dark .voice-state-badge {
  background: color-mix(in srgb, var(--app-color-bg-elevated, #1e293b) 58%, transparent);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

.voice-state-badge[data-phase='recording'] {
  border-color: color-mix(in srgb, var(--el-color-success) 40%, transparent);
  color: var(--el-color-success, #67c23a);
}

.voice-state-badge[data-phase='playing'] {
  border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
  color: var(--el-color-primary, #409eff);
}

.voice-state-badge[data-phase='thinking'] {
  border-color: color-mix(in srgb, var(--el-color-info) 35%, transparent);
}

.voice-mic-button {
  position: relative;
  z-index: 2;
  width: 120px;
  height: 120px;
  border: 3px solid color-mix(in srgb, var(--el-color-primary, #409eff) 35%, transparent);
  border-radius: 50%;
  cursor: pointer;
  touch-action: none;
  padding: 0;
  overflow: hidden;
  background: var(--app-color-bg-elevated, #fff);
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12);
  transition: transform 0.15s ease;
}

.voice-mic-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.voice-mic-button:not(:disabled):active {
  transform: scale(0.96);
}

.voice-mic-button.is-recording {
  border-color: color-mix(in srgb, var(--el-color-success, #67c23a) 55%, transparent);
  box-shadow:
    0 12px 40px rgba(15, 23, 42, 0.12),
    0 0 0 3px color-mix(in srgb, var(--el-color-success, #67c23a) 22%, transparent);
}

.voice-mic-button.is-playing {
  border-color: color-mix(in srgb, var(--el-color-primary, #409eff) 55%, transparent);
}

.voice-mic-button.is-thinking {
  border-color: color-mix(in srgb, var(--el-color-info, #909399) 45%, transparent);
}

.voice-mic-ripple {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 35%, transparent);
  opacity: 0;
  pointer-events: none;
}

.voice-mic-button.is-recording .voice-mic-ripple--a {
  animation: mic-ripple 2s ease-out infinite;
}

.voice-mic-button.is-recording .voice-mic-ripple--b {
  animation: mic-ripple 2s ease-out infinite 0.5s;
}

.voice-mic-button.is-playing .voice-mic-ripple--a {
  animation: mic-ripple 1.5s ease-out infinite;
}

@keyframes mic-ripple {
  0% {
    transform: scale(0.9);
    opacity: 0.5;
  }
  100% {
    transform: scale(1.35);
    opacity: 0;
  }
}

.voice-mic-core {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
}

.voice-xiaoyu-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  pointer-events: none;
  user-select: none;
}

.voice-mic-button:disabled .voice-xiaoyu-avatar {
  opacity: 0.55;
  filter: grayscale(0.25);
}

.voice-mic-hint {
  position: relative;
  z-index: 2;
  margin: 16px 16px 0;
  padding: 6px 12px;
  border-radius: 10px;
  font-size: 13px;
  color: var(--app-color-text-muted, #909399);
  text-align: center;
  background: color-mix(in srgb, var(--app-color-bg-elevated, #fff) 55%, transparent);
  backdrop-filter: blur(12px) saturate(150%);
  -webkit-backdrop-filter: blur(12px) saturate(150%);
  max-width: 92%;
  margin-left: auto;
  margin-right: auto;
}

html.dark .voice-mic-hint {
  background: color-mix(in srgb, var(--app-color-bg-elevated, #1e293b) 52%, transparent);
}

/* ========== 字幕区：约 3–6 行视觉高度 ========== */
.voice-transcript {
  flex-shrink: 0;
  margin: 0 16px;
  padding: 12px 14px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--app-color-bg-elevated, #fff) 68%, transparent);
  backdrop-filter: blur(18px) saturate(175%);
  -webkit-backdrop-filter: blur(18px) saturate(175%);
  border: 1px solid color-mix(in srgb, var(--app-color-border, #ebeef5) 70%, transparent);
  box-shadow: 0 8px 32px color-mix(in srgb, #0f172a 8%, transparent);
  max-height: calc(1.55em * 6 + 24px);
  min-height: calc(1.55em * 3 + 24px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

html.dark .voice-transcript {
  background: color-mix(in srgb, var(--app-color-bg-elevated, #1e293b) 62%, transparent);
  border-color: color-mix(in srgb, var(--app-color-border, #334155) 55%, transparent);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}

.voice-transcript-inner {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
}

.voice-transcript-row {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.55;
  word-break: break-word;
}

.voice-transcript-row:last-child {
  margin-bottom: 0;
}

.voice-transcript-row--user {
  color: var(--el-color-primary, #409eff);
}

.voice-transcript-row--ai {
  color: var(--el-text-color-regular, #606266);
}

.voice-transcript-empty {
  margin: 0;
  font-size: 13px;
  color: var(--app-color-text-muted, #c0c4cc);
  line-height: 1.6;
}

/* ========== 控制区 ========== */
.voice-controls {
  flex-shrink: 0;
  padding: 12px 16px calc(16px + env(safe-area-inset-bottom));
  background: color-mix(in srgb, var(--app-color-bg-elevated, #fff) 75%, transparent);
  backdrop-filter: blur(16px) saturate(165%);
  -webkit-backdrop-filter: blur(16px) saturate(165%);
  border-top: 1px solid color-mix(in srgb, var(--app-color-border, #ebeef5) 65%, transparent);
}

html.dark .voice-controls {
  background: color-mix(in srgb, var(--app-color-bg-elevated, #1e293b) 70%, transparent);
  border-color: rgba(148, 163, 184, 0.22);
}

.voice-control-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  justify-content: center;
}
</style>
