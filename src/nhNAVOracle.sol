// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { InhNAVOracle } from "./interfaces/InhNAVOracle.sol";

/// @title  nhNAVOracle
/// @notice Minimal Chainlink AggregatorV3-compatible NAV oracle. Consumers check `updatedAt` for staleness.
/// @author Ethereum Institutional / Nordhaven Bank
contract nhNAVOracle is InhNAVOracle, AccessControl {
    bytes32 public constant CALCULATION_AGENT_ROLE = keccak256("CALCULATION_AGENT_ROLE");

    uint80 private _roundId;
    int256 private _price;
    uint256 private _updatedAt;

    constructor(address admin, address calculationAgent) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CALCULATION_AGENT_ROLE, calculationAgent);
    }

    /// @inheritdoc InhNAVOracle
    function updateNAV(int256 navEur) external onlyRole(CALCULATION_AGENT_ROLE) {
        if (navEur <= 0) revert InvalidNAV();
        emit NAVSubmitted(++_roundId, _price = navEur, _updatedAt = block.timestamp);
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

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _price, _updatedAt, _updatedAt, _roundId);
    }
}
