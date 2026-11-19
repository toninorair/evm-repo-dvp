// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {RepoDvP} from "../../src/core/RepoDvP.sol";
import {nhEUR} from "../../src/core/nhEUR.sol";
import {IERC3643} from "../../src/core/interfaces/erc3643/IERC3643.sol";
import {IRepoTypes} from "../../src/core/interfaces/IRepoTypes.sol";

/// @title  RepoHandler
/// @notice Fuzz invariant handler generating bounded, valid repo actions.
/// @author Ethereum Institutional / Nordhaven Bank
contract RepoHandler is Test, IRepoTypes {
    RepoDvP internal repoDvP;
    nhEUR internal cashToken;
    IERC3643 internal bondToken;

    address internal bankA;
    address internal bankB;
    address internal treasury;

    constructor(
        RepoDvP _repoDvP,
        nhEUR _cashToken,
        IERC3643 _bondToken,
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

    function createAndOpenRepo(uint256 cashAmount, uint32 rateBps, uint32 tenorSeconds) external {
        cashAmount = bound(cashAmount, 100_000 ether, 5_000_000 ether);
        rateBps = uint32(bound(rateBps, 50, 1_000));
        tenorSeconds = uint32(bound(tenorSeconds, 1 days, 30 days));

        uint256 collateral = (cashAmount * 105) / 100; // 5% buffer

        vm.prank(treasury);
        bondToken.mint(bankA, collateral);

        vm.prank(treasury);
        cashToken.mint(bankB, cashAmount, "TARGET2-CREDIT");

        vm.startPrank(bankA);
        bondToken.approve(address(repoDvP), collateral);
        uint256 repoId = repoDvP.proposeRepo(
            bankB, address(bondToken), address(cashToken), collateral, cashAmount, rateBps, tenorSeconds, 200, true
        );
        vm.stopPrank();

        vm.startPrank(bankB);
        cashToken.approve(address(repoDvP), cashAmount);
        repoDvP.acceptProposal(repoId);
        vm.stopPrank();
    }

    function settleActiveRepo(uint256 repoId) external {
        uint256 count = repoDvP.repoCount();
        if (count == 0) return;

        repoId = bound(repoId, 1, count);
        (, RepoState memory state) = repoDvP.getRepo(repoId);
        if (state.status != RepoStatus.Active) return;

        vm.warp(block.timestamp + 1 days);

        (, uint256 interest, uint256 totalRepurchasePrice) = repoDvP.calculateRepurchasePrice(repoId);

        vm.prank(treasury);
        cashToken.mint(bankA, interest, "INTEREST-TOPUP");

        vm.startPrank(bankA);
        cashToken.approve(address(repoDvP), totalRepurchasePrice);
        repoDvP.settleRepo(repoId);
        vm.stopPrank();
    }
}
