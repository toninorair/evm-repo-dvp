// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {RepoTestBase} from "../utils/RepoTestBase.sol";
import {RepoHandler} from "./RepoHandler.sol";

/// @title  RepoInvariantTest
/// @notice Invariant tests verifying continuous contract solvency and zero trapped cash.
/// @author Ethereum Institutional / Nordhaven Bank
contract RepoInvariantTest is RepoTestBase {
    RepoHandler internal handler;

    function setUp() public override {
        super.setUp();

        handler = new RepoHandler(repoDvP, cashToken, bondToken, bankA, bankB, treasury);

        targetContract(address(handler));
    }

    /// @notice Invariant: The RepoDvP settlement contract MUST NEVER hold any cash tokens.
    function invariant_ZeroTrappedCash() public view {
        assertEq(cashToken.balanceOf(address(repoDvP)), 0, "RepoDvP must never custody cash");
    }

    /// @notice Invariant: Escrowed bond tokens in RepoDvP must match sum of active collateral.
    function invariant_EscrowSolvency() public view {
        uint256 totalActiveCollateral = 0;
        uint256 count = repoDvP.repoCount();

        for (uint256 i = 1; i <= count;) {
            (RepoTerms memory terms, RepoState memory state) = repoDvP.getRepo(i);
            if (state.status == RepoStatus.Active || state.status == RepoStatus.MarginCalled) {
                totalActiveCollateral += terms.collateralAmount;
            }
            unchecked {
                ++i;
            }
        }

        assertEq(
            bondToken.balanceOf(address(repoDvP)),
            totalActiveCollateral,
            "Escrow bond balance must match active collateral sum"
        );
    }
}
