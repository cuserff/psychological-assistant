<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../store/userStore'
import { useCheckinStore } from '../store/checkinStore'
import { useAssessmentStore } from '../store/assessmentStore'
import MoodCheckin from '../components/profile/MoodCheckin.vue'

const router = useRouter()
const userStore = useUserStore()
const checkinStore = useCheckinStore()
const assessmentStore = useAssessmentStore()

const pageLoading = ref(true)

// ==================== 顶部：动态问候 ====================
function getTimeGreeting() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 11) return { emoji: '🌅', text: '早上好' }
  if (hour >= 11 && hour < 14) return { emoji: '☀️', text: '中午好' }
  if (hour >= 14 && hour < 18) return { emoji: '🌤️', text: '下午好' }
  if (hour >= 18 && hour < 23) return { emoji: '🌙', text: '晚上好' }
  return { emoji: '🌙', text: '夜深了' }
}

const greeting = computed(() => {
  const { emoji, text } = getTimeGreeting()
  const nickname = userStore.userInfo?.nickname || userStore.nickname || '朋友'
  const tail = text === '夜深了'
    ? '今天辛苦了，早点休息。'
    : '今天也可以慢慢来。'
  return `${emoji} ${text}，${nickname}，${tail}`
})

// ==================== 下半部分：每日愈心一句 ====================
const healQuotes = [
  '你不需要立刻变好，你只需要继续向前走。',
  '情绪没有对错，允许自己感受，就是一种勇气。',
  '慢一点也没关系，你一直在路上。',
  '你已经做得很好了，别忘了好好照顾自己。',
  '把注意力放回当下，呼吸一下，一切都会慢慢变得清晰。'
]

function getQuoteOfToday() {
  const todayKey = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''))
  return healQuotes[todayKey % healQuotes.length]
}

const todayQuote = computed(() => `“${getQuoteOfToday()}”`)

// ==================== 最近活动概览 ====================
const lastAssessmentSummary = computed(() => {
  const record = assessmentStore.records?.[0]
  if (!record) return null

  const scaleName = record.scaleName || record.scaleId
  const level = record.level || '未知等级'
  const createdAtMs = record.createdAt ? new Date(record.createdAt).getTime() : null
  if (!createdAtMs || Number.isNaN(createdAtMs)) {
    return `你最近完成了《${scaleName}》，结果为：${level}。`
  }

  const daysDiff = Math.max(0, Math.floor((Date.now() - createdAtMs) / (24 * 60 * 60 * 1000)))
  const daysText = daysDiff === 0 ? '今天' : `${daysDiff} 天前`
  return `你上次完成《${scaleName}》是在 ${daysText}，结果为：${level}。`
})

const avgMood7dSummary = computed(() => {
  const avg = checkinStore.stats?.avgMood7d
  if (avg === null || avg === undefined) return null
  if (!Number.isFinite(Number(avg))) return null
  return `最近 7 天平均情绪得分：${Number(avg).toFixed(1)} 分。`
})

// ==================== 交互：快捷卡片跳转 ====================
function goChat() {
  router.push('/chat')
}
function goAssessment() {
  router.push('/assessment')
}
function goProfile() {
  router.push('/profile')
}

async function refreshAfterCheckin() {
  await Promise.all([
    checkinStore.loadStats(),
    checkinStore.loadRecords()
  ])
}

onMounted(async () => {
  pageLoading.value = true
  try {
    await Promise.all([
      checkinStore.loadStats(),
      checkinStore.loadRecords(),
      assessmentStore.loadHistory()
    ])
  } finally {
    pageLoading.value = false
  }
})
</script>

