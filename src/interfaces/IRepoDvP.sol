// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title  IRepoDvP
/// @notice Interface for institutional Delivery-versus-Payment (DvP) repo settlement engine.
/// @dev    Provides atomic gross settlement, Actual/360 interest calculations, and programmable margin calls.
/// @author Ethereum Institutional / Nordhaven Bank
interface IRepoDvP {
    /* ============ Events ============ */

    /// @notice Emitted when a borrower proposes a bilateral repo to a lender on-chain.
    event RepoProposed(
        uint256 indexed repoId,
        address indexed borrower,
        address indexed lender,
        uint256 borrowAmount,
        uint256 maxCollateralAmount,
        uint32 repoRateBps,
        uint32 termSeconds
    );

    /// @notice Emitted when the Opening Leg executes with atomic DvP settlement.
    event RepoOpened(
        uint256 indexed repoId,
        address indexed borrower,
        address indexed lender,
        uint256 borrowAmount,
        uint256 collateralAmount,
        uint40 startTime,
        uint40 maturity
    );

    /// @notice Emitted when the Closing Leg executes with atomic RvP settlement.
    event RepoSettled(
        uint256 indexed repoId,
        uint256 totalRepaid,
        uint256 collateralReturned,
        uint40 settlementTimestamp
    );

    /// @notice Emitted when an under-collateralized position triggers a margin call notice.
    event MarginCalled(uint256 indexed repoId, uint256 currentCollateralValue, uint40 cureDeadline);

    /// @notice Emitted when a borrower tops up collateral to cure a margin call.
    event MarginToppedUp(uint256 indexed repoId, uint256 additionalCollateral, uint256 newTotalCollateral);

    /// @notice Emitted on default close-out. The lender seizes collateral worth `amountOwed` at the current
    ///         price; `surplusCollateral` is returned to the borrower in the same call.
    event RepoDefaulted(
        uint256 indexed repoId,
        address indexed lender,
        uint256 amountOwed,
        uint256 collateralSeized,
        uint256 surplusCollateral,
        string reason
    );

    /// @notice Emitted when an unaccepted proposal is cancelled.
    event RepoCancelled(uint256 indexed repoId, address indexed proposer);

    /* ============ Custom Errors ============ */

    error ZeroPriceOracle();
    error ZeroCollateralToken();
    error ZeroCashToken();
    error ZeroAmount();
    error Unauthorized();
    error NotKYCVerified(address account);
    error InvalidLender();
    error CollateralAboveCap(uint256 requiredCollateral, uint256 maxCollateralAmount);
    error MarginSufficient();
    error InitialMarginInvalid();
    error TermInvalid();
    error CurePeriodInvalid();
    error MaintenanceMarginInvalid();
    error AcceptDeadlineInvalid();
    error ProposalExpired(uint256 acceptDeadline, uint256 currentTimestamp);

    /* ============ Interactive Functions ============ */

    /// @notice Proposes a bilateral repo agreement on-chain.
    /// @dev    Callable only by the borrower (`msg.sender`), who names the `lender` (not zero, not the
    ///         borrower). Requires `maintenanceMarginBps <= initialMarginBps`. No collateral moves yet:
    ///         the amount is sized at acceptance (see `acceptRepo`), capped by `maxCollateralAmount`.
    function proposeRepo(
        address lender,
        uint256 borrowAmount,
        uint32 repoRateBps,
        uint32 initialMarginBps,
        uint32 maintenanceMarginBps,
        uint32 termSeconds,
        uint32 curePeriodSeconds,
        uint256 maxCollateralAmount,
        uint40 acceptDeadline
    ) external returns (uint256 repoId);

    /// @notice Accepts an on-chain proposal and executes Atomic DvP (Opening Leg).
    /// @dev    Callable only by the lender and only until `acceptDeadline`. Pulls initial collateral sized
    ///         from `initialMarginBps` at the current oracle price; reverts with `CollateralAboveCap` if that
    ///         exceeds the borrower's `maxCollateralAmount`.
    function acceptRepo(uint256 repoId) external;

    /// @notice Executes the Closing Leg (RvP): Repays Principal + Interest, returns collateral.
    function settleRepo(uint256 repoId) external;

    /// @notice Evaluates oracle price and triggers margin call if under-collateralized.
    function marginCall(uint256 repoId) external;

    /// @notice Borrower cures margin call by posting additional collateral.
    function topUpCollateral(uint256 repoId, uint256 topUpAmount) external;

    /// @notice Close-out on post-maturity non-payment or missed margin cure: transfers to the lender
    ///         collateral worth the repurchase price owed (at the live oracle price) and pushes any surplus
    ///         back to the borrower in the same call.
    /// @dev    POC design note: surplus is pushed directly rather than queued in a pull-claim mapping to keep
    ///         escrow accounting minimal (`invariant_EscrowSolvency`). Because `collateralToken` is an ERC-3643
    ///         token, if a defaulting borrower's address is frozen or de-verified, the push transfer of
    ///         `surplusCollateral > 0` would revert until Compliance either unfreezes the borrower for close-out
    ///         or a production deployment separates surplus into a pull-claim / quarantine balance.
    function claimDefault(uint256 repoId) external;

    /// @notice Cancels an unaccepted proposal.
    function cancelRepo(uint256 repoId) external;

    /* ============ View Functions ============ */

    /// @notice borrowAmount + interest accrued so far.
    function getCurrentRepurchasePrice(uint256 repoId) external view returns (uint256);
    /// @notice Actual/360 interest accrued since opening: borrowAmount × repoRateBps × elapsed / (360 days × 10_000),
    ///         rounded down. Returns 0 unless the repo is Active or MarginCalled.
    function getRepoInterest(uint256 repoId) external view returns (uint256 interest);

    /// @notice Current collateral price from the oracle (8 decimals). Reverts with `InhNAVOracle.InvalidNAV`
    ///         on a zero or negative price.
    function getCollateralPrice() external view returns (uint256 price);

    /// @notice Current mark-to-market value of a repo's escrowed collateral in EUR (18 decimals).
    function getCollateralValue(uint256 repoId) external view returns (uint256 collateralValueEUR);

    /// @notice Minimum collateral value in EUR (18 decimals) required to satisfy `maintenanceMarginBps`.
    function getRequiredCollateralValue(uint256 repoId) external view returns (uint256);

    /// @notice Minimum collateral token units (18 decimals) required to satisfy `maintenanceMarginBps` at the current price.
    function getRequiredCollateralAmount(uint256 repoId) external view returns (uint256);

    /// @notice Returns true when `getCollateralValue(repoId) >= getRequiredCollateralValue(repoId)`.
    function isMarginHealthy(uint256 repoId) external view returns (bool);

    function repoCount() external view returns (uint256);
    function collateralToken() external view returns (address);
    function cashToken() external view returns (address);
    function collateralOracle() external view returns (address);
}
