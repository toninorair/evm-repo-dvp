// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "ERC-3643/token/Token.sol";
import "ERC-3643/registry/implementation/ClaimTopicsRegistry.sol";
import "ERC-3643/registry/implementation/TrustedIssuersRegistry.sol";
import "ERC-3643/registry/implementation/IdentityRegistryStorage.sol";
import "ERC-3643/registry/implementation/IdentityRegistry.sol";
import "ERC-3643/compliance/modular/ModularCompliance.sol";
import "@onchain-id/solidity/contracts/Identity.sol";

/// @title  TREXDeployer
/// @notice Deployer for authentic ERC-3643 (T-REX v4) smart contracts.
/// @dev    Compiled under Solc 0.8.17 to match official T-REX framework requirements.
contract TREXDeployer {
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
    ) external returns (TREXSuite memory suite) {
        // 1. Deploy & Init ClaimTopicsRegistry
        ClaimTopicsRegistry ctr = new ClaimTopicsRegistry();
        ctr.init();

        // 2. Deploy & Init TrustedIssuersRegistry
        TrustedIssuersRegistry tir = new TrustedIssuersRegistry();
        tir.init();

        // 3. Deploy & Init IdentityRegistryStorage
        IdentityRegistryStorage irs = new IdentityRegistryStorage();
        irs.init();

        // 4. Deploy & Init IdentityRegistry
        IdentityRegistry ir = new IdentityRegistry();
        ir.init(address(tir), address(ctr), address(irs));
        irs.bindIdentityRegistry(address(ir));

        // 5. Deploy & Init ModularCompliance
        ModularCompliance mc = new ModularCompliance();
        mc.init();

        // 6. Deploy & Init Token
        Token tok = new Token();
        tok.init(address(ir), address(mc), tokenName, tokenSymbol, decimals, address(0));

        // Bind token to ModularCompliance
        mc.bindToken(address(tok));

        // Setup Agent permissions on Token
        tok.addAgent(address(this));
        tok.unpause();
        tok.removeAgent(address(this));
        if (!tok.isAgent(compliance)) tok.addAgent(compliance);
        if (!tok.isAgent(issuer)) tok.addAgent(issuer);

        // Setup Agent permissions on IdentityRegistry
        if (!ir.isAgent(compliance)) ir.addAgent(compliance);
        if (!ir.isAgent(address(tok))) ir.addAgent(address(tok));

        // Transfer ownership of all contracts to designated admin
        ctr.transferOwnership(admin);
        tir.transferOwnership(admin);
        irs.transferOwnership(admin);
        ir.transferOwnership(admin);
        mc.transferOwnership(admin);
        tok.transferOwnership(admin);

        suite = TREXSuite({
            claimTopicsRegistry: address(ctr),
            trustedIssuersRegistry: address(tir),
            identityRegistryStorage: address(irs),
            identityRegistry: address(ir),
            modularCompliance: address(mc),
            token: address(tok)
        });
    }

    function deployIdentity(address initialManagementKey) external returns (address) {
        Identity id = new Identity(initialManagementKey, false);
        return address(id);
    }
}
