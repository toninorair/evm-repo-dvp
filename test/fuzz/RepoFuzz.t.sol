// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {RepoTestBase} from "../utils/RepoTestBase.sol";

/// @title  RepoFuzzTest
/// @notice Fuzz tests for Actual/360 interest accrual and haircut calculations.
/// @author Ethereum Institutional / Nordhaven Bank
contract RepoFuzzTest is RepoTestBase {
    function testFuzz_Actual360InterestAccrual(uint256 cashAmount, uint32 rateBps, uint32 tenorSeconds) public {
        cashAmount = bound(cashAmount, 1_000 ether, 100_000_000 ether);
        rateBps = uint32(bound(rateBps, 1, 2_000)); // 0.01% to 20.00%
        tenorSeconds = uint32(bound(tenorSeconds, 1, 365 days));

        uint256 expectedInterest = (cashAmount * uint256(rateBps) * uint256(tenorSeconds)) / 311_040_000_000;

        vm.prank(bankA);
        uint256 repoId = repoDvP.proposeRepo(
            bankB, address(bondToken), address(cashToken), 1_000_000 ether, cashAmount, rateBps, tenorSeconds, 200, true
        );

        (uint256 principal, uint256 interest, uint256 total) = repoDvP.calculateRepurchasePrice(repoId);
        assertEq(principal, cashAmount);
        assertEq(interest, expectedInterest);
        assertEq(total, principal + expectedInterest);
    }

    function testFuzz_CollateralValuation(uint256 bondAmount, int256 price) public {
        bondAmount = bound(bondAmount, 1 ether, 10_000_000 ether);
        price = int256(bound(uint256(price), 50_00000000, 200_00000000)); // €50.00 to €200.00

        vm.prank(admin);
        oracle.updatePrice(price);

        vm.prank(bankA);
        uint256 repoId = repoDvP.proposeRepo(
            bankB, address(bondToken), address(cashToken), bondAmount, 1_000 ether, 350, 7 days, 200, true
        );

        uint256 expectedValue = (bondAmount * uint256(price)) / 1e8;
        uint256 actualValue = repoDvP.getCollateralValue(repoId);
        assertEq(actualValue, expectedValue);
    }
}
