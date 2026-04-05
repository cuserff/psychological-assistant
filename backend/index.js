const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const dotenv = require('dotenv');
const WebSocket = require('ws');
const { createRtasrSttSession } = require('./sttRtasrSession');

dotenv.config();

const app = express();
const API_KEY = process.env.XUNFEI_API_KEY;
/** 讯飞 MaaS：模型与网关路径建议配在 .env，避免改代码 */
const MAAS_MODEL = process.env.XUNFEI_MAAS_MODEL || 'xopqwen35v35b';
const MAAS_HOST = process.env.XUNFEI_MAAS_HOST || 'maas-api.cn-huabei-1.xf-yun.com';
const MAAS_PATH = process.env.XUNFEI_MAAS_PATH || '/v2/chat/completions';
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mental-health-assistant-jwt-secret';

/**
 * 在线 TTS：默认走讯飞「流式版」WebSocket v2（与控制台「在线语音合成-流式版」一致）；
 * 旧版 HTTP 可设 TTS_PROVIDER=xunfei-webapi
 */
const TTS_PROVIDER = process.env.TTS_PROVIDER || 'xunfei-ws';
const XUNFEI_TTS_HOST = process.env.XUNFEI_TTS_HOST || 'api.xfyun.cn';
const XUNFEI_TTS_PATH = process.env.XUNFEI_TTS_PATH || '/v1/service/v1/tts';
const XUNFEI_RTS_WS_HOST = process.env.XUNFEI_TTS_WS_HOST || 'tts-api.xfyun.cn';
const XUNFEI_RTS_WS_PATH = process.env.XUNFEI_TTS_WS_PATH || '/v2/tts';
/** 流式发音人 vcn，如控制台「讯飞小燕」对应 x4_xiaoyan */
const XUNFEI_TTS_VCN = process.env.XUNFEI_TTS_VCN || 'x4_xiaoyan';
const XUNFEI_TTS_APP_ID = process.env.XUNFEI_TTS_APP_ID || '';
const XUNFEI_TTS_API_KEY = process.env.XUNFEI_TTS_API_KEY || '';
const XUNFEI_TTS_API_SECRET = process.env.XUNFEI_TTS_API_SECRET || '';

/** 短音频转写（POST /api/voice/stt）：默认讯飞「语音听写 流式版」WebSocket v2 */
const STT_PROVIDER = process.env.STT_PROVIDER || 'xunfei-iat-ws';
const XUNFEI_STT_WS_HOST = process.env.XUNFEI_STT_WS_HOST || 'iat-api.xfyun.cn';
const XUNFEI_STT_WS_PATH = process.env.XUNFEI_STT_WS_PATH || '/v2/iat';
const XUNFEI_RTASR_APP_ID = process.env.XUNFEI_RTASR_APP_ID || '';
const XUNFEI_RTASR_API_KEY = process.env.XUNFEI_RTASR_API_KEY || '';
const XUNFEI_RTASR_API_SECRET = process.env.XUNFEI_RTASR_API_SECRET || '';
const XUNFEI_STT_APP_ID = process.env.XUNFEI_STT_APP_ID || XUNFEI_RTASR_APP_ID || XUNFEI_TTS_APP_ID;
const XUNFEI_STT_API_KEY = process.env.XUNFEI_STT_API_KEY || XUNFEI_RTASR_API_KEY || XUNFEI_TTS_API_KEY;
const XUNFEI_STT_API_SECRET = process.env.XUNFEI_STT_API_SECRET || XUNFEI_RTASR_API_SECRET || XUNFEI_TTS_API_SECRET;
const STT_MAX_AUDIO_BYTES = Math.min(
  4 * 1024 * 1024,
  Math.max(1024, Number(process.env.STT_MAX_AUDIO_BYTES || 2 * 1024 * 1024))
);

/** /ws/stt：长时间无客户端 audio 则自动结束（毫秒） */
const STT_WS_IDLE_TIMEOUT_MS = Math.min(
  120000,
  Math.max(3000, Number(process.env.STT_WS_IDLE_TIMEOUT_MS || 15000))
);
/** 连接讯飞听写上游的最长等待（毫秒） */
const STT_WS_UPSTREAM_CONNECT_MS = Math.min(
  60000,
  Math.max(3000, Number(process.env.STT_WS_UPSTREAM_CONNECT_MS || 10000))
);
/** 单路实时会话最长时间（毫秒），超时主动结束 */
const STT_WS_UPSTREAM_SESSION_MS = Math.min(
  180000,
  Math.max(30000, Number(process.env.STT_WS_UPSTREAM_SESSION_MS || 120000))
);
/** PCM 分片上行字节数（16k 单声道官方建议 1280） */
const STT_WS_PCM_FRAME_BYTES = Math.min(
  8192,
  Math.max(320, Number(process.env.STT_WS_PCM_FRAME_BYTES || 1280))
);
/** stop 后等待上游 final 的超时（毫秒） */
const STT_WS_STOP_WAIT_MS = Math.min(
  30000,
  Math.max(2000, Number(process.env.STT_WS_STOP_WAIT_MS || 12000))
);
/** 客户端单次 audio 解码后的最大字节数（防止畸形大包） */
const STT_WS_MAX_CLIENT_CHUNK_BYTES = Math.min(
  65536,
  Math.max(1024, Number(process.env.STT_WS_MAX_CLIENT_CHUNK_BYTES || 32768))
);
/** 任意连续 1 秒内允许的 audio 消息条数上限（与前端 ~280ms 分片节奏匹配，略留余量） */
const STT_WS_MAX_AUDIO_MSG_PER_SEC = Math.min(
  250,
  Math.max(15, Number(process.env.STT_WS_MAX_AUDIO_MSG_PER_SEC || 90))
);
/** 单路会话累计上行 PCM 字节上限（与 STT_WS_UPSTREAM_SESSION_MS 叠加，防长时间灌流） */
const STT_WS_MAX_SESSION_INGEST_BYTES = Math.min(
  100 * 1024 * 1024,
  Math.max(
    2 * 1024 * 1024,
    Number(process.env.STT_WS_MAX_SESSION_INGEST_BYTES || 15 * 1024 * 1024)
  )
);
const XUNFEI_STT_LANGUAGE = process.env.XUNFEI_STT_LANGUAGE || 'zh_cn';
const XUNFEI_STT_DOMAIN = process.env.XUNFEI_STT_DOMAIN || 'iat';
const XUNFEI_STT_ACCENT = process.env.XUNFEI_STT_ACCENT || 'mandarin';
const XUNFEI_STT_SAMPLE_RATE = (() => {
  const raw = Number(process.env.XUNFEI_STT_SAMPLE_RATE || 16000);
  return raw === 8000 || raw === 16000 ? raw : 16000;
})();

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_DIR = path.join(DATA_DIR, 'chats');
const CHECKINS_DIR = path.join(DATA_DIR, 'checkins');
const ASSESSMENTS_DIR = path.join(DATA_DIR, 'assessments');
const DIARIES_DIR = path.join(DATA_DIR, 'diaries');
/** 聊天配图持久化目录：uploads/chat/{userId}/文件名 */
const CHAT_UPLOAD_ROOT = path.join(DATA_DIR, 'uploads', 'chat');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR, { recursive: true });
}
if (!fs.existsSync(CHECKINS_DIR)) {
  fs.mkdirSync(CHECKINS_DIR, { recursive: true });
}
if (!fs.existsSync(ASSESSMENTS_DIR)) {
  fs.mkdirSync(ASSESSMENTS_DIR, { recursive: true });
}
if (!fs.existsSync(DIARIES_DIR)) {
  fs.mkdirSync(DIARIES_DIR, { recursive: true });
}
if (!fs.existsSync(CHAT_UPLOAD_ROOT)) {
  fs.mkdirSync(CHAT_UPLOAD_ROOT, { recursive: true });
}
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, '[]', 'utf-8');
}

// 中间件
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// 对话含多模态时 body 可达数 MB，默认 100kb 会导致解析失败并悄悄走前端「纯文本降级」，模型永远“看不见图”
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '15mb' }));

// 聊天上传的图片静态访问（路径含随机 UUID，勿在公开场合分享链接）
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads')));

const chatImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(CHAT_UPLOAD_ROOT, req.user.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      const useExt = allowed.includes(ext) ? ext : '.jpg';
      cb(null, `${crypto.randomUUID()}${useExt}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (mime.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('仅支持上传图片文件'));
    }
  }
});

// ==================== 进程内可观测（环形延迟样本 + 错误计数，不含原文） ====================
const SERVER_OBS_MAX_SAMPLES = 120;
/** @type {Record<string, number[]>} */
const serverObsHistograms = Object.create(null);
const serverObsErrors = {
  stt: Object.create(null),
  tts: Object.create(null),
  llm: Object.create(null),
  wsStt: Object.create(null)
};

/**
 * @param {string} name
 * @param {number} valueMs
 */
function recordServerLatencySample(name, valueMs) {
  if (typeof valueMs !== 'number' || !Number.isFinite(valueMs) || valueMs < 0 || valueMs > 600000) {
    return;
  }
  if (!serverObsHistograms[name]) serverObsHistograms[name] = [];
  serverObsHistograms[name].push(Math.round(valueMs));
  const bucket = serverObsHistograms[name];
  if (bucket.length > SERVER_OBS_MAX_SAMPLES) {
    bucket.splice(0, bucket.length - SERVER_OBS_MAX_SAMPLES);
  }
}

/**
 * @param {'stt'|'tts'|'llm'|'wsStt'} category
 * @param {string} code
 */
function recordServerError(category, code) {
  const key = String(code || 'unknown').slice(0, 64);
  if (!serverObsErrors[category]) serverObsErrors[category] = Object.create(null);
  serverObsErrors[category][key] = (serverObsErrors[category][key] || 0) + 1;
}

function getServerObservabilitySnapshot() {
  /** @type {Record<string, number[]>} */
  const histogramsCopy = Object.create(null);
  for (const [metricName, samples] of Object.entries(serverObsHistograms)) {
    histogramsCopy[metricName] = Array.isArray(samples) ? [...samples] : [];
  }
  return {
    histograms: histogramsCopy,
    errors: {
      stt: { ...serverObsErrors.stt },
      tts: { ...serverObsErrors.tts },
      llm: { ...serverObsErrors.llm },
      wsStt: { ...serverObsErrors.wsStt }
    },
    updatedAt: new Date().toISOString()
  };
}

// ==================== 工具函数 ====================

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function writeUsers(users) {
  for (const userItem of users) {
    if (userItem && Object.prototype.hasOwnProperty.call(userItem, 'displayPassword')) {
      delete userItem.displayPassword;
    }
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

/** 生成管理员重置用临时口令（仅出现在单次接口响应中，绝不写入磁盘） */
function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const randomBytes = crypto.randomBytes(14);
  let result = '';
  for (let index = 0; index < 14; index += 1) {
    result += alphabet[randomBytes[index] % alphabet.length];
  }
  return result;
}

// 读取指定用户的聊天记录，文件不存在则返回空数组
function readUserChats(userId) {
  const filePath = path.join(CHATS_DIR, `${userId}.json`);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// 写入指定用户的聊天记录
function writeUserChats(userId, sessions) {
  const filePath = path.join(CHATS_DIR, `${userId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(sessions, null, 2), 'utf-8');
}

// 读取指定用户的情绪打卡记录，文件不存在则返回空数组
function readUserCheckins(userId) {
  const filePath = path.join(CHECKINS_DIR, `${userId}.json`);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// 写入指定用户的情绪打卡记录
function writeUserCheckins(userId, checkins) {
  const filePath = path.join(CHECKINS_DIR, `${userId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(checkins, null, 2), 'utf-8');
}

// 读取指定用户的测评记录，文件不存在则返回空数组
function readUserAssessments(userId) {
  const filePath = path.join(ASSESSMENTS_DIR, `${userId}.json`);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// 写入指定用户的测评记录
function writeUserAssessments(userId, records) {
  const filePath = path.join(ASSESSMENTS_DIR, `${userId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');
}

// ==================== 日记（按用户 JSON 持久化） ====================

/** 读取指定用户的日记列表，文件不存在则返回 [] */
function readUserDiaries(userId) {
  const filePath = path.join(DIARIES_DIR, `${userId}.json`);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/** 全量写入用户日记 */
function writeUserDiaries(userId, entries) {
  const filePath = path.join(DIARIES_DIR, `${userId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
}

function defaultDiaryTitleForUser() {
  return `${getTodayLocalDate()} 对话日记`;
}

/** 列表预览：单行约 120 字 */
function buildDiaryPreviewText(fullContent) {
  const raw = String(fullContent || '').replace(/\s+/g, ' ').trim();
  if (raw.length <= 120) return raw;
  return `${raw.slice(0, 117)}…`;
}

const DIARY_MAX_CONTENT_LEN = 10000;
const DIARY_MAX_TITLE_LEN = 80;

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function migrateRemoveDisplayPasswordFromDisk() {
  const users = readUsers();
  let changed = false;
  for (const userItem of users) {
    if (userItem && Object.prototype.hasOwnProperty.call(userItem, 'displayPassword')) {
      delete userItem.displayPassword;
      changed = true;
    }
  }
  if (changed) writeUsers(users);
}

function getTodayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * 讯飞 WebAPI 鉴权头（在线语音合成 HTTP /v1/service/v1/tts）：
 * - X-CheckSum = MD5(apiKey + curTime + paramBase64)（32 位小写；与官方示例一致）
 *
 * 注意：必须用控制台「APIKey」拼接 MD5，误用 APISecret 会导致 illegal access / no appid 类错误。
 */
function buildXunfeiWebApiHeaders({ appId, apiKey, paramObject }) {
  const curTime = String(Math.floor(Date.now() / 1000));
  const paramBase64 = Buffer.from(JSON.stringify(paramObject || {})).toString('base64');
  const checkSum = crypto
    .createHash('md5')
    .update(String(apiKey || '') + curTime + paramBase64, 'utf-8')
    .digest('hex');

  return {
    'X-Appid': String(appId || ''),
    'X-CurTime': curTime,
    'X-Param': paramBase64,
    'X-CheckSum': checkSum,
    'X-Real-Ip': '127.0.0.1'
  };
}

/**
 * 讯飞「在线语音合成 流式版」WebSocket：wss://tts-api.xfyun.cn/v2/tts
 * 鉴权与官方文档一致（hmac-sha256 + authorization query）
 *
 * @returns {Promise<Buffer>} 拼接后的音频（aue=lame 时为 mp3）
 */
function xunfeiTtsWsSynthesizeBuffer({
  text,
  appId,
  apiKey,
  apiSecret,
  vcn,
  aue,
  speed,
  volume,
  pitch,
  timeoutMs = 55000
}) {
  const host = XUNFEI_RTS_WS_HOST;
  const wsPath = XUNFEI_RTS_WS_PATH;
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${wsPath} HTTP/1.1`;
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(signatureOrigin)
    .digest('base64');
  const authorizationOrigin =
    `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;

  const authorization = Buffer.from(authorizationOrigin, 'utf-8').toString('base64');
  const query = new URLSearchParams({ authorization, date, host });
  const wsUrl = `wss://${host}${wsPath}?${query.toString()}`;

  return new Promise((resolve, reject) => {
    const audioChunks = [];
    let finished = false;
    let socket = null;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          if (socket) socket.close();
        } catch {
          // ignore
        }
        reject(new Error('TTS WebSocket 超时'));
      }
    }, timeoutMs);

    try {
      socket = new WebSocket(wsUrl);
    } catch (connectError) {
      clearTimeout(timer);
      reject(connectError);
      return;
    }

    function finalizeSuccess() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // ignore
      }
      const buffer = Buffer.concat(audioChunks);
      if (!buffer.length) {
        reject(new Error('TTS 未返回音频数据'));
        return;
      }
      resolve(buffer);
    }

    function finalizeError(message) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // ignore
      }
      reject(new Error(message));
    }

    socket.on('open', () => {
      const textBase64 = Buffer.from(text, 'utf-8').toString('base64');
      const business = {
        aue,
        auf: 'audio/L16;rate=16000',
        vcn,
        speed,
        volume,
        pitch,
        bgs: 0,
        tte: 'UTF8'
      };
      if (aue === 'lame') {
        business.sfl = 1;
      }
      const frame = {
        common: { app_id: appId },
        business,
        data: {
          status: 2,
          text: textBase64
        }
      };
      socket.send(JSON.stringify(frame));
    });

    socket.on('message', (raw) => {
      if (finished) return;
      let messageJson;
      try {
        messageJson = JSON.parse(String(raw || ''));
      } catch {
        return;
      }
      const code = Number(messageJson.code);
      if (!Number.isFinite(code)) {
        return;
      }
      if (code !== 0) {
        const errText = messageJson.message || messageJson.desc || String(code);
        finalizeError(`TTS 上游：${errText}`);
        return;
      }
      const data = messageJson.data;
      if (data && typeof data.audio === 'string' && data.audio.length > 0) {
        try {
          audioChunks.push(Buffer.from(data.audio, 'base64'));
        } catch {
          finalizeError('TTS 音频片段 Base64 无效');
        }
      }
      if (data && Number(data.status) === 2) {
        finalizeSuccess();
      }
    });

    socket.on('error', (wsError) => {
      finalizeError(wsError?.message || 'TTS WebSocket 错误');
    });

    socket.on('close', () => {
      if (finished) return;
      if (audioChunks.length > 0) {
        finalizeSuccess();
      } else {
        finalizeError('TTS 连接已关闭且无音频');
      }
    });
  });
}

/**
 * 从上传的 WAV（或裸 PCM）解析出 pcm 与格式信息
 * @returns {{ ok: boolean, message?: string, pcm?: Buffer, sampleRate?: number, numChannels?: number, bitsPerSample?: number }}
 */
function extractPcm16MonoFromUpload(buffer) {
  if (!buffer || buffer.length < 12) {
    return { ok: false, message: '音频过短' };
  }
  const riff = buffer.toString('ascii', 0, 4);
  if (riff !== 'RIFF') {
    return {
      ok: true,
      pcm: buffer,
      sampleRate: 16000,
      numChannels: 1,
      bitsPerSample: 16
    };
  }
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { ok: false, message: '无效的 WAV 文件' };
  }
  let walk = 12;
  let sampleRate = 16000;
  let numChannels = 1;
  let bitsPerSample = 16;
  /** @type {Buffer|null} */
  let pcm = null;
  while (walk + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', walk, walk + 4);
    const chunkSize = buffer.readUInt32LE(walk + 4);
    const payloadStart = walk + 8;
    const nextChunk = payloadStart + chunkSize + (chunkSize % 2);
    if (chunkId === 'fmt ') {
      numChannels = buffer.readUInt16LE(payloadStart + 2);
      sampleRate = buffer.readUInt32LE(payloadStart + 4);
      bitsPerSample = buffer.readUInt16LE(payloadStart + 14);
    } else if (chunkId === 'data') {
      pcm = buffer.subarray(payloadStart, payloadStart + chunkSize);
      break;
    }
    walk = nextChunk;
  }
  if (!pcm || pcm.length === 0) {
    return { ok: false, message: 'WAV 中无 data 音频块' };
  }
  return { ok: true, pcm, sampleRate, numChannels, bitsPerSample };
}

function collectIatTextFromWsResult(result) {
  if (!result || !Array.isArray(result.ws)) return '';
  const parts = [];
  for (const wsItem of result.ws) {
    if (!wsItem || !Array.isArray(wsItem.cw)) continue;
    for (const cwItem of wsItem.cw) {
      if (cwItem != null && cwItem.w != null && String(cwItem.w) !== '') {
        parts.push(String(cwItem.w));
      }
    }
  }
  return parts.join('');
}

/**
 * 讯飞语音听写流式版 WebSocket：整段 PCM 单帧上传（status=2）
 * @returns {Promise<{ text: string }>}
 */
function xunfeiIatWsTranscribePcm({ pcmBuffer, appId, apiKey, apiSecret, timeoutMs = 65000 }) {
  const host = XUNFEI_STT_WS_HOST;
  const wsPath = XUNFEI_STT_WS_PATH;
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${wsPath} HTTP/1.1`;
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(signatureOrigin)
    .digest('base64');
  const authorizationOrigin =
    `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin, 'utf-8').toString('base64');
  const query = new URLSearchParams({ authorization, date, host });
  const wsUrl = `wss://${host}${wsPath}?${query.toString()}`;

  const firstFrame = {
    common: { app_id: String(appId) },
    business: {
      language: 'zh_cn',
      domain: 'iat',
      accent: 'mandarin'
    },
    data: {
      status: 2,
      format: 'audio/L16;rate=16000',
      encoding: 'raw',
      audio: pcmBuffer.toString('base64')
    }
  };

  return new Promise((resolve, reject) => {
    let textAccum = '';
    let finished = false;
    let socket = null;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          if (socket) socket.close();
        } catch {
          // ignore
        }
        reject(new Error('语音听写 WebSocket 超时'));
      }
    }, timeoutMs);

    function doneOk() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        if (socket) socket.close();
      } catch {
        // ignore
      }
      resolve({ text: textAccum.trim() });
    }

    function doneErr(message) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        if (socket) socket.close();
      } catch {
        // ignore
      }
      reject(new Error(message));
    }

    try {
      socket = new WebSocket(wsUrl);
    } catch (connectError) {
      clearTimeout(timer);
      reject(connectError);
      return;
    }

    socket.on('open', () => {
      socket.send(JSON.stringify(firstFrame));
    });

    socket.on('message', (raw) => {
      if (finished) return;
      let messageJson;
      try {
        messageJson = JSON.parse(String(raw || ''));
      } catch {
        return;
      }
      const code = Number(messageJson.code);
      if (!Number.isFinite(code)) return;
      if (code !== 0) {
        doneErr(messageJson.message || messageJson.desc || `听写错误码 ${code}`);
        return;
      }
      const data = messageJson.data;
      if (data && data.result) {
        textAccum += collectIatTextFromWsResult(data.result);
      }
      if (data && Number(data.status) === 2) {
        doneOk();
      }
    });

    socket.on('error', (wsError) => {
      doneErr(wsError?.message || '听写 WebSocket 错误');
    });

    socket.on('close', () => {
      if (finished) return;
      doneOk();
    });
  });
}

