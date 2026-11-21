// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { RepoDvP } from "../../src/RepoDvP.sol";
import { RepoTestBase } from "../utils/RepoTestBase.sol";
import { IRepoDvP } from "../../src/interfaces/IRepoDvP.sol";
import { MockIdentityRegistry } from "../mock/MockIdentityRegistry.sol";
import { AggregatorV3Interface, InhNAVOracle } from "../../src/interfaces/InhNAVOracle.sol";

/// @title  RepoDvPTest
/// @notice Unit tests for RepoDvP settlement engine covering DvP, RvP, dynamic collateral sizing, and live registry checks.
/// @author Ethereum Institutional / Nordhaven Bank
contract RepoDvPTest is RepoTestBase {
    uint256 internal constant CASH_PRINCIPAL = 10_000_000 ether; // €10,000,000
    // Independently computed for the terms below at €100.00:
    //   interest (full term) = 10,000,000e18 × 350 × 604,800 / 311,040,000,000 = 6,805.555…e18 (rounded down)
    //   initial requirement  = principal × 10,200 / 10,000 = 10,200,000e18 (interest is not pre-collateralised)
    //   collateralAmount     = ceilDiv(10,200,000e18 × 1e8, 100e8) = 102,000e18
    uint256 internal constant EXPECTED_INTEREST = 6_805_555555555555555555;
    uint256 internal constant EXPECTED_REQUIRED_VALUE = 10_200_000 ether;
    uint256 internal constant COLLATERAL_AMOUNT = 102_000 ether;
    uint256 internal constant MAX_COLLATERAL_AMOUNT = 103_000 ether; // borrower's cap (~0.9% price slippage)
    uint32 internal constant REPO_RATE_BPS = 350; // 3.50%
    uint32 internal constant TERM_SECONDS = 7 days; // 604,800 seconds
    uint32 internal constant CURE_PERIOD_SECONDS = 2 hours;
    uint32 internal constant MAINTENANCE_MARGIN_BPS = 100; // 1.00%
    uint32 internal constant INITIAL_MARGIN_BPS = 200; // 2.00% over the principal

    function test_ProposeRepo_And_Cancel() public {
        vm.startPrank(bankA);
        uint256 repoId = repoDvP.proposeRepo(
            bankB,
            CASH_PRINCIPAL,
            REPO_RATE_BPS,
            INITIAL_MARGIN_BPS,
            MAINTENANCE_MARGIN_BPS,
            TERM_SECONDS,
            CURE_PERIOD_SECONDS,
            MAX_COLLATERAL_AMOUNT,
            uint40(block.timestamp + 1 days)
        );
        vm.stopPrank();

        assertEq(repoId, 1);
        RepoDvP.RepoOrder memory order = _getOrder(repoId);
        RepoDvP.RepoState memory state = _getState(repoId);
        assertEq(order.borrower, bankA);
        assertEq(order.lender, bankB);
        assertEq(order.maxCollateralAmount, MAX_COLLATERAL_AMOUNT);
        assertEq(state.collateralAmount, 0); // nothing sized or moved until acceptance
        assertEq(uint8(state.status), uint8(RepoDvP.RepoStatus.Proposed));

        // Bank A cancels
        vm.prank(bankA);
        repoDvP.cancelRepo(repoId);

        state = _getState(repoId);
        assertEq(uint8(state.status), uint8(RepoDvP.RepoStatus.Cancelled));
    }

    function test_AtomicDvP_OpeningLeg() public {
        // 1. Bank A proposes repo
        vm.prank(bankA);
        uint256 repoId = repoDvP.proposeRepo(
            bankB,
            CASH_PRINCIPAL,
            REPO_RATE_BPS,
            INITIAL_MARGIN_BPS,
            MAINTENANCE_MARGIN_BPS,
            TERM_SECONDS,
            CURE_PERIOD_SECONDS,
            MAX_COLLATERAL_AMOUNT,
            uint40(block.timestamp + 1 days)
        );

        // 2. Both counterparties approve RepoDvP
        vm.prank(bankA);
        bondToken.approve(address(repoDvP), COLLATERAL_AMOUNT);

        vm.prank(bankB);
        cashToken.approve(address(repoDvP), CASH_PRINCIPAL);

        uint256 bankABondBefore = bondToken.balanceOf(bankA);
        uint256 bankACashBefore = cashToken.balanceOf(bankA);
        uint256 bankBBondBefore = bondToken.balanceOf(bankB);
        uint256 bankBCashBefore = cashToken.balanceOf(bankB);

        // 3. Bank B accepts proposal -> Atomic DvP executes
        vm.prank(bankB);
        repoDvP.acceptRepo(repoId);

        // 4. Verify balances post-DvP
        // Borrower (Bank A) lost bonds into escrow, gained cash
        assertEq(bondToken.balanceOf(bankA), bankABondBefore - COLLATERAL_AMOUNT);
        assertEq(cashToken.balanceOf(bankA), bankACashBefore + CASH_PRINCIPAL);

        // Lender (Bank B) lost cash, bond held in escrow (NOT in Bank B's wallet)
        assertEq(cashToken.balanceOf(bankB), bankBCashBefore - CASH_PRINCIPAL);
        assertEq(bondToken.balanceOf(bankB), bankBBondBefore);

        // Escrow holds the bonds; RepoDvP holds zero cash
        assertEq(bondToken.balanceOf(address(repoDvP)), COLLATERAL_AMOUNT);
        assertEq(cashToken.balanceOf(address(repoDvP)), 0);

        RepoDvP.RepoState memory state = _getState(repoId);
        assertEq(uint8(state.status), uint8(RepoDvP.RepoStatus.Active));
        assertEq(state.startTime, block.timestamp);
        assertEq(state.maturity, block.timestamp + TERM_SECONDS);
    }

    function test_ClosingLeg_RvP_Settlement_AtMaturity() public {
        // Run Opening Leg
        vm.prank(bankA);
        uint256 repoId = repoDvP.proposeRepo(
            bankB,
            CASH_PRINCIPAL,
            REPO_RATE_BPS,
            INITIAL_MARGIN_BPS,
            MAINTENANCE_MARGIN_BPS,
            TERM_SECONDS,
            CURE_PERIOD_SECONDS,
            MAX_COLLATERAL_AMOUNT,
            uint40(block.timestamp + 1 days)
        );

        vm.prank(bankA);
        bondToken.approve(address(repoDvP), COLLATERAL_AMOUNT);
        vm.prank(bankB);
        cashToken.approve(address(repoDvP), CASH_PRINCIPAL);
        vm.prank(bankB);
        repoDvP.acceptRepo(repoId);

        // Fast-forward to maturity (7 days)
        vm.warp(block.timestamp + TERM_SECONDS);

        // Expected interest: (10,000,000 * 350 * 604,800) / 311,040,000,000 = 6,805.555555555555555555 EUR
        uint256 principal = _getOrder(repoId).borrowAmount;
        uint256 interest = repoDvP.getRepoInterest(repoId);
        uint256 totalRepurchasePrice = repoDvP.getCurrentRepurchasePrice(repoId);
        assertEq(principal, CASH_PRINCIPAL);
        assertGt(interest, 0);
        assertEq(totalRepurchasePrice, principal + interest);

        // Bank A funds interest from treasury
        vm.prank(treasury);
        cashToken.mint(bankA, interest, "INTEREST-RESERVE");

        // Bank A approves cash repayment
        vm.prank(bankA);
        cashToken.approve(address(repoDvP), totalRepurchasePrice);

        uint256 bankABondBefore = bondToken.balanceOf(bankA);
        uint256 bankBCashBefore = cashToken.balanceOf(bankB);

        // Bank A settles repo -> Atomic RvP executes
        vm.prank(bankA);
        repoDvP.settleRepo(repoId);

        // Verify: Borrower got collateral back; Lender got principal + interest; Escrow is empty
        assertEq(bondToken.balanceOf(bankA), bankABondBefore + COLLATERAL_AMOUNT);
        assertEq(cashToken.balanceOf(bankB), bankBCashBefore + totalRepurchasePrice);
        assertEq(bondToken.balanceOf(address(repoDvP)), 0);
        assertEq(cashToken.balanceOf(address(repoDvP)), 0);

        RepoDvP.RepoState memory state = _getState(repoId);
        assertEq(uint8(state.status), uint8(RepoDvP.RepoStatus.Settled));
    }

    function test_ProposeRepo_RevertsOnZeroLender() public {
        vm.prank(bankA);
        vm.expectRevert(IRepoDvP.InvalidLender.selector);
        repoDvP.proposeRepo(
            address(0),
            CASH_PRINCIPAL,
            REPO_RATE_BPS,
            INITIAL_MARGIN_BPS,
            MAINTENANCE_MARGIN_BPS,
            TERM_SECONDS,
            CURE_PERIOD_SECONDS,
            MAX_COLLATERAL_AMOUNT,
            uint40(block.timestamp + 1 days)
        );
    }

    function test_ProposeRepo_RevertsWhenBorrowerIsLender() public {
        vm.prank(bankA);
        vm.expectRevert(IRepoDvP.InvalidLender.selector);
        repoDvP.proposeRepo(
            bankA,
            CASH_PRINCIPAL,
            REPO_RATE_BPS,
            INITIAL_MARGIN_BPS,
            MAINTENANCE_MARGIN_BPS,
            TERM_SECONDS,
            CURE_PERIOD_SECONDS,
            MAX_COLLATERAL_AMOUNT,
            uint40(block.timestamp + 1 days)
        );
    }

    function test_ProposeRepo_RevertsWhenLenderNotVerifiedOnCollateralRegistry() public {
        vm.prank(compliance);
        identityRegistry.deleteIdentity(bankB);

        vm.expectRevert(abi.encodeWithSelector(IRepoDvP.NotKYCVerified.selector, bankB));
        _propose(uint40(block.timestamp + 1 days));
    }

    function test_ProposeRepo_ChecksCashTokenRegistryLive() public {
        // nhEUR moves to its own registry after RepoDvP is deployed; only the borrower is onboarded there.
        MockIdentityRegistry cashRegistry = new MockIdentityRegistry();
        cashRegistry.setVerified(bankA, true);
        vm.prank(admin);
        cashToken.setIdentityRegistry(address(cashRegistry));

        vm.expectRevert(abi.encodeWithSelector(IRepoDvP.NotKYCVerified.selector, bankB));
        _propose(uint40(block.timestamp + 1 days));

        cashRegistry.setVerified(bankB, true);
        assertEq(_propose(uint40(block.timestamp + 1 days)), 1);
    }

    function _propose(uint40 acceptDeadline) internal returns (uint256) {
        vm.prank(bankA);
        return
            repoDvP.proposeRepo(
                bankB,
                CASH_PRINCIPAL,
                REPO_RATE_BPS,
                INITIAL_MARGIN_BPS,
                MAINTENANCE_MARGIN_BPS,
                TERM_SECONDS,
                CURE_PERIOD_SECONDS,
                MAX_COLLATERAL_AMOUNT,
                acceptDeadline
            );
    }

    function test_AcceptRepo_RevertsWhenBorrowerAccepts() public {
        uint256 repoId = _propose(uint40(block.timestamp + 1 days));

        // Lender has a standing allowance; the borrower must not be able to use it.
        vm.prank(bankB);
        cashToken.approve(address(repoDvP), type(uint256).max);
        vm.prank(bankA);
        bondToken.approve(address(repoDvP), COLLATERAL_AMOUNT);

        vm.prank(bankA);
        vm.expectRevert(IRepoDvP.Unauthorized.selector);
        repoDvP.acceptRepo(repoId);
    }

    function test_AcceptRepo_RevertsAfterDeadline() public {
        uint40 deadline = uint40(block.timestamp + 1 hours);
        uint256 repoId = _propose(deadline);

        vm.warp(uint256(deadline) + 1);
        vm.prank(bankB);
        vm.expectRevert(abi.encodeWithSelector(IRepoDvP.ProposalExpired.selector, deadline, block.timestamp));
        repoDvP.acceptRepo(repoId);

        // Expired proposals can still be cancelled by the borrower.
        vm.prank(bankA);
        repoDvP.cancelRepo(repoId);
    }

    function test_CancelRepo_RevertsForLender() public {
        uint256 repoId = _propose(uint40(block.timestamp + 1 days));
        vm.prank(bankB);
        vm.expectRevert(IRepoDvP.Unauthorized.selector);
        repoDvP.cancelRepo(repoId);
    }

    function test_ProposeRepo_RevertsOnPastDeadline() public {
        vm.expectRevert(IRepoDvP.AcceptDeadlineInvalid.selector);
        _propose(uint40(block.timestamp));
    }

    /* ============ Collateral sizing ============ */

    function _approveAndAccept(uint256 repoId) internal {
        vm.prank(bankA);
        bondToken.approve(address(repoDvP), MAX_COLLATERAL_AMOUNT);
        vm.prank(bankB);
        cashToken.approve(address(repoDvP), CASH_PRINCIPAL);
        vm.prank(bankB);
        repoDvP.acceptRepo(repoId);
    }

    function test_GetRepoInterest_Actual360() public {
        uint256 repoId = _propose(uint40(block.timestamp + 1 days));
        _approveAndAccept(repoId);
        assertEq(repoDvP.getRepoInterest(repoId), 0);

        vm.warp(block.timestamp + TERM_SECONDS);
        assertEq(repoDvP.getRepoInterest(repoId), EXPECTED_INTEREST);
    }

    function test_GetCollateralPrice_ReadsOracle() public {
        assertEq(repoDvP.getCollateralPrice(), uint256(INITIAL_BOND_PRICE));

        vm.prank(admin);
        oracle.updateNAV(99_50000000);
        assertEq(repoDvP.getCollateralPrice(), 99_50000000);
    }

    function test_GetRequiredCollateralAmount_MaintenanceBeforeAccrual() public {
        uint256 repoId = _propose(uint40(block.timestamp + 1 days));
        // Before acceptance no interest accrues: principal × 10,100 / 10,000 at €100 = 101,000 bonds.
        assertEq(repoDvP.getRequiredCollateralAmount(repoId), 101_000 ether);
    }

    function test_AcceptRepo_PullsExactQuotedCollateral() public {
        uint256 repoId = _propose(uint40(block.timestamp + 1 days));
        uint256 bankABondBefore = bondToken.balanceOf(bankA);

        _approveAndAccept(repoId);

        RepoDvP.RepoState memory state = _getState(repoId);
        assertEq(state.collateralAmount, COLLATERAL_AMOUNT);
        assertEq(bondToken.balanceOf(bankA), bankABondBefore - COLLATERAL_AMOUNT);
        assertEq(bondToken.balanceOf(address(repoDvP)), COLLATERAL_AMOUNT);
    }

    function test_AcceptRepo_ResizesCollateralWhenPriceDropsWithinCap() public {
        uint256 repoId = _propose(uint40(block.timestamp + 1 days));

        int256 newPrice = 99_50000000; // €99.50
        vm.prank(admin);
        oracle.updateNAV(newPrice);

        _approveAndAccept(repoId);

        // ceilDiv(10,200,000e18 × 1e8, 99.5e8)
        uint256 expected = (EXPECTED_REQUIRED_VALUE * 1e8 + uint256(newPrice) - 1) / uint256(newPrice);
        RepoDvP.RepoState memory state = _getState(repoId);
        assertEq(state.collateralAmount, expected);
        assertGt(expected, COLLATERAL_AMOUNT);
        assertLe(expected, MAX_COLLATERAL_AMOUNT);
    }

    function test_AcceptRepo_RevertsWhenPriceDropExceedsCap() public {
        uint256 repoId = _propose(uint40(block.timestamp + 1 days));

        int256 newPrice = 99_00000000; // €99.00 -> needs ~103,030 bonds > 103,000 cap
        vm.prank(admin);
        oracle.updateNAV(newPrice);

        uint256 required = (EXPECTED_REQUIRED_VALUE * 1e8 + uint256(newPrice) - 1) / uint256(newPrice);
        vm.prank(bankB);
        vm.expectRevert(abi.encodeWithSelector(IRepoDvP.CollateralAboveCap.selector, required, MAX_COLLATERAL_AMOUNT));
        repoDvP.acceptRepo(repoId);
    }

    function test_ProposeRepo_RevertsOnZeroCollateralCap() public {
        vm.prank(bankA);
        vm.expectRevert(IRepoDvP.ZeroAmount.selector);
        repoDvP.proposeRepo(
            bankB,
            CASH_PRINCIPAL,
            REPO_RATE_BPS,
            INITIAL_MARGIN_BPS,
            MAINTENANCE_MARGIN_BPS,
            TERM_SECONDS,
            CURE_PERIOD_SECONDS,
            0,
            uint40(block.timestamp + 1 days)
        );
    }

    function test_ProposeRepo_RevertsWhenMaintenanceExceedsInitialMargin() public {
        vm.prank(bankA);
        vm.expectRevert(IRepoDvP.MaintenanceMarginInvalid.selector);
        repoDvP.proposeRepo(
            bankB,
            CASH_PRINCIPAL,
            REPO_RATE_BPS,
            INITIAL_MARGIN_BPS,
            INITIAL_MARGIN_BPS + 1, // maintenance above initial is rejected
            TERM_SECONDS,
            CURE_PERIOD_SECONDS,
            MAX_COLLATERAL_AMOUNT,
            uint40(block.timestamp + 1 days)
        );

        // Equal margins are allowed.
        vm.prank(bankA);
        repoDvP.proposeRepo(
            bankB,
            CASH_PRINCIPAL,
            REPO_RATE_BPS,
            INITIAL_MARGIN_BPS,
            INITIAL_MARGIN_BPS,
            TERM_SECONDS,
            CURE_PERIOD_SECONDS,
            MAX_COLLATERAL_AMOUNT,
            uint40(block.timestamp + 1 days)
        );
    }

    function test_ProposeRepo_RevertsOnExcessiveInitialMargin() public {
        uint32 tooHigh = repoDvP.MAX_INITIAL_MARGIN_BPS() + 1;
        vm.prank(bankA);
        vm.expectRevert(IRepoDvP.InitialMarginInvalid.selector);
        repoDvP.proposeRepo(
            bankB,
            CASH_PRINCIPAL,
            REPO_RATE_BPS,
            tooHigh,
            MAINTENANCE_MARGIN_BPS,
            TERM_SECONDS,
            CURE_PERIOD_SECONDS,
            MAX_COLLATERAL_AMOUNT,
            uint40(block.timestamp + 1 days)
        );
    }

    function test_OpenedRepo_IsHealthyThroughoutTermAtUnchangedPrice() public {
        uint256 repoId = _propose(uint40(block.timestamp + 1 days));
        _approveAndAccept(repoId);

        bool healthyAtOpen = repoDvP.isMarginHealthy(repoId);
        assertTrue(healthyAtOpen);

        vm.warp(block.timestamp + TERM_SECONDS);
        bool healthyAtMaturity = repoDvP.isMarginHealthy(repoId);
        assertTrue(healthyAtMaturity);

        vm.expectRevert(IRepoDvP.MarginSufficient.selector);
        repoDvP.marginCall(repoId);
    }

    function test_GetCollateralPrice_RevertsOnNegativeNAV() public {
        vm.mockCall(
            address(oracle),
            abi.encodeWithSelector(AggregatorV3Interface.latestRoundData.selector),
            abi.encode(uint80(1), int256(0), block.timestamp, block.timestamp, uint80(1))
        );
        vm.expectRevert(InhNAVOracle.InvalidNAV.selector);
        repoDvP.getCollateralPrice();

        vm.mockCall(
            address(oracle),
            abi.encodeWithSelector(AggregatorV3Interface.latestRoundData.selector),
            abi.encode(uint80(1), int256(-1), block.timestamp, block.timestamp, uint80(1))
        );
        vm.expectRevert(InhNAVOracle.InvalidNAV.selector);
        repoDvP.getCollateralPrice();
    }

    function test_GetCollateralPrice_IgnoresAge() public {
        // RepoDvP applies no staleness limit: an old NAV is still the price.
        vm.warp(block.timestamp + 365 days);
        assertEq(repoDvP.getCollateralPrice(), uint256(INITIAL_BOND_PRICE));
    }

    /* ============ State guards and margin views ============ */

    function test_SettleAndTopUp_RevertWhileProposed() public {
        uint256 repoId = _propose(uint40(block.timestamp + 1 days));

        vm.startPrank(bankA);
        vm.expectRevert(abi.encodeWithSelector(RepoDvP.InvalidState.selector, RepoDvP.RepoStatus.Proposed));
        repoDvP.settleRepo(repoId);

        vm.expectRevert(abi.encodeWithSelector(RepoDvP.InvalidState.selector, RepoDvP.RepoStatus.Proposed));
        repoDvP.topUpCollateral(repoId, 1 ether);
        vm.stopPrank();
    }

    function test_CollateralValues_MarkedToOracleAtOpen() public {
        uint256 repoId = _propose(uint40(block.timestamp + 1 days));
        _approveAndAccept(repoId);

        uint256 posted = _getState(repoId).collateralAmount;
        uint256 value = repoDvP.getCollateralValue(repoId);
        uint256 required = repoDvP.getRequiredCollateralValue(repoId);

        // Value is the escrowed bonds at the oracle NAV (8 decimals).
        assertEq(value, (posted * uint256(INITIAL_BOND_PRICE)) / 1e8);
        // Before any accrual the requirement is principal plus the maintenance margin.
        assertEq(required, (CASH_PRINCIPAL * (10_000 + MAINTENANCE_MARGIN_BPS)) / 10_000);
        // Opening at the initial margin leaves the repo above its maintenance requirement.
        assertGe(value, (CASH_PRINCIPAL * (10_000 + INITIAL_MARGIN_BPS)) / 10_000);
        assertGt(value, required);
    }
}
