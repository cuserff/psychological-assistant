<script setup>
/**
 * 流沙视觉 MVP（图片点阵粒子）：
 * - 离屏绘制缩略图 → 2～6px 步长抽样 → 每粒子 RGBA + 边缘因子（靠边更易「飘散」）；
 * - 弹簧回位 home + 微重力 + 相位：聆听呼吸、思考轻旋/向心、说话合成音量脉冲（待定可换 AnalyserNode）；
 * - 粒子上限：窄屏 / UA 约 12k，桌面约 32k；idle 约 0.45s 后按 ~15fps 绘制。
 *
 * 精致版建议（本文件未实现）：Simplex/Perlin 漂移场；暗角与柔光；换图时爆散再回聚；
 * WebAudio：由父组件传入 `audioLevel`（麦克风 RMS 归一化）驱动录音相位的速度/聚拢与连线粗细。
 * （产品曾用名 ParticleBackground；本文件即语音页粒子主组件。）
 *
 * 动画： physics 按真实帧间隔缩放（近似与帧率无关）；麦克风电平滑；相位切换短时混合；闲置微呼吸。
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  /** 已可用的图片 URL（同源或允许 CORS，否则抽样会失败并静默回退） */
  imageSrc: { type: String, default: '' },
  /** idle | recording | thinking | playing */
  phase: {
    type: String,
    default: 'idle'
  },
  /**
   * 麦克风音量 0..1（recording 时由 Web Audio Analyser 驱动；其余相位可传 0）
   */
  audioLevel: {
    type: Number,
    default: 0
  }
})

const wrapperRef = ref(null)
const canvasRef = ref(null)

/** @type {CanvasRenderingContext2D|null} */
let ctx2d = null

/** @type {number|null} */
let rafId = null
/** @type {ResizeObserver|null} */
let resizeObserver = null

let canvasCssW = 1
let canvasCssH = 1
let deviceRatio = 1

/** @type {{ x: number, y: number, w: number, h: number }} */
let imageRect = { x: 0, y: 0, w: 1, h: 1 }
let imageAspect = 1

/** @type {Float32Array|number[]} homeNx */
let homeNx = new Float32Array(0)
/** @type {Float32Array|number[]} homeNy */
let homeNy = new Float32Array(0)
/** @type {Float32Array} px — 当前 x */
let px = new Float32Array(0)
/** @type {Float32Array} py */
let py = new Float32Array(0)
/** @type {Float32Array} vx */
let vx = new Float32Array(0)
/** @type {Float32Array} vy */
let vy = new Float32Array(0)
/** @type {Uint8Array} pr,pg,pb */
let pr = new Uint8Array(0)
let pg = new Uint8Array(0)
let pb = new Uint8Array(0)
/** @type {Float32Array} pa 0..1 */
let pa = new Float32Array(0)
/** @type {Float32Array} edgeF 边缘因子 0..1 越大越靠边 */
let edgeF = new Float32Array(0)
/** @type {Float32Array} seed 每粒子随机相 */
let pSeed = new Float32Array(0)

let particleCount = 0
let lastWallMs = 0
/** 上一帧 physics 时刻，用于 dt */
let lastPhysicsMs = 0
/** 麦克风可视化平滑 0..1（与 STT 无关，仅驱动粒子） */
let micLevelSmoothed = 0
/** 相位混合：切相后由 0→1，用于缓入目标力学参数 */
let phaseEase = 1
/** @type {'idle'|'recording'|'thinking'|'playing'} */
let phasePrev = 'idle'
/** @type {'idle'|'recording'|'thinking'|'playing'} */
let phaseCurr = 'idle'
/** 最近一次进入 idle 相位的时刻，用于降帧 */
let idleEnteredMs = 0
let lastPhaseForIdle = 'idle'

/** 移动端约 8k–20k 取下限；PC 约 20k–60k 取中档 */
function maxParticlesForDevice() {
  if (typeof window === 'undefined') return 14000
  const narrow = window.innerWidth < 768
  const coarse =
    typeof navigator !== 'undefined'
    && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
  if (narrow || coarse) {
    return 12000
  }
  return 32000
}

const SAMPLE_STEP_MIN = 2
const SAMPLE_STEP_MAX = 6

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value))
}

function smoothStep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * 与「约 60fps、单步」相当的缩放系数，用于弹簧与阻尼接近期望与帧率无关
 * @param {number} deltaMs
 */
