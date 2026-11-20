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
import { OnboardDesk } from "./OnboardDesk.s.sol";

/// @title  DeployAll
/// @notice Foundry deployment script for Nordhaven DvP Repo contracts on Sepolia or local testnet.
/// @author Ethereum Institutional / Nordhaven Bank
contract DeployAll is OnboardDesk, TREXSuiteDeployment {
    int256 internal constant INITIAL_BOND_PRICE = 100_00000000; // €100.00 par (8 decimals)
    uint256 internal constant INITIAL_DEMO_CASH = 50_000_000 ether; // €50M demo liquidity
    uint256 internal constant INITIAL_DEMO_BONDS = 500_000 ether; // 500k bonds (€50M par)
    uint256 internal constant DESK_BONDS = 250_000 ether; // borrower desk: €25M of collateral at par
    uint256 internal constant DESK_CASH = 25_000_000 ether; // each desk: €25M nhEUR (lender funds, borrower repays)

    function run() public override {
        address deployer = _startBroadcast();

        console2.log("=================================================");
        console2.log("Deploying Nordhaven Repo Contracts on Chain ID:", block.chainid);
        console2.log("Deployer Address:", deployer);
        console2.log("=================================================");

        // 1. Deploy RWA Fund NAV Oracle (Chainlink AggregatorV3 compatible)
        nhNAVOracle oracle = new nhNAVOracle(deployer, deployer);
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
        InhBOND bondToken = InhBOND(suite.token);
        console2.log("IdentityRegistry deployed at:", address(identityRegistry));

        // 3. Deploy nhEUR (Tokenised Commercial Bank Deposit - JPM Coin Model)
        nhEUR cashToken = new nhEUR(deployer, deployer, deployer, suite.identityRegistry);
        console2.log("nhEUR (Cash Leg) deployed at:", address(cashToken));

        // 4. Log nhBOND NAV (Official ERC-3643 Sovereign Bond NAV Token)
        console2.log("nhBOND NAV (Collateral Leg) deployed at:", address(bondToken));

        // 5. Deploy RepoDvP Settlement & Escrow Engine
        RepoDvP repoDvP = new RepoDvP(address(oracle), address(bondToken), address(cashToken));
        console2.log("RepoDvP (Settlement Engine) deployed at:", address(repoDvP));

        // 6. Register RepoDvP escrow in IdentityRegistry so it can hold ERC-3643 collateral
        address idRepoDvP = deployCode("Identity.sol:Identity", abi.encode(address(repoDvP), false));
        identityRegistry.registerIdentity(address(repoDvP), IIdentity(idRepoDvP), COUNTRY_DE);

        // 7. Onboard the two test desks if provided; otherwise onboard and seed the deployer
        address borrower = _envAddressOrZero("BORROWER_ADDRESS");
        address lender = _envAddressOrZero("LENDER_ADDRESS");
        if (borrower != address(0)) _onboard(repoDvP, borrower, DESK_BONDS, DESK_CASH);
        if (lender != address(0)) _onboard(repoDvP, lender, 0, DESK_CASH);
        if (borrower == address(0) && lender == address(0)) {
            _onboard(repoDvP, deployer, INITIAL_DEMO_BONDS, INITIAL_DEMO_CASH);
        }

        vm.stopBroadcast();

        _writeDeploymentJson(
            address(repoDvP),
            address(bondToken),
            address(cashToken),
            address(oracle),
            address(identityRegistry)
        );

        console2.log("=================================================");
        console2.log("Deployment and Demo Seeding Successfully Completed!");
        console2.log("Settlement console (app/.env):");
        console2.log("  VITE_REPO_DVP=", address(repoDvP));
        console2.log("  VITE_DEPLOY_BLOCK=", block.number);
        console2.log("Verify nhBOND (if skipped by --verify due to 0.8.17 deployCode):");
        console2.log(
            "  forge verify-contract",
            address(bondToken),
            "src/nhBOND.sol:nhBOND --flatten --chain-id",
            block.chainid
        );
        console2.log("=================================================");
    }

    function _writeDeploymentJson(
        address repoDvP,
        address bondToken,
        address cashToken,
        address oracle,
        address identityRegistry
    ) private {
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "repoDvP", repoDvP);
        vm.serializeAddress(obj, "nhBOND", bondToken);
        vm.serializeAddress(obj, "nhEUR", cashToken);
        vm.serializeAddress(obj, "nhNAVOracle", oracle);
        string memory json = vm.serializeAddress(obj, "identityRegistry", identityRegistry);
        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("Deployment manifest written to:", path);
    }
}