function buildXunfeiIatWsUrl(appId, apiKey, apiSecret) {
  const host = XUNFEI_STT_WS_HOST;
  const wsPath = XUNFEI_STT_WS_PATH;
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${wsPath} HTTP/1.1`;
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(signatureOrigin)
    .digest('base64');
  const authorizationOrigin =
    `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin, 'utf-8').toString('base64');
  const query = new URLSearchParams({ authorization, date, host });
  return `wss://${host}${wsPath}?${query.toString()}`;
}

/**
 * 讯飞「实时语音转写标准版」WebSocket：仅需 APPID + APIKey（HMAC-SHA1 签名，不需 APISecret）
 * @see https://www.xfyun.cn/doc/asr/rtasr/API.html
 */
function buildXunfeiRtasrWsUrl(appId, apiKey) {
  const ts = Math.floor(Date.now() / 1000);
  const baseString = `${String(appId)}${ts}`;
  const md5Hex = crypto.createHash('md5').update(baseString, 'utf8').digest('hex');
  const signa = crypto.createHmac('sha1', String(apiKey)).update(md5Hex).digest('base64');
  const params = new URLSearchParams({
    appid: String(appId),
    ts: String(ts),
    signa
  });
  const rtasrLang = process.env.XUNFEI_RTASR_LANG;
  if (rtasrLang && String(rtasrLang).trim()) {
    params.set('lang', String(rtasrLang).trim());
  }
  const rtasrPd = process.env.XUNFEI_RTASR_PD;
  if (rtasrPd && String(rtasrPd).trim()) {
    params.set('pd', String(rtasrPd).trim());
  }
  return `wss://rtasr.xfyun.cn/v1/ws?${params.toString()}`;
}

/**
 * 从 RTASR 单条 result 的 data JSON 中取当前识别文本
 * @param {Record<string, unknown>} inner
 * @returns {string}
 */
function collectRtasrTextFromInner(inner) {
  if (!inner || typeof inner !== 'object') return '';
  const rtList = inner.cn?.st?.rt;
  if (!Array.isArray(rtList)) return '';
  const parts = [];
  for (const rtItem of rtList) {
    if (!rtItem || !Array.isArray(rtItem.ws)) continue;
    for (const wsItem of rtItem.ws) {
      if (!wsItem || !Array.isArray(wsItem.cw)) continue;
      for (const cwItem of wsItem.cw) {
        if (cwItem != null && cwItem.w != null && String(cwItem.w) !== '') {
          parts.push(String(cwItem.w));
        }
      }
    }
  }
  return parts.join('');
}

/** /ws/stt：STT_PROVIDER=xunfei-rtasr-ws 时使用讯飞实时语音转写标准版（非 IAT） */
const rtasrSttSessionCtx = {
  WebSocket,
  recordServerError,
  recordServerLatencySample,
  appId: XUNFEI_RTASR_APP_ID,
  apiKey: XUNFEI_RTASR_API_KEY,
  buildRtasrUrl: () =>
    buildXunfeiRtasrWsUrl(XUNFEI_RTASR_APP_ID, XUNFEI_RTASR_API_KEY),
  collectTextFromInner: collectRtasrTextFromInner,
  STT_WS_IDLE_TIMEOUT_MS,
  STT_WS_UPSTREAM_CONNECT_MS,
  STT_WS_UPSTREAM_SESSION_MS,
  STT_WS_STOP_WAIT_MS,
  STT_WS_PCM_FRAME_BYTES,
  STT_WS_MAX_AUDIO_MSG_PER_SEC,
  STT_WS_MAX_CLIENT_CHUNK_BYTES,
  STT_WS_MAX_SESSION_INGEST_BYTES
};

function iatPcmFormatString() {
  return `audio/L16;rate=${XUNFEI_STT_SAMPLE_RATE}`;
}

/**
 * /ws/stt：浏览器与讯飞 IAT 听写之间的单会话桥（流式 status 0/1/2）
 * @param {import('ws')} clientWs
 */
function createSttRealtimeSession(clientWs) {
  const appId = XUNFEI_STT_APP_ID;
  const apiKey = XUNFEI_STT_API_KEY;
  const apiSecret = XUNFEI_STT_API_SECRET;
  const audioFormat = iatPcmFormatString();

  /** @type {import('ws')|null} */
  let upstream = null;
  let textAccum = '';
  let lastPartialText = '';
  /** @type {Buffer} */
  let pcmQueue = Buffer.alloc(0);
  let hasBegunAudio = false;
  let destroyed = false;
  let clientFinalSent = false;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let idleTimer = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let sessionTimer = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let connectTimer = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let stopWaitTimer = null;
  /** @type {(() => void) | null} */
  let stopDoneCallback = null;
  /** @type {((err: Error) => void) | null} 握手完成前用于拒绝 start() */
  let pendingStartReject = null;
  /** 本会话累计解码后的 PCM 字节 */
  let sessionIngestBytes = 0;
  /** 最近 1 秒内 audio 消息时间戳（节流） */
  /** @type {number[]} */
  let audioMsgTimestamps = [];
  /** 上游 WebSocket open 时刻（用于首条 partial 延迟） */
  let upstreamOpenMs = 0;
  let wsSttFirstPartialRecorded = false;

  function safeSendClient(obj) {
    if (clientWs.readyState === WebSocket.OPEN) {
      try {
        clientWs.send(JSON.stringify(obj));
      } catch {
        // ignore
      }
    }
  }

  function sendErrorToClient(code, message) {
    recordServerError('wsStt', String(code || 'unknown'));
    safeSendClient({ type: 'error', code, message });
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function resetIdleTimer() {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      sendErrorToClient('idle_timeout', '长时间未收到音频数据，已结束本轮识别');
      void finishStop();
    }, STT_WS_IDLE_TIMEOUT_MS);
  }

  function clearSessionTimer() {
    if (sessionTimer) {
      clearTimeout(sessionTimer);
      sessionTimer = null;
    }
  }

  function clearConnectTimer() {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  }

  function clearStopWaitTimer() {
    if (stopWaitTimer) {
      clearTimeout(stopWaitTimer);
      stopWaitTimer = null;
    }
  }

  function cleanupUpstreamSocket() {
    if (!upstream) return;
    try {
      upstream.removeAllListeners();
      upstream.close();
    } catch {
      // ignore
    }
    upstream = null;
  }

  function sendFinalOnce() {
    if (clientFinalSent) return;
    clientFinalSent = true;
    safeSendClient({ type: 'final', text: textAccum.trim() });
  }

  function resolveStopDone() {
    clearStopWaitTimer();
    const finish = stopDoneCallback;
    stopDoneCallback = null;
    if (typeof finish === 'function') {
      finish();
    }
  }

  function destroyWithUpstreamError(code, message) {
    if (destroyed) return;
    destroyed = true;
    clearIdleTimer();
    clearSessionTimer();
    clearConnectTimer();
    clearStopWaitTimer();
    cleanupUpstreamSocket();
    if (pendingStartReject) {
      const rejectFn = pendingStartReject;
      pendingStartReject = null;
      rejectFn(new Error(code));
      sendErrorToClient(code, message);
      resolveStopDone();
      return;
    }
    sendFinalOnce();
    sendErrorToClient(code, message);
    resolveStopDone();
  }

  function finalizeClosedUpstream() {
    if (destroyed) return;
    destroyed = true;
    clearIdleTimer();
    clearSessionTimer();
    clearConnectTimer();
    clearStopWaitTimer();
    cleanupUpstreamSocket();
    if (pendingStartReject) {
      const rejectFn = pendingStartReject;
      pendingStartReject = null;
      rejectFn(new Error('upstream_closed'));
      resolveStopDone();
      return;
    }
    sendFinalOnce();
    resolveStopDone();
  }

  function handleUpstreamMessage(raw) {
    if (destroyed) return;
    let messageJson;
    try {
      messageJson = JSON.parse(String(raw || ''));
    } catch {
      return;
    }
    const code = Number(messageJson.code);
    if (!Number.isFinite(code)) return;
    if (code !== 0) {
      const messageText =
        messageJson.message || messageJson.desc || `听写错误码 ${code}`;
      destroyWithUpstreamError('upstream_stt', String(messageText));
      return;
    }
    const data = messageJson.data;
    if (data && data.result) {
      textAccum += collectIatTextFromWsResult(data.result);
    }
    const segmentStatus = data != null ? Number(data.status) : -1;
    if (segmentStatus === 0 || segmentStatus === 1) {
      const piece = textAccum.trim();
      if (piece !== lastPartialText) {
        lastPartialText = piece;
        if (
          piece
          && upstreamOpenMs > 0
          && !wsSttFirstPartialRecorded
        ) {
          wsSttFirstPartialRecorded = true;
          recordServerLatencySample('wsSttFirstPartialMs', Date.now() - upstreamOpenMs);
        }
        safeSendClient({ type: 'partial', text: piece });
      }
    }
    if (segmentStatus === 2) {
      clearStopWaitTimer();
      sendFinalOnce();
      destroyed = true;
      clearIdleTimer();
      clearSessionTimer();
      clearConnectTimer();
      cleanupUpstreamSocket();
      resolveStopDone();
    }
  }

  function flushQueuedPcmToUpstream() {
    if (!upstream || upstream.readyState !== WebSocket.OPEN || destroyed) return;
    if (!hasBegunAudio) {
      if (pcmQueue.length === 0) return;
      const take = Math.min(STT_WS_PCM_FRAME_BYTES, pcmQueue.length);
      const chunk = pcmQueue.subarray(0, take);
      pcmQueue = pcmQueue.subarray(take);
      const firstFrame = {
        common: { app_id: String(appId) },
        business: {
          language: XUNFEI_STT_LANGUAGE,
          domain: XUNFEI_STT_DOMAIN,
          accent: XUNFEI_STT_ACCENT
        },
        data: {
          status: 0,
          format: audioFormat,
          encoding: 'raw',
          audio: chunk.toString('base64')
        }
      };
      upstream.send(JSON.stringify(firstFrame));
      hasBegunAudio = true;
    }
    while (pcmQueue.length >= STT_WS_PCM_FRAME_BYTES) {
      const piece = pcmQueue.subarray(0, STT_WS_PCM_FRAME_BYTES);
      pcmQueue = pcmQueue.subarray(STT_WS_PCM_FRAME_BYTES);
      const midFrame = {
        data: {
          status: 1,
          format: audioFormat,
          encoding: 'raw',
          audio: piece.toString('base64')
        }
      };
      upstream.send(JSON.stringify(midFrame));
    }
  }

  function sendEndMarkerToUpstream() {
    if (!upstream || upstream.readyState !== WebSocket.OPEN || destroyed) return;
    const rest = pcmQueue;
    pcmQueue = Buffer.alloc(0);
    if (!hasBegunAudio) {
      const onlyFrame = {
        common: { app_id: String(appId) },
        business: {
          language: XUNFEI_STT_LANGUAGE,
          domain: XUNFEI_STT_DOMAIN,
          accent: XUNFEI_STT_ACCENT
        },
        data: {
          status: 2,
          format: audioFormat,
          encoding: 'raw',
          audio: ''
        }
      };
      upstream.send(JSON.stringify(onlyFrame));
      hasBegunAudio = true;
      return;
    }
    if (rest.length > 0) {
      const lastFrame = {
        data: {
          status: 2,
          format: audioFormat,
          encoding: 'raw',
          audio: rest.toString('base64')
        }
      };
      upstream.send(JSON.stringify(lastFrame));
    } else {
      upstream.send(JSON.stringify({ data: { status: 2 } }));
    }
  }

  /**
   * @returns {Promise<void>}
   */
  function start() {
    if (STT_PROVIDER !== 'xunfei-iat-ws') {
      sendErrorToClient(
        'stt_not_configured',
        '当前 STT_PROVIDER 不支持实时转写，请使用 xunfei-iat-ws'
      );
      return Promise.reject(new Error('stt_not_configured'));
    }
    if (!appId || !apiKey || !apiSecret) {
      sendErrorToClient(
        'stt_not_configured',
        '未配置讯飞听写密钥（XUNFEI_STT_APP_ID / API_KEY / API_SECRET）'
      );
      return Promise.reject(new Error('stt_not_configured'));
    }
    return new Promise((connectResolve, connectReject) => {
      pendingStartReject = connectReject;
      const wsUrl = buildXunfeiIatWsUrl(appId, apiKey, apiSecret);
      connectTimer = setTimeout(() => {
        connectTimer = null;
        destroyed = true;
        cleanupUpstreamSocket();
        const rejectFn = pendingStartReject;
        pendingStartReject = null;
        if (rejectFn) {
          rejectFn(new Error('upstream_connect_timeout'));
        }
        sendErrorToClient('upstream_connect_timeout', '连接上游听写服务超时');
        resolveStopDone();
      }, STT_WS_UPSTREAM_CONNECT_MS);

      try {
        upstream = new WebSocket(wsUrl);
      } catch (connectError) {
        clearConnectTimer();
        destroyed = true;
        const rejectFn = pendingStartReject;
        pendingStartReject = null;
        if (rejectFn) {
          rejectFn(connectError);
        }
        const messageText = connectError?.message || '连接上游失败';
        sendErrorToClient('upstream_connect_failed', messageText);
        resolveStopDone();
        return;
      }

      upstream.on('open', () => {
        clearConnectTimer();
        if (destroyed) {
          cleanupUpstreamSocket();
          if (pendingStartReject) {
            const rejectFn = pendingStartReject;
            pendingStartReject = null;
            rejectFn(new Error('aborted'));
          }
          return;
        }
        upstreamOpenMs = Date.now();
        wsSttFirstPartialRecorded = false;
        pendingStartReject = null;
        resetIdleTimer();
        sessionTimer = setTimeout(() => {
          sessionTimer = null;
          sendErrorToClient('session_timeout', '本轮识别超过最大允许时长');
          void finishStop();
        }, STT_WS_UPSTREAM_SESSION_MS);
        connectResolve();
      });

      upstream.on('message', (raw) => {
        handleUpstreamMessage(raw);
      });

      upstream.on('error', (wsError) => {
        if (destroyed) return;
        destroyWithUpstreamError(
          'upstream_error',
          wsError?.message || '上游听写连接错误'
        );
      });

      upstream.on('close', () => {
        if (destroyed) return;
        finalizeClosedUpstream();
      });
    });
  }

  /**
   * @param {string} base64Audio
   */
  function pushAudioBase64(base64Audio) {
    if (destroyed) {
      sendErrorToClient('session_closed', '识别会话已结束');
      return;
    }
    if (!upstream || upstream.readyState !== WebSocket.OPEN) {
      sendErrorToClient('upstream_not_ready', '上游尚未就绪，请稍后再发音频');
      return;
    }
    let pcmBuf;
    try {
      pcmBuf = Buffer.from(String(base64Audio || ''), 'base64');
    } catch {
      sendErrorToClient('bad_audio', '音频 base64 解码失败');
      return;
    }
    if (pcmBuf.length === 0) return;

    const throttleNow = Date.now();
    audioMsgTimestamps = audioMsgTimestamps.filter(
      (timestampMs) => throttleNow - timestampMs < 1000
    );
    audioMsgTimestamps.push(throttleNow);
    if (audioMsgTimestamps.length > STT_WS_MAX_AUDIO_MSG_PER_SEC) {
      sendErrorToClient(
        'audio_rate_limit',
        '语音数据发送过于频繁，请稍后再试'
      );
      void finishStop();
      return;
    }
    if (pcmBuf.length > STT_WS_MAX_CLIENT_CHUNK_BYTES) {
      sendErrorToClient(
        'frame_too_large',
        `单帧音频过大（>${STT_WS_MAX_CLIENT_CHUNK_BYTES} 字节），已终止`
      );
      void finishStop();
      return;
    }
    sessionIngestBytes += pcmBuf.length;
    if (sessionIngestBytes > STT_WS_MAX_SESSION_INGEST_BYTES) {
      sendErrorToClient(
        'session_audio_quota',
        '本轮语音数据量已达上限，请停止后重新开始'
      );
      void finishStop();
      return;
    }

    pcmQueue = Buffer.concat([pcmQueue, pcmBuf]);
    resetIdleTimer();
    flushQueuedPcmToUpstream();
  }

  /**
   * @returns {Promise<void>}
   */
  function finishStop() {
    if (destroyed) {
      return Promise.resolve();
    }
    clearIdleTimer();
    return new Promise((resolve) => {
      stopDoneCallback = resolve;
      if (!upstream || upstream.readyState !== WebSocket.OPEN) {
        sendFinalOnce();
        destroyed = true;
        clearSessionTimer();
        cleanupUpstreamSocket();
        resolveStopDone();
        return;
      }
      sendEndMarkerToUpstream();
      stopWaitTimer = setTimeout(() => {
        stopWaitTimer = null;
        // 上游久未返回 status=2 时仍保证下发一次 final（可能为空），避免前端「识别中」卡死
        if (!clientFinalSent) {
          sendFinalOnce();
        }
        destroyed = true;
        clearSessionTimer();
        cleanupUpstreamSocket();
        resolveStopDone();
      }, STT_WS_STOP_WAIT_MS);
    });
  }

  /** 前端断开：静默释放，不向前端再写 JSON */
  function destroyHard() {
    if (destroyed) return;
    destroyed = true;
    clearIdleTimer();
    clearSessionTimer();
    clearConnectTimer();
    clearStopWaitTimer();
    if (pendingStartReject) {
      const rejectFn = pendingStartReject;
      pendingStartReject = null;
      rejectFn(new Error('aborted'));
    }
    cleanupUpstreamSocket();
    resolveStopDone();
  }

  return {
    start,
    pushAudioBase64,
    finishStop,
    destroyHard
  };
}

const sttAudioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: STT_MAX_AUDIO_BYTES }
});

// 普通用户脱敏字段（不暴露密码和盐值）
function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatar: user.avatar,
    role: user.role,
    createdAt: user.createdAt
  };
}

// 管理员视角用户字段（绝不返回任何口令或展示用密码明文）
function adminSanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    mentalHealthStatus: user.mentalHealthStatus || '未评估',
    mentalHealthNote: user.mentalHealthNote || '',
    createdAt: user.createdAt
  };
}

// ==================== 默认管理员账号初始化 ====================

function initAdminAccount() {
  const users = readUsers();
  const adminExists = users.find(u => u.username === 'admin');
  if (adminExists) return;

  const adminPassword = 'admin123';
  const salt = crypto.randomBytes(16).toString('hex');
  const adminUser = {
    id: crypto.randomUUID(),
    username: 'admin',
    nickname: '系统管理员',
    password: hashPassword(adminPassword, salt),
    salt,
    avatar: '',
    role: 'admin',
    mentalHealthStatus: '未评估',
    mentalHealthNote: '',
    createdAt: new Date().toISOString()
  };

  users.unshift(adminUser);
  writeUsers(users);
  console.log(
    '已创建默认管理员账号 admin（开发环境默认哈希对应口令见 initAdminAccount 内变量，生产环境请尽快重置）'
  );
}

initAdminAccount();

migrateRemoveDisplayPasswordFromDisk();

// ==================== 鉴权中间件 ====================

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未登录或 token 已过期' });
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ code: 401, message: 'token 无效或已过期' });
  }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '无权限，需要管理员身份' });
    }
    next();
  });
}

// ==================== 用户接口 ====================

// 注册（普通用户）
app.post('/api/user/register', (req, res) => {
  const { username, password, nickname } = req.body;

  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '用户名和密码不能为空' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ code: 400, message: '用户名长度应在 3-20 个字符之间' });
  }
  if (password.length < 6) {
    return res.status(400).json({ code: 400, message: '密码长度不能少于 6 个字符' });
  }

  const users = readUsers();
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ code: 400, message: '用户名已存在' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const newUser = {
    id: crypto.randomUUID(),
    username,
    nickname: nickname || username,
    password: hashPassword(password, salt),
    salt,
    avatar: '',
    role: 'user',
    mentalHealthStatus: '未评估',
    mentalHealthNote: '',
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeUsers(users);

  res.json({
    code: 200,
    message: '注册成功',
    data: { token: generateToken(newUser), user: sanitizeUser(newUser) }
  });
});

// 登录
app.post('/api/user/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '用户名和密码不能为空' });
  }

  const users = readUsers();
  const user = users.find(u => u.username === username);

  if (!user || hashPassword(password, user.salt) !== user.password) {
    return res.status(401).json({ code: 401, message: '用户名或密码错误' });
  }

  res.json({
    code: 200,
    message: '登录成功',
    data: { token: generateToken(user), user: sanitizeUser(user) }
  });
});

// 获取当前用户信息
app.get('/api/user/info', authMiddleware, (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.id === req.user.id);

  if (!user) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }

  res.json({ code: 200, message: '获取成功', data: sanitizeUser(user) });
});

// 更新用户信息
app.put('/api/user/info', authMiddleware, (req, res) => {
  const { nickname, avatar } = req.body;
  const users = readUsers();
  const userIndex = users.findIndex(u => u.id === req.user.id);

  if (userIndex === -1) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }

  if (nickname !== undefined) users[userIndex].nickname = nickname;
  if (avatar !== undefined) users[userIndex].avatar = avatar;
  writeUsers(users);

  res.json({ code: 200, message: '更新成功', data: sanitizeUser(users[userIndex]) });
});

// 修改密码
app.put('/api/user/password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ code: 400, message: '请填写完整信息' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ code: 400, message: '新密码长度不能少于 6 个字符' });
  }

  const users = readUsers();
  const userIndex = users.findIndex(u => u.id === req.user.id);
  if (userIndex === -1) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }

  const user = users[userIndex];
  if (hashPassword(oldPassword, user.salt) !== user.password) {
    return res.status(401).json({ code: 401, message: '原密码错误' });
  }

  const newSalt = crypto.randomBytes(16).toString('hex');
  users[userIndex].salt = newSalt;
  users[userIndex].password = hashPassword(newPassword, newSalt);
  writeUsers(users);

  res.json({ code: 200, message: '密码修改成功' });
});

// ==================== 管理员接口 ====================

// 获取全部用户列表
app.get('/api/admin/users', adminMiddleware, (req, res) => {
  const users = readUsers();
  res.json({
    code: 200,
    message: '获取成功',
    data: users.map(adminSanitizeUser)
  });
});

