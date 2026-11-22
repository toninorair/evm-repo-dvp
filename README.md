# Nordhaven Bank — Tokenised Repo on Ethereum (Atomic DvP)

> **Ethereum Institutional** · Bilateral Repurchase Agreement Prototype on Ethereum

Smart contracts and settlement console for tokenised EUR sovereign bond repurchase agreements (`RepoDvP`) with atomic Delivery-versus-Payment (DvP), Actual/360 per-second interest accrual, mark-to-market margin calls, and GMRA close-out netting on Ethereum.

## Smart Contract Architecture
![Nordhaven Smart Contract Architecture](diagrams/contract-architecture.svg)

## Contracts & Key Assumptions

| Contract                                 | Standard / Model          | Purpose                                                                 | Sepolia Address                                                                                                                 |
| :--------------------------------------- | :------------------------ | :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| [`RepoDvP.sol`](src/RepoDvP.sol)         | Bilateral Repo DvP        | Atomic DvP/RvP, Actual/360 interest, margin calls, default netting      | [`0x9b7d0BaE4acDE189DAe646FEfbafFd9842E39233`](https://sepolia.etherscan.io/address/0x9b7d0BaE4acDE189DAe646FEfbafFd9842E39233) |
| [`nhBOND.sol`](src/nhBOND.sol)           | Official ERC-3643 (T-REX) | Tokenised EUR sovereign bond, KYC-gated transfers                       | [`0xF13e3EDCBA568e1A3DBfce0C9749A7058205b09C`](https://sepolia.etherscan.io/address/0xF13e3EDCBA568e1A3DBfce0C9749A7058205b09C) |
| [`nhEUR.sol`](src/nhEUR.sol)             | Tokenised Bank Deposit    | Permissioned EUR cash leg (JPM Coin model) sharing `IdentityRegistry`   | [`0xeEe12a05026bB38Ddb042e9DC16A3120EB637584`](https://sepolia.etherscan.io/address/0xeEe12a05026bB38Ddb042e9DC16A3120EB637584) |
| [`nhNAVOracle.sol`](src/nhNAVOracle.sol) | Chainlink `AggregatorV3`  | Calculation-agent EUR NAV feed (8 decimals)                             | [`0x8fa64250d92e397249bEacFb335B73016fCEC1be`](https://sepolia.etherscan.io/address/0x8fa64250d92e397249bEacFb335B73016fCEC1be) |
| `IdentityRegistry`                       | Official ERC-3643 (T-REX) | On-chain `ONCHAINID` verification enforced by both tokens and `RepoDvP` | [`0xEBC4c98BD77287090Bf2A29357BF846f61eaB98B`](https://sepolia.etherscan.io/address/0xEBC4c98BD77287090Bf2A29357BF846f61eaB98B) |

## Tokenised Repo Lifecycle and Flows 
![Tokenised Repo Lifecycle](diagrams/repo-lifecycle.svg)

**Three core architectural calls:**

1. **On-Chain Collateral Lock in `RepoDvP`:** Opening leg locks `nhBOND` inside `RepoDvP` rather than transferring to the lender's wallet, preventing rehypothecation or lender-freeze from blocking atomic closing-leg return (`settleRepo`).
2. **Borrower Proposal & Live NAV Sizing:** Borrower proposes terms (`initialMarginBps`, `maxCollateralAmount` slippage cap) naming the `lender`; `acceptRepo` sizes collateral dynamically at the live oracle NAV.
3. **GMRA Close-Out Netting:** On missed maturity or uncured margin call (`claimDefault`), the lender seizes collateral worth the exact accrued repurchase price (`amountOwed`) and any surplus is returned to the borrower.

---

## 1. Prerequisites & Tests

Requires [Foundry](https://getfoundry.sh/) and Node.js >= 18.

```bash
git clone --recursive <repo-url>
cd evm-dvp-repo

# Installs root tooling, initializes submodules if needed, and installs ERC-3643's Solidity deps
npm install && npm --prefix app install
forge build
forge test
```

_(If you already cloned without `--recursive`, `npm install` will initialize submodules and install `lib/ERC-3643` dependencies automatically via its `postinstall` hook, or you can run `git submodule update --init --recursive && npm --prefix lib/ERC-3643 install --ignore-scripts` manually.)_

Runs 50 unit, integration, fuzz (5,000 runs), and invariant (512 runs) tests across ERC-3643 compliance, atomic DvP/RvP, margin cures, and default netting.

---

## 2. Option A — Local Run (Anvil + Settlement Console)

Run the entire stack locally on chain ID `31337` with zero configuration:

```bash
# Terminal 1: start local Anvil node
make local-chain

# Terminal 2: deploy contracts, onboard default desks, and write app/.env.local
make local-deploy

# Terminal 2: start the web console (http://localhost:5173)
npm run app:dev
```

Import the three Anvil test keys printed by `make local-deploy` into MetaMask:

- **Account #0 (Operator):** Connects to **Market** (updates bond NAV) & **Identity** (KYC onboarding).
- **Account #1 (Borrower):** Connects to **Borrower** (pre-funded with 250,000 `nhBOND` + 25M `nhEUR`).
- **Account #2 (Lender):** Connects to **Lender** (pre-funded with 25M `nhEUR`).

---

## 3. Option B — Use Against Deployed Sepolia Contract

### Open the hosted console or run locally against Sepolia

- **Hosted on GitHub Pages:** [**https://toninorair.github.io/evm-repo-dvp/**](https://toninorair.github.io/evm-repo-dvp/) (pre-configured for the verified Sepolia deployment).
- **Or run the console locally:**
  1. Remove any local override (the console defaults to the verified Sepolia `RepoDvP` at `0x9b7d0BaE4acDE189DAe646FEfbafFd9842E39233`):
     ```bash
     rm -f app/.env.local
     cp app/.env.example app/.env
     ```
  2. (Optional) Set a custom `VITE_RPC_URL` in `app/.env`.
  3. Start the console:
     ```bash
     npm run app:dev
     ```
  4. **Onboard a wallet:** Connect the deployer wallet on the **Identity** tab (`#/identity`) to one-click register and fund any Sepolia address, or run via CLI:
     ```bash
     REPO_DVP=0x9b7d0BaE4acDE189DAe646FEfbafFd9842E39233 DESK=0x... BONDS=250000 CASH=25000000 \
     forge script script/deploy/OnboardDesk.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
     ```

### Deploy a fresh instance to Sepolia

```bash
cp .env.example .env   # set SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY, and optional BORROWER_ADDRESS / LENDER_ADDRESS

forge script script/deploy/DeployAll.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

_(If `nhBOND` verification is skipped during broadcast due to the `solc 0.8.17` `deployCode` bridge, run the `forge verify-contract` command printed at the end of the deploy log.)_