function dtScaleFromMs(deltaMs) {
  return clamp(deltaMs / (1000 / 60), 0.42, 3.4)
}

function layoutImageRect(canvasW, canvasH, aspect) {
  const maxW = canvasW * 0.78
  const maxH = canvasH * 0.58
  let rectW = maxW
  let rectH = rectW / aspect
  if (rectH > maxH) {
    rectH = maxH
    rectW = rectH * aspect
  }
  const rectX = (canvasW - rectW) / 2
  const rectY = (canvasH - rectH) / 2 - canvasH * 0.04
  return { x: rectX, y: rectY, w: rectW, h: rectH }
}

/**
 * 从图片构建粒子（失败则 particleCount=0）
 * @param {string} src
 */
function buildParticlesFromImageUrl(src) {
  particleCount = 0
  homeNx = new Float32Array(0)
  if (!src || typeof Image === 'undefined') return

  const img = new Image()
  if (!src.startsWith('data:')) {
    img.crossOrigin = 'anonymous'
  }

  img.onload = () => {
    const naturalW = img.naturalWidth || img.width
    const naturalH = img.naturalHeight || img.height
    if (naturalW < 2 || naturalH < 2) return

    imageAspect = naturalW / naturalH
    const maxSampleSide = 420
    let sampleW = Math.min(maxSampleSide, naturalW)
    let sampleH = Math.round(sampleW / imageAspect)
    if (sampleH > maxSampleSide) {
      sampleH = maxSampleSide
      sampleW = Math.round(sampleH * imageAspect)
    }

    const off = document.createElement('canvas')
    off.width = sampleW
    off.height = sampleH
    const octx = off.getContext('2d')
    if (!octx) return
    octx.drawImage(img, 0, 0, sampleW, sampleH)
    let imageData
    try {
      imageData = octx.getImageData(0, 0, sampleW, sampleH)
    } catch {
      return
    }

    const data = imageData.data
    const caps = maxParticlesForDevice()
    let step = SAMPLE_STEP_MIN
    let roughCount = Math.ceil(sampleW / step) * Math.ceil(sampleH / step)
    while (roughCount > caps && step < SAMPLE_STEP_MAX) {
      step += 1
      roughCount = Math.ceil(sampleW / step) * Math.ceil(sampleH / step)
    }

    /** @type {{ nx: number, ny: number, edge: number, r: number, g: number, b: number, a: number }[]} */
    const samples = []

    for (let iy = 0; iy < sampleH; iy += step) {
      for (let ix = 0; ix < sampleW; ix += step) {
        const pixelIndex = (iy * sampleW + ix) * 4
        const alphaByte = data[pixelIndex + 3]
        if (alphaByte < 22) continue
        const nx = (ix + 0.5) / sampleW
        const ny = (iy + 0.5) / sampleH
        const edge = clamp(
          Math.min(nx, ny, 1 - nx, 1 - ny) * 3.2,
          0,
          1
        )
        samples.push({
          nx,
          ny,
          edge,
          r: data[pixelIndex],
          g: data[pixelIndex + 1],
          b: data[pixelIndex + 2],
          a: alphaByte / 255
        })
      }
    }

    const total = samples.length
    if (total === 0) return

    let skip = 1
    if (total > caps) {
      skip = Math.ceil(total / caps)
    }

    const filteredN = Math.ceil(total / skip)
    homeNx = new Float32Array(filteredN)
    homeNy = new Float32Array(filteredN)
    edgeF = new Float32Array(filteredN)
    pr = new Uint8Array(filteredN)
    pg = new Uint8Array(filteredN)
    pb = new Uint8Array(filteredN)
    pa = new Float32Array(filteredN)
    pSeed = new Float32Array(filteredN)
    px = new Float32Array(filteredN)
    py = new Float32Array(filteredN)
    vx = new Float32Array(filteredN)
    vy = new Float32Array(filteredN)

    let writeIndex = 0
    for (let index = 0; index < total; index += skip) {
      const sampleItem = samples[index]
      homeNx[writeIndex] = sampleItem.nx
      homeNy[writeIndex] = sampleItem.ny
      edgeF[writeIndex] = sampleItem.edge
      pr[writeIndex] = sampleItem.r
      pg[writeIndex] = sampleItem.g
      pb[writeIndex] = sampleItem.b
      pa[writeIndex] = sampleItem.a
      pSeed[writeIndex] = Math.random() * Math.PI * 2
      writeIndex++
    }
    particleCount = writeIndex
    syncHomeToCanvasPositions(true)
    lastWallMs = performance.now()
  }

  img.onerror = () => {
    particleCount = 0
  }
  img.src = src
}

