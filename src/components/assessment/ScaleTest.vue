<script setup>
/**
 * 答题组件
 * 逐题展示量表题目，用户选择答案后可前进/后退，全部答完后提交
 */
import { ref, computed, onBeforeUnmount } from 'vue'
import { SCALES, calculateScore } from '../../data/scales'
import { useAssessmentStore } from '../../store/assessmentStore'
import { ElMessage } from 'element-plus'
import { ArrowLeft, ArrowRight, Check } from '@element-plus/icons-vue'

const props = defineProps({
  /** 量表 ID */
  scaleId: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['complete', 'back'])

const assessmentStore = useAssessmentStore()

const scale = computed(() => SCALES[props.scaleId])
const questions = computed(() => scale.value.questions)
const totalQuestions = computed(() => questions.value.length)

// 当前题目索引
const currentIndex = ref(0)
// 用户答案数组：每个元素是选项索引（null 表示未作答）
const answers = ref(Array(totalQuestions.value).fill(null))
// 提交中状态
const submitting = ref(false)

// 自动跳转的定时器（避免快速连点产生多个 setTimeout 导致索引错乱）
let autoAdvanceTimerId = null

function clearAutoAdvanceTimer() {
  if (autoAdvanceTimerId !== null) {
    clearTimeout(autoAdvanceTimerId)
    autoAdvanceTimerId = null
  }
}

/**
 * 计划在指定题目上完成选择后自动跳题
 * @param {number} scheduledIndex - 计划发生时的题目索引
 */
function scheduleAutoAdvance(scheduledIndex) {
  clearAutoAdvanceTimer()
  autoAdvanceTimerId = setTimeout(() => {
    autoAdvanceTimerId = null
    // 如果期间用户手动切题或跳转过，跳转条件失效
    if (currentIndex.value !== scheduledIndex) return
    if (scheduledIndex < totalQuestions.value - 1) {
      currentIndex.value++
    }
  }, 300)
}

// 当前题目文本
const currentQuestionText = computed(() => {
  const q = questions.value[currentIndex.value]
  return typeof q === 'string' ? q : q.text
})

// 进度百分比
const progressPercent = computed(() => {
  const answered = answers.value.filter(a => a !== null).length
  return Math.round((answered / totalQuestions.value) * 100)
})

// 是否所有题目都已作答
const allAnswered = computed(() => answers.value.every(a => a !== null))

// 是否是最后一题
const isLastQuestion = computed(() => currentIndex.value === totalQuestions.value - 1)

/** 选择答案 */
function selectAnswer(optionIndex) {
  answers.value[currentIndex.value] = optionIndex
  // 自动跳转下一题（延迟 300ms 给用户视觉反馈）
  if (!isLastQuestion.value) {
    scheduleAutoAdvance(currentIndex.value)
  }
}

/** 上一题 */
function prevQuestion() {
  clearAutoAdvanceTimer()
  if (currentIndex.value > 0) {
    currentIndex.value--
  }
}

/** 下一题 */
function nextQuestion() {
  clearAutoAdvanceTimer()
  if (currentIndex.value < totalQuestions.value - 1) {
    currentIndex.value++
  }
}

/** 提交测评 */
async function handleSubmit() {
  if (submitting.value) return
  if (!allAnswered.value) {
    ElMessage.warning('请完成所有题目后再提交')
    return
  }

  clearAutoAdvanceTimer()
  submitting.value = true
  try {
    const { rawScore, standardScore, level } = calculateScore(props.scaleId, answers.value)

    const resultData = {
      scaleId: props.scaleId,
      scaleName: scale.value.name,
      answers: answers.value,
      rawScore,
      standardScore,
      level: level.label,
      severity: level.severity
    }

    await assessmentStore.submitResult(resultData)

    // 将完整结果传给父组件展示
    emit('complete', {
      ...resultData,
      levelInfo: level,
      scale: scale.value
    })
  } catch (error) {
    ElMessage.error(error.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

/** 跳转到指定题目 */
function jumpTo(index) {
  clearAutoAdvanceTimer()
  currentIndex.value = index
}

onBeforeUnmount(() => {
  clearAutoAdvanceTimer()
})
</script>

<template>
  <div class="scale-test">
    <!-- 顶部：量表名称和返回按钮 -->
    <div class="test-header">
      <el-button text @click="emit('back')">
        <el-icon><ArrowLeft /></el-icon>
        返回量表列表
      </el-button>
      <h3 class="test-title">{{ scale.name }}</h3>
    </div>

    <!-- 进度条 -->
    <div class="progress-section">
      <div class="progress-info">
        <span>第 {{ currentIndex + 1 }} / {{ totalQuestions }} 题</span>
        <span>已完成 {{ progressPercent }}%</span>
      </div>
      <el-progress
        :percentage="progressPercent"
        :stroke-width="8"
        :show-text="false"
        color="var(--el-color-primary)"
      />
    </div>

    <!-- 题目说明 -->
    <p class="test-instruction">{{ scale.instruction }}</p>

    <!-- 当前题目 -->
    <div class="question-area">
      <div class="question-number">Q{{ currentIndex + 1 }}</div>
      <h4 class="question-text">{{ currentQuestionText }}</h4>

      <!-- 选项列表 -->
      <div class="options-list">
        <div
          v-for="(option, idx) in scale.options"
          :key="idx"
          class="option-item"
          :class="{ active: answers[currentIndex] === idx }"
          @click="selectAnswer(idx)"
        >
          <div class="option-radio">
            <div v-if="answers[currentIndex] === idx" class="radio-dot"></div>
          </div>
          <span class="option-label">{{ option.label }}</span>
        </div>
      </div>
    </div>

    <!-- 题目导航按钮 -->
    <div class="nav-buttons">
      <el-button :disabled="currentIndex === 0" @click="prevQuestion">
        <el-icon><ArrowLeft /></el-icon>
        上一题
      </el-button>

      <el-button
        v-if="!isLastQuestion"
        type="primary"
        :disabled="answers[currentIndex] === null"
        @click="nextQuestion"
      >
        下一题
        <el-icon><ArrowRight /></el-icon>
      </el-button>

      <el-button
        v-else
        type="success"
        :disabled="!allAnswered"
        :loading="submitting"
        @click="handleSubmit"
      >
        <el-icon><Check /></el-icon>
        提交测评
      </el-button>
    </div>

    <!-- 题目导航圆点 -->
    <div class="question-dots">
      <div
        v-for="(_, idx) in questions"
        :key="idx"
        class="dot"
        :class="{
          current: idx === currentIndex,
          answered: answers[idx] !== null
        }"
        :title="`第 ${idx + 1} 题`"
        @click="jumpTo(idx)"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.scale-test {
  max-width: 700px;
  margin: 0 auto;
}

.test-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.test-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--app-color-text);
  margin: 0;
}

.progress-section {
  margin-bottom: 20px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--app-color-text-muted);
  margin-bottom: 6px;
}

