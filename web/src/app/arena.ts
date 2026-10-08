import { encodeAbiParameters, keccak256, toHex, type Abi, type Address, type Hash, type Hex } from 'viem'
import { iStellarStoreAbi, iVladTokenAbi, stellarArenaAbi } from '../abi'
import { CHAIN_ID, addresses } from '../config/addresses'
import type { ErrorMessages } from '../shell/errors'
import { formatToken, isConfiguredAddress } from '../shell/format'

/** All three contracts must be real deployments before the page reads anything. */
export const DEPLOYED =
  isConfiguredAddress(addresses.arena) && isConfiguredAddress(addresses.vladToken) && isConfiguredAddress(addresses.store)

export const arenaContract = { address: addresses.arena, abi: stellarArenaAbi, chainId: CHAIN_ID } as const
export const tokenContract = { address: addresses.vladToken, abi: iVladTokenAbi, chainId: CHAIN_ID } as const
export const storeContract = { address: addresses.store, abi: iStellarStoreAbi, chainId: CHAIN_ID } as const

// Mirrors of the StellarArena constants (token ids match the Stellar Store).
export const NO_ITEM = 0
export const SWORD = 1
export const SHIELD = 2
export const SWORD_BONUS = 10
export const SHIELD_REFUND_BPS = 5_000n
/** Blocks after the hash block (enterBlock + 1) during which `resolve` is still accepted. */
export const REVEAL_WINDOW = 250n
/** Average Sepolia block time, only used to turn block counts into rough minutes. */
export const BLOCK_SECONDS = 12

export const ITEM_NAMES = ['None', 'Sword', 'Shield'] as const

/** `resolve` is accepted from this block (the hash of enterBlock + 1 must be readable)... */
export const firstResolveBlock = (enterBlock: bigint) => enterBlock + 2n
/** ...through this block (inclusive). After it the run is forfeited. */
export const lastResolveBlock = (enterBlock: bigint) => enterBlock + 1n + REVEAL_WINDOW

/** Errors that revert inside the Store (an ERC-1155) during `enter`; merged into the ABI so they decode. */
const STORE_ERRORS_ABI = [
  {
    type: 'error',
    name: 'ERC1155InsufficientBalance',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'balance', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
      { name: 'tokenId', type: 'uint256' },
    ],
  },
] as const satisfies Abi

/** Arena ABI plus the Store errors, for simulation and writes. */
export const arenaWriteAbi = [...stellarArenaAbi, ...STORE_ERRORS_ABI] as const

export const ARENA_ERRORS: ErrorMessages = {
  BadItem: () => 'Unknown item. Pick None, Sword or Shield.',
  NotPlayer: () => 'Only the wallet that entered this run can resolve it.',
  AlreadyResolved: () => 'This run has already been resolved.',
  TooEarly: () => 'Too early. A run can be resolved from block enterBlock + 2, about 24 seconds after entering.',
  Expired: () => 'This run expired: it was not resolved within 251 blocks, so its stake stayed in the prize pool.',
  BadReveal: () => "This secret does not match the run's commitment.",
  ZeroCommit: () => 'The commitment is empty.',
  BadParams: () => 'Invalid parameters: the entry fee must be above 0 and winBps at most 30,000.',
  ERC20InsufficientAllowance: () => 'VLAD allowance too low. Approve VLAD for the arena first.',
  ERC20InsufficientBalance: ([, balance, needed]) =>
    `Not enough VLAD: you hold ${formatToken(balance as bigint)} and the run needs ${formatToken(needed as bigint)}.`,
  ERC1155InsufficientBalance: () => 'You do not own this item. Buy one in the Stellar Store first.',
  AccessControlUnauthorizedAccount: () =>
    'The arena is missing GAME_ROLE on the Stellar Store, so it cannot burn items or mint Trophies.',
}

/** On-chain Run struct as viem decodes `getRun(id)`. */
export type Run = {
  player: Address
  stake: bigint
  enterBlock: bigint
  item: number
  resolved: boolean
  won: boolean
  commit: Hex
  playerRoll: number
  enemyRoll: number
  winBps: number
}

/** Everything the combat stage and the result banner need about one resolved run. */
export type FightResult = {
  id: bigint
  won: boolean
  playerRoll: number
  enemyRoll: number
  payout: bigint
  item: number
  txHash?: Hash
  /** An off-chain preview fight: nothing was staked. */
  demo?: boolean
}

export type RunStatus = 'sealing' | 'ready' | 'expired' | 'won' | 'lost'

/** Status of a run at block `current` (unknown block: treated as still sealing). */
export function runStatus(run: Run, current: bigint | undefined): RunStatus {
  if (run.resolved) return run.won ? 'won' : 'lost'
  if (current === undefined) return 'sealing'
  if (current > lastResolveBlock(run.enterBlock)) return 'expired'
  return current >= firstResolveBlock(run.enterBlock) ? 'ready' : 'sealing'
}

/** Payout the contract pays for a resolved run before the prize-pool cap (the cap rarely applies). */
export function nominalPayout(run: Run): bigint {
  if (!run.resolved) return 0n
  if (run.won) return (run.stake * BigInt(run.winBps)) / 10_000n
  return run.item === SHIELD ? (run.stake * SHIELD_REFUND_BPS) / 10_000n : 0n
}

/** A fresh 32-byte secret from the browser's cryptographic random generator. */
export function newSecret(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

/** Same as StellarArena.commitmentOf: keccak256(abi.encode(secret, player)). */
export function commitmentOf(secret: Hex, player: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }], [secret, player]))
}

/** Same as StellarArena.rollsFor, recomputed in the browser. */
export function computeRolls(secret: Hex, blockHash: Hex, item: number) {
  const seed = BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [secret, blockHash])))
  const playerRoll = Number(seed % 100n) + 1 + (item === SWORD ? SWORD_BONUS : 0)
  const enemyRoll = Number((seed >> 128n) % 100n) + 1
  return { playerRoll, enemyRoll, won: playerRoll > enemyRoll }
}

export const isBytes32 = (value: string): value is Hex => /^0x[0-9a-fA-F]{64}$/.test(value.trim())

/** 18_000 -> "1.8×" */
export function formatMultiplier(winBps: bigint | number | undefined): string {
  if (winBps === undefined) return '—'
  return `${(Number(winBps) / 10_000).toFixed(2).replace(/\.?0+$/, '')}×`
}

/** Rough wall-clock duration of a number of blocks: 125 -> "~25 min". */
export function blocksToMinutes(blocks: bigint): string {
  const minutes = Math.max(0, Math.round((Number(blocks) * BLOCK_SECONDS) / 60))
  return minutes < 1 ? '<1 min' : `~${minutes} min`
}
