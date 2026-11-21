// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { Test } from "forge-std/Test.sol";

import { ComplianceRegistry } from "../../src/ComplianceRegistry.sol";
import { MockBondPriceOracle } from "../mock/MockBondPriceOracle.sol";
import { nhEUR } from "../../src/nhEUR.sol";
import { RepoDvP } from "../../src/RepoDvP.sol";

import { IERC3643 } from "../interfaces/IERC3643.sol";
import { IERC3643ClaimTopicsRegistry } from "../interfaces/IERC3643ClaimTopicsRegistry.sol";
import { IERC3643TrustedIssuersRegistry } from "../interfaces/IERC3643TrustedIssuersRegistry.sol";
import { IERC3643IdentityRegistryStorage } from "../interfaces/IERC3643IdentityRegistryStorage.sol";
import { IERC3643IdentityRegistry } from "../interfaces/IERC3643IdentityRegistry.sol";
import { IERC3643Compliance } from "../interfaces/IERC3643Compliance.sol";
import { IIdentity } from "../interfaces/IIdentity.sol";
import { InhBOND } from "../../src/interfaces/InhBOND.sol";
import { ITestBond } from "../interfaces/ITestBond.sol";
import { ITREXDeployer } from "../../script/helper/ITREXDeployer.sol";
import { MockIdentity } from "../mock/MockIdentity.sol";

/// @title  RepoTestBase
/// @notice Base test fixture deploying the Nordhaven institutional repo ecosystem with test accounts.
/// @author Ethereum Institutional / Nordhaven Bank
abstract contract RepoTestBase is Test {
    /* ============ Test Accounts ============ */

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal compliance = makeAddr("compliance");

    uint256 internal bankAPk = 0xA11CE;
    address internal bankA; // Borrower

    uint256 internal bankBPk = 0xB0B;
    address internal bankB; // Lender

    address internal unauthorizedParty = makeAddr("unauthorized");

    /* ============ Contracts ============ */

    IERC3643ClaimTopicsRegistry internal claimTopicsRegistry;
    IERC3643TrustedIssuersRegistry internal trustedIssuersRegistry;
    IERC3643IdentityRegistryStorage internal identityRegistryStorage;
    IERC3643IdentityRegistry internal identityRegistry;
    IERC3643Compliance internal modularCompliance;

    ComplianceRegistry internal complianceRegistry;
    MockBondPriceOracle internal oracle;
    nhEUR internal cashToken;
    ITestBond internal bondToken;
    RepoDvP internal repoDvP;

    /* ============ Constants ============ */

    int256 internal constant INITIAL_BOND_PRICE = 100_00000000; // €100.00 par (8 decimals)
    // Long enough that tests warping through a full term are not tripped by staleness; staleness has its own test.
    uint256 internal constant MAX_PRICE_AGE = 365 days;
    uint256 internal constant INITIAL_CASH_BALANCE = 100_000_000 ether; // €100M
    uint256 internal constant INITIAL_BOND_BALANCE = 1_000_000 ether; // 1M bonds (€100M par)

    /* ============ Setup ============ */

    function setUp() public virtual {
        bankA = vm.addr(bankAPk);
        bankB = vm.addr(bankBPk);

        vm.startPrank(admin);

        // 1. Deploy Bond Price Oracle (8 decimals, €100.00)
        oracle = new MockBondPriceOracle(admin, INITIAL_BOND_PRICE);

        // 2. Deploy Authentic ERC-3643 Infrastructure & Bond Token (Official T-REX Framework)
        ITREXDeployer trexDeployer = ITREXDeployer(deployCode("TREXDeployer.sol:TREXDeployer"));
        ITREXDeployer.TREXSuite memory suite = trexDeployer.deploySuite(
            admin,
            compliance,
            treasury,
            "Nordhaven Sovereign Bond NAV",
            "nhBOND NAV",
            18,
            address(oracle)
        );
        claimTopicsRegistry = IERC3643ClaimTopicsRegistry(suite.claimTopicsRegistry);
        trustedIssuersRegistry = IERC3643TrustedIssuersRegistry(suite.trustedIssuersRegistry);
        identityRegistryStorage = IERC3643IdentityRegistryStorage(suite.identityRegistryStorage);
        identityRegistry = IERC3643IdentityRegistry(suite.identityRegistry);
        modularCompliance = IERC3643Compliance(suite.modularCompliance);
        bondToken = ITestBond(suite.token);

        // 3. Deploy Compliance Registry (for nhEUR / RepoDvP)
        complianceRegistry = new ComplianceRegistry(admin, compliance);

        // 4. Deploy nhEUR Deposit Token
        cashToken = new nhEUR(admin, treasury, compliance, address(complianceRegistry));

        // 5. Deploy RepoDvP Engine
        repoDvP = new RepoDvP(
            admin,
            address(complianceRegistry),
            address(oracle),
            MAX_PRICE_AGE,
            address(bondToken),
            address(cashToken)
        );

        vm.stopPrank();

        // 7. Onboard institutional counterparties
        vm.startPrank(compliance);
        complianceRegistry.setVerificationStatus(bankA, true);
        complianceRegistry.setVerificationStatus(bankB, true);
        complianceRegistry.setVerificationStatus(address(repoDvP), true);

        // Register official ONCHAINIDs in ERC-3643 IdentityRegistry
        MockIdentity idBankA = new MockIdentity(bankA);
        MockIdentity idBankB = new MockIdentity(bankB);
        MockIdentity idRepoDvP = new MockIdentity(address(repoDvP));
        MockIdentity idTreasury = new MockIdentity(treasury);

        identityRegistry.registerIdentity(bankA, idBankA, 276); // Germany
        identityRegistry.registerIdentity(bankB, idBankB, 250); // France
        identityRegistry.registerIdentity(address(repoDvP), idRepoDvP, 276);
        identityRegistry.registerIdentity(treasury, idTreasury, 276);
        vm.stopPrank();

        // 8. Fund Trading Desks
        vm.startPrank(treasury);
        // Bank A holds collateral bonds
        bondToken.mint(bankA, INITIAL_BOND_BALANCE);
        // Bank B holds liquidity cash deposits
        cashToken.mint(bankB, INITIAL_CASH_BALANCE, "TARGET2-CREDIT-001");
        vm.stopPrank();
    }

    /// @dev Reads a repo's state from the public `states` mapping getter.
    function _getState(uint256 repoId) internal view returns (RepoDvP.RepoState memory s) {
        (s.status, s.startTime, s.maturity, s.collateralAmount, s.cureDeadline) = repoDvP.states(repoId);
    }

    /// @dev Reads a repo's terms from the public `orders` mapping getter.
    function _getOrder(uint256 repoId) internal view returns (RepoDvP.RepoOrder memory o) {
        // A static struct ABI-encodes like the getter's flat tuple, so decode it directly (avoids stack-too-deep).
        (bool ok, bytes memory data) = address(repoDvP).staticcall(abi.encodeCall(repoDvP.orders, (repoId)));
        require(ok, "orders() failed");
        o = abi.decode(data, (RepoDvP.RepoOrder));
    }
}
