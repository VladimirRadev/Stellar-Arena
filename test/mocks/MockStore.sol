// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Minimal stand-in for the ERC-1155 StellarStore: `consume` burns and `award` mints, both GAME_ROLE-gated.
contract MockStore is ERC1155, AccessControl {
    bytes32 public constant GAME_ROLE = keccak256("GAME_ROLE");
    uint256 public constant SWORD = 1;
    uint256 public constant SHIELD = 2;
    uint256 public constant TROPHY = 3;
    address public treasury;

    constructor() ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function consume(address from, uint256 id, uint256 amount) external onlyRole(GAME_ROLE) {
        _burn(from, id, amount);
    }

    function award(address to, uint256 id, uint256 amount) external onlyRole(GAME_ROLE) {
        _mint(to, id, amount, "");
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = treasury_;
    }

    /// @dev Test helper standing in for buying an item in the real store.
    function mintItem(address to, uint256 id, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _mint(to, id, amount, "");
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
