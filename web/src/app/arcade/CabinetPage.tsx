import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type ReactNode } from 'react'
import { parseEventLogs, type Abi } from 'viem'
import { useConnection, usePublicClient, useReadContract, useReadContracts, useWriteContract } from 'wagmi'
import { stellarArcadeAbi } from '../../abi'
import { CHAIN_ID, addresses } from '../../config/addresses'
import { COMMON_ERRORS_ABI, describeError } from '../../shell/errors'
import { explorerTxUrl, formatToken } from '../../shell/format'
import { ArrowIcon, CheckIcon, ExternalIcon, Spinner } from '../../shell/icons'
import { NetworkGate } from '../../shell/NetworkGate'
import { getSite } from '../../shell/sites'
import { TxButton } from '../../shell/TxButton'
import { useVladBalance } from '../../shell/useVladBalance'
import { commitmentOf, newSecret, storeContract, tokenContract } from '../arena'
import { FistIcon, ShieldIcon, SwordIcon, TrophyIcon } from '../art'
import {
  ARCADE_DEPLOYED,
  ARCADE_ERRORS,
  GENRE_COLOR,
  KIND,
  KIND_RULE,
  LANES,
  NO_ITEM,
  OUTCOME,
  SHIELD,
  SWORD,
  arcadeSecrets,
  arcadeWriteAbi,
  computeOutcome,
  describeResult,
  expectedReturn,
  formatBps,
  formatChance,
  isWin,
  oddsFor,
  swordAllowed,
  type ArcadeResult,
  type Cabinet,
  type GameRules,
} from './arcade'
import { ArcadeStage } from './ArcadeStage'
import { ActiveRunPanel, ArcadeOpenRuns, type ActiveArcadeRun } from './ArcadeRuns'
import { sameAddress } from './hooks'
import { CabinetIcon } from './CabinetIcon'

const APPROVE_RUNS = 10n

