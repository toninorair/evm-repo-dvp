# Nordhaven Bank: Tokenised Repo on Ethereum (Atomic DvP)

> **Lead Forward Deployed Engineer (FDE) Case Study Prototype**  
> Smart contracts for tokenised European repurchase agreements (repo) with atomic Delivery-versus-Payment (DvP) gross settlement, Actual/360 interest mechanics, and programmable margin calls on EVM chains.

[![Solidity](https://img.shields.io/badge/Solidity-0.8.34-blue.svg)](https://soliditylang.org/)
[![EVM](https://img.shields.io/badge/EVM-Cancun-orange.svg)](https://ethereum.org/)
[![Foundry](https://img.shields.io/badge/Built%20with-Foundry-red.svg)](https://getfoundry.sh/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 1. Overview & Architecture

This repository delivers a testnet-ready, production-grade Proof of Concept (POC) tailored for **Nordhaven Bank's Treasury and Securities Financing desk**. It demonstrates how tokenising both European sovereign bonds (collateral leg) and commercial bank deposits (cash leg) unlocks **24/7 atomic settlement**, intraday liquidity, and automated margin maintenance on public Ethereum.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Institutional Trading Layer                     │
│  - Desk A (Borrower): Signs off-chain EIP-712 Order / On-chain Propose │
│  - Desk B (Lender):   Accepts trade & triggers atomic settlement       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     RepoDvP Settlement Engine                          │
│                                                                        │
│  1. Opening Leg (DvP):                                                 │
│     - nhBOND Collateral  ──> Pulled from Borrower into Escrow          │
│     - nhEUR Cash         ──> Transferred directly Lender -> Borrower   │
│     [Single transaction execution: both legs settle or tx reverts]     │
│                                                                        │
│  2. Term & Risk Maintenance:                                           │
│     - Actual/360 interest accrues per second (supports intraday)       │
│     - Mark-to-market oracle check against maintenance margin           │
│     - Programmable margin calls with cure deadlines and top-ups        │
│                                                                        │
│  3. Closing Leg (RvP):                                                 │
│     - Repayment Cash     ──> Transferred Borrower -> Lender            │
│     - nhBOND Collateral  ──> Released from Escrow back to Borrower     │
│                                                                        │
│  4. Default Resolution:                                                │
│     - Missed maturity or missed margin cure ──> Lender seizes bond     │
└────────────────────────────────────────────────────────────────────────┘
```

### Institutional Design Choices:

- **Collateral Leg (`nhBOND NAV`):** Built strictly on the official **ERC-3643 (T-REX)** token standard (`IERC3643`), representing European sovereign bond fund units valued at Net Asset Value (NAV). Enforces on-chain identity verification (`IdentityRegistry` / `ONCHAINID`), modular transfer rules (`ModularCompliance`), partial/wallet freezing, and regulatory forced transfers.
- **Cash Leg (`nhEUR`):** Structured as an institutional **Tokenised Commercial Bank Deposit** strictly modeled after **J.P. Morgan's JPM Coin (`JPMD`)** (deployed at `0xb2906cCED1b2c8330480414CeFA1eb52bDBd73A3` on Ethereum Mainnet). Incorporates a 4-tier banking control model and EIP-2612 gasless permits for 1-transaction atomic DvP settlement.
- **Real Fund NAV Oracle (`nhNAVOracle`):** Modeled after institutional tokenized money market funds (**BlackRock BUIDL**, **Ondo OUSG**, and **VanEck VBILL**), exposing Chainlink's `AggregatorV3Interface` with calculation agent attestations. Staleness is enforced by the consumer: `RepoDvP` rejects prices older than `maxPriceAge`.
- **Settlement & Escrow (`RepoDvP`):** Functions as an automated decentralized **Tri-Party Collateral Agent** under the EU Financial Collateral Directive (Directive 2002/47/EC), eliminating counterparty rehypothecation and settlement failure risk.

---

## 2. Repository Layout

```
evm-dvp-repo/
├── docs/
│   ├── ARCHITECTURE_SPEC.md              # Complete technical architecture specification
│   ├── ARCHITECTURAL_NOTES.md            # Notes on simplified workflows & peripheral extensions
│   ├── CONCEPT_EXPLAINER.md              # Part 1: Trading Desk Concept Explainer (4 Slides)
│   └── STEERING_COMMITTEE_MEMO.md        # Part 2: Steering Committee Decision Memo (Go with Conditions)
├── lib/
│   ├── ERC-3643/                         # Official authentic ERC-3643 / T-REX framework submodule
│   ├── forge-std/                        # Foundry standard testing library
│   └── openzeppelin-contracts/           # OpenZeppelin Contracts v5.7.0
├── src/
│   ├── nhBOND.sol                        # Tokenised sovereign bond NAV deriving from ERC-3643
│   ├── nhEUR.sol                         # Tokenised EUR commercial bank deposit (JPM Coin model)
│   ├── RepoDvP.sol                       # Core DvP/RvP settlement and margin engine
│   ├── nhNAVOracle.sol                   # Production RWA MMF NAV Oracle (BUIDL / OUSG model)
│   └── interfaces/
│       ├── IIdentityRegistry.sol         # isVerified() view of the ERC-3643 IdentityRegistry (nhEUR / DvP KYC)
│       ├── InhNAVOracle.sol
│       ├── IRepoDvP.sol
│       ├── IRepoTypes.sol
│       ├── InhBOND.sol
│       └── InhEUR.sol
├── test/
│   ├── interfaces/                       # Authentic ERC-3643 & test bond interfaces
│   │   ├── IERC3643.sol
│   │   ├── ITestBond.sol
│   │   └── ...
│   ├── unit/
│   │   ├── ComplianceAndTokens.t.sol     # ERC-3643 verification, partial freeze, recovery, oracle
│   │   └── RepoDvP.t.sol                 # Atomic DvP, RvP, EIP-712 orders, open RFQ
│   ├── integration/
│   │   └── MarginAndDefault.t.sol        # Price drops, margin calls, top-up, default seizure
│   ├── fuzz/
│   │   └── RepoFuzz.t.sol                # Actual/360 interest & margin ratio fuzzing (10,000 runs)
│   ├── invariant/
│   │   ├── RepoInvariant.t.sol           # Continuous contract solvency & zero trapped cash
│   │   └── RepoHandler.sol               # Invariant campaign action wrapper
│   ├── mock/
│   │   └── MockIdentity.sol              # Lightweight test ONCHAINID contract
│   └── utils/
│       └── RepoTestBase.sol              # Institutional test fixture deploying authentic T-REX suite
└── script/
    ├── helper/
    │   ├── TREXDeployer.sol              # Solc 0.8.17 deployer for authentic T-REX contracts
    │   └── ITREXDeployer.sol             # Type-safe interface bridge for Solc 0.8.34
    └── deploy/
        └── DeployAll.s.sol               # Automated Sepolia deployment & demo seeding script
```

---

## 3. Quickstart & Verification in < 30 Minutes

### Prerequisites

- [Foundry](https://getfoundry.sh/) installed (`forge --version` >= 0.2.0)
- Node.js (>= 18)

### Step 1: Clone & Setup

```bash
git clone https://github.com/toninorair/evm-repo-dvp.git
cd evm-repo-dvp
cp .env.example .env
```

### Step 2: Build & Run Test Suite

```bash
forge build
forge test
```

Expected output:

```
Ran 5 test suites: 24 tests passed, 0 failed, 0 skipped
- test_ERC3643_IdentityGating_RevertsIfNotVerified (PASS)
- test_ERC3643_PartialFreezing (PASS)
- test_ERC3643_AddressFreezing (PASS)
- test_ERC3643_BatchOperations (PASS)
- test_ERC3643_RecoveryAddress (PASS)
- test_nhNAVOracle_LifecycleAndGuards (PASS)
- test_AtomicDvP_OpeningLeg (PASS)
- test_ClosingLeg_RvP_Settlement_AtMaturity (PASS)
- test_ProposeRepo_And_Cancel (PASS)
- test_ProposeRepo_RevertsOnZeroLender (PASS)
- test_ProposeRepo_RevertsWhenBorrowerIsLender (PASS)
- test_MarginCall_Trigger_And_TopUp_Cure (PASS)
- test_Default_MissedMaturity (PASS)
- test_Default_MissedMarginCure (PASS)
- testFuzz_Actual360InterestAccrual (PASS - 5,000 runs)
- testFuzz_CollateralValuation (PASS - 5,000 runs)
- invariant_EscrowSolvency (PASS - 512 runs, 12,800 calls)
- invariant_ZeroTrappedCash (PASS - 512 runs, 12,800 calls)
- test_AtomicDvP_OpeningLeg (PASS)
- test_ClosingLeg_RvP_Settlement_AtMaturity (PASS)
- test_ProposeRepo_And_Cancel (PASS)
- test_ProposeRepo_RevertsOnZeroLender (PASS)
- test_ProposeRepo_RevertsWhenBorrowerIsLender (PASS)
- test_MarginCall_Trigger_And_TopUp_Cure (PASS)
- test_Default_MissedMaturity (PASS)
- test_Default_MissedMarginCure (PASS)
- testFuzz_Actual360InterestAccrual (PASS - 5,000 runs)
- testFuzz_CollateralValuation (PASS - 5,000 runs)
- invariant_EscrowSolvency (PASS - 512 runs, 12,800 calls)
- invariant_ZeroTrappedCash (PASS - 512 runs, 12,800 calls)
```

---

## 4. Sepolia Testnet Deployment & Etherscan Verification

### 1. Configure `.env`

Set your Sepolia credentials in `.env`:

```ini
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
PRIVATE_KEY=YOUR_SEPOLIA_TESTNET_PRIVATE_KEY
```

### 2. Simulate Deployment (Dry-Run)

```bash
forge script script/deploy/DeployAll.s.sol --rpc-url $SEPOLIA_RPC_URL
```

### 3. Broadcast & Auto-Verify on Sepolia Etherscan

```bash
forge script script/deploy/DeployAll.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  -vvvv
```

### Standalone Etherscan Verification Fallback

If Etherscan’s API experiences delays during broadcast, verify manually:

```bash
# Verify RepoDvP
forge verify-contract <REPO_DVP_ADDRESS> src/RepoDvP.sol:RepoDvP \
  --chain-id 11155111 \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" $ADMIN $REGISTRY $ORACLE) \
  --etherscan-api-key $ETHERSCAN_API_KEY

# Verify nhEUR
forge verify-contract <NH_EUR_ADDRESS> src/nhEUR.sol:nhEUR \
  --chain-id 11155111 \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address)" $ADMIN $TREASURY $COMPLIANCE $REGISTRY) \
  --etherscan-api-key $ETHERSCAN_API_KEY

# Verify nhNAVOracle
forge verify-contract <ORACLE_ADDRESS> src/nhNAVOracle.sol:nhNAVOracle \
  --chain-id 11155111 \
  --constructor-args $(cast abi-encode "constructor(address,address,int256,uint256,uint256)" $ADMIN $CALC_AGENT 10000000000 86400 50) \
  --etherscan-api-key $ETHERSCAN_API_KEY

# Verify nhBOND NAV (Official ERC-3643 / T-REX Security Token)
forge verify-contract <NH_BOND_ADDRESS> src/nhBOND.sol:nhBOND \
  --chain-id 11155111 \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

---

## 5. Live Demo Script (10-Minute Walkthrough)

### Scenario A: The Happy Path (Atomic DvP & RvP)

1. **Trade Agreement:** Bank A (Borrower) pledges 105,000 `nhBOND` (€10.5M par) to borrow €10,000,000 `nhEUR` at 3.50% repo rate for 7 days (margin ratio: 2%).
2. **Opening Leg (DvP):**
   - Call `repoDvP.acceptRepo(repoId)`.
   - Collateral transfers atomically into escrow; cash transfers to borrower.
   - Bank back office captures `RepoOpened` event.
3. **Closing Leg (RvP):**
   - At maturity, borrower calls `repoDvP.settleRepo(repoId)`.
   - Borrower repays €10,000,000 principal + €6,805.56 accrued interest (Actual/360).
   - Collateral returns atomically to borrower.
   - Bank back office captures `RepoSettled` event.

### Scenario B: Dynamic Mark-to-Market Margin Call

1. Market yield rises; sovereign bond price drops from €100.00 to €92.00 in the oracle.
2. Collateral value falls to €9.66M, breaching the 101% maintenance margin threshold.
3. Anyone calls `repoDvP.marginCall(repoId)`:
   - Status changes to `MarginCalled`.
   - Contract sets a 2-hour cure deadline and calculates the exact €440,000 collateral deficit.
   - Bank risk system captures `MarginCalled` event.
4. Borrower calls `repoDvP.topUpCollateral(repoId, 10_000 ether)`.
   - 10,000 additional bonds transferred to escrow.
   - Trade returns to `Active`.

### Scenario C: Default Close-Out Seizure

1. If the borrower fails to cure within 2 hours (or fails to repay at maturity):
2. Lender calls `repoDvP.claimDefault(repoId)`.
3. 100% of escrowed bonds are instantly seized and delivered to the lender.
4. Contract emits `RepoDefaulted(repoId, lender, collateralSeized, "Margin Call Cure Expired")`.
