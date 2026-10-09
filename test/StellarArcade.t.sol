// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {StellarArcade} from "../src/StellarArcade.sol";
import {IStellarArcade} from "../src/interfaces/IStellarArcade.sol";
import {IStellarStore} from "../src/interfaces/IStellarStore.sol";
import {MockVlad} from "./mocks/MockVlad.sol";
import {MockStore} from "./mocks/MockStore.sol";

contract StellarArcadeTest is Test {
    MockVlad vlad;
    MockStore store;
    StellarArcade arcade;

    address player = makeAddr("player");
    address rival = makeAddr("rival");
    address stranger = makeAddr("stranger");

    uint256 constant FEE = 10e18;
    uint128 constant FEE_128 = 10e18; // the Game struct stores the fee as uint128
    uint256 constant POOL = 1000e18;
    uint256 constant PLAYER_VLAD = 1000e18;
    uint64 constant ENTER_BLOCK = 100;
    bytes32 constant HASH = keccak256("hash of block ENTER_BLOCK + 1");

    uint8 constant NONE = 0;
    uint8 constant SWORD = 1;
    uint8 constant SHIELD = 2;
    uint256 constant TROPHY = 3;

    // Cabinet ids registered in setUp, one per kind.
    uint256 constant DUEL_ID = 0;
    uint256 constant TIERS_ID = 1;
    uint256 constant RACE_ID = 2;
    uint256 constant HIGHCARD_ID = 3;
    uint256 constant EXTRACT_ID = 4;

    function setUp() public {
        vm.roll(ENTER_BLOCK);
        vlad = new MockVlad();
        store = new MockStore();
        arcade = _deployArcade();
        vlad.mint(address(this), POOL);
        vlad.approve(address(arcade), POOL);
        arcade.fundPool(POOL);
        _equip(arcade, player);
    }

    // ------------------------------------------------------------------ helpers

    function _game(string memory name, IStellarArcade.Genre genre, IStellarArcade.Kind kind, uint16 chance, uint16 bps)
        internal
        pure
        returns (IStellarArcade.Game memory)
    {
        return IStellarArcade.Game(name, genre, kind, chance, FEE_128, bps, true);
    }

    /// The plan's rules for each kind: DUEL 48% 1.8x, TIERS 1.5x tier, RACE 3.6x, HIGHCARD 1.9x, EXTRACT 35% 2.6x.
    function _fiveGames() internal pure returns (IStellarArcade.Game[] memory list) {
        list = new IStellarArcade.Game[](5);
        list[0] = _game("Axolotl Clash", IStellarArcade.Genre.RPG, IStellarArcade.Kind.DUEL, 48, 18_000);
        list[1] = _game("Shard Hunt", IStellarArcade.Genre.RPG, IStellarArcade.Kind.TIERS, 0, 15_000);
        list[2] = _game("Land Rush", IStellarArcade.Genre.RPG, IStellarArcade.Kind.RACE, 0, 36_000);
        list[3] = _game("Pantheon Draw", IStellarArcade.Genre.CARD, IStellarArcade.Kind.HIGHCARD, 0, 19_000);
        list[4] = _game("Grid Extraction", IStellarArcade.Genre.SURVIVAL, IStellarArcade.Kind.EXTRACT, 35, 26_000);
    }

    function _deployArcade() internal returns (StellarArcade a) {
        a = new StellarArcade(IERC20(address(vlad)), IStellarStore(address(store)), FEE);
        a.addGames(_fiveGames());
        store.grantRole(store.GAME_ROLE(), address(a));
    }

    function _equip(StellarArcade a, address who) internal {
        vlad.mint(who, PLAYER_VLAD);
        vm.prank(who);
        vlad.approve(address(a), type(uint256).max);
        store.mintItem(who, SWORD, 3);
        store.mintItem(who, SHIELD, 3);
    }

    function _seed(bytes32 secret) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(secret, HASH)));
    }

    /// Deterministically searches for the first secret whose seed (under HASH) satisfies `want`.
    function _find(function(uint256) internal pure returns (bool) want) internal pure returns (bytes32 secret) {
        for (uint256 i; i < 5000; ++i) {
            secret = keccak256(abi.encode("arcade secret", i));
            if (want(_seed(secret))) return secret;
        }
        revert("no secret found");
    }

    // Seed predicates, written from the plan's formulas (not from the contract).
    function _duelWin(uint256 s) internal pure returns (bool) {
        return s % 100 < 48;
    }

    function _duelLoss(uint256 s) internal pure returns (bool) {
        return s % 100 >= 58; // loses even with a Sword
    }

    function _swordFlip(uint256 s) internal pure returns (bool) {
        return s % 100 >= 48 && s % 100 < 58; // loses bare, wins with +10
    }

    function _jackpot(uint256 s) internal pure returns (bool) {
        return s % 1000 < 20;
    }

    function _tierWin(uint256 s) internal pure returns (bool) {
        return s % 1000 >= 20 && s % 1000 < 200;
    }

    function _tierRefund(uint256 s) internal pure returns (bool) {
        return s % 1000 >= 200 && s % 1000 < 450;
    }

    function _tierLoss(uint256 s) internal pure returns (bool) {
        return s % 1000 >= 450;
    }

    function _cardWin(uint256 s) internal pure returns (bool) {
        return (s % 52) % 13 > ((s >> 64) % 52) % 13;
    }

    function _cardTie(uint256 s) internal pure returns (bool) {
        return (s % 52) % 13 == ((s >> 64) % 52) % 13;
    }

    function _cardLoss(uint256 s) internal pure returns (bool) {
        return (s % 52) % 13 < ((s >> 64) % 52) % 13;
    }

    function _extractWin(uint256 s) internal pure returns (bool) {
        return s % 100 < 35;
    }

    function _extractLoss(uint256 s) internal pure returns (bool) {
        return s % 100 >= 45;
    }

    function _any(uint256) internal pure returns (bool) {
        return true;
    }

    function _enter(StellarArcade a, address who, uint256 gameId, bytes32 secret, uint8 item, uint8 choice)
        internal
        returns (uint256 id)
    {
        bytes32 commit = a.commitmentOf(secret, who); // computed first so the prank hits `enter`
        vm.prank(who);
        id = a.enter(gameId, commit, item, choice);
    }

    function _enter(uint256 gameId, bytes32 secret, uint8 item, uint8 choice) internal returns (uint256) {
        return _enter(arcade, player, gameId, secret, item, choice);
    }

    /// Moves to the first block where resolve is allowed and pins the hash of block ENTER_BLOCK + 1.
    function _toRevealBlock() internal {
        vm.roll(ENTER_BLOCK + 2);
        vm.setBlockhash(ENTER_BLOCK + 1, HASH);
    }

    /// Resolves and returns the VLAD the player received.
    function _resolve(StellarArcade a, address who, uint256 id, bytes32 secret) internal returns (uint256 paid) {
        uint256 before = vlad.balanceOf(who);
        vm.prank(who);
        a.resolve(id, secret);
        paid = vlad.balanceOf(who) - before;
    }

    function _resolve(uint256 id, bytes32 secret) internal returns (uint256) {
        return _resolve(arcade, player, id, secret);
    }

    function _outcome(uint256 id) internal view returns (IStellarArcade.Outcome) {
        return arcade.getRun(id).outcome;
    }

    // ------------------------------------------------------------------ admin

    function test_AddGames_OnlyOwnerAndValidated() public {
        IStellarArcade.Game[] memory list = _fiveGames();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        arcade.addGames(list);

        IStellarArcade.Game[] memory one = new IStellarArcade.Game[](1);
        IStellarArcade.Game memory bad; // memory structs are references: take a fresh copy each time
        bad = _fiveGames()[0];
        bad.name = "";
        _expectBadGame(one, bad);
        bad = _fiveGames()[0];
        bad.entryFee = 0;
        _expectBadGame(one, bad);
        bad = _fiveGames()[0];
        bad.entryFee = FEE_128 + 1; // above maxEntryFee
        _expectBadGame(one, bad);
        bad = _fiveGames()[0];
        bad.winBps = 10_000; // a "win" must pay more than the stake
        _expectBadGame(one, bad);
        bad = _fiveGames()[0];
        bad.winBps = 50_001;
        _expectBadGame(one, bad);
        bad = _fiveGames()[0];
        bad.winChancePct = 0;
        _expectBadGame(one, bad);
        bad = _fiveGames()[4];
        bad.winChancePct = 91; // a Sword would push it past 100
        _expectBadGame(one, bad);
        bad = _fiveGames()[1];
        bad.winChancePct = 50; // only DUEL and EXTRACT use a win chance
        _expectBadGame(one, bad);

        vm.expectEmit(address(arcade));
        emit StellarArcade.GameAdded(5, "Axolotl Clash", IStellarArcade.Kind.DUEL);
        arcade.addGames(list);
        assertEq(arcade.gameCount(), 10);
        IStellarArcade.Game memory g = arcade.getGame(9);
        assertEq(g.name, "Grid Extraction");
        assertEq(uint8(g.genre), uint8(IStellarArcade.Genre.SURVIVAL));
        assertEq(uint8(g.kind), uint8(IStellarArcade.Kind.EXTRACT));
        assertEq(g.winChancePct, 35);
        assertEq(g.entryFee, FEE);
        assertEq(g.winBps, 26_000);
        assertTrue(g.active);
        vm.expectRevert(StellarArcade.UnknownGame.selector);
        arcade.getGame(10);
    }

    function _expectBadGame(IStellarArcade.Game[] memory one, IStellarArcade.Game memory bad) internal {
        one[0] = bad;
        vm.expectRevert(StellarArcade.BadGame.selector);
        arcade.addGames(one);
    }

    function test_SetGame_OnlyOwnerSnapshotsRulesAndDeactivates() public {
        bytes32 secret = _find(_duelWin);
        uint256 id = _enter(DUEL_ID, secret, NONE, 0);

        IStellarArcade.Game memory g = _fiveGames()[0];
        g.winBps = 30_000;
        g.winChancePct = 1;
        g.active = false;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        arcade.setGame(DUEL_ID, g);
        vm.expectRevert(StellarArcade.UnknownGame.selector);
        arcade.setGame(5, g);

        vm.expectEmit(address(arcade));
        emit StellarArcade.GameUpdated(DUEL_ID, "Axolotl Clash", IStellarArcade.Kind.DUEL, false);
        arcade.setGame(DUEL_ID, g);
        assertEq(arcade.getGame(DUEL_ID).winBps, 30_000);

        bytes32 commit = arcade.commitmentOf(keccak256("late"), player);
        vm.prank(player);
        vm.expectRevert(StellarArcade.GameInactive.selector);
        arcade.enter(DUEL_ID, commit, NONE, 0);

        // The open run keeps 48% / 1.8x from its entry block, not 1% / 3x.
        _toRevealBlock();
        assertEq(_resolve(id, secret), 18e18);
        IStellarArcade.Run memory r = arcade.getRun(id);
        assertEq(r.winChancePct, 48);
        assertEq(r.winBps, 18_000);
        assertEq(uint8(r.outcome), uint8(IStellarArcade.Outcome.WIN));
    }

    // ------------------------------------------------------------------ entering

    function test_Enter_EscrowsStakeConsumesItemAndRejectsBadInput() public {
        bytes32 commit = arcade.commitmentOf(keccak256("s"), player);
        vm.startPrank(player);
        vm.expectRevert(StellarArcade.UnknownGame.selector);
        arcade.enter(5, commit, NONE, 0);
        vm.expectRevert(StellarArcade.ZeroCommit.selector);
        arcade.enter(DUEL_ID, bytes32(0), NONE, 0);
        vm.expectRevert(StellarArcade.BadItem.selector);
        arcade.enter(DUEL_ID, commit, 3, 0); // the Trophy is not equipment
        vm.expectRevert(StellarArcade.BadItem.selector);
        arcade.enter(TIERS_ID, commit, SWORD, 0); // a Sword only helps DUEL and EXTRACT
        vm.expectRevert(StellarArcade.BadItem.selector);
        arcade.enter(RACE_ID, commit, SWORD, 0);
        vm.expectRevert(StellarArcade.BadItem.selector);
        arcade.enter(HIGHCARD_ID, commit, SWORD, 0);

        vm.expectEmit(address(arcade));
        emit StellarArcade.Entered(0, EXTRACT_ID, player, SWORD, 0, FEE, ENTER_BLOCK);
        uint256 id = arcade.enter(EXTRACT_ID, commit, SWORD, 0);
        vm.stopPrank();

        assertEq(id, 0);
        assertEq(arcade.nextRunId(), 1);
        assertEq(vlad.balanceOf(player), PLAYER_VLAD - FEE);
        assertEq(arcade.prizePool(), POOL + FEE);
        assertEq(store.balanceOf(player, SWORD), 2);
        IStellarArcade.Run memory r = arcade.getRun(id);
        assertEq(r.player, player);
        assertEq(r.stake, FEE);
        assertEq(r.enterBlock, ENTER_BLOCK);
        assertEq(r.item, SWORD);
        assertEq(r.gameId, EXTRACT_ID);
        assertEq(uint8(r.kind), uint8(IStellarArcade.Kind.EXTRACT));
        assertEq(r.winChancePct, 35);
        assertEq(r.winBps, 26_000);
        assertEq(r.commit, commit);
        assertFalse(r.resolved);
    }

    // ------------------------------------------------------------------ the five kinds

    function test_Duel_WinPays1_8xWithTrophyLossPaysNothing() public {
        bytes32 winS = _find(_duelWin);
        bytes32 lossS = _find(_duelLoss);
        uint256 win = _enter(DUEL_ID, winS, NONE, 0);
        uint256 loss = _enter(DUEL_ID, lossS, NONE, 0);
        _toRevealBlock();

        vm.expectEmit(address(arcade));
        emit StellarArcade.Resolved(
            win, DUEL_ID, player, IStellarArcade.Outcome.WIN, uint16(_seed(winS) % 100), 48, 18e18
        );
        assertEq(_resolve(win, winS), 18e18);
        assertEq(_resolve(loss, lossS), 0);
        assertEq(uint8(_outcome(loss)), uint8(IStellarArcade.Outcome.LOSE));
        assertEq(store.balanceOf(player, TROPHY), 1);
        assertEq(arcade.getRun(win).payout, 18e18);
        assertEq(arcade.prizePool(), POOL + 2 * FEE - 18e18);
    }

    function test_Tiers_JackpotWinRefundAndLoss() public {
        bytes32[4] memory s = [_find(_jackpot), _find(_tierWin), _find(_tierRefund), _find(_tierLoss)];
        uint256[4] memory ids;
        for (uint256 i; i < 4; ++i) {
            ids[i] = _enter(TIERS_ID, s[i], NONE, 0);
        }
        _toRevealBlock();

        assertEq(_resolve(ids[0], s[0]), 50e18, "jackpot 5x");
        assertEq(_resolve(ids[1], s[1]), 15e18, "win 1.5x");
        assertEq(_resolve(ids[2], s[2]), 10e18, "refund 1x");
        assertEq(_resolve(ids[3], s[3]), 0, "loss");
        assertEq(uint8(_outcome(ids[0])), uint8(IStellarArcade.Outcome.JACKPOT));
        assertEq(uint8(_outcome(ids[1])), uint8(IStellarArcade.Outcome.WIN));
        assertEq(uint8(_outcome(ids[2])), uint8(IStellarArcade.Outcome.REFUND));
        assertEq(uint8(_outcome(ids[3])), uint8(IStellarArcade.Outcome.LOSE));
        assertEq(arcade.getRun(ids[0]).roll, _seed(s[0]) % 1000);
        assertEq(store.balanceOf(player, TROPHY), 2, "jackpot and win; no Trophy for a refund");
    }

    function test_Race_RequiresLaneBelow4AndPaysOnlyTheWinningLane() public {
        bytes32 secret = _find(_any);
        uint8 lane = uint8(_seed(secret) % 4);
        bytes32 commit = arcade.commitmentOf(secret, player);
        vm.prank(player);
        vm.expectRevert(StellarArcade.BadChoice.selector);
        arcade.enter(RACE_ID, commit, NONE, 4);

        uint256 win = _enter(RACE_ID, secret, NONE, lane);
        uint256 loss = _enter(RACE_ID, secret, SHIELD, (lane + 1) % 4);
        _toRevealBlock();

        assertEq(_resolve(win, secret), 36e18, "3.6x");
        IStellarArcade.Run memory r = arcade.getRun(win);
        assertEq(r.roll, lane, "roll = winning lane");
        assertEq(r.houseRoll, lane, "houseRoll = chosen lane");
        assertEq(_resolve(loss, secret), 5e18, "other lane loses; the Shield returns half");
        assertEq(uint8(_outcome(loss)), uint8(IStellarArcade.Outcome.LOSE));
        assertEq(store.balanceOf(player, TROPHY), 1);
    }

    function test_HighCard_HigherRankWinsTieRefundsLowerLoses() public {
        bytes32 winS = _find(_cardWin);
        bytes32 tieS = _find(_cardTie);
        bytes32 lossS = _find(_cardLoss);
        uint256 win = _enter(HIGHCARD_ID, winS, NONE, 0);
        uint256 tie = _enter(HIGHCARD_ID, tieS, SHIELD, 0);
        uint256 loss = _enter(HIGHCARD_ID, lossS, NONE, 0);
        _toRevealBlock();

        assertEq(_resolve(win, winS), 19e18, "1.9x");
        assertEq(_resolve(tie, tieS), 10e18, "a tie refunds the stake; the Shield adds nothing");
        assertEq(_resolve(loss, lossS), 0);
        IStellarArcade.Run memory r = arcade.getRun(win);
        assertEq(r.roll, _seed(winS) % 52);
        assertEq(r.houseRoll, (_seed(winS) >> 64) % 52);
        assertEq(uint8(_outcome(tie)), uint8(IStellarArcade.Outcome.REFUND));
        assertEq(store.balanceOf(player, TROPHY), 1);
    }

    function test_Extract_WinPays2_6xAndShieldLossReturnsHalf() public {
        bytes32 winS = _find(_extractWin);
        bytes32 lossS = _find(_extractLoss);
        uint256 win = _enter(EXTRACT_ID, winS, NONE, 0);
        uint256 shielded = _enter(EXTRACT_ID, lossS, SHIELD, 0);
        uint256 bare = _enter(EXTRACT_ID, lossS, NONE, 0);
        assertEq(store.balanceOf(player, SHIELD), 2, "the Shield is burned at enter");
        _toRevealBlock();

        assertEq(_resolve(win, winS), 26e18, "2.6x");
        assertEq(_resolve(shielded, lossS), 5e18, "Shield: 50% back");
        assertEq(_resolve(bare, lossS), 0);
        assertEq(arcade.getRun(shielded).payout, 5e18);
        assertEq(store.balanceOf(player, TROPHY), 1);
    }

    function test_Sword_AddsTenChancePointsOnDuel() public {
        bytes32 secret = _find(_swordFlip);
        (IStellarArcade.Outcome bare,,,) = arcade.rollsFor(DUEL_ID, secret, HASH, NONE, 0);
        (IStellarArcade.Outcome armed, uint256 bps, uint16 roll, uint16 threshold) =
            arcade.rollsFor(DUEL_ID, secret, HASH, SWORD, 0);
        assertEq(uint8(bare), uint8(IStellarArcade.Outcome.LOSE), "without the Sword this roll loses");
        assertEq(uint8(armed), uint8(IStellarArcade.Outcome.WIN), "with the Sword it wins");
        assertEq(bps, 18_000);
        assertEq(threshold, 58);
        assertGe(roll, 48);

        uint256 id = _enter(DUEL_ID, secret, SWORD, 0);
        _toRevealBlock();
        assertEq(_resolve(id, secret), 18e18);
        assertEq(store.balanceOf(player, SWORD), 2);
        assertEq(store.balanceOf(player, TROPHY), 1);
    }

    // ------------------------------------------------------------------ pool, timing, stats, verification

    function test_Resolve_PayoutCappedByPoolBalance() public {
        StellarArcade dry = _deployArcade(); // never funded: only the player's own stake is inside
        _equip(dry, player);
        bytes32 secret = _find(_jackpot);
        uint256 id = _enter(dry, player, TIERS_ID, secret, NONE, 0);
        assertEq(dry.prizePool(), FEE);
        _toRevealBlock();

        assertEq(_resolve(dry, player, id, secret), FEE, "capped at the 10 VLAD pool, not 50");
        assertEq(dry.prizePool(), 0);
        assertEq(uint8(dry.getRun(id).outcome), uint8(IStellarArcade.Outcome.JACKPOT));
        assertEq(dry.getRun(id).payout, FEE);
        assertEq(store.balanceOf(player, TROPHY), 1, "the Trophy is still awarded");
    }

    function test_Resolve_TimingWindowExpiryAndRevealChecks() public {
        bytes32 secret = _find(_duelWin);
        uint256 id = _enter(DUEL_ID, secret, NONE, 0);

        vm.prank(player);
        vm.expectRevert(StellarArcade.TooEarly.selector);
        arcade.resolve(id, secret); // same block as enter
        vm.roll(ENTER_BLOCK + 1); // the hash block itself: its hash is not readable yet
        (bool ready, bool expired) = arcade.canResolve(id);
        assertFalse(ready || expired);
        vm.prank(player);
        vm.expectRevert(StellarArcade.TooEarly.selector);
        arcade.resolve(id, secret);

        // The last allowed block (enterBlock + 251) still works, checked on a throwaway state copy.
        uint256 lastBlock = ENTER_BLOCK + 1 + arcade.REVEAL_WINDOW();
        uint256 snap = vm.snapshotState();
        vm.roll(lastBlock);
        vm.setBlockhash(ENTER_BLOCK + 1, HASH);
        (ready, expired) = arcade.canResolve(id);
        assertTrue(ready && !expired);
        vm.prank(stranger);
        vm.expectRevert(StellarArcade.NotPlayer.selector);
        arcade.resolve(id, secret);
        vm.prank(player);
        vm.expectRevert(StellarArcade.BadReveal.selector);
        arcade.resolve(id, keccak256("wrong secret"));
        assertEq(_resolve(id, secret), 18e18);
        vm.prank(player);
        vm.expectRevert(StellarArcade.AlreadyResolved.selector);
        arcade.resolve(id, secret);
        vm.revertToState(snap);

        vm.roll(lastBlock + 1);
        vm.setBlockhash(ENTER_BLOCK + 1, HASH);
        (ready, expired) = arcade.canResolve(id);
        assertTrue(!ready && expired);
        vm.prank(player);
        vm.expectRevert(StellarArcade.Expired.selector);
        arcade.resolve(id, secret);
        assertEq(arcade.prizePool(), POOL + FEE, "the expired stake stays in the pool");
        assertFalse(arcade.getRun(id).resolved);
    }

    function test_Stats_PerGameAndPerPlayer() public {
        _equip(arcade, rival);
        bytes32 duelWin = _find(_duelWin);
        bytes32 duelLoss = _find(_duelLoss);
        bytes32 refund = _find(_tierRefund);
        bytes32 cardWin = _find(_cardWin);
        uint256 a = _enter(DUEL_ID, duelWin, NONE, 0);
        uint256 b = _enter(DUEL_ID, duelLoss, NONE, 0);
        uint256 c = _enter(TIERS_ID, refund, NONE, 0);
        _enter(RACE_ID, duelWin, NONE, 0); // never revealed: counted at entry, never settled
        uint256 e = _enter(arcade, rival, HIGHCARD_ID, cardWin, NONE, 0);
        _toRevealBlock();
        _resolve(a, duelWin);
        _resolve(b, duelLoss);
        _resolve(c, refund);
        _resolve(arcade, rival, e, cardWin);

        _assertGame(DUEL_ID, [uint256(2), 1, 20e18, 18e18]);
        _assertGame(TIERS_ID, [uint256(1), 0, 10e18, 10e18]);
        _assertGame(RACE_ID, [uint256(1), 0, 10e18, 0]);
        _assertGame(HIGHCARD_ID, [uint256(1), 1, 10e18, 19e18]);
        _assertGame(EXTRACT_ID, [uint256(0), 0, 0, 0]);
        _assertPlayer(player, [uint256(4), 1, 40e18, 28e18]);
        _assertPlayer(rival, [uint256(1), 1, 10e18, 19e18]);
    }

    /// want = [runs, wins, wagered, paidOut]
    function _assertGame(uint256 gameId, uint256[4] memory want) internal view {
        (uint256 runs, uint256 wins, uint256 wagered, uint256 paidOut) = arcade.gameStats(gameId);
        _assertStats([runs, wins, wagered, paidOut], want);
    }

    function _assertPlayer(address who, uint256[4] memory want) internal view {
        (uint256 runs, uint256 wins, uint256 wagered, uint256 paidOut) = arcade.stats(who);
        _assertStats([runs, wins, wagered, paidOut], want);
    }

    function _assertStats(uint256[4] memory got, uint256[4] memory want) internal pure {
        assertEq(got[0], want[0], "runs");
        assertEq(got[1], want[1], "wins");
        assertEq(got[2], want[2], "wagered");
        assertEq(got[3], want[3], "paidOut");
    }

    /// `rollsFor` agrees with an independent implementation of the plan's formulas on 300 seeds per kind.
    function test_RollsFor_MatchesThePlanFormulas() public view {
        for (uint256 i; i < 300; ++i) {
            bytes32 secret = keccak256(abi.encode("verify", i));
            uint256 s = _seed(secret);
            // Both values are below 4, so the casts are lossless.
            // forge-lint: disable-start(unsafe-typecast)
            uint8 lane = uint8(i % 4);
            uint8 item = uint8(i % 3); // DUEL and EXTRACT cycle through none, Sword, Shield
            // forge-lint: disable-end(unsafe-typecast)
            uint8 otherItem = item == SWORD ? SHIELD : item; // the other kinds take no Sword
            uint256 shieldBps = item == SHIELD ? 5000 : 0;
            uint256 loseBps = otherItem == SHIELD ? 5000 : 0;
            uint256 bonus = item == SWORD ? 10 : 0;

            _check(DUEL_ID, secret, item, 0, s % 100 < 48 + bonus ? 18_000 : shieldBps);
            _check(EXTRACT_ID, secret, item, 0, s % 100 < 35 + bonus ? 26_000 : shieldBps);
            uint256 r = s % 1000;
            _check(TIERS_ID, secret, otherItem, 0, r < 20 ? 50_000 : r < 200 ? 15_000 : r < 450 ? 10_000 : loseBps);
            _check(RACE_ID, secret, otherItem, lane, s % 4 == lane ? 36_000 : loseBps);
            (uint256 mine, uint256 house) = ((s % 52) % 13, ((s >> 64) % 52) % 13);
            _check(HIGHCARD_ID, secret, otherItem, 0, mine > house ? 19_000 : mine == house ? 10_000 : loseBps);
        }
    }

    function _check(uint256 gameId, bytes32 secret, uint8 item, uint8 choice, uint256 wantBps) internal view {
        (IStellarArcade.Outcome outcome, uint256 bps,,) = arcade.rollsFor(gameId, secret, HASH, item, choice);
        assertEq(bps, wantBps);
        if (bps > 10_000) assertGe(uint8(outcome), uint8(IStellarArcade.Outcome.WIN));
        else if (bps == 10_000) assertEq(uint8(outcome), uint8(IStellarArcade.Outcome.REFUND));
        else assertEq(uint8(outcome), uint8(IStellarArcade.Outcome.LOSE));
    }
}
