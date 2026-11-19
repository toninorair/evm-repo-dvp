// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.34;

import {IIdentity} from "./IIdentity.sol";

/// @title IClaimIssuer
/// @notice Official ONCHAINID Claim Issuer interface
interface IClaimIssuer is IIdentity {
    event ClaimRevoked(bytes indexed signature);

    function revokeClaim(bytes32 _claimId, address _identity) external returns (bool);
    function revokeClaimBySignature(bytes calldata signature) external;
    function isClaimRevoked(bytes calldata _sig) external view returns (bool);
}
