import { useCallback, useEffect, useMemo } from 'react'
import { parseEventLogs, type Address, type Hash } from 'viem'
import { useBlockNumber, useConnection, usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { stellarArcadeAbi } from '../../abi'
import { CHAIN_ID, addresses } from '../../config/addresses'
import { ARCADE_DEPLOYED, arcadeContract, arcadeSecrets, type ArcadeResult, type ArcadeRun } from './arcade'

export const sameAddress = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** After a confirmed `resolve`: read the Resolved event (or the stored run) and hand back the result. */
export function useArcadeResolveHandler(
  run: { id: bigint; gameId: number; kind: number; item: number; choice: number; winChancePct: number },
  onResolved: (r: ArcadeResult) => void,
) {
  const { address } = useConnection()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  return useCallback(
    async (hash: Hash) => {
      if (!publicClient) return
      const receipt = await publicClient.getTransactionReceipt({ hash })
      const event = parseEventLogs({ abi: stellarArcadeAbi, eventName: 'Resolved', logs: receipt.logs }).find(
        (log) => log.args.id === run.id,
      )
      if (event) {
        const { outcome, roll, houseRoll, payout } = event.args
        onResolved({ runId: run.id, gameId: run.gameId, kind: run.kind, outcome, roll, houseRoll, payout, item: run.item, choice: run.choice, winChancePct: run.winChancePct, txHash: hash })
      } else {
        const r = (await publicClient.readContract({
          address: addresses.arcade,
          abi: stellarArcadeAbi,
          functionName: 'getRun',
          args: [run.id],
        })) as ArcadeRun
        onResolved({ runId: run.id, gameId: r.gameId, kind: r.kind, outcome: r.outcome, roll: r.roll, houseRoll: r.houseRoll, payout: r.payout, item: r.item, choice: r.choice, winChancePct: r.winChancePct, txHash: hash })
      }
      if (address) arcadeSecrets.forgetSecret(address, run.id)
    },
    [address, publicClient, run.id, run.gameId, run.kind, run.item, run.choice, run.winChancePct, onResolved],
  )
}

export function useRunClock(id: bigint) {
  const block = useBlockNumber({ chainId: CHAIN_ID, query: { enabled: ARCADE_DEPLOYED, refetchInterval: 4_000 } })
  const can = useReadContract({
    ...arcadeContract,
    functionName: 'canResolve',
    args: [id],
    query: { enabled: ARCADE_DEPLOYED, refetchInterval: 4_000 },
  })
  const [ready, expired] = can.data ?? [false, false]
  return { current: block.data, ready, expired }
}

/**
 * If a tab closed between sending `enter` and reading its receipt, the pending entry still holds the secret.
 * Scan the runs from the expected id onward for this account's commitment and store the secret under the real id.
 */
export function useArcadePendingRecovery(account: Address | undefined) {
  const pending = arcadeSecrets.usePendingEntry(account)
  const next = useReadContract({
    ...arcadeContract,
    functionName: 'nextRunId',
    query: { enabled: ARCADE_DEPLOYED && !!pending, refetchInterval: 8_000 },
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
    contracts: scanIds.map((id) => ({ ...arcadeContract, functionName: 'getRun', args: [id] }) as const),
    query: { enabled: scanIds.length > 0 },
  })
  useEffect(() => {
    if (!account || !pending || expected === undefined || !scan.data) return
    const index = scan.data.findIndex((r) => {
      const run = r.result as ArcadeRun | undefined
      return !!run && sameAddress(run.player, account) && run.commit.toLowerCase() === pending.commit.toLowerCase()
    })
    if (index >= 0) {
      const id = scanIds[index]
      arcadeSecrets.saveSecret(account, id, pending.secret)
      if (id !== expected) arcadeSecrets.forgetSecret(account, expected)
      arcadeSecrets.clearPending(account)
    } else if (next.data !== undefined && next.data > expected + 50n) {
      arcadeSecrets.clearPending(account)
    }
  }, [account, pending, expected, scanIds, scan.data, next.data])
}
