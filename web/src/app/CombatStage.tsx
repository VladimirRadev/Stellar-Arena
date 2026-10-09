import { useEffect, useRef } from 'react'
import { SHIELD, SWORD, type FightResult } from './arena'

/*
 * The arena stage: a canvas that shows the fox guardian (left) against the shadow enemy (right).
 * Without a result both fighters idle. With a result it plays a ~3 s fight whose roll counters
 * count up to the on-chain playerRoll / enemyRoll, then throws confetti on a win.
 * Users who prefer reduced motion get the final frame immediately, with no particles.
 */

const FIGHT_MS = 3_000
const CONFETTI_MS = 2_400

type Pt = readonly [number, number]
type Poly = { pts: readonly Pt[]; fill: string; stroke?: string }

// Fox guardian, facing right. Units: feet at (0, 0), about 90 units tall.
const FOX: readonly Poly[] = [
  { pts: [[-20, -34], [-52, -70], [-44, -42], [-60, -36], [-26, -18]], fill: '#059669' },
  { pts: [[-52, -70], [-46, -52], [-58, -57]], fill: '#a3e635' },
  { pts: [[-18, -20], [-10, -20], [-12, 0], [-21, 0]], fill: '#047857' },
  { pts: [[8, -20], [16, -20], [17, 0], [8, 0]], fill: '#047857' },
  { pts: [[-24, -22], [-16, -52], [14, -56], [24, -26], [14, -14], [-18, -14]], fill: '#10b981' },
  { pts: [[14, -56], [24, -26], [8, -34]], fill: '#34d399' },
  { pts: [[4, -58], [8, -86], [18, -70], [26, -90], [32, -68], [48, -60], [30, -50], [10, -48]], fill: '#34d399' },
  { pts: [[10, -48], [4, -58], [18, -70], [30, -50]], fill: '#10b981' },
  { pts: [[9, -80], [12, -72], [8, -70]], fill: '#a3e635' },
  { pts: [[32, -68], [48, -60], [30, -54]], fill: '#a3e635' },
  { pts: [[27, -66], [35, -64], [27, -62]], fill: '#ecfccb' },
  { pts: [[-18, -38], [20, -43], [21, -39], [-17, -34]], fill: '#a3e635' },
]

// Shadow enemy, facing left: a hooded wraith with a red rim and red eyes.
const SHADOW: readonly Poly[] = [
  { pts: [[-26, -40], [-48, -30], [-40, -26], [-28, -30]], fill: '#0d0a14', stroke: 'rgba(248,113,113,0.6)' },
  {
    pts: [[-30, 0], [-28, -40], [-22, -66], [-8, -94], [6, -88], [20, -66], [28, -40], [30, 0], [20, -9], [10, 0], [0, -9], [-10, 0], [-20, -9]],
    fill: '#0d0a14',
    stroke: 'rgba(248,113,113,0.7)',
  },
  { pts: [[-18, -64], [-8, -84], [10, -78], [14, -60], [0, -52]], fill: '#000000' },
  { pts: [[-14, -67], [-5, -65], [-14, -62]], fill: '#f87171' },
  { pts: [[0, -68], [8, -66], [0, -63]], fill: '#f87171' },
]

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  color: string
  size: number
  angle: number
  spin: number
  gravity: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeOut = (p: number) => 1 - Math.pow(1 - clamp01(p), 3)
/** 0 -> 1 -> 0 over [start, start + dur]. */
const pulse = (t: number, start: number, dur: number) =>
  t < start || t > start + dur ? 0 : Math.sin((Math.PI * (t - start)) / dur)
/** 1 -> 0 over [start, start + dur]. */
const decay = (t: number, start: number, dur: number) => (t < start || t > start + dur ? 0 : 1 - (t - start) / dur)

const CONFETTI_COLORS = ['#a3e635', '#34d399', '#10b981', '#ecfccb', '#fbbf24']
const DEFAULT_LABELS = ['YOU', 'SHADOW'] as const

