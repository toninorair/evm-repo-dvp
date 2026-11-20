// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title  IComplianceRegistry
/// @notice Interface for institutional KYC/AML and counterparty verification registry.
/// @dev    Restricts token holdings, transfers, and repo transactions to verified institutional entities.
/// @author Ethereum Institutional / Nordhaven Bank
interface IComplianceRegistry {
    /* ============ Events ============ */

    /// @notice Emitted when an account's verification status is updated.
    /// @param  account    The institutional account address.
    /// @param  isVerified The new verification status.
    event VerificationStatusUpdated(address indexed account, bool isVerified);

    /// @notice Emitted when a batch of accounts are verified or unverified.
    /// @param  accounts   Array of institutional account addresses.
    /// @param  isVerified The verification status applied to the batch.
    event BatchVerificationUpdated(address[] accounts, bool isVerified);

    /* ============ Custom Errors ============ */

    /// @notice Thrown when an input address is zero.
    error ZeroAddress();
    error ZeroAdmin();
    error ZeroCompliance();

    /// @notice Thrown when array lengths mismatch in batch operations.
    error ArrayLengthMismatch();

    /* ============ Interactive Functions ============ */

    /// @notice Sets the verification status for a single account.
    /// @param  account    The account to update.
    /// @param  isVerified True if verified for institutional trading, false otherwise.
    function setVerificationStatus(address account, bool isVerified) external;

    /// @notice Sets the verification status for a batch of accounts.
    /// @param  accounts   Array of accounts to update.
    /// @param  isVerified True if verified for institutional trading, false otherwise.
    function setBatchVerificationStatus(address[] calldata accounts, bool isVerified) external;

    /* ============ View Functions ============ */

    /// @notice Returns true if the account is verified for institutional trading.
    /// @param  account The account to check.
    /// @return True if verified, false otherwise.
    function isVerified(address account) external view returns (bool);
}
