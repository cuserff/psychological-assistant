<script setup>
// 麦克风录音与语音转写组件
import { computed, ref, watch } from 'vue'
import { useSpeech } from '../../composables/useSpeech'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps({
  /** 胶囊输入条等场景：紧凑图标按钮，提示主要靠 ElMessage */
  variant: {
    type: String,
    default: 'default',
    validator: (value) => ['default', 'pill'].includes(value)
  },
  /** 生成中等父级禁用交互 */
  disabled: { type: Boolean, default: false },
  /**
   * backend：WebSocket /ws/stt（服务端讯飞）；browser：Web Speech API
   */
  sttMode: {
    type: String,
    default: 'browser',
    validator: (value) => ['browser', 'backend'].includes(value)
  },
  /** 后端听写定稿时回调（浏览器识别无服务端 safety，可不接） */
  onSttResultDetail: {
    type: Function,
    default: null
  },
  /** 开始录音前调用（用于打断上轮 TTS / 生成） */
  beforeStartListening: {
    type: Function,
    default: null
  }
})

const emit = defineEmits([
  'result',
  'listening-change',
  'speech-error',
  'recognizing-change',
  'transcript-change'
])

/** 服务端 /ws/stt 失败即将改为浏览器识别时不弹 Toast（与父级静默降级一致） */
const SUPPRESS_STT_FAILURE_TOAST = new Set([
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
const {
  isSupported,
  isListening,
  isRecognizing,
  currentSubtitle,
  error,
  clearError,
  startListening,
  stopListening
} = useSpeech({
  getMode: () => props.sttMode,
  beforeStartListening: () => {
    if (typeof props.beforeStartListening === 'function') {
      props.beforeStartListening()
    }
  },
  onBackendTranscribeResult: (detail) => {
    if (typeof props.onSttResultDetail === 'function') {
      props.onSttResultDetail(detail)
    }
  },
  onRecognizingChange: (value) => {
    emit('recognizing-change', value)
  }
})

watch(
  () => props.sttMode,
  (nextMode, previousMode) => {
    if (previousMode === 'backend' && nextMode === 'browser') {
      clearError()
    }
  }
)

// tooltip 显示控制
const showTooltip = ref(false)

const errorText = computed(() => error.value?.message || '')

// 点击切换录音状态
function toggleListening() {
  if (props.disabled) return
  showTooltip.value = false
  clearError()
  if (isListening.value) {
    stopListening()
  } else {
    startListening()
  }
}

/** 统一打断：外部调用等价于用户再点一次停止录音（触发 STT stop） */
function interruptListening() {
  if (isListening.value || isRecognizing.value) {
    void stopListening()
  }
}

defineExpose({ interruptListening, isRecognizing })

function handleRetry() {
  clearError()
  startListening()
}

function getPermissionGuideText() {
  return [
    '如果你使用的是 Chrome / Edge：',
    '1）点击地址栏左侧的「锁」图标 → 找到「麦克风」权限 → 选择「允许」',
    '2）刷新页面后再次点击麦克风按钮',
    '',
    '如果系统层面禁用了麦克风：',
    'Windows 设置 → 隐私和安全性 → 麦克风 → 允许应用访问麦克风'
  ].join('\n')
}

async function handlePermissionGuide() {
  await ElMessageBox.alert(getPermissionGuideText(), '如何授权麦克风', {
    confirmButtonText: '我知道了'
  })
}

// 停止录音后，将最终结果传给父组件；同步聆听状态供上层「语音会话」展示
watch(
  isListening,
  (listening) => {
    emit('listening-change', listening)
    if (!listening && currentSubtitle.value.trim() && !props.disabled) {
      emit('result', currentSubtitle.value.trim())
    }
  },
  { immediate: true }
)

watch(error, (err) => {
  if (!err) return
  emit('speech-error', err)
  if (props.sttMode === 'backend' && SUPPRESS_STT_FAILURE_TOAST.has(String(err.code || ''))) {
    return
  }
  // 关键错误给用户明确反馈（避免“静默失败”）
  if (
    err.code === 'not-allowed'
    || err.code === 'service-not-allowed'
    || err.code === 'invalid_token'
    || err.code === 'missing_token'
  ) {
    ElMessage.error(err.message)
  } else if (err.code === 'no-speech' || err.code === 'stt-empty') {
    ElMessage.warning(err.message)
  } else if (err.code !== 'aborted') {
    ElMessage.warning(err.message)
  }
})

// 识别过程中的中间结果与定稿变化，实时抛给父组件
watch(
  currentSubtitle,
  (text) => {
    emit('transcript-change', String(text || ''))
  },
  { immediate: true }
)
</script>

<template>
  <div
    v-if="isSupported"
    class="voice-recorder"
    :class="{ 'voice-recorder--pill': variant === 'pill' }"
  >
    <div class="voice-btn-wrapper">
      <button
        type="button"
        class="voice-btn"
        :class="{ listening: isListening, 'voice-btn--pill': variant === 'pill' }"
        :disabled="disabled"
        @click="toggleListening"
        @mouseenter="showTooltip = true"
        @mouseleave="showTooltip = false"
      >
        <!-- 麦克风：path 使用内联 fill，避免 scoped 下样式偶发不命中导致「看不见」 -->
        <svg
          class="mic-icon"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            class="mic-path mic-path--body"
            d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"
          />
          <path
            class="mic-path mic-path--stand"
            d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"
          />
        </svg>
      </button>

      <!-- tooltip -->
      <transition name="tooltip-fade">
        <div v-if="showTooltip && !isListening" class="voice-tooltip">
          使用麦克风
        </div>
      </transition>
    </div>

      <!-- 录音中提示（胶囊条内不占位，避免撑高输入条） -->
    <div v-if="isListening && variant !== 'pill'" class="listening-hint">
      <span class="pulse-dot"></span>
      正在聆听...
    </div>

    <!-- 错误提示与操作 -->
    <div v-else-if="errorText && variant !== 'pill'" class="error-hint">
      <div class="error-text">{{ errorText }}</div>
      <div class="error-actions">
        <button class="error-link" @click="handleRetry">重试</button>
        <span class="divider">·</span>
        <button class="error-link" @click="handlePermissionGuide">如何授权</button>
      </div>
    </div>
  </div>

  <!-- 不支持时也给可见提示，避免“啥都没有” -->
  <div v-else class="voice-recorder unsupported" :class="{ 'voice-recorder--pill': variant === 'pill' }">
    <div class="voice-btn-wrapper">
      <button
        type="button"
        class="voice-btn disabled"
        :class="{ 'voice-btn--pill': variant === 'pill' }"
        disabled
        @mouseenter="showTooltip = true"
        @mouseleave="showTooltip = false"
      >
        <svg
          class="mic-icon"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            class="mic-path mic-path--body"
            d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"
          />
          <path
            class="mic-path mic-path--stand"
            d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"
          />
        </svg>
      </button>

      <transition name="tooltip-fade">
        <div v-if="showTooltip" class="voice-tooltip">
          当前浏览器不支持语音识别
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.voice-recorder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.voice-btn-wrapper {
  position: relative;
}

.voice-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: #f1f5f9;
  color: #475569;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.voice-btn:hover {
  background: #e2e8f0;
  color: #1e293b;
}

/* 默认大号麦克风：跟随按钮 color */
.voice-btn:not(.voice-btn--pill) .mic-path {
  fill: currentColor;
}

.voice-btn.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 胶囊条内即使「不支持语音」也要能看见图标，勿叠加载入 whole-button opacity */
.voice-btn--pill.voice-btn.disabled {
  opacity: 1;
  cursor: not-allowed;
}

/* 录音中状态 */
.voice-btn.listening {
  background: #fee2e2;
  color: #ef4444;
  animation: pulse-ring 1.5s ease-in-out infinite;
}

@keyframes pulse-ring {
  0%   { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  70%  { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}

/* tooltip 样式 */
.voice-tooltip {
  position: absolute;
  bottom: -36px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  background: #1e293b;
  color: #fff;
  font-size: 12px;
  border-radius: 6px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
}

.voice-tooltip::before {
  content: '';
  position: absolute;
  top: -4px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 5px solid #1e293b;
}

.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity 0.15s;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
}

/* 录音中提示 */
.listening-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #ef4444;
  white-space: nowrap;
}

.error-hint {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: center;
  max-width: 220px;
}

.error-text {
  font-size: 11px;
  color: #b91c1c;
  line-height: 1.4;
}

.error-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 11px;
  color: #64748b;
}

