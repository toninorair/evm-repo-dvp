# Repo DvP · Settlement Console

A web front end for `RepoDvP.sol`, built with Vite, React and viem. It covers the full repo lifecycle: proposing a repo, opening it with atomic DvP, Actual/360 accrual, mark-to-market margin calls, cures, early or at-maturity RvP, and default close-out.

## Run it

```bash
cd app
npm install
npm run dev
```

If no contract addresses are configured, the console runs in **demo mode**. It uses the README scenario (€10M at 3.50% for 7 days, 2% haircut, NAV €92.00) and simulates the contract in memory, so every action can be clicked through. Use the **Acting as** switcher in the header to move between Desk A (borrower) and Desk B (lender).

## Connect to Sepolia

1. Deploy with `script/deploy/DeployAll.s.sol` (see the root README).
2. Copy `app/.env.example` to `app/.env` and paste in the addresses the script prints:

```ini
VITE_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<key>
VITE_REPO_DVP=0x…
VITE_NH_BOND=0x…
VITE_NH_EUR=0x…
VITE_NAV_ORACLE=0x…
VITE_COMPLIANCE_REGISTRY=0x…
VITE_DEPLOY_BLOCK=<deployment block>
```

3. Run `npm run dev`, then connect a browser wallet. The app switches the wallet to Sepolia if it's on another network.

## How it maps to the contract

| Screen | Contract calls |
| --- | --- |
| Repo book | `repoCount`, `getRepo` (multicall, latest 100), `latestRoundData`, event history |
| Propose | `approve` (nhBOND for borrowers, nhEUR for lenders), then `proposeRepo` |
| Position · proposed | `approve` for the accepter's leg, `acceptRepo` (opening leg DvP), `cancelProposal` |
| Position · active | `settleRepo` (approval sized to the full-tenor repurchase price), `triggerMarginCall` (permissionless) |
| Position · margin called | `topUpCollateral`, `settleRepo`, and `claimDefault` once the cure window has expired |

- **Mirrored formulas:** `src/lib/repo.ts` reproduces the contract's formulas: interest = principal × rate × elapsed ÷ 311,040,000,000, opening requirement = cash ÷ (1 − haircut), and maintenance threshold = repurchase price × (1 + margin). The UI uses them for live per-second figures between chain reads.
- **Pre-flight simulation:** every write is simulated first. When a transaction would revert, the console shows a plain-language reason (for example `CurePeriodActive` or `InsufficientCollateralValue`) instead of opening the wallet.
- **Off-chain orders:** EIP-712 off-chain orders are not offered, because `executeRepoOrder` was removed from `RepoDvP.sol`.

## Design

- **Type:** Libre Caslon Display for headings and large figures, Inter for everything else, with tabular numerals.
- **Colour:** a warm ground (`#F2EFE9`) and ink-black text. Colour is used only for status (active, margin called, defaulted).
- **Motion:** minimal. Sections fade up on load, figures ease to new values, the margin gauge glides, accrual and countdowns tick each second, and the live indicator breathes. All of it is switched off under `prefers-reduced-motion`.
