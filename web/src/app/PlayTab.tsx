import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { parseEventLogs, type Abi, type Address, type Hash, type Hex } from 'viem'
import {
  useBlockNumber,
  useConnection,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWriteContract,
} from 'wagmi'
import { stellarArenaAbi } from '../abi'
import { CHAIN_ID, addresses } from '../config/addresses'
import { CopyButton } from '../shell/CopyButton'
import { COMMON_ERRORS_ABI, describeError } from '../shell/errors'
import { explorerTxUrl, formatToken } from '../shell/format'
import { ArrowIcon, CheckIcon, ExternalIcon, Spinner } from '../shell/icons'
import { NetworkGate } from '../shell/NetworkGate'
import { getSite } from '../shell/sites'
import { StatTile } from '../shell/StatTile'
import { TxButton } from '../shell/TxButton'
import { useVladBalance } from '../shell/useVladBalance'
import {
  ARENA_ERRORS,
  DEPLOYED,
  ITEM_NAMES,
  NO_ITEM,
  SHIELD,
  SWORD,
  arenaContract,
  arenaWriteAbi,
  blocksToMinutes,
  commitmentOf,
  computeRolls,
  firstResolveBlock,
  formatMultiplier,
  isBytes32,
  lastResolveBlock,
  newSecret,
  nominalPayout,
  storeContract,
  tokenContract,
  type FightResult,
  type Run,
} from './arena'
import { FistIcon, ShieldIcon, SwordIcon, TrophyIcon } from './art'
import { CombatStage } from './CombatStage'
import {
  clearPending,
  forgetSecret,
  loadSecret,
  savePending,
  saveSecret,
  usePendingEntry,
  useStoredRunIds,
} from './secrets'

/** A run entered from this page that is waiting to be resolved. */
type ActiveRun = { id: bigint; secret: Hex; enterBlock: bigint; item: number; txHash?: Hash }

const APPROVE_RUNS = 10n
const sameAddress = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export function PlayTab({ onShowFairness }: { onShowFairness: () => void }) {
  const { address } = useConnection()
  const globals = useReadContracts({
    contracts: [
      { ...arenaContract, functionName: 'entryFee' },
      { ...arenaContract, functionName: 'winBps' },
      { ...arenaContract, functionName: 'prizePool' },
    ],
    query: { enabled: DEPLOYED, refetchInterval: 12_000 },
  })
  const entryFee = globals.data?.[0]?.result
  const winBps = globals.data?.[1]?.result
  const pool = globals.data?.[2]?.result
  const loading = DEPLOYED && globals.isLoading

  const userStats = useReadContract({
    ...arenaContract,
    functionName: 'stats',
    args: address ? [address] : undefined,
    query: { enabled: DEPLOYED && !!address },
  })
  const [runs, wins, paidOut] = userStats.data ?? []
  const userLoading = DEPLOYED && !!address && userStats.isLoading

  const [active, setActive] = useState<ActiveRun | null>(null)
  const [result, setResult] = useState<FightResult | null>(null)
  const [showResult, setShowResult] = useState(false)
  const onResolved = useCallback((r: FightResult) => {
    if (!r.demo) setActive((a) => (a && a.id === r.id ? null : a))
    setShowResult(false)
    setResult(r)
  }, [])
  const onFightFinished = useCallback(() => setShowResult(true), [])

  return (
    <div className="space-y-6 sm:space-y-8">
      <section aria-label="Arena statistics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
        <StatTile label="Prize pool" value={formatToken(pool, 18, 0)} unit="VLAD" loading={loading} hint="pays every win" highlight />
        <StatTile label="Entry fee" value={formatToken(entryFee)} unit="VLAD" loading={loading} hint="per run, escrowed" />
        <StatTile label="Win pays" value={formatMultiplier(winBps)} loading={loading} hint="the stake + a Trophy" />
        <StatTile label="Your runs" value={address && runs !== undefined ? runs.toString() : '—'} loading={userLoading} hint={address ? 'entered' : 'connect a wallet'} />
        <StatTile
          label="Your wins"
          value={address && wins !== undefined ? wins.toString() : '—'}
          loading={userLoading}
          hint={runs && wins !== undefined ? `${Math.round((Number(wins) / Number(runs)) * 100)}% win rate` : 'trophies earned'}
        />
        <StatTile label="Paid to you" value={address ? formatToken(paidOut) : '—'} unit="VLAD" loading={userLoading} hint="wins + Shield refunds" />
      </section>

      <section className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="card space-y-5 p-4 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="eyebrow">Arena floor</p>
              <h2 className="mt-1.5 text-2xl font-semibold">Enter the arena</h2>
            </div>
            <p className="text-sm text-muted">
              {entryFee !== undefined ? formatToken(entryFee) : '10'} VLAD per run · a win pays{' '}
              {winBps !== undefined ? formatMultiplier(winBps) : '1.8×'} + a Trophy
            </p>
          </div>

          <CombatStage result={result} onFinished={onFightFinished} />
          {result && showResult ? <ResultBanner result={result} onClose={() => setResult(null)} /> : null}
          {!result ? (
            <button type="button" className="link -mt-2 text-xs" onClick={() => onResolved(demoFight())}>
              Watch a demo fight (off-chain preview, nothing is staked)
            </button>
          ) : null}

          <RunFlow entryFee={entryFee} active={active} setActive={setActive} onResolved={onResolved} />
        </div>

        <div className="space-y-6">
          <MyRuns excludeId={active?.id} onResolved={onResolved} />
          <RulesCard entryFee={entryFee} winBps={winBps} onShowFairness={onShowFairness} />
        </div>
      </section>
    </div>
  )
}

