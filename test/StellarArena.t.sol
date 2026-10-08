// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {StellarArena} from "../src/StellarArena.sol";
import {IStellarStore} from "../src/interfaces/IStellarStore.sol";
import {MockVlad} from "./mocks/MockVlad.sol";
import {MockStore} from "./mocks/MockStore.sol";

contract StellarArenaTest is Test {
    MockVlad vlad;
    MockStore store;
    StellarArena arena;

    address player = makeAddr("player");
    address stranger = makeAddr("stranger");

    uint256 constant FEE = 10e18;
    uint256 constant WIN_BPS = 18_000; // 1.8x
    uint256 constant POOL = 1000e18;
    uint256 constant PLAYER_VLAD = 100e18;
    uint64 constant ENTER_BLOCK = 100;
    bytes32 constant HASH = keccak256("hash of block ENTER_BLOCK + 1");

    uint8 constant NONE = 0;
    uint8 constant SWORD = 1;
    uint8 constant SHIELD = 2;
    uint256 constant TROPHY = 3;

    enum Want {
        Win,
        Loss,
        SwordFlip
    }

    function setUp() public {
        vm.roll(ENTER_BLOCK);
        vlad = new MockVlad();
        store = new MockStore();
        arena = _deployArena();
        vlad.mint(address(this), POOL);
        vlad.approve(address(arena), POOL);
        arena.fundPool(POOL);
        _equipPlayer(arena);
    }

    // ------------------------------------------------------------------ helpers

    function _deployArena() internal returns (StellarArena a) {
        a = new StellarArena(IERC20(address(vlad)), IStellarStore(address(store)), FEE, WIN_BPS);
        store.grantRole(store.GAME_ROLE(), address(a));
    }

    function _equipPlayer(StellarArena a) internal {
        vlad.mint(player, PLAYER_VLAD);
        vm.prank(player);
        vlad.approve(address(a), type(uint256).max);
        store.mintItem(player, SWORD, 1);
        store.mintItem(player, SHIELD, 1);
    }

    /// Independent re-implementation of the spec formula (not the contract's own `rollsFor`).
    function _rolls(bytes32 secret, uint8 item) internal pure returns (uint8 p, uint8 e) {
        uint256 seed = uint256(keccak256(abi.encode(secret, HASH)));
        // Rolls are at most 110, so both casts are lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        (p, e) = (uint8(seed % 100 + 1 + (item == SWORD ? 10 : 0)), uint8((seed >> 128) % 100 + 1));
    }

    /// Deterministically searches for a secret whose rolls (under HASH) give the wanted outcome.
    function _findSecret(Want want) internal pure returns (bytes32 secret) {
        for (uint256 i; i < 1000; ++i) {
            secret = keccak256(abi.encode("arena secret", i));
            (uint8 p, uint8 e) = _rolls(secret, NONE);
            if (want == Want.Win && p > e) return secret;
            if (want == Want.Loss && p <= e) return secret;
            if (want == Want.SwordFlip && p <= e && p + 10 > e) return secret;
        }
        revert("no secret found");
    }

    function _enter(StellarArena a, bytes32 secret, uint8 item) internal returns (uint256 id) {
        bytes32 commit = a.commitmentOf(secret, player); // computed first so the prank hits `enter`
        vm.prank(player);
        id = a.enter(commit, item);
    }

    /// Moves to the first block where resolve is allowed and pins the hash of block ENTER_BLOCK + 1.
    function _toRevealBlock() internal {
        vm.roll(ENTER_BLOCK + 2);
        vm.setBlockhash(ENTER_BLOCK + 1, HASH);
    }

    function _resolve(StellarArena a, uint256 id, bytes32 secret) internal {
        vm.prank(player);
        a.resolve(id, secret);
    }

    // ------------------------------------------------------------------ tests

    function test_Enter_EscrowsStakeConsumesItemAndRejectsBadInput() public {
        bytes32 commit = arena.commitmentOf(keccak256("s"), player);
        vm.startPrank(player);
        vm.expectRevert(StellarArena.BadItem.selector);
        arena.enter(commit, 3);
        vm.expectRevert(StellarArena.ZeroCommit.selector);
        arena.enter(bytes32(0), SWORD);

        vm.expectEmit(address(arena));
        emit StellarArena.Entered(0, player, SWORD, FEE, ENTER_BLOCK);
        uint256 id = arena.enter(commit, SWORD);
        vm.stopPrank();

        assertEq(id, 0);
        assertEq(arena.nextRunId(), 1);
        assertEq(vlad.balanceOf(player), PLAYER_VLAD - FEE);
        assertEq(arena.prizePool(), POOL + FEE);
        assertEq(store.balanceOf(player, SWORD), 0);
        assertEq(store.balanceOf(player, SHIELD), 1);
        StellarArena.Run memory r = arena.getRun(id);
        assertEq(r.player, player);
        assertEq(r.stake, FEE);
        assertEq(r.enterBlock, ENTER_BLOCK);
        assertEq(r.item, SWORD);
        assertEq(r.commit, commit);
        assertEq(r.winBps, WIN_BPS);
        assertFalse(r.resolved);
        assertEq(arena.totalRuns(), 1);
        (uint256 runs,,) = arena.stats(player);
        assertEq(runs, 1);
    }

    function test_Resolve_RevertsTooEarly() public {
        bytes32 secret = _findSecret(Want.Win);
        uint256 id = _enter(arena, secret, NONE);

        vm.prank(player);
        vm.expectRevert(StellarArena.TooEarly.selector);
        arena.resolve(id, secret); // same block as enter

        vm.roll(ENTER_BLOCK + 1); // the hash block itself: its hash is not readable yet
        (bool ready, bool expired) = arena.canResolve(id);
        assertFalse(ready);
        assertFalse(expired);
        vm.prank(player);
        vm.expectRevert(StellarArena.TooEarly.selector);
        arena.resolve(id, secret);

        _toRevealBlock();
        (ready,) = arena.canResolve(id);
        assertTrue(ready);
        _resolve(arena, id, secret);
    }

    function test_Resolve_RevertsOnWrongSecretWrongCallerAndReplay() public {
        bytes32 secret = _findSecret(Want.Win);
        uint256 id = _enter(arena, secret, NONE);
        _toRevealBlock();

        vm.prank(stranger);
        vm.expectRevert(StellarArena.NotPlayer.selector);
        arena.resolve(id, secret);

        vm.prank(player);
        vm.expectRevert(StellarArena.BadReveal.selector);
        arena.resolve(id, keccak256("wrong secret"));

        _resolve(arena, id, secret);
        vm.prank(player);
        vm.expectRevert(StellarArena.AlreadyResolved.selector);
        arena.resolve(id, secret);
    }

    function test_Resolve_WinPays1_8xAndAwardsTrophy() public {
        bytes32 secret = _findSecret(Want.Win);
        (uint8 p, uint8 e) = _rolls(secret, NONE);
        uint256 id = _enter(arena, secret, NONE);
        _toRevealBlock();

        uint256 payout = FEE * 18_000 / 10_000; // 18 VLAD
        vm.expectEmit(address(arena));
        emit StellarArena.Resolved(id, player, true, p, e, payout);
        _resolve(arena, id, secret);

        assertEq(payout, 18e18);
        assertEq(vlad.balanceOf(player), PLAYER_VLAD - FEE + payout);
        assertEq(arena.prizePool(), POOL + FEE - payout);
        assertEq(store.balanceOf(player, TROPHY), 1);
        StellarArena.Run memory r = arena.getRun(id);
        assertTrue(r.resolved && r.won);
        assertEq(r.playerRoll, p);
        assertEq(r.enemyRoll, e);
        (uint256 runs, uint256 wins, uint256 paidOut) = arena.stats(player);
        assertEq(runs, 1);
        assertEq(wins, 1);
        assertEq(paidOut, payout);
        assertEq(arena.totalWins(), 1);
        assertEq(arena.totalPaidOut(), payout);
    }

    function test_Resolve_ShieldLossRefundsHalfNoTrophy() public {
        bytes32 secret = _findSecret(Want.Loss);
        (uint8 p, uint8 e) = _rolls(secret, SHIELD);
        uint256 id = _enter(arena, secret, SHIELD);
        assertEq(store.balanceOf(player, SHIELD), 0);
        _toRevealBlock();

        uint256 refund = FEE / 2;
        vm.expectEmit(address(arena));
        emit StellarArena.Resolved(id, player, false, p, e, refund);
        _resolve(arena, id, secret);

        assertEq(vlad.balanceOf(player), PLAYER_VLAD - FEE + refund);
        assertEq(store.balanceOf(player, TROPHY), 0);
        (, uint256 wins, uint256 paidOut) = arena.stats(player);
        assertEq(wins, 0);
        assertEq(paidOut, refund);
        assertFalse(arena.getRun(id).won);
    }

    function test_Resolve_SwordBonusFlipsLosingRoll() public {
        bytes32 secret = _findSecret(Want.SwordFlip);
        (uint8 bare, uint8 e) = _rolls(secret, NONE);
        assertLe(bare, e, "without the Sword this roll loses");
        (uint8 armed,) = _rolls(secret, SWORD);
        assertEq(armed, bare + 10);
        assertGt(armed, e, "with the Sword it wins");

        uint256 id = _enter(arena, secret, SWORD);
        _toRevealBlock();
        _resolve(arena, id, secret);

        StellarArena.Run memory r = arena.getRun(id);
        assertTrue(r.won);
        assertEq(r.playerRoll, armed);
        assertEq(store.balanceOf(player, TROPHY), 1);
        assertEq(vlad.balanceOf(player), PLAYER_VLAD - FEE + 18e18);
    }

    function test_Resolve_PayoutCappedByPoolBalance() public {
        StellarArena dry = _deployArena(); // never funded: only the player's own stake is inside
        _equipPlayer(dry);
        bytes32 secret = _findSecret(Want.Win);
        uint256 id = _enter(dry, secret, NONE);
        assertEq(dry.prizePool(), FEE);
        _toRevealBlock();
        _resolve(dry, id, secret);

        assertEq(dry.prizePool(), 0);
        assertEq(dry.totalPaidOut(), FEE, "capped at 10, not 18");
        assertEq(store.balanceOf(player, TROPHY), 1);
    }

    function test_Resolve_ExpiredRunKeepsStakeInPool() public {
        bytes32 secret = _findSecret(Want.Win);
        uint256 id = _enter(arena, secret, NONE);
        uint256 lastBlock = ENTER_BLOCK + 1 + arena.REVEAL_WINDOW(); // 351

        // The last allowed block still works (checked on a throwaway state copy).
        uint256 snap = vm.snapshotState();
        vm.roll(lastBlock);
        vm.setBlockhash(ENTER_BLOCK + 1, HASH);
        (bool ready, bool expired) = arena.canResolve(id);
        assertTrue(ready);
        assertFalse(expired);
        _resolve(arena, id, secret);
        vm.revertToState(snap);

        vm.roll(lastBlock + 1);
        vm.setBlockhash(ENTER_BLOCK + 1, HASH);
        (ready, expired) = arena.canResolve(id);
        assertFalse(ready);
        assertTrue(expired);
        vm.prank(player);
        vm.expectRevert(StellarArena.Expired.selector);
        arena.resolve(id, secret);
        assertEq(arena.prizePool(), POOL + FEE);
        assertFalse(arena.getRun(id).resolved);
    }

    function test_SetParams_OnlyOwnerCappedAndSnapshotted() public {
        uint256 oldRun = _enter(arena, keccak256("old"), NONE);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        arena.setParams(20e18, 20_000);
        vm.expectRevert(StellarArena.BadParams.selector);
        arena.setParams(20e18, 30_001);
        vm.expectRevert(StellarArena.BadParams.selector);
        arena.setParams(0, 20_000);

        vm.expectEmit(address(arena));
        emit StellarArena.ParamsUpdated(20e18, 30_000);
        arena.setParams(20e18, 30_000);
        assertEq(arena.entryFee(), 20e18);
        assertEq(arena.winBps(), 30_000);

        StellarArena.Run memory r = arena.getRun(oldRun);
        assertEq(r.stake, FEE, "old run keeps its stake");
        assertEq(r.winBps, WIN_BPS, "old run keeps its payout multiplier");
        uint256 newRun = _enter(arena, keccak256("new"), NONE);
        assertEq(arena.getRun(newRun).stake, 20e18);
    }
}
