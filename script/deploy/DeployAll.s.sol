// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { console2 } from "forge-std/console2.sol";

import { nhNAVOracle } from "../../src/nhNAVOracle.sol";
import { nhEUR } from "../../src/nhEUR.sol";
import { RepoDvP } from "../../src/RepoDvP.sol";
import { InhBOND } from "../../src/interfaces/InhBOND.sol";
import { IERC3643IdentityRegistry } from "../../test/interfaces/IERC3643IdentityRegistry.sol";
import { IIdentity } from "../../test/interfaces/IIdentity.sol";
import { ITREXDeployer } from "../helper/ITREXDeployer.sol";
import { TREXSuiteDeployment } from "../helper/TREXSuiteDeployment.sol";
import { DeskOnboarding } from "./OnboardDesk.s.sol";

/// @title  DeployAll
/// @notice Foundry deployment script for Nordhaven DvP Repo contracts on Sepolia or local testnet.
/// @author Ethereum Institutional / Nordhaven Bank
contract DeployAll is DeskOnboarding, TREXSuiteDeployment {
    int256 internal constant INITIAL_BOND_PRICE = 100_00000000; // €100.00 par (8 decimals)
    uint256 internal constant MAX_PRICE_AGE = 4 days; // matches the NAV oracle's daily update cadence with slack
    uint256 internal constant INITIAL_DEMO_CASH = 50_000_000 ether; // €50M demo liquidity
    uint256 internal constant INITIAL_DEMO_BONDS = 500_000 ether; // 500k bonds (€50M par)
    uint256 internal constant DESK_BONDS = 100_000 ether; // borrower desk: €10M of collateral at par
    uint256 internal constant DESK_CASH = 10_000_000 ether; // each desk: €10M nhEUR (lender funds, borrower repays)

    function run() external returns (nhNAVOracle oracle, nhEUR cashToken, InhBOND bondToken, RepoDvP repoDvP) {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("=================================================");
        console2.log("Deploying Nordhaven Repo Contracts on Chain ID:", block.chainid);
        console2.log("Deployer Address:", deployer);
        console2.log("=================================================");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy RWA Fund NAV Oracle (Chainlink AggregatorV3 compatible)
        oracle = new nhNAVOracle(deployer, deployer);
        oracle.updateNAV(INITIAL_BOND_PRICE);
        console2.log("nhNAVOracle deployed at:", address(oracle));

        // 2. Deploy ERC-3643 Compliance Infrastructure (Official T-REX Framework)
        ITREXDeployer.TREXSuite memory suite = _deployTrexSuite(
            deployer,
            "Nordhaven Sovereign Bond NAV",
            "nhBOND NAV",
            address(oracle)
        );
        IERC3643IdentityRegistry identityRegistry = IERC3643IdentityRegistry(suite.identityRegistry);
        bondToken = InhBOND(suite.token);
        console2.log("IdentityRegistry deployed at:", address(identityRegistry));

        // 3. Deploy nhEUR (Tokenised Commercial Bank Deposit - JPM Coin Model)
        cashToken = new nhEUR(deployer, deployer, deployer, suite.identityRegistry);
        console2.log("nhEUR (Cash Leg) deployed at:", address(cashToken));

        // 4. Log nhBOND NAV (Official ERC-3643 Sovereign Bond NAV Token)
        console2.log("nhBOND NAV (Collateral Leg) deployed at:", address(bondToken));

        // 5. Deploy RepoDvP Settlement & Escrow Engine
        repoDvP = new RepoDvP(address(oracle), MAX_PRICE_AGE, address(bondToken), address(cashToken));
        console2.log("RepoDvP (Settlement Engine) deployed at:", address(repoDvP));

        // 6. Configure ONCHAINID Registrations
        address idDeployer = deployCode("Identity.sol:Identity", abi.encode(deployer, false));
        address idRepoDvP = deployCode("Identity.sol:Identity", abi.encode(address(repoDvP), false));
        identityRegistry.registerIdentity(deployer, IIdentity(idDeployer), 276);
        identityRegistry.registerIdentity(address(repoDvP), IIdentity(idRepoDvP), 276);

        // 7. Seed Deployer with Demo Liquidity
        cashToken.mint(deployer, INITIAL_DEMO_CASH, "SEPOLIA-DEMO-SEED");
        bondToken.issue(deployer, INITIAL_DEMO_BONDS);

        // 8. Optionally onboard the two test desks for the settlement console
        address borrower = vm.envOr("BORROWER_ADDRESS", address(0));
        address lender = vm.envOr("LENDER_ADDRESS", address(0));
        if (borrower != address(0)) _onboard(repoDvP, borrower, DESK_BONDS, DESK_CASH);
        if (lender != address(0)) _onboard(repoDvP, lender, 0, DESK_CASH);

        vm.stopBroadcast();

        console2.log("=================================================");
        console2.log("Deployment and Demo Seeding Successfully Completed!");
        console2.log("Settlement console (app/.env):");
        console2.log("  VITE_REPO_DVP=", address(repoDvP));
        console2.log("  VITE_DEPLOY_BLOCK=", block.number);
        console2.log("=================================================");
    }
}