function syncHomeToCanvasPositions(resetMotion) {
  if (particleCount === 0) return
  imageRect = layoutImageRect(canvasCssW, canvasCssH, imageAspect)
  for (let index = 0; index < particleCount; index++) {
    const homeX = imageRect.x + homeNx[index] * imageRect.w
    const homeY = imageRect.y + homeNy[index] * imageRect.h
    if (resetMotion) {
      px[index] = homeX
      py[index] = homeY
      vx[index] = (Math.random() - 0.5) * 0.35
      vy[index] = (Math.random() - 0.5) * 0.35
    }
  }
}

function resizeCanvas() {
  const canvas = canvasRef.value
  const wrap = wrapperRef.value
  if (!canvas || !wrap) return
  const rect = wrap.getBoundingClientRect()
  canvasCssW = Math.max(32, rect.width)
  canvasCssH = Math.max(32, rect.height)
  deviceRatio = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.floor(canvasCssW * deviceRatio)
  canvas.height = Math.floor(canvasCssH * deviceRatio)
  const nextCtx = canvas.getContext('2d', { alpha: true, desynchronized: true })
  ctx2d = nextCtx || null
  if (ctx2d) {
    ctx2d.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0)
    ctx2d.imageSmoothingEnabled = false
  }
  syncHomeToCanvasPositions(false)
}

/**
 * @param {'idle'|'recording'|'thinking'|'playing'} phase
 * @param {number} tSec
 * @param {number} mic 平滑后的 0..1
 */
function packPhysics(phase, tSec, mic) {
  let spring = 0.022
  let damp = 0.91
  let gravity = 0.018
  let breathAmp = 0
  let rotateStrength = 0
  let speakPulse = 1
  let diffuse = 0.35

  if (phase === 'recording') {
    spring = 0.032 + mic * 0.08
    damp = Math.max(0.74, 0.893 - mic * 0.068)
    gravity = 0.011 + mic * 0.012
    breathAmp = 2.55 + mic * 6.95
    diffuse = 0.25 - mic * 0.11
    rotateStrength = 0
    speakPulse = 1 - mic * 0.22
  } else if (phase === 'thinking') {
    spring = 0.026
    damp = 0.93
    gravity = 0.01
    rotateStrength = 28
    diffuse = 0.4
    speakPulse = 1 + 0.048 * Math.sin(tSec * 1.08)
  } else if (phase === 'playing') {
    spring = 0.017
    damp = 0.88
    gravity = 0.02
    speakPulse =
      1
      + 0.12 * Math.sin(tSec * 6.9)
      + 0.07 * Math.sin(tSec * 12.4)
      + 0.04 * Math.sin(tSec * 19.1)
    diffuse = 0.55
  } else {
    spring = 0.0195
    damp = 0.942
    gravity = 0.013
    breathAmp = 0.95
    diffuse = 0.3
  }

  return {
    spring,
    damp,
    gravity,
    breathAmp,
    rotateStrength,
    speakPulse,
    diffuse
  }
}

function lerpPhysics(prevPack, nextPack, weight) {
  return {
    spring: prevPack.spring + (nextPack.spring - prevPack.spring) * weight,
    damp: prevPack.damp + (nextPack.damp - prevPack.damp) * weight,
    gravity: prevPack.gravity + (nextPack.gravity - prevPack.gravity) * weight,
    breathAmp: prevPack.breathAmp + (nextPack.breathAmp - prevPack.breathAmp) * weight,
    rotateStrength:
      prevPack.rotateStrength
      + (nextPack.rotateStrength - prevPack.rotateStrength) * weight,
    speakPulse:
      prevPack.speakPulse + (nextPack.speakPulse - prevPack.speakPulse) * weight,
    diffuse: prevPack.diffuse + (nextPack.diffuse - prevPack.diffuse) * weight
  }
}

