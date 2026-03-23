<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import { useChatStore } from '../../store/chatStore'
import { useUserStore } from '../../store/userStore'
import { useChat } from '../../composables/useChat'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ChatDotRound,
  Refresh,
  Plus,
  Delete,
  ChatLineSquare
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

  try {
    await sendMessage(content)
  } catch {
    ElMessage.error('获取 AI 回复失败，请稍后重试')
  } finally {
    scrollToBottom()
  }
}

function handleNewSession() {
  chatStore.createSession()
  scrollToBottom()
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
          <div class="message-content">{{ message.content }}</div>
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

        <!-- 无活跃会话时的引导 -->
        <div v-if="!chatStore.activeSession" class="chat-empty-guide">
          <el-icon :size="48" color="#cbd5e1"><ChatDotRound /></el-icon>
          <p>点击左侧「新对话」开始聊天</p>
        </div>
      </div>

      <!-- 输入区域 -->
      <div class="input-area">
        <el-input
          v-model="inputMessage"
          placeholder="请输入消息..."
          @keyup.enter="handleSend"
          :disabled="chatStore.isGenerating || !chatStore.activeSession"
          type="textarea"
          :rows="3"
          resize="none"
        />
        <el-button
          type="primary"
          @click="handleSend"
          :disabled="chatStore.isGenerating || !inputMessage.trim() || !chatStore.activeSession"
          :icon="chatStore.isGenerating ? Refresh : ChatDotRound"
          :loading="chatStore.isGenerating"
        >
          {{ chatStore.isGenerating ? '生成中...' : '发送' }}
        </el-button>
      </div>
    </div>
  </div>
</template>

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

.chat-empty-guide {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: #94a3b8;
  font-size: 15px;
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
  padding: 20px;
  background-color: #fff;
  border-top: 1px solid #e8e8e8;
}

.input-area :deep(.el-textarea__inner) {
  border-radius: 12px;
  border-color: #e8e8e8;
  resize: none;
  font-size: 15px;
}

.input-area :deep(.el-button) {
  margin-top: 12px;
  border-radius: 12px;
  padding: 8px 24px;
  font-size: 15px;
  background-color: #0284c7;
  border: none;
}

.input-area :deep(.el-button:hover) {
  background-color: #0ea5e9;
}

.input-area :deep(.el-button.is-disabled) {
  background-color: #93c5fd;
  cursor: not-allowed;
}
</style>
