// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @notice Chainlink AggregatorV3Interface standard
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title  InhNAVOracle
/// @notice Minimal NAV oracle interface. Consumers must check `updatedAt` against their own staleness limit.
/// @author Ethereum Institutional / Nordhaven Bank
interface InhNAVOracle is AggregatorV3Interface {
    event NAVSubmitted(uint80 indexed roundId, int256 navEur, uint256 updatedAt);

    error InvalidNAV();

    /// @notice Publishes the NAV per share (EUR, 8 decimals, e.g. 100_00000000 = €100.00).
    function updateNAV(int256 navEur) external;
}
