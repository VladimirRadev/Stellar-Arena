// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStellarStore} from "./interfaces/IStellarStore.sol";

/// @title StellarArena - a solo "play for keeps" combat run, provably fair through commit-reveal + a future blockhash.
/// @notice 1) Pick a random 32-byte secret off-chain. 2) `enter` with commit = keccak256(abi.encode(secret, you)) and
///         an optional item (the item is burned, the entry fee is escrowed). 3) Wait until block enterBlock + 2.
///         4) `resolve` with the secret. Seed = keccak256(abi.encode(secret, blockhash(enterBlock + 1))): the player
///         fixed the secret before that block existed, and the block producer never saw the secret.
contract StellarArena is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant NO_ITEM = 0;
    uint8 public constant SWORD = 1; // StellarStore token id
    uint8 public constant SHIELD = 2; // StellarStore token id
    uint256 public constant TROPHY = 3; // StellarStore token id
    uint256 public constant SWORD_BONUS = 10;
    uint256 public constant SHIELD_REFUND_BPS = 5000;
    uint256 public constant REVEAL_WINDOW = 250; // blocks, counted from enterBlock + 1 (the hash block)
    uint256 public constant MAX_WIN_BPS = 30_000;

    IERC20 public immutable vlad;
    IStellarStore public immutable store;
    uint256 public entryFee;
    uint256 public winBps;
    uint256 public nextRunId;

    /// @dev `stake` and `winBps` are snapshotted at entry, so a later `setParams` never changes a running bet.
    struct Run {
        address player;
        uint128 stake;
        uint64 enterBlock;
        uint8 item;
        bool resolved;
        bool won;
        bytes32 commit;
        uint8 playerRoll;
        uint8 enemyRoll;
        uint16 winBps;
    }

    /// @dev `runs` counts entries (so an unrevealed loss still counts); `paidOut` includes Shield refunds.
    struct PlayerStats {
        uint256 runs;
        uint256 wins;
        uint256 paidOut;
    }

    mapping(uint256 => Run) public runs;
    mapping(address => PlayerStats) public stats;
    uint256 public totalRuns;
    uint256 public totalWins;
    uint256 public totalPaidOut;

    event Entered(uint256 indexed id, address indexed player, uint8 item, uint256 stake, uint64 enterBlock);
    event Resolved(
        uint256 indexed id, address indexed player, bool won, uint8 playerRoll, uint8 enemyRoll, uint256 payout
    );
    event ParamsUpdated(uint256 entryFee, uint256 winBps);
    event PoolFunded(address indexed from, uint256 amount);

    error BadItem();
    error NotPlayer();
    error AlreadyResolved();
    error TooEarly();
    error Expired();
    error BadReveal();
    error ZeroCommit();
    error BadParams();

    constructor(IERC20 vlad_, IStellarStore store_, uint256 entryFee_, uint256 winBps_) Ownable(msg.sender) {
        vlad = vlad_;
        store = store_;
        _setParams(entryFee_, winBps_);
    }

    /// @notice Start a run: burns `item` (0 = none, 1 = Sword, 2 = Shield) and escrows `entryFee` VLAD.
    function enter(bytes32 commit, uint8 item) external nonReentrant returns (uint256 id) {
        if (item > SHIELD) revert BadItem();
        if (commit == bytes32(0)) revert ZeroCommit();
        // Safe casts: _setParams enforces entryFee <= type(uint128).max and winBps <= MAX_WIN_BPS (30_000).
        // forge-lint: disable-next-line(unsafe-typecast)
        (uint128 stake, uint16 bps) = (uint128(entryFee), uint16(winBps));
        id = nextRunId++;
        runs[id] = Run(msg.sender, stake, uint64(block.number), item, false, false, commit, 0, 0, bps);
        totalRuns++;
        stats[msg.sender].runs++;
        if (item != NO_ITEM) store.consume(msg.sender, item, 1);
        vlad.safeTransferFrom(msg.sender, address(this), stake);
        emit Entered(id, msg.sender, item, stake, uint64(block.number));
    }

    /// @notice Reveal the secret and fight. Allowed from block enterBlock + 2 through enterBlock + 1 + REVEAL_WINDOW.
    function resolve(uint256 id, bytes32 secret) external nonReentrant {
        Run storage r = runs[id];
        if (r.player != msg.sender) revert NotPlayer();
        if (r.resolved) revert AlreadyResolved();
        uint256 hashBlock = uint256(r.enterBlock) + 1;
        if (block.number <= hashBlock) revert TooEarly();
        if (block.number > hashBlock + REVEAL_WINDOW) revert Expired(); // stake stays in the pool
        if (commitmentOf(secret, msg.sender) != r.commit) revert BadReveal();

        (uint8 playerRoll, uint8 enemyRoll) = rollsFor(secret, blockhash(hashBlock), r.item);
        bool won = playerRoll > enemyRoll;
        uint256 payout;
        if (won) payout = uint256(r.stake) * r.winBps / 1e4;
        else if (r.item == SHIELD) payout = uint256(r.stake) * SHIELD_REFUND_BPS / 1e4;
        uint256 pool = vlad.balanceOf(address(this));
        if (payout > pool) payout = pool;

        r.resolved = true;
        r.won = won;
        r.playerRoll = playerRoll;
        r.enemyRoll = enemyRoll;
        PlayerStats storage s = stats[msg.sender];
        if (won) {
            totalWins++;
            s.wins++;
        }
        totalPaidOut += payout;
        s.paidOut += payout;

        if (payout != 0) vlad.safeTransfer(msg.sender, payout);
        if (won) store.award(msg.sender, TROPHY, 1);
        emit Resolved(id, msg.sender, won, playerRoll, enemyRoll, payout);
    }

    /// @notice Anyone can top up the prize pool with VLAD.
    function fundPool(uint256 amount) external nonReentrant {
        vlad.safeTransferFrom(msg.sender, address(this), amount);
        emit PoolFunded(msg.sender, amount);
    }

    function setParams(uint256 entryFee_, uint256 winBps_) external onlyOwner {
        _setParams(entryFee_, winBps_);
    }

    function commitmentOf(bytes32 secret, address player) public pure returns (bytes32) {
        return keccak256(abi.encode(secret, player));
    }

    /// @notice The exact roll formula, public so anyone can recompute a result from the secret and the blockhash.
    function rollsFor(bytes32 secret, bytes32 blockHash, uint8 item)
        public
        pure
        returns (uint8 playerRoll, uint8 enemyRoll)
    {
        uint256 seed = uint256(keccak256(abi.encode(secret, blockHash)));
        // forge-lint: disable-next-line(unsafe-typecast)
        playerRoll = uint8(seed % 100 + 1 + (item == SWORD ? SWORD_BONUS : 0)); // 1..110
        enemyRoll = uint8((seed >> 128) % 100 + 1); // 1..100
    }

    function prizePool() external view returns (uint256) {
        return vlad.balanceOf(address(this));
    }

    function getRun(uint256 id) external view returns (Run memory) {
        return runs[id];
    }

    /// @return ready true when `resolve` can succeed in the current block; expired true once the window has closed.
    function canResolve(uint256 id) external view returns (bool ready, bool expired) {
        Run storage r = runs[id];
        if (r.player == address(0) || r.resolved) return (false, false);
        uint256 hashBlock = uint256(r.enterBlock) + 1;
        expired = block.number > hashBlock + REVEAL_WINDOW;
        ready = block.number > hashBlock && !expired;
    }

    function _setParams(uint256 entryFee_, uint256 winBps_) internal {
        if (entryFee_ == 0 || entryFee_ > type(uint128).max || winBps_ > MAX_WIN_BPS) revert BadParams();
        (entryFee, winBps) = (entryFee_, winBps_);
        emit ParamsUpdated(entryFee_, winBps_);
    }
}