.divider {
  opacity: 0.8;
}

.error-link {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  color: var(--app-color-primary);
  font-weight: 600;
}

.error-link:hover {
  color: #0369a1;
  text-decoration: underline;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  background: #ef4444;
  border-radius: 50%;
  animation: pulse-dot 1s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}

/* 与胶囊输入条一体的紧凑麦克风 */
.voice-recorder--pill {
  flex-direction: row;
  align-items: center;
}

/*
 * 胶囊条麦克风：浅灰圆底 + 深灰图标（与参考低对比圆钮一致，图标保证可见）
 * mic-path 默认 fill 写在样式末尾用 !important，防止 scoped / 浏览器对 SVG 优先级异常
 */
.voice-btn--pill {
  width: 40px;
  height: 40px;
  margin-bottom: 2px;
  flex-shrink: 0;
  padding: 0;
  background: #dcdce2;
  color: #3d3d42;
  border: none;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}

.voice-btn--pill .mic-icon {
  width: 22px;
  height: 22px;
  display: block;
}

.voice-btn--pill:hover:not(:disabled) {
  background: #cfcfd6;
}

.voice-btn--pill.listening {
  background: #edd4d4;
  animation: pulse-ring 1.5s ease-in-out infinite;
}

.voice-btn--pill:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.voice-btn--pill.voice-btn.disabled {
  background: #dcdce2;
  opacity: 1;
}

/* 内联 path 类 + !important：确保一定能画上颜色 */
.voice-btn--pill .mic-path {
  fill: #4a4a4f !important;
}

.voice-btn--pill:hover:not(:disabled) .mic-path {
  fill: #2a2a2f !important;
}

.voice-btn--pill.listening .mic-path {
  fill: #b42323 !important;
}

.voice-btn--pill:disabled .mic-path,
.voice-btn--pill.voice-btn.disabled .mic-path {
  fill: #8b8b93 !important;
}

/* 悬停提示：深底圆角条 + 白字；提高 z-index 避免被父级裁剪/盖住 */
.voice-recorder--pill .voice-tooltip {
  bottom: auto;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  margin-top: 0;
  padding: 8px 14px;
  background: #252525;
  color: #fff;
  font-size: 13px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
}

.voice-recorder--pill .voice-tooltip::before {
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 6px solid #252525;
  border-top: none;
}
</style>
