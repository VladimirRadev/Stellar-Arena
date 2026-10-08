import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { decodeFunctionData, type Hex } from 'viem'
import { useBlockNumber, useConnection, usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { stellarArenaAbi } from '../abi'
import { CHAIN_ID, addresses } from '../config/addresses'
import { describeError } from '../shell/errors'
import { explorerAddressUrl, formatToken, truncateAddress } from '../shell/format'
import { CheckIcon, ExternalIcon, Spinner } from '../shell/icons'
import { EXPLORER_URL } from '../shell/wagmi'
import {
  ARENA_ERRORS,
  DEPLOYED,
  ITEM_NAMES,
  NO_ITEM,
  SHIELD,
  SWORD,
  arenaContract,
  computeRolls,
  isBytes32,
  lastResolveBlock,
  nominalPayout,
  runStatus,
  type Run,
  type RunStatus,
} from './arena'

const HISTORY_SIZE = 50n
/** Largest block span we ask the public RPC for in one eth_getLogs call. */
const MAX_LOG_SPAN = 45_000n

type Row = { id: bigint; run: Run }

export function HistoryTab() {
  const next = useReadContract({
    ...arenaContract,
    functionName: 'nextRunId',
    query: { enabled: DEPLOYED, refetchInterval: 15_000 },
  })
  const ids = useMemo(() => {
    const out: bigint[] = []
    const n = next.data ?? 0n
    for (let id = n - 1n; id >= 0n && id >= n - HISTORY_SIZE; id--) out.push(id)
    return out
  }, [next.data])
  const runsQ = useReadContracts({
    contracts: ids.map((id) => ({ ...arenaContract, functionName: 'getRun', args: [id] }) as const),
    query: { enabled: DEPLOYED && ids.length > 0 },
  })
  const block = useBlockNumber({ chainId: CHAIN_ID, query: { enabled: DEPLOYED, refetchInterval: 12_000 } })
  const rows = useMemo(
    () =>
      ids
        .map((id, i) => ({ id, run: runsQ.data?.[i]?.result as Run | undefined }))
        .filter((r): r is Row => !!r.run),
    [ids, runsQ.data],
  )
  const payouts = useExactPayouts(rows, block.data)
  const loading = DEPLOYED && (next.isLoading || runsQ.isLoading)

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="grid items-start gap-6 lg:grid-cols-[1.65fr_1fr]">
        <RecentRuns rows={rows} current={block.data} payouts={payouts} loading={loading} total={next.data} />
        <Leaderboard rows={rows} payouts={payouts} />
      </section>
      <section id="fairness" className="grid scroll-mt-28 items-start gap-6 lg:grid-cols-[1.2fr_1fr]">
        <FairnessCard />
        <VerifyRun />
      </section>
    </div>
  )
}

/**
 * Exact payouts from the Resolved events. Every run in the window resolves between its enterBlock + 2 and
 * enterBlock + 251, so one eth_getLogs call over [oldest enterBlock, newest enterBlock + 252] covers them.
 * Falls back to the payout computed from the run (before the prize-pool cap) if the span is too large.
 */
function useExactPayouts(rows: Row[], latest: bigint | undefined) {
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const resolved = rows.filter((r) => r.run.resolved)
  let from: bigint | undefined
  let to: bigint | undefined
  for (const { run } of resolved) {
    if (from === undefined || run.enterBlock < from) from = run.enterBlock
    const end = lastResolveBlock(run.enterBlock) + 1n
    if (to === undefined || end > to) to = end
  }
  if (to !== undefined && latest !== undefined && to > latest) to = latest
  const spanOk = from !== undefined && to !== undefined && to >= from && to - from <= MAX_LOG_SPAN
  const query = useQuery({
    queryKey: ['arena-resolved', addresses.arena, from?.toString(), to?.toString()],
    enabled: DEPLOYED && !!publicClient && spanOk,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      const logs = await publicClient!.getContractEvents({
        address: addresses.arena,
        abi: stellarArenaAbi,
        eventName: 'Resolved',
        fromBlock: from,
        toBlock: to,
      })
      const map: Record<string, string> = {}
      for (const log of logs) {
        if (log.args.id !== undefined && log.args.payout !== undefined) map[log.args.id.toString()] = log.args.payout.toString()
      }
      return map
    },
  })
  return query.data
}

