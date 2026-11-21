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
│  - Desk A (Borrower): Proposes repo terms on-chain (`proposeRepo`)     │
│  - Desk B (Lender):   Accepts trade & triggers atomic settlement       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     RepoDvP Settlement Engine                          │
│                                                                        │
│  1. Opening Leg (DvP):                                                 │
│     - nhBOND Collateral  ──> Sized at live NAV & pulled into Escrow    │
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
│  4. Default Resolution (Close-Out Netting):                            │
│     - Missed maturity or missed margin cure ──> Lender seizes bond     │
│       worth amount owed; surplus collateral returned to Borrower       │
└────────────────────────────────────────────────────────────────────────┘
```

### Institutional Design Choices:

- **Collateral Leg (`nhBOND` / `nhBOND NAV`):** Built strictly on the official **ERC-3643 (T-REX)** token standard (`IERC3643`), representing a tokenised EUR sovereign government bond (German Bund ISIN `DE0001102580`, €100.00 par, 2.50% coupon, Level 1 HQLA) whose mark-to-market price / Net Asset Value per unit is published on-chain. Enforces on-chain identity verification (`IdentityRegistry` / `ONCHAINID`), modular transfer rules (`ModularCompliance`), partial/wallet freezing, and regulatory forced transfers.
- **Cash Leg (`nhEUR`):** Structured as an institutional **Tokenised Commercial Bank Deposit** modeled after **J.P. Morgan's JPM Coin (`JPMD`)** (deployed at `0xb2906cCED1b2c8330480414CeFA1eb52bDBd73A3` on Ethereum Mainnet). Incorporates role-based banking controls (`TREASURY_ROLE`, `COMPLIANCE_ROLE`), shared ERC-3643 `IdentityRegistry` checks, account freeze/pause guardrails, and EIP-2612 permit support.
- **Minimal Bond Price / NAV Oracle (`nhNAVOracle`):** Modeled after the calculation-agent attestation architecture used by institutional tokenised fixed-income instruments (**BlackRock BUIDL**, **Ondo OUSG**, and **VanEck VBILL**), exposing Chainlink's `AggregatorV3Interface` with calculation agent attestations and `updatedAt` round timestamps while keeping the POC oracle intentionally simple (no on-chain staleness cutoff).
- **Settlement & Escrow (`RepoDvP`):** Functions as an automated decentralized **Tri-Party Collateral Agent** under the EU Financial Collateral Directive (Directive 2002/47/EC), eliminating counterparty rehypothecation and settlement failure risk, with GMRA-aligned close-out netting on default.

### Key Design Assumptions & Institutional Calls

Per the brief (_"Where the brief is ambiguous, make a call, write down the assumption and move on"_), three explicit architectural calls were made for this POC:

1. **Opening Leg Collateral Destination — Tri-Party Smart Contract Escrow vs. Lender Wallet (Brief Item 3b):**
   - _Assumption:_ Instead of transferring `nhBOND` directly to the lender's EOA wallet on the opening leg, `RepoDvP` locks collateral in neutral smart-contract escrow (`address(this)`).
   - _Rationale:_ If collateral moved to the lender's wallet, the lender could transfer, rehypothecate, or have their wallet frozen before maturity—breaking the guaranteed atomic Closing Leg (`settleRepo`) required by Item 3c. Escrow custody mirrors a tri-party collateral agent and mathematically guarantees that collateral returns atomically the instant the borrower repays.
2. **Proposal Role Symmetry & Dynamic Oracle Sizing (Brief Item 3a):**
   - _Assumption:_ Proposals are borrower-initiated (`msg.sender` is the cash borrower and names the `lender` who must call `acceptRepo`), and specify `initialMarginBps` + a slippage cap (`maxCollateralAmount`) rather than a static collateral token count.
   - _Rationale:_ Prevents a proposer from accepting their own order against a counterparty's pre-existing ERC-20 allowance without consent, and ensures that if the oracle price moves between proposal and acceptance, `acceptRepo` sizes collateral accurately at the live opening price (reverting with `CollateralAboveCap` if the required units exceed the borrower's cap).
3. **Default Close-Out Netting & POC Push-Surplus (Brief Item 3c / Default):**
   - _Assumption:_ On default (`claimDefault`), rather than forfeiting 100% of escrowed collateral, `RepoDvP` executes GMRA-aligned **close-out netting**: the lender seizes collateral worth the exact accrued repurchase price (`amountOwed`) at the live oracle price, and any `surplusCollateral` is pushed back to the borrower in the same transaction (keeping the escrow solvency invariant minimal for the POC; a production Phase 2 deployment can isolate surplus into a pull-claim mapping in case a defaulting borrower is frozen under ERC-3643).

### Deployed & Verified Contracts (Ethereum Sepolia — Chain ID `11155111`)

| Contract               | Role                                                      | Sepolia Address / Etherscan |
| :--------------------- | :-------------------------------------------------------- | :-------------------------- |
| **`RepoDvP`**          | Atomic DvP/RvP Settlement & Margin Escrow Engine          | `TBD_ON_SEPOLIA_DEPLOY`     |
| **`nhBOND`**           | ERC-3643 Tokenised EUR Sovereign Bond (`DE0001102580`)    | `TBD_ON_SEPOLIA_DEPLOY`     |
| **`nhEUR`**            | Tokenised EUR Commercial Bank Deposit (JPM Coin Model)    | `TBD_ON_SEPOLIA_DEPLOY`     |
| **`nhNAVOracle`**      | Chainlink `AggregatorV3Interface` Bond Price / NAV Oracle | `TBD_ON_SEPOLIA_DEPLOY`     |
| **`IdentityRegistry`** | Official ERC-3643 / T-REX On-Chain KYC Registry           | `TBD_ON_SEPOLIA_DEPLOY`     |

---

## 2. Repository Layout

```
evm-dvp-repo/
├── app/                                  # Settlement Console web UI (Vite + React + TypeScript + viem)
│   ├── scripts/gen-abi.mjs               # Generates app/src/lib/abi.ts from Foundry build output
│   └── src/
│       ├── components/                   # Institutional UI primitives, gauges, and layout shell
│       ├── lib/                          # Chain client, mirrored repo math (repo.ts), and state store
│       └── screens/                      # Borrower, Lender, Position, Propose, Market, and Identity tabs
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
│   ├── nhBOND.sol                        # Tokenised sovereign bond deriving from official ERC-3643
│   ├── nhEUR.sol                         # Tokenised EUR commercial bank deposit (JPM Coin model)
│   ├── RepoDvP.sol                       # Core DvP/RvP settlement and margin engine
│   ├── nhNAVOracle.sol                   # Chainlink AggregatorV3-compatible bond price / NAV oracle
│   └── interfaces/
│       ├── IIdentityRegistry.sol         # isVerified() + token identityRegistry() views (DvP reads each leg's registry live)
│       ├── InhNAVOracle.sol
│       ├── IRepoDvP.sol
│       ├── InhBOND.sol
│       └── InhEUR.sol
├── test/
│   ├── interfaces/                       # Authentic ERC-3643 & test bond interfaces
│   │   ├── IERC3643.sol
│   │   ├── ITestBond.sol
│   │   └── ...
│   ├── unit/
│   │   ├── ComplianceAndTokens.t.sol     # ERC-3643 verification, partial freeze, recovery, oracle
│   │   └── RepoDvP.t.sol                 # Atomic DvP, RvP, dynamic collateral sizing, registry checks
│   ├── integration/
│   │   └── MarginAndDefault.t.sol        # Price drops, margin calls, top-up, close-out netting
│   ├── fuzz/
│   │   └── RepoFuzz.t.sol                # Actual/360 interest & collateral sizing fuzzing (5,000 runs)
│   ├── invariant/
│   │   ├── RepoInvariant.t.sol           # Continuous contract solvency & zero trapped cash
│   │   └── RepoHandler.sol               # Invariant campaign action wrapper
│   ├── mock/
│   │   ├── MockIdentity.sol              # Lightweight test ONCHAINID contract
│   │   └── MockIdentityRegistry.sol      # Registry mock for live registry-rotation unit tests
│   └── utils/
│       └── RepoTestBase.sol              # Institutional test fixture deploying authentic T-REX suite
└── script/
    ├── helper/
    │   ├── TREXSuiteDeployment.sol       # EIP-170-safe per-contract T-REX & nhBOND deployer for Sepolia
    │   ├── TREXDeployer.sol              # Solc 0.8.17 in-memory suite deployer for Foundry test fixtures
    │   └── ITREXDeployer.sol             # Type-safe interface bridge for Solc 0.8.34
    ├── local/
    │   └── deploy-local.sh               # One-command local Anvil deployment + app/.env.local setup
    └── deploy/
        ├── DeployAll.s.sol               # Automated Sepolia deployment & demo seeding script
        └── OnboardDesk.s.sol             # Standalone script to register & fund additional trading desks
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
Ran 5 test suites: 50 tests passed, 0 failed, 0 skipped
- ComplianceAndTokensTest (14 passed): ERC-3643 identity gating, partial/address freezing, forced transfer, recovery, nhEUR & nhNAVOracle guards
- RepoDvPTest (25 passed): Atomic DvP opening leg, dynamic collateral sizing & cap guards, Actual/360 interest, RvP closing leg, live registry checks
- MarginAndDefaultTest (8 passed): MTM margin calls, top-up cure, missed maturity & missed margin cure default close-out netting, surplus return
- RepoFuzzTest (2 passed - 5,000 runs each): testFuzz_Actual360InterestAccrual, testFuzz_CollateralSizing
- RepoInvariantTest (1 passed - 512 runs, 12,800 calls): invariant_EscrowSolvency, invariant_ZeroTrappedCash
```

---

## 3b. Settlement Console (web app)

A Vite + React + viem front end lives in [`app/`](app/README.md). It reads and writes the deployed contracts on Sepolia: borrower and lender each connect a browser wallet and run the full lifecycle. Set `VITE_REPO_DVP` in `app/.env` (from `app/.env.example`), then run `npm --prefix app install && npm run app:dev`.

---

## 4. Sepolia Testnet Deployment & Etherscan Verification

### 1. Configure `.env`

Set your Sepolia credentials in `.env`:

```ini
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
SEPOLIA_VERIFIER_URL=https://api-sepolia.etherscan.io/api
PRIVATE_KEY=YOUR_SEPOLIA_TESTNET_PRIVATE_KEY
# Optional: wallets to register in the identity registry and fund for the settlement console
BORROWER_ADDRESS=0x…   # gets 250,000 nhBOND and 25,000,000 nhEUR
LENDER_ADDRESS=0x…     # gets 25,000,000 nhEUR
```

Onboard more desks later with `REPO_DVP=0x… DESK=0x… forge script script/deploy/OnboardDesk.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast`.

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

> **Note on `nhBOND` (`solc 0.8.17`):** Because `TREXSuiteDeployment` deploys `nhBOND` via `deployCode("nhBOND.sol:nhBOND")` to bridge `solc 0.8.17` (ERC-3643) and `solc 0.8.34` without exceeding the 24 KB EIP-170 contract size limit, `forge script --verify` automatically verifies `RepoDvP`, `nhEUR`, and `nhNAVOracle`, and may skip raw `deployCode` creations. If `nhBOND` is skipped—or if Etherscan’s API experiences delays during broadcast—run the standalone verification command (also printed at the end of `DeployAll`):

```bash
# Verify RepoDvP
forge verify-contract <REPO_DVP_ADDRESS> src/RepoDvP.sol:RepoDvP \
  --chain-id 11155111 \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" $ORACLE $NH_BOND $NH_EUR) \
  --etherscan-api-key $ETHERSCAN_API_KEY

