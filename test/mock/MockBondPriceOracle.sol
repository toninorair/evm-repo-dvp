// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ICollateralPriceOracle } from "../../src/interfaces/ICollateralPriceOracle.sol";

/// @title  MockBondPriceOracle
/// @notice Mock Chainlink AggregatorV3 price feed reporting EUR sovereign bond prices.
/// @dev    Used for Sepolia testnet demonstration and Foundry unit/fuzz tests.
/// @author Ethereum Institutional / Nordhaven Bank
contract MockBondPriceOracle is ICollateralPriceOracle, AccessControl {
    /* ============ Constants ============ */

    bytes32 public constant ORACLE_FEEDER_ROLE = keccak256("ORACLE_FEEDER_ROLE");

    /* ============ Storage ============ */

    uint80 private _roundId;
    int256 private _price;
    uint256 private _updatedAt;

    /* ============ Constructor ============ */

    /// @notice Constructs the MockBondPriceOracle contract.
    /// @param  admin        Address granted DEFAULT_ADMIN_ROLE and ORACLE_FEEDER_ROLE.
    /// @param  initialPrice Initial bond price in EUR with 8 decimals (e.g., 100_00000000 = €100.00 par).
    constructor(address admin, int256 initialPrice) {
        if (admin == address(0)) revert InvalidPrice();
        if (initialPrice <= 0) revert InvalidPrice();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_FEEDER_ROLE, admin);

        _roundId = 1;
        _price = initialPrice;
        _updatedAt = block.timestamp;
    }

    /* ============ Interactive Functions ============ */

    /// @notice Updates the bond price feed.
    /// @param  newPrice The updated price with 8 decimals.
    function updatePrice(int256 newPrice) external onlyRole(ORACLE_FEEDER_ROLE) {
        if (newPrice <= 0) revert InvalidPrice();

        unchecked {
            ++_roundId;
        }
        _price = newPrice;
        _updatedAt = block.timestamp;

        emit BondPriceUpdated(_roundId, newPrice, block.timestamp);
    }

    /* ============ View Functions ============ */

    /// @inheritdoc ICollateralPriceOracle
    function decimals() external pure returns (uint8) {
        return 8;
    }

    /// @inheritdoc ICollateralPriceOracle
    function description() external pure returns (string memory) {
        return "Nordhaven EUR Sovereign Bond / EUR";
    }

    /// @inheritdoc ICollateralPriceOracle
    function version() external pure returns (uint256) {
        return 1;
    }

    /// @inheritdoc ICollateralPriceOracle
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _price, _updatedAt, _updatedAt, _roundId);
    }
}