export function CabinetPage({
  cabinet,
  rules,
  cabinetStats,
  active,
  setActive,
  result,
  setResult,
  onBack,
}: {
  cabinet: Cabinet
  rules: GameRules
  cabinetStats?: { runs: bigint; wins: bigint }
  active: ActiveArcadeRun | null
  setActive: (run: ActiveArcadeRun | null) => void
  result: ArcadeResult | null
  setResult: (r: ArcadeResult | null) => void
  onBack: () => void
}) {
  const [item, setItem] = useState<number>(NO_ITEM)
  const [lane, setLane] = useState(0)
  const [showResult, setShowResult] = useState(false)
  const accent = GENRE_COLOR[cabinet.genre]
  const kindName = cabinet.kind
  const onResolved = useCallback(
    (r: ArcadeResult) => {
      if (!r.demo && active && active.id === r.runId) setActive(null)
      setShowResult(false)
      setResult(r)
    },
    [active, setActive, setResult],
  )
  const onFinished = useCallback(() => setShowResult(true), [])
  const myActive = active && active.gameId === cabinet.id ? active : null
  const stageResult = result && result.gameId === cabinet.id ? result : null

  function demo() {
    const random = () => newSecret()
    const choice = rules.kind === KIND.RACE ? lane : 0
    const usable = item === SWORD && !swordAllowed(rules.kind) ? NO_ITEM : item
    const o = computeOutcome(rules, random(), random(), usable, choice)
    const payout = (rules.entryFee * BigInt(o.payoutBps)) / 10_000n
    onResolved({ runId: 0n, gameId: cabinet.id, kind: rules.kind, ...o, payout, item: usable, choice, winChancePct: rules.winChancePct, demo: true })
  }

  return (
    <div className="space-y-6">
      <button type="button" className="link inline-flex items-center gap-1.5 text-sm" onClick={onBack}>
        <ArrowIcon size={14} className="rotate-180" /> All cabinets
      </button>

      <div className="card flex flex-wrap items-center gap-4 p-4 sm:p-6">
        <span
          className="grid size-16 shrink-0 place-items-center rounded-2xl border bg-bg/60"
          style={{ borderColor: `${accent}66`, boxShadow: `0 0 28px -10px ${accent}` }}
        >
          <CabinetIcon kind={rules.kind} color={accent} size={44} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">
            Cabinet #{cabinet.id} · <span style={{ color: accent }}>{cabinet.genre}</span>
          </p>
          <h2 className="mt-1 text-2xl font-semibold sm:text-3xl">{cabinet.name}</h2>
          <p className="mt-1 text-sm text-muted">
            Inspired by{' '}
            <a className="link inline-flex items-center gap-1" href={cabinet.inspiredBy.url} target="_blank" rel="noreferrer">
              {cabinet.inspiredBy.title} <ExternalIcon />
            </a>
            {cabinet.note ? <span> · {cabinet.note}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <KindBadge kind={kindName} />
          <span className="chip font-mono text-xs">{formatToken(rules.entryFee)} VLAD / run</span>
          {cabinetStats ? (
            <span className="chip font-mono text-xs">
              {cabinetStats.runs.toString()} runs · {cabinetStats.wins.toString()} wins
            </span>
          ) : null}
          {!rules.active ? <span className="chip border-warning/40 text-xs text-warning">closed</span> : null}
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="card min-w-0 space-y-5 p-4 sm:p-6">
          <ArcadeStage kind={rules.kind} result={stageResult} lane={lane} onFinished={onFinished} />
          {stageResult && showResult ? <ResultBanner result={stageResult} onClose={() => setResult(null)} /> : null}
          {!stageResult ? (
            <button type="button" className="link -mt-2 text-xs" onClick={demo}>
              Watch a demo round (off-chain, nothing staked)
            </button>
          ) : null}

          {myActive ? (
            <NetworkGate connectMessage="Reconnect the wallet that entered this run to resolve it.">
              <ActiveRunPanel run={myActive} onResolved={onResolved} onDismiss={() => setActive(null)} />
            </NetworkGate>
          ) : (
            <>
              <EquipmentPicker kind={rules.kind} value={item} onChange={setItem} />
              {rules.kind === KIND.RACE ? <LanePicker value={lane} onChange={setLane} /> : null}
              <NetworkGate connectMessage="Connect MetaMask to play this cabinet.">
                <EnterSteps cabinet={cabinet} rules={rules} item={item} lane={lane} onEntered={setActive} />
              </NetworkGate>
            </>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <OddsCard rules={rules} item={item} />
          <EquipmentCard kind={rules.kind} />
          <div className="card p-4 sm:p-6">
            <p className="eyebrow">Your open runs here</p>
            <div className="mt-3">
              <ArcadeOpenRuns
                gameId={cabinet.id}
                excludeId={myActive?.id}
                onResolved={onResolved}
                emptyText="No open runs on this cabinet from this browser."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function KindBadge({ kind, compact }: { kind: keyof typeof KIND_RULE; compact?: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent-2/30 bg-accent/10 px-2.5 py-1 text-xs">
      <span className="font-mono font-semibold tracking-wider text-accent-2">{kind}</span>
      {compact ? null : <span className="truncate text-text/80">{KIND_RULE[kind]}</span>}
    </span>
  )
}

function useOwnedItems() {
  const { address } = useConnection()
  const owned = useReadContracts({
    contracts: address
      ? [
          { ...storeContract, functionName: 'balanceOf', args: [address, BigInt(SWORD)] },
          { ...storeContract, functionName: 'balanceOf', args: [address, BigInt(SHIELD)] },
        ]
      : [],
    query: { enabled: !!address },
  })
  return {
    swords: address ? (owned.data?.[0]?.result as bigint | undefined) : undefined,
    shields: address ? (owned.data?.[1]?.result as bigint | undefined) : undefined,
  }
}

function EquipmentPicker({ kind, value, onChange }: { kind: number; value: number; onChange: (item: number) => void }) {
  const { swords, shields } = useOwnedItems()
  const storeUrl = getSite('store').url
  const options = [
    { id: NO_ITEM, name: 'No item', effect: 'Play bare.', Icon: FistIcon, count: undefined, allowed: true },
    {
      id: SWORD,
      name: 'Sword',
      effect: swordAllowed(kind) ? '+10 points of win chance.' : 'Only on DUEL and EXTRACT.',
      Icon: SwordIcon,
      count: swords,
      allowed: swordAllowed(kind),
    },
    { id: SHIELD, name: 'Shield', effect: '50% of the stake back on a loss.', Icon: ShieldIcon, count: shields, allowed: true },
  ]
  const selected = options.find((o) => o.id === value && o.allowed && (o.count === undefined || o.count > 0n)) ? value : NO_ITEM
  return (
    <fieldset>
      <legend className="eyebrow">Equipment · burned on entry</legend>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {options.map(({ id, name, effect, Icon, count, allowed }) => {
          const disabled = !allowed || (id !== NO_ITEM && count === 0n)
          const isOn = selected === id
          return (
            <label
              key={id}
              className={`flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-2xl border p-2.5 text-left transition sm:p-3 ${
                isOn ? 'border-accent-2/70 bg-accent/10' : 'border-border bg-surface/50 hover:border-accent-2/40'
              } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <input type="radio" name="arcade-item" className="sr-only" checked={isOn} disabled={disabled} onChange={() => onChange(id)} />
              <span className={isOn ? 'text-lime' : 'text-accent-2'}>
                <Icon size={20} />
              </span>
              <span className="font-display text-sm font-semibold">{name}</span>
              <span className="text-[0.7rem] leading-snug text-muted">{effect}</span>
              {id !== NO_ITEM && allowed ? (
                count === undefined ? (
                  <span className="font-mono text-[0.7rem] text-muted">you own —</span>
                ) : count > 0n ? (
                  <span className="font-mono text-[0.7rem] text-accent-2">you own {count.toString()}</span>
                ) : (
                  <a className="link font-mono text-[0.7rem]" href={storeUrl}>
                    get one →
                  </a>
                )
              ) : null}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function LanePicker({ value, onChange }: { value: number; onChange: (lane: number) => void }) {
  return (
    <fieldset>
      <legend className="eyebrow">Your lane · one of four wins</legend>
      <div className="mt-3 grid grid-cols-4 gap-2" role="radiogroup">
        {Array.from({ length: LANES }, (_, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            className={`h-11 rounded-xl border font-mono text-sm font-semibold transition ${
              value === i ? 'border-lime/60 bg-lime/10 text-lime' : 'border-border bg-surface/50 text-muted hover:text-text'
            }`}
            onClick={() => onChange(i)}
          >
            Lane {i + 1}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

type Phase = 'idle' | 'preparing' | 'checking' | 'signing' | 'mining'

function EnterSteps({
  cabinet,
  rules,
  item,
  lane,
  onEntered,
}: {
  cabinet: Cabinet
  rules: GameRules
  item: number
  lane: number
  onEntered: (run: ActiveArcadeRun) => void
}) {
  const { address } = useConnection()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const queryClient = useQueryClient()
  const write = useWriteContract()
  const { balance } = useVladBalance()
  const { swords, shields } = useOwnedItems()
  const [phase, setPhase] = useState<Phase>('idle')
  const [hash, setHash] = useState<`0x${string}`>()
  const [error, setError] = useState<string>()

  const usableItem =
    (item === SWORD && (!swordAllowed(rules.kind) || swords === 0n)) || (item === SHIELD && shields === 0n) ? NO_ITEM : item
  const choice = rules.kind === KIND.RACE ? lane : 0
  const fee = rules.entryFee
  const allowanceQ = useReadContract({
    ...tokenContract,
    functionName: 'allowance',
    args: address ? [address, addresses.arcade] : undefined,
    query: { enabled: ARCADE_DEPLOYED && !!address },
  })
  const allowance = allowanceQ.data
  const needsApproval = allowance !== undefined && allowance < fee
  const tooPoor = balance !== undefined && balance < fee

  async function enter() {
    if (!address || !publicClient) return
    setError(undefined)
    setHash(undefined)
    let sent: `0x${string}` | undefined
    let expectedId: bigint | undefined
    try {
      setPhase('preparing')
      const secret = newSecret()
      const commit = commitmentOf(secret, address)
      const [onChainCommit, nextId] = await Promise.all([
        publicClient.readContract({ address: addresses.arcade, abi: stellarArcadeAbi, functionName: 'commitmentOf', args: [secret, address] }),
        publicClient.readContract({ address: addresses.arcade, abi: stellarArcadeAbi, functionName: 'nextRunId' }),
      ])
      if (onChainCommit.toLowerCase() !== commit.toLowerCase()) {
        throw new Error('The commitment computed in the browser does not match commitmentOf() on-chain. Nothing was sent.')
      }
      expectedId = nextId
      arcadeSecrets.saveSecret(address, nextId, secret)
      arcadeSecrets.savePending(address, {
        secret,
        commit,
        expectedId: nextId.toString(),
        item: usableItem,
        savedAt: Date.now(),
        gameId: cabinet.id,
        choice,
      })

      setPhase('checking')
      const args = [BigInt(cabinet.id), commit, usableItem, choice] as const
      await publicClient.simulateContract({
        address: addresses.arcade,
        abi: [...arcadeWriteAbi, ...COMMON_ERRORS_ABI] as Abi,
        functionName: 'enter',
        args,
        account: address,
      })
      setPhase('signing')
      sent = await write.mutateAsync({ address: addresses.arcade, abi: stellarArcadeAbi, functionName: 'enter', args, chainId: CHAIN_ID })
      setHash(sent)
      setPhase('mining')
      const receipt = await publicClient.waitForTransactionReceipt({ hash: sent })
      if (receipt.status !== 'success') throw new Error('The enter transaction reverted on-chain.')
      const entered = parseEventLogs({ abi: stellarArcadeAbi, eventName: 'Entered', logs: receipt.logs }).find((log) =>
        sameAddress(log.args.player, address),
      )
      const id = entered?.args.id ?? nextId
      if (id !== nextId) {
        arcadeSecrets.saveSecret(address, id, secret)
        arcadeSecrets.forgetSecret(address, nextId)
      }
      arcadeSecrets.clearPending(address)
      void queryClient.invalidateQueries()
      onEntered({
        id,
        gameId: cabinet.id,
        kind: rules.kind,
        secret,
        enterBlock: entered?.args.enterBlock ?? receipt.blockNumber,
        item: usableItem,
        choice,
        winChancePct: rules.winChancePct,
        txHash: sent,
      })
    } catch (e) {
      if (!sent && expectedId !== undefined) {
        arcadeSecrets.forgetSecret(address, expectedId)
        arcadeSecrets.clearPending(address)
      }
      setError(describeError(e, ARCADE_ERRORS))
    } finally {
      setPhase('idle')
    }
  }

  const busy = phase !== 'idle'
  const label = {
    idle: `Enter ${cabinet.name} · ${formatToken(fee)} VLAD`,
    preparing: 'Sealing your secret…',
    checking: 'Checking…',
    signing: 'Confirm in wallet…',
    mining: 'Entering…',
  }[phase]

  return (
    <div className="space-y-3">
      <Step n={1} done={!needsApproval && allowance !== undefined} title="Approve VLAD for the Arcade">
        {needsApproval ? (
          <TxButton
            request={{ address: addresses.vladToken, abi: tokenContract.abi, functionName: 'approve', args: [addresses.arcade, fee * APPROVE_RUNS] }}
            errorMessages={ARCADE_ERRORS}
            className="w-full sm:w-auto"
          >
            Approve {formatToken(fee * APPROVE_RUNS)} VLAD ({APPROVE_RUNS.toString()} runs)
          </TxButton>
        ) : (
          <p className="text-sm text-muted">
            {!ARCADE_DEPLOYED
              ? 'Available once the Arcade is deployed.'
              : allowance === undefined
                ? 'The Arcade needs an allowance to take the entry fee.'
                : `Allowance covers ${(allowance / fee).toString()} run(s).`}
          </p>
        )}
      </Step>
      <Step n={2} done={false} title={rules.kind === KIND.RACE ? `Enter on lane ${lane + 1}` : 'Enter the cabinet'}>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="btn btn-primary h-13 w-full text-base"
            disabled={!ARCADE_DEPLOYED || !rules.active || busy || needsApproval || tooPoor}
            aria-busy={busy}
            onClick={enter}
          >
            {busy ? <Spinner /> : null}
            {label}
          </button>
          {tooPoor ? <p className="text-sm text-warning">You need at least {formatToken(fee)} VLAD to enter.</p> : null}
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
            Your browser creates a random 32-byte secret and sends only its hash. Wait two blocks, then reveal it with
            Resolve. The secret is saved in this browser before the transaction is sent.
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

function OddsCard({ rules, item }: { rules: GameRules; item: number }) {
  const usable = item === SWORD && !swordAllowed(rules.kind) ? NO_ITEM : item
  const rows = oddsFor(rules, usable)
  const ret = expectedReturn(rows)
  const plain = expectedReturn(oddsFor(rules))
  return (
    <div className="card p-4 sm:p-6">
      <p className="eyebrow">Odds and payouts</p>
      <table className="mt-3 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted">
            <th className="py-1.5 pr-2 font-medium">Outcome</th>
            <th className="py-1.5 pr-2 font-medium">When</th>
            <th className="py-1.5 pr-2 text-right font-medium">Chance</th>
            <th className="py-1.5 text-right font-medium">Pays</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.outcome} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-2 font-mono text-xs font-semibold text-accent-2">{r.outcome}</td>
              <td className="py-2 pr-2 text-xs text-muted">{r.when}</td>
              <td className="py-2 pr-2 text-right font-mono text-xs">{formatChance(r.chance)}</td>
              <td className="py-2 text-right font-mono text-xs">
                {r.payoutBps ? (
                  <>
                    {formatBps(r.payoutBps)}
                    <span className="block text-[0.65rem] text-muted">{formatToken((rules.entryFee * BigInt(r.payoutBps)) / 10_000n)} VLAD</span>
                  </>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted">
        Expected return without items: <span className="font-mono text-text">{plain.toFixed(3)}</span> per VLAD (house edge{' '}
        {((1 - plain) * 100).toFixed(1)}%).
        {usable !== NO_ITEM ? (
          <>
            {' '}
            With the {usable === SWORD ? 'Sword' : 'Shield'}: <span className="font-mono text-text">{ret.toFixed(3)}</span>, before
            the item&apos;s price.
          </>
        ) : null}
      </p>
    </div>
  )
}

function EquipmentCard({ kind }: { kind: number }) {
  const rows = [
    { Icon: SwordIcon, name: 'Sword', text: swordAllowed(kind) ? '+10 points of win chance on this cabinet.' : 'Not accepted on this cabinet (DUEL and EXTRACT only).' },
    { Icon: ShieldIcon, name: 'Shield', text: 'Returns 50% of the stake on a LOSE. A REFUND already returns everything.' },
    { Icon: TrophyIcon, name: 'Trophy', text: 'Minted to you on every WIN and JACKPOT.' },
  ]
  return (
    <div className="card p-4 sm:p-6">
      <p className="eyebrow">Equipment here</p>
      <ul className="mt-3 space-y-3 text-sm">
        {rows.map(({ Icon, name, text }) => (
          <li key={name} className="flex gap-3">
            <span className="mt-0.5 text-accent-2">
              <Icon size={18} />
            </span>
            <span className="min-w-0 text-muted">
              <span className="font-semibold text-text">{name}. </span>
              {text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ResultBanner({ result, onClose }: { result: ArcadeResult; onClose: () => void }) {
  const won = isWin(result.outcome)
  const title =
    result.outcome === OUTCOME.JACKPOT ? 'JACKPOT' : won ? 'WON' : result.outcome === OUTCOME.REFUND ? 'REFUND' : 'LOST'
  return (
    <div
      role="status"
      className={`rounded-2xl border p-4 sm:p-5 ${
        won
          ? 'border-lime/50 bg-gradient-to-br from-accent/20 via-accent/10 to-lime/10'
          : result.outcome === OUTCOME.REFUND
            ? 'border-accent-2/40 bg-accent/[0.07]'
            : 'border-danger/35 bg-danger/[0.06]'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-mono text-xs uppercase tracking-[0.3em] ${won ? 'text-lime' : result.outcome === OUTCOME.REFUND ? 'text-accent-2' : 'text-danger'}`}>
            {result.demo ? 'demo round' : `arcade run #${result.runId.toString()}`}
          </p>
          <p className="mt-1 font-display text-3xl font-bold">
            {title}
            {!result.demo && result.payout > 0n ? ` +${formatToken(result.payout)} VLAD` : ''}
          </p>
          <p className="mt-1 text-sm text-muted">{describeResult(result)}</p>
        </div>
        {won && !result.demo ? (
          <span className="chip border-lime/40 text-lime">
            <TrophyIcon size={16} /> Trophy minted
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-muted">
        {result.demo
          ? 'Off-chain preview with a random secret and block hash. Nothing was staked, paid or minted.'
          : result.outcome === OUTCOME.REFUND
            ? 'Your stake was returned in full.'
            : !won && result.payout > 0n
              ? `Shield refund: ${formatToken(result.payout)} VLAD returned.`
              : !won
                ? 'Your stake stays in the Arcade prize pool.'
                : ''}
      </p>
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
