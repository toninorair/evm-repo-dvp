// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {RepoTestBase} from "../utils/RepoTestBase.sol";
import {IRepoDvP} from "../../src/interfaces/IRepoDvP.sol";

/// @title  RepoDvPTest
/// @notice Unit tests for RepoDvP settlement engine covering DvP, RvP, and EIP-712 orders.
/// @author Ethereum Institutional / Nordhaven Bank
contract RepoDvPTest is RepoTestBase {
    uint256 internal constant CASH_PRINCIPAL = 10_000_000 ether; // €10,000,000
    uint256 internal constant COLLATERAL_AMOUNT = 105_000 ether; // 105,000 bonds (€10.5M value at €100 par)
    uint32 internal constant REPO_RATE_BPS = 350; // 3.50%
    uint32 internal constant TENOR_SECONDS = 7 days; // 604,800 seconds
    uint32 internal constant HAIRCUT_BPS = 200; // 2.00% (requires €10.2M value)

    function test_ProposeRepo_And_Cancel() public {
        vm.startPrank(bankA);
        uint256 repoId = repoDvP.proposeRepo(
            bankB,
            address(bondToken),
            address(cashToken),
            COLLATERAL_AMOUNT,
            CASH_PRINCIPAL,
            REPO_RATE_BPS,
            TENOR_SECONDS,
            HAIRCUT_BPS,
            true // Bank A is borrower
        );
        vm.stopPrank();

        assertEq(repoId, 1);
        (RepoTerms memory terms, RepoState memory state) = repoDvP.getRepo(repoId);
        assertEq(terms.borrower, bankA);
        assertEq(terms.lender, bankB);
        assertEq(uint8(state.status), uint8(RepoStatus.Proposed));

        // Bank A cancels
        vm.prank(bankA);
        repoDvP.cancelProposal(repoId);

        (, state) = repoDvP.getRepo(repoId);
        assertEq(uint8(state.status), uint8(RepoStatus.Cancelled));
    }

    function test_AtomicDvP_OpeningLeg() public {
        // 1. Bank A proposes repo
        vm.prank(bankA);
        uint256 repoId = repoDvP.proposeRepo(
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
        repoDvP.acceptProposal(repoId);

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

        (, RepoState memory state) = repoDvP.getRepo(repoId);
        assertEq(uint8(state.status), uint8(RepoStatus.Active));
        assertEq(state.startTime, block.timestamp);
        assertEq(state.maturity, block.timestamp + TENOR_SECONDS);
    }

    function test_ClosingLeg_RvP_Settlement_AtMaturity() public {
        // Run Opening Leg
        vm.prank(bankA);
        uint256 repoId = repoDvP.proposeRepo(
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
        bondToken.approve(address(repoDvP), COLLATERAL_AMOUNT);
        vm.prank(bankB);
        cashToken.approve(address(repoDvP), CASH_PRINCIPAL);
        vm.prank(bankB);
        repoDvP.acceptProposal(repoId);

        // Fast-forward to maturity (7 days)
        vm.warp(block.timestamp + TENOR_SECONDS);

        // Expected interest: (10,000,000 * 350 * 604,800) / 311,040,000,000 = 68,055.555555555555555555 EUR
        (uint256 principal, uint256 interest, uint256 totalRepurchasePrice) = repoDvP.calculateRepurchasePrice(repoId);
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

        (, RepoState memory state) = repoDvP.getRepo(repoId);
        assertEq(uint8(state.status), uint8(RepoStatus.Settled));
    }

    function test_EIP712_ExecuteRepoOrder_ZeroTxNegotiation() public {
        // Bank A signs an off-chain order pledging collateral for cash
        RepoOrder memory order = RepoOrder({
            proposer: bankA,
            counterparty: bankB,
            isBorrower: true,
            collateralToken: address(bondToken),
            cashToken: address(cashToken),
            collateralAmount: COLLATERAL_AMOUNT,
            cashAmount: CASH_PRINCIPAL,
            repoRateBps: REPO_RATE_BPS,
            tenorSeconds: TENOR_SECONDS,
            haircutBps: HAIRCUT_BPS,
            nonce: 1,
            deadline: block.timestamp + 1 hours
        });

        bytes memory signature = signRepoOrder(order, bankAPk);

        // Approvals (or custody approvals)
        vm.prank(bankA);
        bondToken.approve(address(repoDvP), COLLATERAL_AMOUNT);
        vm.prank(bankB);
        cashToken.approve(address(repoDvP), CASH_PRINCIPAL);

        // Bank B executes the order in a single transaction on-chain
        vm.prank(bankB);
        uint256 repoId = repoDvP.executeRepoOrder(order, signature);

        assertEq(repoId, 1);
        (, RepoState memory state) = repoDvP.getRepo(repoId);
        assertEq(uint8(state.status), uint8(RepoStatus.Active));
        assertEq(bondToken.balanceOf(address(repoDvP)), COLLATERAL_AMOUNT);

        // Replay of same nonce reverts
        vm.prank(bankB);
        vm.expectRevert(IRepoDvP.NonceAlreadyUsed.selector);
        repoDvP.executeRepoOrder(order, signature);
    }

    function test_OpenRFQ_CounterpartyAddressZero() public {
        // Bank B signs an open lending quote (counterparty == address(0))
        RepoOrder memory order = RepoOrder({
            proposer: bankB,
            counterparty: address(0), // Open to ANY allowlisted bank
            isBorrower: false, // Bank B is lender
            collateralToken: address(bondToken),
            cashToken: address(cashToken),
            collateralAmount: COLLATERAL_AMOUNT,
            cashAmount: CASH_PRINCIPAL,
            repoRateBps: REPO_RATE_BPS,
            tenorSeconds: TENOR_SECONDS,
            haircutBps: HAIRCUT_BPS,
            nonce: 100,
            deadline: block.timestamp + 1 hours
        });

        bytes memory signature = signRepoOrder(order, bankBPk);

        vm.prank(bankA);
        bondToken.approve(address(repoDvP), COLLATERAL_AMOUNT);
        vm.prank(bankB);
        cashToken.approve(address(repoDvP), CASH_PRINCIPAL);

        // Bank A hits the open quote
        vm.prank(bankA);
        uint256 repoId = repoDvP.executeRepoOrder(order, signature);

        (RepoTerms memory terms, RepoState memory state) = repoDvP.getRepo(repoId);
        assertEq(terms.borrower, bankA);
        assertEq(terms.lender, bankB);
        assertEq(uint8(state.status), uint8(RepoStatus.Active));
    }
}