# Verify nhEUR
forge verify-contract <NH_EUR_ADDRESS> src/nhEUR.sol:nhEUR \
  --chain-id 11155111 \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address)" $ADMIN $TREASURY $COMPLIANCE $REGISTRY) \
  --etherscan-api-key $ETHERSCAN_API_KEY

# Verify nhNAVOracle
forge verify-contract <ORACLE_ADDRESS> src/nhNAVOracle.sol:nhNAVOracle \
  --chain-id 11155111 \
  --constructor-args $(cast abi-encode "constructor(address,address)" $ADMIN $CALC_AGENT) \
  --etherscan-api-key $ETHERSCAN_API_KEY

# Verify nhBOND NAV (Official ERC-3643 / T-REX Security Token)
forge verify-contract <NH_BOND_ADDRESS> src/nhBOND.sol:nhBOND \
  --chain-id 11155111 \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

---

## 5. Live Demo Script (10-Minute Walkthrough)

### Scenario A: The Happy Path (Atomic DvP & RvP)

1. **Trade Proposal:** Bank A (Borrower) calls `proposeRepo()` to borrow €10,000,000 `nhEUR` from Bank B (Lender) at a 3.50% repo rate for 7 days (2% initial margin, 1% maintenance margin, 2-hour cure period, capped at 103,000 `nhBOND`).
2. **Opening Leg (DvP):**
   - Lender calls `repoDvP.acceptRepo(repoId)`.
   - Contract sizes collateral at the €100.00 live NAV (102,000 `nhBOND` = €10.2M) and atomically pulls `nhBOND` into escrow while transferring €10,000,000 `nhEUR` directly to the borrower.
   - Bank back office captures `RepoOpened` event.
