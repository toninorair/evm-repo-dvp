// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title  IRepoTypes
/// @notice Data structures, enums, and types for institutional repo agreements and EIP-712 orders.
/// @author Ethereum Institutional / Nordhaven Bank
interface IRepoTypes {
    /* ============ Enums ============ */

    /// @notice Lifecycle status of a repo agreement.
    enum RepoStatus {
        None,
        Proposed,
        Active,
        MarginCalled,
        Settled,
        Defaulted,
        Cancelled
    }

    /* ============ Structs ============ */

    /// @notice Core economic and contractual terms of a repo agreement.
    struct RepoTerms {
        address borrower;
        address lender;
        address collateralToken;
        address cashToken;
        uint256 collateralAmount;
        uint256 cashAmount;
        uint32 repoRateBps;
        uint32 haircutBps;
        uint32 tenorSeconds;
    }

    /// @notice Dynamic operational and settlement state of a repo agreement.
    struct RepoState {
        RepoStatus status;
        uint40 startTime;
        uint40 maturity;
        uint40 cureDeadline;
        uint256 principalRepaid;
        uint256 interestRepaid;
        uint256 collateralReturned;
        uint256 deficitAmount;
    }

    /// @notice EIP-712 structured order for zero-transaction off-chain repo negotiation.
    struct RepoOrder {
        address proposer;
        address counterparty;
        bool isBorrower;
        address collateralToken;
        address cashToken;
        uint256 collateralAmount;
        uint256 cashAmount;
        uint32 repoRateBps;
        uint32 tenorSeconds;
        uint32 haircutBps;
        uint256 nonce;
        uint256 deadline;
    }
}
