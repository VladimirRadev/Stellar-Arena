// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {StellarArena} from "../src/StellarArena.sol";
import {IVladToken} from "../src/interfaces/IVladToken.sol";
import {IStellarStore} from "../src/interfaces/IStellarStore.sol";

/// @notice Deploys StellarArena against the already-deployed $VLAD token and StellarStore, wires it in, seeds the pool.
/// Env: PRIVATE_KEY (deployer; must hold DEFAULT_ADMIN_ROLE on the store and >= 1000 VLAD), VLAD_TOKEN, STELLAR_STORE.
/// Run with `--broadcast --slow --skip-simulation` (Sepolia prices contract creation far above the local simulation;
/// the EIP-7702-delegated deployer allows one in-flight tx, so on "in-flight transaction limit" wait ~20 s and `--resume`).
contract Deploy is Script {
    uint256 constant ENTRY_FEE = 10e18; // 10 VLAD per run
    uint256 constant WIN_BPS = 18_000; // a win pays 1.8x the stake
    uint256 constant SEED_POOL = 1000e18; // initial prize pool

    function run() external returns (StellarArena arena) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        IVladToken vlad = IVladToken(vm.envAddress("VLAD_TOKEN"));
        IStellarStore store = IStellarStore(vm.envAddress("STELLAR_STORE"));
        require(address(vlad).code.length > 0, "VLAD_TOKEN has no code");
        require(address(store).code.length > 0, "STELLAR_STORE has no code");
        require(store.SWORD() == 1 && store.SHIELD() == 2 && store.TROPHY() == 3, "unexpected store item ids");
        require(vlad.balanceOf(vm.addr(pk)) >= SEED_POOL, "deployer needs 1000 VLAD to seed the pool");
        bytes32 gameRole = store.GAME_ROLE();

        vm.startBroadcast(pk);
        arena = new StellarArena(vlad, store, ENTRY_FEE, WIN_BPS); // (1)
        store.grantRole(gameRole, address(arena)); // (2) arena may burn items and mint Trophies
        store.setTreasury(address(arena)); // (3) store sale proceeds refill the prize pool
        vlad.approve(address(arena), SEED_POOL); // (4)
        arena.fundPool(SEED_POOL); // (5)
        vm.stopBroadcast();

        console2.log("StellarArena deployed at:", address(arena));
        console2.log("Prize pool (wei):", arena.prizePool());
    }
}
