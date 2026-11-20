// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {InhNAVOracle} from "./interfaces/InhNAVOracle.sol";

/// @title  nhNAVOracle
/// @notice Production-grade NAV Oracle for tokenised European sovereign bond & money market funds.
/// @dev    Conforms to Chainlink AggregatorV3Interface. Modeled after BlackRock BUIDL, Ondo Finance RWAOracle, and Chainlink NavLink.
/// @author Ethereum Institutional / Nordhaven Bank
contract nhNAVOracle is InhNAVOracle, AccessControl {
    /* ============ Constants ============ */

    uint8 public constant DECIMALS = 8;
    string public constant DESCRIPTION = "Nordhaven EUR Sovereign Fund NAV / EUR";
    uint256 public constant VERSION = 1;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    bytes32 public constant CALCULATION_AGENT_ROLE = keccak256("CALCULATION_AGENT_ROLE");

    /* ============ Storage ============ */

    uint80 private _roundId;
    int256 private _price;
    uint256 private _updatedAt;

    uint256 private _totalAUM;
    uint256 private _totalShares;
    bytes32 private _lastAuditReportHash;

    address private _calculationAgent;
    uint256 private _maxStalenessPeriod;
    uint256 private _maxDailyDeviationBps;

    /* ============ Constructor ============ */

    /// @notice Constructs the nhNAVOracle contract.
    /// @param  admin                Address granted DEFAULT_ADMIN_ROLE.
    /// @param  calculationAgent_    Address granted CALCULATION_AGENT_ROLE (Fund Administrator).
    /// @param  initialNAV           Initial NAV per share with 8 decimals (e.g. 100_00000000 = €100.00).
    /// @param  maxStalenessSeconds  Maximum allowed staleness period (e.g., 86,400 = 24 hours).
    /// @param  maxDeviationBps      Maximum allowed daily price movement in bps (e.g., 50 = 0.50%).
    constructor(
        address admin,
        address calculationAgent_,
        int256 initialNAV,
        uint256 maxStalenessSeconds,
        uint256 maxDeviationBps
    ) {
        if (admin == address(0)) revert ZeroAdmin();
        if (calculationAgent_ == address(0)) revert ZeroCalculationAgent();
        if (initialNAV <= 0) revert InvalidNAV();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CALCULATION_AGENT_ROLE, calculationAgent_);

        _calculationAgent = calculationAgent_;
        _maxStalenessPeriod = maxStalenessSeconds == 0 ? 86_400 : maxStalenessSeconds;
        _maxDailyDeviationBps = maxDeviationBps == 0 ? 100 : maxDeviationBps; // default 1.00%

        _roundId = 1;
        _price = initialNAV;
        _updatedAt = block.timestamp;
        _totalAUM = 100_000_000 ether;
        _totalShares = 1_000_000 ether;
        _lastAuditReportHash = keccak256("GENESIS_NAV_AUDIT_REPORT");
    }

    /* ============ Interactive Functions ============ */

    /// @inheritdoc InhNAVOracle
    function submitDailyNAV(int256 navEur, uint256 totalAUM_, uint256 totalShares_, bytes32 auditReportHash)
        external
        onlyRole(CALCULATION_AGENT_ROLE)
    {
        if (navEur <= 0) revert InvalidNAV();

        // Check price deviation circuit breaker if previous price exists
        if (_price > 0 && _maxDailyDeviationBps > 0) {
            uint256 delta = navEur > _price ? uint256(navEur - _price) : uint256(_price - navEur);
            uint256 deviationBps = (delta * BPS_DENOMINATOR) / uint256(_price);
            if (deviationBps > _maxDailyDeviationBps) {
                revert PriceDeviationExceeded(_price, navEur, deviationBps);
            }
        }

        unchecked {
            ++_roundId;
        }

        _price = navEur;
        _updatedAt = block.timestamp;
        _totalAUM = totalAUM_;
        _totalShares = totalShares_;
        _lastAuditReportHash = auditReportHash;

        emit NAVSubmitted(_roundId, navEur, totalAUM_, totalShares_, auditReportHash, block.timestamp);
    }

    /// @inheritdoc InhNAVOracle
    function setCalculationAgent(address newAgent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newAgent == address(0)) revert ZeroCalculationAgent();
        address oldAgent = _calculationAgent;
        _revokeRole(CALCULATION_AGENT_ROLE, oldAgent);
        _grantRole(CALCULATION_AGENT_ROLE, newAgent);
        _calculationAgent = newAgent;
        emit CalculationAgentUpdated(oldAgent, newAgent);
    }

    /// @inheritdoc InhNAVOracle
    function setMaxStalenessPeriod(uint256 newPeriod) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _maxStalenessPeriod = newPeriod;
        emit MaxStalenessPeriodUpdated(newPeriod);
    }

    /// @inheritdoc InhNAVOracle
    function setMaxDailyDeviationBps(uint256 newDeviationBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _maxDailyDeviationBps = newDeviationBps;
        emit MaxDailyDeviationBpsUpdated(newDeviationBps);
    }

    /* ============ View Functions ============ */

    /// @notice Returns the number of decimals used by the NAV feed (8 decimals).
    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    /// @notice Returns human-readable description.
    function description() external pure returns (string memory) {
        return DESCRIPTION;
    }

    /// @notice Returns aggregator version.
    function version() external pure returns (uint256) {
        return VERSION;
    }

    /// @notice Returns latest round data conforming to Chainlink AggregatorV3.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        if (_price <= 0) revert InvalidNAV();
        if (_maxStalenessPeriod > 0 && block.timestamp > _updatedAt + _maxStalenessPeriod) {
            revert StalePrice(_updatedAt, block.timestamp);
        }

        return (_roundId, _price, _updatedAt, _updatedAt, _roundId);
    }

    /// @inheritdoc InhNAVOracle
    function calculationAgent() external view returns (address) {
        return _calculationAgent;
    }

    /// @inheritdoc InhNAVOracle
    function maxStalenessPeriod() external view returns (uint256) {
        return _maxStalenessPeriod;
    }

    /// @inheritdoc InhNAVOracle
    function maxDailyDeviationBps() external view returns (uint256) {
        return _maxDailyDeviationBps;
    }

    /// @inheritdoc InhNAVOracle
    function lastAuditReportHash() external view returns (bytes32) {
        return _lastAuditReportHash;
    }

    /// @inheritdoc InhNAVOracle
    function totalAUM() external view returns (uint256) {
        return _totalAUM;
    }

    /// @inheritdoc InhNAVOracle
    function totalShares() external view returns (uint256) {
        return _totalShares;
    }
}
