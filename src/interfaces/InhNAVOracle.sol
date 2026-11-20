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
/// @notice Production NAV Oracle interface for tokenised sovereign bond funds and money market funds.
/// @dev    Modeled after BlackRock BUIDL, Ondo Finance RWAOracle, and Chainlink NavLink.
/// @author Ethereum Institutional / Nordhaven Bank
interface InhNAVOracle is AggregatorV3Interface {
    /* ============ Events ============ */

    event NAVSubmitted(
        uint80 indexed roundId,
        int256 navEur,
        uint256 totalAUM,
        uint256 totalShares,
        bytes32 auditHash,
        uint256 timestamp
    );
    event CalculationAgentUpdated(address indexed previousAgent, address indexed newAgent);
    event MaxStalenessPeriodUpdated(uint256 newPeriod);
    event MaxDailyDeviationBpsUpdated(uint256 newDeviationBps);

    /* ============ Custom Errors ============ */

    error UnauthorizedCalculationAgent();
    error StalePrice(uint256 lastUpdatedAt, uint256 currentTimestamp);
    error PriceDeviationExceeded(int256 previousPrice, int256 submittedPrice, uint256 deviationBps);
    error InvalidNAV();
    error ZeroAdmin();
    error ZeroCalculationAgent();
    error RoundNotComplete();

    /* ============ Interactive Functions ============ */

    /// @notice Ingests certified daily NAV from the designated institutional Fund Administrator.
    /// @param  navEur          NAV per share denominated in EUR (8 decimals, e.g. 100_00000000 = €100.00).
    /// @param  totalAUM        Total Fund Net Asset Value in EUR (18 decimals).
    /// @param  totalShares     Total Fund tokenised shares outstanding.
    /// @param  auditReportHash Cryptographic IPFS/SHA-256 hash of the external auditor NAV report.
    function submitDailyNAV(int256 navEur, uint256 totalAUM, uint256 totalShares, bytes32 auditReportHash) external;

    /// @notice Updates the designated calculation agent address.
    function setCalculationAgent(address newAgent) external;

    /// @notice Updates the maximum staleness tolerance in seconds.
    function setMaxStalenessPeriod(uint256 newPeriod) external;

    /// @notice Updates the maximum allowed daily price deviation in basis points.
    function setMaxDailyDeviationBps(uint256 newDeviationBps) external;

    /* ============ View Functions ============ */

    function calculationAgent() external view returns (address);
    function maxStalenessPeriod() external view returns (uint256);
    function maxDailyDeviationBps() external view returns (uint256);
    function lastAuditReportHash() external view returns (bytes32);
    function totalAUM() external view returns (uint256);
    function totalShares() external view returns (uint256);
}