<template>
  <div class="home-container">
    <!-- 顶部：情感化问候与快捷打卡区 -->
    <section class="hero">
      <div class="hero-left">
        <div class="hero-title">智能心理助手</div>
        <div class="hero-greeting">{{ greeting }}</div>
        <div class="hero-subtitle">
          你可以先做一次情绪打卡，或者直接开始对话，我会一直在这里陪你。
        </div>

        <div class="hero-checkin">
          <MoodCheckin
            :today-checked-in="checkinStore.isTodayCheckedIn()"
            :today-record="checkinStore.getTodayRecord()"
            lock-when-checked-in
            @checkin-success="refreshAfterCheckin"
          />
        </div>
      </div>

      <div class="hero-right">
        <!-- 治愈系插画（内联 SVG，避免额外资源依赖） -->
        <div class="illustration-card">
          <svg viewBox="0 0 520 320" class="illustration" aria-hidden="true">
            <defs>
              <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#e0f2fe" />
                <stop offset="1" stop-color="#fef3c7" />
              </linearGradient>
              <linearGradient id="sofa" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stop-color="#93c5fd" />
                <stop offset="1" stop-color="#60a5fa" />
              </linearGradient>
              <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="rgba(2,132,199,0.18)" />
              </filter>
            </defs>
            <rect x="0" y="0" width="520" height="320" rx="22" fill="url(#bg)" />

            <!-- 植物 -->
            <g opacity="0.95">
              <rect x="420" y="180" width="46" height="60" rx="10" fill="#c7d2fe" filter="url(#softShadow)" />
              <path d="M443 180c-10-22-8-45 3-67 13 10 20 28 22 46-9 9-17 16-25 21z" fill="#34d399" />
              <path d="M444 178c8-26 24-41 49-49 4 16-2 35-13 47-13 2-25 3-36 2z" fill="#10b981" />
            </g>

            <!-- 沙发 -->
            <g filter="url(#softShadow)">
              <rect x="90" y="182" width="310" height="86" rx="24" fill="url(#sofa)" />
              <rect x="120" y="150" width="120" height="58" rx="18" fill="#bfdbfe" />
              <rect x="260" y="150" width="110" height="58" rx="18" fill="#bfdbfe" opacity="0.9" />
              <rect x="110" y="254" width="34" height="24" rx="10" fill="#1d4ed8" opacity="0.75" />
              <rect x="346" y="254" width="34" height="24" rx="10" fill="#1d4ed8" opacity="0.75" />
            </g>

            <!-- 人物（简化扁平风） -->
            <g>
              <circle cx="230" cy="138" r="24" fill="#fde68a" />
              <path d="M210 192c10-28 46-28 56 0v30h-56v-30z" fill="#fca5a5" />
              <path d="M206 206c10 10 18 16 28 18 12-3 22-9 32-18" fill="none" stroke="#fb7185" stroke-width="10" stroke-linecap="round" />
              <path d="M220 150c6 10 16 16 30 16" fill="none" stroke="#f59e0b" stroke-width="6" stroke-linecap="round" />
            </g>

            <!-- 文本气泡 -->
            <g opacity="0.9">
              <rect x="60" y="56" width="180" height="54" rx="16" fill="#ffffff" filter="url(#softShadow)" />
              <path d="M110 110l20 0-18 18z" fill="#ffffff" />
              <text x="78" y="90" fill="#0f172a" font-size="16" font-weight="700">深呼吸一下</text>
              <text x="168" y="90" fill="var(--app-color-primary)" font-size="16" font-weight="700">🙂</text>
            </g>
          </svg>
          <div class="illustration-caption">给自己一点温柔的空间</div>
        </div>
      </div>
    </section>

    <!-- 中部：核心功能卡片导航 -->
    <section class="quick-actions">
      <div class="section-title">你可以从这里开始</div>
      <div class="action-grid">
        <div class="action-card card-chat" role="button" tabindex="0" @click="goChat">
          <div class="card-icon">💬</div>
          <div class="card-title">开启 AI 对话</div>
          <div class="card-desc">随时倾诉你的烦恼，AI 心理咨询师 24 小时在线</div>
          <div class="card-arrow">立即进入 →</div>
        </div>

        <div class="action-card card-assessment" role="button" tabindex="0" @click="goAssessment">
          <div class="card-icon">📝</div>
          <div class="card-title">心理健康测评</div>
          <div class="card-desc">采用专业量表，全方位了解自己的心理状态</div>
          <div class="card-arrow">去测一测 →</div>
        </div>

        <div class="action-card card-report" role="button" tabindex="0" @click="goProfile">
          <div class="card-icon">📊</div>
          <div class="card-title">我的专属报告</div>
          <div class="card-desc">查看历史测评结果与情绪变化趋势</div>
          <div class="card-arrow">查看报告 →</div>
        </div>
      </div>
    </section>

    <!-- 下半部分：动态数据或疗愈内容 -->
    <section class="dynamic-content">
      <div class="content-grid">
        <el-card shadow="never" class="quote-card">
          <template #header>
            <div class="card-head">每日愈心一句</div>
          </template>
          <div class="quote-text">{{ todayQuote }}</div>
          <div class="quote-sub">每天一句，慢慢变好。</div>
        </el-card>

        <el-card shadow="never" class="activity-card">
          <template #header>
            <div class="card-head">最近活动概览</div>
          </template>
          <div v-if="pageLoading" class="activity-loading">
            <el-skeleton :rows="3" animated />
          </div>
          <div v-else class="activity-list">
            <div v-if="lastAssessmentSummary" class="activity-item">
              <div class="activity-dot dot-blue"></div>
              <div class="activity-text">{{ lastAssessmentSummary }}</div>
            </div>
            <div v-if="avgMood7dSummary" class="activity-item">
              <div class="activity-dot dot-amber"></div>
              <div class="activity-text">{{ avgMood7dSummary }}</div>
            </div>
            <el-empty
              v-if="!lastAssessmentSummary && !avgMood7dSummary"
              description="暂无可展示的数据，先从一次情绪打卡开始吧"
            />
          </div>
        </el-card>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-container {
  max-width: 1200px;
  margin: 0 auto;
}

