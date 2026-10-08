import type { Address } from 'viem'

/** Ethereum Sepolia. */
export const CHAIN_ID = 11155111 as const

/**
 * Deployed contract addresses on Sepolia (see deployments/sepolia.json).
 * `vladToken` comes from Stellar-Faucet, `store` from Stellar-Store, `arena` from this repo's script/Deploy.s.sol.
 * The zero address is a placeholder: the UI shows a "not deployed yet" state and switches reads off.
 */
export const addresses = {
  vladToken: '0x49ba857d553ef219B144b200F41acaf8CB6768E9',
  arena: '0xE79302DAebc28297745afC206553afBeD9d04d60',
  store: '0xc1F24EF5887bD340E0d992e8557A4b6E977f151b',
} as const satisfies Record<string, Address>

/** Contracts listed in the footer, with Blockscout links. */
export const footerContracts: readonly { label: string; address: Address }[] = [
  { label: 'StellarArena', address: addresses.arena },
  { label: 'StellarStore (items)', address: addresses.store },
  { label: 'VladToken ($VLAD)', address: addresses.vladToken },
]