export function CombatStage({
  result,
  onFinished,
  labels = DEFAULT_LABELS,
}: {
  result: FightResult | null
  onFinished?: () => void
  /** Captions above the two counters (the Arcade's DUEL shows its roll and the win threshold). */
  labels?: readonly [string, string]
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const finishedRef = useRef(onFinished)
  useEffect(() => {
    finishedRef.current = onFinished
  }, [onFinished])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!wrap || !canvas || !ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const particles: Particle[] = []
    const spawned = new Set<number>()
    const start = performance.now()
    let last = start
    let width = 0
    let height = 0
    let raf = 0
    let running = false
    let finished = false
    let disposed = false

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      width = wrap.clientWidth
      height = wrap.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const render = (now: number) => {
      running = false
      if (disposed) return
      const t = reduced ? (result ? FIGHT_MS : 0) : now - start
      const dt = Math.min(50, now - last)
      last = now
      const scene = drawScene(ctx, width, height, t, result, labels)

      if (result && !reduced) {
        for (const hit of scene.hits) {
          if (t >= hit.at && !spawned.has(hit.at)) {
            spawned.add(hit.at)
            spawnSparks(particles, hit.x, hit.y, hit.color)
          }
        }
      }
      if (result && !finished && t >= FIGHT_MS) {
        finished = true
        if (result.won && !reduced) spawnConfetti(particles, width, height)
        finishedRef.current?.()
      }
      stepParticles(ctx, particles, dt)
      drawOverlay(ctx, width, height)

      const animate = !reduced && (!result || t < FIGHT_MS + CONFETTI_MS || particles.length > 0)
      if (animate) {
        running = true
        raf = requestAnimationFrame(render)
      }
    }

    resize()
    const observer = new ResizeObserver(() => {
      resize()
      if (!running) render(performance.now())
    })
    observer.observe(wrap)
    // Redraw a static frame once the web fonts arrive (the roll counters use JetBrains Mono).
    void document.fonts?.ready.then(() => {
      if (!running) render(performance.now())
    })
    running = true
    raf = requestAnimationFrame(render)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [result, labels])

  const label = result
    ? `Fight result: your roll ${result.playerRoll} against the shadow's ${result.enemyRoll}. You ${result.won ? 'won' : 'lost'}.`
    : 'Arena stage: the fox guardian faces the shadow enemy, waiting for a run.'

  return (
    <div ref={wrapRef} className="relative h-52 w-full overflow-hidden rounded-2xl border border-border sm:h-64">
      <canvas ref={canvasRef} className="absolute inset-0 size-full" role="img" aria-label={label} />
    </div>
  )
}

type Hit = { at: number; x: number; y: number; color: string }

