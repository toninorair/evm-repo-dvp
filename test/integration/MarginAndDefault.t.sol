// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {RepoTestBase} from "../utils/RepoTestBase.sol";
import {IRepoDvP} from "../../src/core/interfaces/IRepoDvP.sol";

/// @title  MarginAndDefaultTest
/// @notice Integration tests for dynamic mark-to-market margin calls, top-ups, and default liquidations.
/// @author Ethereum Institutional / Nordhaven Bank
contract MarginAndDefaultTest is RepoTestBase {
    uint256 internal constant CASH_PRINCIPAL = 10_000_000 ether; // €10,000,000
    uint256 internal constant COLLATERAL_AMOUNT = 105_000 ether; // 105,000 bonds (€10.5M at €100 par)
    uint32 internal constant REPO_RATE_BPS = 350; // 3.50%
    uint32 internal constant TENOR_SECONDS = 7 days;
    uint32 internal constant HAIRCUT_BPS = 200; // 2.00%

    uint256 internal activeRepoId;

    function setUp() public override {
        super.setUp();

        // Initialize and open standard repo
        vm.prank(bankA);
        activeRepoId = repoDvP.proposeRepo(
            bankB,
            address(bondToken),
            address(cashToken),
            COLLATERAL_AMOUNT,
            CASH_PRINCIPAL,
            REPO_RATE_BPS,
            TENOR_SECONDS,
            HAIRCUT_BPS,
            true
        );

        vm.prank(bankA);
        bondToken.approve(address(repoDvP), type(uint256).max);
        vm.prank(bankB);
        cashToken.approve(address(repoDvP), type(uint256).max);

        vm.prank(bankB);
        repoDvP.acceptProposal(activeRepoId);
    }

    function test_MarginCall_Trigger_And_TopUp_Cure() public {
        // Bond price drops from €100 to €92
        int256 droppedPrice = 92_00000000;
        vm.prank(admin);
        oracle.updatePrice(droppedPrice);

        // Check margin status: 105k * 92 = €9.66M, less than ~€10.1M required
        (bool isHealthy,, uint256 deficitEUR) = repoDvP.checkMarginStatus(activeRepoId);
        assertFalse(isHealthy);
        assertGt(deficitEUR, 0);

        // Trigger margin call notice
        repoDvP.triggerMarginCall(activeRepoId);

        (, RepoState memory state) = repoDvP.getRepo(activeRepoId);
        assertEq(uint8(state.status), uint8(RepoStatus.MarginCalled));
        assertEq(state.cureDeadline, block.timestamp + 7_200); // 2-hour cure deadline

        // Borrower tops up collateral: 10,000 additional bonds
        uint256 topUp = 10_000 ether;
        vm.prank(bankA);
        repoDvP.topUpCollateral(activeRepoId, topUp);

        // Position is restored to Healthy
        (, state) = repoDvP.getRepo(activeRepoId);
        assertEq(uint8(state.status), uint8(RepoStatus.Active));
        assertEq(state.cureDeadline, 0);
        assertEq(bondToken.balanceOf(address(repoDvP)), COLLATERAL_AMOUNT + topUp);
    }

    function test_Default_MissedMaturity() public {
        // Fast-forward past maturity
        vm.warp(block.timestamp + TENOR_SECONDS + 1 days);

        uint256 bankBBondBefore = bondToken.balanceOf(bankB);

        // Bank B executes default seizure
        vm.prank(bankB);
        repoDvP.claimDefault(activeRepoId);

        // Lender received 100% of escrowed collateral; Escrow is empty
        assertEq(bondToken.balanceOf(bankB), bankBBondBefore + COLLATERAL_AMOUNT);
        assertEq(bondToken.balanceOf(address(repoDvP)), 0);

        (, RepoState memory state) = repoDvP.getRepo(activeRepoId);
        assertEq(uint8(state.status), uint8(RepoStatus.Defaulted));
    }

    function test_Default_MissedMarginCure() public {
        // Bond price crashes from €100 to €85
        vm.prank(admin);
        oracle.updatePrice(85_00000000);

        // Trigger margin call
        repoDvP.triggerMarginCall(activeRepoId);

        // Fast-forward 2 hours + 1 second (past cure deadline, but BEFORE maturity)
        vm.warp(block.timestamp + 7_201);

        uint256 bankBBondBefore = bondToken.balanceOf(bankB);

        // Bank B claims default early due to expired cure period
        vm.prank(bankB);
        repoDvP.claimDefault(activeRepoId);

        assertEq(bondToken.balanceOf(bankB), bankBBondBefore + COLLATERAL_AMOUNT);
        assertEq(bondToken.balanceOf(address(repoDvP)), 0);

        (, RepoState memory state) = repoDvP.getRepo(activeRepoId);
        assertEq(uint8(state.status), uint8(RepoStatus.Defaulted));
    }
}
