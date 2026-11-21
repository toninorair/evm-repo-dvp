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
    /// @param  lender                Designated lender address authorized to accept the proposal.
    /// @param  borrowAmount          Cash principal to borrow in `cashToken` units (18 decimals).
    /// @param  repoRateBps           Annualized repo interest rate in basis points (Actual/360).
    /// @param  initialMarginBps      Initial over-collateralization margin in bps over `borrowAmount` (max 5,000 bps).
    /// @param  maintenanceMarginBps  Maintenance margin threshold in bps over the accruing repurchase price (`<= initialMarginBps`).
    /// @param  termSeconds           Duration of the repo from acceptance to maturity in seconds (1s to 365 days).
    /// @param  curePeriodSeconds     Grace period in seconds for the borrower to cure a margin call (`<= termSeconds`).
    /// @param  maxCollateralAmount   Maximum `collateralToken` units the borrower consents to post at acceptance.
    /// @param  acceptDeadline        Unix timestamp after which the proposal expires and can no longer be accepted.
    /// @return repoId                Unique sequential identifier assigned to the proposed repo agreement.
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
    /// @param  repoId  Identifier of the proposed repo agreement to accept.
    function acceptRepo(uint256 repoId) external;

    /// @notice Executes the Closing Leg (RvP): Repays Principal + Interest, returns collateral.
    /// @param  repoId  Identifier of the open repo agreement to settle.
    function settleRepo(uint256 repoId) external;

    /// @notice Evaluates oracle price and triggers margin call if under-collateralized.
    /// @param  repoId  Identifier of the active repo agreement to evaluate.
    function marginCall(uint256 repoId) external;

    /// @notice Borrower cures margin call by posting additional collateral.
    /// @param  repoId       Identifier of the open repo agreement.
    /// @param  topUpAmount  Amount of additional `collateralToken` units (18 decimals) to transfer into escrow.
    function topUpCollateral(uint256 repoId, uint256 topUpAmount) external;

    /// @notice Close-out on post-maturity non-payment or missed margin cure: transfers to the lender
    ///         collateral worth the repurchase price owed (at the live oracle price) and pushes any surplus
    ///         back to the borrower in the same call.
    /// @dev    POC design note: surplus is pushed directly rather than queued in a pull-claim mapping to keep
    ///         escrow accounting minimal (`invariant_EscrowSolvency`). Because `collateralToken` is an ERC-3643
    ///         token, if a defaulting borrower's address is frozen or de-verified, the push transfer of
    ///         `surplusCollateral > 0` would revert until Compliance either unfreezes the borrower for close-out
    ///         or a production deployment separates surplus into a pull-claim / quarantine balance.
    /// @param  repoId  Identifier of the defaulting repo agreement.
    function claimDefault(uint256 repoId) external;

    /// @notice Cancels an unaccepted proposal.
    /// @param  repoId  Identifier of the proposed repo agreement to cancel.
    function cancelRepo(uint256 repoId) external;

    /* ============ View Functions ============ */

    /// @notice Returns `borrowAmount` + Actual/360 interest accrued so far.
    /// @param  repoId           Identifier of the repo agreement.
    /// @return repurchasePrice  Total cash repayment in `cashToken` units (18 decimals).
    function getCurrentRepurchasePrice(uint256 repoId) external view returns (uint256 repurchasePrice);

    /// @notice Actual/360 interest accrued since opening: `borrowAmount * repoRateBps * elapsed / (360 days * 10_000)`,
    ///         rounded down. Returns `0` unless the repo is `Active` or `MarginCalled`.
    /// @param  repoId    Identifier of the repo agreement.
    /// @return interest  Accrued interest in `cashToken` units (18 decimals).
    function getRepoInterest(uint256 repoId) external view returns (uint256 interest);

    /// @notice Current collateral price from the oracle (8 decimals). Reverts with `InhNAVOracle.InvalidNAV`
    ///         on a zero or negative price.
    /// @return price  Positive collateral price per token unit with 8 decimals.
    function getCollateralPrice() external view returns (uint256 price);

    /// @notice Current mark-to-market value of a repo's escrowed collateral in EUR (18 decimals).
    /// @param  repoId              Identifier of the repo agreement.
    /// @return collateralValueEUR  Mark-to-market collateral value in EUR (18 decimals).
    function getCollateralValue(uint256 repoId) external view returns (uint256 collateralValueEUR);

    /// @notice Minimum collateral value in EUR (18 decimals) required to satisfy `maintenanceMarginBps`.
    /// @param  repoId         Identifier of the repo agreement.
    /// @return requiredValue  Minimum required collateral value in EUR (18 decimals).
    function getRequiredCollateralValue(uint256 repoId) external view returns (uint256 requiredValue);

    /// @notice Minimum collateral token units (18 decimals) required to satisfy `maintenanceMarginBps` at the current price.
    /// @param  repoId          Identifier of the repo agreement.
    /// @return requiredAmount  Minimum required collateral token units (18 decimals).
    function getRequiredCollateralAmount(uint256 repoId) external view returns (uint256 requiredAmount);

    /// @notice Returns true when `getCollateralValue(repoId) >= getRequiredCollateralValue(repoId)`.
    /// @param  repoId   Identifier of the repo agreement.
    /// @return healthy  True if margin coverage is healthy.
    function isMarginHealthy(uint256 repoId) external view returns (bool healthy);

    /// @notice Total number of repo agreements initialized.
    function repoCount() external view returns (uint256);

    /// @notice Address of the collateral token (`nhBOND`).
    function collateralToken() external view returns (address);

    /// @notice Address of the cash token (`nhEUR`).
    function cashToken() external view returns (address);

    /// @notice Address of the collateral price oracle (`nhNAVOracle`).
    function collateralOracle() external view returns (address);
}