function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  result: FightResult | null,
  labels: readonly [string, string],
) {
  ctx.clearRect(0, 0, w, h)
  const ground = h * 0.8

  // Backdrop: dark gradient, emerald glow on the horizon, perspective floor grid.
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#050d0a')
  bg.addColorStop(1, '#0c2018')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  const glow = ctx.createRadialGradient(w / 2, ground, 0, w / 2, ground, w * 0.6)
  glow.addColorStop(0, 'rgba(16,185,129,0.22)')
  glow.addColorStop(1, 'rgba(16,185,129,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = 'rgba(52,211,153,0.13)'
  ctx.lineWidth = 1
  for (let i = 1; i <= 5; i++) {
    const y = ground + (h - ground) * Math.pow(i / 5, 1.6)
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  for (let i = -10; i <= 10; i++) {
    ctx.beginPath()
    ctx.moveTo(w / 2 + i * w * 0.035, ground)
    ctx.lineTo(w / 2 + i * w * 0.2, h)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(163,230,53,0.45)'
  ctx.beginPath()
  ctx.moveTo(0, ground)
  ctx.lineTo(w, ground)
  ctx.stroke()

  // Embers rising (deterministic, no state).
  for (let i = 0; i < 22; i++) {
    const x = ((i * 73.7) % 100) / 100 * w
    const y = ground - (((t / 28 + i * 41) % (ground + 20)) - 10)
    ctx.fillStyle = i % 3 === 0 ? 'rgba(163,230,53,0.35)' : 'rgba(52,211,153,0.25)'
    ctx.fillRect(x, y, 2, 2)
  }

  // Fighter positions and effects.
  const scale = Math.max(0.55, Math.min(h * 0.0044, w * 0.0027))
  const approach = result ? easeOut(t / 450) : 1
  let foxX = w * (0.2 + 0.07 * approach)
  let enemyX = w * (0.8 - 0.07 * approach)
  const bob = Math.sin(t / 380) * 2.5
  let foxFlash = 0
  let enemyFlash = 0
  let foxAlpha = 1
  let enemyAlpha = 1
  let foxTilt = 0
  let enemyTilt = 0
  const hits: Hit[] = []
  const chest = ground - 52 * scale

  if (result) {
    const foxWins = result.won
    foxX += pulse(t, 800, 320) * w * 0.13
    enemyX -= pulse(t, 1400, 320) * w * 0.13
    if (foxWins) foxX += pulse(t, 2000, 420) * w * 0.16
    else enemyX -= pulse(t, 2000, 420) * w * 0.16
    const knock = easeOut((t - 2200) / 500)
    if (foxWins) {
      enemyX += knock * w * 0.05
      enemyAlpha = 1 - 0.6 * knock
      enemyTilt = 0.28 * knock
    } else {
      foxX -= knock * w * 0.05
      foxAlpha = 1 - 0.6 * knock
      foxTilt = -0.28 * knock
    }
    enemyFlash = decay(t, 960, 260) + (foxWins ? decay(t, 2210, 340) : 0)
    foxFlash = decay(t, 1560, 260) + (foxWins ? 0 : decay(t, 2210, 340))
    hits.push({ at: 960, x: w * 0.66, y: chest, color: '#a3e635' })
    hits.push({ at: 1560, x: w * 0.34, y: chest, color: '#f87171' })
    hits.push(
      foxWins
        ? { at: 2210, x: w * 0.68, y: chest, color: '#ecfccb' }
        : { at: 2210, x: w * 0.32, y: chest, color: '#fca5a5' },
    )
  }

  for (const [x, a] of [
    [foxX, foxAlpha],
    [enemyX, enemyAlpha],
  ] as const) {
    ctx.fillStyle = `rgba(0,0,0,${0.45 * a})`
    ctx.beginPath()
    ctx.ellipse(x, ground + 2, 34 * scale, 6 * scale, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  drawFighter(ctx, FOX, foxX, ground + (result ? 0 : bob), scale, {
    flash: foxFlash,
    alpha: foxAlpha,
    tilt: foxTilt,
    glow: 'rgba(52,211,153,0.55)',
  })
  if (result?.item === SWORD) drawSword(ctx, foxX, ground, scale, foxAlpha)
  if (result?.item === SHIELD) drawShield(ctx, foxX, ground, scale, foxAlpha)
  drawFighter(ctx, SHADOW, enemyX, ground - (result ? 0 : bob), scale, {
    flash: enemyFlash,
    alpha: enemyAlpha,
    tilt: enemyTilt,
    glow: 'rgba(248,113,113,0.5)',
  })

  // Roll counters above the fighters.
  const top = ground - 96 * scale - 10
  const size = Math.round(Math.max(20, Math.min(34, h * 0.13)))
  const count = (final: number) =>
    final <= 1 ? final : t < 300 ? 1 : Math.max(1, Math.round(easeOut((t - 300) / 2000) * final))
  const settled = result !== null && t >= 2300
  drawRoll(ctx, w * 0.27, top, size, labels[0], result ? String(count(result.playerRoll)) : '??', '#a3e635', settled && result.won)
  drawRoll(ctx, w * 0.73, top, size, labels[1], result ? String(count(result.enemyRoll)) : '??', '#fca5a5', settled && !result.won)

  if (!result || t < 700) {
    ctx.save()
    ctx.globalAlpha = result ? 1 - clamp01(t / 700) : 0.65 + 0.35 * Math.sin(t / 500)
    ctx.font = `700 ${Math.round(size * 0.8)}px "Space Grotesk", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ecfccb'
    ctx.shadowColor = 'rgba(163,230,53,0.8)'
    ctx.shadowBlur = 14
    ctx.fillText('VS', w / 2, ground - 40 * scale)
    ctx.restore()
  }

  return { hits }
}

function tracePoly(ctx: CanvasRenderingContext2D, pts: readonly Pt[]) {
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
}

function drawFighter(
  ctx: CanvasRenderingContext2D,
  polys: readonly Poly[],
  x: number,
  y: number,
  scale: number,
  o: { flash: number; alpha: number; tilt: number; glow: string },
) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(o.tilt)
  ctx.scale(scale, scale)
  ctx.globalAlpha = o.alpha
  ctx.shadowColor = o.glow
  ctx.shadowBlur = 14
  for (const p of polys) {
    tracePoly(ctx, p.pts)
    ctx.fillStyle = p.fill
    ctx.fill()
    if (p.stroke) {
      ctx.strokeStyle = p.stroke
      ctx.lineWidth = 1.6
      ctx.stroke()
    }
  }
  ctx.shadowBlur = 0
  if (o.flash > 0) {
    ctx.globalAlpha = o.alpha * Math.min(1, o.flash)
    ctx.fillStyle = '#ffffff'
    for (const p of polys) {
      tracePoly(ctx, p.pts)
      ctx.fill()
    }
  }
  ctx.restore()
}

function drawSword(ctx: CanvasRenderingContext2D, x: number, ground: number, s: number, alpha: number) {
  ctx.save()
  ctx.translate(x, ground)
  ctx.scale(s, s)
  ctx.globalAlpha = alpha
  ctx.strokeStyle = '#ecfccb'
  ctx.shadowColor = 'rgba(163,230,53,0.9)'
  ctx.shadowBlur = 12
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(18, -30)
  ctx.lineTo(56, -62)
  ctx.stroke()
  ctx.strokeStyle = '#a3e635'
  ctx.beginPath()
  ctx.moveTo(14, -38)
  ctx.lineTo(24, -26)
  ctx.stroke()
  ctx.restore()
}

function drawShield(ctx: CanvasRenderingContext2D, x: number, ground: number, s: number, alpha: number) {
  ctx.save()
  ctx.translate(x + 30 * s, ground - 34 * s)
  ctx.scale(s, s)
  ctx.globalAlpha = alpha
  ctx.fillStyle = 'rgba(16,185,129,0.35)'
  ctx.strokeStyle = '#a3e635'
  ctx.lineWidth = 2.2
  ctx.shadowColor = 'rgba(163,230,53,0.8)'
  ctx.shadowBlur = 10
  tracePoly(ctx, [[0, -16], [14, -8], [14, 8], [0, 16], [-14, 8], [-14, -8]])
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawRoll(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  label: string,
  value: string,
  color: string,
  winner: boolean,
) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.font = `600 ${Math.max(9, Math.round(size * 0.36))}px "JetBrains Mono", ui-monospace, monospace`
  ctx.fillStyle = 'rgba(231,243,236,0.6)'
  ctx.fillText(label, x, y - size - 4)
  ctx.font = `700 ${size}px "JetBrains Mono", ui-monospace, monospace`
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = winner ? 22 : 6
  ctx.fillText(value, x, y)
  ctx.restore()
}

function spawnSparks(particles: Particle[], x: number, y: number, color: string) {
  for (let i = 0; i < 18; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 0.08 + Math.random() * 0.28
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.05,
      age: 0,
      life: 380 + Math.random() * 220,
      color,
      size: 2 + Math.random() * 2.5,
      angle: 0,
      spin: 0,
      gravity: 0.0006,
    })
  }
}

function spawnConfetti(particles: Particle[], w: number, h: number) {
  const count = Math.round(Math.min(160, Math.max(70, w / 5)))
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * w,
      y: -10 - Math.random() * h * 0.5,
      vx: (Math.random() - 0.5) * 0.08,
      vy: 0.04 + Math.random() * 0.12,
      age: 0,
      life: CONFETTI_MS - Math.random() * 500,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 3 + Math.random() * 3.5,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.02,
      gravity: 0.00012,
    })
  }
}

function stepParticles(ctx: CanvasRenderingContext2D, particles: Particle[], dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.age += dt
    if (p.age >= p.life) {
      particles.splice(i, 1)
      continue
    }
    p.vy += p.gravity * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.angle += p.spin * dt
    ctx.save()
    ctx.globalAlpha = 1 - Math.pow(p.age / p.life, 2)
    ctx.translate(p.x, p.y)
    ctx.rotate(p.angle)
    ctx.fillStyle = p.color
    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 + (p.spin ? 0 : p.size / 2))
    ctx.restore()
  }
}

/** CRT-style scanlines and a soft vignette: the arcade finish. */
function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, w, h)
}
