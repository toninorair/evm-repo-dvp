// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { InhNAVOracle } from "./interfaces/InhNAVOracle.sol";

/// @title  nhNAVOracle
/// @notice Minimal Chainlink AggregatorV3-compatible NAV oracle for the POC.
/// @dev    Stores the latest positive NAV attested by `CALCULATION_AGENT_ROLE` and exposes `updatedAt` via
///         `latestRoundData()` without enforcing an on-chain staleness cutoff.
/// @author Ethereum Institutional / Nordhaven Bank
contract nhNAVOracle is InhNAVOracle, AccessControl {
    bytes32 public constant CALCULATION_AGENT_ROLE = keccak256("CALCULATION_AGENT_ROLE");

    uint80 private _roundId;
    int256 private _price;
    uint256 private _updatedAt;

    constructor(address admin, address calculationAgent) {
        if (admin == address(0) || calculationAgent == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CALCULATION_AGENT_ROLE, calculationAgent);
    }

    /// @inheritdoc InhNAVOracle
    function updateNAV(int256 navEur) external onlyRole(CALCULATION_AGENT_ROLE) {
        if (navEur <= 0) revert InvalidNAV();

        ++_roundId;
        _price = navEur;
        _updatedAt = block.timestamp;

        emit NAVSubmitted(_roundId, _price, _updatedAt);
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "Nordhaven EUR Sovereign Fund NAV / EUR";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function latestRoundData() public view returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _price, _updatedAt, _updatedAt, _roundId);
    }

    /// @notice Returns the latest positive NAV (8 decimals); reverts with `InvalidNAV` if unset or `<= 0`.
    function getCollateralPrice() public view returns (uint256) {
        (, int256 price, , , ) = latestRoundData();
        if (price <= 0) revert InvalidNAV();
        return uint256(price);
    }
}
