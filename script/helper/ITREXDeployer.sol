// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17 <0.9.0;

interface ITREXDeployer {
    struct TREXSuite {
        address claimTopicsRegistry;
        address trustedIssuersRegistry;
        address identityRegistryStorage;
        address identityRegistry;
        address modularCompliance;
        address token;
    }

    struct BondDetails {
        string tokenName;
        string tokenSymbol;
        uint8 decimals;
        string isin;
        uint256 maturityDate;
        uint32 couponRateBps;
        address navOracle;
    }

    function deploySuite(
        address admin,
        address compliance,
        address issuer,
        string memory tokenName,
        string memory tokenSymbol,
        uint8 decimals
    ) external returns (TREXSuite memory suite);

    function deployBondSuite(
        address admin,
        address compliance,
        address issuer,
        BondDetails memory bondDetails
    ) external returns (TREXSuite memory suite);

    function deployIdentity(address initialManagementKey) external returns (address);
}
