// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IComplianceRegistry} from "./interfaces/IComplianceRegistry.sol";

/// @title  ComplianceRegistry
/// @notice Institutional KYC/AML and identity verification registry for Nordhaven Bank ecosystem.
/// @author Ethereum Institutional / Nordhaven Bank
contract ComplianceRegistry is IComplianceRegistry, AccessControl {
    /* ============ Constants ============ */

    /// @notice Role authorized to manage verified institutional participants.
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    /* ============ Storage ============ */

    /// @notice Mapping tracking institutional verification status.
    mapping(address account => bool verified) private _verifiedAccounts;

    /* ============ Constructor ============ */

    /// @notice Constructs the ComplianceRegistry contract.
    /// @param  admin      Address granted DEFAULT_ADMIN_ROLE and COMPLIANCE_ROLE.
    /// @param  compliance Address granted COMPLIANCE_ROLE.
    constructor(address admin, address compliance) {
        if (admin == address(0)) revert ZeroAdmin();
        if (compliance == address(0)) revert ZeroCompliance();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, compliance);
    }

    /* ============ Interactive Functions ============ */

    /// @inheritdoc IComplianceRegistry
    function setVerificationStatus(address account, bool isVerified_) external onlyRole(COMPLIANCE_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        _verifiedAccounts[account] = isVerified_;
        emit VerificationStatusUpdated(account, isVerified_);
    }

    /// @inheritdoc IComplianceRegistry
    function setBatchVerificationStatus(address[] calldata accounts, bool isVerified_)
        external
        onlyRole(COMPLIANCE_ROLE)
    {
        uint256 length = accounts.length;
        for (uint256 i = 0; i < length;) {
            address account = accounts[i];
            if (account == address(0)) revert ZeroAddress();
            _verifiedAccounts[account] = isVerified_;
            unchecked {
                ++i;
            }
        }
        emit BatchVerificationUpdated(accounts, isVerified_);
    }

    /* ============ View Functions ============ */

    /// @inheritdoc IComplianceRegistry
    function isVerified(address account) external view returns (bool) {
        return _verifiedAccounts[account];
    }
}