3. **Closing Leg (RvP):**
   - At maturity, borrower calls `repoDvP.settleRepo(repoId)`.
   - Borrower repays €10,000,000 principal + €6,805.56 accrued interest (Actual/360).
   - Collateral returns atomically to borrower.
   - Bank back office captures `RepoSettled` event.

### Scenario B: Dynamic Mark-to-Market Margin Call

1. Market yield rises; sovereign bond price drops from €100.00 to €92.00 in the oracle (`updateNAV`).
2. Collateral value falls to €9.384M (102,000 bonds × €92.00), breaching the 101% maintenance margin threshold.
3. Anyone calls `repoDvP.marginCall(repoId)`:
   - Status changes to `MarginCalled`.
   - Contract sets a 2-hour `cureDeadline`.
   - Bank risk system captures `MarginCalled(repoId, currentCollateralValue, cureDeadline)` event.
4. Borrower calls `repoDvP.topUpCollateral(repoId, 10_000 ether)`.
   - 10,000 additional bonds transferred to escrow, restoring health above the maintenance requirement.
   - Trade returns to `Active` and `cureDeadline` resets to `0`.

### Scenario C: Default Close-Out Netting

1. If the borrower fails to cure within 2 hours (or fails to repay by maturity):
2. Lender calls `repoDvP.claimDefault(repoId)`.
3. **Close-Out Netting:** The contract seizes collateral worth the exact repurchase price owed (`amountOwed`) at the live oracle price and returns any `surplusCollateral` to the borrower in the same transaction.
4. Contract emits `RepoDefaulted(repoId, lender, amountOwed, collateralSeized, surplusCollateral, reason)`.

