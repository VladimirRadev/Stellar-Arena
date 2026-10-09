import { encodeAbiParameters, keccak256, type Abi, type Address, type Hash, type Hex } from 'viem'
import { stellarArcadeAbi } from '../../abi'
import { CHAIN_ID, addresses } from '../../config/addresses'
import type { ErrorMessages } from '../../shell/errors'
import { formatToken, isConfiguredAddress } from '../../shell/format'
import { createSecretStore } from '../secrets'

/** The Arcade needs its own contract plus the shared VLAD token and Store. */
export const ARCADE_DEPLOYED =
  isConfiguredAddress(addresses.arcade) && isConfiguredAddress(addresses.vladToken) && isConfiguredAddress(addresses.store)

export const arcadeContract = { address: addresses.arcade, abi: stellarArcadeAbi, chainId: CHAIN_ID } as const

/** Arcade secrets: separate namespace and contract address, so they never mix with Arena secrets. */
export const arcadeSecrets = createSecretStore('stellar-arcade', addresses.arcade)

// ------------------------------------------------------------------ enums (mirror IStellarArcade)

export const GENRES = ['RPG', 'CARD', 'STRATEGY', 'ACTION', 'SURVIVAL', 'RACING'] as const
export type GenreName = (typeof GENRES)[number]
export const KINDS = ['DUEL', 'TIERS', 'RACE', 'HIGHCARD', 'EXTRACT'] as const
export type KindName = (typeof KINDS)[number]
export const OUTCOMES = ['LOSE', 'REFUND', 'WIN', 'JACKPOT'] as const

export const KIND = { DUEL: 0, TIERS: 1, RACE: 2, HIGHCARD: 3, EXTRACT: 4 } as const
export const OUTCOME = { LOSE: 0, REFUND: 1, WIN: 2, JACKPOT: 3 } as const

// ------------------------------------------------------------------ contract constants (StellarArcade.sol)

export const NO_ITEM = 0
export const SWORD = 1
export const SHIELD = 2
export const SWORD_BONUS = 10
export const SHIELD_REFUND_BPS = 5_000
export const JACKPOT_BPS = 50_000
export const TIERS_JACKPOT_BELOW = 30
export const TIERS_WIN_BELOW = 330
export const TIERS_REFUND_BELOW = 630
export const LANES = 4

/** The rules a cabinet registers (getGame); defaults are what script/DeployArcade.s.sol registers. */
export type GameRules = {
  name: string
  genre: number
  kind: number
  winChancePct: number
  entryFee: bigint
  winBps: number
  active: boolean
}

export const DEFAULT_RULES: Record<KindName, { winChancePct: number; winBps: number }> = {
  DUEL: { winChancePct: 48, winBps: 18_000 },
  TIERS: { winChancePct: 0, winBps: 15_000 },
  RACE: { winChancePct: 0, winBps: 36_000 },
  HIGHCARD: { winChancePct: 0, winBps: 19_000 },
  EXTRACT: { winChancePct: 35, winBps: 26_000 },
}
export const DEFAULT_ENTRY_FEE = 10n * 10n ** 18n

/** One-line rule per kind, shown on the kind badge. */
export const KIND_RULE: Record<KindName, string> = {
  DUEL: "beat the shadow's roll",
  TIERS: 'open the vault: 5× jackpot',
  RACE: 'pick a lane 1 of 4, 3.6×',
  HIGHCARD: 'higher card wins 1.9×',
  EXTRACT: '35% to extract, 2.6×',
}

// ------------------------------------------------------------------ the 29 cabinets (README "The 29 cabinets")

export type Cabinet = {
  id: number
  name: string
  genre: GenreName
  kind: KindName
  inspiredBy: { title: string; url: string }
  note?: string
}

const c = (id: number, name: string, genre: GenreName, kind: KindName, title: string, url: string, note?: string): Cabinet => ({
  id,
  name,
  genre,
  kind,
  inspiredBy: { title, url },
  note,
})

