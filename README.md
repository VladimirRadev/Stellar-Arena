# Stellar Arena — provably fair 'play for keeps' on-chain game (Sepolia)

Stellar Arena is a solo combat game that runs entirely in one smart contract, `StellarArena`, on the Ethereum
Sepolia testnet. Every run is played for keeps: the entry fee is paid in $VLAD (the "Vladimir" ERC-20 token, 18
decimals), any item you bring is burned when you enter, and a win pays VLAD plus a Trophy item. The items (Sword,
Shield, Trophy) are ERC-1155 tokens of the `StellarStore` contract from the Stellar-Store repo.

> "Stellar" is the name of this personal Web3 portfolio suite on Ethereum Sepolia. It is not related to the
> Stellar (XLM) network.

## How a run works and why it is fair

The contract has to produce a random roll that neither the player nor the block producer (the validator that builds
a block) can steer. It combines two inputs, each one controlled by a different party, and fixes each input before
the other one becomes known.

1. **Commit.** Your browser generates a random 32-byte `secret` and keeps it locally. It computes the commitment
   `commit = keccak256(abi.encode(secret, yourAddress))`. The commitment reveals nothing about the secret.
2. **Enter.** You call `enter(commit, item)`. The contract burns the item (if any), takes the entry fee (10 VLAD) into
   escrow, and records the block number of this transaction as `enterBlock`.
3. **Wait one block.** The block `enterBlock + 1` is produced. Its hash, `blockhash(enterBlock + 1)`, did not exist
   when you committed, so you could not choose a secret that wins against it.
4. **Reveal.** From block `enterBlock + 2` onwards you call `resolve(id, secret)`. The contract checks the secret
   against the commitment, then computes `seed = keccak256(abi.encode(secret, blockhash(enterBlock + 1)))` and
   derives both rolls from that seed.

Exact block-timing rule:

| Current block | `resolve` result |
|---|---|
| `enterBlock` or `enterBlock + 1` | reverts with `TooEarly` (the hash of `enterBlock + 1` is not readable yet) |
| `enterBlock + 2` … `enterBlock + 251` | allowed (251 = 1 + `REVEAL_WINDOW` of 250 blocks, about 50 minutes on Sepolia) |
| `enterBlock + 252` and later | reverts with `Expired`; the stake stays in the prize pool |

The window ends at 251 because the EVM only exposes the hashes of the last 256 blocks, so the hash of block
`enterBlock + 1` must still be readable when `resolve` runs. `canResolve(id)` returns `(ready, expired)` for the UI.

**Why the validator cannot bias the result.** The validator that produces block `enterBlock + 1` can influence that
block's hash (for example by changing which transactions it includes). But the seed also depends on your secret, and
the validator only ever sees the commitment, which is a hash. Without the secret, the validator cannot compute which
block hash would make you lose, so changing the hash gains it nothing. The commitment also includes your address,
so nobody can copy your commitment and play with it.

**Why the player cannot abort profitably.** After block `enterBlock + 1` exists, you can compute the outcome before
revealing. If it is a loss, you may choose not to reveal. That does not help you: the entry fee and the item were
already taken at `enter`, and an unrevealed run simply expires with the stake in the pool. Revealing a loss is never
worse than not revealing (with a Shield, revealing returns half the stake). Per-player statistics count a run at
`enter`, so skipping the reveal of a loss does not improve your recorded win rate either.

**Limits.** This scheme assumes the player and the producer of block `enterBlock + 1` are not the same party and do
not collude: a validator that also knows the secret could try many block hashes. This is acceptable for a testnet
arcade game. A production game with real value would use a verifiable random function (for example Chainlink VRF).
Generate a fresh secret for every run; a secret that has already been revealed is public.

**Verify any run yourself.** `rollsFor(secret, blockHash, item)` is a public pure function that applies the exact
roll formula. Take the secret from the `resolve` transaction input and the block hash from any block explorer.

## The roll and the items

- Player roll: `seed % 100 + 1` (1 to 100). Enemy roll: `(seed >> 128) % 100 + 1` (1 to 100).
- You win when your roll is strictly higher than the enemy roll. A tie goes to the enemy.

| Item (store id) | Effect | Exact effect on a 10 VLAD run |
|---|---|---|
| none (0) | — | win probability 49.50% |
| Sword (1) | +10 to your roll (`SWORD_BONUS`) | win probability 59.05%; worth ≈ 1.72 VLAD per run |
| Shield (2) | on a loss, refunds 50% of the stake (`SHIELD_REFUND_BPS = 5000`) | 5 VLAD back on a loss; worth ≈ 2.53 VLAD per run |
| Trophy (3) | awarded (minted) on every win | — |

One item per run. The item is burned at `enter`, whatever the outcome.

## Prize pool economics

- A win pays `stake × winBps / 10_000`. With the defaults (`entryFee = 10 VLAD`, `winBps = 18_000`) a win pays
  18 VLAD, which is 1.8 times the stake.
- With no item the win probability is 49.5%, so the expected return is 0.495 × 1.8 = 0.891 of the stake. The house
  edge is therefore about 10% (10.9% exactly, because ties go to the enemy).
- The payout is capped by the pool balance: if the pool holds less than the payout, the winner receives the whole
  pool. A win always mints the Trophy.
- The pool is refilled from three sources: lost stakes, anyone calling `fundPool(amount)`, and the Stellar Store,
  whose treasury is set to the Arena so that every item purchase in VLAD flows into the prize pool.