/** A preview fight computed locally from two random values with the contract's formula. */
function demoFight(): FightResult {
  const item = [NO_ITEM, SWORD, SHIELD][Math.floor(Math.random() * 3)]
  const { playerRoll, enemyRoll, won } = computeRolls(newSecret(), newSecret(), item)
  return { id: 0n, won, playerRoll, enemyRoll, payout: 0n, item, demo: true }
}

// ---------------------------------------------------------------- run flow (equip -> approve -> enter -> wait -> resolve)

function RunFlow({
  entryFee,
  active,
  setActive,
  onResolved,
}: {
  entryFee: bigint | undefined
  active: ActiveRun | null
  setActive: (run: ActiveRun | null) => void
  onResolved: (r: FightResult) => void
}) {
  const { address } = useConnection()
  const [item, setItem] = useState<number>(NO_ITEM)

  const owned = useReadContracts({
    contracts: address
      ? [
          { ...storeContract, functionName: 'balanceOf', args: [address, BigInt(SWORD)] },
          { ...storeContract, functionName: 'balanceOf', args: [address, BigInt(SHIELD)] },
        ]
      : [],
    query: { enabled: DEPLOYED && !!address },
  })
  const swords = owned.data?.[0]?.result as bigint | undefined
  const shields = owned.data?.[1]?.result as bigint | undefined

  // An item that is no longer owned cannot stay selected.
  const equipped = (item === SWORD && swords === 0n) || (item === SHIELD && shields === 0n) ? NO_ITEM : item

  if (active) {
    return (
      <NetworkGate connectMessage="Reconnect the wallet that entered this run to resolve it.">
        <div className="space-y-4">
          <SecretBackup run={active} />
          <ResolvePanel run={active} onResolved={onResolved} onDismiss={() => setActive(null)} />
        </div>
      </NetworkGate>
    )
  }

  return (
    <div className="space-y-5">
      <EquipmentSelector value={equipped} onChange={setItem} swords={address ? swords : undefined} shields={address ? shields : undefined} />
      <NetworkGate connectMessage="Connect MetaMask to enter the arena.">
        <EnterSteps entryFee={entryFee} item={equipped} onEntered={setActive} />
      </NetworkGate>
    </div>
  )
}

const EQUIPMENT = [
  { id: NO_ITEM, name: 'Bare paws', effect: 'No bonus. Nothing to lose but the stake.', Icon: FistIcon },
  { id: SWORD, name: 'Sword', effect: '+10 attack on your roll.', Icon: SwordIcon },
  { id: SHIELD, name: 'Shield', effect: '50% of the stake back on a loss.', Icon: ShieldIcon },
] as const