// 更新指定用户的心理健康状态
app.put('/api/admin/users/:userId/mental-status', adminMiddleware, (req, res) => {
  const { userId } = req.params;
  const { mentalHealthStatus, mentalHealthNote } = req.body;

  const users = readUsers();
  const userIndex = users.findIndex(u => u.id === userId);
  if (userIndex === -1) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }

  if (mentalHealthStatus !== undefined) {
    users[userIndex].mentalHealthStatus = mentalHealthStatus;
  }
  if (mentalHealthNote !== undefined) {
    users[userIndex].mentalHealthNote = mentalHealthNote;
  }
  writeUsers(users);

  res.json({ code: 200, message: '心理状态更新成功', data: adminSanitizeUser(users[userIndex]) });
});

/**
 * 管理员重置用户登录密码：生成随机临时口令，仅在响体内返回一次，不持久化明文
 * POST /api/admin/users/:userId/reset-password
 */
app.post('/api/admin/users/:userId/reset-password', adminMiddleware, (req, res) => {
  const { userId } = req.params;
  const users = readUsers();
  const userIndex = users.findIndex(u => u.id === userId);
  if (userIndex === -1) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }

  const temporaryPassword = generateTemporaryPassword();
  const newSalt = crypto.randomBytes(16).toString('hex');
  users[userIndex].salt = newSalt;
  users[userIndex].password = hashPassword(temporaryPassword, newSalt);
  writeUsers(users);

  res.json({
    code: 200,
    message: '密码已重置，请将临时口令当面或安全渠道交给用户，并提示其登录后立即修改',
    data: { temporaryPassword }
  });
});

// 删除用户（管理员）
app.delete('/api/admin/users/:userId', adminMiddleware, (req, res) => {
  const { userId } = req.params;

  const users = readUsers();
  const userIndex = users.findIndex(u => u.id === userId);
  if (userIndex === -1) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }

  // 不允许删除自己
  if (users[userIndex].id === req.user.id) {
    return res.status(400).json({ code: 400, message: '不能删除当前登录的管理员账号' });
  }

  users.splice(userIndex, 1);
  writeUsers(users);

  // 尝试清理用户数据文件（聊天/打卡/测评/聊天上传图），失败不影响删除流程
  try { fs.unlinkSync(path.join(CHATS_DIR, `${userId}.json`)); } catch {}
  try { fs.unlinkSync(path.join(CHECKINS_DIR, `${userId}.json`)); } catch {}
  try { fs.unlinkSync(path.join(ASSESSMENTS_DIR, `${userId}.json`)); } catch {}
  try {
    fs.rmSync(path.join(CHAT_UPLOAD_ROOT, userId), { recursive: true, force: true });
  } catch {}

  res.json({ code: 200, message: '用户已删除' });
});

/**
 * 管理员获取指定用户的最新测评摘要
 * GET /api/admin/users/:userId/assessment/latest
 */
app.get('/api/admin/users/:userId/assessment/latest', adminMiddleware, (req, res) => {
  const { userId } = req.params;
  const records = readUserAssessments(userId);
  if (!Array.isArray(records) || records.length === 0) {
    return res.json({ code: 200, message: '获取成功', data: null });
  }

  const latest = records
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];

  if (!latest) {
    return res.json({ code: 200, message: '获取成功', data: null });
  }

  const data = {
    id: latest.id,
    userId: latest.userId,
    scaleId: latest.scaleId,
    scaleName: latest.scaleName,
    level: latest.level,
    severity: latest.severity,
    rawScore: latest.rawScore,
    standardScore: latest.standardScore ?? null,
    createdAt: latest.createdAt
  };

  res.json({ code: 200, message: '获取成功', data });
});

// ==================== 聊天会话持久化接口 ====================

// 获取当前用户的所有会话
app.get('/api/chat/sessions', authMiddleware, (req, res) => {
  const sessions = readUserChats(req.user.id);
  res.json({ code: 200, message: '获取成功', data: sessions });
});

// 全量保存当前用户的所有会话
app.put('/api/chat/sessions', authMiddleware, (req, res) => {
  const { sessions } = req.body;

  if (!Array.isArray(sessions)) {
    return res.status(400).json({ code: 400, message: 'sessions 必须是数组' });
  }

  writeUserChats(req.user.id, sessions);
  res.json({ code: 200, message: '保存成功' });
});

/**
 * 聊天配图上传（仅图片，需登录）
 * POST /api/chat/upload  multipart 字段名 files
 */
app.post('/api/chat/upload', authMiddleware, (req, res, next) => {
  chatImageUpload.array('files', 12)(req, res, (err) => {
    if (err) {
      const message = err instanceof multer.MulterError
        ? `上传限制：${err.message}`
        : (err.message || '上传失败');
      return res.status(400).json({ code: 400, message });
    }
    next();
  });
}, (req, res) => {
  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ code: 400, message: '未收到图片文件' });
  }
  const list = files.map((f) => ({
    url: `/uploads/chat/${req.user.id}/${f.filename}`,
    originalName: f.originalname,
    mime: f.mimetype,
    size: f.size
  }));
  res.json({
    code: 200,
    message: '上传成功',
    data: { files: list }
  });
});

// 删除指定会话
app.delete('/api/chat/sessions/:sessionId', authMiddleware, (req, res) => {
  const { sessionId } = req.params;
  const sessions = readUserChats(req.user.id);
  const filtered = sessions.filter(s => s.id !== sessionId);

  if (filtered.length === sessions.length) {
    return res.status(404).json({ code: 404, message: '会话不存在' });
  }

  writeUserChats(req.user.id, filtered);
  res.json({ code: 200, message: '会话已删除' });
});

// ==================== 日记接口 ====================

// 对话实录 → LLM 结构化摘要（心情关键词 / 核心事件 / 寄语 / 心情曲线）
app.post('/api/diary/summarize', authMiddleware, async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ code: 500, message: '未配置 XUNFEI_API_KEY，无法生成摘要' });
  }
  let transcript = String(req.body?.transcript || '').trim();
  if (!transcript) {
    return res.status(400).json({ code: 400, message: 'transcript 不能为空' });
  }
  if (transcript.length > DIARY_SUMMARY_TRANSCRIPT_MAX) {
    transcript = `${transcript.slice(0, DIARY_SUMMARY_TRANSCRIPT_MAX)}\n…（前端已截断）`;
  }
  const systemPrompt =
    '你是心理咨询助手后台。根据用户与 AI「小愈」的对话实录，输出**仅一段合法 JSON**（不要 markdown 代码围栏），键名必须完全一致：\n'
    + '{"moodKeywords":["3～8个中文心情关键词"],"coreEvents":"1～3句第三人称客观概括用户提到的核心事件与困扰","aiEncouragement":"2～4句以小愈口吻写的温暖鼓励（勿复述长对话）","moodCurve":[{"label":"简短阶段名","score":5}]}\n'
    + 'moodCurve：按对话时间顺序 5～12 个点；score 为 1～10 的整数，表示用户情绪积极程度（越高越正向、平稳）。label 用简短中文如「开场」「倾诉」「深入」「收尾」。不要输出其它字段。';
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `对话实录：\n${transcript}` }
  ];
  try {
    const raw = await maasChatCompletionNonStream(messages, {
      max_tokens: 1100,
      temperature: 0.35
    });
    const parsed = extractJsonObjectFromModelText(raw);
    if (!parsed) {
      recordServerError('llm', 'diary_summary_parse');
      return res.status(502).json({ code: 502, message: '模型返回无法解析为 JSON' });
    }
    const data = normalizeDiarySummaryPayload(parsed);
    res.json({ code: 200, message: 'ok', data });
  } catch (error) {
    recordServerError('llm', 'diary_summary_failed');
    return res.status(502).json({
      code: 502,
      message: `摘要生成失败：${error?.message || '上游错误'}`
    });
  }
});

// 获取当前用户日记列表（分页 + 关键词）
app.get('/api/diary/entries', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const keywordRaw = req.query.keyword != null ? String(req.query.keyword).trim() : '';
  const pageNum = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSizeRaw = parseInt(String(req.query.pageSize || '20'), 10) || 20;
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw));

  let list = readUserDiaries(userId);
  if (!Array.isArray(list)) list = [];

  list = [...list].sort((entryA, entryB) => {
    const timeA = new Date(entryA.updatedAt || entryA.createdAt || 0).getTime();
    const timeB = new Date(entryB.updatedAt || entryB.createdAt || 0).getTime();
    return timeB - timeA;
  });

  if (keywordRaw) {
    const keywordLower = keywordRaw.toLowerCase();
    list = list.filter((entry) => {
      const title = String(entry.title || '').toLowerCase();
      const content = String(entry.content || '').toLowerCase();
      const core = String(entry.coreEvents || '').toLowerCase();
      const keys = Array.isArray(entry.moodKeywords)
        ? entry.moodKeywords.join(' ').toLowerCase()
        : '';
      return (
        title.includes(keywordLower)
        || content.includes(keywordLower)
        || core.includes(keywordLower)
        || keys.includes(keywordLower)
      );
    });
  }

  const total = list.length;
  const start = (pageNum - 1) * pageSize;
  const pageSlice = list.slice(start, start + pageSize);

  const listPayload = pageSlice.map((entry) => ({
    id: entry.id,
    title: entry.title,
    preview: buildDiaryPreviewText(entry.coreEvents || entry.content),
    source: entry.source,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    moodKeywords: Array.isArray(entry.moodKeywords) ? entry.moodKeywords.slice(0, 8) : []
  }));

  res.json({
    code: 200,
    message: '获取成功',
    data: { total, list: listPayload }
  });
});

// 创建日记（可选结构化字段：心情关键词 / 核心事件 / 寄语 / 心情曲线）
app.post('/api/diary/entries', authMiddleware, (req, res) => {
  const userId = req.user.id;
  let { title, content, source, moodKeywords, coreEvents, aiEncouragement, moodCurve } = req.body || {};

  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ code: 400, message: '正文不能为空' });
  }
  content = content.trim();
  if (content.length > DIARY_MAX_CONTENT_LEN) {
    return res.status(400).json({
      code: 400,
      message: `正文长度不能超过 ${DIARY_MAX_CONTENT_LEN} 字`
    });
  }

  if (typeof title !== 'string') title = '';
  title = title.trim();
  if (!title) title = defaultDiaryTitleForUser();
  if (title.length > DIARY_MAX_TITLE_LEN) {
    return res.status(400).json({
      code: 400,
      message: `标题不能超过 ${DIARY_MAX_TITLE_LEN} 字`
    });
  }

  const sourceNormalized = source === 'voice' ? 'voice' : 'chat';
  const nowIso = new Date().toISOString();

  const metaNorm = normalizeDiarySummaryPayload({
    moodKeywords,
    coreEvents,
    aiEncouragement,
    moodCurve
  });

  const newEntry = {
    id: crypto.randomUUID(),
    userId,
    title,
    content,
    source: sourceNormalized,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  if (metaNorm.moodKeywords.length > 0) {
    newEntry.moodKeywords = metaNorm.moodKeywords;
  }
  if (metaNorm.coreEvents) newEntry.coreEvents = metaNorm.coreEvents;
  if (metaNorm.aiEncouragement) newEntry.aiEncouragement = metaNorm.aiEncouragement;
  if (metaNorm.moodCurve.points.length > 0) {
    newEntry.moodCurve = metaNorm.moodCurve;
  }

  const entries = readUserDiaries(userId);
  const safeEntries = Array.isArray(entries) ? entries : [];
  safeEntries.unshift(newEntry);
  writeUserDiaries(userId, safeEntries);

  res.json({
    code: 200,
    message: '创建成功',
    data: {
      id: newEntry.id,
      title: newEntry.title,
      content: newEntry.content,
      source: newEntry.source,
      createdAt: newEntry.createdAt,
      updatedAt: newEntry.updatedAt,
      moodKeywords: newEntry.moodKeywords,
      coreEvents: newEntry.coreEvents,
      aiEncouragement: newEntry.aiEncouragement,
      moodCurve: newEntry.moodCurve
    }
  });
});