- The owner can change `entryFee` and `winBps` (`winBps ≤ 30_000`, `entryFee > 0`) with `setParams`. Every run
  snapshots its stake and `winBps` at `enter`, so a parameter change never alters a run in progress. There is no
  owner withdrawal function: VLAD leaves the pool only as payouts and Shield refunds.

## Web app

Live: **https://vladimirradev.github.io/Stellar-Arena/** (GitHub Pages, deployed by `.github/workflows/pages.yml` on
every push to `main`).

The app in `web/` is a static React page (Vite, React 19, TypeScript, Tailwind CSS 4, wagmi 3, viem 2). It talks to
Sepolia through public RPC endpoints only and connects to MetaMask; there is no backend. The shared Stellar frame
(navigation, wallet button, footer, transaction button) lives in `web/src/shell/` and is identical in all five repos.

- **Play tab.** Prize pool, entry fee, payout multiplier and your own runs, wins and payouts. Pick your equipment
  (none, Sword or Shield; the counts come from the Store's `balanceOf`), approve VLAD once, then enter. The browser
  creates the secret with `crypto.getRandomValues`, checks its commitment against the contract's `commitmentOf`, saves
  the secret in `localStorage` before sending, and shows a "Back up your secret" box. A progress bar follows the
  blocks until the run can be resolved; `resolve` then plays a short canvas fight whose counters land on the on-chain
  rolls. Open runs from this browser are listed with their own Resolve button, expired ones as forfeited, and a run
  can be restored from a backed-up secret.
- **History tab.** The last 50 runs (newest first), a leaderboard by wins over those runs, the fairness explanation,
  and a "Verify a run" tool: enter a resolved run number and it fetches the block hash and the revealed secret, then
  recomputes the rolls in the browser and with the contract's `rollsFor`.

Secrets are stored under `stellar-arena:<chainId>:<arenaAddress>:<account>:<runId>`. Clearing site data before a run
is resolved loses the secret unless you kept the backup.

```bash
cd web
npm install
npm run sync-abi   # after `forge build` in the repo root; copies ABIs into src/abi
npm run dev        # http://localhost:5173/Stellar-Arena/
npm run build
```

After deployment, put the three addresses into `web/src/config/addresses.ts`. While they are zero, the page shows a
"not deployed yet" banner and switches all on-chain reads off.

## Contracts

Full deployment record: [`deployments/sepolia.json`](deployments/sepolia.json).

| Contract | Address (Sepolia) |
|---|---|
| StellarArena | TODO (deployed by `script/Deploy.s.sol`) |
| $VLAD token (Stellar-Faucet) | [`0x49ba857d553ef219B144b200F41acaf8CB6768E9`](https://eth-sepolia.blockscout.com/address/0x49ba857d553ef219B144b200F41acaf8CB6768E9) |
| StellarStore (Stellar-Store) | TODO |

## Development

```bash
forge build
forge test -vv
forge fmt --check
```

Deploy (requires the deployer to hold `DEFAULT_ADMIN_ROLE` on the store and at least 1000 VLAD). The private key is
read from an env file outside the repo and is never printed or committed:

```bash
set -a; source ~/Downloads/Stellar-deployer.env; set +a
VLAD_TOKEN=0x49ba857d553ef219B144b200F41acaf8CB6768E9 STELLAR_STORE=<store address> \
  forge script script/Deploy.s.sol --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast --slow --skip-simulation --priority-gas-price 10000000 --with-gas-price 1000000000 -vvv
```

- `--skip-simulation`: Sepolia currently charges contract creation far more gas than forge's local Cancun simulation,
  so a gas limit taken from the local simulation runs out of gas. Skipping it lets the Sepolia node estimate gas.
- `--slow`: sends one transaction at a time and waits for each receipt. The deployer is an EIP-7702 delegated account,
  and nodes accept only one in-flight transaction from it. If a transaction is rejected with "in-flight transaction
  limit reached for delegated accounts", wait about 20 seconds and rerun the same command with `--resume`.

The script sends five transactions, in this order:

1. create `StellarArena(vlad, store, 10 VLAD entry fee, winBps 18000)`;
2. `store.grantRole(GAME_ROLE, arena)`, so the Arena can burn items and mint Trophies;
3. `store.setTreasury(arena)`, so Store sales flow into the prize pool;
4. `vlad.approve(arena, 1000 VLAD)`;
5. `arena.fundPool(1000 VLAD)`, the initial prize pool.

## Part of the Stellar suite

| Repo | Site |
|---|---|
| [Stellar-Faucet](https://github.com/VladimirRadev/Stellar-Faucet) | https://vladimirradev.github.io/Stellar-Faucet/ |
| [Stellar-LP-Staking](https://github.com/VladimirRadev/Stellar-LP-Staking) | https://vladimirradev.github.io/Stellar-LP-Staking/ |
| [Stellar-Bank](https://github.com/VladimirRadev/Stellar-Bank) | https://vladimirradev.github.io/Stellar-Bank/ |
| [Stellar-Store](https://github.com/VladimirRadev/Stellar-Store) | https://vladimirradev.github.io/Stellar-Store/ |
| [Stellar-Arena](https://github.com/VladimirRadev/Stellar-Arena) | https://vladimirradev.github.io/Stellar-Arena/ |
