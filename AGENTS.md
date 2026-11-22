# AGENTS.md

Operational guide for AI coding agents working in this repository. For full protocol design and rationale, read `docs/ARCHITECTURE_SPEC.md` and `docs/ARCHITECTURAL_NOTES.md`.

## Repository Map

- `src/` — Core smart contracts:
  - `RepoDvP.sol` (`solc 0.8.34`): Bilateral atomic DvP/RvP repo engine, Actual/360 per-second interest accrual, mark-to-market margin calls, GMRA close-out netting.
  - `nhBOND.sol` (`solc 0.8.17`, pinned for ERC-3643): Tokenised EUR sovereign bond (T-REX / ERC-3643).
  - `nhEUR.sol` (`solc 0.8.34`): Permissioned EUR deposit token sharing the ERC-3643 `IdentityRegistry`.
  - `nhNAVOracle.sol` (`solc 0.8.34`): Chainlink `AggregatorV3`-compatible EUR NAV feed (8 decimals).
- `test/` — Foundry test suites: `unit/`, `integration/`, `fuzz/` (5,000 runs), `invariant/` (512 runs, depth 25).
- `script/` — Foundry deploy (`deploy/`), helpers (`helper/`), and local Anvil setup (`local/`).
- `app/` — React 19 + Vite + TypeScript + `viem` settlement console (`app/src/`, `app/test/`, `app/scripts/gen-abi.mjs`).
- `docs/` — Technical architecture specs (`ARCHITECTURE_SPEC.md`, `ARCHITECTURAL_NOTES.md`).
- `lib/` — Git submodules (`forge-std`, `openzeppelin-contracts`, `ERC-3643`). **Do not edit.**
- `deployments/`, `broadcast/`, `out/`, `cache/` — Generated artifacts / deploy logs. **Do not edit by hand.**

## Setup & Build Gotchas

- **Submodules + ERC-3643 deps:** `remappings.txt` resolves `@onchain-id/` and OpenZeppelin v4 from `lib/ERC-3643/node_modules/`. Root `npm install` runs a `postinstall` hook that initializes missing submodules and executes `npm --prefix lib/ERC-3643 install --ignore-scripts --no-audit --no-fund`.
- **Dual Solidity versions:** `foundry.toml` sets `auto_detect_solc = true` so `nhBOND.sol` compiles with `0.8.17` while `RepoDvP.sol`, `nhEUR.sol`, and `nhNAVOracle.sol` compile with `0.8.34`. Keep `// solhint-disable-next-line compiler-version` on `nhBOND.sol`.
- **Local chain:** `make local-chain` runs `anvil --hardfork osaka`; `make local-deploy` deploys contracts, onboards default desks, and writes `app/.env.local`.

## Contract ↔ Frontend ABI Sync

`app/src/lib/abi.ts` is generated from Foundry's `out/` directory. **Never edit `app/src/lib/abi.ts` by hand.**

Whenever you change a public/external function, event, or custom error in `src/`:

1. Run `forge build` at the repo root.
2. Run `npm --prefix app run abi` (runs `app/scripts/gen-abi.mjs`).
3. If you added new functions/events needed by the UI, update the `pick(...)` lists in `app/scripts/gen-abi.mjs` first.
4. Run `npm --prefix app run typecheck && npm --prefix app test`.

## Protocol Invariants (Do Not Break)

1. **Escrowed collateral:** Opening leg (`acceptRepo`) locks `nhBOND` inside `RepoDvP` (never in the lender's wallet) so closing-leg settlement (`settleRepo`) cannot be blocked by lender rehypothecation or freeze.
2. **Live NAV sizing with slippage cap:** `proposeRepo` specifies `initialMarginBps` and `maxCollateralAmount`; `acceptRepo` sizes collateral dynamically at the live `nhNAVOracle` NAV and reverts if required collateral exceeds the cap.
3. **Actual/360 per-second accrual:** Interest accrues continuously per second on an Actual/360 basis (including post-maturity until settled or defaulted).
4. **GMRA close-out netting:** On `claimDefault` (missed maturity or uncured margin call), the lender seizes collateral worth the exact accrued `amountOwed` and any surplus is returned to the borrower.
5. **Unified ERC-3643 identity gating:** Counterparties must be verified on the `IdentityRegistry` enforced by `nhBOND`, `nhEUR`, and `RepoDvP`.
6. **Solvency & zero trapped cash:** Preserve `invariant_EscrowSolvency` and `invariant_ZeroTrappedCash` in `test/invariant/RepoInvariant.t.sol`.

## Verification Commands

### Fast loop (run after every change)

```bash
forge build
forge test
npm run solhint
```

### Frontend checks (run whenever `app/` or contract ABIs change)

```bash
npm --prefix app run typecheck
npm --prefix app test
npm --prefix app run build
```

### Full pre-PR / security gate

```bash
make fuzz
make invariant
npm run slither
```

### Formatting & Commits

- Pre-commit hook (`.husky/pre-commit`) runs `npm run lint-staged` (Prettier on staged `*.{json,md,sol,yml}`) and `npm test` (full Forge suite).
- Use Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, with optional `(app)` scope for frontend changes).