.test-instruction {
  font-size: 14px;
  color: var(--app-color-el-text-regular);
  background: var(--app-color-fill-muted);
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 24px;
}

.question-area {
  background: var(--app-color-bg-elevated);
  border: 1px solid var(--app-color-border);
  border-radius: 12px;
  padding: 28px 24px;
  margin-bottom: 20px;
}

.question-number {
  display: inline-block;
  background: var(--app-color-primary);
  color: var(--app-color-on-primary);
  font-size: 13px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 12px;
  margin-bottom: 12px;
}

.question-text {
  font-size: 16px;
  color: var(--app-color-text);
  line-height: 1.6;
  margin: 0 0 20px;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--app-el-border-light);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.25s ease;
}

.option-item:hover {
  border-color: var(--app-color-primary);
  background: var(--app-color-primary-soft-bg);
}

.option-item.active {
  border-color: var(--app-color-primary);
  background: color-mix(in srgb, var(--app-color-primary) 12%, var(--app-color-bg-elevated));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--app-color-primary) 22%, transparent);
}

.option-radio {
  width: 20px;
  height: 20px;
  border: 2px solid var(--app-el-border-light);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color 0.2s;
}

.option-item.active .option-radio {
  border-color: var(--app-color-primary);
}

.radio-dot {
  width: 10px;
  height: 10px;
  background: var(--app-color-primary);
  border-radius: 50%;
}

.option-label {
  font-size: 14px;
  color: var(--app-color-text);
}

.nav-buttons {
  display: flex;
  justify-content: space-between;
  margin-bottom: 20px;
}

.question-dots {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--app-el-border-light);
  cursor: pointer;
  transition: all 0.2s;
}

.dot:hover {
  background: var(--el-color-primary-light-5);
}

.dot.answered {
  background: var(--el-color-primary-light-5);
}

.dot.current {
  background: var(--el-color-primary);
  transform: scale(1.3);
}
</style>
