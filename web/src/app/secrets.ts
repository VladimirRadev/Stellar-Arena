import { useMemo, useSyncExternalStore } from 'react'
import type { Address, Hex } from 'viem'
import { CHAIN_ID, addresses } from '../config/addresses'

/*
 * Run secrets live only in this browser's localStorage, namespaced per app AND per contract address,
 * so Arena and Arcade secrets never mix. Key per run:
 *   <app>:<chainId>:<contractAddress>:<account>:<runId>  ->  "0x<secret>"
 * plus one "pending" key per account, written before `enter` is sent and cleared once the
 * run id is confirmed from the Entered event (so a closed tab can still be recovered).
 * The Arena uses app "stellar-arena" (unchanged since launch), the Arcade "stellar-arcade".
 */

export type PendingEntry = {
  secret: Hex
  commit: Hex
  expectedId: string
  item: number
  savedAt: number
  /** Arcade only: the cabinet and the RACE lane. */
  gameId?: number
  choice?: number
}

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

function subscribe(fn: () => void) {
  listeners.add(fn)
  window.addEventListener('storage', fn)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', fn)
  }
}

function parsePending(raw: string | null): PendingEntry | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as PendingEntry
  } catch {
    return undefined
  }
}

/** A secret store bound to one app namespace and one contract address. */
export function createSecretStore(app: string, contract: Address) {
  const prefix = (account: Address) => `${app}:${CHAIN_ID}:${contract.toLowerCase()}:${account.toLowerCase()}:`
  const secretKey = (account: Address, runId: bigint) => `${prefix(account)}${runId.toString()}`
  const pendingKey = (account: Address) => `${prefix(account)}pending`

  /** Run ids (comma-joined, so React can compare snapshots) with a stored secret, newest first. */
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

  return {
    secretKey,
    pendingKey,
    saveSecret: (account: Address, runId: bigint, secret: Hex) => write(secretKey(account, runId), secret),
    forgetSecret: (account: Address, runId: bigint) => write(secretKey(account, runId), null),
    loadSecret: (account: Address, runId: bigint) => (read(secretKey(account, runId)) as Hex | null) ?? undefined,
    savePending: (account: Address, entry: PendingEntry) => write(pendingKey(account), JSON.stringify(entry)),
    clearPending: (account: Address) => write(pendingKey(account), null),

    /** Run ids of `account` that have a secret in this browser, newest first. Re-renders on every change. */
    useStoredRunIds(account: Address | undefined): bigint[] {
      const snapshot = useSyncExternalStore(subscribe, () => storedIdsSnapshot(account))
      return snapshot ? snapshot.split(',').map(BigInt) : []
    },

    /** The pending entry of `account`, re-rendering on change. */
    usePendingEntry(account: Address | undefined): PendingEntry | undefined {
      const raw = useSyncExternalStore(subscribe, () => (account ? read(pendingKey(account)) : null))
      return useMemo(() => parsePending(raw), [raw])
    },
  }
}

export type SecretStore = ReturnType<typeof createSecretStore>

/** The Arena's store (key format unchanged since launch, so existing secrets keep working). */
const arenaSecrets = createSecretStore('stellar-arena', addresses.arena)
export const {
  secretKey,
  pendingKey,
  saveSecret,
  forgetSecret,
  loadSecret,
  savePending,
  clearPending,
  useStoredRunIds,
  usePendingEntry,
} = arenaSecrets