// 单条详情
app.get('/api/diary/entries/:id', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const entries = readUserDiaries(userId);
  const list = Array.isArray(entries) ? entries : [];
  const found = list.find((entry) => entry.id === id);
  if (!found) {
    return res.status(404).json({ code: 404, message: '日记不存在' });
  }
  res.json({
    code: 200,
    message: '获取成功',
    data: {
      id: found.id,
      title: found.title,
      content: found.content,
      source: found.source,
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
      moodKeywords: found.moodKeywords,
      coreEvents: found.coreEvents,
      aiEncouragement: found.aiEncouragement,
      moodCurve: found.moodCurve
    }
  });
});

// 删除日记
app.delete('/api/diary/entries/:id', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const entries = readUserDiaries(userId);
  const list = Array.isArray(entries) ? entries : [];
  const filtered = list.filter((entry) => entry.id !== id);
  if (filtered.length === list.length) {
    return res.status(404).json({ code: 404, message: '日记不存在' });
  }
  writeUserDiaries(userId, filtered);
  res.json({ code: 200, message: '删除成功' });
});

// ==================== 情绪打卡接口 ====================

// 获取当前用户的所有打卡记录
app.get('/api/checkin/records', authMiddleware, (req, res) => {
  const checkins = readUserCheckins(req.user.id);
  res.json({ code: 200, message: '获取成功', data: checkins });
});

// 提交或更新打卡（同一天只保留一条，重复提交则覆盖）
app.post('/api/checkin', authMiddleware, (req, res) => {
  const { date, mood, note } = req.body;

  // 参数校验
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ code: 400, message: '日期格式无效，需要 YYYY-MM-DD' });
  }
  if (!Number.isInteger(mood) || mood < 1 || mood > 5) {
    return res.status(400).json({ code: 400, message: '情绪等级必须为 1-5 的整数' });
  }
  if (note !== undefined && typeof note !== 'string') {
    return res.status(400).json({ code: 400, message: '备注必须为字符串' });
  }
  if (note && note.length > 200) {
    return res.status(400).json({ code: 400, message: '备注长度不能超过 200 个字符' });
  }

  // 不允许打卡未来日期
  const today = getTodayLocalDate();
  if (date > today) {
    return res.status(400).json({ code: 400, message: '不能打卡未来日期' });
  }

  const checkins = readUserCheckins(req.user.id);
  const existingIndex = checkins.findIndex(c => c.date === date);
  const record = {
    date,
    mood,
    note: note || '',
    createdAt: new Date().toISOString()
  };

  if (existingIndex !== -1) {
    // 更新已有记录
    checkins[existingIndex] = record;
  } else {
    // 新增记录
    checkins.push(record);
  }

  // 按日期倒序排列，便于查询
  checkins.sort((a, b) => b.date.localeCompare(a.date));
  writeUserCheckins(req.user.id, checkins);

  res.json({ code: 200, message: '打卡成功', data: record });
});

