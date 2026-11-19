// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

interface ITREXDeployer {
    struct TREXSuite {
        address claimTopicsRegistry;
        address trustedIssuersRegistry;
        address identityRegistryStorage;
        address identityRegistry;
        address modularCompliance;
        address token;
    }

    function deploySuite(
        address admin,
        address compliance,
        address issuer,
        string memory tokenName,
        string memory tokenSymbol,
        uint8 decimals
    ) external returns (TREXSuite memory suite);

    function deployIdentity(address initialManagementKey) external returns (address);
}
