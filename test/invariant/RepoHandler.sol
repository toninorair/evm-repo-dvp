// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { Test } from "forge-std/Test.sol";
import { RepoDvP } from "../../src/RepoDvP.sol";
import { nhEUR } from "../../src/nhEUR.sol";
import { ITestBond } from "../interfaces/ITestBond.sol";

/// @title  RepoHandler
/// @notice Fuzz invariant handler generating bounded, valid repo actions.
/// @author Ethereum Institutional / Nordhaven Bank
contract RepoHandler is Test {
    RepoDvP internal repoDvP;
    nhEUR internal cashToken;
    ITestBond internal bondToken;

    address internal bankA;
    address internal bankB;
    address internal treasury;

    constructor(
        RepoDvP _repoDvP,
        nhEUR _cashToken,
        ITestBond _bondToken,
        address _bankA,
        address _bankB,
        address _treasury
    ) {
        repoDvP = _repoDvP;
        cashToken = _cashToken;
        bondToken = _bondToken;
        bankA = _bankA;
        bankB = _bankB;
        treasury = _treasury;
    }

    function createAndOpenRepo(uint256 cashAmount, uint32 rateBps, uint32 termSeconds) external {
        cashAmount = bound(cashAmount, 100_000 ether, 5_000_000 ether);
        rateBps = uint32(bound(rateBps, 50, 1_000));
        termSeconds = uint32(bound(termSeconds, 1 days, 30 days));

        vm.prank(bankA);
        uint256 repoId = repoDvP.proposeRepo(
            bankB,
            cashAmount,
            rateBps,
            200,
            100,
            termSeconds,
            2 hours,
            type(uint256).max,
            uint40(block.timestamp + 1 days)
        );
        // acceptRepo pulls principal × (1 + 2% initial margin) at the current price.
        uint256 price = repoDvP.getCollateralPrice();
        uint256 collateral = (((cashAmount * 10_200) / 10_000) * 1e8 + price - 1) / price;

        vm.prank(treasury);
        bondToken.mint(bankA, collateral);

        vm.prank(treasury);
        cashToken.mint(bankB, cashAmount, "TARGET2-CREDIT");

        vm.prank(bankA);
        bondToken.approve(address(repoDvP), collateral);

        vm.startPrank(bankB);
        cashToken.approve(address(repoDvP), cashAmount);
        repoDvP.acceptRepo(repoId);
        vm.stopPrank();
    }

    function settleActiveRepo(uint256 repoId) external {
        uint256 count = repoDvP.repoCount();
        if (count == 0) return;

        repoId = bound(repoId, 1, count);
        RepoDvP.RepoState memory state = _getState(repoId);
        if (state.status != RepoDvP.RepoStatus.Active) return;

        vm.warp(block.timestamp + 1 days);

        uint256 interest = repoDvP.getRepoInterest(repoId);
        uint256 totalRepurchasePrice = repoDvP.getCurrentRepurchasePrice(repoId);

        vm.prank(treasury);
        cashToken.mint(bankA, interest, "INTEREST-TOPUP");

        vm.startPrank(bankA);
        cashToken.approve(address(repoDvP), totalRepurchasePrice);
        repoDvP.settleRepo(repoId);
        vm.stopPrank();
    }

    /// @dev Reads a repo's state from the public `states` mapping getter.
    function _getState(uint256 repoId) internal view returns (RepoDvP.RepoState memory s) {
        (s.status, s.collateralAmount, s.startTime, s.maturity, s.cureDeadline) = repoDvP.states(repoId);
    }
}
