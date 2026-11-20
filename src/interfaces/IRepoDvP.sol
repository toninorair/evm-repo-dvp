// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IRepoTypes} from "./IRepoTypes.sol";

/// @title  IRepoDvP
/// @notice Interface for institutional Delivery-versus-Payment (DvP) repo settlement engine.
/// @dev    Provides atomic gross settlement, Actual/360 interest calculations, and programmable margin calls.
/// @author Ethereum Institutional / Nordhaven Bank
interface IRepoDvP is IRepoTypes {
    /* ============ Events ============ */

    /// @notice Emitted when a bilateral repo proposal is created on-chain.
    event RepoProposed(
        uint256 indexed repoId,
        address indexed proposer,
        address indexed counterparty,
        uint256 cashAmount,
        uint256 collateralAmount,
        uint32 repoRateBps,
        uint32 tenorSeconds
    );

    /// @notice Emitted when the Opening Leg executes with atomic DvP settlement.
    event RepoOpened(
        uint256 indexed repoId,
        address indexed borrower,
        address indexed lender,
        uint256 cashAmount,
        uint256 collateralAmount,
        uint40 startTime,
        uint40 maturity
    );

    /// @notice Emitted when the Closing Leg executes with atomic RvP settlement.
    event RepoSettled(
        uint256 indexed repoId,
        uint256 principalRepaid,
        uint256 interestRepaid,
        uint256 collateralReturned,
        uint40 settlementTimestamp
    );

    /// @notice Emitted when an under-collateralized position triggers a margin call notice.
    event MarginCallTriggered(
        uint256 indexed repoId, uint256 currentCollateralValue, uint256 requiredCollateralValue, uint40 cureDeadline
    );

    /// @notice Emitted when a borrower tops up collateral to cure a margin call.
    event MarginToppedUp(uint256 indexed repoId, uint256 additionalCollateral, uint256 newTotalCollateral);

    /// @notice Emitted when a default close-out is executed and collateral is seized by the lender.
    event RepoDefaulted(uint256 indexed repoId, address indexed lender, uint256 collateralSeized, string reason);

    /// @notice Emitted when an unaccepted proposal is cancelled.
    event RepoCancelled(uint256 indexed repoId, address indexed proposer);

    /// @notice Emitted when an EIP-712 nonce is cancelled/invalidated off-chain.
    event NonceInvalidated(address indexed account, uint256 nonce);

    /* ============ Custom Errors ============ */

    error ZeroAddress();
    error ZeroAmount();
    error Unauthorized();
    error InvalidState(RepoStatus expected, RepoStatus actual);
    error DeadlineExpired();
    error NotKYCVerified(address account);
    error CounterpartyMismatch(address expected, address actual);
    error InsufficientCollateralValue(uint256 providedValue, uint256 requiredValue);
    error MaturityNotReached(uint256 maturity, uint256 currentTimestamp);
    error CurePeriodActive(uint256 cureDeadline, uint256 currentTimestamp);
    error MarginSufficient();
    error SignatureInvalid();
    error NonceAlreadyUsed();
    error HaircutInvalid();
    error TenorInvalid();

    /* ============ Interactive Functions ============ */

    /// @notice Proposes a bilateral repo agreement on-chain.
    function proposeRepo(
        address counterparty,
        address collateralToken,
        address cashToken,
        uint256 collateralAmount,
        uint256 cashAmount,
        uint32 repoRateBps,
        uint32 tenorSeconds,
        uint32 haircutBps,
        bool isBorrowerProposer
    ) external returns (uint256 repoId);

    /// @notice Accepts an on-chain proposal and executes Atomic DvP (Opening Leg).
    function acceptProposal(uint256 repoId) external;

    /// @notice Executes an off-chain signed EIP-712 order atomically (Zero-Tx Negotiation).
    function executeRepoOrder(RepoOrder calldata order, bytes calldata proposerSignature)
        external
        returns (uint256 repoId);

    /// @notice Executes the Closing Leg (RvP): Repays Principal + Interest, returns collateral.
    function settleRepo(uint256 repoId) external;

    /// @notice Evaluates oracle price and triggers margin call if under-collateralized.
    function triggerMarginCall(uint256 repoId) external;

    /// @notice Borrower cures margin call by posting additional collateral.
    function topUpCollateral(uint256 repoId, uint256 topUpAmount) external;

    /// @notice Seizes collateral for lender upon post-maturity non-payment or missed margin cure.
    function claimDefault(uint256 repoId) external;

    /// @notice Cancels an unaccepted proposal.
    function cancelProposal(uint256 repoId) external;

    /// @notice Invalidates an EIP-712 nonce to cancel an off-chain order before execution.
    function invalidateNonce(uint256 nonce) external;

    /* ============ View Functions ============ */

    function getRepo(uint256 repoId) external view returns (RepoTerms memory terms, RepoState memory state);
    function calculateRepurchasePrice(uint256 repoId)
        external
        view
        returns (uint256 principal, uint256 interest, uint256 total);
    function getCollateralValue(uint256 repoId) external view returns (uint256 collateralValueEUR);
    function checkMarginStatus(uint256 repoId)
        external
        view
        returns (bool isHealthy, uint256 currentRatioBps, uint256 deficitEUR);
    function repoCount() external view returns (uint256);
    function isNonceUsed(address account, uint256 nonce) external view returns (bool);
}
