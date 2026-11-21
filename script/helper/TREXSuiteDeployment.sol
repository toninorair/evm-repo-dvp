// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { Script } from "forge-std/Script.sol";
import { ITREXDeployer } from "./ITREXDeployer.sol";

interface ITREXInit {
    function init() external;
}

interface IIdentityRegistryInit {
    function init(address trustedIssuersRegistry, address claimTopicsRegistry, address identityStorage) external;
    function addAgent(address agent) external;
}

interface IIdentityRegistryStorageInit {
    function init() external;
    function bindIdentityRegistry(address identityRegistry) external;
}

interface IBondTokenInit {
    function init(
        address identityRegistry,
        address compliance,
        string memory name,
        string memory symbol,
        uint8 decimals,
        address onchainID
    ) external;
    function setBondDetails(
        string calldata isin,
        uint256 maturityDate,
        uint32 couponRateBps,
        address navOracle
    ) external;
    function addAgent(address agent) external;
    function unpause() external;
}

/// @title  TREXSuiteDeployment
/// @notice Deploys the ERC-3643 (T-REX) suite and nhBOND one contract at a time from the broadcasting EOA.
/// @dev    Replaces TREXDeployer for live networks: that helper bundles every creation code into one contract
///         (~63 KB runtime), which exceeds the EIP-170 24,576-byte limit and cannot be deployed on Sepolia.
///         Each contract here is under the limit. The broadcaster ends up owner and agent of the token and registry.
abstract contract TREXSuiteDeployment is Script {
    function _deployTrexSuite(
        address agent,
        string memory tokenName,
        string memory tokenSymbol,
        address navOracle
    ) internal returns (ITREXDeployer.TREXSuite memory suite) {
        suite.claimTopicsRegistry = deployCode("ClaimTopicsRegistry.sol:ClaimTopicsRegistry");
        ITREXInit(suite.claimTopicsRegistry).init();

        suite.trustedIssuersRegistry = deployCode("TrustedIssuersRegistry.sol:TrustedIssuersRegistry");
        ITREXInit(suite.trustedIssuersRegistry).init();

        suite.identityRegistryStorage = deployCode("IdentityRegistryStorage.sol:IdentityRegistryStorage");
        IIdentityRegistryStorageInit(suite.identityRegistryStorage).init();

        suite.identityRegistry = deployCode("IdentityRegistry.sol:IdentityRegistry");
        IIdentityRegistryInit(suite.identityRegistry).init(
            suite.trustedIssuersRegistry,
            suite.claimTopicsRegistry,
            suite.identityRegistryStorage
        );
        IIdentityRegistryStorageInit(suite.identityRegistryStorage).bindIdentityRegistry(suite.identityRegistry);

        suite.modularCompliance = deployCode("ModularCompliance.sol:ModularCompliance");
        ITREXInit(suite.modularCompliance).init();

        // Token.init() binds the compliance module to the token itself.
        // Note: deployed via deployCode() to bridge Solc 0.8.17 (T-REX) and 0.8.34 without exceeding the
        // EIP-170 24 KB limit. If `forge script --verify` skips raw deployCode creations, verify nhBOND
        // with: `forge verify-contract <NH_BOND> src/nhBOND.sol:nhBOND --chain-id 11155111`.
        suite.token = deployCode("nhBOND.sol:nhBOND");
        IBondTokenInit token = IBondTokenInit(suite.token);
        token.init(suite.identityRegistry, suite.modularCompliance, tokenName, tokenSymbol, 18, address(0));
        token.setBondDetails("DE0001102580", block.timestamp + 365 days, 250, navOracle);
        token.addAgent(agent);
        token.unpause();

        IIdentityRegistryInit(suite.identityRegistry).addAgent(agent);
        IIdentityRegistryInit(suite.identityRegistry).addAgent(suite.token);
    }
}