/* ==================== 顶部 Hero ==================== */
.hero {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 18px;
  align-items: start;
}

.hero-left {
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 18px;
  padding: 18px;
}

.hero-title {
  font-size: 20px;
  font-weight: 800;
  color: #0f172a;
}

.hero-greeting {
  margin-top: 10px;
  font-size: 18px;
  font-weight: 700;
  color: var(--app-color-primary);
  line-height: 1.4;
}

.hero-subtitle {
  margin-top: 8px;
  font-size: 14px;
  color: #64748b;
  line-height: 1.7;
}

.hero-checkin {
  margin-top: 12px;
}

.hero-right {
  position: relative;
}

.illustration-card {
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  background: #fff;
}

.illustration {
  display: block;
  width: 100%;
  height: auto;
}

.illustration-caption {
  padding: 10px 14px 14px;
  color: #475569;
  font-size: 13px;
  font-weight: 600;
}

/* ==================== 快捷卡片 ==================== */
.quick-actions {
  margin-top: 18px;
}

.section-title {
  font-size: 15px;
  font-weight: 800;
  color: #0f172a;
  margin-bottom: 12px;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.action-card {
  border-radius: 18px;
  padding: 18px;
  cursor: pointer;
  user-select: none;
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  position: relative;
  overflow: hidden;
  outline: none;
}

.action-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 18px 32px rgba(15, 23, 42, 0.12);
}

.card-icon {
  font-size: 34px;
  line-height: 1;
}

.card-title {
  margin-top: 12px;
  font-size: 18px;
  font-weight: 900;
  color: #0f172a;
}

.card-desc {
  margin-top: 8px;
  font-size: 13px;
  color: rgba(15, 23, 42, 0.72);
  line-height: 1.7;
}

.card-arrow {
  margin-top: 14px;
  font-size: 13px;
  font-weight: 800;
  color: rgba(15, 23, 42, 0.7);
}

.card-chat {
  background: linear-gradient(135deg, #e0f2fe 0%, #ecfeff 60%, #ffffff 100%);
}

.card-assessment {
  background: linear-gradient(135deg, #fef3c7 0%, #fff7ed 60%, #ffffff 100%);
}

.card-report {
  background: linear-gradient(135deg, #ede9fe 0%, #fdf2f8 60%, #ffffff 100%);
}

/* ==================== 动态内容 ==================== */
.dynamic-content {
  margin-top: 16px;
}

.content-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.card-head {
  font-size: 14px;
  font-weight: 800;
  color: #0f172a;
}

.quote-card :deep(.el-card__body) {
  padding: 18px;
}

.quote-text {
  font-size: 18px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.7;
  letter-spacing: 0.2px;
}

.quote-sub {
  margin-top: 10px;
  font-size: 13px;
  color: #64748b;
}

.activity-card :deep(.el-card__body) {
  padding: 18px;
}

.activity-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 10px;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  background: #ffffff;
  margin-bottom: 10px;
}

.activity-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  margin-top: 4px;
  flex-shrink: 0;
}

.dot-blue {
  background: var(--app-color-primary);
}

.dot-amber {
  background: #f59e0b;
}

.activity-text {
  font-size: 13px;
  color: #334155;
  line-height: 1.7;
}

/* ==================== 响应式 ==================== */
@media (max-width: 1100px) {
  .action-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 992px) {
  .hero {
    grid-template-columns: 1fr;
  }
  .action-grid {
    grid-template-columns: 1fr;
  }
  .content-grid {
    grid-template-columns: 1fr;
  }
}
</style>
