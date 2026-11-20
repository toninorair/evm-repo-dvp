// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { RepoTestBase } from "../utils/RepoTestBase.sol";

/// @title  RepoFuzzTest
/// @notice Fuzz tests for Actual/360 interest accrual and collateral valuation.
/// @author Ethereum Institutional / Nordhaven Bank
contract RepoFuzzTest is RepoTestBase {
    function testFuzz_Actual360InterestAccrual(uint256 cashAmount, uint32 rateBps, uint32 termSeconds) public {
        cashAmount = bound(cashAmount, 1_000 ether, 100_000_000 ether);
        rateBps = uint32(bound(rateBps, 1, 2_000)); // 0.01% to 20.00%
        termSeconds = uint32(bound(termSeconds, 1, 365 days));

        uint256 expectedInterest = (cashAmount * uint256(rateBps) * uint256(termSeconds)) / 311_040_000_000;

        vm.prank(bankA);
        uint256 repoId = repoDvP.proposeRepo(
            bankB,
            cashAmount,
            rateBps,
            200,
            100,
            termSeconds,
            termSeconds,
            type(uint256).max,
            uint40(block.timestamp + 1 days)
        );

        // Interest accrues only once the repo is open: fund, accept, then advance by the full term.
        uint256 collateral =
            (((cashAmount * 10_200) / 10_000) * 1e8 + uint256(INITIAL_BOND_PRICE) - 1) / uint256(INITIAL_BOND_PRICE);
        vm.prank(treasury);
        bondToken.mint(bankA, collateral);
        vm.prank(bankA);
        bondToken.approve(address(repoDvP), collateral);
        vm.startPrank(bankB);
        cashToken.approve(address(repoDvP), cashAmount);
        repoDvP.acceptRepo(repoId);
        vm.stopPrank();
        assertEq(repoDvP.getRepoInterest(repoId), 0);

        vm.warp(block.timestamp + termSeconds);

        uint256 principal = _getOrder(repoId).borrowAmount;
        uint256 interest = repoDvP.getRepoInterest(repoId);
        uint256 total = repoDvP.getCurrentRepurchasePrice(repoId);
        assertEq(principal, cashAmount);
        assertEq(interest, expectedInterest);
        assertEq(total, principal + expectedInterest);
    }

    function testFuzz_CollateralSizing(
        uint256 cashAmount,
        uint32 rateBps,
        uint32 termSeconds,
        uint32 imBps,
        int256 price
    ) public {
        cashAmount = bound(cashAmount, 1_000 ether, 100_000_000 ether);
        rateBps = uint32(bound(rateBps, 0, 2_000));
        termSeconds = uint32(bound(termSeconds, 1, 365 days));
        imBps = uint32(bound(imBps, 1, 5_000)); // maintenance (0) must be strictly below initial
        price = int256(bound(uint256(price), 50_00000000, 200_00000000)); // €50.00 to €200.00

        vm.prank(admin);
        oracle.updatePrice(price);

        vm.prank(bankA);
        uint256 repoId = repoDvP.proposeRepo(
            bankB,
            cashAmount,
            rateBps,
            imBps,
            0,
            termSeconds,
            termSeconds,
            type(uint256).max,
            uint40(block.timestamp + 1 days)
        );
        // Initial requirement covers principal plus initial margin (interest is not pre-collateralised).
        uint256 requiredValue = (cashAmount * (10_000 + uint256(imBps))) / 10_000;
        uint256 p = uint256(price);

        vm.prank(treasury);
        bondToken.mint(bankA, (requiredValue * 1e8) / p + 1);
        vm.prank(bankA);
        bondToken.approve(address(repoDvP), type(uint256).max);
        vm.startPrank(bankB);
        cashToken.approve(address(repoDvP), cashAmount);
        repoDvP.acceptRepo(repoId);
        vm.stopPrank();
        uint256 collateralAmount = _getState(repoId).collateralAmount;

        // Smallest amount whose value covers the requirement.
        assertGe((collateralAmount * p) / 1e8, requiredValue);
        assertLt(((collateralAmount - 1) * p) / 1e8, requiredValue);
    }
}
