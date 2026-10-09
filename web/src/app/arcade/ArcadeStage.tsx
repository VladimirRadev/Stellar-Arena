import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { CombatStage } from '../CombatStage'
import type { FightResult } from '../arena'
import {
  KIND,
  LANES,
  OUTCOME,
  SHIELD,
  TIERS_JACKPOT_BELOW,
  TIERS_REFUND_BELOW,
  TIERS_WIN_BELOW,
  cardLabel,
  isWin,
  type ArcadeResult,
} from './arcade'

/*
 * One short animation per kind, always driven by the on-chain result (roll, houseRoll, outcome):
 * DUEL reuses the Arena's fight canvas; TIERS opens a vault; RACE runs four lanes; HIGHCARD flips two cards;
 * EXTRACT drains a timer and lands a needle on the roll. Reduced-motion users get the final frame at once.
 */

const DUEL_LABELS = ['YOUR ROLL', 'WIN UNDER'] as const
const DURATION_MS = 2_800

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeOut = (p: number) => 1 - Math.pow(1 - clamp01(p), 3)
const easeInOut = (p: number) => {
  const x = clamp01(p)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 0 -> 1 over DURATION_MS once a result exists (1 at once with reduced motion), then calls onDone. */
function useProgress(active: boolean, onDone?: () => void) {
  const reduced = useMemo(() => prefersReducedMotion(), [])
  const [p, setP] = useState(active && reduced ? 1 : 0)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])
  useEffect(() => {
    if (!active) return
    if (reduced) {
      doneRef.current?.()
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const v = Math.min(1, (now - start) / DURATION_MS)
      setP(v)
      if (v < 1) raf = requestAnimationFrame(tick)
      else doneRef.current?.()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, reduced])
  return p
}

export function ArcadeStage({
  kind,
  result,
  lane,
  onFinished,
}: {
  kind: number
  result: ArcadeResult | null
  /** RACE: the lane picked in the form (0..3), shown before a result exists. */
  lane?: number
  onFinished?: () => void
}) {
  const fight = useMemo<FightResult | null>(
    () =>
      result
        ? {
            id: result.runId,
            won: isWin(result.outcome),
            playerRoll: result.roll,
            enemyRoll: result.houseRoll,
            payout: result.payout,
            item: result.item,
            demo: result.demo,
          }
        : null,
    [result],
  )
  const key = result ? `${result.runId}-${result.txHash ?? ''}-${result.roll}-${result.houseRoll}` : 'idle'
  const Stage = kind === KIND.TIERS ? VaultStage : kind === KIND.RACE ? RaceStage : kind === KIND.HIGHCARD ? CardStage : ExtractStage
  return (
    <div data-arcade-stage>
      {kind === KIND.DUEL ? (
        <CombatStage result={fight} onFinished={onFinished} labels={DUEL_LABELS} />
      ) : (
        <Stage key={key} result={result} lane={lane ?? 0} onFinished={onFinished} />
      )}
    </div>
  )
}

type StageProps = { result: ArcadeResult | null; lane: number; onFinished?: () => void }

function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="relative h-56 w-full overflow-hidden rounded-2xl border border-border bg-[radial-gradient(60%_80%_at_50%_100%,rgb(16_185_129/0.2),transparent),linear-gradient(180deg,#050d0a,#0c2018)] sm:h-64"
    >
      {children}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(to_bottom,rgb(0_0_0/0.16)_0_1px,transparent_1px_3px)]"
      />
    </div>
  )
}

const OUTCOME_TEXT: Record<number, string> = {
  [OUTCOME.JACKPOT]: 'JACKPOT',
  [OUTCOME.WIN]: 'WIN',
  [OUTCOME.REFUND]: 'REFUND',
  [OUTCOME.LOSE]: 'EMPTY',
}

// ------------------------------------------------------------------ TIERS: the vault

