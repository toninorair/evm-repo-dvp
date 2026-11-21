// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { RepoDvP } from "../../src/RepoDvP.sol";
import { InhBOND } from "../../src/interfaces/InhBOND.sol";
import { InhEUR } from "../../src/interfaces/InhEUR.sol";
import { IIdentityRegistryBound } from "../../src/interfaces/IIdentityRegistry.sol";
import { IERC3643IdentityRegistry } from "../../test/interfaces/IERC3643IdentityRegistry.sol";
import { IIdentity } from "../../test/interfaces/IIdentity.sol";

/// @title  DeskOnboarding
/// @notice Registers a trading desk in the ERC-3643 IdentityRegistry and funds it, so it can use RepoDvP.
/// @dev    Must run as a broadcaster that is an IdentityRegistry agent, an nhBOND agent and holds nhEUR TREASURY_ROLE
///         (the deployer, after DeployAll). The registry requires no claim topics, so registration alone verifies.
abstract contract DeskOnboarding is Script {
    uint16 internal constant COUNTRY_DE = 276;

    function _onboard(RepoDvP repoDvP, address desk, uint256 bonds, uint256 cash) internal {
        // RepoDvP checks the registry of each leg's token, so register the desk in both (once if shared).
        address bondRegistry = IIdentityRegistryBound(repoDvP.collateralToken()).identityRegistry();
        address cashRegistry = IIdentityRegistryBound(repoDvP.cashToken()).identityRegistry();
        _register(IERC3643IdentityRegistry(bondRegistry), desk);
        _register(IERC3643IdentityRegistry(cashRegistry), desk);
        if (bonds > 0) InhBOND(repoDvP.collateralToken()).issue(desk, bonds);
        if (cash > 0) InhEUR(repoDvP.cashToken()).mint(desk, cash, "SEPOLIA-DESK-ONBOARDING");

        console2.log("  Desk", desk);
        console2.log("    nhBOND issued", bonds / 1e18);
        console2.log("    nhEUR minted ", cash / 1e18);
    }

    function _register(IERC3643IdentityRegistry registry, address desk) private {
        if (registry.isVerified(desk)) return;
        address identity = deployCode("Identity.sol:Identity", abi.encode(desk, false));
        registry.registerIdentity(desk, IIdentity(identity), COUNTRY_DE);
        console2.log("  Registered identity", identity);
    }
}

/// @title  OnboardDesk
/// @notice Onboards one more desk against an existing deployment.
/// @dev    REPO_DVP=0x… DESK=0x… [BONDS=250000] [CASH=25000000] forge script script/deploy/OnboardDesk.s.sol --rpc-url sepolia --broadcast
///         BONDS and CASH are whole tokens.
contract OnboardDesk is DeskOnboarding {
    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        RepoDvP repoDvP = RepoDvP(vm.envAddress("REPO_DVP"));
        address desk = vm.envAddress("DESK");
        uint256 bonds = vm.envOr("BONDS", uint256(250_000)) * 1e18;
        uint256 cash = vm.envOr("CASH", uint256(25_000_000)) * 1e18;

        vm.startBroadcast(key);
        _onboard(repoDvP, desk, bonds, cash);
        vm.stopBroadcast();
    }
}
