<script setup>
// 麦克风录音与语音转写组件
import { ref, watch } from 'vue'
import { useSpeech } from '../../composables/useSpeech'

const emit = defineEmits(['result'])
const { isSupported, isListening, transcript, startListening, stopListening } = useSpeech()

// tooltip 显示控制
const showTooltip = ref(false)

// 点击切换录音状态
function toggleListening() {
  showTooltip.value = false
  if (isListening.value) {
    stopListening()
  } else {
    startListening()
  }
}

// 停止录音后，将最终结果传给父组件
watch(isListening, (listening) => {
  if (!listening && transcript.value.trim()) {
    emit('result', transcript.value.trim())
  }
})
</script>

<template>
  <div v-if="isSupported" class="voice-recorder">
    <div class="voice-btn-wrapper">
      <button
        class="voice-btn"
        :class="{ listening: isListening }"
        @click="toggleListening"
        @mouseenter="showTooltip = true"
        @mouseleave="showTooltip = false"
      >
        <!-- 麦克风图标 -->
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/>
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg>
      </button>

      <!-- tooltip -->
      <transition name="tooltip-fade">
        <div v-if="showTooltip && !isListening" class="voice-tooltip">
          使用麦克风
        </div>
      </transition>
    </div>

    <!-- 录音中提示 -->
    <div v-if="isListening" class="listening-hint">
      <span class="pulse-dot"></span>
      正在聆听...
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
</style>
