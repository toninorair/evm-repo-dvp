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
    /// @notice Role authorized to attest and publish Net Asset Value (NAV) updates.
    bytes32 public constant CALCULATION_AGENT_ROLE = keccak256("CALCULATION_AGENT_ROLE");

    uint80 private _roundId;
    int256 private _price;
    uint256 private _updatedAt;

    /// @notice Constructs the `nhNAVOracle` contract and assigns admin and calculation agent roles.
    /// @dev    Reverts with `ZeroAddress` if either `admin` or `calculationAgent` is `address(0)`.
    /// @param  admin             Address granted `DEFAULT_ADMIN_ROLE`.
    /// @param  calculationAgent  Address granted `CALCULATION_AGENT_ROLE` to publish NAV updates.
    constructor(address admin, address calculationAgent) {
        if (admin == address(0) || calculationAgent == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CALCULATION_AGENT_ROLE, calculationAgent);
    }

    /// @notice Publishes a new certified Net Asset Value (NAV) per `nhBOND` unit in EUR (8 decimals).
    /// @dev    Callable only by `CALCULATION_AGENT_ROLE`. Reverts with `InvalidNAV` if `navEur <= 0`.
    ///         Increments `_roundId`, stores `_price = navEur` and `_updatedAt = block.timestamp`,
    ///         and emits `NAVSubmitted`.
    /// @param  navEur  Positive EUR NAV price scaled to 8 decimals (e.g. `100_00000000` = €100.00).
    function updateNAV(int256 navEur) external onlyRole(CALCULATION_AGENT_ROLE) {
        if (navEur <= 0) revert InvalidNAV();

        ++_roundId;
        _price = navEur;
        _updatedAt = block.timestamp;

        emit NAVSubmitted(_roundId, _price, _updatedAt);
    }

    /// @notice Returns the number of decimals used by the oracle price feed (`8`, matching Chainlink EUR pairs).
    /// @return decimalsCount  Fixed at `8`.
    function decimals() external pure returns (uint8 decimalsCount) {
        return 8;
    }

    /// @notice Returns a human-readable description of the NAV price feed.
    /// @return feedDescription  Description string (`"Nordhaven EUR Sovereign Fund NAV / EUR"`).
    function description() external pure returns (string memory feedDescription) {
        return "Nordhaven EUR Sovereign Fund NAV / EUR";
    }

    /// @notice Returns the Chainlink aggregator interface version number.
    /// @return oracleVersion  Fixed at `1`.
    function version() external pure returns (uint256 oracleVersion) {
        return 1;
    }

    /// @notice Returns the latest Chainlink `AggregatorV3Interface` round data tuple.
    /// @dev    Returns raw stored state without enforcing a staleness revert so consumers can apply their own policy.
    /// @return roundId          Latest sequential round identifier.
    /// @return answer           Latest attested NAV price in EUR (8 decimals).
    /// @return startedAt        Timestamp when the round was published.
    /// @return updatedAt        Timestamp when the round was published.
    /// @return answeredInRound  Matches `roundId`.
    function latestRoundData()
        public
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _price, _updatedAt, _updatedAt, _roundId);
    }

    /// @notice Returns the latest positive NAV price as a `uint256` (8 decimals).
    /// @dev    Reverts with `InvalidNAV` if no NAV has been published yet or if the stored price is `<= 0`.
    /// @return price  Positive NAV price per `nhBOND` unit (8 decimals).
    function getCollateralPrice() public view returns (uint256 price) {
        (, int256 answer, , , ) = latestRoundData();
        if (answer <= 0) revert InvalidNAV();
        return uint256(answer);
    }
}
