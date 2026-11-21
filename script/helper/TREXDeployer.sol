// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { ClaimTopicsRegistry } from "ERC-3643/registry/implementation/ClaimTopicsRegistry.sol";
import { TrustedIssuersRegistry } from "ERC-3643/registry/implementation/TrustedIssuersRegistry.sol";
import { IdentityRegistryStorage } from "ERC-3643/registry/implementation/IdentityRegistryStorage.sol";
import { IdentityRegistry } from "ERC-3643/registry/implementation/IdentityRegistry.sol";
import { ModularCompliance } from "ERC-3643/compliance/modular/ModularCompliance.sol";
import { Identity } from "@onchain-id/solidity/contracts/Identity.sol";

import { nhBOND } from "../../src/nhBOND.sol";
import { ITREXDeployer } from "./ITREXDeployer.sol";

/// @title  TREXDeployer
/// @notice Deployer bridge compiled with Solc 0.8.17 that instantiates the authentic
///         ERC-3643 (T-REX) framework and derived nhBOND token.
contract TREXDeployer is ITREXDeployer {
    function deploySuite(
        address admin,
        address compliance,
        address issuer,
        string memory tokenName,
        string memory tokenSymbol,
        uint8 decimals,
        address navOracle
    ) external returns (TREXSuite memory suite) {
        BondDetails memory details = BondDetails({
            tokenName: tokenName,
            tokenSymbol: tokenSymbol,
            decimals: decimals,
            isin: "DE0001102580",
            maturityDate: block.timestamp + 365 days,
            couponRateBps: 250,
            navOracle: navOracle
        });
        return deployBondSuite(admin, compliance, issuer, details);
    }

    function deployBondSuite(
        address admin,
        address compliance,
        address issuer,
        BondDetails memory bondDetails
    ) public returns (TREXSuite memory suite) {
        (
            suite.claimTopicsRegistry,
            suite.trustedIssuersRegistry,
            suite.identityRegistryStorage,
            suite.identityRegistry
        ) = _deployRegistries(admin);

        ModularCompliance mc = new ModularCompliance();
        mc.init();
        suite.modularCompliance = address(mc);

        suite.token = _deployToken(suite.identityRegistry, suite.modularCompliance, bondDetails);

        _configurePermissions(suite.token, suite.identityRegistry, suite.modularCompliance, compliance, issuer, admin);
    }

    function _deployRegistries(
        address admin
    ) internal returns (address ctrAddr, address tirAddr, address irsAddr, address irAddr) {
        ClaimTopicsRegistry ctr = new ClaimTopicsRegistry();
        ctr.init();
        ctr.transferOwnership(admin);
        ctrAddr = address(ctr);

        TrustedIssuersRegistry tir = new TrustedIssuersRegistry();
        tir.init();
        tir.transferOwnership(admin);
        tirAddr = address(tir);

        IdentityRegistryStorage irs = new IdentityRegistryStorage();
        irs.init();
        irsAddr = address(irs);

        IdentityRegistry ir = new IdentityRegistry();
        ir.init(tirAddr, ctrAddr, irsAddr);
        irs.bindIdentityRegistry(address(ir));
        irs.transferOwnership(admin);
        irAddr = address(ir);
    }

    function _deployToken(address ir, address mc, BondDetails memory bondDetails) internal returns (address) {
        nhBOND tok = new nhBOND();
        tok.init(ir, mc, bondDetails.tokenName, bondDetails.tokenSymbol, bondDetails.decimals, address(0));
        tok.setBondDetails(
            bondDetails.isin,
            bondDetails.maturityDate,
            bondDetails.couponRateBps,
            bondDetails.navOracle
        );
        return address(tok);
    }

    function _configurePermissions(
        address tokAddr,
        address irAddr,
        address mcAddr,
        address compliance,
        address issuer,
        address admin
    ) internal {
        nhBOND tok = nhBOND(tokAddr);
        IdentityRegistry ir = IdentityRegistry(irAddr);
        ModularCompliance mc = ModularCompliance(mcAddr);

        mc.bindToken(tokAddr);

        tok.addAgent(address(this));
        tok.unpause();
        tok.removeAgent(address(this));
        if (!tok.isAgent(compliance)) tok.addAgent(compliance);
        if (!tok.isAgent(issuer)) tok.addAgent(issuer);

        if (!ir.isAgent(compliance)) ir.addAgent(compliance);
        if (!ir.isAgent(tokAddr)) ir.addAgent(tokAddr);

        ir.transferOwnership(admin);
        mc.transferOwnership(admin);
        tok.transferOwnership(admin);
    }

    function deployIdentity(address initialManagementKey) external returns (address) {
        Identity id = new Identity(initialManagementKey, false);
        return address(id);
    }
}