function EquipmentSelector({
  value,
  onChange,
  swords,
  shields,
}: {
  value: number
  onChange: (item: number) => void
  swords: bigint | undefined
  shields: bigint | undefined
}) {
  const storeUrl = getSite('store').url
  return (
    <fieldset>
      <legend className="eyebrow">Equipment · one item per run, burned on entry</legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {EQUIPMENT.map(({ id, name, effect, Icon }) => {
          const count = id === SWORD ? swords : id === SHIELD ? shields : undefined
          const disabled = id !== NO_ITEM && count === 0n
          const selected = value === id
          return (
            <label
              key={id}
              className={`relative flex min-w-0 cursor-pointer items-start gap-3 rounded-2xl border p-3 transition sm:flex-col sm:gap-2 ${
                selected
                  ? 'border-accent-2/70 bg-accent/10 shadow-[0_0_0_1px_rgb(52_211_153/0.35),0_0_28px_-10px_rgb(52_211_153/0.8)]'
                  : 'border-border bg-surface/50 hover:border-accent-2/40'
              } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <input
                type="radio"
                name="equipment"
                className="sr-only"
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(id)}
              />
              <span
                className={`grid size-10 shrink-0 place-items-center rounded-xl border ${
                  selected ? 'border-accent-2/60 text-lime' : 'border-border text-accent-2'
                } bg-bg/60`}
              >
                <Icon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display font-semibold">{name}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted">{effect}</span>
                {id !== NO_ITEM ? (
                  <span className="mt-1.5 block font-mono text-xs">
                    {count === undefined ? (
                      <span className="text-muted">you own —</span>
                    ) : count > 0n ? (
                      <span className="text-accent-2">you own {count.toString()}</span>
                    ) : (
                      <a className="link inline-flex items-center gap-1" href={storeUrl}>
                        you own 0 · get one in the Store <ArrowIcon size={12} />
                      </a>
                    )}
                  </span>
                ) : (
                  <span className="mt-1.5 block font-mono text-xs text-muted">always available</span>
                )}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

type EnterPhase = 'idle' | 'preparing' | 'checking' | 'signing' | 'mining'

function EnterSteps({
  entryFee,
  item,
  onEntered,
}: {
  entryFee: bigint | undefined
  item: number
  onEntered: (run: ActiveRun) => void
}) {
  const { address } = useConnection()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const queryClient = useQueryClient()
  const write = useWriteContract()
  const { balance } = useVladBalance()
  const [phase, setPhase] = useState<EnterPhase>('idle')
  const [hash, setHash] = useState<Hash>()
  const [error, setError] = useState<string>()

  const allowanceQ = useReadContract({
    ...tokenContract,
    functionName: 'allowance',
    args: address ? [address, addresses.arena] : undefined,
    query: { enabled: DEPLOYED && !!address },
  })
  const allowance = allowanceQ.data
  const needsApproval = entryFee !== undefined && allowance !== undefined && allowance < entryFee
  const tooPoor = entryFee !== undefined && balance !== undefined && balance < entryFee

  async function enter() {
    if (!address || !publicClient || entryFee === undefined) return
    setError(undefined)
    setHash(undefined)
    let sent: Hash | undefined
    let expectedId: bigint | undefined
    try {
      // 1. Secret and commitment, computed in the browser and cross-checked against the contract.
      setPhase('preparing')
      const secret = newSecret()
      const commit = commitmentOf(secret, address)
      const [onChainCommit, nextId] = await Promise.all([
        publicClient.readContract({
          address: addresses.arena,
          abi: stellarArenaAbi,
          functionName: 'commitmentOf',
          args: [secret, address],
        }),
        publicClient.readContract({ address: addresses.arena, abi: stellarArenaAbi, functionName: 'nextRunId' }),
      ])
      if (onChainCommit.toLowerCase() !== commit.toLowerCase()) {
        throw new Error('The commitment computed in the browser does not match commitmentOf() on-chain. Nothing was sent.')
      }

      // 2. Save the secret BEFORE sending, under the expected run id, plus a pending marker.
      expectedId = nextId
      saveSecret(address, nextId, secret)
      savePending(address, { secret, commit, expectedId: nextId.toString(), item, savedAt: Date.now() })

      // 3. Simulate (decodes custom errors before the wallet opens), then send.
      setPhase('checking')
      await publicClient.simulateContract({
        address: addresses.arena,
        abi: [...arenaWriteAbi, ...COMMON_ERRORS_ABI] as Abi,
        functionName: 'enter',
        args: [commit, item],
        account: address,
      })
      setPhase('signing')
      sent = await write.mutateAsync({
        address: addresses.arena,
        abi: stellarArenaAbi,
        functionName: 'enter',
        args: [commit, item],
        chainId: CHAIN_ID,
      })
      setHash(sent)
      setPhase('mining')
      const receipt = await publicClient.waitForTransactionReceipt({ hash: sent })
      if (receipt.status !== 'success') throw new Error('The enter transaction reverted on-chain.')

      // 4. The real run id comes from the Entered event; re-key the secret if another run got in first.
      const entered = parseEventLogs({ abi: stellarArenaAbi, eventName: 'Entered', logs: receipt.logs }).find((log) =>
        sameAddress(log.args.player, address),
      )
      const id = entered?.args.id ?? nextId
      if (id !== nextId) {
        saveSecret(address, id, secret)
        forgetSecret(address, nextId)
      }
      clearPending(address)
      void queryClient.invalidateQueries()
      onEntered({ id, secret, enterBlock: entered?.args.enterBlock ?? receipt.blockNumber, item, txHash: sent })
    } catch (e) {
      // Nothing reached the chain: drop the secret saved for this attempt.
      if (!sent && expectedId !== undefined) {
        forgetSecret(address, expectedId)
        clearPending(address)
      }
      setError(describeError(e, ARENA_ERRORS))
    } finally {
      setPhase('idle')
    }
  }

  const busy = phase !== 'idle'
  const label = {
    idle: `Enter the arena · ${entryFee !== undefined ? formatToken(entryFee) : '—'} VLAD`,
    preparing: 'Sealing your secret…',
    checking: 'Checking…',
    signing: 'Confirm in wallet…',
    mining: 'Entering the arena…',
  }[phase]

  return (
    <div className="space-y-3">
      <Step n={1} done={!needsApproval && allowance !== undefined} title="Approve VLAD">
        {needsApproval && entryFee !== undefined ? (
          <TxButton
            request={{
              address: addresses.vladToken,
              abi: tokenContract.abi,
              functionName: 'approve',
              args: [addresses.arena, entryFee * APPROVE_RUNS],
            }}
            errorMessages={ARENA_ERRORS}
            className="w-full sm:w-auto"
          >
            Approve {formatToken(entryFee * APPROVE_RUNS)} VLAD ({APPROVE_RUNS.toString()} runs)
          </TxButton>
        ) : (
          <p className="text-sm text-muted">
            {allowance === undefined
              ? 'The arena needs an allowance to take the entry fee.'
              : `Allowance covers ${entryFee ? (allowance / entryFee).toString() : '—'} run(s).`}
          </p>
        )}
      </Step>

      <Step n={2} done={false} title={`Enter with ${ITEM_NAMES[item] === 'None' ? 'no item' : `a ${ITEM_NAMES[item]}`}`}>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="btn btn-primary h-13 w-full text-base"
            disabled={!DEPLOYED || busy || needsApproval || tooPoor || entryFee === undefined}
            aria-busy={busy}
            onClick={enter}
          >
            {busy ? <Spinner /> : null}
            {label}
          </button>
          {tooPoor ? <p className="text-sm text-warning">You need at least {formatToken(entryFee)} VLAD to enter.</p> : null}
          {hash ? (
            <a className="link inline-flex items-center gap-1 text-sm" href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
              View the enter transaction on Blockscout <ExternalIcon />
            </a>
          ) : null}
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <p className="text-xs leading-relaxed text-muted">
            Your browser creates a random 32-byte secret and sends only its hash. The secret is saved in this browser
            before the transaction is sent.
          </p>
        </div>
      </Step>
    </div>
  )
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span
        className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border font-mono text-xs font-semibold ${
          done ? 'border-accent-2/60 bg-accent/15 text-accent-2' : 'border-border bg-surface-2/70 text-muted'
        }`}
      >
        {done ? <CheckIcon size={14} /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-display font-semibold">{title}</p>
        {children}
      </div>
    </div>
  )
}

function SecretBackup({ run }: { run: ActiveRun }) {
  return (
    <div className="rounded-2xl border border-warning/35 bg-warning/[0.06] p-4">
      <p className="font-display font-semibold text-warning">Back up your secret for run #{run.id.toString()}</p>
      <div className="mt-2 flex min-w-0 items-center gap-2 rounded-xl border border-border bg-bg/70 p-2 pl-3">
        <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-text/90">{run.secret}</code>
        <CopyButton value={run.secret} label="Copy secret" />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        The secret is stored only in this browser. If you lose it (cleared site data, another device), nobody can
        resolve this run and its stake is forfeited to the prize pool. Keep a copy until the run is resolved.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- resolving

function useResolveHandler(run: { id: bigint; item: number }, onResolved: (r: FightResult) => void) {
  const { address } = useConnection()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  return useCallback(
    async (hash: Hash) => {
      if (!publicClient) return
      const receipt = await publicClient.getTransactionReceipt({ hash })
      const event = parseEventLogs({ abi: stellarArenaAbi, eventName: 'Resolved', logs: receipt.logs }).find(
        (log) => log.args.id === run.id,
      )
      if (event) {
        const { won, playerRoll, enemyRoll, payout } = event.args
        onResolved({ id: run.id, won, playerRoll, enemyRoll, payout, item: run.item, txHash: hash })
      } else {
        const r = (await publicClient.readContract({
          address: addresses.arena,
          abi: stellarArenaAbi,
          functionName: 'getRun',
          args: [run.id],
        })) as Run
        onResolved({ id: run.id, won: r.won, playerRoll: r.playerRoll, enemyRoll: r.enemyRoll, payout: nominalPayout(r), item: r.item, txHash: hash })
      }
      // The secret is public on-chain now; this browser no longer needs it.
      if (address) forgetSecret(address, run.id)
    },
    [address, publicClient, run.id, run.item, onResolved],
  )
}

function useRunClock(id: bigint) {
  const block = useBlockNumber({ chainId: CHAIN_ID, query: { enabled: DEPLOYED, refetchInterval: 4_000 } })
  const can = useReadContract({
    ...arenaContract,
    functionName: 'canResolve',
    args: [id],
    query: { enabled: DEPLOYED, refetchInterval: 4_000 },
  })
  const [ready, expired] = can.data ?? [false, false]
  return { current: block.data, ready, expired }
}

function ResolvePanel({
  run,
  onResolved,
  onDismiss,
}: {
  run: ActiveRun
  onResolved: (r: FightResult) => void
  onDismiss: () => void
}) {
  const { current, ready, expired } = useRunClock(run.id)
  const handleConfirmed = useResolveHandler(run, onResolved)
  const sealBlock = run.enterBlock + 1n
  const first = firstResolveBlock(run.enterBlock)
  const last = lastResolveBlock(run.enterBlock)
  const progress = current === undefined ? 0 : Math.min(1, Math.max(0, Number(current - run.enterBlock) / 2))
  const blocksLeft = current !== undefined && current <= last ? last - current : 0n

  if (expired) {
    return (
      <div className="rounded-2xl border border-danger/30 bg-danger/[0.06] p-4 text-sm">
        <p className="font-semibold text-danger">Run #{run.id.toString()} expired</p>
        <p className="mt-1 text-muted">
          It was not resolved by block {last.toString()}, so the stake stayed in the prize pool.
        </p>
        <button type="button" className="btn btn-ghost mt-3" onClick={onDismiss}>
          Back to the arena
        </button>
      </div>
    )
  }

  const steps = [
    { label: 'Entered', block: run.enterBlock },
    { label: 'Sealed', block: sealBlock },
    { label: 'Reveal', block: first },
  ]

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface/50 p-4">
      <div>
        <p className="eyebrow">Run #{run.id.toString()} · {ITEM_NAMES[run.item]}</p>
        <p className="mt-1.5 font-display text-lg font-semibold">
          {ready ? 'Your fate is sealed. Reveal it.' : `Your fate is being sealed in block ${sealBlock.toString()}`}
        </p>
      </div>
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent via-accent-2 to-lime transition-[width] duration-700"
            style={{ width: `${Math.round((ready ? 1 : progress) * 100)}%` }}
          />
        </div>
        <ol className="mt-2 grid grid-cols-3 text-xs">
          {steps.map((s, i) => (
            <li
              key={s.label}
              className={`${i === 1 ? 'text-center' : i === 2 ? 'text-right' : ''} ${
                current !== undefined && current >= s.block ? 'text-accent-2' : 'text-muted'
              }`}
            >
              <span className="block font-medium">{s.label}</span>
              <span className="font-mono">#{s.block.toString()}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Current block <span className="font-mono text-text">{current?.toString() ?? '—'}</span>. Resolvable from block{' '}
        <span className="font-mono text-text">{first.toString()}</span> through block{' '}
        <span className="font-mono text-text">{last.toString()}</span>
        {current !== undefined && current >= first ? ` (${blocksLeft.toString()} blocks, ${blocksToMinutes(blocksLeft)} left)` : ''}.
        After that the run expires and the stake stays in the pool.
      </p>
      <TxButton
        request={{ address: addresses.arena, abi: arenaWriteAbi, functionName: 'resolve', args: [run.id, run.secret] }}
        disabled={!ready}
        errorMessages={ARENA_ERRORS}
        onConfirmed={handleConfirmed}
        className="h-13 w-full text-base"
      >
        {ready ? 'Resolve: reveal and fight' : `Sealing… ready at block ${first.toString()}`}
      </TxButton>
    </div>
  )
}

function ResultBanner({ result, onClose }: { result: FightResult; onClose: () => void }) {
  const refund = !result.won && result.payout > 0n
  return (
    <div
      role="status"
      className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 ${
        result.won
          ? 'border-lime/50 bg-gradient-to-br from-accent/20 via-accent/10 to-lime/10'
          : 'border-danger/35 bg-danger/[0.06]'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-mono text-xs uppercase tracking-[0.3em] ${result.won ? 'text-lime' : 'text-danger'}`}>
            {result.won ? 'Victory' : 'Defeat'} · {result.demo ? 'demo fight' : `run #${result.id.toString()}`}
          </p>
          <p className="mt-1 font-display text-3xl font-bold">
            {result.demo ? (result.won ? 'WON' : 'LOST') : result.won ? `WON +${formatToken(result.payout)} VLAD` : 'LOST'}
          </p>
          <p className="mt-1 text-sm text-muted">
            You rolled <span className="font-mono text-text">{result.playerRoll}</span>
            {result.item === SWORD ? ' (Sword +10 included)' : ''} against the shadow&apos;s{' '}
            <span className="font-mono text-text">{result.enemyRoll}</span>.
          </p>
        </div>
        {result.won && !result.demo ? (
          <span className="chip border-lime/40 text-lime">
            <TrophyIcon size={16} /> Trophy minted
          </span>
        ) : null}
      </div>
      {result.demo ? (
        <p className="mt-2 text-sm text-muted">
          Off-chain preview with a random secret and block hash. Nothing was staked, paid or minted.
        </p>
      ) : !result.won ? (
        <p className="mt-2 text-sm">
          {refund ? (
            <span className="text-accent-2">Shield refund: +{formatToken(result.payout)} VLAD returned to you.</span>
          ) : (
            <span className="text-muted">Your stake stays in the prize pool.</span>
          )}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {result.demo ? 'Close demo' : 'Play again'}
        </button>
        {result.txHash ? (
          <a className="link inline-flex items-center gap-1 text-sm" href={explorerTxUrl(result.txHash)} target="_blank" rel="noreferrer">
            Resolve transaction <ExternalIcon />
          </a>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- your open runs (secrets in this browser)

function MyRuns({ excludeId, onResolved }: { excludeId: bigint | undefined; onResolved: (r: FightResult) => void }) {
  const { address } = useConnection()
  usePendingRecovery(address)
  const ids = useStoredRunIds(address).filter((id) => id !== excludeId)
  const runsQ = useReadContracts({
    contracts: ids.map((id) => ({ ...arenaContract, functionName: 'getRun', args: [id] }) as const),
    query: { enabled: DEPLOYED && !!address && ids.length > 0, refetchInterval: 12_000 },
  })
  const block = useBlockNumber({ chainId: CHAIN_ID, query: { enabled: DEPLOYED && ids.length > 0, refetchInterval: 4_000 } })

  const rows = ids
    .map((id, i) => ({ id, run: runsQ.data?.[i]?.result as Run | undefined }))
    .filter((r): r is { id: bigint; run: Run } => !!r.run && sameAddress(r.run.player, address))

  // Resolved runs (for example resolved from another tab) no longer need their secret.
  useEffect(() => {
    if (!address) return
    for (const { id, run } of rows) if (run.resolved) forgetSecret(address, id)
  }, [address, rows])

  const open = rows.filter((r) => !r.run.resolved)

  return (
    <div className="card p-4 sm:p-6">
      <p className="eyebrow">Your open runs</p>
      <h3 className="mt-1.5 text-lg font-semibold">Waiting for a reveal</h3>
      {!address ? (
        <p className="mt-3 text-sm text-muted">Connect your wallet to see runs entered from this browser.</p>
      ) : open.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No open runs. Runs you enter show up here until you resolve them.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {open.map(({ id, run }) => (
            <OpenRunRow key={id.toString()} id={id} run={run} current={block.data} account={address} onResolved={onResolved} />
          ))}
        </ul>
      )}
      {address ? <RestoreForm account={address} /> : null}
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
  run: Run
  current: bigint | undefined
  account: Address
  onResolved: (r: FightResult) => void
}) {
  const secret = loadSecret(account, id)
  const handleConfirmed = useResolveHandler({ id, item: run.item }, onResolved)
  const first = firstResolveBlock(run.enterBlock)
  const last = lastResolveBlock(run.enterBlock)
  const expired = current !== undefined && current > last
  const ready = current !== undefined && current >= first && !expired

  return (
    <li className="rounded-2xl border border-border bg-surface/50 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-mono text-sm">
          #{id.toString()} · {ITEM_NAMES[run.item]} · {formatToken(run.stake)} VLAD
        </span>
        <span className={`text-xs ${expired ? 'text-danger' : ready ? 'text-accent-2' : 'text-muted'}`}>
          {expired ? 'Forfeited' : ready ? `Ready · until #${last.toString()}` : `Sealing · ready at #${first.toString()}`}
        </span>
      </div>
      {expired ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">The reveal window closed at block {last.toString()}. The stake stayed in the pool.</p>
          <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" onClick={() => forgetSecret(account, id)}>
            Dismiss
          </button>
        </div>
      ) : secret ? (
        <div className="mt-3">
          <TxButton
            request={{ address: addresses.arena, abi: arenaWriteAbi, functionName: 'resolve', args: [id, secret] }}
            disabled={!ready}
            errorMessages={ARENA_ERRORS}
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

/** Restores a run's secret from a backup (for example after clearing site data or on another device). */
function RestoreForm({ account }: { account: Address }) {
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const [runId, setRunId] = useState('')
  const [secret, setSecret] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  const [busy, setBusy] = useState(false)

  async function restore(e: FormEvent) {
    e.preventDefault()
    setMessage(undefined)
    const s = secret.trim()
    if (!/^\d+$/.test(runId.trim()) || !isBytes32(s)) {
      setMessage({ ok: false, text: 'Enter a run number and a 0x-prefixed 32-byte secret (66 characters).' })
      return
    }
    if (!publicClient || !DEPLOYED) return
    setBusy(true)
    try {
      const id = BigInt(runId.trim())
      const run = (await publicClient.readContract({
        address: addresses.arena,
        abi: stellarArenaAbi,
        functionName: 'getRun',
        args: [id],
      })) as Run
      if (!sameAddress(run.player, account)) throw new Error(`Run #${id} was not entered by the connected wallet.`)
      if (run.resolved) throw new Error(`Run #${id} is already resolved.`)
      if (commitmentOf(s, account).toLowerCase() !== run.commit.toLowerCase()) {
        throw new Error("This secret does not match the run's commitment.")
      }
      saveSecret(account, id, s)
      setMessage({ ok: true, text: `Secret restored. Run #${id} is listed above.` })
      setRunId('')
      setSecret('')
    } catch (err) {
      setMessage({ ok: false, text: describeError(err, ARENA_ERRORS) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="group mt-5 border-t border-border pt-4">
      <summary className="cursor-pointer list-none text-sm text-accent-2 marker:hidden">
        <span className="inline-flex items-center gap-1.5">
          <ArrowIcon size={14} className="transition group-open:rotate-90" /> Restore a run from a backed-up secret
        </span>
      </summary>
      <form className="mt-3 space-y-2" onSubmit={restore}>
        <div className="flex gap-2">
          <input
            className="h-10 w-24 shrink-0 rounded-xl border border-border bg-bg/70 px-3 font-mono text-sm outline-none focus:border-accent-2/60"
            placeholder="Run #"
            inputMode="numeric"
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            aria-label="Run number"
          />
          <input
            className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-bg/70 px-3 font-mono text-sm outline-none focus:border-accent-2/60"
            placeholder="0x… secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            aria-label="Secret"
            spellCheck={false}
          />
        </div>
        <button type="submit" className="btn btn-ghost w-full" disabled={busy || !DEPLOYED}>
          {busy ? <Spinner /> : null} Check and restore
        </button>
        {message ? <p className={`text-sm ${message.ok ? 'text-accent-2' : 'text-danger'}`}>{message.text}</p> : null}
      </form>
    </details>
  )
}

/**
 * If a tab closed between sending `enter` and reading its receipt, the "pending" entry still holds the
 * secret. Scan the runs from the expected id onward for this account's commitment and store the secret
 * under the real id. Gives up 50 runs later.
 */
function usePendingRecovery(account: Address | undefined) {
  const pending = usePendingEntry(account)
  const next = useReadContract({
    ...arenaContract,
    functionName: 'nextRunId',
    query: { enabled: DEPLOYED && !!pending, refetchInterval: 8_000 },
  })
  const expected = pending ? BigInt(pending.expectedId) : undefined
  const scanIds = useMemo(() => {
    const ids: bigint[] = []
    if (expected === undefined || next.data === undefined) return ids
    const end = next.data < expected + 50n ? next.data : expected + 50n
    for (let id = expected; id < end; id++) ids.push(id)
    return ids
  }, [expected, next.data])
  const scan = useReadContracts({
    contracts: scanIds.map((id) => ({ ...arenaContract, functionName: 'getRun', args: [id] }) as const),
    query: { enabled: scanIds.length > 0 },
  })

  useEffect(() => {
    if (!account || !pending || expected === undefined || !scan.data) return
    const index = scan.data.findIndex((r) => {
      const run = r.result as Run | undefined
      return !!run && sameAddress(run.player, account) && run.commit.toLowerCase() === pending.commit.toLowerCase()
    })
    if (index >= 0) {
      const id = scanIds[index]
      saveSecret(account, id, pending.secret)
      if (id !== expected) forgetSecret(account, expected)
      clearPending(account)
    } else if (next.data !== undefined && next.data > expected + 50n) {
      clearPending(account)
    }
  }, [account, pending, expected, scanIds, scan.data, next.data])
}

// ---------------------------------------------------------------- rules

function RulesCard({
  entryFee,
  winBps,
  onShowFairness,
}: {
  entryFee: bigint | undefined
  winBps: bigint | undefined
  onShowFairness: () => void
}) {
  const fee = entryFee !== undefined ? formatToken(entryFee) : '10'
  const mult = winBps !== undefined ? formatMultiplier(winBps) : '1.8×'
  const rules = [
    ['Stake', `${fee} VLAD per run, held by the contract until the run is resolved.`],
    ['Roll', 'You and the shadow each roll 1 to 100. The higher roll wins; a tie goes to the shadow.'],
    ['Win', `${mult} the stake, paid from the prize pool, plus a Trophy (ERC-1155).`],
    ['Items', 'Sword adds 10 to your roll. Shield returns 50% of the stake on a loss. Items burn on entry.'],
    ['Reveal', 'Resolve from block enterBlock + 2 through enterBlock + 251 (about 50 minutes).'],
  ] as const
  return (
    <div className="card p-4 sm:p-6">
      <p className="eyebrow">House rules</p>
      <h3 className="mt-1.5 text-lg font-semibold">Everything is at stake</h3>
      <dl className="mt-4 space-y-3 text-sm">
        {rules.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[4.5rem_1fr] gap-3">
            <dt className="font-mono text-xs uppercase tracking-wider text-accent-2">{k}</dt>
            <dd className="text-muted">{v}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="link mt-4 inline-flex items-center gap-1.5 text-sm" onClick={onShowFairness}>
        How fairness works <ArrowIcon size={14} />
      </button>
    </div>
  )
}
