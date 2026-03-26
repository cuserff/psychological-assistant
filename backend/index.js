const express = require('express');
const cors = require('cors');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const API_KEY = process.env.XUNFEI_API_KEY;
/** 讯飞 MaaS：模型与网关路径建议配在 .env，避免改代码 */
const MAAS_MODEL = process.env.XUNFEI_MAAS_MODEL || 'xopqwen35v35b';
const MAAS_HOST = process.env.XUNFEI_MAAS_HOST || 'maas-api.cn-huabei-1.xf-yun.com';
const MAAS_PATH = process.env.XUNFEI_MAAS_PATH || '/v2/chat/completions';
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mental-health-assistant-jwt-secret';

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_DIR = path.join(DATA_DIR, 'chats');
const CHECKINS_DIR = path.join(DATA_DIR, 'checkins');
const ASSESSMENTS_DIR = path.join(DATA_DIR, 'assessments');
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

// ==================== 工具函数 ====================

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
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

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
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

// 管理员视角用户字段（含明文密码和心理状态）
function adminSanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    displayPassword: user.displayPassword || '',
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
    displayPassword: adminPassword,
    avatar: '',
    role: 'admin',
    mentalHealthStatus: '未评估',
    mentalHealthNote: '',
    createdAt: new Date().toISOString()
  };

  users.unshift(adminUser);
  writeUsers(users);
  console.log('已创建默认管理员账号：admin / admin123');
}

initAdminAccount();

// 为历史注册用户补写缺失的 displayPassword 字段标记
function migrateDisplayPassword() {
  const users = readUsers();
  let changed = false;
  users.forEach(user => {
    if (user.displayPassword === undefined) {
      user.displayPassword = '';
      changed = true;
    }
  });
  if (changed) writeUsers(users);
}

migrateDisplayPassword();

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
    displayPassword: password,
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
  users[userIndex].displayPassword = newPassword;
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

app.post('/api/chat', (req, res) => {
  const { messages } = req.body;
  handleStreamRequest(messages, res);
});

function handleStreamRequest(messages, res) {
  if (!API_KEY) {
    res.status(500).json({ code: 500, message: '未配置 XUNFEI_API_KEY，请在 backend/.env 中设置' });
    return;
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ code: 400, message: 'messages 必须为非空数组' });
    return;
  }

  const requestBody = {
    model: MAAS_MODEL,
    messages,
    max_tokens: 4000,
    temperature: 0.7,
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

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    maasRes.pipe(res);
  });

  maasReq.on('error', (error) => {
    res.write(`data: {"error": "流式请求失败：${error.message}"}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });

  maasReq.on('timeout', () => {
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
  res.json({ status: 'ok', message: 'AI Chat API is running' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
