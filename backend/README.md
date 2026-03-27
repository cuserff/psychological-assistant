# AI Chat Backend Service

一个基于Node.js和Express的AI聊天后端服务，兼容OpenAI API格式，支持与讯飞MaaS平台进行交互。

## 功能特性

- ✅ 兼容OpenAI API格式的聊天接口
- ✅ 支持普通非流式对话
- ✅ 支持流式对话
- ✅ 环境变量配置，安全管理API密钥
- ✅ 跨域支持

## 安装和配置

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在项目根目录创建`.env`文件，并添加以下配置：

```env
# 服务器端口
PORT=3000

# 讯飞MaaS平台API密钥
API_KEY=your_xunfei_maas_api_key

# 讯飞应用ID（可选，当前实现暂不使用）
APPID=your_xunfei_app_id

# 讯飞API密钥（可选，当前实现暂不使用）
API_SECRET=your_xunfei_api_secret
```

**注意事项：**
- `API_KEY`需要从讯飞MaaS服务管控页面获取
- `MODEL_ID`默认使用`xop3qwen1b7`，可根据实际情况调整

### 3. 启动服务

```bash
#后端运行
cd backend
node index.js
# 前端运行
cd ..
npm run dev

# 生产模式启动
npm start
```

服务将在`http://localhost:3000`启动

## API使用说明

### 聊天接口

```
POST /api/chat
```

**请求参数：**

| 参数名 | 类型 | 必填 | 描述 |
|--------|------|------|------|
| messages | Array | 是 | 对话消息列表 |
| stream | Boolean | 否 | 是否使用流式输出（默认：false） |
| temperature | Number | 否 | 温度参数（默认：0.7） |
| max_tokens | Number | 否 | 最大生成token数（默认：4000） |

**请求示例：**

```json
{
  "messages": [
    {
      "role": "user",
      "content": "你好，请介绍一下自己"
    }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 4000
}
```

**非流式响应示例：**

```json
{
  "id": "cht000xxxx@dx19b0xxxxxxx",
  "object": "chat.completion",
  "created": 1765285704,
  "model": "xop3qwen1b7",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好！我是你的AI助手...",
        "reasoning_content": "",
        "plugins_content": null
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 17,
    "completion_tokens": 77,
    "total_tokens": 94
  }
}
```

**流式响应示例：**

```
data: {"id":"cht000xxxx@dx19b0xxxxxxx","object":"chat.completion","created":1765285710,"model":"xop3qwen1b7","choices":[{"index":0,"message":{"role":"assistant","content":"你好！我是你的AI助手...","reasoning_content":"","plugins_content":null},"finish_reason":"stop"}],"usage":{"prompt_tokens":17,"completion_tokens":70,"total_tokens":87}}

data: [DONE]
```

### 健康检查接口

```
GET /health
```

**响应示例：**

```json
{
  "status": "ok",
  "message": "AI Chat API is running"
}
```

## 实时语音转写 WebSocket：`/ws/stt`

与 HTTP `POST /api/voice/stt` 相同，默认走**讯飞语音听写（流式版）** WebSocket，多帧上传（`status` 0/1/2）。浏览器或其它客户端可用本接口做「边录边出字」。

### 连接与鉴权

- 地址：`ws://<host>:<PORT>/ws/stt?token=<JWT>`
- `token` 为登录接口返回的 JWT（与 REST `Authorization: Bearer` 同源），非法或缺失会先收到结构化 `error` 再断开。

### 服务端 → 客户端（统一回包）

| JSON | 含义 |
|------|------|
| `{ "type": "ready" }` | 鉴权通过，可发 `start` |
| `{ "type": "started" }` | 上游听写会话已就绪 |
| `{ "type": "partial", "text": "..." }` | 中间识别结果（随上游增量更新） |
| `{ "type": "final", "text": "..." }` | 本轮结束（`stop` 或空闲超时等） |
| `{ "type": "error", "code": "...", "message": "..." }` | 可恢复或不可恢复错误；连接可能随后关闭 |

常见 `code`：`missing_token`、`invalid_token`、`bad_json`、`not_started`、`invalid_state`、`idle_timeout`、`session_timeout`、`upstream_connect_timeout`、`upstream_stt` 等。

### 客户端 → 服务端

1. `{"type":"start"}` — 建立上游连接；成功后在收到 `started` 后再发音频。
2. `{"type":"audio","data":"<base64>"}` — PCM L16 单声道 raw（与 `XUNFEI_STT_SAMPLE_RATE` 一致，默认 16k）；可多次发送。字段名也可用 `audio` 代替 `data`。
3. `{"type":"stop"}` — 结束上行并等待 `final`。

长时间无 `audio` 将自动 `stop` 并下发 `idle_timeout` 的 `error`（时长见环境变量 `STT_WS_IDLE_TIMEOUT_MS`）。客户端断开时上游与定时器会清理。

### 环境与密钥

在 `.env` 中配置与短音频 STT 一致的 `STT_PROVIDER=xunfei-iat-ws` 及 `XUNFEI_STT_*`（或回退 `XUNFEI_RTASR_*` / `XUNFEI_TTS_*`）。可选：`STT_WS_IDLE_TIMEOUT_MS`、`STT_WS_UPSTREAM_CONNECT_MS`、`STT_WS_UPSTREAM_SESSION_MS`、`STT_WS_STOP_WAIT_MS`、`STT_WS_PCM_FRAME_BYTES`、`XUNFEI_STT_LANGUAGE`、`XUNFEI_STT_SAMPLE_RATE` 等，见 `.env.example`。

### 手工验收（示例）

使用任意 WebSocket 调试工具连上带 `token` 的 URL 后依次发送：`start` → 若干 `audio`（有效 PCM base64）→ `stop`，应能收到 `partial` 与最终 `final`。勿将真实 JWT 写入文档或截图。

## 关于流式请求的说明

系统支持完整的流式对话功能：

- 客户端可以发送`stream: true`的请求启用流式输出
- 服务器会将请求以流式方式发送给AI服务
- 服务器会将AI服务的流式响应通过SSE格式（Server-Sent Events）实时返回给客户端

流式请求的优势：
1. 更快的响应速度（无需等待完整响应生成）
2. 更好的用户体验（实时显示生成内容）
3. 支持长时间对话（避免超时问题）

## 技术栈

- Node.js
- 原生HTTP模块（替代Express，提升流式性能）
- dotenv
- cors（通过原生代码实现）

## 开发和调试

### 查看日志

服务器运行时会输出详细的日志信息，包括：
- 请求参数
- 响应数据
- 错误信息

可以通过终端查看这些日志，帮助调试和问题排查。

### 测试API

可以使用curl或Postman等工具测试API：

```bash
# 测试非流式请求
curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d '{"messages": [{"role": "user", "content": "你好"}], "stream": false}'

# 测试流式请求
curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d '{"messages": [{"role": "user", "content": "你好"}], "stream": true}'
```

## 错误处理

服务会返回以下常见错误：

- `400 Bad Request`：请求参数格式错误
- `500 Internal Server Error`：服务器内部错误

错误响应格式：

```json
{
  "error": "错误描述信息"
}
```

## 安全注意事项

1. 不要将API密钥硬编码在代码中，使用环境变量管理
2. 生产环境中建议启用HTTPS
3. 考虑添加API请求频率限制
4. 定期更新依赖包，修复安全漏洞

## 未来改进计划

- [ ] 解决流式请求连接稳定性问题
- [ ] 添加更多AI模型支持
- [ ] 实现请求缓存机制
- [ ] 添加API文档页面
- [ ] 支持更多OpenAI API特性

## 许可证

ISC
