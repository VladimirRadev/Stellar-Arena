// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IStellarStore {
    function GAME_ROLE() external view returns (bytes32);
    function SWORD() external view returns (uint256);
    function SHIELD() external view returns (uint256);
    function TROPHY() external view returns (uint256);
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function consume(address from, uint256 id, uint256 amount) external;
    function award(address to, uint256 id, uint256 amount) external;
    function grantRole(bytes32 role, address account) external;
    function setTreasury(address treasury) external;
}
