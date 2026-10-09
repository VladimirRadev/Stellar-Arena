import { useMemo, useState, type FormEvent } from 'react'
import { decodeFunctionData, type Hex } from 'viem'
import { useBlockNumber, useConnection, usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { stellarArcadeAbi } from '../../abi'
import { CHAIN_ID, addresses } from '../../config/addresses'
import { describeError } from '../../shell/errors'
import { explorerAddressUrl, formatToken, truncateAddress } from '../../shell/format'
import { CheckIcon, ExternalIcon, Spinner } from '../../shell/icons'
import { EXPLORER_URL } from '../../shell/wagmi'
import { firstResolveBlock, isBytes32, lastResolveBlock } from '../arena'
import {
  ARCADE_DEPLOYED,
  ARCADE_ERRORS,
  CABINETS,
  KIND,
  KINDS,
  NO_ITEM,
  OUTCOMES,
  OUTCOME_STYLE,
  SHIELD,
  SWORD,
  arcadeContract,
  cardLabel,
  computeOutcome,
  formatBps,
  swordAllowed,
  type ArcadeRun,
  type GameRules,
} from './arcade'

const HISTORY_SIZE = 50n
const ITEM_NAMES = ['None', 'Sword', 'Shield']

type Row = { id: bigint; run: ArcadeRun }

function statusBadge(run: ArcadeRun, current: bigint | undefined) {
  if (run.resolved) return OUTCOME_STYLE[run.outcome]
  if (current !== undefined && current > lastResolveBlock(run.enterBlock))
    return { label: 'Forfeited', className: 'border-warning/30 bg-warning/[0.07] text-warning' }
  if (current !== undefined && current >= firstResolveBlock(run.enterBlock))
    return { label: 'Awaiting reveal', className: 'border-accent-2/30 bg-accent/10 text-accent-2' }
  return { label: 'Sealing', className: 'border-border bg-surface-2/60 text-muted' }
}

function Badge({ s }: { s: { label: string; className: string } }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-full border px-2.5 font-mono text-[0.7rem] uppercase tracking-wider ${s.className}`}>
      {s.label}
    </span>
  )
}

function PlayerLink({ address }: { address: string }) {
  const { address: me } = useConnection()
  const isMe = !!me && me.toLowerCase() === address.toLowerCase()
  return (
    <a className="link inline-flex items-center gap-1 font-mono" href={explorerAddressUrl(address)} target="_blank" rel="noreferrer" title={address}>
      {truncateAddress(address)}
      {isMe ? <span className="rounded-md bg-accent/15 px-1.5 text-[0.65rem] text-accent-2">you</span> : null}
    </a>
  )
}

const playText = (run: ArcadeRun) =>
  `${ITEM_NAMES[run.item]}${run.kind === KIND.RACE ? ` · lane ${run.choice + 1}` : ''}`

function resultText(run: ArcadeRun) {
  if (!run.resolved) return '—'
  if (run.kind === KIND.RACE) return `lane ${run.roll + 1} won`
  if (run.kind === KIND.HIGHCARD) {
    const a = cardLabel(run.roll)
    const b = cardLabel(run.houseRoll)
    return `${a.rank}${a.suit} vs ${b.rank}${b.suit}`
  }
  if (run.kind === KIND.TIERS) return `roll ${run.roll}`
  return `${run.roll} (< ${run.houseRoll})`
}

/** The last 50 arcade runs, newest first. */
export function ArcadeHistory() {
  const next = useReadContract({ ...arcadeContract, functionName: 'nextRunId', query: { enabled: ARCADE_DEPLOYED, refetchInterval: 15_000 } })
  const ids = useMemo(() => {
    const out: bigint[] = []
    const n = next.data ?? 0n
    for (let id = n - 1n; id >= 0n && id >= n - HISTORY_SIZE; id--) out.push(id)
    return out
  }, [next.data])
  const runsQ = useReadContracts({
    contracts: ids.map((id) => ({ ...arcadeContract, functionName: 'getRun', args: [id] }) as const),
    query: { enabled: ARCADE_DEPLOYED && ids.length > 0 },
  })
  const block = useBlockNumber({ chainId: CHAIN_ID, query: { enabled: ARCADE_DEPLOYED, refetchInterval: 12_000 } })
  const rows = useMemo(
    () => ids.map((id, i) => ({ id, run: runsQ.data?.[i]?.result as ArcadeRun | undefined })).filter((r): r is Row => !!r.run),
    [ids, runsQ.data],
  )
  const loading = ARCADE_DEPLOYED && (next.isLoading || runsQ.isLoading)

  return (
    <div className="card min-w-0 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Arcade log</p>
          <h3 className="mt-1.5 text-2xl font-semibold">Last 50 arcade runs</h3>
        </div>
        <p className="text-sm text-muted">{next.data !== undefined ? `${next.data.toString()} ${next.data === 1n ? 'run' : 'runs'} all time` : 'newest first'}</p>
      </div>
      {!ARCADE_DEPLOYED ? (
        <Empty text="Arcade runs appear here once the Arcade contract is deployed." />
      ) : loading ? (
        <div className="mt-5 space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="skeleton block h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty text="No arcade runs yet. Pick a cabinet above." />
      ) : (
        <>
          <ul className="mt-5 space-y-2 sm:hidden">
            {rows.map(({ id, run }) => (
              <li key={id.toString()} className="rounded-xl border border-border bg-surface/50 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-muted">#{id.toString()}</span> {CABINETS[run.gameId]?.name ?? run.gameId}
                  </span>
                  <Badge s={statusBadge(run, block.data)} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <PlayerLink address={run.player} />
                  <span className="text-xs text-muted">{playText(run)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 font-mono text-xs">
                  <span className="text-muted">{resultText(run)}</span>
                  <span className={run.payout > 0n ? 'text-accent-2' : 'text-muted'}>{run.resolved ? `${formatToken(run.payout)} VLAD` : '—'}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-5 hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Run</th>
                  <th className="py-2 pr-3 font-medium">Cabinet</th>
                  <th className="py-2 pr-3 font-medium">Player</th>
                  <th className="py-2 pr-3 font-medium">Play</th>
                  <th className="py-2 pr-3 font-medium">Roll</th>
                  <th className="py-2 pr-3 font-medium">Result</th>
                  <th className="py-2 text-right font-medium">Payout</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ id, run }) => (
                  <tr key={id.toString()} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 pr-3 font-mono text-muted">#{id.toString()}</td>
                    <td className="py-2.5 pr-3">
                      {CABINETS[run.gameId]?.name ?? run.gameId}
                      <span className="ml-1.5 font-mono text-[0.65rem] text-muted">{KINDS[run.kind]}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <PlayerLink address={run.player} />
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted">{playText(run)}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{resultText(run)}</td>
                    <td className="py-2.5 pr-3">
                      <Badge s={statusBadge(run, block.data)} />
                    </td>
                    <td className={`py-2.5 text-right font-mono ${run.payout > 0n ? 'text-accent-2' : 'text-muted'}`}>
                      {run.resolved ? formatToken(run.payout) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="mt-5 rounded-2xl border border-dashed border-border bg-surface/30 px-4 py-8 text-center text-sm text-muted">{text}</div>
  )
}

/** Recompute any arcade result from the revealed secret and the hash of block enterBlock + 1. */
export function ArcadeVerify({ rulesOf }: { rulesOf: (gameId: number) => GameRules }) {
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const [gameId, setGameId] = useState(0)
  const [secret, setSecret] = useState('')
  const [blockHash, setBlockHash] = useState('')
  const [item, setItem] = useState(NO_ITEM)
  const [choice, setChoice] = useState(0)
  const [runId, setRunId] = useState('')
  const [loaded, setLoaded] = useState<{ id: bigint; run: ArcadeRun }>()
  const [loadError, setLoadError] = useState<string>()
  const [busy, setBusy] = useState(false)

  // A loaded run uses the rules it snapshotted at enter; otherwise the cabinet's current rules.
  const rules = loaded && loaded.run.gameId === gameId ? loaded.run : rulesOf(gameId)
  const valid = isBytes32(secret) && isBytes32(blockHash)
  const usableItem = item === SWORD && !swordAllowed(rules.kind) ? NO_ITEM : item
  const local = valid ? computeOutcome(rules, secret.trim() as Hex, blockHash.trim() as Hex, usableItem, choice) : undefined
  const onChain = useReadContract({
    ...arcadeContract,
    functionName: 'rollsFor',
    args: valid ? [BigInt(gameId), secret.trim() as Hex, blockHash.trim() as Hex, usableItem, choice] : undefined,
    query: { enabled: ARCADE_DEPLOYED && valid },
  })
  const chain = onChain.data
  const agrees = !!local && !!chain && chain[0] === local.outcome && chain[2] === local.roll && chain[3] === local.houseRoll
  const matchesRun =
    !!local && !!loaded && loaded.run.resolved && loaded.run.outcome === local.outcome && loaded.run.roll === local.roll && loaded.run.houseRoll === local.houseRoll

  async function loadRun(e: FormEvent) {
    e.preventDefault()
    setLoadError(undefined)
    setLoaded(undefined)
    if (!publicClient || !ARCADE_DEPLOYED || !/^\d+$/.test(runId.trim())) {
      setLoadError(ARCADE_DEPLOYED ? 'Enter a run number.' : 'The Arcade is not deployed yet.')
      return
    }
    setBusy(true)
    try {
      const id = BigInt(runId.trim())
      const run = (await publicClient.readContract({ address: addresses.arcade, abi: stellarArcadeAbi, functionName: 'getRun', args: [id] })) as ArcadeRun
      if (run.player === '0x0000000000000000000000000000000000000000') throw new Error(`Arcade run #${id} does not exist.`)
      setGameId(run.gameId)
      setItem(run.item)
      setChoice(run.choice)
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
        address: addresses.arcade,
        abi: stellarArcadeAbi,
        eventName: 'Resolved',
        args: { id },
        fromBlock: run.enterBlock + 2n,
        toBlock: last < latest ? last : latest,
      })
      if (!event) throw new Error('Could not find the Resolved event. Paste the secret from the resolve transaction.')
      const tx = await publicClient.getTransaction({ hash: event.transactionHash })
      const call = decodeFunctionData({ abi: stellarArcadeAbi, data: tx.input })
      if (call.functionName !== 'resolve') throw new Error('The run was resolved through another contract. Paste the secret.')
      setSecret(call.args[1])
    } catch (err) {
      setLoadError(describeError(err, ARCADE_ERRORS))
    } finally {
      setBusy(false)
    }
  }

  const input = 'h-10 w-full min-w-0 rounded-xl border border-border bg-bg/70 px-3 font-mono text-xs outline-none focus:border-accent-2/60'
  const numbers = local ? explain(rules.kind, local.roll, local.houseRoll) : undefined

  return (
    <div className="card min-w-0 p-4 sm:p-6">
      <p className="eyebrow">Don&apos;t trust, verify</p>
      <h3 className="mt-1.5 text-2xl font-semibold">Verify an arcade run</h3>
      <p className="mt-1 text-sm text-muted">
        Same formula as <span className="font-mono">rollsFor(gameId, secret, blockHash, item, choice)</span>. Enter a
        resolved run number to fill everything from the chain.
      </p>
      <form className="mt-4 flex gap-2" onSubmit={loadRun}>
        <input className={`${input} w-auto flex-1`} placeholder="Arcade run # (optional)" inputMode="numeric" value={runId} onChange={(e) => setRunId(e.target.value)} aria-label="Arcade run number to load" />
        <button type="submit" className="btn btn-ghost min-h-10 shrink-0" disabled={busy}>
          {busy ? <Spinner /> : null} Load
        </button>
      </form>
      {loadError ? <p className="mt-2 text-xs text-warning">{loadError}</p> : null}

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-xs text-muted">Cabinet</span>
          <select
            className={`${input} mt-1 font-sans text-sm`}
            value={gameId}
            onChange={(e) => {
              setGameId(Number(e.target.value))
              setLoaded(undefined)
            }}
          >
            {CABINETS.map((cab) => (
              <option key={cab.id} value={cab.id}>
                #{cab.id} {cab.name} ({cab.kind})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted">Secret (from the resolve transaction)</span>
          <input className={`${input} mt-1`} placeholder="0x…" value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Hash of block enterBlock + 1</span>
          <input className={`${input} mt-1`} placeholder="0x…" value={blockHash} onChange={(e) => setBlockHash(e.target.value)} spellCheck={false} />
        </label>
        <div className={`grid gap-3 ${rules.kind === KIND.RACE ? 'sm:grid-cols-2' : ''}`}>
          <div>
            <span className="text-xs text-muted">Item</span>
            <div className="mt-1 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Item">
              {[NO_ITEM, SWORD, SHIELD].map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={item === id}
                  disabled={id === SWORD && !swordAllowed(rules.kind)}
                  className={`h-9 rounded-xl border text-xs transition disabled:opacity-40 ${item === id ? 'border-accent-2/60 bg-accent/10 text-text' : 'border-border bg-surface/50 text-muted hover:text-text'}`}
                  onClick={() => setItem(id)}
                >
                  {ITEM_NAMES[id]}
                </button>
              ))}
            </div>
          </div>
          {rules.kind === KIND.RACE ? (
            <div>
              <span className="text-xs text-muted">Your lane</span>
              <div className="mt-1 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Lane">
                {[0, 1, 2, 3].map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={choice === l}
                    className={`h-9 rounded-xl border font-mono text-xs transition ${choice === l ? 'border-lime/60 bg-lime/10 text-lime' : 'border-border bg-surface/50 text-muted hover:text-text'}`}
                    onClick={() => setChoice(l)}
                  >
                    {l + 1}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-bg/60 p-4" aria-live="polite">
        {local && numbers ? (
          <>
            <p className="text-center font-mono text-sm text-muted">{numbers}</p>
            <p className={`mt-2 text-center font-display text-2xl font-bold ${local.outcome >= 2 ? 'text-lime' : local.outcome === 1 ? 'text-accent-2' : 'text-danger'}`}>
              {OUTCOMES[local.outcome]} · pays {local.payoutBps ? formatBps(local.payoutBps) : '0×'}
            </p>
            <ul className="mt-3 space-y-1 text-xs">
              <li className="text-muted">Computed in your browser with the contract&apos;s formula.</li>
              {ARCADE_DEPLOYED ? (
                <li className={chain ? (agrees ? 'text-accent-2' : 'text-danger') : 'text-muted'}>
                  {chain ? (
                    agrees ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckIcon size={13} /> rollsFor() on-chain returns the same result.
                      </span>
                    ) : (
                      'rollsFor() on-chain returns a different result (the cabinet rules may have changed since this run).'
                    )
                  ) : (
                    'Asking rollsFor() on-chain…'
                  )}
                </li>
              ) : (
                <li className="text-muted">rollsFor() becomes available once the Arcade is deployed.</li>
              )}
              {loaded?.run.resolved ? (
                <li className={matchesRun ? 'text-accent-2' : 'text-danger'}>
                  {matchesRun ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckIcon size={13} /> Matches the result stored for run #{loaded.id.toString()}.
                    </span>
                  ) : (
                    `Does not match run #${loaded.id.toString()}.`
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
        <a className="link mt-3 inline-flex items-center gap-1 text-xs" href={`${EXPLORER_URL}/block/${(loaded.run.enterBlock + 1n).toString()}`} target="_blank" rel="noreferrer">
          Block {(loaded.run.enterBlock + 1n).toString()} on Blockscout <ExternalIcon />
        </a>
      ) : null}
    </div>
  )
}

function explain(kind: number, roll: number, houseRoll: number) {
  if (kind === KIND.DUEL || kind === KIND.EXTRACT) return `roll ${roll} of 0–99 · wins below ${houseRoll}`
  if (kind === KIND.TIERS) return `vault roll ${roll} of 0–999`
  if (kind === KIND.RACE) return `winning lane ${roll + 1} · your lane ${houseRoll + 1}`
  const a = cardLabel(roll)
  const b = cardLabel(houseRoll)
  return `your ${a.rank}${a.suit} (card ${roll}) vs house ${b.rank}${b.suit} (card ${houseRoll})`
}