function drawFrame(timeMs) {
  const ctx = ctx2d
  const canvas = canvasRef.value
  if (!ctx || !canvas || canvasCssW < 16) {
    rafId = requestAnimationFrame(drawFrame)
    return
  }

  const phase = props.phase
  if (phase !== lastPhaseForIdle) {
    lastPhaseForIdle = phase
    if (phase === 'idle') {
      idleEnteredMs = timeMs
    }
  }

  const useLowFps =
    phase === 'idle'
    && timeMs - idleEnteredMs > 450
    && particleCount > 0
  const minDelta = useLowFps ? 64 : 12
  if (timeMs - lastWallMs < minDelta) {
    rafId = requestAnimationFrame(drawFrame)
    return
  }

  let deltaMs = timeMs - lastPhysicsMs
  if (lastPhysicsMs <= 0) {
    deltaMs = 16.67
  }
  lastPhysicsMs = timeMs
  lastWallMs = timeMs
  deltaMs = clamp(deltaMs, 9, 110)
  const dtScale = dtScaleFromMs(deltaMs)
  const deltaSec = deltaMs * 0.001

  phaseEase = Math.min(1, phaseEase + deltaSec * 3.35)
  const phaseBlendWeight = smoothStep(0, 1, phaseEase)
  if (phaseEase >= 0.998) {
    phasePrev = phaseCurr
  }

  const micRaw = clamp(Number(props.audioLevel) || 0, 0, 1)
  const inOrLeavingRecording =
    phaseCurr === 'recording'
    || phasePrev === 'recording'
    || phaseBlendWeight < 0.98
  if (inOrLeavingRecording && (phaseCurr === 'recording' || micRaw > 0.02)) {
    micLevelSmoothed = micLevelSmoothed * 0.72 + micRaw * 0.28
  } else {
    micLevelSmoothed *= 0.86
  }
  const micDisplay = clamp(micLevelSmoothed, 0, 1)

  const t = timeMs * 0.001
  imageRect = layoutImageRect(canvasCssW, canvasCssH, imageAspect)

  const centerCanvasX = canvasCssW / 2
  const centerCanvasY = canvasCssH / 2
  const rectCx = imageRect.x + imageRect.w / 2
  const rectCy = imageRect.y + imageRect.h / 2

  const physicsA = packPhysics(phasePrev, t, micDisplay)
  const physicsB = packPhysics(phaseCurr, t, micDisplay)
  const {
    spring,
    damp,
    gravity,
    breathAmp,
    rotateStrength,
    speakPulse,
    diffuse
  } = lerpPhysics(physicsA, physicsB, phaseBlendWeight)

  ctx.clearRect(0, 0, canvasCssW, canvasCssH)

  const cosR = Math.cos(t * 0.38)
  const sinR = Math.sin(t * 0.38)

  for (let index = 0; index < particleCount; index++) {
    const nx = homeNx[index]
    const ny = homeNy[index]
    let homeX = imageRect.x + nx * imageRect.w
    let homeY = imageRect.y + ny * imageRect.h

    if (breathAmp > 0) {
      const breath = Math.sin(t * 2.05 + pSeed[index]) * breathAmp
      homeX += breath * (nx - 0.5)
      homeY += breath * (ny - 0.5)
    }

    if (rotateStrength > 0) {
      const dx0 = homeX - rectCx
      const dy0 = homeY - rectCy
      const sinT = Math.sin(t * 0.55 + edgeF[index])
      const cosT = Math.cos(t * 0.55 + edgeF[index])
      const pull = 0.12 * Math.sin(t * 0.9 + pSeed[index])
      homeX =
        rectCx
        + dx0 * cosT * (1 - pull)
        - dy0 * sinT * (1 - pull) * 0.35
      homeY =
        rectCy
        + dx0 * sinT * 0.35
        + dy0 * cosT * (1 - pull)
    }

    homeX = centerCanvasX + (homeX - centerCanvasX) * speakPulse
    homeY = centerCanvasY + (homeY - centerCanvasY) * speakPulse

    const effSpring = spring * (1 + edgeF[index] * diffuse)

    const noiseX =
      Math.sin(t * 1.65 + pSeed[index] * 3) * 0.45 * (0.35 + edgeF[index])
    const noiseY =
      Math.cos(t * 1.38 + pSeed[index] * 2.1) * 0.45 * (0.35 + edgeF[index])

    let tx = homeX + noiseX
    let ty = homeY + noiseY

    if (rotateStrength > 0) {
      const rdx = px[index] - rectCx
      const rdy = py[index] - rectCy
      const tang = rotateStrength * 0.00012 * (0.2 + edgeF[index])
      vx[index] += -rdy * tang * sinR * dtScale
      vy[index] += rdx * tang * cosR * dtScale
    }

    vx[index] += (tx - px[index]) * effSpring * dtScale
    vy[index] += (ty - py[index]) * effSpring * dtScale
    vy[index] += gravity * (0.25 + edgeF[index] * 1.35) * dtScale

    const dampPow = Math.pow(damp, dtScale)
    vx[index] *= dampPow
    vy[index] *= dampPow

    px[index] += vx[index] * dtScale
    py[index] += vy[index] * dtScale

    const speed = Math.hypot(vx[index], vy[index])
    const speedCap = 5.6 + micDisplay * 15
    if (speed > speedCap) {
      const scaleDown = speedCap / speed
      vx[index] *= scaleDown
      vy[index] *= scaleDown
    }
  }

  const showLines =
    particleCount > 10
    && phaseCurr === 'recording'
    && micDisplay > 0.022

  if (showLines) {
    let lineStride = micDisplay > 0.32 ? 6 : 8
    if (particleCount > 22000) lineStride += 3
    else if (particleCount > 14000) lineStride += 2

    const lineBudget = particleCount > 20000 ? 420 : particleCount > 12000 ? 680 : 920
    const maxNeighborDist = 36 + micDisplay * 62
    const lineW = 0.3 + micDisplay * 3.05
    const lineAlphaBase = 0.04 + micDisplay * 0.34
    ctx.lineCap = 'round'
    let drawnLines = 0
    for (let index = 0; index < particleCount - lineStride; index += lineStride) {
      if (drawnLines >= lineBudget) break
      const j = index + lineStride
      const dx = px[j] - px[index]
      const dy = py[j] - py[index]
      const dist = Math.hypot(dx, dy)
      if (dist > maxNeighborDist || dist < 1.2) continue
      const falloff = 1 - dist / maxNeighborDist
      ctx.strokeStyle = `rgba(118,148,188,${lineAlphaBase * falloff})`
      ctx.lineWidth = lineW * (0.42 + falloff * 0.58)
      ctx.beginPath()
      ctx.moveTo(px[index], py[index])
      ctx.lineTo(px[j], py[j])
      ctx.stroke()
      drawnLines += 1
    }
  }

  const micBright =
    phaseCurr === 'recording' || (phasePrev === 'recording' && phaseBlendWeight < 0.85)
      ? 1 + micDisplay * 0.52
      : 1

  const dotBase =
    phaseCurr === 'recording' && micDisplay > 0.04
      ? 1.18 + micDisplay * 0.42
      : 1.22

  for (let index = 0; index < particleCount; index++) {
    const alphaDraw = clamp(
      pa[index] * (0.64 + edgeF[index] * 0.36) * micBright,
      0.06,
      1
    )
    ctx.fillStyle = `rgba(${pr[index]},${pg[index]},${pb[index]},${alphaDraw})`
    ctx.fillRect(px[index], py[index], dotBase, dotBase)
  }

  rafId = requestAnimationFrame(drawFrame)
}

