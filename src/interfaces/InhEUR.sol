// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title  InhEUR
/// @notice Interface for Nordhaven Tokenised Euro Deposit (nhEUR).
/// @dev    Represents commercial bank deposit liabilities with compliance gating and EIP-2612 permit.
/// @author Ethereum Institutional / Nordhaven Bank
interface InhEUR is IERC20 {
    /* ============ Events ============ */

    /// @notice Emitted when the bank treasury mints deposit tokens against fiat credit.
    /// @param  to            Recipient address.
    /// @param  amount        Amount of tokens minted.
    /// @param  fiatReference Core banking / TARGET2 reference identifier.
    event DepositMinted(address indexed to, uint256 amount, string fiatReference);

    /// @notice Emitted when the bank treasury burns deposit tokens upon fiat redemption.
    /// @param  from          Account from which tokens are burned.
    /// @param  amount        Amount of tokens burned.
    /// @param  fiatReference Core banking / TARGET2 reference identifier.
    event DepositBurned(address indexed from, uint256 amount, string fiatReference);

    /// @notice Emitted when an account is frozen for compliance/sanctions enforcement.
    /// @param  account The frozen address.
    event AccountFrozen(address indexed account);

    /// @notice Emitted when an account is unfrozen.
    /// @param  account The unfrozen address.
    event AccountUnfrozen(address indexed account);

    /// @notice Emitted when the compliance registry address is updated.
    /// @param  newRegistry Address of the new compliance registry.
    event IdentityRegistryUpdated(address indexed newRegistry);

    /* ============ Custom Errors ============ */

    /// @notice Thrown when an input address is zero.
    error ZeroAddress();

    /// @notice Thrown when a required constructor/config address is zero.
    error ZeroAdmin();
    error ZeroTreasury();
    error ZeroCompliance();
    error ZeroIdentityRegistry();

    /// @notice Thrown when a token amount is zero.
    error ZeroAmount();

    /// @notice Thrown when an account has not completed institutional KYC verification.
    /// @param  account The unverified account.
    error NotKYCVerified(address account);

    /// @notice Thrown when a transfer involves a frozen account.
    /// @param  account The frozen account.
    error AccountIsFrozen(address account);

    /* ============ Interactive Functions ============ */

    /// @notice Mints deposit tokens to an allowlisted institutional account.
    /// @param  to      The recipient address.
    /// @param  amount  The token amount to mint.
    /// @param  fiatRef The core banking fiat ledger reference.
    function mint(address to, uint256 amount, string calldata fiatRef) external;

    /// @notice Burns deposit tokens from an account upon fiat redemption.
    /// @param  from    The account to burn from.
    /// @param  amount  The token amount to burn.
    /// @param  fiatRef The core banking fiat ledger reference.
    function burn(address from, uint256 amount, string calldata fiatRef) external;

    /// @notice Freezes or unfreezes an account under regulatory enforcement.
    /// @param  account      The address to update.
    /// @param  freezeStatus True to freeze, false to unfreeze.
    function setFrozen(address account, bool freezeStatus) external;

    /// @notice Updates the institutional compliance registry.
    /// @param  newRegistry Address of the new registry.
    function setIdentityRegistry(address newRegistry) external;

    /// @notice Pauses all token transfers (emergency circuit-breaker).
    function pause() external;

    /// @notice Unpauses token transfers.
    function unpause() external;

    /* ============ View Functions ============ */

    /// @notice Returns true if the account is frozen.
    /// @param  account The address to check.
    function isFrozen(address account) external view returns (bool);

    /// @notice Returns the address of the compliance registry.
    function identityRegistry() external view returns (address);
}
