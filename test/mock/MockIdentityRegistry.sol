// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { IIdentityRegistry } from "../../src/interfaces/IIdentityRegistry.sol";

/// @title MockIdentityRegistry
/// @notice Stand-in registry with directly settable verification, for a token that uses a separate registry.
contract MockIdentityRegistry is IIdentityRegistry {
    mapping(address account => bool) public isVerified;

    function setVerified(address account, bool verified) external {
        isVerified[account] = verified;
    }
}
