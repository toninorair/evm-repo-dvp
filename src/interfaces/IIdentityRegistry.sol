// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @notice Minimal view of the ERC-3643 IdentityRegistry used for counterparty eligibility.
interface IIdentityRegistry {
    function isVerified(address account) external view returns (bool);
}

/// @notice A token that enforces KYC through an ERC-3643 IdentityRegistry (nhBOND and nhEUR both expose this).
interface IIdentityRegistryBound {
    function identityRegistry() external view returns (address);
}
