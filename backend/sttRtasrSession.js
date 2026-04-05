'use strict';

/**
 * 讯飞实时语音转写 RTASR（wss://rtasr.xfyun.cn/v1/ws）与浏览器 /ws/stt 的桥接。
 * 音频：二进制 PCM；结束：二进制 {"end":true}。
 *
 * @param {import('ws')} clientWs
 * @param {object} ctx
 * @param {typeof import('ws')} ctx.WebSocket
 * @param {(code: string, message: string) => void} ctx.recordServerError
 * @param {(name: string, value: number) => void} ctx.recordServerLatencySample
 * @param {string} ctx.appId
 * @param {string} ctx.apiKey
 * @param {() => string} ctx.buildRtasrUrl
 * @param {(inner: object) => string} ctx.collectTextFromInner
 * @param {number} ctx.STT_WS_IDLE_TIMEOUT_MS
 * @param {number} ctx.STT_WS_UPSTREAM_CONNECT_MS
 * @param {number} ctx.STT_WS_UPSTREAM_SESSION_MS
 * @param {number} ctx.STT_WS_STOP_WAIT_MS
 * @param {number} ctx.STT_WS_PCM_FRAME_BYTES
 * @param {number} ctx.STT_WS_MAX_AUDIO_MSG_PER_SEC
 * @param {number} ctx.STT_WS_MAX_CLIENT_CHUNK_BYTES
 * @param {number} ctx.STT_WS_MAX_SESSION_INGEST_BYTES
 */
function createRtasrSttSession(clientWs, ctx) {
  const {
    WebSocket,
    recordServerError,
    recordServerLatencySample,
    appId,
    apiKey,
    buildRtasrUrl,
    collectTextFromInner,
    STT_WS_IDLE_TIMEOUT_MS,
    STT_WS_UPSTREAM_CONNECT_MS,
    STT_WS_UPSTREAM_SESSION_MS,
    STT_WS_STOP_WAIT_MS,
    STT_WS_PCM_FRAME_BYTES,
    STT_WS_MAX_AUDIO_MSG_PER_SEC,
    STT_WS_MAX_CLIENT_CHUNK_BYTES,
    STT_WS_MAX_SESSION_INGEST_BYTES
  } = ctx;

  /** @type {import('ws')|null} */
  let upstream = null;
  /** 已落段的最终文本 */
  let textAccum = '';
  /** 当前句中间结果（type=1） */
  let draftSeg = '';
  let lastPartialText = '';
  let pcmQueue = Buffer.alloc(0);
  let destroyed = false;
  let clientFinalSent = false;
  let rtasrHandshakeOk = false;
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
  /** @type {((err: Error) => void) | null} */
  let pendingStartReject = null;
  let sessionIngestBytes = 0;
  /** @type {number[]} */
  let audioMsgTimestamps = [];
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
    safeSendClient({ type: 'final', text: (textAccum + draftSeg).trim() });
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

  function flushRtasrPcmBinary() {
    if (!upstream || upstream.readyState !== WebSocket.OPEN || destroyed || !rtasrHandshakeOk) {
      return;
    }
    while (pcmQueue.length >= STT_WS_PCM_FRAME_BYTES) {
      const frame = pcmQueue.subarray(0, STT_WS_PCM_FRAME_BYTES);
      pcmQueue = pcmQueue.subarray(STT_WS_PCM_FRAME_BYTES);
      upstream.send(frame);
    }
  }

  function sendRtasrEndMarker() {
    if (!upstream || upstream.readyState !== WebSocket.OPEN || destroyed) return;
    while (pcmQueue.length > 0) {
      const take = Math.min(STT_WS_PCM_FRAME_BYTES, pcmQueue.length);
      const chunk = pcmQueue.subarray(0, take);
      pcmQueue = pcmQueue.subarray(take);
      upstream.send(chunk);
    }
    upstream.send(Buffer.from(JSON.stringify({ end: true }), 'utf8'));
  }

  function emitPartialIfChanged(display) {
    if (display === lastPartialText) return;
    lastPartialText = display;
    if (display && upstreamOpenMs > 0 && !wsSttFirstPartialRecorded) {
      wsSttFirstPartialRecorded = true;
      recordServerLatencySample(
        'wsSttFirstPartialMs',
        Date.now() - upstreamOpenMs
      );
    }
    safeSendClient({ type: 'partial', text: display });
  }

  function handleRtasrUpstreamMessage(raw) {
    if (Buffer.isBuffer(raw)) return;
    if (destroyed) return;
    let messageJson;
    try {
      messageJson = JSON.parse(String(raw || ''));
    } catch {
      return;
    }
    const action = messageJson.action;
    const code = String(messageJson.code ?? '');
    if (action === 'started' && code === '0') {
      rtasrHandshakeOk = true;
      flushRtasrPcmBinary();
      return;
    }
    if (action === 'error') {
      destroyWithUpstreamError(
        'upstream_stt',
        messageJson.desc || `实时转写错误 ${code}`
      );
      return;
    }
    if (action !== 'result' || code !== '0') return;
    let inner;
    try {
      inner = JSON.parse(messageJson.data || '{}');
    } catch {
      return;
    }
    if (inner.biz === 'trans') {
      const src = typeof inner.src === 'string' ? inner.src : '';
      const isEnd = Boolean(inner.isEnd);
      if (isEnd && src) {
        textAccum = `${textAccum}${src}`.trim();
        draftSeg = '';
      } else {
        draftSeg = src;
      }
      emitPartialIfChanged((textAccum + draftSeg).trim());
      return;
    }
    const piece = collectTextFromInner(inner);
    const st = inner.cn?.st;
    const t = st?.type;
    const isFinalSeg = t === 0 || t === '0';
    if (isFinalSeg) {
      textAccum = (textAccum + piece).trim();
      draftSeg = '';
      emitPartialIfChanged(textAccum);
    } else {
      draftSeg = piece;
      emitPartialIfChanged((textAccum + draftSeg).trim());
    }
  }

  function start() {
    if (!appId || !apiKey) {
      sendErrorToClient(
        'stt_not_configured',
        '未配置实时语音转写（XUNFEI_RTASR_APP_ID / XUNFEI_RTASR_API_KEY）'
      );
      return Promise.reject(new Error('stt_not_configured'));
    }
    return new Promise((connectResolve, connectReject) => {
      pendingStartReject = connectReject;
      const wsUrl = buildRtasrUrl();
      connectTimer = setTimeout(() => {
        connectTimer = null;
        destroyed = true;
        cleanupUpstreamSocket();
        const rejectFn = pendingStartReject;
        pendingStartReject = null;
        if (rejectFn) {
          rejectFn(new Error('upstream_connect_timeout'));
        }
        sendErrorToClient('upstream_connect_timeout', '连接上游实时转写服务超时');
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

      upstream.on('message', (messageRaw) => {
        handleRtasrUpstreamMessage(messageRaw);
      });

      upstream.on('error', (wsError) => {
        if (destroyed) return;
        destroyWithUpstreamError(
          'upstream_error',
          wsError?.message || '上游实时转写连接错误'
        );
      });

      upstream.on('close', () => {
        if (destroyed) return;
        finalizeClosedUpstream();
      });
    });
  }

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
    flushRtasrPcmBinary();
  }

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
      sendRtasrEndMarker();
      stopWaitTimer = setTimeout(() => {
        stopWaitTimer = null;
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

module.exports = { createRtasrSttSession };
