// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { RepoDvP } from "../../src/RepoDvP.sol";
import { RepoTestBase } from "../utils/RepoTestBase.sol";
import { IRepoDvP } from "../../src/interfaces/IRepoDvP.sol";
import { ICollateralPriceOracle } from "../../src/interfaces/ICollateralPriceOracle.sol";

/// @title  MarginAndDefaultTest
/// @notice Integration tests for dynamic mark-to-market margin calls, top-ups, and default liquidations.
/// @author Ethereum Institutional / Nordhaven Bank
contract MarginAndDefaultTest is RepoTestBase {
    uint256 internal constant CASH_PRINCIPAL = 10_000_000 ether; // €10,000,000
    uint32 internal constant REPO_RATE_BPS = 350; // 3.50%
    uint32 internal constant TERM_SECONDS = 7 days;
    uint32 internal constant CURE_PERIOD_SECONDS = 2 hours;
    uint32 internal constant MAINTENANCE_MARGIN_BPS = 100; // 1.00%
    uint32 internal constant INITIAL_MARGIN_BPS = 200; // 2.00%

    uint256 internal activeRepoId;
    uint256 internal collateralAmount; // sized by acceptRepo (~102,069 bonds at €100)

    function setUp() public override {
        super.setUp();

        // Initialize and open standard repo
        vm.prank(bankA);
        activeRepoId = repoDvP.proposeRepo(
            bankB,
            CASH_PRINCIPAL,
            REPO_RATE_BPS,
            INITIAL_MARGIN_BPS,
            MAINTENANCE_MARGIN_BPS,
            TERM_SECONDS,
            CURE_PERIOD_SECONDS,
            type(uint256).max,
            uint40(block.timestamp + 1 days)
        );

        vm.prank(bankA);
        bondToken.approve(address(repoDvP), type(uint256).max);
        vm.prank(bankB);
        cashToken.approve(address(repoDvP), type(uint256).max);

        vm.prank(bankB);
        repoDvP.acceptRepo(activeRepoId);

        RepoDvP.RepoState memory state = _getState(activeRepoId);
        collateralAmount = state.collateralAmount;
    }

    function test_MarginCall_Trigger_And_TopUp_Cure() public {
        // Bond price drops from €100 to €92
        int256 droppedPrice = 92_00000000;
        vm.prank(admin);
        oracle.updatePrice(droppedPrice);

        // Trigger margin call notice
        repoDvP.marginCall(activeRepoId);

        RepoDvP.RepoState memory state = _getState(activeRepoId);
        assertEq(uint8(state.status), uint8(RepoDvP.RepoStatus.MarginCalled));
        assertEq(state.cureDeadline, block.timestamp + CURE_PERIOD_SECONDS);

        // Borrower tops up collateral: 10,000 additional bonds
        uint256 topUp = 10_000 ether;
        vm.prank(bankA);
        repoDvP.topUpCollateral(activeRepoId, topUp);

        // Position is restored to Healthy
        state = _getState(activeRepoId);
        assertEq(uint8(state.status), uint8(RepoDvP.RepoStatus.Active));
        assertEq(state.cureDeadline, 0);
        assertEq(bondToken.balanceOf(address(repoDvP)), collateralAmount + topUp);
    }

    function test_Default_MissedMaturity() public {
        // Fast-forward past maturity
        vm.warp(block.timestamp + TERM_SECONDS + 1 days);

        uint256 bankBBondBefore = bondToken.balanceOf(bankB);
        uint256 bankABondBefore = bondToken.balanceOf(bankA);

        // Close-out netting at €100: the lender seizes collateral worth exactly what is owed
        // (principal + interest accrued to now), rounded up; the rest goes back to the borrower.
        uint256 owed = repoDvP.getCurrentRepurchasePrice(activeRepoId);
        uint256 expectedSeized = (owed * 1e8 + uint256(INITIAL_BOND_PRICE) - 1) / uint256(INITIAL_BOND_PRICE);
        uint256 expectedSurplus = collateralAmount - expectedSeized;
        assertEq(collateralAmount, 102_000 ether); // 10M × 1.02 / €100

        // Bank B executes default seizure
        vm.prank(bankB);
        repoDvP.claimDefault(activeRepoId);

        assertEq(bondToken.balanceOf(bankB), bankBBondBefore + expectedSeized);

        RepoDvP.RepoState memory state = _getState(activeRepoId);
        assertEq(uint8(state.status), uint8(RepoDvP.RepoStatus.Defaulted));
        assertEq(state.collateralAmount, 0);
        // Surplus is returned to the borrower in the same call; escrow ends empty.
        assertEq(bondToken.balanceOf(bankA), bankABondBefore + expectedSurplus);
        assertEq(bondToken.balanceOf(address(repoDvP)), 0);
    }

    function test_Default_SurplusReflectsPriceRise() public {
        // Collateral appreciates 10%: the lender still takes only what is owed.
        vm.prank(admin);
        oracle.updatePrice(110_00000000);
        vm.warp(block.timestamp + TERM_SECONDS + 1);

        uint256 owed = repoDvP.getCurrentRepurchasePrice(activeRepoId);
        uint256 expectedSeized = (owed * 1e8 + 110_00000000 - 1) / 110_00000000;
        uint256 bankABondBefore = bondToken.balanceOf(bankA);

        vm.prank(bankB);
        repoDvP.claimDefault(activeRepoId);

        assertEq(bondToken.balanceOf(address(repoDvP)), 0);
        assertEq(bondToken.balanceOf(bankA), bankABondBefore + collateralAmount - expectedSeized);
        assertGe((expectedSeized * 110_00000000) / 1e8, owed); // lender fully covered
    }

    function test_Default_MissedMarginCure() public {
        // Bond price crashes from €100 to €85
        vm.prank(admin);
        oracle.updatePrice(85_00000000);

        // Trigger margin call
        repoDvP.marginCall(activeRepoId);

        // Fast-forward 2 hours + 1 second (past cure deadline, but BEFORE maturity)
        vm.warp(block.timestamp + 7_201);

        uint256 bankBBondBefore = bondToken.balanceOf(bankB);

        // Bank B claims default early due to expired cure period
        vm.prank(bankB);
        repoDvP.claimDefault(activeRepoId);

        // Collateral (~€8.68M at €85) is below the ~€10M owed: lender takes all of it, no surplus.
        assertEq(bondToken.balanceOf(bankB), bankBBondBefore + collateralAmount);
        assertEq(bondToken.balanceOf(address(repoDvP)), 0);

        RepoDvP.RepoState memory state = _getState(activeRepoId);
        assertEq(uint8(state.status), uint8(RepoDvP.RepoStatus.Defaulted));
    }

    /* ============ Cash-token pause ============ */

    function test_MaturityDefault_AllowedAfterUnpause() public {
        vm.prank(compliance);
        cashToken.pause();
        vm.warp(block.timestamp + TERM_SECONDS + 1);

        vm.prank(compliance);
        cashToken.unpause();

        vm.prank(bankB);
        repoDvP.claimDefault(activeRepoId);

        RepoDvP.RepoState memory state = _getState(activeRepoId);
        assertEq(uint8(state.status), uint8(RepoDvP.RepoStatus.Defaulted));
    }

    function test_MarginDefault_StillAllowedWhileCashTokenPaused() public {
        // A missed margin cure is independent of the cash leg.
        vm.prank(admin);
        oracle.updatePrice(85_00000000);
        repoDvP.marginCall(activeRepoId);

        vm.prank(compliance);
        cashToken.pause();
        vm.warp(block.timestamp + TERM_SECONDS + 1);

        vm.prank(bankB);
        repoDvP.claimDefault(activeRepoId);

        RepoDvP.RepoState memory state = _getState(activeRepoId);
        assertEq(uint8(state.status), uint8(RepoDvP.RepoStatus.Defaulted));
    }

    /* ============ Margin-cure default guards ============ */

    function test_MarginDefault_RevertsWhenPriceRecovered() public {
        vm.prank(admin);
        oracle.updatePrice(85_00000000);
        repoDvP.marginCall(activeRepoId);

        // Price recovers without a top-up; the expired call must not allow seizure.
        vm.prank(admin);
        oracle.updatePrice(INITIAL_BOND_PRICE);
        vm.warp(block.timestamp + CURE_PERIOD_SECONDS + 1);

        vm.prank(bankB);
        vm.expectRevert(abi.encodeWithSelector(RepoDvP.InvalidState.selector, RepoDvP.RepoStatus.MarginCalled));
        repoDvP.claimDefault(activeRepoId);
    }

    function test_TopUp_AcceptedAndDefaultBlockedWhileOracleStale() public {
        vm.prank(admin);
        oracle.updatePrice(85_00000000);
        repoDvP.marginCall(activeRepoId);

        vm.mockCallRevert(
            address(oracle),
            abi.encodeWithSelector(ICollateralPriceOracle.latestRoundData.selector),
            abi.encodeWithSelector(ICollateralPriceOracle.InvalidPrice.selector)
        );

        // Borrower can still post collateral; status stays MarginCalled until a live price confirms the cure.
        vm.prank(bankA);
        repoDvP.topUpCollateral(activeRepoId, 20_000 ether);
        RepoDvP.RepoState memory state = _getState(activeRepoId);
        assertEq(uint8(state.status), uint8(RepoDvP.RepoStatus.MarginCalled));
        assertEq(state.collateralAmount, collateralAmount + 20_000 ether);

        // Lender cannot seize on the margin path without a live price.
        vm.warp(block.timestamp + CURE_PERIOD_SECONDS + 1);
        vm.prank(bankB);
        vm.expectRevert(ICollateralPriceOracle.InvalidPrice.selector);
        repoDvP.claimDefault(activeRepoId);
    }
}