---

## 6. Tools, Frameworks & AI Assistance Disclosure

Per the case study guidelines (_"Any language, framework or AI assistant you like. Tell us what you used and where"_):

- **Smart Contracts & Testing:** Solidity (`0.8.34` & `0.8.17`), **Foundry** (`forge`, `cast`, `anvil` for unit, integration, 5,000-run fuzz, and 512-run invariant testing), official **ERC-3643 (T-REX)** framework (`lib/ERC-3643`), and **OpenZeppelin Contracts v5.7.0**.
- **Settlement Console (`app/`):** TypeScript, **React 19**, **Vite 8**, and **viem** for direct browser-wallet interaction and real-time event indexing against Sepolia / Anvil.
- **Static Analysis & Linting:** **Solhint**, **Prettier (`prettier-plugin-solidity`)**, and **Slither**.
- **AI Assistance:** AI coding assistants (Claude Code / Gemini in Antigravity IDE) were used to accelerate documentation formatting and diagrams (`docs/`), scaffold the React/viem Settlement Console UI (`app/`), expand Foundry fuzz/invariant test coverage, and perform adversarial code-review passes on state-machine edge cases (such as close-out netting under recovered margin calls and ERC-3643 compliance interactions). All financial architecture decisions, legal/regulatory framing (EU FCD/SFD, GMRA 2011 Annex, Basel III SCO60), and core settlement invariants were directed and verified by the author.
