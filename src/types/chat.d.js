/**
 * 会话模型与消息模型的数据结构定义
 *
 * @typedef {'user' | 'assistant' | 'system'} MessageRole
 *
 * @typedef {Object} Message
 * @property {number} id
 * @property {MessageRole} role
 * @property {string} content
 * @property {string} timestamp
 *
 * @typedef {Object} ChatSession
 * @property {string} id
 * @property {string} title
 * @property {Message[]} messages
 * @property {string} createdAt
 */

export {}