function VaultStage({ result, onFinished }: StageProps) {
  const glowId = `vault-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const p = useProgress(!!result, onFinished)
  const open = result ? clamp01((p - 0.6) / 0.15) : 0
  const shake = result && p < 0.6 ? Math.sin(p * 90) * 3 * (1 - p) : 0
  const shown = result ? Math.round(easeOut(p / 0.6) * result.roll) : undefined
  const glow =
    result?.outcome === OUTCOME.JACKPOT ? '#fbbf24' : result?.outcome === OUTCOME.WIN ? '#a3e635' : result?.outcome === OUTCOME.REFUND ? '#34d399' : '#f87171'
  const label = result
    ? `Vault roll ${result.roll} of 0 to 999: ${OUTCOME_TEXT[result.outcome]}.`
    : 'A closed vault waiting for a run.'
  const bands = [
    { w: TIERS_JACKPOT_BELOW, color: '#fbbf24', name: 'Jackpot' },
    { w: TIERS_WIN_BELOW - TIERS_JACKPOT_BELOW, color: '#a3e635', name: 'Win' },
    { w: TIERS_REFUND_BELOW - TIERS_WIN_BELOW, color: '#34d399', name: 'Refund' },
    { w: 1000 - TIERS_REFUND_BELOW, color: '#7f1d1d', name: 'Lose' },
  ]
  return (
    <Frame label={label}>
      <div className="absolute inset-x-0 top-2.5 text-center font-mono text-[0.65rem] tracking-[0.3em] text-muted">VAULT ROLL 0–999</div>
      <div className="absolute inset-x-0 top-6 text-center font-mono text-3xl font-bold tabular-nums text-text">
        {shown === undefined ? '???' : String(shown).padStart(3, '0')}
      </div>
      <svg viewBox="0 0 120 90" className="absolute left-1/2 top-[43%] h-[36%]" style={{ transform: `translateX(calc(-50% + ${shake}px))` }}>
        <defs>
          <radialGradient id={glowId} cx="0.5" cy="0.4" r="0.6">
            <stop offset="0" stopColor={glow} stopOpacity={0.9 * open} />
            <stop offset="1" stopColor={glow} stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="60" cy="38" rx="56" ry="34" fill={`url(#${glowId})`} />
        <rect x="22" y="42" width="76" height="40" rx="4" fill="#0e1a14" stroke="#34d399" strokeWidth="2" />
        <path d="M40 42v40M80 42v40" stroke="#34d399" strokeOpacity="0.4" strokeWidth="2" />
        <g style={{ transformOrigin: '22px 42px', transform: `rotate(${-38 * open}deg)` }}>
          <path d="M22 42V32q38-22 76 0v10Z" fill="#132620" stroke="#34d399" strokeWidth="2" strokeLinejoin="round" />
        </g>
        <rect x="55" y="38" width="10" height="12" rx="2" fill={open > 0.5 ? glow : '#a3e635'} />
      </svg>
      <div className="absolute inset-x-4 bottom-4 sm:inset-x-8">
        <div className="relative flex h-2.5 overflow-hidden rounded-full">
          {bands.map((b) => (
            <span key={b.name} style={{ width: `${b.w / 10}%`, background: b.color }} className="h-full opacity-80" />
          ))}
        </div>
        {shown !== undefined ? (
          <span
            className="absolute -top-1.5 h-5 w-0.5 rounded bg-text shadow-[0_0_8px_white]"
            style={{ left: `${(shown / 999) * 100}%` }}
            aria-hidden
          />
        ) : null}
        <div className="mt-1.5 flex justify-between font-mono text-[0.6rem] text-muted">
          <span>JACKPOT 3%</span>
          <span>WIN 30%</span>
          <span>REFUND 30%</span>
          <span>LOSE 37%</span>
        </div>
      </div>
      {result && open > 0.6 ? (
        <div className="absolute inset-x-0 top-[29%] text-center">
          <span
            className="inline-block rounded-lg border px-3 py-0.5 font-display text-base font-bold backdrop-blur"
            style={{ borderColor: glow, color: glow, background: 'rgb(7 17 13 / 0.75)' }}
          >
            {OUTCOME_TEXT[result.outcome]}
            {result.outcome === OUTCOME.LOSE && result.item === SHIELD ? ' · Shield 50%' : ''}
          </span>
        </div>
      ) : null}
    </Frame>
  )
}

// ------------------------------------------------------------------ RACE: four lanes

/** Where the losing runners finish (fraction of the track), fixed per lane so a replay looks the same. */
const LOSER_FINISH = [0.78, 0.86, 0.71, 0.9]

