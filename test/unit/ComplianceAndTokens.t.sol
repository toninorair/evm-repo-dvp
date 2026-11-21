// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { RepoTestBase } from "../utils/RepoTestBase.sol";
import { InhEUR } from "../../src/interfaces/InhEUR.sol";
import { IERC3643 } from "../interfaces/IERC3643.sol";
import { IComplianceRegistry } from "../../src/interfaces/IComplianceRegistry.sol";
import { ICollateralPriceOracle } from "../../src/interfaces/ICollateralPriceOracle.sol";
import { nhNAVOracle } from "../../src/nhNAVOracle.sol";
import { InhNAVOracle } from "../../src/interfaces/InhNAVOracle.sol";
import { MockIdentity } from "../mock/MockIdentity.sol";

/// @title  ComplianceAndTokensTest
/// @notice Unit tests for ComplianceRegistry, nhEUR, nhBOND NAV, and nhNAVOracle.
/// @author Ethereum Institutional / Nordhaven Bank
contract ComplianceAndTokensTest is RepoTestBase {
    function test_ComplianceRegistry_Verification() public {
        address newDesk = makeAddr("newDesk");
        assertFalse(complianceRegistry.isVerified(newDesk));

        vm.prank(compliance);
        complianceRegistry.setVerificationStatus(newDesk, true);
        assertTrue(complianceRegistry.isVerified(newDesk));

        vm.prank(compliance);
        complianceRegistry.setVerificationStatus(newDesk, false);
        assertFalse(complianceRegistry.isVerified(newDesk));
    }

    function test_ComplianceRegistry_BatchVerification() public {
        address[] memory desks = new address[](3);
        desks[0] = makeAddr("desk1");
        desks[1] = makeAddr("desk2");
        desks[2] = makeAddr("desk3");

        vm.prank(compliance);
        complianceRegistry.setBatchVerificationStatus(desks, true);

        assertTrue(complianceRegistry.isVerified(desks[0]));
        assertTrue(complianceRegistry.isVerified(desks[1]));
        assertTrue(complianceRegistry.isVerified(desks[2]));
    }

    function test_nhEUR_Gating_RevertsIfNotVerified() public {
        vm.prank(bankB);
        vm.expectRevert(abi.encodeWithSelector(InhEUR.NotKYCVerified.selector, unauthorizedParty));
        cashToken.transfer(unauthorizedParty, 1_000 ether);
    }

    function test_nhEUR_Freeze() public {
        vm.prank(compliance);
        cashToken.setFrozen(bankB, true);
        assertTrue(cashToken.isFrozen(bankB));

        vm.prank(bankB);
        vm.expectRevert(abi.encodeWithSelector(InhEUR.AccountIsFrozen.selector, bankB));
        cashToken.transfer(bankA, 1_000 ether);

        vm.prank(compliance);
        cashToken.setFrozen(bankB, false);

        vm.prank(bankB);
        cashToken.transfer(bankA, 1_000 ether);
        assertEq(cashToken.balanceOf(bankA), 1_000 ether);
    }

    function test_nhBOND_ForcedTransfer() public {
        uint256 transferAmount = 5_000 ether;

        vm.prank(compliance);
        bondToken.forcedTransfer(bankA, bankB, transferAmount);

        assertEq(bondToken.balanceOf(bankB), transferAmount);
    }

    function test_nhBOND_Metadata() public view {
        assertEq(bondToken.name(), "Nordhaven Sovereign Bond NAV");
        assertEq(bondToken.symbol(), "nhBOND NAV");
        assertEq(bondToken.decimals(), 18);
        assertEq(bondToken.isin(), "DE0001102580");
        assertEq(bondToken.couponRateBps(), 250);
        assertFalse(bondToken.isMatured());
    }

    function test_nhBOND_InvestorEligibility() public {
        assertTrue(bondToken.isEligibleInvestor(bankA));
        assertTrue(bondToken.isEligibleInvestor(bankB));
        assertFalse(bondToken.isEligibleInvestor(makeAddr("unverifiedTrader")));
    }

    function test_nhBOND_Issue_And_Redeem_Lifecycle() public {
        uint256 issueAmount = 10_000 ether;
        address investor = bankB;

        // 1. Issue bonds via banking issue helper (onlyAgent)
        vm.prank(compliance);
        bondToken.issue(investor, issueAmount);
        assertEq(bondToken.balanceOf(investor), issueAmount);

        // 2. Redeem before maturity reverts with BondNotMatured
        vm.prank(compliance);
        vm.expectRevert();
        bondToken.redeem(investor, issueAmount);

        // 3. Fast-forward past maturity date
        vm.warp(bondToken.maturityDate() + 1);
        assertTrue(bondToken.isMatured());

        // 4. Redeem after maturity succeeds and burns tokens
        vm.prank(compliance);
        bondToken.redeem(investor, issueAmount);
        assertEq(bondToken.balanceOf(investor), 0);
    }

    function test_nhNAVOracle_LifecycleAndGuards() public {
        address calcAgent = makeAddr("calcAgent");
        nhNAVOracle navOracle = new nhNAVOracle(admin, calcAgent);
        assertEq(navOracle.decimals(), 8);

        // Calculation Agent publishes the NAV
        vm.prank(calcAgent);
        navOracle.updateNAV(100_20000000);
        (uint80 roundId, int256 price, , uint256 updatedAt, ) = navOracle.latestRoundData();
        assertEq(roundId, 1);
        assertEq(price, 100_20000000);
        assertEq(updatedAt, block.timestamp);

        // Non-authorized caller reverts
        vm.prank(bankA);
        vm.expectRevert();
        navOracle.updateNAV(100_25000000);

        // Non-positive NAV reverts
        vm.prank(calcAgent);
        vm.expectRevert(InhNAVOracle.InvalidNAV.selector);
        navOracle.updateNAV(0);

        // No staleness revert in the oracle: it returns raw data and consumers check updatedAt
        uint256 submittedAt = block.timestamp;
        vm.warp(block.timestamp + 30 days);
        (, , , updatedAt, ) = navOracle.latestRoundData();
        assertEq(updatedAt, submittedAt);
    }

    function test_MockOracle_PriceUpdates() public {
        assertEq(oracle.decimals(), 8);
        (, int256 price, , , ) = oracle.latestRoundData();
        assertEq(price, INITIAL_BOND_PRICE);

        int256 newPrice = 98_50000000; // €98.50
        vm.prank(admin);
        oracle.updatePrice(newPrice);

        (, int256 updatedPrice, , , ) = oracle.latestRoundData();
        assertEq(updatedPrice, newPrice);

        vm.prank(admin);
        vm.expectRevert(ICollateralPriceOracle.InvalidPrice.selector);
        oracle.updatePrice(-1);
    }

    /* ============ Official ERC-3643 Standard Tests ============ */

    function test_ERC3643_IdentityGating_RevertsIfNotVerified() public {
        address unverifiedTrader = makeAddr("unverifiedTrader");
        uint256 amount = 1_000 ether;

        // Bank A tries to transfer nhBOND to unverified address -> Reverts
        vm.prank(bankA);
        vm.expectRevert("Transfer not possible");
        bondToken.transfer(unverifiedTrader, amount);

        // Once unverified trader is registered in IdentityRegistry -> Transfer succeeds
        MockIdentity idTrader = new MockIdentity(unverifiedTrader);
        vm.prank(compliance);
        identityRegistry.registerIdentity(unverifiedTrader, idTrader, 276);

        vm.prank(bankA);
        bondToken.transfer(unverifiedTrader, amount);
        assertEq(bondToken.balanceOf(unverifiedTrader), amount);
    }

    function test_ERC3643_PartialFreezing() public {
        uint256 totalBal = bondToken.balanceOf(bankA);
        uint256 freezeAmt = totalBal - 100 ether;

        // Compliance partially freezes tokens
        vm.prank(compliance);
        bondToken.freezePartialTokens(bankA, freezeAmt);
        assertEq(bondToken.getFrozenTokens(bankA), freezeAmt);

        // Bank A can transfer free balance (100 ether)
        vm.prank(bankA);
        bondToken.transfer(bankB, 100 ether);

        // Bank A cannot transfer any more (exceeds free balance)
        vm.prank(bankA);
        vm.expectRevert();
        bondToken.transfer(bankB, 1 ether);

        // Unfreezing restores transferability
        vm.prank(compliance);
        bondToken.unfreezePartialTokens(bankA, 50 ether);
        assertEq(bondToken.getFrozenTokens(bankA), freezeAmt - 50 ether);

        vm.prank(bankA);
        bondToken.transfer(bankB, 50 ether);
    }

    function test_ERC3643_AddressFreezing() public {
        vm.prank(compliance);
        bondToken.setAddressFrozen(bankA, true);
        assertTrue(bondToken.isFrozen(bankA));

        vm.prank(bankA);
        vm.expectRevert("wallet is frozen");
        bondToken.transfer(bankB, 100 ether);

        vm.prank(compliance);
        bondToken.setAddressFrozen(bankA, false);
        assertFalse(bondToken.isFrozen(bankA));

        vm.prank(bankA);
        bondToken.transfer(bankB, 100 ether);
    }

    function test_ERC3643_BatchOperations() public {
        address desk1 = makeAddr("desk1");
        address desk2 = makeAddr("desk2");

        MockIdentity id1 = new MockIdentity(desk1);
        MockIdentity id2 = new MockIdentity(desk2);
        vm.startPrank(compliance);
        identityRegistry.registerIdentity(desk1, id1, 276);
        identityRegistry.registerIdentity(desk2, id2, 250);
        vm.stopPrank();

        address[] memory recipients = new address[](2);
        recipients[0] = desk1;
        recipients[1] = desk2;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 500 ether;
        amounts[1] = 1_000 ether;

        vm.prank(treasury);
        bondToken.batchMint(recipients, amounts);

        assertEq(bondToken.balanceOf(desk1), 500 ether);
        assertEq(bondToken.balanceOf(desk2), 1_000 ether);
    }

    function test_ERC3643_RecoveryAddress() public {
        address lostWallet = bankA;
        address newWallet = makeAddr("newBankAWallet");
        uint256 originalBalance = bondToken.balanceOf(lostWallet);

        MockIdentity idBankA = MockIdentity(address(identityRegistry.identity(lostWallet)));

        vm.prank(compliance);
        bondToken.recoveryAddress(lostWallet, newWallet, address(idBankA));

        assertEq(bondToken.balanceOf(lostWallet), 0);
        assertEq(bondToken.balanceOf(newWallet), originalBalance);
    }
}
