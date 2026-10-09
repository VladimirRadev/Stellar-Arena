# Stellar Arena — provably fair 'play for keeps' on-chain game (Sepolia)

Stellar Arena is a solo combat game that runs entirely in one smart contract, `StellarArena`, on the Ethereum
Sepolia testnet. Every run is played for keeps: the entry fee is paid in $VLAD (the "Vladimir" ERC-20 token, 18
decimals), any item you bring is burned when you enter, and a win pays VLAD plus a Trophy item. The items (Sword,
Shield, Trophy) are ERC-1155 tokens of the `StellarStore` contract from the Stellar-Store repo.

The repo also contains `StellarArcade`, a 29-cabinet arcade that uses the same fairness scheme, the same items and
its own prize pool; see [Arcade (29 cabinets)](#arcade-29-cabinets).

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

## Arcade (29 cabinets)

`StellarArcade` (`src/StellarArcade.sol`) is a second game contract in this repo. It runs 29 small "cabinets" on one
engine. Every cabinet uses the same commit-reveal flow and the same block-timing rule as the Arena, and all cabinets
share one prize pool. It is deployed on Sepolia at [`0x64dc8Df451Da01ab2460584f04C29D2df517ac4b`](https://eth-sepolia.blockscout.com/address/0x64dc8Df451Da01ab2460584f04C29D2df517ac4b)
(verified on Sourcify and Blockscout, deployed 2026-10-09 in block 11876092); the full record is in
[`deployments/sepolia.json`](deployments/sepolia.json).

### How an Arcade run works

1. Your browser generates a random 32-byte `secret` and computes `commit = keccak256(abi.encode(secret, yourAddress))`
   (the same `commitmentOf` as the Arena).
2. You call `enter(gameId, commit, item, choice)`. `gameId` selects the cabinet (0 to 28). `item` is 0 (none),
   1 (Sword) or 2 (Shield); the item is burned through `store.consume`. `choice` is your lane (0 to 3) on RACE
   cabinets and is ignored by the other kinds. The contract takes the cabinet's entry fee (10 VLAD) into escrow and
   records `enterBlock`.
3. From block `enterBlock + 2` through block `enterBlock + 251` you call `resolve(runId, secret)`. Before that it
   reverts with `TooEarly`; after that it reverts with `Expired` and the stake stays in the pool. This is exactly the
   Arena's timing table above; `canResolve(runId)` returns `(ready, expired)`.
4. `resolve` computes `seed = keccak256(abi.encode(secret, blockhash(enterBlock + 1)))`, applies the rule of the
   cabinet's kind (table below), pays the payout in VLAD and, on a WIN or JACKPOT, mints a Trophy through
   `store.award`.

The fairness argument is the Arena's: the player fixes the secret before block `enterBlock + 1` exists, and the
validator that produces that block only ever sees the commitment, never the secret. The same limit applies too: a
player who also produces block `enterBlock + 1` could try many block hashes, so this design is for a testnet arcade,
not for real value (that would need a verifiable random function such as Chainlink VRF).

### The five kinds and their payouts

Every cabinet belongs to one kind. The payout is a multiple of the stake (10 VLAD on every cabinet). "Return" is the
expected payout per VLAD staked without items; the house edge is 1 minus the return.

| Kind | Rule (from `seed`) | Outcomes and probabilities | Payout | Return | House edge |
|---|---|---|---|---|---|
| DUEL | win if `seed % 100 < 48` | WIN 48%, LOSE 52% | WIN 1.8x (18 VLAD) | 0.864 | 13.6% |
| TIERS | `r = seed % 1000` | JACKPOT `r < 30` (3%), WIN `r < 330` (30%), REFUND `r < 630` (30%), LOSE 37% | JACKPOT 5x, WIN 1.5x, REFUND 1x | 0.900 | 10% |
| RACE | winning lane `= seed % 4`, you picked `choice` (must be 0 to 3, else `BadChoice`) | WIN 25%, LOSE 75% | WIN 3.6x (36 VLAD) | 0.900 | 10% |
| HIGHCARD | your card `seed % 52`, house card `(seed >> 64) % 52`, rank `= card % 13` (0 = two, 12 = ace) | higher rank WIN ≈ 46.15% (6/13), same rank REFUND ≈ 7.69% (1/13), lower LOSE ≈ 46.15% | WIN 1.9x, REFUND 1x | ≈ 0.954 | ≈ 4.6% |
| EXTRACT | win if `seed % 100 < 35` | WIN 35%, LOSE 65% | WIN 2.6x (26 VLAD) | 0.910 | 9% |

TIERS return: 0.03 × 5 + 0.30 × 1.5 + 0.30 × 1 = 0.15 + 0.45 + 0.30 = 0.90 per VLAD staked.

**Difference from the original plan.** The plan set the TIERS bands at `r < 20` jackpot (2%), `r < 200` win (18%) and
`r < 450` refund (25%). That returns only 0.10 + 0.27 + 0.25 = 0.62 per VLAD staked, a 38% house edge, far above the
other kinds. The contract uses the rebalanced bands above (`TIERS_JACKPOT_BELOW = 30`, `TIERS_WIN_BELOW = 330`,
`TIERS_REFUND_BELOW = 630`), which bring TIERS to a 0.90 return and a 10% house edge, in line with RACE and EXTRACT.
The multipliers (5x, 1.5x, 1x) are unchanged.

Each cabinet stores its own `winChancePct` (DUEL and EXTRACT only) and `winBps` (the WIN multiplier in basis points),
so the table shows the values the deploy script registers. The TIERS jackpot is fixed at 5x (`JACKPOT_BPS = 50_000`)
in the contract.

### Items in the Arcade

| Item (store id) | Effect in the Arcade | Exact effect on a 10 VLAD run |
|---|---|---|
| Sword (1) | adds 10 points to the win chance; accepted only on DUEL and EXTRACT (`enter` reverts with `BadItem` elsewhere, so a Sword is never burned for nothing) | DUEL 48% → 58%, EXTRACT 35% → 45% |
| Shield (2) | on a LOSE, returns 50% of the stake (`SHIELD_REFUND_BPS = 5000`); a REFUND already returns the full stake, so the Shield adds nothing there | 5 VLAD back on a loss |
| Trophy (3) | minted on every WIN and JACKPOT; not usable as equipment | — |

One item per run, burned at `enter` whatever the outcome. The Store sells the Sword for 25 VLAD and the Shield for
40 VLAD, so on a 10 VLAD run an item is worth less than its price (the largest expected Shield value is
0.75 × 5 = 3.75 VLAD per run, on RACE, where 75% of runs lose).

### Prize pool and administration

- The prize pool is the Arcade's own VLAD balance (`prizePool()`), shared by all 29 cabinets. It is seeded with
  1,000 VLAD at deployment and refilled by lost stakes and by anyone calling `fundPool(amount)`. The Store's treasury
  stays the Arena, so item purchases refill the Arena pool, not the Arcade pool.
- A payout is capped by the pool: if the pool holds less than the payout, the player receives the whole pool (the
  Trophy is still minted).
- The constructor's third argument, `maxEntryFee` (10 VLAD), caps every cabinet's entry fee, so the largest single
  payout is 5 × 10 = 50 VLAD (a TIERS jackpot).
- The owner registers cabinets in one transaction with `addGames(Game[])` and can replace one with `setGame(gameId,
  game)`, which also opens or closes it (`active`). Both validate the rules: a WIN must pay more than 1x and at most
  5x, DUEL and EXTRACT need a win chance of 1 to 90 percent (so a Sword keeps it at most 100), and the other kinds
  must leave the win chance at 0. Every run snapshots the cabinet's kind, win chance and `winBps` at `enter`, so
  `setGame` never changes a run in progress. There is no owner withdrawal function: VLAD leaves the pool only as
  payouts, refunds and Shield returns.
- Statistics: `gameStats(gameId)` and `stats(player)` return `(runs, wins, wagered, paidOut)`. A run counts at
  `enter`, so an unrevealed loss still counts; `wins` counts WIN and JACKPOT; `paidOut` includes refunds and Shield
  returns.

### Verify any Arcade run

`rollsFor(gameId, secret, blockHash, item, choice)` is a public view function that applies the exact formula and
returns `(outcome, payoutBps, roll, houseRoll)`: the outcome (0 LOSE, 1 REFUND, 2 WIN, 3 JACKPOT), the payout in
basis points of the stake before the pool cap (Shield included), and the two numbers behind it (DUEL and EXTRACT:
your d100 roll 0 to 99 and the win threshold; TIERS: the roll 0 to 999; RACE: the winning lane and your lane;
HIGHCARD: your card and the house card, 0 to 51). Take the secret from the `resolve` transaction input and the block
hash from any explorer. `rollsFor` uses the cabinet's current rules; `getRun(runId)` holds the rules the run actually
used, which differ only if `setGame` changed the cabinet after that run's `enter`.

### The 29 cabinets

The cabinet names and all artwork are our own. Each cabinet is inspired by a third-party Web3 game listed in the
"In the wild" section of [ekvahlabs.com](https://ekvahlabs.com/); the links below go to those games' own sites. This
project is not affiliated with any of them.

| id | Cabinet | Genre | Kind | Inspired by |
|---|---|---|---|---|
| 0 | Axolotl Clash | RPG | DUEL | [Axie Infinity](https://axieinfinity.com/) |
| 1 | Shard Hunt | RPG | TIERS | [Illuvium](https://illuvium.io/) |
| 2 | Pantheon Draw | CARD | HIGHCARD | [Gods Unchained](https://godsunchained.com/) |
| 3 | Voxel Dig | STRATEGY | TIERS | [The Sandbox](https://www.sandbox.game/) |
| 4 | Land Rush | RPG | RACE | [Decentraland](https://decentraland.org/) |
| 5 | Time Raid | ACTION | DUEL | [Big Time](https://playbigtime.com/) |
| 6 | Harvest Moon Run | RPG | TIERS | [Pixels](https://www.pixels.xyz/) |
| 7 | Parallel Draft | CARD | HIGHCARD | [Parallel](https://parallel.life/) |
| 8 | Guardian Dungeon | ACTION | DUEL | [Guild of Guardians](https://www.guildofguardians.com/) |
| 9 | Warp Race | STRATEGY | RACE | [Star Atlas](https://staratlas.com/) |
| 10 | Hooligan Havoc | ACTION | DUEL | [My Pet Hooligan](https://mypethooligan.com/) |
| 11 | Grid Extraction | SURVIVAL | EXTRACT | [Off The Grid](https://gunzillagames.com/) |
| 12 | Portal Summon | RPG | TIERS | [Aavegotchi](https://aavegotchi.com/) |
| 13 | Kitty Breeding | CARD | TIERS (jackpot = rare trait) | [CryptoKitties](https://www.cryptokitties.co/) |
| 14 | Monster Catch | RPG | DUEL | [Chainmonsters](https://chainmonsters.com/) |
| 15 | Alice's Garden | STRATEGY | TIERS | [My Neighbor Alice](https://www.myneighboralice.com/) |
| 16 | Deep Mine | ACTION | TIERS | [Mines of Dalarnia](https://www.minesofdalarnia.com/) |
| 17 | Alien Mining | SURVIVAL | EXTRACT | [Alien Worlds](https://alienworlds.io/) |
| 18 | Splinter Clash | CARD | HIGHCARD | [Splinterlands](https://splinterlands.com/) |
| 19 | Nine Expeditions | RPG | DUEL | [Nine Chronicles](https://nine-chronicles.com/) |
| 20 | Shrapnel Drop | ACTION | RACE | [Shrapnel](https://www.shrapnel.com/) |
| 21 | Aurory Tactics | RPG | DUEL | [Aurory](https://www.aurory.io/) |
| 22 | Beacon Trial | RPG | DUEL | [The Beacon](https://playthebeacon.com/) |
| 23 | Ember Duel | RPG | DUEL | [Ember Sword](https://embersword.com/) |
| 24 | Moonray Clash | ACTION | DUEL | [Moonray](https://moonray.game/) |
| 25 | Mech Sortie | ACTION | RACE | [MetalCore](https://www.metalcore.gg/) |
| 26 | Unicorn Joust | STRATEGY | DUEL | [Crypto Unicorns](https://www.cryptounicorns.fun/) |
| 27 | Mavia Siege | STRATEGY | TIERS | [Heroes of Mavia](https://www.mavia.game/) |
| 28 | Dragon Hatch | STRATEGY | TIERS | [Eternal Dragons](https://www.eternaldragons.com/) |

Totals: 11 DUEL, 9 TIERS, 4 RACE, 3 HIGHCARD, 2 EXTRACT. Genre ids in the contract: 0 RPG, 1 CARD, 2 STRATEGY,
3 ACTION, 4 SURVIVAL, 5 RACING (RACING is reserved; no cabinet uses it yet).

### Deploy the Arcade

`script/DeployArcade.s.sol` uses the same env file and flags as the Arena deploy (the deployer must hold
`DEFAULT_ADMIN_ROLE` on the store and at least 1000 VLAD):

```bash
set -a; source ~/Downloads/Stellar-deployer.env; set +a
VLAD_TOKEN=0x49ba857d553ef219B144b200F41acaf8CB6768E9 STELLAR_STORE=0xc1F24EF5887bD340E0d992e8557A4b6E977f151b \
  forge script script/DeployArcade.s.sol --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast --slow --skip-simulation --priority-gas-price 10000000 --with-gas-price 1000000000 -vvv
```

The script sends five transactions, in this order. The hashes and gas figures are from the Sepolia deployment of
2026-10-09 (deployer nonce 37 to 41, all five accepted on the first run, 23,135,869 gas in total, about 0.00023 ETH
at an effective gas price of about 0.01 gwei):

1. create `StellarArcade(vlad, store, maxEntryFee = 10 VLAD)`: [`0x6734d366…`](https://eth-sepolia.blockscout.com/tx/0x6734d366203608d96ca10a11fab6cd39e74b29d54208a23ab4e2a186068419c6), 15,925,068 gas (a local
   simulation estimates about 2.3 M; Sepolia charges contract creation far more, hence `--skip-simulation`);
2. `arcade.addGames(...)` with all 29 cabinets in one call: [`0x01983901…`](https://eth-sepolia.blockscout.com/tx/0x0198390185f0ecb29bb1e96a5ce713aed7a94215e909ad5cda105daa10d5ffef), 6,799,758 gas;
3. `store.grantRole(GAME_ROLE, arcade)`, so the Arcade can burn items and mint Trophies:
   [`0x0a8ddc96…`](https://eth-sepolia.blockscout.com/tx/0x0a8ddc96cb433156261f27f2ea73879d0f7d0802f0f512e3c7c448d517340e70), 133,511 gas;
4. `vlad.approve(arcade, 1000 VLAD)`: [`0x4c41f344…`](https://eth-sepolia.blockscout.com/tx/0x4c41f34491aaf3f9949885e5f8e2d318f8dd4a29c4d9e1ee0c30c2c7aea35f82), 128,328 gas;
5. `arcade.fundPool(1000 VLAD)`, the initial Arcade prize pool: [`0xd7d42e34…`](https://eth-sepolia.blockscout.com/tx/0xd7d42e3491f5550668be6d7e8923fed9e92f2830daeb3211fd4a6597952f73d8), 149,204 gas.

It does not call `store.setTreasury`: the Store's sale proceeds keep flowing to the Arena.

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
| StellarArena | [`0xE79302DAebc28297745afC206553afBeD9d04d60`](https://eth-sepolia.blockscout.com/address/0xE79302DAebc28297745afC206553afBeD9d04d60) |
| StellarArcade (29 cabinets) | [`0x64dc8Df451Da01ab2460584f04C29D2df517ac4b`](https://eth-sepolia.blockscout.com/address/0x64dc8Df451Da01ab2460584f04C29D2df517ac4b) |
| $VLAD token (Stellar-Faucet) | [`0x49ba857d553ef219B144b200F41acaf8CB6768E9`](https://eth-sepolia.blockscout.com/address/0x49ba857d553ef219B144b200F41acaf8CB6768E9) |
| StellarStore (Stellar-Store) | [`0xc1F24EF5887bD340E0d992e8557A4b6E977f151b`](https://eth-sepolia.blockscout.com/address/0xc1F24EF5887bD340E0d992e8557A4b6E977f151b) |

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
VLAD_TOKEN=0x49ba857d553ef219B144b200F41acaf8CB6768E9 STELLAR_STORE=0xc1F24EF5887bD340E0d992e8557A4b6E977f151b \
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

## Smoke tests (2026-10-09)

End-to-end run on Ethereum Sepolia on 2026-10-09 from the deployer `0xEb0243ea72CB24eFb7128Ee7aca314C080b600c4` (an EIP-7702 delegated EOA), with `smoke.sh` (19 steps across the whole suite, one transaction at a time, each waiting for its receipt). After every transaction the script compared balances, reserves and events at the transaction's block with the block before it; "ok" means every such assertion passed. Step numbers are the suite-wide order. Rows for this repo (step 16 is the VLAD approval for the arena; the Sword bought in step 15 is burned on entry):

| Step | Function | Result | Tx (Blockscout) | Gas used |
|---|---|---|---|---|
| 16 | `vlad.approve(arena, 10e18)` | ok | [`0xb4be368c…a909ba`](https://eth-sepolia.blockscout.com/tx/0xb4be368ca67c7d62b7d36cb13c1ffb917d5a0b4e9d49d198fd537212bea909ba) | 128316 |
| 17 | `arena.enter(commit, 1)` | ok | [`0x9f7050bd…f4f350`](https://eth-sepolia.blockscout.com/tx/0x9f7050bdaa053462a97b2937937c7124cb2c998cd3fdb713f0e8123a99f4f350) | 843529 |
| 18 | `arena.resolve(runId, secret)` | ok | [`0xc86df9cc…00a43f`](https://eth-sepolia.blockscout.com/tx/0xc86df9cc5366f62b99e33e6260a2843f410cd34ed82a25bbd84c42f7e300a43f) | 652036 |

- Step 17 arena enter: run #0 entered in block 11876073 with a Sword, stake 10 VLAD
- Step 18 arena resolve: run #0: playerRoll 62 (d100 + 10 Sword bonus) vs enemyRoll 40 -> WON; payout 18 VLAD; hash block 11876074

## Smoke tests (2026-10-09, Phase B)

End-to-end run on Ethereum Sepolia on 2026-10-09 from the deployer `0xEb0243ea72CB24eFb7128Ee7aca314C080b600c4` (an EIP-7702 delegated EOA), with `smoke-b.sh` (9 transactions across StellarArcade, StellarOracle and StellarPredict, one at a time, each waiting for its receipt). After every transaction the script compared balances, events and contract state at the transaction's block with the block before it; "ok" means every such assertion passed. Step numbers are the order in that run. For each resolve the script also recomputed the result itself from `keccak256(abi.encode(secret, blockhash(enterBlock + 1)))` and compared it with `rollsFor` and the `Resolved` event. Rows for the Arcade (`StellarArcade` `0x64dc8Df451Da01ab2460584f04C29D2df517ac4b`; step 1 is the VLAD approval, no item was used):

| Step | Function | Result | Tx (Blockscout) | Gas used |
|---|---|---|---|---|
| 1 | `vlad.approve(arcade, 30e18)` | ok | [`0x017b23db…285d51`](https://eth-sepolia.blockscout.com/tx/0x017b23db00a50d4830500d8b6ae665b67973eb2f0100bf4f5b36548ac4285d51) | 128328 |
| 2 | `arcade.enter(0, commit1, 0, 0)` | ok | [`0x22d16de6…420cc0`](https://eth-sepolia.blockscout.com/tx/0x22d16de69000f735d5ee33f7658cd500baa9c1ef902945aa5b871e36de420cc0) | 1065063 |
| 3 | `arcade.resolve(0, secret1)` | ok | [`0x7515c506…cbb66f`](https://eth-sepolia.blockscout.com/tx/0x7515c506f322d1eebcf58b601fbd108c7a444b89059f85e32e519137f5cbb66f) | 565928 |
| 4 | `arcade.enter(4, commit2, 0, 2)` | ok | [`0x1f126a56…8e0747`](https://eth-sepolia.blockscout.com/tx/0x1f126a56ecc84917aec182d42f5e5512ca7d8fe711bd3d8dac78a74a8b8e0747) | 771347 |
| 5 | `arcade.resolve(1, secret2)` | ok | [`0xe2eb30a2…ea8ddb`](https://eth-sepolia.blockscout.com/tx/0xe2eb30a2a6ab53c9af0fb3956daf5587371bc0f82c63d2e4a267bf34e5ea8ddb) | 370099 |

- Run #0, cabinet 0 "Axolotl Clash" (DUEL, 48% at 1.8x): d100 roll 16 is below the win threshold 48, so WIN; payout 18 VLAD on a 10 VLAD stake and a Trophy minted; hash block 11876182.
- Run #1, cabinet 4 "Land Rush" (RACE, 3.6x, lane 2): the winning lane 2 equals the chosen lane 2, so WIN; payout 36 VLAD on a 10 VLAD stake and a Trophy minted; hash block 11876188.
- Prize pool 1000 -> 966 VLAD (+20 entry fees, -54 payouts). Deployer `stats`: 2 runs, 2 wins, 20 VLAD wagered, 54 VLAD paid out.

## Part of the Stellar suite

| Repo | Site |
|---|---|
| [Stellar-Faucet](https://github.com/VladimirRadev/Stellar-Faucet) | https://vladimirradev.github.io/Stellar-Faucet/ |
| [Stellar-LP-Staking](https://github.com/VladimirRadev/Stellar-LP-Staking) | https://vladimirradev.github.io/Stellar-LP-Staking/ |
| [Stellar-Bank](https://github.com/VladimirRadev/Stellar-Bank) | https://vladimirradev.github.io/Stellar-Bank/ |
| [Stellar-Store](https://github.com/VladimirRadev/Stellar-Store) | https://vladimirradev.github.io/Stellar-Store/ |
| [Stellar-Arena](https://github.com/VladimirRadev/Stellar-Arena) | https://vladimirradev.github.io/Stellar-Arena/ |
