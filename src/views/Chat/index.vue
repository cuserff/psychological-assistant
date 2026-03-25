<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import { useChatStore } from '../../store/chatStore'
import { useUserStore } from '../../store/userStore'
import { useChat } from '../../composables/useChat'
import { renderMarkdown } from '../../utils/markdown'
import VoiceRecorder from '../../components/input/VoiceRecorder.vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ChatDotRound,
  Refresh,
  Plus,
  Delete,
  ChatLineSquare,
  Close
} from '@element-plus/icons-vue'

const chatStore = useChatStore()
const userStore = useUserStore()
const { sendMessage } = useChat()
const inputMessage = ref('')
const chatContainer = ref(null)

onMounted(() => {
  chatStore.loadSessions()
  scrollToBottom()
})

// userInfo 异步到达后重新加载当前用户的会话数据（页面刷新场景）
watch(
  () => userStore.userInfo?.id,
  (userId) => {
    if (userId) {
      chatStore.loadSessions()
      scrollToBottom()
    }
  }
)

watch(
  () => chatStore.activeMessages.length,
  () => scrollToBottom()
)

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}

async function handleSend() {
  const content = inputMessage.value
  if (!content.trim() || chatStore.isGenerating) return
  inputMessage.value = ''

  // 无活跃会话时自动创建
  if (!chatStore.activeSession) {
    chatStore.createSession()
  }

  try {
    await sendMessage(content)
  } catch {
    ElMessage.error('获取 AI 回复失败，请稍后重试')
  } finally {
    scrollToBottom()
  }
}

function handleStop() {
  chatStore.stopGeneration()
  scrollToBottom()
}

// 快捷操作：自动创建会话并发送预设消息
async function handleQuickAction(text) {
  if (chatStore.isGenerating) return
  if (!chatStore.activeSession) {
    chatStore.createSession()
  }
  try {
    await sendMessage(text)
  } catch {
    ElMessage.error('获取 AI 回复失败，请稍后重试')
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

// 语音识别结果填入输入框
function handleVoiceResult(text) {
  inputMessage.value += text
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
            <span class="session-title">{{ session.title }}</span>
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
      <!-- 消息列表 -->
      <div class="chat-messages" ref="chatContainer">
        <div
          v-for="message in chatStore.activeMessages"
          :key="message.id"
          :class="['message-item', message.role === 'assistant' ? 'ai-message' : 'user-message']"
        >
          <!-- AI 消息：渲染 Markdown -->
          <div
            v-if="message.role === 'assistant'"
            class="message-content markdown-body"
            v-html="renderMarkdown(message.content)"
          />
          <!-- 用户消息：纯文本 -->
          <div v-else class="message-content">{{ message.content }}</div>
        </div>

        <!-- 正在思考指示器 -->
        <div v-if="chatStore.isGenerating" class="message-item ai-message">
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

      <!-- 输入区域 -->
      <div class="input-area">
        <div class="input-row">
          <el-input
            v-model="inputMessage"
            placeholder="问问小愈..."
            @keyup.enter="handleSend"
            :disabled="chatStore.isGenerating"
            type="textarea"
            :rows="3"
            resize="none"
          />
          <div class="input-actions">
            <VoiceRecorder @result="handleVoiceResult" />
            <el-button
              class="send-btn"
              type="primary"
              @click="handleSend"
              :disabled="chatStore.isGenerating || !inputMessage.trim()"
              :icon="chatStore.isGenerating ? Refresh : ChatDotRound"
              :loading="chatStore.isGenerating"
            >
              {{ chatStore.isGenerating ? '生成中...' : '发送' }}
            </el-button>
            <el-button
              v-if="chatStore.isGenerating"
              class="stop-btn"
              type="danger"
              @click="handleStop"
              :icon="Close"
            >
              停止
            </el-button>
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
  height: 100%;
  gap: 0;
}

/* ==================== 会话列表面板 ==================== */

.session-panel {
  width: 260px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
}

.session-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #f0f0f0;
}

.session-header-title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.session-item {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-bottom: 4px;
}

.session-item:hover {
  background-color: #f1f5f9;
}

.session-item.active {
  background-color: #e0f2fe;
}

.session-item-content {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.session-icon {
  color: #94a3b8;
  flex-shrink: 0;
  font-size: 14px;
}

.session-item.active .session-icon {
  color: #0284c7;
}

.session-title {
  font-size: 13px;
  color: #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 22px;
}

.session-time {
  font-size: 11px;
  color: #94a3b8;
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
  color: #94a3b8;
  font-size: 13px;
  line-height: 2;
}

/* ==================== 对话区 ==================== */

.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #f5f5f5;
  min-width: 0;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background-color: #fafafa;
}

/* ==================== 欢迎界面 ==================== */

.welcome-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  animation: fadeIn 0.5s ease-in;
}

.welcome-greeting {
  font-size: 16px;
  color: #64748b;
}

.welcome-title {
  font-size: 32px;
  font-weight: 600;
  color: #1e293b;
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
  background-color: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 24px;
  cursor: pointer;
  font-size: 14px;
  color: #334155;
  transition: all 0.2s;
  user-select: none;
}

.quick-action-item:hover {
  background-color: #f0f9ff;
  border-color: #0284c7;
  color: #0284c7;
  box-shadow: 0 2px 8px rgba(2, 132, 199, 0.12);
}

.quick-action-icon {
  font-size: 18px;
}

.message-item {
  margin-bottom: 20px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  animation: fadeIn 0.3s ease-in;
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
  background-color: #0284c7;
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out;
}

.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }

.typing-text {
  color: #666;
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
  max-width: 70%;
  padding: 14px 18px;
  border-radius: 18px;
  font-size: 15px;
  line-height: 1.5;
  word-wrap: break-word;
}

/* 用户消息保留 pre-wrap */
.user-message .message-content {
  white-space: pre-wrap;
}

.ai-message .message-content {
  background-color: #fff;
  border: 1px solid #e8e8e8;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.user-message .message-content {
  background-color: #0284c7;
  color: white;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* ==================== 输入区 ==================== */

.input-area {
  padding: 16px 20px;
  background-color: #fff;
  border-top: 1px solid #e8e8e8;
}

.input-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.input-row :deep(.el-textarea) {
  flex: 1;
}

.input-area :deep(.el-textarea__inner) {
  border-radius: 12px;
  border-color: #e8e8e8;
  resize: none;
  font-size: 15px;
}

.input-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.input-area :deep(.send-btn) {
  border-radius: 12px;
  padding: 8px 20px;
  font-size: 14px;
  background-color: #0284c7;
  border: none;
  margin: 0;
}

.input-area :deep(.send-btn:hover) {
  background-color: #0ea5e9;
}

.input-area :deep(.send-btn.is-disabled) {
  background-color: #93c5fd;
  cursor: not-allowed;
}

.input-area :deep(.stop-btn) {
  border-radius: 12px;
  padding: 8px 20px;
  font-size: 14px;
  background-color: #ef4444;
  border: none;
}

.input-area :deep(.stop-btn:hover) {
  background-color: #dc2626;
}
</style>