const STATUS_STYLE: Record<RunStatus, { label: string; className: string }> = {
  won: { label: 'Won', className: 'border-lime/40 bg-lime/10 text-lime' },
  lost: { label: 'Lost', className: 'border-danger/30 bg-danger/[0.07] text-danger' },
  ready: { label: 'Awaiting reveal', className: 'border-accent-2/30 bg-accent/10 text-accent-2' },
  sealing: { label: 'Sealing', className: 'border-border bg-surface-2/60 text-muted' },
  expired: { label: 'Forfeited', className: 'border-warning/30 bg-warning/[0.07] text-warning' },
}

function StatusBadge({ status }: { status: RunStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span className={`inline-flex h-6 items-center rounded-full border px-2.5 font-mono text-[0.7rem] uppercase tracking-wider ${s.className}`}>
      {s.label}
    </span>
  )
}

function payoutOf(row: Row, payouts: Record<string, string> | undefined): bigint | undefined {
  if (!row.run.resolved) return undefined
  const exact = payouts?.[row.id.toString()]
  return exact !== undefined ? BigInt(exact) : nominalPayout(row.run)
}

function PlayerLink({ address }: { address: string }) {
  const { address: me } = useConnection()
  const isMe = !!me && me.toLowerCase() === address.toLowerCase()
  return (
    <a
      className="link inline-flex items-center gap-1 font-mono"
      href={explorerAddressUrl(address)}
      target="_blank"
      rel="noreferrer"
      title={address}
    >
      {truncateAddress(address)}
      {isMe ? <span className="rounded-md bg-accent/15 px-1.5 text-[0.65rem] text-accent-2">you</span> : null}
    </a>
  )
}

