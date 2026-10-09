import { useEffect } from 'react'
import type { Address, Hash, Hex } from 'viem'
import { useBlockNumber, useConnection, useReadContracts } from 'wagmi'
import { CHAIN_ID, addresses } from '../../config/addresses'
import { CopyButton } from '../../shell/CopyButton'
import { formatToken } from '../../shell/format'
import { TxButton } from '../../shell/TxButton'
import { blocksToMinutes, firstResolveBlock, lastResolveBlock } from '../arena'
import {
  ARCADE_DEPLOYED,
  ARCADE_ERRORS,
  CABINETS,
  KINDS,
  arcadeContract,
  arcadeSecrets,
  arcadeWriteAbi,
  type ArcadeResult,
  type ArcadeRun,
} from './arcade'
import { sameAddress, useArcadeResolveHandler, useRunClock } from './hooks'

/** A run entered from this page that is waiting to be resolved. */
export type ActiveArcadeRun = {
  id: bigint
  gameId: number
  kind: number
  secret: Hex
  enterBlock: bigint
  item: number
  choice: number
  winChancePct: number
  txHash?: Hash
}

const ITEM_LABEL = ['No item', 'Sword', 'Shield']

/** Secret backup + "fate is being sealed" progress + Resolve, for the run just entered. */
export function ActiveRunPanel({
  run,
  onResolved,
  onDismiss,
}: {
  run: ActiveArcadeRun
  onResolved: (r: ArcadeResult) => void
  onDismiss: () => void
}) {
  const { current, ready, expired } = useRunClock(run.id)
  const handleConfirmed = useArcadeResolveHandler(run, onResolved)
  const sealBlock = run.enterBlock + 1n
  const first = firstResolveBlock(run.enterBlock)
  const last = lastResolveBlock(run.enterBlock)
  const progress = current === undefined ? 0 : Math.min(1, Math.max(0, Number(current - run.enterBlock) / 2))
  const blocksLeft = current !== undefined && current <= last ? last - current : 0n

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-warning/35 bg-warning/[0.06] p-4">
        <p className="font-display font-semibold text-warning">Back up your secret for arcade run #{run.id.toString()}</p>
        <div className="mt-2 flex min-w-0 items-center gap-2 rounded-xl border border-border bg-bg/70 p-2 pl-3">
          <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-text/90">{run.secret}</code>
          <CopyButton value={run.secret} label="Copy secret" />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          The secret is stored only in this browser. If you lose it, nobody can resolve this run and its stake is
          forfeited to the Arcade prize pool.
        </p>
      </div>

      {expired ? (
        <div className="rounded-2xl border border-danger/30 bg-danger/[0.06] p-4 text-sm">
          <p className="font-semibold text-danger">Run #{run.id.toString()} expired</p>
          <p className="mt-1 text-muted">It was not resolved by block {last.toString()}, so the stake stayed in the pool.</p>
          <button type="button" className="btn btn-ghost mt-3" onClick={onDismiss}>
            Back to the cabinet
          </button>
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl border border-border bg-surface/50 p-4">
          <p className="font-display text-lg font-semibold">
            {ready ? 'Your fate is sealed. Reveal it.' : `Your fate is being sealed in block ${sealBlock.toString()}`}
          </p>
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent via-accent-2 to-lime transition-[width] duration-700"
                style={{ width: `${Math.round((ready ? 1 : progress) * 100)}%` }}
              />
            </div>
            <ol className="mt-2 grid grid-cols-3 text-xs">
              {[
                ['Entered', run.enterBlock],
                ['Sealed', sealBlock],
                ['Reveal', first],
              ].map(([labelText, block], i) => (
                <li
                  key={String(labelText)}
                  className={`${i === 1 ? 'text-center' : i === 2 ? 'text-right' : ''} ${
                    current !== undefined && current >= (block as bigint) ? 'text-accent-2' : 'text-muted'
                  }`}
                >
                  <span className="block font-medium">{String(labelText)}</span>
                  <span className="font-mono">#{(block as bigint).toString()}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Current block <span className="font-mono text-text">{current?.toString() ?? '—'}</span>. Resolvable from
            block <span className="font-mono text-text">{first.toString()}</span> through block{' '}
            <span className="font-mono text-text">{last.toString()}</span>
            {current !== undefined && current >= first ? ` (${blocksLeft.toString()} blocks, ${blocksToMinutes(blocksLeft)} left)` : ''}.
          </p>
          <TxButton
            request={{ address: addresses.arcade, abi: arcadeWriteAbi, functionName: 'resolve', args: [run.id, run.secret] }}
            disabled={!ready}
            errorMessages={ARCADE_ERRORS}
            onConfirmed={handleConfirmed}
            className="h-13 w-full text-base"
          >
            {ready ? 'Resolve: reveal and play' : `Sealing… ready at block ${first.toString()}`}
          </TxButton>
        </div>
      )}
    </div>
  )
}

/** Open (unresolved) arcade runs of the connected wallet that have a secret in this browser. */
export function ArcadeOpenRuns({
  gameId,
  excludeId,
  onResolved,
  emptyText,
  title,
}: {
  gameId?: number
  excludeId?: bigint
  onResolved: (r: ArcadeResult) => void
  emptyText?: string
  /** When set, the list renders inside its own card with this eyebrow, and nothing at all while empty. */
  title?: string
}) {
  const { address } = useConnection()
  const ids = arcadeSecrets.useStoredRunIds(address).filter((id) => id !== excludeId)
  const runsQ = useReadContracts({
    contracts: ids.map((id) => ({ ...arcadeContract, functionName: 'getRun', args: [id] }) as const),
    query: { enabled: ARCADE_DEPLOYED && !!address && ids.length > 0, refetchInterval: 12_000 },
  })
  const block = useBlockNumber({
    chainId: CHAIN_ID,
    query: { enabled: ARCADE_DEPLOYED && ids.length > 0, refetchInterval: 4_000 },
  })
  const rows = ids
    .map((id, i) => ({ id, run: runsQ.data?.[i]?.result as ArcadeRun | undefined }))
    .filter((r): r is { id: bigint; run: ArcadeRun } => !!r.run && sameAddress(r.run.player, address))

  // Resolved runs (for example in another tab) no longer need their secret.
  useEffect(() => {
    if (!address) return
    for (const { id, run } of rows) if (run.resolved) arcadeSecrets.forgetSecret(address, id)
  }, [address, rows])

  const open = rows.filter((r) => !r.run.resolved && (gameId === undefined || r.run.gameId === gameId))
  if (!address) return emptyText && !title ? <p className="text-sm text-muted">Connect your wallet to see your open runs.</p> : null
  if (open.length === 0) return emptyText && !title ? <p className="text-sm text-muted">{emptyText}</p> : null
  const list = (
    <ul className="space-y-3">
      {open.map(({ id, run }) => (
        <OpenRunRow key={id.toString()} id={id} run={run} current={block.data} account={address} onResolved={onResolved} />
      ))}
    </ul>
  )
  if (!title) return list
  return (
    <div className="card p-4 sm:p-6">
      <p className="eyebrow">{title}</p>
      <div className="mt-3">{list}</div>
    </div>
  )
}

function OpenRunRow({
  id,
  run,
  current,
  account,
  onResolved,
}: {
  id: bigint
  run: ArcadeRun
  current: bigint | undefined
  account: Address
  onResolved: (r: ArcadeResult) => void
}) {
  const secret = arcadeSecrets.loadSecret(account, id)
  const handleConfirmed = useArcadeResolveHandler(
    { id, gameId: run.gameId, kind: run.kind, item: run.item, choice: run.choice, winChancePct: run.winChancePct },
    onResolved,
  )
  const first = firstResolveBlock(run.enterBlock)
  const last = lastResolveBlock(run.enterBlock)
  const expired = current !== undefined && current > last
  const ready = current !== undefined && current >= first && !expired
  const cabinet = CABINETS[run.gameId]

  return (
    <li className="rounded-2xl border border-border bg-surface/50 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 truncate text-sm">
          <span className="font-mono text-muted">#{id.toString()}</span>{' '}
          <span className="font-medium">{cabinet?.name ?? `Cabinet ${run.gameId}`}</span>{' '}
          <span className="text-xs text-muted">
            · {KINDS[run.kind]} · {ITEM_LABEL[run.item]}
            {KINDS[run.kind] === 'RACE' ? ` · lane ${run.choice + 1}` : ''} · {formatToken(run.stake)} VLAD
          </span>
        </span>
        <span className={`text-xs ${expired ? 'text-danger' : ready ? 'text-accent-2' : 'text-muted'}`}>
          {expired ? 'Forfeited' : ready ? `Ready · until #${last.toString()}` : `Sealing · ready at #${first.toString()}`}
        </span>
      </div>
      {expired ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">The reveal window closed at block {last.toString()}. The stake stayed in the pool.</p>
          <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" onClick={() => arcadeSecrets.forgetSecret(account, id)}>
            Dismiss
          </button>
        </div>
      ) : secret ? (
        <div className="mt-3">
          <TxButton
            request={{ address: addresses.arcade, abi: arcadeWriteAbi, functionName: 'resolve', args: [id, secret] }}
            disabled={!ready}
            errorMessages={ARCADE_ERRORS}
            onConfirmed={handleConfirmed}
            className="w-full"
          >
            {ready ? 'Resolve' : 'Sealing…'}
          </TxButton>
        </div>
      ) : null}
    </li>
  )
}
