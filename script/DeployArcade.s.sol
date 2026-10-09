// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {StellarArcade} from "../src/StellarArcade.sol";
import {IStellarArcade} from "../src/interfaces/IStellarArcade.sol";
import {IVladToken} from "../src/interfaces/IVladToken.sol";
import {IStellarStore} from "../src/interfaces/IStellarStore.sol";

/// @notice Deploys StellarArcade against the already-deployed $VLAD token and StellarStore, registers the 29
///         cabinets, lets the Arcade burn items and mint Trophies, and seeds the prize pool with 1000 VLAD.
/// Env: PRIVATE_KEY (deployer; must hold DEFAULT_ADMIN_ROLE on the store and >= 1000 VLAD), VLAD_TOKEN, STELLAR_STORE.
/// run with --slow --skip-simulation (Sepolia prices contract creation far above the local simulation; the
/// EIP-7702-delegated deployer allows one in-flight tx, so on "in-flight transaction limit" wait ~20 s and `--resume`).
/// The store treasury stays the Arena: this script does not call `store.setTreasury`.
contract DeployArcade is Script {
    uint256 constant MAX_ENTRY_FEE = 10e18; // cap for every cabinet's entry fee
    uint128 constant ENTRY_FEE = 10e18; // 10 VLAD per run on every cabinet
    uint256 constant SEED_POOL = 1000e18; // initial prize pool

    function run() external returns (StellarArcade arcade) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        IVladToken vlad = IVladToken(vm.envAddress("VLAD_TOKEN"));
        IStellarStore store = IStellarStore(vm.envAddress("STELLAR_STORE"));
        require(address(vlad).code.length > 0, "VLAD_TOKEN has no code");
        require(address(store).code.length > 0, "STELLAR_STORE has no code");
        require(store.SWORD() == 1 && store.SHIELD() == 2 && store.TROPHY() == 3, "unexpected store item ids");
        require(vlad.balanceOf(vm.addr(pk)) >= SEED_POOL, "deployer needs 1000 VLAD to seed the pool");
        bytes32 gameRole = store.GAME_ROLE();
        IStellarArcade.Game[] memory list = cabinets();

        vm.startBroadcast(pk);
        arcade = new StellarArcade(vlad, store, MAX_ENTRY_FEE); // (1)
        arcade.addGames(list); // (2) all 29 cabinets in one call
        store.grantRole(gameRole, address(arcade)); // (3) the Arcade may burn items and mint Trophies
        vlad.approve(address(arcade), SEED_POOL); // (4)
        arcade.fundPool(SEED_POOL); // (5)
        vm.stopBroadcast();

        console2.log("StellarArcade deployed at:", address(arcade));
        console2.log("Cabinets:", arcade.gameCount());
        console2.log("Prize pool (wei):", arcade.prizePool());
    }

    /// @notice The 29 cabinets. Names are ours; each is inspired by a third-party game listed on ekvahlabs.com.
    function cabinets() public pure returns (IStellarArcade.Game[] memory list) {
        IStellarArcade.Genre RPG = IStellarArcade.Genre.RPG;
        IStellarArcade.Genre CARD = IStellarArcade.Genre.CARD;
        IStellarArcade.Genre STRATEGY = IStellarArcade.Genre.STRATEGY;
        IStellarArcade.Genre ACTION = IStellarArcade.Genre.ACTION;
        IStellarArcade.Genre SURVIVAL = IStellarArcade.Genre.SURVIVAL;
        IStellarArcade.Kind DUEL = IStellarArcade.Kind.DUEL;
        IStellarArcade.Kind TIERS = IStellarArcade.Kind.TIERS;
        IStellarArcade.Kind RACE = IStellarArcade.Kind.RACE;
        IStellarArcade.Kind HIGHCARD = IStellarArcade.Kind.HIGHCARD;
        IStellarArcade.Kind EXTRACT = IStellarArcade.Kind.EXTRACT;

        list = new IStellarArcade.Game[](29);
        list[0] = _cabinet("Axolotl Clash", RPG, DUEL); // inspired by Axie Infinity
        list[1] = _cabinet("Shard Hunt", RPG, TIERS); // Illuvium
        list[2] = _cabinet("Pantheon Draw", CARD, HIGHCARD); // Gods Unchained
        list[3] = _cabinet("Voxel Dig", STRATEGY, TIERS); // The Sandbox
        list[4] = _cabinet("Land Rush", RPG, RACE); // Decentraland
        list[5] = _cabinet("Time Raid", ACTION, DUEL); // Big Time
        list[6] = _cabinet("Harvest Moon Run", RPG, TIERS); // Pixels
        list[7] = _cabinet("Parallel Draft", CARD, HIGHCARD); // Parallel
        list[8] = _cabinet("Guardian Dungeon", ACTION, DUEL); // Guild of Guardians
        list[9] = _cabinet("Warp Race", STRATEGY, RACE); // Star Atlas
        list[10] = _cabinet("Hooligan Havoc", ACTION, DUEL); // My Pet Hooligan
        list[11] = _cabinet("Grid Extraction", SURVIVAL, EXTRACT); // Off The Grid
        list[12] = _cabinet("Portal Summon", RPG, TIERS); // Aavegotchi
        list[13] = _cabinet("Kitty Breeding", CARD, TIERS); // CryptoKitties (jackpot = rare trait)
        list[14] = _cabinet("Monster Catch", RPG, DUEL); // Chainmonsters
        list[15] = _cabinet("Alice's Garden", STRATEGY, TIERS); // My Neighbor Alice
        list[16] = _cabinet("Deep Mine", ACTION, TIERS); // Mines of Dalarnia
        list[17] = _cabinet("Alien Mining", SURVIVAL, EXTRACT); // Alien Worlds
        list[18] = _cabinet("Splinter Clash", CARD, HIGHCARD); // Splinterlands
        list[19] = _cabinet("Nine Expeditions", RPG, DUEL); // Nine Chronicles
        list[20] = _cabinet("Shrapnel Drop", ACTION, RACE); // Shrapnel
        list[21] = _cabinet("Aurory Tactics", RPG, DUEL); // Aurory
        list[22] = _cabinet("Beacon Trial", RPG, DUEL); // The Beacon
        list[23] = _cabinet("Ember Duel", RPG, DUEL); // Ember Sword
        list[24] = _cabinet("Moonray Clash", ACTION, DUEL); // Moonray
        list[25] = _cabinet("Mech Sortie", ACTION, RACE); // MetalCore
        list[26] = _cabinet("Unicorn Joust", STRATEGY, DUEL); // Crypto Unicorns
        list[27] = _cabinet("Mavia Siege", STRATEGY, TIERS); // Heroes of Mavia
        list[28] = _cabinet("Dragon Hatch", STRATEGY, TIERS); // Eternal Dragons
    }

    /// @dev Rules per kind: DUEL 48% -> 1.8x; TIERS 1.5x tier (bands and the 5x jackpot are fixed in the contract);
    ///      RACE 3.6x; HIGHCARD 1.9x; EXTRACT 35% -> 2.6x.
    function _cabinet(string memory name, IStellarArcade.Genre genre, IStellarArcade.Kind kind)
        internal
        pure
        returns (IStellarArcade.Game memory)
    {
        uint16 chance;
        uint16 winBps;
        if (kind == IStellarArcade.Kind.DUEL) (chance, winBps) = (48, 18_000);
        else if (kind == IStellarArcade.Kind.TIERS) winBps = 15_000;
        else if (kind == IStellarArcade.Kind.RACE) winBps = 36_000;
        else if (kind == IStellarArcade.Kind.HIGHCARD) winBps = 19_000;
        else (chance, winBps) = (35, 26_000);
        return IStellarArcade.Game(name, genre, kind, chance, ENTRY_FEE, winBps, true);
    }
}
