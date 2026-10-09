// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStellarStore} from "./interfaces/IStellarStore.sol";
import {IStellarArcade} from "./interfaces/IStellarArcade.sol";

/// @title StellarArcade - many provably fair cabinets on one engine, with the Arena's commit-reveal flow.
/// @notice 1) Pick a random 32-byte secret off-chain. 2) `enter(gameId, commit, item, choice)` with
///         commit = keccak256(abi.encode(secret, you)); the item is burned and the cabinet's entry fee is escrowed.
///         3) From block enterBlock + 2 through enterBlock + 251, `resolve` with the secret.
///         Seed = keccak256(abi.encode(secret, blockhash(enterBlock + 1))); `rollsFor` maps it to a result per kind:
///         DUEL/EXTRACT win when seed % 100 < winChancePct (+10 with a Sword); TIERS rolls seed % 1000 (< 30 jackpot
///         5x, < 330 win, < 630 refund); RACE wins when seed % 4 equals the chosen lane; HIGHCARD compares the ranks
///         of seed % 52 and (seed >> 64) % 52 (a tie refunds). A Shield returns half the stake on a loss.
contract StellarArcade is IStellarArcade, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant NO_ITEM = 0;
    uint8 public constant SWORD = 1; // StellarStore token id
    uint8 public constant SHIELD = 2; // StellarStore token id
    uint256 public constant TROPHY = 3; // StellarStore token id
    uint16 public constant SWORD_BONUS = 10; // win-chance points on DUEL and EXTRACT
    uint256 public constant SHIELD_REFUND_BPS = 5000;
    uint256 public constant JACKPOT_BPS = 50_000; // TIERS jackpot pays 5x
    // TIERS bands on seed % 1000: jackpot 3%, win 30%, refund 30%, lose 37%. Expected return at the 1.5x win tier:
    // 0.03 x 5 + 0.30 x 1.5 + 0.30 x 1 = 0.90 per VLAD staked (10% house edge).
    uint16 public constant TIERS_JACKPOT_BELOW = 30;
    uint16 public constant TIERS_WIN_BELOW = 330;
    uint16 public constant TIERS_REFUND_BELOW = 630;
    uint256 public constant MAX_WIN_BPS = 50_000;
    uint8 public constant LANES = 4;
    uint256 public constant REVEAL_WINDOW = 250; // blocks, counted from enterBlock + 1 (the hash block)

    IERC20 public immutable vlad;
    IStellarStore public immutable store;
    uint256 public immutable maxEntryFee; // caps every cabinet's fee, so the largest payout is 5 x maxEntryFee

    Game[] internal _games;
    uint256 public nextRunId;
    mapping(uint256 => Run) internal _runs;
    mapping(uint256 => Stats) public gameStats;
    mapping(address => Stats) public stats;

    event GameAdded(uint256 indexed gameId, string name, Kind kind);
    event GameUpdated(uint256 indexed gameId, string name, Kind kind, bool active);
    event Entered(
        uint256 indexed id,
        uint256 indexed gameId,
        address indexed player,
        uint8 item,
        uint8 choice,
        uint256 stake,
        uint64 enterBlock
    );
    event Resolved(
        uint256 indexed id,
        uint256 indexed gameId,
        address indexed player,
        Outcome outcome,
        uint16 roll,
        uint16 houseRoll,
        uint256 payout
    );
    event PoolFunded(address indexed from, uint256 amount);

    error UnknownGame();
    error GameInactive();
    error BadGame();
    error BadItem();
    error BadChoice();
    error ZeroCommit();
    error NotPlayer();
    error AlreadyResolved();
    error TooEarly();
    error Expired();
    error BadReveal();
    error BadParams();

    constructor(IERC20 vlad_, IStellarStore store_, uint256 maxEntryFee_) Ownable(msg.sender) {
        // A uint96 fee keeps 5 x fee far inside the uint128 payout field.
        if (maxEntryFee_ == 0 || maxEntryFee_ > type(uint96).max) revert BadParams();
        (vlad, store, maxEntryFee) = (vlad_, store_, maxEntryFee_);
    }

    // ------------------------------------------------------------------ admin

    /// @notice Registers cabinets in one transaction; ids continue from `gameCount()`.
    function addGames(Game[] calldata list) external onlyOwner {
        for (uint256 i; i < list.length; ++i) {
            _check(list[i]);
            _games.push(list[i]);
            emit GameAdded(_games.length - 1, list[i].name, list[i].kind);
        }
    }

    /// @notice Replaces a cabinet (rules, fee, `active`). Open runs keep the rules snapshotted at their `enter`.
    function setGame(uint256 gameId, Game calldata game) external onlyOwner {
        if (gameId >= _games.length) revert UnknownGame();
        _check(game);
        _games[gameId] = game;
        emit GameUpdated(gameId, game.name, game.kind, game.active);
    }

    /// @notice Anyone can top up the shared prize pool with VLAD.
    function fundPool(uint256 amount) external nonReentrant {
        vlad.safeTransferFrom(msg.sender, address(this), amount);
        emit PoolFunded(msg.sender, amount);
    }

    // ------------------------------------------------------------------ play

    /// @notice Start a run. `item`: 0 none, 1 Sword (DUEL and EXTRACT only, +10 win-chance points), 2 Shield (half
    ///         the stake back on a loss). `choice`: the lane 0..3 on RACE, ignored by the other kinds.
    function enter(uint256 gameId, bytes32 commit, uint8 item, uint8 choice)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (gameId >= _games.length) revert UnknownGame();
        Game storage g = _games[gameId];
        if (!g.active) revert GameInactive();
        if (commit == bytes32(0)) revert ZeroCommit();
        Kind kind = g.kind;
        if (item > SHIELD || (item == SWORD && kind != Kind.DUEL && kind != Kind.EXTRACT)) revert BadItem();
        if (kind == Kind.RACE && choice >= LANES) revert BadChoice();
        uint128 stake = g.entryFee;
        id = nextRunId++;
        Run storage r = _runs[id];
        (r.player, r.enterBlock, r.item, r.choice, r.stake) = (msg.sender, uint64(block.number), item, choice, stake);
        // Safe cast: one id per registered cabinet, far below 2^32.
        // forge-lint: disable-next-line(unsafe-typecast)
        (r.gameId, r.kind, r.winChancePct, r.winBps) = (uint32(gameId), kind, g.winChancePct, g.winBps);
        r.commit = commit;
        _count(gameStats[gameId], stake);
        _count(stats[msg.sender], stake);
        if (item != NO_ITEM) store.consume(msg.sender, item, 1);
        vlad.safeTransferFrom(msg.sender, address(this), stake);
        emit Entered(id, gameId, msg.sender, item, choice, stake, uint64(block.number));
    }

    /// @notice Reveal the secret and play. Allowed from block enterBlock + 2 through enterBlock + 1 + REVEAL_WINDOW.
    function resolve(uint256 id, bytes32 secret) external nonReentrant {
        Run storage r = _runs[id];
        if (r.player != msg.sender) revert NotPlayer();
        if (r.resolved) revert AlreadyResolved();
        uint256 hashBlock = uint256(r.enterBlock) + 1;
        if (block.number <= hashBlock) revert TooEarly();
        if (block.number > hashBlock + REVEAL_WINDOW) revert Expired(); // the stake stays in the pool
        if (commitmentOf(secret, msg.sender) != r.commit) revert BadReveal();

        uint256 payout = _play(r, secret, blockhash(hashBlock));
        bool won = r.outcome >= Outcome.WIN;
        _settle(gameStats[r.gameId], won, payout);
        _settle(stats[msg.sender], won, payout);

        if (payout != 0) vlad.safeTransfer(msg.sender, payout);
        if (won) store.award(msg.sender, TROPHY, 1);
        emit Resolved(id, r.gameId, msg.sender, r.outcome, r.roll, r.houseRoll, payout);
    }

    // ------------------------------------------------------------------ verification

    function commitmentOf(bytes32 secret, address player) public pure returns (bytes32) {
        return keccak256(abi.encode(secret, player));
    }

    /// @notice Recomputes a result with the cabinet's current rules; `resolve` applies exactly this formula to the
    ///         rules snapshotted in the run (`getRun`), which are the same unless `setGame` changed the cabinet since.
    /// @return outcome LOSE, REFUND, WIN or JACKPOT. payoutBps: payout in basis points of the stake before the pool
    ///         cap (Shield included). roll / houseRoll per kind: DUEL, EXTRACT = d100 roll 0..99 / win threshold
    ///         (win if roll < threshold); TIERS = 0..999 / 0; RACE = winning lane / your lane; HIGHCARD = your card /
    ///         house card, both 0..51 with rank = card % 13 (0 is a two, 12 is an ace).
    function rollsFor(uint256 gameId, bytes32 secret, bytes32 blockHash, uint8 item, uint8 choice)
        external
        view
        returns (Outcome outcome, uint256 payoutBps, uint16 roll, uint16 houseRoll)
    {
        if (gameId >= _games.length) revert UnknownGame();
        Game storage g = _games[gameId];
        return _outcome(g.kind, g.winChancePct, g.winBps, secret, blockHash, item, choice);
    }

    // ------------------------------------------------------------------ views

    function prizePool() external view returns (uint256) {
        return vlad.balanceOf(address(this));
    }

    function gameCount() external view returns (uint256) {
        return _games.length;
    }

    function getGame(uint256 gameId) external view returns (Game memory) {
        if (gameId >= _games.length) revert UnknownGame();
        return _games[gameId];
    }

    function getRun(uint256 id) external view returns (Run memory) {
        return _runs[id];
    }

    /// @return ready true when `resolve` can succeed in the current block; expired true once the window has closed.
    function canResolve(uint256 id) external view returns (bool ready, bool expired) {
        Run storage r = _runs[id];
        if (r.player == address(0) || r.resolved) return (false, false);
        uint256 hashBlock = uint256(r.enterBlock) + 1;
        expired = block.number > hashBlock + REVEAL_WINDOW;
        ready = block.number > hashBlock && !expired;
    }

    // ------------------------------------------------------------------ internals

    /// @dev The exact result formula shared by `resolve` and `rollsFor`.
    function _outcome(
        Kind kind,
        uint16 winChancePct,
        uint16 winBps,
        bytes32 secret,
        bytes32 blockHash,
        uint8 item,
        uint8 choice
    ) internal pure returns (Outcome outcome, uint256 payoutBps, uint16 roll, uint16 houseRoll) {
        uint256 seed = uint256(keccak256(abi.encode(secret, blockHash)));
        // Every cast below is of a value under 1000.
        // forge-lint: disable-start(unsafe-typecast)
        if (kind == Kind.DUEL || kind == Kind.EXTRACT) {
            (roll, houseRoll) = (uint16(seed % 100), winChancePct + (item == SWORD ? SWORD_BONUS : 0));
            if (roll < houseRoll) outcome = Outcome.WIN;
        } else if (kind == Kind.TIERS) {
            roll = uint16(seed % 1000);
            if (roll < TIERS_JACKPOT_BELOW) outcome = Outcome.JACKPOT;
            else if (roll < TIERS_WIN_BELOW) outcome = Outcome.WIN;
            else if (roll < TIERS_REFUND_BELOW) outcome = Outcome.REFUND;
        } else if (kind == Kind.RACE) {
            (roll, houseRoll) = (uint16(seed % LANES), choice);
            if (roll == choice) outcome = Outcome.WIN;
        } else {
            (roll, houseRoll) = (uint16(seed % 52), uint16((seed >> 64) % 52));
            if (roll % 13 > houseRoll % 13) outcome = Outcome.WIN;
            else if (roll % 13 == houseRoll % 13) outcome = Outcome.REFUND;
        }
        // forge-lint: disable-end(unsafe-typecast)
        if (outcome == Outcome.JACKPOT) payoutBps = JACKPOT_BPS;
        else if (outcome == Outcome.WIN) payoutBps = winBps;
        else if (outcome == Outcome.REFUND) payoutBps = 1e4;
        else if (item == SHIELD) payoutBps = SHIELD_REFUND_BPS;
    }

    /// @dev Computes the result with the run's snapshotted rules, caps the payout by the pool, records it in the run.
    function _play(Run storage r, bytes32 secret, bytes32 blockHash) internal returns (uint256 payout) {
        (Outcome outcome, uint256 payoutBps, uint16 roll, uint16 houseRoll) =
            _outcome(r.kind, r.winChancePct, r.winBps, secret, blockHash, r.item, r.choice);
        payout = uint256(r.stake) * payoutBps / 1e4;
        uint256 pool = vlad.balanceOf(address(this));
        if (payout > pool) payout = pool;
        r.resolved = true;
        r.outcome = outcome;
        r.roll = roll;
        r.houseRoll = houseRoll;
        // Safe cast: stake <= maxEntryFee < 2^96 and payoutBps <= 50_000, so payout < 2^112.
        // forge-lint: disable-next-line(unsafe-typecast)
        r.payout = uint128(payout);
    }

    function _check(Game calldata g) internal view {
        bool chanceKind = g.kind == Kind.DUEL || g.kind == Kind.EXTRACT;
        // A Sword adds 10 points, so DUEL and EXTRACT allow 1..90; the other kinds must leave the field at 0.
        bool badChance = chanceKind ? g.winChancePct == 0 || g.winChancePct > 100 - SWORD_BONUS : g.winChancePct != 0;
        if (
            bytes(g.name).length == 0 || g.entryFee == 0 || g.entryFee > maxEntryFee || g.winBps <= 1e4
                || g.winBps > MAX_WIN_BPS || badChance
        ) revert BadGame();
    }

    function _count(Stats storage s, uint128 stake) internal {
        s.runs++;
        s.wagered += stake;
    }

    function _settle(Stats storage s, bool won, uint256 payout) internal {
        if (won) s.wins++;
        s.paidOut += payout;
    }
}