export const CABINETS: readonly Cabinet[] = [
  c(0, 'Axolotl Clash', 'RPG', 'DUEL', 'Axie Infinity', 'https://axieinfinity.com/'),
  c(1, 'Shard Hunt', 'RPG', 'TIERS', 'Illuvium', 'https://illuvium.io/'),
  c(2, 'Pantheon Draw', 'CARD', 'HIGHCARD', 'Gods Unchained', 'https://godsunchained.com/'),
  c(3, 'Voxel Dig', 'STRATEGY', 'TIERS', 'The Sandbox', 'https://www.sandbox.game/'),
  c(4, 'Land Rush', 'RPG', 'RACE', 'Decentraland', 'https://decentraland.org/'),
  c(5, 'Time Raid', 'ACTION', 'DUEL', 'Big Time', 'https://playbigtime.com/'),
  c(6, 'Harvest Moon Run', 'RPG', 'TIERS', 'Pixels', 'https://www.pixels.xyz/'),
  c(7, 'Parallel Draft', 'CARD', 'HIGHCARD', 'Parallel', 'https://parallel.life/'),
  c(8, 'Guardian Dungeon', 'ACTION', 'DUEL', 'Guild of Guardians', 'https://www.guildofguardians.com/'),
  c(9, 'Warp Race', 'STRATEGY', 'RACE', 'Star Atlas', 'https://staratlas.com/'),
  c(10, 'Hooligan Havoc', 'ACTION', 'DUEL', 'My Pet Hooligan', 'https://mypethooligan.com/'),
  c(11, 'Grid Extraction', 'SURVIVAL', 'EXTRACT', 'Off The Grid', 'https://gunzillagames.com/'),
  c(12, 'Portal Summon', 'RPG', 'TIERS', 'Aavegotchi', 'https://aavegotchi.com/'),
  c(13, 'Kitty Breeding', 'CARD', 'TIERS', 'CryptoKitties', 'https://www.cryptokitties.co/', 'jackpot = rare trait'),
  c(14, 'Monster Catch', 'RPG', 'DUEL', 'Chainmonsters', 'https://chainmonsters.com/'),
  c(15, "Alice's Garden", 'STRATEGY', 'TIERS', 'My Neighbor Alice', 'https://www.myneighboralice.com/'),
  c(16, 'Deep Mine', 'ACTION', 'TIERS', 'Mines of Dalarnia', 'https://www.minesofdalarnia.com/'),
  c(17, 'Alien Mining', 'SURVIVAL', 'EXTRACT', 'Alien Worlds', 'https://alienworlds.io/'),
  c(18, 'Splinter Clash', 'CARD', 'HIGHCARD', 'Splinterlands', 'https://splinterlands.com/'),
  c(19, 'Nine Expeditions', 'RPG', 'DUEL', 'Nine Chronicles', 'https://nine-chronicles.com/'),
  c(20, 'Shrapnel Drop', 'ACTION', 'RACE', 'Shrapnel', 'https://www.shrapnel.com/'),
  c(21, 'Aurory Tactics', 'RPG', 'DUEL', 'Aurory', 'https://www.aurory.io/'),
  c(22, 'Beacon Trial', 'RPG', 'DUEL', 'The Beacon', 'https://playthebeacon.com/'),
  c(23, 'Ember Duel', 'RPG', 'DUEL', 'Ember Sword', 'https://embersword.com/'),
  c(24, 'Moonray Clash', 'ACTION', 'DUEL', 'Moonray', 'https://moonray.game/'),
  c(25, 'Mech Sortie', 'ACTION', 'RACE', 'MetalCore', 'https://www.metalcore.gg/'),
  c(26, 'Unicorn Joust', 'STRATEGY', 'DUEL', 'Crypto Unicorns', 'https://www.cryptounicorns.fun/'),
  c(27, 'Mavia Siege', 'STRATEGY', 'TIERS', 'Heroes of Mavia', 'https://www.mavia.game/'),
  c(28, 'Dragon Hatch', 'STRATEGY', 'TIERS', 'Eternal Dragons', 'https://www.eternaldragons.com/'),
]

/** Accent colour per genre (icons, chips, card glow). */
export const GENRE_COLOR: Record<GenreName, string> = {
  RPG: '#34d399',
  CARD: '#a78bfa',
  STRATEGY: '#fbbf24',
  ACTION: '#f87171',
  SURVIVAL: '#22d3ee',
  RACING: '#a3e635',
}

/** Static rules for a cabinet before the contract is deployed. */
export function defaultRules(cab: Cabinet): GameRules {
  const d = DEFAULT_RULES[cab.kind]
  return {
    name: cab.name,
    genre: GENRES.indexOf(cab.genre),
    kind: KIND[cab.kind],
    winChancePct: d.winChancePct,
    entryFee: DEFAULT_ENTRY_FEE,
    winBps: d.winBps,
    active: true,
  }
}

/** Whether a Sword may be used on this kind (the contract reverts with BadItem otherwise). */
export const swordAllowed = (kind: number) => kind === KIND.DUEL || kind === KIND.EXTRACT

// ------------------------------------------------------------------ odds (mirror of StellarArcade._outcome)

