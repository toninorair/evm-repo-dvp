# Repo DvP · Settlement Console

A web front end for `RepoDvP.sol` on Sepolia, built with Vite, React and viem. Borrower and lender each connect a browser wallet and run the full lifecycle against the deployed contracts: propose, accept with atomic DvP, Actual/360 accrual, margin calls, top-up cures, settlement (RvP) and default close-out. There is no simulated data; every figure is read from the chain.

## 1. Deploy and onboard the desks

From the repo root, with `PRIVATE_KEY` and `SEPOLIA_RPC_URL` set (see the root README):

```bash
BORROWER_ADDRESS=0x… LENDER_ADDRESS=0x… \
forge script script/deploy/DeployAll.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
```

`DeployAll` deploys the NAV oracle (€100.00), the ERC-3643 suite with nhBOND, nhEUR and RepoDvP. It then registers both desk wallets in the identity registry and funds them:

| Desk     | nhBOND  | nhEUR                          |
| -------- | ------- | ------------------------------ |
| Borrower | 100,000 | 10,000,000 (to repay interest) |
| Lender   | 0       | 10,000,000                     |

The deployer wallet is the NAV calculation agent. Every wallet also needs Sepolia ETH for gas.

To add another wallet later, use the console's **Identity** tab with the deployer wallet, or:

```bash
REPO_DVP=0x… DESK=0x… BONDS=100000 CASH=10000000 \
forge script script/deploy/OnboardDesk.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
```

## 2. Run the console

```bash
cp app/.env.example app/.env   # set VITE_REPO_DVP, VITE_RPC_URL and VITE_DEPLOY_BLOCK from the deploy output
npm --prefix app install
npm run app:dev
```

The console has three tabs, each bound to its own wallet:

- **Borrower** (`#/borrower`): positions, Propose, Wallet. Proposes, cancels, tops up and settles.
- **Lender** (`#/lender`): positions, Wallet. Accepts, calls margin and claims default.
- **Market** (`#/market`): the operator posts NAVs to move the market.
- **Identity** (`#/identity`): the operator onboards wallets in the ERC-3643 identity registry. It deploys each wallet's ONCHAINID, registers it in both token registries, and issues nhBOND / mints nhEUR, the same as `OnboardDesk.s.sol`. It can also remove a wallet, to test rejection, and lists every registered wallet.

Market and Identity share the **operator** wallet: the deployer, which is NAV calculation agent, registry agent, nhBOND agent and nhEUR treasury.

Open each tab and click **Connect** with the matching account selected in your wallet. Bindings are remembered in the browser and shared between browser tabs, so the borrower and lender can sit side by side. A wallet signs only for its selected account; if it doesn't match the tab's wallet, the console says which account to switch to instead of sending from the wrong counterparty. One account can't be both borrower and lender.

## Test locally before Sepolia

The whole stack runs on a local anvil node, chain id 31337. MetaMask keeps it separate from Sepolia, and transactions confirm instantly with free gas.

```bash
make local-chain     # terminal 1: keeps anvil running
make local-deploy    # terminal 2: deploys, onboards the desks, writes app/.env.local
npm run app:dev
```

In MetaMask, import the keys that `make local-deploy` prints. These are anvil's public test keys, so never send real funds to them:

- **Account #0:** deployer and NAV agent.
- **Account #1:** borrower.
- **Account #2:** lender.

Then connect each tab: select account #1 and connect on **Borrower**, #2 on **Lender**, #0 on **Market** (it also covers **Identity**). To use your own wallets instead, onboard them in the **Identity** tab. The first connect offers to add the "Anvil" network (`http://127.0.0.1:8545`) and switch to it. Before signing in a tab, select that tab's account in MetaMask.

- **Restarting anvil** wipes the chain. Rerun `make local-deploy`, then in MetaMask use _Settings → Advanced → Clear activity tab data_ so nonces reset.
- **Going back to Sepolia:** delete `app/.env.local`; it takes precedence over `app/.env`.

## 3. Walk through the flow

1. **Borrower tab → Propose.** The lender field is prefilled with the connected lender wallet; set the terms. The 10m term preset makes maturity and default testable within a session. The console approves the nhBOND cap to RepoDvP, then calls `proposeRepo()`.
2. **Lender tab → open the repo → Approve nhEUR and accept.** `acceptRepo()` sizes collateral at the current NAV and settles both legs in one transaction. The panel checks the borrower's nhBOND balance and approval first.
3. **Market tab.** Post a lower NAV, for example −2%, to push coverage below the maintenance threshold. The tab lists each active repo's call price.
4. **Lender tab (or anyone) → Issue margin call.** `marginCall()` is permissionless and starts the repo's cure window.
5. **Borrower tab → Cure the margin call.** Use the Minimum or Back-to-initial-margin presets. `topUpCollateral()` clears the call when coverage is restored.
6. **Borrower tab → Settle now.** `settleRepo()` pays principal plus interest and releases all collateral.
7. **Lender tab → Claim default.** Available once maturity has passed unsettled, or after the cure window has lapsed with coverage still short. The lender takes collateral worth what is owed; any surplus goes back to the borrower.

Each tab's **Wallet** page shows that wallet's identity status, balances, frozen or paused flags, approvals and gas. Positions that need the tab's action are flagged at the top of its positions list.

## How it maps to the contract

| Screen                      | Contract calls                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo book                   | `repoCount`, `orders`, `states` (latest 200), `latestRoundData`, event history                                                                            |
| Propose (borrower)          | nhBOND `approve` (cap), `proposeRepo`                                                                                                                     |
| Proposed repo               | lender: nhEUR `approve`, `acceptRepo` · borrower: `cancelRepo`                                                                                            |
| Active / margin-called repo | anyone: `marginCall` · borrower: `topUpCollateral`, `settleRepo` · lender: `claimDefault`                                                                 |
| Wallet (per tab)            | `isVerified`, balances, `isFrozen`, `paused`, allowances                                                                                                  |
| Market                      | `updateNAV` (calculation agent)                                                                                                                           |
| Identity                    | `contains`, `isVerified`, `identity`, `investorCountry` · operator: deploy `Identity`, `registerIdentity`, `deleteIdentity`, nhBOND `issue`, nhEUR `mint` |

- **Mirrored formulas.** `src/lib/repo.ts` reproduces the contract's maths so figures tick every second between chain reads:
  - interest = principal × rate × elapsed ÷ 311,040,000,000, accruing past maturity until settled;
  - opening collateral = ⌈principal × (1 + initial margin) ÷ NAV⌉;
  - maintenance requirement = repurchase price × (1 + maintenance margin).
- **Pre-flight simulation.** Every write is simulated first. A doomed transaction shows the decoded reason, for example `CollateralAboveCap` or `StalePrice`, and the wallet never opens.
- **Approvals.**
  - The borrower's nhBOND approval covers the caps of all of their open proposals, because `acceptRepo()` pulls from that single allowance.
  - The settlement approval covers an extra hour of interest, so accrual between the click and the block can't make it fail.
- **ABIs** are generated from Foundry's build output. After changing a contract, run `forge build` at the root, then `npm --prefix app run abi`.
- **Event history** is indexed incrementally from `VITE_DEPLOY_BLOCK`. The block range shrinks automatically when the RPC rejects large `eth_getLogs` ranges.

## Design

- **Type:** Libre Caslon Display for headings and large figures, Inter for everything else, with tabular numerals.
- **Colour:** a white ground (`#FFFFFF`) and ink-black text. Colour is used only for status (active, margin called, defaulted).
- **Motion:** minimal, and switched off under `prefers-reduced-motion`.
