// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

import { IIdentityRegistry } from "./interfaces/IIdentityRegistry.sol";
import { InhEUR } from "./interfaces/InhEUR.sol";

/// @title  nhEUR
/// @notice Nordhaven Tokenised Euro Deposit (nhEUR).
/// @dev    Permissioned ERC-20 token representing commercial bank deposit liabilities.
///         Modeled after J.P. Morgan's JPM Coin (JPMD) and SocGen-FORGE's EURCV.
/// @author Ethereum Institutional / Nordhaven Bank
contract nhEUR is ERC20, ERC20Permit, InhEUR, AccessControl, Pausable {
    /* ============ Constants ============ */

    /// @notice Role authorized to mint and burn deposit tokens (Bank Treasury).
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    /// @notice Role authorized to freeze accounts and pause the contract (Compliance Desk).
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    /* ============ Storage ============ */

    /// @notice ERC-3643 IdentityRegistry enforcing institutional onboarding (shared with nhBOND and RepoDvP).
    address public identityRegistry;

    /// @notice Mapping tracking whether an address is frozen under AML/regulatory orders.
    mapping(address account => bool frozen) public frozenAccounts;

    /* ============ Constructor ============ */

    /// @notice Constructs the nhEUR deposit token.
    /// @param  admin               Address granted DEFAULT_ADMIN_ROLE.
    /// @param  treasury            Address granted TREASURY_ROLE (mint/burn authority).
    /// @param  compliance          Address granted COMPLIANCE_ROLE (freeze/pause authority).
    /// @param  identityRegistry_   Address of the ERC-3643 IdentityRegistry.
    constructor(
        address admin,
        address treasury,
        address compliance,
        address identityRegistry_
    ) ERC20("Nordhaven EUR Deposit", "nhEUR") ERC20Permit("Nordhaven EUR Deposit") {
        if (admin == address(0)) revert ZeroAdmin();
        if (treasury == address(0)) revert ZeroTreasury();
        if (compliance == address(0)) revert ZeroCompliance();
        if ((identityRegistry = identityRegistry_) == address(0)) revert ZeroIdentityRegistry();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(TREASURY_ROLE, treasury);
        _grantRole(COMPLIANCE_ROLE, compliance);
    }

    /* ============ Interactive Functions ============ */

    /// @notice Mints deposit tokens to an allowlisted institutional account against a core banking fiat credit.
    /// @dev    Callable only by `TREASURY_ROLE` when the contract is not paused. The `_update` hook verifies that
    ///         `to` is not frozen and is verified in `identityRegistry`.
    /// @param  to       Recipient wallet address (must be verified in `identityRegistry` and not frozen).
    /// @param  amount   Amount of `nhEUR` tokens (18 decimals) to mint (must be `> 0`).
    /// @param  fiatRef  Core banking / TARGET2 RTGS transaction reference emitted for subledger reconciliation.
    function mint(address to, uint256 amount, string calldata fiatRef) external onlyRole(TREASURY_ROLE) {
        if (amount == 0) revert ZeroAmount();

        _mint(to, amount);

        emit DepositMinted(to, amount, fiatRef);
    }

    /// @notice Burns deposit tokens from an institutional account upon fiat redemption to RTGS / TARGET2.
    /// @dev    Callable only by `TREASURY_ROLE` when the contract is not paused. The `_update` hook verifies that
    ///         `from` is not frozen and is verified in `identityRegistry`.
    /// @param  from     Account from which `nhEUR` tokens are burned (must be verified and not frozen).
    /// @param  amount   Amount of `nhEUR` tokens (18 decimals) to burn (must be `> 0`).
    /// @param  fiatRef  Core banking / TARGET2 RTGS redemption reference emitted for subledger reconciliation.
    function burn(address from, uint256 amount, string calldata fiatRef) external onlyRole(TREASURY_ROLE) {
        if (amount == 0) revert ZeroAmount();

        _burn(from, amount);

        emit DepositBurned(from, amount, fiatRef);
    }

    /// @notice Freezes or unfreezes an account under AML, sanctions, or regulatory enforcement.
    /// @dev    Callable only by `COMPLIANCE_ROLE`. Frozen accounts cannot send, receive, mint, or burn `nhEUR`.
    /// @param  account       Target wallet address to freeze or unfreeze (must not be `address(0)`).
    /// @param  freezeStatus  True to freeze the account; false to unfreeze it.
    function setFrozen(address account, bool freezeStatus) external onlyRole(COMPLIANCE_ROLE) {
        if (account == address(0)) revert ZeroAddress();

        frozenAccounts[account] = freezeStatus;

        if (freezeStatus) {
            emit AccountFrozen(account);
        } else {
            emit AccountUnfrozen(account);
        }
    }

    /// @notice Updates the ERC-3643 `IdentityRegistry` used to verify token holders on transfer, mint, and burn.
    /// @dev    Callable only by `DEFAULT_ADMIN_ROLE`. `RepoDvP` queries `identityRegistry()` live on every proposal.
    /// @param  newRegistry  Address of the new `IdentityRegistry` contract (must not be `address(0)`).
    function setIdentityRegistry(address newRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRegistry == address(0)) revert ZeroIdentityRegistry();

        identityRegistry = newRegistry;

        emit IdentityRegistryUpdated(newRegistry);
    }

    /// @notice Pauses all `nhEUR` token transfers, mints, and burns (emergency compliance circuit-breaker).
    /// @dev    Callable only by `COMPLIANCE_ROLE`.
    function pause() external onlyRole(COMPLIANCE_ROLE) {
        _pause();
    }

    /// @notice Unpauses `nhEUR` token transfers, mints, and burns.
    /// @dev    Callable only by `COMPLIANCE_ROLE`.
    function unpause() external onlyRole(COMPLIANCE_ROLE) {
        _unpause();
    }

    /* ============ View Functions ============ */

    /// @notice Returns whether an account is currently frozen by compliance.
    /// @param  account  Wallet address to inspect.
    /// @return frozen   True if `account` is frozen; false otherwise.
    function isFrozen(address account) external view returns (bool frozen) {
        return frozenAccounts[account];
    }

    /* ============ Internal Functions ============ */

    /// @notice Internal transfer hook enforcing pause status, account-level freeze checks, and ERC-3643 KYC verification.
    /// @dev    Overrides `ERC20._update`. For non-zero `from` (transfers and burns) and non-zero `to` (transfers and mints),
    ///         reverts with `AccountIsFrozen` if the party is frozen or `NotKYCVerified` if `!identityRegistry.isVerified(party)`.
    /// @param  from   Sender address (`address(0)` on mint).
    /// @param  to     Recipient address (`address(0)` on burn).
    /// @param  value  Amount of `nhEUR` tokens transferred, minted, or burned.
    function _update(address from, address to, uint256 value) internal override whenNotPaused {
        if (from != address(0)) {
            if (frozenAccounts[from]) revert AccountIsFrozen(from);
            if (!IIdentityRegistry(identityRegistry).isVerified(from)) revert NotKYCVerified(from);
        }
        if (to != address(0)) {
            if (frozenAccounts[to]) revert AccountIsFrozen(to);
            if (!IIdentityRegistry(identityRegistry).isVerified(to)) revert NotKYCVerified(to);
        }

        super._update(from, to, value);
    }
}