export type OddsRow = { outcome: string; when: string; chance: number; payoutBps: number }

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)}%`

/** Outcome table for a cabinet's rules, optionally with the item the player brings. */
export function oddsFor(rules: Pick<GameRules, 'kind' | 'winChancePct' | 'winBps'>, item = NO_ITEM): OddsRow[] {
  const loseBps = item === SHIELD ? SHIELD_REFUND_BPS : 0
  switch (rules.kind) {
    case KIND.DUEL:
    case KIND.EXTRACT: {
      const chance = Math.min(100, rules.winChancePct + (item === SWORD ? SWORD_BONUS : 0))
      return [
        { outcome: 'WIN', when: `roll 0–99 below ${chance}`, chance, payoutBps: rules.winBps },
        { outcome: 'LOSE', when: `roll ${chance} or higher`, chance: 100 - chance, payoutBps: loseBps },
      ]
    }
    case KIND.TIERS:
      return [
        { outcome: 'JACKPOT', when: `roll 0–999 below ${TIERS_JACKPOT_BELOW}`, chance: TIERS_JACKPOT_BELOW / 10, payoutBps: JACKPOT_BPS },
        {
          outcome: 'WIN',
          when: `${TIERS_JACKPOT_BELOW}–${TIERS_WIN_BELOW - 1}`,
          chance: (TIERS_WIN_BELOW - TIERS_JACKPOT_BELOW) / 10,
          payoutBps: rules.winBps,
        },
        {
          outcome: 'REFUND',
          when: `${TIERS_WIN_BELOW}–${TIERS_REFUND_BELOW - 1}`,
          chance: (TIERS_REFUND_BELOW - TIERS_WIN_BELOW) / 10,
          payoutBps: 10_000,
        },
        { outcome: 'LOSE', when: `${TIERS_REFUND_BELOW}–999`, chance: (1000 - TIERS_REFUND_BELOW) / 10, payoutBps: loseBps },
      ]
    case KIND.RACE:
      return [
        { outcome: 'WIN', when: 'the winning lane is yours', chance: 25, payoutBps: rules.winBps },
        { outcome: 'LOSE', when: 'any of the other three lanes', chance: 75, payoutBps: loseBps },
      ]
    default:
      return [
        { outcome: 'WIN', when: 'your rank is higher', chance: (600 / 13), payoutBps: rules.winBps },
        { outcome: 'REFUND', when: 'same rank', chance: 100 / 13, payoutBps: 10_000 },
        { outcome: 'LOSE', when: 'your rank is lower', chance: 600 / 13, payoutBps: loseBps },
      ]
  }
}

/** Expected payout per VLAD staked (1 minus the house edge). */
export const expectedReturn = (rows: OddsRow[]) => rows.reduce((sum, r) => sum + (r.chance / 100) * (r.payoutBps / 10_000), 0)
export const formatChance = pct
export const formatBps = (bps: number) => `${(bps / 10_000).toFixed(2).replace(/\.?0+$/, '')}×`

export type OutcomeResult = { outcome: number; payoutBps: number; roll: number; houseRoll: number }

/** Exactly StellarArcade._outcome, recomputed in the browser. */
export function computeOutcome(
  rules: Pick<GameRules, 'kind' | 'winChancePct' | 'winBps'>,
  secret: Hex,
  blockHash: Hex,
  item: number,
  choice: number,
): OutcomeResult {
  const seed = BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [secret, blockHash])))
  let outcome: number = OUTCOME.LOSE
  let roll = 0
  let houseRoll = 0
  if (rules.kind === KIND.DUEL || rules.kind === KIND.EXTRACT) {
    roll = Number(seed % 100n)
    houseRoll = rules.winChancePct + (item === SWORD ? SWORD_BONUS : 0)
    if (roll < houseRoll) outcome = OUTCOME.WIN
  } else if (rules.kind === KIND.TIERS) {
    roll = Number(seed % 1000n)
    if (roll < TIERS_JACKPOT_BELOW) outcome = OUTCOME.JACKPOT
    else if (roll < TIERS_WIN_BELOW) outcome = OUTCOME.WIN
    else if (roll < TIERS_REFUND_BELOW) outcome = OUTCOME.REFUND
  } else if (rules.kind === KIND.RACE) {
    roll = Number(seed % BigInt(LANES))
    houseRoll = choice
    if (roll === choice) outcome = OUTCOME.WIN
  } else {
    roll = Number(seed % 52n)
    houseRoll = Number((seed >> 64n) % 52n)
    if (roll % 13 > houseRoll % 13) outcome = OUTCOME.WIN
    else if (roll % 13 === houseRoll % 13) outcome = OUTCOME.REFUND
  }
  let payoutBps = 0
  if (outcome === OUTCOME.JACKPOT) payoutBps = JACKPOT_BPS
  else if (outcome === OUTCOME.WIN) payoutBps = rules.winBps
  else if (outcome === OUTCOME.REFUND) payoutBps = 10_000
  else if (item === SHIELD) payoutBps = SHIELD_REFUND_BPS
  return { outcome, payoutBps, roll, houseRoll }
}

// ------------------------------------------------------------------ runs and results

/** On-chain Run struct as viem decodes `getRun(id)`. */
export type ArcadeRun = {
  player: Address
  enterBlock: bigint
  item: number
  choice: number
  outcome: number
  resolved: boolean
  stake: bigint
  payout: bigint
  gameId: number
  kind: number
  winChancePct: number
  winBps: number
  roll: number
  houseRoll: number
  commit: Hex
}

/** What the stage and the result banner need about one resolved arcade run. */
export type ArcadeResult = {
  runId: bigint
  gameId: number
  kind: number
  outcome: number
  roll: number
  houseRoll: number
  payout: bigint
  item: number
  choice: number
  winChancePct: number
  txHash?: Hash
  /** Off-chain preview: nothing was staked. */
  demo?: boolean
}

export const isWin = (outcome: number) => outcome >= OUTCOME.WIN

/** HIGHCARD card 0..51 -> "Q♥" (rank = card % 13 with 0 a two and 12 an ace; suit = card / 13). */
export function cardLabel(card: number) {
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
  const suits = ['♠', '♥', '♦', '♣']
  return { rank: ranks[card % 13], suit: suits[Math.floor(card / 13) % 4], red: Math.floor(card / 13) % 4 === 1 || Math.floor(card / 13) % 4 === 2 }
}

/** Arcade ABI plus the Store's ERC-1155 error, for simulation and writes. */
export const arcadeWriteAbi = [
  ...stellarArcadeAbi,
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

export const ARCADE_ERRORS: ErrorMessages = {
  UnknownGame: () => 'This cabinet does not exist.',
  GameInactive: () => 'This cabinet is closed by the owner right now.',
  BadGame: () => 'Invalid cabinet rules.',
  BadItem: () => 'This item cannot be used here. A Sword works only on DUEL and EXTRACT cabinets.',
  BadChoice: () => 'Pick a lane from 1 to 4.',
  ZeroCommit: () => 'The commitment is empty.',
  NotPlayer: () => 'Only the wallet that entered this run can resolve it.',
  AlreadyResolved: () => 'This run has already been resolved.',
  TooEarly: () => 'Too early. A run can be resolved from block enterBlock + 2, about 24 seconds after entering.',
  Expired: () => 'This run expired: it was not resolved within 251 blocks, so its stake stayed in the prize pool.',
  BadReveal: () => "This secret does not match the run's commitment.",
  BadParams: () => 'Invalid parameters.',
  ERC20InsufficientAllowance: () => 'VLAD allowance too low. Approve VLAD for the Arcade first.',
  ERC20InsufficientBalance: ([, balance, needed]) =>
    `Not enough VLAD: you hold ${formatToken(balance as bigint)} and the run needs ${formatToken(needed as bigint)}.`,
  ERC1155InsufficientBalance: () => 'You do not own this item. Buy one in the Stellar Store first.',
  AccessControlUnauthorizedAccount: () =>
    'The Arcade is missing GAME_ROLE on the Stellar Store, so it cannot burn items or mint Trophies.',
}

export const OUTCOME_STYLE: Record<number, { label: string; className: string }> = {
  [OUTCOME.JACKPOT]: { label: 'Jackpot', className: 'border-warning/50 bg-warning/10 text-warning' },
  [OUTCOME.WIN]: { label: 'Won', className: 'border-lime/40 bg-lime/10 text-lime' },
  [OUTCOME.REFUND]: { label: 'Refund', className: 'border-accent-2/30 bg-accent/10 text-accent-2' },
  [OUTCOME.LOSE]: { label: 'Lost', className: 'border-danger/30 bg-danger/[0.07] text-danger' },
}

/** Short text for the result banner, per kind. */
export function describeResult(r: ArcadeResult): string {
  if (r.kind === KIND.DUEL || r.kind === KIND.EXTRACT) return `You rolled ${r.roll}; a win needed below ${r.houseRoll}.`
  if (r.kind === KIND.TIERS) return `The vault rolled ${r.roll} of 0–999.`
  if (r.kind === KIND.RACE) return `Lane ${r.roll + 1} won; you picked lane ${r.choice + 1}.`
  const a = cardLabel(r.roll)
  const b = cardLabel(r.houseRoll)
  return `Your ${a.rank}${a.suit} against the house ${b.rank}${b.suit}.`
}