function RaceStage({ result, lane, onFinished }: StageProps) {
  const p = useProgress(!!result, onFinished)
  const mine = result ? result.choice : lane
  const label = result
    ? `Race: lane ${result.roll + 1} wins; you picked lane ${result.choice + 1}.`
    : `Four lanes; you picked lane ${lane + 1}.`
  return (
    <Frame label={label}>
      <div className="absolute inset-0 flex flex-col justify-center gap-2 px-3 py-4 sm:px-5">
        {Array.from({ length: LANES }, (_, i) => {
          const winner = result ? result.roll === i : false
          const target = result ? (winner ? 1 : LOSER_FINISH[i]) : 0
          const wobble = result && p < 1 ? Math.sin(p * 30 + i) * 0.01 : 0
          const x = clamp01(target * easeInOut(p) + wobble)
          const done = result && p >= 1
          return (
            <div
              key={i}
              className={`relative h-9 rounded-xl border sm:h-10 ${
                done && winner
                  ? 'border-lime/70 bg-lime/15 shadow-[0_0_24px_-6px_rgb(163_230_53/0.8)]'
                  : i === mine
                    ? 'border-accent-2/50 bg-accent/10'
                    : 'border-border bg-surface/40'
              }`}
            >
              <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[0.65rem] text-muted">
                {i + 1}
                {i === mine ? <span className="ml-1 text-accent-2">YOU</span> : null}
              </span>
              <span aria-hidden className="absolute bottom-1 right-6 top-1 w-1 bg-[repeating-linear-gradient(to_bottom,#e7f3ec_0_3px,transparent_3px_6px)] opacity-60" />
              <span
                aria-hidden
                className="absolute top-1/2 -translate-y-1/2"
                style={{ left: `calc(3.25rem + ${x} * (100% - 3.25rem - 2.25rem))` }}
              >
                <svg width="22" height="18" viewBox="0 0 22 18">
                  <path d="M2 9h8M1 4h6M1 14h6" stroke={winner && done ? '#a3e635' : '#34d399'} strokeWidth="1.6" strokeOpacity="0.6" />
                  <path d="m10 2 10 7-10 7 3-7Z" fill={winner && done ? '#a3e635' : i === mine ? '#6ee7b7' : '#10b981'} />
                </svg>
              </span>
            </div>
          )
        })}
      </div>
      {result && p >= 1 ? (
        <div className="absolute right-3 top-2 font-mono text-[0.65rem] tracking-widest text-lime">LANE {result.roll + 1} WINS</div>
      ) : null}
    </Frame>
  )
}

// ------------------------------------------------------------------ HIGHCARD: two cards

function PlayingCard({ card, flip, glow, caption }: { card: number | undefined; flip: number; glow: boolean; caption: string }) {
  // flip 0 = face down, 1 = face up. Squash on the x axis to fake a 3D turn.
  const faceUp = flip >= 0.5 && card !== undefined
  const scale = Math.abs(Math.cos(flip * Math.PI))
  const c = card !== undefined ? cardLabel(card) : undefined
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="font-mono text-[0.65rem] tracking-[0.25em] text-muted">{caption}</span>
      <div
        className={`grid h-28 w-20 place-items-center rounded-xl border-2 sm:h-36 sm:w-24 ${
          faceUp ? 'border-text/80 bg-[#f4fbf7]' : 'border-accent-2/60 bg-[repeating-linear-gradient(45deg,#0e1a14_0_6px,#132620_6px_12px)]'
        } ${glow ? 'shadow-[0_0_30px_-4px_rgb(163_230_53/0.9)]' : ''}`}
        style={{ transform: `scaleX(${Math.max(0.04, scale)})` }}
      >
        {faceUp && c ? (
          <span className={`text-center font-display font-bold leading-none ${c.red ? 'text-red-600' : 'text-[#07110d]'}`}>
            <span className="block text-3xl sm:text-4xl">{c.rank}</span>
            <span className="block text-2xl">{c.suit}</span>
          </span>
        ) : (
          <span className="font-display text-2xl text-accent-2/70">✦</span>
        )}
      </div>
    </div>
  )
}