function startLoop() {
  if (rafId != null) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(drawFrame)
}

function stopLoop() {
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

watch(
  () => props.imageSrc,
  (src) => {
    buildParticlesFromImageUrl(src || '')
    resizeCanvas()
  }
)

watch(
  () => props.phase,
  (nextPhase) => {
    phasePrev = phaseCurr
    phaseCurr = nextPhase
    phaseEase = 0
    lastWallMs = 0
    lastPhysicsMs = 0
    if (nextPhase === 'idle' && typeof performance !== 'undefined') {
      idleEnteredMs = performance.now()
    }
  }
)

onMounted(() => {
  phasePrev = props.phase
  phaseCurr = props.phase
  phaseEase = 1
  idleEnteredMs = performance.now()
  resizeCanvas()
  buildParticlesFromImageUrl(props.imageSrc || '')
  if (typeof ResizeObserver !== 'undefined' && wrapperRef.value) {
    resizeObserver = new ResizeObserver(() => {
      resizeCanvas()
    })
    resizeObserver.observe(wrapperRef.value)
  } else {
    window.addEventListener('resize', resizeCanvas)
  }
  startLoop()
})

onBeforeUnmount(() => {
  stopLoop()
  resizeObserver?.disconnect()
  window.removeEventListener('resize', resizeCanvas)
})
</script>

<template>
  <div ref="wrapperRef" class="sand-mvp-wrap">
    <canvas
      ref="canvasRef"
      class="sand-mvp-canvas"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.sand-mvp-wrap {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
}

.sand-mvp-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