function RecentRuns({
  rows,
  current,
  payouts,
  loading,
  total,
}: {
  rows: Row[]
  current: bigint | undefined
  payouts: Record<string, string> | undefined
  loading: boolean
  total: bigint | undefined
}) {
  return (
    <div className="card min-w-0 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Arena log</p>
          <h2 className="mt-1.5 text-2xl font-semibold">Last 50 runs</h2>
        </div>
        <p className="text-sm text-muted">{total !== undefined ? `${total.toString()} runs all time` : 'newest first'}</p>
      </div>

      {!DEPLOYED ? (
        <EmptyState text="The run history appears here once the arena contract is deployed." />
      ) : loading ? (
        <div className="mt-5 space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="skeleton block h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState text="No runs yet. Be the first to enter the arena." />
      ) : (
        <>
          {/* Phones: one compact card per run. */}
          <ul className="mt-5 space-y-2 sm:hidden">
            {rows.map((row) => {
              const payout = payoutOf(row, payouts)
              return (
                <li key={row.id.toString()} className="rounded-xl border border-border bg-surface/50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-muted">#{row.id.toString()}</span>
                    <StatusBadge status={runStatus(row.run, current)} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <PlayerLink address={row.run.player} />
                    <span className="text-muted">{ITEM_NAMES[row.run.item]}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 font-mono">
                    <span className="text-muted">{row.run.resolved ? `${row.run.playerRoll} vs ${row.run.enemyRoll}` : '—'}</span>
                    <span className={payout ? 'text-accent-2' : 'text-muted'}>
                      {payout !== undefined ? `${formatToken(payout)} VLAD` : '—'}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>

          {/* Tablets and up: a table. */}
          <div className="mt-5 hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Run</th>
                  <th className="py-2 pr-3 font-medium">Player</th>
                  <th className="py-2 pr-3 font-medium">Item</th>
                  <th className="py-2 pr-3 font-medium">Rolls (you · shadow)</th>
                  <th className="py-2 pr-3 font-medium">Result</th>
                  <th className="py-2 text-right font-medium">Payout</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const payout = payoutOf(row, payouts)
                  return (
                    <tr key={row.id.toString()} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-3 font-mono text-muted">#{row.id.toString()}</td>
                      <td className="py-2.5 pr-3">
                        <PlayerLink address={row.run.player} />
                      </td>
                      <td className="py-2.5 pr-3">{ITEM_NAMES[row.run.item]}</td>
                      <td className="py-2.5 pr-3 font-mono">
                        {row.run.resolved ? (
                          <>
                            <span className={row.run.won ? 'text-lime' : 'text-text'}>{row.run.playerRoll}</span>
                            <span className="text-muted"> · </span>
                            <span className={row.run.won ? 'text-muted' : 'text-danger'}>{row.run.enemyRoll}</span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge status={runStatus(row.run, current)} />
                      </td>
                      <td className={`py-2.5 text-right font-mono ${payout ? 'text-accent-2' : 'text-muted'}`}>
                        {payout !== undefined ? formatToken(payout) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            Payouts come from the Resolved events. A Shield loss shows its 50% refund.
          </p>
        </>
      )}
    </div>
  )
}

function Leaderboard({ rows, payouts }: { rows: Row[]; payouts: Record<string, string> | undefined }) {
  const board = useMemo(() => {
    const byPlayer = new Map<string, { player: string; wins: number; runs: number; won: bigint }>()
    for (const row of rows) {
      const key = row.run.player.toLowerCase()
      const entry = byPlayer.get(key) ?? { player: row.run.player, wins: 0, runs: 0, won: 0n }
      entry.runs += 1
      if (row.run.resolved && row.run.won) {
        entry.wins += 1
        entry.won += payoutOf(row, payouts) ?? 0n
      }
      byPlayer.set(key, entry)
    }
    return [...byPlayer.values()]
      .filter((e) => e.wins > 0)
      .sort((a, b) => b.wins - a.wins || a.runs - b.runs)
      .slice(0, 8)
  }, [rows, payouts])

  return (
    <div className="card min-w-0 p-4 sm:p-6">
      <p className="eyebrow">Hall of fame</p>
      <h2 className="mt-1.5 text-2xl font-semibold">Top by wins</h2>
      <p className="mt-1 text-xs text-muted">Counted over the last 50 runs.</p>
      {board.length === 0 ? (
        <EmptyState text={DEPLOYED ? 'No wins yet. The first Trophy is still up for grabs.' : 'The leaderboard appears once the arena is deployed.'} />
      ) : (
        <ol className="mt-4 space-y-2">
          {board.map((e, i) => (
            <li key={e.player} className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 px-3 py-2.5 text-sm">
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-lg font-mono text-xs font-bold ${
                  i === 0 ? 'bg-lime text-bg' : i < 3 ? 'bg-accent/25 text-accent-2' : 'bg-surface-2 text-muted'
                }`}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <PlayerLink address={e.player} />
              </span>
              <span className="text-right font-mono">
                <span className="text-lime">{e.wins}W</span>
                <span className="text-muted"> / {e.runs}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-5 rounded-2xl border border-dashed border-border bg-surface/30 px-4 py-8 text-center text-sm text-muted">
      {text}
    </div>
  )
}

// ---------------------------------------------------------------- fairness

const FAIRNESS_STEPS = [
  ['Commit', 'Your browser draws a random 32-byte secret and sends only commit = keccak256(abi.encode(secret, you)).'],
  ['Enter', 'The contract burns your item, escrows the stake and records enterBlock, the block of your transaction.'],
  ['Seal', 'Block enterBlock + 1 is produced. Its hash did not exist when you committed, so no secret could be tuned to it.'],
  ['Reveal', 'From block enterBlock + 2 you call resolve(id, secret). The contract checks the secret against the commit and rolls.'],
] as const

function FairnessCard() {
  return (
    <div className="card min-w-0 p-4 sm:p-6">
      <p className="eyebrow">Provably fair</p>
      <h2 className="mt-1.5 text-2xl font-semibold">How fairness works</h2>
      <ol className="mt-5 space-y-3">
        {FAIRNESS_STEPS.map(([title, text], i) => (
          <li key={title} className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-accent-2/40 bg-accent/10 font-mono text-xs font-semibold text-accent-2">
              {i + 1}
            </span>
            <p className="min-w-0 text-sm leading-relaxed text-muted">
              <span className="font-display font-semibold text-text">{title}. </span>
              {text}
            </p>
          </li>
        ))}
      </ol>

      <pre className="mt-5 overflow-x-auto rounded-xl border border-border bg-bg/80 p-3 font-mono text-[0.68rem] leading-relaxed text-text/90 sm:text-xs">
        {`seed       = keccak256(abi.encode(secret,
               blockhash(enterBlock + 1)))
playerRoll = seed % 100 + 1
enemyRoll  = (seed >> 128) % 100 + 1
won        = playerRoll > enemyRoll
// a Sword adds 10 to playerRoll
// a tie goes to the shadow`}
      </pre>

      <div className="mt-5 overflow-hidden rounded-xl border border-border text-sm">
        {[
          ['enterBlock, enterBlock + 1', 'resolve reverts: TooEarly', 'text-muted'],
          ['enterBlock + 2 … enterBlock + 251', 'resolve works (250-block window, ~50 min)', 'text-accent-2'],
          ['enterBlock + 252 and later', 'resolve reverts: Expired, stake stays in the pool', 'text-warning'],
        ].map(([when, what, color]) => (
          <div key={when} className="grid gap-1 border-b border-border/70 px-3 py-2 last:border-0 sm:grid-cols-[15.5rem_1fr] sm:gap-3">
            <span className="font-mono text-xs text-text/90">{when}</span>
            <span className={`text-xs ${color}`}>{what}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-3 text-sm leading-relaxed text-muted">
        <p>
          <span className="font-semibold text-text">Why the validator cannot bias the result.</span> The validator that
          builds block enterBlock + 1 can influence its hash, but the seed also needs your secret, and the validator only
          ever sees its hash. Without the secret it cannot tell which block hash would make you lose, so it has nothing to
          aim for.
        </p>
        <p>
          <span className="font-semibold text-text">Why skipping the reveal never helps you.</span> Once block
          enterBlock + 1 exists you could compute the outcome before revealing. But the stake and the item were taken at
          entry, so a run you do not reveal simply expires with its stake in the pool. Revealing a loss is never worse,
          and with a Shield it returns half the stake. Your run count also goes up at entry, so hiding losses does not
          improve your record.
        </p>
        <p className="text-xs">
          Limit: a player who is also the validator of block enterBlock + 1 could try many block hashes. That is
          acceptable for a testnet arcade; a game with real value would use a verifiable random function.
        </p>
      </div>
    </div>
  )
}

function VerifyRun() {
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const [secret, setSecret] = useState('')
  const [blockHash, setBlockHash] = useState('')
  const [item, setItem] = useState<number>(NO_ITEM)
  const [runId, setRunId] = useState('')
  const [loaded, setLoaded] = useState<{ id: bigint; run: Run }>()
  const [loadError, setLoadError] = useState<string>()
  const [loadingRun, setLoadingRun] = useState(false)

  const valid = isBytes32(secret) && isBytes32(blockHash)
  const local = valid ? computeRolls(secret.trim() as Hex, blockHash.trim() as Hex, item) : undefined
  const onChain = useReadContract({
    ...arenaContract,
    functionName: 'rollsFor',
    args: valid ? [secret.trim() as Hex, blockHash.trim() as Hex, item] : undefined,
    query: { enabled: DEPLOYED && valid },
  })
  const chainRolls = onChain.data
  const agrees = !!local && !!chainRolls && chainRolls[0] === local.playerRoll && chainRolls[1] === local.enemyRoll
  const matchesRun =
    !!local && !!loaded && loaded.run.resolved && loaded.run.item === item &&
    loaded.run.playerRoll === local.playerRoll && loaded.run.enemyRoll === local.enemyRoll

  /** Fills all three inputs from a resolved run: block hash from the chain, secret from the resolve transaction. */
  async function loadRun(e: FormEvent) {
    e.preventDefault()
    setLoadError(undefined)
    setLoaded(undefined)
    if (!publicClient || !DEPLOYED || !/^\d+$/.test(runId.trim())) {
      setLoadError(DEPLOYED ? 'Enter a run number.' : 'The arena is not deployed yet.')
      return
    }
    setLoadingRun(true)
    try {
      const id = BigInt(runId.trim())
      const run = (await publicClient.readContract({
        address: addresses.arena,
        abi: stellarArenaAbi,
        functionName: 'getRun',
        args: [id],
      })) as Run
      if (run.player === '0x0000000000000000000000000000000000000000') throw new Error(`Run #${id} does not exist.`)
      setItem(run.item)
      const hashBlock = await publicClient.getBlock({ blockNumber: run.enterBlock + 1n })
      setBlockHash(hashBlock.hash ?? '')
      setLoaded({ id, run })
      if (!run.resolved) {
        setLoadError(`Run #${id} is not resolved yet, so its secret is still private.`)
        return
      }
      const latest = await publicClient.getBlockNumber()
      const last = lastResolveBlock(run.enterBlock)
      const [event] = await publicClient.getContractEvents({
        address: addresses.arena,
        abi: stellarArenaAbi,
        eventName: 'Resolved',
        args: { id },
        fromBlock: run.enterBlock + 2n,
        toBlock: last < latest ? last : latest,
      })
      if (!event) throw new Error('Could not find the Resolved event. Paste the secret from the resolve transaction.')
      const tx = await publicClient.getTransaction({ hash: event.transactionHash })
      const call = decodeFunctionData({ abi: stellarArenaAbi, data: tx.input })
      if (call.functionName !== 'resolve') throw new Error('The run was resolved through another contract. Paste the secret.')
      setSecret(call.args[1])
    } catch (err) {
      setLoadError(describeError(err, ARENA_ERRORS))
    } finally {
      setLoadingRun(false)
    }
  }

  const inputClass =
    'h-10 w-full min-w-0 rounded-xl border border-border bg-bg/70 px-3 font-mono text-xs outline-none focus:border-accent-2/60'

  return (
    <div className="card min-w-0 p-4 sm:p-6">
      <p className="eyebrow">Don&apos;t trust, verify</p>
      <h2 className="mt-1.5 text-2xl font-semibold">Verify a run</h2>
      <p className="mt-1 text-sm text-muted">
        Recompute any roll from the revealed secret and the hash of block enterBlock + 1. Enter a resolved run number
        to fill all three fields from the chain.
      </p>

      <form className="mt-4 flex gap-2" onSubmit={loadRun}>
        <input
          className={`${inputClass} w-auto flex-1`}
          placeholder="Run # (optional)"
          inputMode="numeric"
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
          aria-label="Run number to load"
        />
        <button type="submit" className="btn btn-ghost min-h-10 shrink-0" disabled={loadingRun}>
          {loadingRun ? <Spinner /> : null} Load
        </button>
      </form>
      {loadError ? <p className="mt-2 text-xs text-warning">{loadError}</p> : null}

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-xs text-muted">Secret (from the resolve transaction)</span>
          <input className={`${inputClass} mt-1`} placeholder="0x…" value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Hash of block enterBlock + 1</span>
          <input className={`${inputClass} mt-1`} placeholder="0x…" value={blockHash} onChange={(e) => setBlockHash(e.target.value)} spellCheck={false} />
        </label>
        <div>
          <span className="text-xs text-muted">Item</span>
          <div className="mt-1 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Item">
            {[NO_ITEM, SWORD, SHIELD].map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={item === id}
                className={`h-9 rounded-xl border text-sm transition ${
                  item === id ? 'border-accent-2/60 bg-accent/10 text-text' : 'border-border bg-surface/50 text-muted hover:text-text'
                }`}
                onClick={() => setItem(id)}
              >
                {ITEM_NAMES[id]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-bg/60 p-4" aria-live="polite">
        {local ? (
          <>
            <div className="flex items-center justify-around gap-4 text-center">
              <div>
                <p className="eyebrow">You</p>
                <p className="mt-1 font-mono text-3xl font-bold text-lime">{local.playerRoll}</p>
              </div>
              <p className="font-display text-sm font-bold text-muted">VS</p>
              <div>
                <p className="eyebrow">Shadow</p>
                <p className="mt-1 font-mono text-3xl font-bold text-danger">{local.enemyRoll}</p>
              </div>
            </div>
            <p className={`mt-3 text-center font-display font-semibold ${local.won ? 'text-lime' : 'text-danger'}`}>
              {local.won ? 'Player wins' : 'Shadow wins'}
            </p>
            <ul className="mt-3 space-y-1 text-xs">
              <li className="text-muted">Computed in your browser with the contract&apos;s formula.</li>
              {DEPLOYED ? (
                <li className={chainRolls ? (agrees ? 'text-accent-2' : 'text-danger') : 'text-muted'}>
                  {chainRolls
                    ? agrees
                      ? <span className="inline-flex items-center gap-1"><CheckIcon size={13} /> rollsFor() on-chain returns the same rolls.</span>
                      : 'rollsFor() on-chain returns different rolls.'
                    : 'Asking rollsFor() on-chain…'}
                </li>
              ) : (
                <li className="text-muted">rollsFor() becomes available once the arena is deployed.</li>
              )}
              {loaded?.run.resolved ? (
                <li className={matchesRun ? 'text-accent-2' : 'text-danger'}>
                  {matchesRun ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckIcon size={13} /> Matches the result stored for run #{loaded.id.toString()}.
                    </span>
                  ) : (
                    `Does not match run #${loaded.id.toString()} (${loaded.run.playerRoll} vs ${loaded.run.enemyRoll}).`
                  )}
                </li>
              ) : null}
            </ul>
          </>
        ) : (
          <p className="text-center text-sm text-muted">Paste a secret and a block hash (both 0x + 64 hex characters).</p>
        )}
      </div>
      {loaded ? (
        <a
          className="link mt-3 inline-flex items-center gap-1 text-xs"
          href={`${EXPLORER_URL}/block/${(loaded.run.enterBlock + 1n).toString()}`}
          target="_blank"
          rel="noreferrer"
        >
          Block {(loaded.run.enterBlock + 1n).toString()} on Blockscout <ExternalIcon />
        </a>
      ) : null}
    </div>
  )
}
