// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title  ICollateralPriceOracle
/// @notice Chainlink AggregatorV3-compatible price feed interface for tokenised sovereign bonds.
/// @dev    Reports European sovereign bond prices denominated in EUR with 8 decimals (e.g. 98_50000000 = €98.50 per 100 par).
/// @author Ethereum Institutional / Nordhaven Bank
interface ICollateralPriceOracle {
    /* ============ Events ============ */

    /// @notice Emitted when the bond price feed is updated.
    /// @param  roundId   The round identifier.
    /// @param  price     The updated bond price in EUR (8 decimals).
    /// @param  timestamp The block timestamp of the update.
    event BondPriceUpdated(uint80 indexed roundId, int256 price, uint256 timestamp);

    /* ============ Custom Errors ============ */

    /// @notice Thrown when price is non-positive.
    error InvalidPrice();

    /* ============ View Functions ============ */

    /// @notice Returns the number of decimals used by the price feed (standard: 8).
    function decimals() external view returns (uint8);

    /// @notice Returns a human-readable description of the price feed.
    function description() external view returns (string memory);

    /// @notice Returns the version number of the aggregator.
    function version() external view returns (uint256);

    /// @notice Returns the latest round data conforming to Chainlink AggregatorV3.
    /// @return roundId         The round ID.
    /// @return answer          The latest bond price (e.g., 99_25000000 = €99.25).
    /// @return startedAt       Timestamp when round started.
    /// @return updatedAt       Timestamp when price was updated.
    /// @return answeredInRound Round ID in which answer was computed.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
