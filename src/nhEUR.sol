// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {IComplianceRegistry} from "./interfaces/IComplianceRegistry.sol";
import {InhEUR} from "./interfaces/InhEUR.sol";

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

    /// @notice The compliance registry enforcing institutional onboarding and sanctions screening.
    address private _complianceRegistry;

    /// @notice Mapping tracking whether an address is frozen under AML/regulatory orders.
    mapping(address account => bool frozen) private _frozenAccounts;

    /* ============ Constructor ============ */

    /// @notice Constructs the nhEUR deposit token.
    /// @param  admin               Address granted DEFAULT_ADMIN_ROLE.
    /// @param  treasury            Address granted TREASURY_ROLE (mint/burn authority).
    /// @param  compliance          Address granted COMPLIANCE_ROLE (freeze/pause authority).
    /// @param  complianceRegistry_ Address of the initial compliance registry.
    constructor(address admin, address treasury, address compliance, address complianceRegistry_)
        ERC20("Nordhaven EUR Deposit", "nhEUR")
        ERC20Permit("Nordhaven EUR Deposit")
    {
        if (admin == address(0)) revert ZeroAdmin();
        if (treasury == address(0)) revert ZeroTreasury();
        if (compliance == address(0)) revert ZeroCompliance();
        if (complianceRegistry_ == address(0)) revert ZeroComplianceRegistry();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(TREASURY_ROLE, treasury);
        _grantRole(COMPLIANCE_ROLE, compliance);

        _complianceRegistry = complianceRegistry_;
    }

    /* ============ Interactive Functions ============ */

    /// @inheritdoc InhEUR
    function mint(address to, uint256 amount, string calldata fiatRef) external onlyRole(TREASURY_ROLE) {
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
        emit DepositMinted(to, amount, fiatRef);
    }

    /// @inheritdoc InhEUR
    function burn(address from, uint256 amount, string calldata fiatRef) external onlyRole(TREASURY_ROLE) {
        if (amount == 0) revert ZeroAmount();
        _burn(from, amount);
        emit DepositBurned(from, amount, fiatRef);
    }

    /// @inheritdoc InhEUR
    function setFrozen(address account, bool freezeStatus) external onlyRole(COMPLIANCE_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        _frozenAccounts[account] = freezeStatus;
        if (freezeStatus) {
            emit AccountFrozen(account);
        } else {
            emit AccountUnfrozen(account);
        }
    }

    /// @inheritdoc InhEUR
    function setComplianceRegistry(address newRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRegistry == address(0)) revert ZeroComplianceRegistry();
        _complianceRegistry = newRegistry;
        emit ComplianceRegistryUpdated(newRegistry);
    }

    /// @inheritdoc InhEUR
    function pause() external onlyRole(COMPLIANCE_ROLE) {
        _pause();
    }

    /// @inheritdoc InhEUR
    function unpause() external onlyRole(COMPLIANCE_ROLE) {
        _unpause();
    }

    /* ============ View Functions ============ */

    /// @inheritdoc InhEUR
    function isFrozen(address account) external view returns (bool) {
        return _frozenAccounts[account];
    }

    /// @inheritdoc InhEUR
    function complianceRegistry() external view returns (address) {
        return _complianceRegistry;
    }

    /* ============ Internal Functions ============ */

    /// @dev Hook enforcing KYC verification and freeze checks on all transfers, mints, and burns.
    function _update(address from, address to, uint256 value) internal override whenNotPaused {
        if (from != address(0)) {
            if (_frozenAccounts[from]) revert AccountIsFrozen(from);
            if (!IComplianceRegistry(_complianceRegistry).isVerified(from)) revert NotKYCVerified(from);
        }
        if (to != address(0)) {
            if (_frozenAccounts[to]) revert AccountIsFrozen(to);
            if (!IComplianceRegistry(_complianceRegistry).isVerified(to)) revert NotKYCVerified(to);
        }

        super._update(from, to, value);
    }
}
