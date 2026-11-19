// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IBondPriceOracle} from "./interfaces/IBondPriceOracle.sol";

/// @title  MockBondPriceOracle
/// @notice Mock Chainlink AggregatorV3 price feed reporting EUR sovereign bond prices.
/// @dev    Used for Sepolia testnet demonstration and Foundry unit/fuzz tests.
/// @author Ethereum Institutional / Nordhaven Bank
contract MockBondPriceOracle is IBondPriceOracle, AccessControl {
    /* ============ Constants ============ */

    bytes32 public constant ORACLE_FEEDER_ROLE = keccak256("ORACLE_FEEDER_ROLE");
    uint8 public constant DECIMALS = 8;
    string public constant DESCRIPTION = "Nordhaven EUR Sovereign Bond / EUR";
    uint256 public constant VERSION = 1;

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

    /// @inheritdoc IBondPriceOracle
    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    /// @inheritdoc IBondPriceOracle
    function description() external pure returns (string memory) {
        return DESCRIPTION;
    }

    /// @inheritdoc IBondPriceOracle
    function version() external pure returns (uint256) {
        return VERSION;
    }

    /// @inheritdoc IBondPriceOracle
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _price, _updatedAt, _updatedAt, _roundId);
    }
}
