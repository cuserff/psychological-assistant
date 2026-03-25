import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getItem, setItem } from '../utils/storage'
import { useUserStore } from './userStore'
import { fetchSessions as apiFetchSessions, saveSessionsToServer, deleteSessionFromServer } from '../api/chat'

/**
 * @typedef {'user' | 'assistant' | 'system'} MessageRole
 *
 * @typedef {Object} Message
 * @property {string}      id        唯一标识
 * @property {MessageRole} role      角色
 * @property {string}      content   文本内容
 * @property {string}      timestamp ISO 时间戳
 *
 * @typedef {Object} ChatSession
 * @property {string}    id        会话唯一标识
 * @property {string}    title     会话标题（首条用户消息的前 20 字）
 * @property {Message[]} messages  消息列表
 * @property {string}    createdAt 创建时间
 * @property {string}    updatedAt 最后更新时间
 */

const STORAGE_KEY_PREFIX = 'mental_health_chat_'
const WELCOME_TEXT = '你好！我是你的智能心理助手，有什么可以帮助你的吗？'

export const useChatStore = defineStore('chat', () => {
  // ==================== 状态 ====================

  /** @type {import('vue').Ref<ChatSession[]>} */
  const sessions = ref([])
  /** @type {import('vue').Ref<string|null>} */
  const activeSessionId = ref(null)
  const isGenerating = ref(false)

  // ==================== 计算属性 ====================

  const activeSession = computed(() =>
    sessions.value.find(s => s.id === activeSessionId.value) || null
  )

  const activeMessages = computed(() =>
    activeSession.value?.messages || []
  )

  // ==================== 用户隔离存储 ====================

  /**
   * 根据当前登录用户 ID 生成隔离的 localStorage 键
   * @returns {string|null} 存储键，用户未登录时返回 null
   */
  function getStorageKey() {
    const userStore = useUserStore()
    const userId = userStore.userInfo?.id
    return userId ? `${STORAGE_KEY_PREFIX}${userId}` : null
  }

  // ==================== 持久化 ====================

  /**
   * 加载会话：优先从后端获取，失败时 fallback 到 localStorage
   */
  async function loadSessions() {
    const key = getStorageKey()
    if (!key) return

    try {
      // 优先从后端加载
      const res = await apiFetchSessions()
      const serverSessions = res.data
      if (Array.isArray(serverSessions) && serverSessions.length > 0) {
        sessions.value = serverSessions
        // 同步写入 localStorage 作为缓存
        setItem(key, serverSessions)
        if (!activeSessionId.value) {
          activeSessionId.value = sessions.value[0].id
        }
        return
      }
    } catch {
      // 后端请求失败，静默降级到 localStorage
    }

    // fallback：从 localStorage 加载
    const saved = getItem(key)
    if (Array.isArray(saved) && saved.length > 0) {
      sessions.value = saved
      if (!activeSessionId.value) {
        activeSessionId.value = sessions.value[0].id
      }
    } else {
      sessions.value = []
      activeSessionId.value = null
    }
  }

  /**
   * 保存会话：同时写入 localStorage（快速缓存）和后端（持久化）
   */
  function saveSessions() {
    const key = getStorageKey()
    if (!key) return
    // localStorage 立即写入，保证响应速度
    setItem(key, sessions.value)
    // 异步同步到后端，不阻塞 UI
    saveSessionsToServer(sessions.value).catch(() => {})
  }

  // ==================== 会话管理 ====================

  function createSession() {
    const now = new Date().toISOString()
    /** @type {ChatSession} */
    const newSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: '新对话',
      messages: [
        {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: WELCOME_TEXT,
          timestamp: now
        }
      ],
      createdAt: now,
      updatedAt: now
    }
    sessions.value.unshift(newSession)
    activeSessionId.value = newSession.id
    saveSessions()
    return newSession
  }

  function switchSession(sessionId) {
    if (sessions.value.some(s => s.id === sessionId)) {
      activeSessionId.value = sessionId
    }
  }

  function deleteSession(sessionId) {
    const index = sessions.value.findIndex(s => s.id === sessionId)
    if (index === -1) return
    sessions.value.splice(index, 1)

    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value.length > 0
        ? sessions.value[0].id
        : null
    }
    saveSessions()
    // 同步删除后端数据
    deleteSessionFromServer(sessionId).catch(() => {})
  }

  function clearAllSessions() {
    sessions.value = []
    activeSessionId.value = null
    saveSessions()
  }

  // ==================== 消息原语（供 useChat 组合式函数调用）====================

  /**
   * 向活跃会话追加一条用户消息，自动生成会话标题并持久化
   * @param {string} content 用户输入文本
   */
  function addUserMessage(content) {
    const session = activeSession.value
    if (!session) return

    session.messages.push({
      id: `msg_${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date().toISOString()
    })
    session.updatedAt = new Date().toISOString()

    if (session.title === '新对话') {
      const trimmed = content.trim()
      session.title = trimmed.length > 20 ? trimmed.slice(0, 20) + '...' : trimmed
    }

    saveSessions()
  }

  /**
   * 向活跃会话追加一条空的 assistant 占位消息
   * @returns {number} 该消息在 messages 数组中的索引，用于后续流式追加
   */
  function createAssistantPlaceholder() {
    const session = activeSession.value
    if (!session) return -1

    session.messages.push({
      id: `msg_${Date.now() + 1}`,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString()
    })

    return session.messages.length - 1
  }

  /**
   * 向指定索引的 assistant 消息追加增量文本（流式场景）
   * @param {number} msgIndex 消息索引
   * @param {string} delta    增量文本
   */
  function appendAssistantDelta(msgIndex, delta) {
    const session = activeSession.value
    if (!session || msgIndex < 0) return
    session.messages[msgIndex].content += delta
  }

  /**
   * 流式结束后的收尾操作：若 assistant 回复为空则填入错误提示，然后持久化
   * @param {number} msgIndex 消息索引
   */
  function finalizeReply(msgIndex) {
    const session = activeSession.value
    if (!session || msgIndex < 0) return

    if (!session.messages[msgIndex].content) {
      session.messages[msgIndex].content = '抱歉，回复生成失败，请稍后重试。'
    }

    session.updatedAt = new Date().toISOString()
    saveSessions()
  }

  /**
   * 清空内存中的会话状态（用于用户登出，不影响 localStorage 中已持久化的数据）
   */
  function resetStore() {
    sessions.value = []
    activeSessionId.value = null
    isGenerating.value = false
  }

  return {
    // 状态
    sessions,
    activeSessionId,
    isGenerating,
    // 计算属性
    activeSession,
    activeMessages,
    // 持久化
    loadSessions,
    saveSessions,
    // 会话管理
    createSession,
    switchSession,
    deleteSession,
    clearAllSessions,
    // 消息原语
    addUserMessage,
    createAssistantPlaceholder,
    appendAssistantDelta,
    finalizeReply,
    // 生命周期
    resetStore
  }
})