// 获取个人中心统计数据（聊天统计 + 打卡统计，一次性返回）
app.get('/api/user/stats', authMiddleware, (req, res) => {
  const userId = req.user.id;

  // ---- 聊天相关统计 ----
  const sessions = readUserChats(userId);
  const sessionCount = sessions.length;

  // 消息总条数
  const messageCount = sessions.reduce((sum, s) => sum + (s.messages?.length || 0), 0);

  // 累计对话天数：从所有消息的 timestamp 提取日期去重
  const chatDateSet = new Set();
  sessions.forEach(s => {
    (s.messages || []).forEach(m => {
      if (m.timestamp) {
        chatDateSet.add(m.timestamp.slice(0, 10));
      }
    });
  });
  const chatDays = chatDateSet.size;

  // ---- 打卡相关统计 ----
  const checkins = readUserCheckins(userId);
  const checkinDays = checkins.length;

  // 连续打卡天数：从今天向前数连续的天数
  const today = getTodayLocalDate();
  const checkinDateSet = new Set(checkins.map(c => c.date));
  let streakDays = 0;
  const cursor = new Date(`${today}T00:00:00`);
  while (checkinDateSet.has(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`)) {
    streakDays++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // 近 7 天平均情绪指数
  const last7Days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() - i);
    last7Days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  const last7Checkins = checkins.filter(c => last7Days.includes(c.date));
  const avgMood7d = last7Checkins.length > 0
    ? +(last7Checkins.reduce((sum, c) => sum + c.mood, 0) / last7Checkins.length).toFixed(1)
    : null;

  res.json({
    code: 200,
    message: '获取成功',
    data: { chatDays, sessionCount, messageCount, checkinDays, streakDays, avgMood7d }
  });
});

// ==================== 心理测评接口 ====================

/**
 * 提交测评结果（保存一条记录）
 * POST /api/assessment
 */
app.post('/api/assessment', authMiddleware, (req, res) => {
  const { scaleId, scaleName, answers, rawScore, standardScore, level, severity } = req.body || {};

  if (!scaleId || typeof scaleId !== 'string') {
    return res.status(400).json({ code: 400, message: 'scaleId 不能为空' });
  }
  if (!scaleName || typeof scaleName !== 'string') {
    return res.status(400).json({ code: 400, message: 'scaleName 不能为空' });
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ code: 400, message: 'answers 必须为非空数组' });
  }
  if (!Number.isFinite(Number(rawScore))) {
    return res.status(400).json({ code: 400, message: 'rawScore 必须为数字' });
  }
  if (standardScore !== null && standardScore !== undefined && !Number.isFinite(Number(standardScore))) {
    return res.status(400).json({ code: 400, message: 'standardScore 必须为数字或 null' });
  }
  if (!level || typeof level !== 'string') {
    return res.status(400).json({ code: 400, message: 'level 不能为空' });
  }
  if (!severity || typeof severity !== 'string') {
    return res.status(400).json({ code: 400, message: 'severity 不能为空' });
  }

  const userId = req.user.id;
  const record = {
    id: crypto.randomUUID(),
    userId,
    scaleId,
    scaleName,
    answers,
    rawScore: Number(rawScore),
    standardScore: standardScore === null || standardScore === undefined ? null : Number(standardScore),
    level,
    severity,
    createdAt: new Date().toISOString()
  };

  const records = readUserAssessments(userId);
  records.unshift(record);
  // 保持按时间倒序
  records.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  writeUserAssessments(userId, records);

  res.json({ code: 200, message: '提交成功', data: record });
});

/**
 * 获取当前用户历史测评记录（时间倒序）
 * GET /api/assessment/history
 */
app.get('/api/assessment/history', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const records = readUserAssessments(userId);
  res.json({ code: 200, message: '获取成功', data: Array.isArray(records) ? records : [] });
});

/**
 * 获取单条测评详情（只能获取自己的）
 * GET /api/assessment/:id
 */
app.get('/api/assessment/:id', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const records = readUserAssessments(userId);
  const found = Array.isArray(records) ? records.find(r => r.id === id) : null;
  if (!found) {
    return res.status(404).json({ code: 404, message: '测评记录不存在' });
  }
  res.json({ code: 200, message: '获取成功', data: found });
});

/**
 * 删除单条测评记录（只能删除自己的）
 * DELETE /api/assessment/:id
 */
app.delete('/api/assessment/:id', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const records = readUserAssessments(userId);
  const filtered = Array.isArray(records) ? records.filter(r => r.id !== id) : [];
  if (!records || filtered.length === records.length) {
    return res.status(404).json({ code: 404, message: '测评记录不存在' });
  }
  writeUserAssessments(userId, filtered);
  res.json({ code: 200, message: '删除成功' });
});

// ==================== AI 对话接口 ====================

app.post('/api/chat', authMiddleware, (req, res) => {
  const { messages, max_tokens: bodyMaxTokens, temperature: bodyTemperature } = req.body || {};
  handleStreamRequest(messages, res, { max_tokens: bodyMaxTokens, temperature: bodyTemperature });
});

// ==================== 语音（STT/TTS）接口 ====================

/**
 * 短音频转写：multipart/form-data，字段名 audio
 * POST /api/voice/stt
 * 响应：{ code, message, data: { text, durationMs } }
 */
app.post('/api/voice/stt', authMiddleware, (req, res, next) => {
  sttAudioUpload.single('audio')(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({
        code: 400,
        message: uploadErr.message || '音频上传失败（单文件 ≤ STT_MAX_AUDIO_BYTES）'
      });
    }
    next();
  });
}, async (req, res) => {
  const hasFullIatCreds =
    Boolean(XUNFEI_STT_APP_ID) &&
    Boolean(XUNFEI_STT_API_KEY) &&
    Boolean(XUNFEI_STT_API_SECRET);

  if (STT_PROVIDER === 'xunfei-rtasr-ws') {
    if (!hasFullIatCreds) {
      return res.status(503).json({
        code: 503,
        message:
          '当前 STT_PROVIDER=xunfei-rtasr-ws 仅对「实时转写」WebSocket（/ws/stt）使用讯飞实时语音转写。'
          + '短音频上传（本接口）仍依赖讯飞「语音听写」三要素：请在 .env 配置 '
          + 'XUNFEI_STT_APP_ID、XUNFEI_STT_API_KEY、XUNFEI_STT_API_SECRET；'
          + '或若只需短转写，可将 STT_PROVIDER 设为 xunfei-iat-ws。'
      });
    }
  } else if (STT_PROVIDER !== 'xunfei-iat-ws') {
    return res.status(500).json({
      code: 500,
      message:
        '不支持的 STT_PROVIDER：短音频转写仅支持 xunfei-iat-ws，或与 xunfei-rtasr-ws 并存时需提供完整听写密钥'
    });
  } else if (!hasFullIatCreds) {
    return res.status(500).json({
      code: 500,
      message:
        '未配置短转写密钥：请在 .env 设置 XUNFEI_STT_APP_ID / API_KEY / API_SECRET，'
        + '或使用 XUNFEI_RTASR_* / XUNFEI_TTS_* 回退'
    });
  }
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    return res.status(400).json({ code: 400, message: '请使用字段名 audio 上传文件' });
  }

  const parsed = extractPcm16MonoFromUpload(req.file.buffer);
  if (!parsed.ok) {
    return res.status(400).json({ code: 400, message: parsed.message || '音频解析失败' });
  }
  if (parsed.sampleRate !== 16000 || parsed.numChannels !== 1 || parsed.bitsPerSample !== 16) {
    return res.status(400).json({
      code: 400,
      message: '仅支持 16kHz、单声道、16bit PCM（请使用对话页「后端识别」录制的 WAV）'
    });
  }

  const pcmBuf = parsed.pcm;
  const durationMs = Math.round((pcmBuf.length / 2 / 16000) * 1000);

  const sttHttpStartedAt = Date.now();
  try {
    const { text } = await xunfeiIatWsTranscribePcm({
      pcmBuffer: pcmBuf,
      appId: XUNFEI_STT_APP_ID,
      apiKey: XUNFEI_STT_API_KEY,
      apiSecret: XUNFEI_STT_API_SECRET
    });
    recordServerLatencySample('sttHttpMs', Date.now() - sttHttpStartedAt);
    // 音频仅内存解析，不落盘；不记录原始 buffer，高风险语料不进入日志
    const safetyMeta = analyzePsychSafetyRisk(text || '');
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      code: 200,
      message: 'ok',
      data: {
        text: text || '',
        durationMs,
        safety: safetyMeta
      }
    });
  } catch (error) {
    recordServerError('stt', 'http_transcribe_failed');
    res.status(502).json({
      code: 502,
      message: error?.message || '短音频转写失败'
    });
  }
});

/**
 * 在线 TTS：将文本合成为音频二进制（默认返回 mp3 / wav 由上游决定）
 * POST /api/voice/tts
 * Body: { text: string, voice?: string, speed?: number, volume?: number, pitch?: number, aue?: string }
 *
 * 说明：本接口走服务端转发，避免把第三方密钥暴露给浏览器。
 */
app.post('/api/voice/tts', authMiddleware, (req, res) => {
  const { text, voice, speed, volume, pitch, aue } = req.body || {};
  const safeText = typeof text === 'string' ? text.trim() : '';

  if (!safeText) {
    return res.status(400).json({ code: 400, message: 'text 不能为空' });
  }
  if (safeText.length > 1200) {
    return res.status(400).json({ code: 400, message: 'text 过长（建议 ≤ 1200 字）' });
  }

  const ttsRouteStartedAt = Date.now();

  if (TTS_PROVIDER !== 'xunfei-webapi' && TTS_PROVIDER !== 'xunfei-ws') {
    return res.status(500).json({
      code: 500,
      message: '未配置可用的 TTS_PROVIDER（支持 xunfei-ws / xunfei-webapi）'
    });
  }
  if (!XUNFEI_TTS_APP_ID || !XUNFEI_TTS_API_KEY || !XUNFEI_TTS_API_SECRET) {
    return res.status(500).json({
      code: 500,
      message: '未配置讯飞 TTS 密钥（XUNFEI_TTS_APP_ID / XUNFEI_TTS_API_KEY / XUNFEI_TTS_API_SECRET）'
    });
  }

  const speedNum = Number.isFinite(Number(speed)) ? Math.max(0, Math.min(100,Number(speed))) : 50;
  const volumeNum = Number.isFinite(Number(volume)) ? Math.max(0, Math.min(100, Number(volume))) : 50;
  const pitchNum = Number.isFinite(Number(pitch)) ? Math.max(0, Math.min(100, Number(pitch))) : 50;
  const vcn = typeof voice === 'string' && voice.trim() ? voice.trim() : XUNFEI_TTS_VCN;
  const aueVal = typeof aue === 'string' && aue ? aue : 'lame';

  if (TTS_PROVIDER === 'xunfei-ws') {
    (async () => {
      try {
        const buffer = await xunfeiTtsWsSynthesizeBuffer({
          text: safeText,
          appId: XUNFEI_TTS_APP_ID,
          apiKey: XUNFEI_TTS_API_KEY,
          apiSecret: XUNFEI_TTS_API_SECRET,
          vcn,
          aue: aueVal,
          speed: speedNum,
          volume: volumeNum,
          pitch: pitchNum
        });
        recordServerLatencySample('ttsSynthMs', Date.now() - ttsRouteStartedAt);
        res.status(200);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-store');
        res.end(buffer);
      } catch (err) {
        recordServerError('tts', 'ws_synthesize_failed');
        if (!res.headersSent) {
          res.status(502).json({ code: 502, message: err?.message || 'TTS 失败' });
        }
      }
    })();
    return;
  }

  // ---------- 以下为旧版 HTTP WebAPI（xunfei-webapi）----------
  const ttsParam = {
    // aue 常见取值：lame（mp3）、raw（pcm）、speex 等；不同接口支持不同
    aue: typeof aue === 'string' && aue ? aue : 'lame',
    auf: 'audio/L16;rate=16000',
    voice_name: typeof voice === 'string' && voice ? voice : 'xiaoyan',
    speed: Number.isFinite(Number(speed)) ? String(Math.max(0, Math.min(100, Number(speed)))) : '50',
    volume: Number.isFinite(Number(volume)) ? String(Math.max(0, Math.min(100, Number(volume)))) : '50',
    pitch: Number.isFinite(Number(pitch)) ? String(Math.max(0, Math.min(100, Number(pitch)))) : '50',
    engine_type: 'intp65',
    text_type: 'text'
  };

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    ...buildXunfeiWebApiHeaders({
      appId: XUNFEI_TTS_APP_ID,
      apiKey: XUNFEI_TTS_API_KEY,
      paramObject: ttsParam
    })
  };

  const postData = `text=${encodeURIComponent(safeText)}`;

  const options = {
    hostname: XUNFEI_TTS_HOST,
    port: 443,
    path: XUNFEI_TTS_PATH,
    method: 'POST',
    timeout: 30000,
    headers
  };

  const upstreamReq = https.request(options, (upstreamRes) => {
    const chunks = [];
    upstreamRes.on('data', (chunk) => chunks.push(chunk));
    upstreamRes.on('end', () => {
      const buffer = Buffer.concat(chunks);
      if (!buffer.length) {
        recordServerError('tts', 'upstream_empty');
        return res.status(502).json({ code: 502, message: 'TTS 上游返回空响应' });
      }

      const contentType = String(upstreamRes.headers['content-type'] || '').toLowerCase();

      /**
       * 讯飞 HTTP TTS：失败时常为 text/plain + JSON（当前仅用 content-type 会误判为音频）
       * 成功一般为二进制 mp3；少数网关可能返回 JSON + data.audio（base64）
       */
      function bufferLooksLikeJsonObject(buf) {
        const maxScan = Math.min(buf.length, 64);
        for (let index = 0; index < maxScan; index++) {
          const byte = buf[index];
          if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
          return byte === 0x7b;
        }
        return false;
      }

      function tryParseXunfeiTtsJson(buf) {
        if (!bufferLooksLikeJsonObject(buf)) return null;
        try {
          return JSON.parse(buf.toString('utf-8'));
        } catch {
          return null;
        }
      }

      const parsed = tryParseXunfeiTtsJson(buffer);
      if (parsed && typeof parsed === 'object' && parsed.code !== undefined && parsed.code !== null) {
        const codeNum = Number(parsed.code);
        if (!Number.isFinite(codeNum) || codeNum !== 0) {
          recordServerError('tts', 'upstream_json_code');
          const errText = parsed.desc || parsed.message || String(parsed.code);
          return res.status(502).json({
            code: 502,
            message: `TTS 上游异常：${errText}`
          });
        }
        const audioB64 = parsed.data && typeof parsed.data.audio === 'string' ? parsed.data.audio : '';
        if (audioB64.length > 0) {
          try {
            const audioBuf = Buffer.from(audioB64, 'base64');
            recordServerLatencySample('ttsSynthMs', Date.now() - ttsRouteStartedAt);
            res.status(200);
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(audioBuf);
          } catch {
            recordServerError('tts', 'b64_decode_failed');
            return res.status(502).json({ code: 502, message: 'TTS 上游返回的音频 Base64 解码失败' });
          }
        }
        recordServerError('tts', 'no_audio_in_json');
        return res.status(502).json({
          code: 502,
          message: 'TTS 上游返回成功标识但无音频数据，请检查发音人/鉴权或控制台套餐'
        });
      }

      const isJsonMime =
        contentType.includes('application/json')
        || contentType.includes('text/json')
        || (contentType.includes('text/plain') && bufferLooksLikeJsonObject(buffer));

      if (upstreamRes.statusCode < 200 || upstreamRes.statusCode >= 300 || isJsonMime) {
        let detail = '';
        try {
          detail = buffer.toString('utf-8');
        } catch {
          detail = '';
        }
        const msg = detail ? `TTS 上游异常：${detail}` : `TTS 上游异常 (HTTP ${upstreamRes.statusCode})`;
        recordServerError('tts', 'http_bad_response');
        return res.status(502).json({ code: 502, message: msg });
      }

      recordServerLatencySample('ttsSynthMs', Date.now() - ttsRouteStartedAt);
      res.status(200);
      res.setHeader('Content-Type', upstreamRes.headers['content-type'] || 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-store');
      res.end(buffer);
    });
  });

  upstreamReq.on('error', (error) => {
    recordServerError('tts', 'http_request_error');
    res.status(502).json({ code: 502, message: `TTS 请求失败：${error.message}` });
  });

  upstreamReq.on('timeout', () => {
    recordServerError('tts', 'http_timeout');
    upstreamReq.destroy();
    res.status(504).json({ code: 504, message: 'TTS 请求超时' });
  });

  upstreamReq.write(postData);
  upstreamReq.end();
});

/**
 * 从对话 messages 中取最后一条用户文本（支持字符串 content 或多模态 text 块）
 * @param {unknown[]} messages
 * @returns {string}
 */
function extractLastUserPlainTextForSafety(messages) {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index--) {
    const entry = messages[index];
    if (!entry || entry.role !== 'user') continue;
    const content = entry.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const textParts = [];
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text);
        }
      }
      return textParts.join('\n');
    }
  }
  return '';
}

/**
 * 心理场景高风险词规则命中（自伤/他伤等）。仅作技术辅助标记，非临床评估。
 * @returns {{ riskLevel: 'none'|'high', hitRules: string[], safeReplyMode: boolean }}
 */
function analyzePsychSafetyRisk(text) {
  const raw = String(text || '');
  const compact = raw.replace(/\s+/g, '');
  const lower = raw.toLowerCase();
  if (!compact && !lower.trim()) {
    return { riskLevel: 'none', hitRules: [], safeReplyMode: false };
  }

  /** @type {string[]} */
  const hitRules = [];

  const selfHarmPatterns = [
    /自杀/, /自殘/, /自残/, /轻生/, /輕生/, /不想活/, /不想活了/, /活不下去/,
    /结束生命/, /了结生命/, /自我了断/, /自我了結/, /一了百了/, /死了算了/,
    /想死/, /去死/, /求死/, /陪我去死/, /割腕/, /跳楼/, /上吊/, /烧炭/, /燒炭/,
    /卧轨/, /服毒/, /吃藥死/, /吃药死/, /结束一切/, /残害自己/, /弄死自己/
  ];
  const harmOthersPatterns = [
    /杀了他/, /殺了他/, /杀了她/, /殺了她/, /弄死他/, /弄死她/, /砍人/, /想杀人/,
    /殺人/, /报复社会/, /報復社會/, /同归于尽/, /同歸於盡/, /打死他/, /打死她/
  ];

  if (selfHarmPatterns.some((regularExpression) => regularExpression.test(compact))) {
    hitRules.push('self_harm');
  }
  if (harmOthersPatterns.some((regularExpression) => regularExpression.test(compact))) {
    hitRules.push('harm_others');
  }

  const englishSelf = /\b(suicid|kill\s*myself|self[\s-]*harm|want\s*to\s*die)\b/i.test(lower);
  if (englishSelf) hitRules.push('self_harm');

  if (hitRules.length > 0) {
    return {
      riskLevel: 'high',
      hitRules: [...new Set(hitRules)],
      safeReplyMode: true
    };
  }
  return { riskLevel: 'none', hitRules: [], safeReplyMode: false };
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function clampOptionalNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * 讯飞 MaaS 非流式补全（用于日记摘要等短输出）
 * @param {unknown[]} messages
 * @param {{ max_tokens?: number, temperature?: number }} [options]
 * @returns {Promise<string>} assistant 文本
 */
function maasChatCompletionNonStream(messages, options = {}) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      reject(new Error('未配置 XUNFEI_API_KEY'));
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      reject(new Error('messages 不能为空'));
      return;
    }
    const maxTokens = clampOptionalNumber(options.max_tokens, 32, 8192, 1024);
    const temperature = clampOptionalNumber(options.temperature, 0, 2, 0.35);
    const requestBody = {
      model: MAAS_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false
    };
    const reqOptions = {
      hostname: MAAS_HOST,
      port: 443,
      path: MAAS_PATH,
      method: 'POST',
      timeout: 55000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        'User-Agent': 'Node.js-Client',
        Accept: '*/*'
      }
    };
    const maasReq = https.request(reqOptions, (maasRes) => {
      const chunks = [];
      maasRes.on('data', (chunk) => chunks.push(chunk));
      maasRes.on('end', () => {
        const rawText = Buffer.concat(chunks).toString('utf-8');
        if (maasRes.statusCode < 200 || maasRes.statusCode >= 300) {
          reject(new Error(rawText || `HTTP ${maasRes.statusCode}`));
          return;
        }
        let parsedBody;
        try {
          parsedBody = JSON.parse(rawText);
        } catch {
          reject(new Error('MaaS 返回非 JSON'));
          return;
        }
        const content = parsedBody.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          reject(new Error('MaaS 响应缺少 choices[0].message.content'));
          return;
        }
        resolve(content.trim());
      });
    });
    maasReq.on('error', (error) => reject(error));
    maasReq.on('timeout', () => {
      maasReq.destroy();
      reject(new Error('MaaS 请求超时'));
    });
    maasReq.write(JSON.stringify(requestBody));
    maasReq.end();
  });
}

/** 从模型输出中抠 JSON 对象 */
function extractJsonObjectFromModelText(text) {
  const trimmed = String(text || '').trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function normalizeDiarySummaryPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      moodKeywords: [],
      coreEvents: '',
      aiEncouragement: '',
      moodCurve: { points: [] }
    };
  }
  const moodKeywords = Array.isArray(raw.moodKeywords)
    ? raw.moodKeywords
      .map((keyword) => String(keyword || '').trim().slice(0, 20))
      .filter(Boolean)
      .slice(0, 10)
    : [];
  const coreEvents = String(raw.coreEvents || '').trim().slice(0, 900);
  const aiEncouragement = String(raw.aiEncouragement || '').trim().slice(0, 600);
  /** @type {{ label: string, score: number }[]} */
  let points = [];
  const mc = raw.moodCurve;
  if (Array.isArray(mc)) {
    points = mc.map((pointItem, index) => {
      const label = String(pointItem?.label || `阶段${index + 1}`).slice(0, 32);
      let score = parseInt(String(pointItem?.score), 10);
      if (!Number.isFinite(score)) score = 5;
      score = Math.min(10, Math.max(1, score));
      return { label, score };
    }).slice(0, 24);
  } else if (mc && typeof mc === 'object' && Array.isArray(mc.points)) {
    points = mc.points.map((pointItem, index) => {
      const label = String(pointItem?.label || `阶段${index + 1}`).slice(0, 32);
      let score = parseInt(String(pointItem?.score), 10);
      if (!Number.isFinite(score)) score = 5;
      score = Math.min(10, Math.max(1, score));
      return { label, score };
    }).slice(0, 24);
  }
  return { moodKeywords, coreEvents, aiEncouragement, moodCurve: { points } };
}

const DIARY_SUMMARY_TRANSCRIPT_MAX = 14000;

function handleStreamRequest(messages, res, streamOptions = {}) {
  if (!API_KEY) {
    res.status(500).json({ code: 500, message: '未配置 XUNFEI_API_KEY，请在 backend/.env 中设置' });
    return;
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ code: 400, message: 'messages 必须为非空数组' });
    return;
  }

  const safetyPayload = analyzePsychSafetyRisk(extractLastUserPlainTextForSafety(messages));

  const maxTokens = clampOptionalNumber(streamOptions.max_tokens, 16, 8192, 4000);
  const temperature = clampOptionalNumber(streamOptions.temperature, 0, 2, 0.7);

  const requestBody = {
    model: MAAS_MODEL,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: true
  };

  const options = {
    hostname: MAAS_HOST,
    port: 443,
    path: MAAS_PATH,
    method: 'POST',
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'User-Agent': 'Node.js-Client',
      'Accept': '*/*'
    }
  };

  const maasReq = https.request(options, (maasRes) => {
    // 上游报错时原样返回 JSON 与状态码；若仍 pipe 成 200+乱码，前端 SSE 解析不到 → 显示「回复生成失败」
    if (maasRes.statusCode < 200 || maasRes.statusCode >= 300) {
      recordServerError('llm', `http_${maasRes.statusCode}`);
      const errorChunks = [];
      maasRes.on('data', (chunk) => errorChunks.push(chunk));
      maasRes.on('end', () => {
        const raw = Buffer.concat(errorChunks).toString('utf-8');
        res.status(maasRes.statusCode);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(raw || JSON.stringify({ error: { message: 'MaaS 上游返回空错误体' } }));
      });
      return;
    }

    const responseReceivedAt = Date.now();
    let firstUpstreamChunkRecorded = false;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    res.write(`${'data: '}${JSON.stringify({ mental_health_safety: safetyPayload })}\n\n`);

    maasRes.on('data', (chunk) => {
      if (!firstUpstreamChunkRecorded) {
        firstUpstreamChunkRecorded = true;
        recordServerLatencySample('llmFirstUpstreamChunkMs', Date.now() - responseReceivedAt);
      }
      const canContinue = res.write(chunk);
      if (!canContinue) maasRes.pause();
    });
    res.on('drain', () => {
      maasRes.resume();
    });
    maasRes.on('end', () => {
      res.end();
    });
    maasRes.on('error', () => {
      recordServerError('llm', 'upstream_stream_error');
      if (!res.writableEnded) res.end();
    });
  });

  maasReq.on('error', (error) => {
    recordServerError('llm', 'request_error');
    res.write(`data: {"error": "流式请求失败：${error.message}"}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });

  maasReq.on('timeout', () => {
    recordServerError('llm', 'request_timeout');
    maasReq.destroy();
    res.write(`data: {"error": "请求超时"}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });

  maasReq.write(JSON.stringify(requestBody));
  maasReq.end();
}

// ==================== 健康检查 ====================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'AI Chat API is running',
    /** 便于确认当前进程是否为去掉 Gemini 后的讯飞转发（若仍为 gemini 则说明端口上跑的是旧进程） */
    llm: 'xunfei-maas',
    observability: getServerObservabilitySnapshot()
  });
});

const server = http.createServer(app);

// ==================== STT WebSocket（实时转写：讯飞 IAT 或 RTASR /ws/stt） ====================
// 客户端 JSON 协议：start → audio（可多次）→ stop；服务端统一回包见 README。
const wss = new WebSocket.Server({ server, path: '/ws/stt' });

function parseBearerFromQuery(urlString) {
  try {
    const url = new URL(urlString, 'http://localhost');
    const token = url.searchParams.get('token');
    return token ? String(token) : '';
  } catch {
    return '';
  }
}

function safeSendSttClient(clientWs, payloadObject) {
  if (clientWs.readyState === WebSocket.OPEN) {
    try {
      clientWs.send(JSON.stringify(payloadObject));
    } catch {
      // ignore
    }
  }
}

wss.on('connection', (client, req) => {
  const token = parseBearerFromQuery(req.url || '');
  if (!token) {
    recordServerError('wsStt', 'missing_token');
    safeSendSttClient(client, {
      type: 'error',
      code: 'missing_token',
      message: '缺少 token 查询参数（例：ws://host/ws/stt?token=JWT）'
    });
    client.close(4401, 'missing-token');
    return;
  }

  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    recordServerError('wsStt', 'invalid_token');
    safeSendSttClient(client, {
      type: 'error',
      code: 'invalid_token',
      message: '令牌无效或已过期'
    });
    client.close(4401, 'invalid-token');
    return;
  }

  safeSendSttClient(client, { type: 'ready' });

  /** @type {ReturnType<typeof createSttRealtimeSession>|ReturnType<typeof createRtasrSttSession>|null} */
  let sttSession = null;

  client.on('message', async (raw) => {
    let data;
    try {
      data = JSON.parse(String(raw || ''));
    } catch {
      recordServerError('wsStt', 'bad_json');
      safeSendSttClient(client, {
        type: 'error',
        code: 'bad_json',
        message: '无法解析 JSON'
      });
      return;
    }

    const messageType = data && data.type;

    if (messageType === 'start') {
      if (sttSession) {
        recordServerError('wsStt', 'invalid_state');
        safeSendSttClient(client, {
          type: 'error',
          code: 'invalid_state',
          message: '已在识别中，请先发送 stop 再 start'
        });
        return;
      }
      if (STT_PROVIDER === 'xunfei-rtasr-ws') {
        sttSession = createRtasrSttSession(client, rtasrSttSessionCtx);
      } else if (STT_PROVIDER === 'xunfei-iat-ws') {
        sttSession = createSttRealtimeSession(client);
      } else {
        recordServerError('wsStt', 'stt_provider_unsupported');
        safeSendSttClient(client, {
          type: 'error',
          code: 'stt_provider_unsupported',
          message:
            `不支持的 STT_PROVIDER=${String(STT_PROVIDER)}，请使用 xunfei-iat-ws（语音听写）或 xunfei-rtasr-ws（实时语音转写）`
        });
        return;
      }
      try {
        await sttSession.start();
      } catch {
        sttSession.destroyHard();
        sttSession = null;
        return;
      }
      safeSendSttClient(client, { type: 'started' });
      return;
    }

    if (messageType === 'audio') {
      if (!sttSession) {
        safeSendSttClient(client, {
          type: 'error',
          code: 'not_started',
          message: '请先发送 start 再发送音频'
        });
        return;
      }
      const base64Chunk =
        typeof data.data === 'string'
          ? data.data
          : typeof data.audio === 'string'
            ? data.audio
            : '';
      sttSession.pushAudioBase64(base64Chunk);
      return;
    }

    if (messageType === 'stop') {
      if (!sttSession) {
        safeSendSttClient(client, {
          type: 'error',
          code: 'not_started',
          message: '当前没有进行中的识别会话'
        });
        return;
      }
      const activeSession = sttSession;
      sttSession = null;
      await activeSession.finishStop();
      return;
    }

    safeSendSttClient(client, {
      type: 'error',
      code: 'unknown_type',
      message: `未知的 type：${String(messageType)}`
    });
  });

  client.on('close', () => {
    if (sttSession) {
      sttSession.destroyHard();
      sttSession = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
