// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Surface of StellarArcade (multi-cabinet commit-reveal engine) for the web app and the deploy script.
interface IStellarArcade {
    enum Genre {
        RPG,
        CARD,
        STRATEGY,
        ACTION,
        SURVIVAL,
        RACING
    }

    /// @dev DUEL: seed % 100 < winChancePct. TIERS: seed % 1000 < 30 jackpot 5x, < 330 win, < 630 refund.
    ///      RACE: seed % 4 == chosen lane. HIGHCARD: rank of seed % 52 vs (seed >> 64) % 52, tie refunds.
    ///      EXTRACT: like DUEL (the plan's default is 35% at 2.6x).
    enum Kind {
        DUEL,
        TIERS,
        RACE,
        HIGHCARD,
        EXTRACT
    }

    enum Outcome {
        LOSE,
        REFUND,
        WIN,
        JACKPOT
    }

    /// @dev Stored in two slots: `name` (< 32 bytes) and everything else packed.
    struct Game {
        string name;
        Genre genre;
        Kind kind;
        uint16 winChancePct; // DUEL and EXTRACT: win chance in percent, 1..90 (a Sword adds 10); 0 for other kinds
        uint128 entryFee; // VLAD wei per run, 0 < entryFee <= maxEntryFee
        uint16 winBps; // payout of a WIN in basis points of the stake (TIERS: the WIN tier; the jackpot is fixed 5x)
        bool active;
    }

    /// @dev `kind`, `winChancePct` and `winBps` are snapshotted at `enter`, so `setGame` never changes a running bet.
    struct Run {
        address player;
        uint64 enterBlock;
        uint8 item; // 0 none, 1 Sword, 2 Shield
        uint8 choice; // RACE lane 0..3
        Outcome outcome; // valid once resolved
        bool resolved;
        uint128 stake;
        uint128 payout; // after the pool cap, refunds and the Shield return included
        uint32 gameId;
        Kind kind;
        uint16 winChancePct;
        uint16 winBps;
        uint16 roll;
        uint16 houseRoll;
        bytes32 commit;
    }

    /// @dev `runs` counts entries (an unrevealed run still counts); `wins` counts WIN and JACKPOT;
    ///      `paidOut` includes refunds and Shield returns.
    struct Stats {
        uint256 runs;
        uint256 wins;
        uint256 wagered;
        uint256 paidOut;
    }

    function addGames(Game[] calldata list) external;
    function setGame(uint256 gameId, Game calldata game) external;
    function fundPool(uint256 amount) external;
    function enter(uint256 gameId, bytes32 commit, uint8 item, uint8 choice) external returns (uint256 id);
    function resolve(uint256 id, bytes32 secret) external;

    function prizePool() external view returns (uint256);
    function maxEntryFee() external view returns (uint256);
    function nextRunId() external view returns (uint256);
    function gameCount() external view returns (uint256);
    function getGame(uint256 gameId) external view returns (Game memory);
    function getRun(uint256 id) external view returns (Run memory);
    function canResolve(uint256 id) external view returns (bool ready, bool expired);
    function commitmentOf(bytes32 secret, address player) external pure returns (bytes32);
    function rollsFor(uint256 gameId, bytes32 secret, bytes32 blockHash, uint8 item, uint8 choice)
        external
        view
        returns (Outcome outcome, uint256 payoutBps, uint16 roll, uint16 houseRoll);
}
