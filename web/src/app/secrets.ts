import { useMemo, useSyncExternalStore } from 'react'
import type { Address, Hex } from 'viem'
import { CHAIN_ID, addresses } from '../config/addresses'

/*
 * Run secrets live only in this browser's localStorage. Key per run:
 *   stellar-arena:<chainId>:<arenaAddress>:<account>:<runId>  ->  "0x<secret>"
 * plus one "pending" key per account, written before `enter` is sent and cleared once the
 * run id is confirmed from the Entered event (so a closed tab can still be recovered).
 */
const prefix = (account: Address) =>
  `stellar-arena:${CHAIN_ID}:${addresses.arena.toLowerCase()}:${account.toLowerCase()}:`

export const secretKey = (account: Address, runId: bigint) => `${prefix(account)}${runId.toString()}`
export const pendingKey = (account: Address) => `${prefix(account)}pending`

export type PendingEntry = { secret: Hex; commit: Hex; expectedId: string; item: number; savedAt: number }

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage blocked (private mode): the backup box is then the only copy */
  }
  notify()
}

export const saveSecret = (account: Address, runId: bigint, secret: Hex) => write(secretKey(account, runId), secret)
export const forgetSecret = (account: Address, runId: bigint) => write(secretKey(account, runId), null)
export const loadSecret = (account: Address, runId: bigint) => (read(secretKey(account, runId)) as Hex | null) ?? undefined

export const savePending = (account: Address, entry: PendingEntry) => write(pendingKey(account), JSON.stringify(entry))
export const clearPending = (account: Address) => write(pendingKey(account), null)

/** Run ids (as a comma-joined string, so React can compare snapshots) with a stored secret. */
function storedIdsSnapshot(account: Address | undefined): string {
  if (!account) return ''
  const p = prefix(account)
  const ids: bigint[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(p) && /^\d+$/.test(key.slice(p.length))) ids.push(BigInt(key.slice(p.length)))
    }
  } catch {
    return ''
  }
  return ids
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map(String)
    .join(',')
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  window.addEventListener('storage', fn)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', fn)
  }
}

/** Run ids of `account` that have a secret in this browser, newest first. Re-renders on every change. */
export function useStoredRunIds(account: Address | undefined): bigint[] {
  const snapshot = useSyncExternalStore(subscribe, () => storedIdsSnapshot(account))
  return snapshot ? snapshot.split(',').map(BigInt) : []
}

/** The pending entry of `account`, re-rendering on change. */
export function usePendingEntry(account: Address | undefined): PendingEntry | undefined {
  const raw = useSyncExternalStore(subscribe, () => (account ? read(pendingKey(account)) : null))
  return useMemo(() => {
    if (!raw) return undefined
    try {
      return JSON.parse(raw) as PendingEntry
    } catch {
      return undefined
    }
  }, [raw])
}
