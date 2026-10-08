import { useState } from 'react'
import { StarGlyph } from '../shell/icons'
import { Tabs } from '../shell/Tabs'
import { DEPLOYED } from './arena'
import './arena.css'
import { FoxEmblem } from './art'
import { HistoryTab } from './HistoryTab'
import { PlayTab } from './PlayTab'

type TabKey = 'play' | 'history'
const TABS = [
  { key: 'play', label: 'Play' },
  { key: 'history', label: 'History' },
] as const satisfies readonly { key: TabKey; label: string }[]

export function ArenaApp() {
  const [tab, setTab] = useState<TabKey>('play')

  const showFairness = () => {
    setTab('history')
    window.setTimeout(() => document.getElementById('fairness')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  return (
    <div className="space-y-10 sm:space-y-14">
      {!DEPLOYED ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-sm text-warning">
          The Arena is not deployed yet. Its address in <code className="font-mono">config/addresses.ts</code> is still
          a placeholder, so arena reads are switched off.
        </div>
      ) : null}

      <Hero />

      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs tabs={TABS} value={tab} onChange={setTab} label="Arena sections" />
          <p className="text-sm text-muted">
            {tab === 'play' ? 'Equip, enter, wait one block, reveal.' : 'Every run, every roll, all on-chain.'}
          </p>
        </div>
        {tab === 'play' ? <PlayTab onShowFairness={showFairness} /> : <HistoryTab />}
      </div>
    </div>
  )
}

const CHIPS = ['Provably fair', 'Player-owned items', 'On-chain settlement'] as const

function Hero() {
  return (
    <section className="grid items-center gap-8 lg:grid-cols-[1.3fr_1fr] lg:gap-10">
      <div className="min-w-0 pt-2">
        <p className="eyebrow inline-flex items-center gap-2">
          <StarGlyph size={12} /> Stellar suite · arena
        </p>
        <h1 className="mt-4 text-5xl font-bold leading-[0.95] sm:text-6xl lg:text-7xl">
          PLAY FOR{' '}
          <span className="arena-glow bg-gradient-to-r from-lime via-accent-2 to-accent bg-clip-text text-transparent">
            KEEPS.
          </span>
        </h1>
        <p className="mt-4 font-display text-lg text-text/90 sm:text-xl">One connected arcade. Everything at stake.</p>
        <p className="mt-4 max-w-xl text-[0.95rem] leading-relaxed text-muted">
          Stake VLAD, bring a Sword or a Shield from the Stellar Store, and face the shadow. Your browser commits to a
          secret before the deciding block exists, so neither you nor the validator can steer the roll. A win pays 1.8×
          from the prize pool and mints a Trophy; the item you bring is burned for good.
        </p>
        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Arena principles">
          {CHIPS.map((chip) => (
            <li key={chip} className="chip font-mono text-[0.7rem] uppercase tracking-[0.16em]">
              <span className="size-1.5 rounded-full bg-lime shadow-[0_0_8px_rgb(163_230_53/0.9)]" aria-hidden />
              {chip}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative mx-auto grid w-full max-w-sm place-items-center py-2">
        <div
          className="arena-halo absolute left-1/2 top-1/2 size-60 -translate-x-1/2 -translate-y-1/2 sm:size-80"
          aria-hidden
        />
        <FoxEmblem size={280} className="arena-float relative h-auto w-40 sm:w-60 lg:w-72" />
        <p className="arena-blink relative mt-3 font-mono text-xs uppercase tracking-[0.35em] text-lime">
          Insert 10 VLAD
        </p>
      </div>
    </section>
  )
}