function CardStage({ result, onFinished }: StageProps) {
  const p = useProgress(!!result, onFinished)
  const mineFlip = result ? clamp01((p - 0.2) / 0.25) : 0
  const houseFlip = result ? clamp01((p - 0.5) / 0.25) : 0
  const done = !!result && p >= 0.8
  const label = result
    ? `High card: your ${cardLabel(result.roll).rank} against the house ${cardLabel(result.houseRoll).rank}.`
    : 'Two cards face down.'
  return (
    <Frame label={label}>
      <div className="absolute inset-0 flex items-center justify-center gap-6 sm:gap-12">
        <PlayingCard card={result?.roll} flip={mineFlip} glow={done && result.outcome === OUTCOME.WIN} caption="YOU" />
        <span className="font-display text-sm font-bold text-muted">VS</span>
        <PlayingCard card={result?.houseRoll} flip={houseFlip} glow={done && result.outcome === OUTCOME.LOSE} caption="HOUSE" />
      </div>
      {done ? (
        <div className="absolute inset-x-0 bottom-3 text-center font-mono text-[0.7rem] tracking-widest text-lime">
          {result.outcome === OUTCOME.WIN ? 'HIGHER CARD WINS' : result.outcome === OUTCOME.REFUND ? 'SAME RANK · REFUND' : 'HOUSE CARD IS HIGHER'}
        </div>
      ) : null}
    </Frame>
  )
}

// ------------------------------------------------------------------ EXTRACT: timer, then the needle

function ExtractStage({ result, onFinished }: StageProps) {
  const p = useProgress(!!result, onFinished)
  const threshold = result?.houseRoll ?? 35
  const timer = result ? 1 - clamp01(p / 0.8) : 1
  const needle = result ? 99 - easeOut(p / 0.8) * (99 - result.roll) : undefined
  const done = !!result && p >= 0.85
  const success = !!result && result.outcome === OUTCOME.WIN
  const label = result
    ? `Extraction roll ${result.roll}, needed below ${result.houseRoll}: ${success ? 'extracted' : 'signal lost'}.`
    : 'Extraction beacon waiting for a run.'
  return (
    <Frame label={label}>
      <div className="absolute inset-x-4 top-4 sm:inset-x-8">
        <div className="flex justify-between font-mono text-[0.65rem] tracking-[0.25em] text-muted">
          <span>EXTRACTION WINDOW</span>
          <span>{result ? `${Math.ceil(timer * 10)}s` : '10s'}</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-gradient-to-r from-warning to-danger" style={{ width: `${timer * 100}%` }} />
        </div>
      </div>
      <svg viewBox="0 0 60 60" className="absolute left-1/2 top-[24%] h-[30%] -translate-x-1/2" aria-hidden>
        <path
          d="M18 20a17 17 0 0 1 24 0M12 14a25 25 0 0 1 36 0"
          fill="none"
          stroke={done ? (success ? '#a3e635' : '#f87171') : '#34d399'}
          strokeWidth="3"
          strokeLinecap="round"
          opacity={done ? 1 : 0.5 + 0.5 * Math.abs(Math.sin(p * 20))}
        />
        <circle cx="30" cy="26" r="4.5" fill={done ? (success ? '#a3e635' : '#f87171') : '#34d399'} />
        <path d="M30 30v18M20 54h20L30 43Z" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
      <div className="absolute inset-x-4 bottom-5 sm:inset-x-8">
        <div className="relative flex h-3 overflow-hidden rounded-full">
          <span className="h-full bg-accent/80" style={{ width: `${threshold}%` }} />
          <span className="h-full flex-1 bg-danger/40" />
        </div>
        {needle !== undefined ? (
          <span className="absolute -top-2 h-7 w-0.5 rounded bg-text shadow-[0_0_8px_white]" style={{ left: `${needle}%` }} aria-hidden />
        ) : null}
        <div className="mt-1.5 flex justify-between font-mono text-[0.6rem] text-muted">
          <span>0 · SAFE BELOW {threshold}</span>
          <span>{needle !== undefined ? `ROLL ${Math.round(needle)}` : 'ROLL ??'}</span>
          <span>99</span>
        </div>
      </div>
      {done ? (
        <div className="absolute inset-x-0 top-[55%] text-center">
          <span className={`font-display text-xl font-bold ${success ? 'text-lime' : 'text-danger'}`}>
            {success ? 'EXTRACTED' : result.item === SHIELD ? 'SIGNAL LOST · Shield 50%' : 'SIGNAL LOST'}
          </span>
        </div>
      ) : null}
    </Frame>
  )
}
