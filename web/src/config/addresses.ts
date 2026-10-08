import type { Address } from 'viem'

/** Ethereum Sepolia. */
export const CHAIN_ID = 11155111 as const

/**
 * Deployed contract addresses on Sepolia.
 * `vladToken` comes from Stellar-Faucet, `store` from Stellar-Store, `arena` from this repo's script/Deploy.s.sol.
 * The zero address is a placeholder: the UI shows a "not deployed yet" state and switches reads off.
 */
export const addresses = {
  vladToken: '0x49ba857d553ef219B144b200F41acaf8CB6768E9',
  arena: '0x0000000000000000000000000000000000000000',
  store: '0x0000000000000000000000000000000000000000',
} as const satisfies Record<string, Address>

/** Contracts listed in the footer, with Blockscout links. */
export const footerContracts: readonly { label: string; address: Address }[] = [
  { label: 'StellarArena', address: addresses.arena },
  { label: 'StellarStore (items)', address: addresses.store },
  { label: 'VladToken ($VLAD)', address: addresses.vladToken },
]
