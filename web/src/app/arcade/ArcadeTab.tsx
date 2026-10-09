import { useCallback, useMemo, useState } from 'react'
import { useConnection, useReadContract, useReadContracts } from 'wagmi'
import { formatToken } from '../../shell/format'
import { StatTile } from '../../shell/StatTile'
import {
  ARCADE_DEPLOYED,
  CABINETS,
  GENRES,
  GENRE_COLOR,
  arcadeContract,
  defaultRules,
  runsAndWins,
  type ArcadeResult,
  type GameRules,
  type GenreName,
} from './arcade'
import { ArcadeHistory, ArcadeVerify } from './ArcadeHistory'
import { ArcadeOpenRuns, type ActiveArcadeRun } from './ArcadeRuns'
import { useArcadePendingRecovery } from './hooks'
import { CabinetIcon } from './CabinetIcon'
import { CabinetPage, KindBadge } from './CabinetPage'

const PAGE_SIZE = 12
type Filter = 'ALL' | GenreName

/** The Arcade tab: 29 cabinets on one StellarArcade contract, each with its own page, plus history and a verifier. */
export function ArcadeTab() {
  const { address } = useConnection()
  useArcadePendingRecovery(address)

  const globals = useReadContracts({
    contracts: [
      { ...arcadeContract, functionName: 'prizePool' },
      { ...arcadeContract, functionName: 'nextRunId' },
      { ...arcadeContract, functionName: 'gameCount' },
    ],
    query: { enabled: ARCADE_DEPLOYED, refetchInterval: 15_000 },
  })
  const games = useReadContracts({
    contracts: CABINETS.map((cab) => ({ ...arcadeContract, functionName: 'getGame', args: [BigInt(cab.id)] }) as const),
    query: { enabled: ARCADE_DEPLOYED },
  })
  const gameStats = useReadContracts({
    contracts: CABINETS.map((cab) => ({ ...arcadeContract, functionName: 'gameStats', args: [BigInt(cab.id)] }) as const),
    query: { enabled: ARCADE_DEPLOYED, refetchInterval: 20_000 },
  })
  const mine = useReadContract({
    ...arcadeContract,
    functionName: 'stats',
    args: address ? [address] : undefined,
    query: { enabled: ARCADE_DEPLOYED && !!address },
  })

  const rulesOf = useCallback(
    (id: number): GameRules => (games.data?.[id]?.result as GameRules | undefined) ?? defaultRules(CABINETS[id]),
    [games.data],
  )
  const statsOf = useCallback(
    (id: number) => {
      const s = gameStats.data?.[id]?.result as readonly [bigint, bigint, bigint, bigint] | undefined
      return s ? { runs: s[0], wins: s[1] } : undefined
    },
    [gameStats.data],
  )

  const [selected, setSelected] = useState<number | null>(null)
  const [active, setActive] = useState<ActiveArcadeRun | null>(null)
  const [result, setResult] = useState<ArcadeResult | null>(null)

  const openCabinet = (id: number) => {
    setSelected(id)
    window.setTimeout(() => document.getElementById('arcade-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }
  const onResolvedFromList = (r: ArcadeResult) => {
    if (active && active.id === r.runId) setActive(null)
    setResult(r)
    openCabinet(r.gameId)
  }

  const loading = ARCADE_DEPLOYED && globals.isLoading
  const myRuns = mine.data?.[0]
  const myWins = mine.data?.[1]

  return (
    <div id="arcade-top" className="scroll-mt-28 space-y-6 sm:space-y-8">
      {!ARCADE_DEPLOYED ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-sm text-warning">
          The Arcade is not deployed yet. Its address in <code className="font-mono">config/addresses.ts</code> is a
          placeholder, so arcade reads are switched off. Browse the cabinets, read the odds and watch demo rounds.
        </div>
      ) : null}

      <section className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Stellar arcade</p>
            <h2 className="mt-1.5 text-3xl font-bold sm:text-4xl">
              29 cabinets.{' '}
              <span className="bg-gradient-to-r from-lime via-accent-2 to-accent bg-clip-text text-transparent">One prize pool.</span>
            </h2>
          </div>
          <p className="max-w-md text-sm text-muted">
            Every cabinet runs the Arena&apos;s commit-reveal flow: commit, enter, wait two blocks, reveal. Five kinds of
            rules, all settled on-chain.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatTile label="Prize pool" value={formatToken(globals.data?.[0]?.result, 18, 0)} unit="VLAD" loading={loading} hint="shared by all cabinets" highlight />
          <StatTile label="Cabinets" value={globals.data?.[2]?.result?.toString() ?? '29'} loading={loading} hint="5 kinds · 6 genres" />
          <StatTile label="Arcade runs" value={globals.data?.[1]?.result?.toString() ?? '—'} loading={loading} hint="all cabinets" />
          <StatTile
            label="Your record"
            value={address && myRuns !== undefined ? `${myWins?.toString() ?? 0} / ${myRuns.toString()}` : '—'}
            loading={ARCADE_DEPLOYED && !!address && mine.isLoading}
            hint={address ? 'wins / runs' : 'connect a wallet'}
          />
        </div>
      </section>

      {selected !== null ? (
        <CabinetPage
          key={selected}
          cabinet={CABINETS[selected]}
          rules={rulesOf(selected)}
          cabinetStats={statsOf(selected)}
          active={active}
          setActive={setActive}
          result={result}
          setResult={setResult}
          onBack={() => {
            setSelected(null)
            setResult(null)
          }}
        />
      ) : (
        <>
          <ArcadeOpenRuns onResolved={onResolvedFromList} excludeId={undefined} title="Your open arcade runs" />
          <CabinetGrid rulesOf={rulesOf} statsOf={statsOf} onOpen={openCabinet} />
          <section className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
            <ArcadeHistory />
            <ArcadeVerify rulesOf={rulesOf} />
          </section>
        </>
      )}
    </div>
  )
}

function CabinetGrid({
  rulesOf,
  statsOf,
  onOpen,
}: {
  rulesOf: (id: number) => GameRules
  statsOf: (id: number) => { runs: bigint; wins: bigint } | undefined
  onOpen: (id: number) => void
}) {
  const [filter, setFilter] = useState<Filter>('ALL')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CABINETS.filter(
      (cab) =>
        (filter === 'ALL' || cab.genre === filter) &&
        (!q || cab.name.toLowerCase().includes(q) || cab.inspiredBy.title.toLowerCase().includes(q) || cab.kind.toLowerCase().includes(q)),
    )
  }, [filter, query])
  const shown = matches.slice(0, limit)

  return (
    <section aria-labelledby="cabinets-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">In the arcade</p>
          <h3 id="cabinets-title" className="mt-1.5 text-2xl font-semibold">
            Pick a cabinet
          </h3>
        </div>
        <p className="font-mono text-xs text-muted" aria-live="polite">
          Showing {shown.length} of {matches.length === CABINETS.length ? CABINETS.length : `${matches.length} (${CABINETS.length} total)`}
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by genre">
          {(['ALL', ...GENRES] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={filter === g}
              className={`h-8 shrink-0 rounded-full border px-3 font-mono text-[0.7rem] tracking-[0.14em] transition ${
                filter === g ? 'border-accent-2/60 bg-accent/15 text-text' : 'border-border bg-surface/50 text-muted hover:text-text'
              }`}
              onClick={() => {
                setFilter(g)
                setLimit(PAGE_SIZE)
              }}
            >
              {g !== 'ALL' ? <span className="mr-1.5 inline-block size-1.5 rounded-full align-middle" style={{ background: GENRE_COLOR[g] }} /> : null}
              {g}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="h-9 w-full rounded-xl border border-border bg-bg/70 px-3 text-sm outline-none placeholder:text-muted focus:border-accent-2/60 md:w-64"
          placeholder="Search cabinets or games…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(PAGE_SIZE)
          }}
          aria-label="Search cabinets"
        />
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/30 px-4 py-10 text-center text-sm text-muted">
          {filter === 'RACING' && !query ? 'No RACING cabinets yet: the genre is reserved for later.' : 'No cabinet matches this search.'}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {shown.map((cab) => {
            const rules = rulesOf(cab.id)
            const stats = statsOf(cab.id)
            const color = GENRE_COLOR[cab.genre]
            return (
              <li key={cab.id} className="card group flex min-w-0 flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:border-accent-2/40">
                <div className="flex items-start gap-3">
                  <span
                    className="grid size-12 shrink-0 place-items-center rounded-2xl border bg-bg/60 transition group-hover:shadow-[0_0_26px_-8px_var(--glow)] sm:size-14"
                    style={{ borderColor: `${color}55`, ['--glow' as string]: color }}
                  >
                    <CabinetIcon kind={rules.kind} color={color} size={40} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="min-w-0 font-display text-lg font-semibold leading-tight">
                        <button
                          type="button"
                          className="text-left after:absolute after:inset-0 after:rounded-[1.25rem] after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-accent-2"
                          onClick={() => onOpen(cab.id)}
                        >
                          {cab.name}
                        </button>
                      </h4>
                      <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border bg-bg/50 px-2 font-mono text-[0.6rem] tracking-wider text-muted">
                        <span className="size-1.5 rounded-full" style={{ background: color }} />
                        {cab.genre}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      inspired by{' '}
                      <a className="link relative z-10" href={cab.inspiredBy.url} target="_blank" rel="noreferrer">
                        {cab.inspiredBy.title}
                      </a>
                    </p>
                  </div>
                </div>
                <KindBadge kind={cab.kind} />
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-3 font-mono text-xs">
                  <span className="text-text">{formatToken(rules.entryFee)} VLAD</span>
                  <span className="text-muted">
                    {stats ? runsAndWins(stats.runs, stats.wins) : ARCADE_DEPLOYED ? '…' : 'not live yet'}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {matches.length > shown.length ? (
        <div className="flex justify-center">
          <button type="button" className="btn btn-ghost" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            Load more ({matches.length - shown.length} left)
          </button>
        </div>
      ) : null}
    </section>
  )
}
