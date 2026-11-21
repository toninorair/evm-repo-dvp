# Nordhaven Bank Steering Committee Decision Memo

**To:** Steering Committee & Executive Board, Nordhaven Bank  
**From:** Lead Forward Deployed Engineer (FDE), Ethereum Institutional (EI)  
**Date:** Q4 2026  
**Subject:** Project Titan: Tokenised Repurchase Agreements (DvP) on Ethereum — Recommendation Memo  
**Recommendation:** **GO WITH CONDITIONS** (Phased Production Pilot)

---

## 1. Executive Summary & Strategic Rationale

Nordhaven Bank has the opportunity to establish first-mover leadership in tokenised securities financing across the Eurozone. Traditional repo clearing via TARGET2-Securities and national Central Securities Depositories (CSDs) imposes rigid operating hours, T+1/T+2 settlement latency, and manual reconciliation overhead.

The prototype developed in Project Titan proves that **atomic Delivery-versus-Payment (DvP Model 1) on public Ethereum** is technically feasible, mathematically eliminates settlement failure risk, and enables 24/7 intraday liquidity optimization. However, enterprise deployment requires addressing specific legal, cash leg, and transaction privacy prerequisites.

We recommend **Go with Conditions**, proceeding to a gated institutional pilot.

---

## 2. Key Assessment Pillars

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        STEERING COMMITTEE EVALUATION MATRIX                            │
├─────────────────────┬─────────────────────────────────────┬────────────────────────────┤
│ PILLAR              │ REGULATORY / TECHNICAL ANALYSIS     │ NORDHAVEN POSITION         │
├─────────────────────┼─────────────────────────────────────┼────────────────────────────┤
│ 1. Legal Settlement │ EU Financial Collateral Directive   │ Enforceable escrow control │
│    Finality         │ (2002/47/EC), SFD & GMRA 2011 Annex │ & close-out netting        │
├─────────────────────┼─────────────────────────────────────┼────────────────────────────┤
│ 2. Cash Leg         │ Tokenised Commercial Bank Deposits  │ Zero MiCA stablecoin drag; │
│    Classification   │ (J.P. Morgan JPM Coin Model)        │ direct deposit liability   │
├─────────────────────┼─────────────────────────────────────┼────────────────────────────┤
│ 3. Privacy on       │ Private RPCs, Flashbots Protect,    │ Mitigates mempool MEV; L2  │
│    Public Ethereum  │ and Confidential ZK L2 Roadmap      │ required for post-trade ZK │
└─────────────────────┴─────────────────────────────────────┴────────────────────────────┘
```

### Pillar 1: Legal Enforceability & Settlement Finality

- **The Risk:** Under the **EU Financial Collateral Directive (Directive 2002/47/EC - FCD)** and the **Settlement Finality Directive (98/26/EC - SFD)**, an insolvency administrator could challenge on-chain collateral enforcement if locking tokens in a smart contract is not recognized as legally valid "possession or control," or because public Ethereum lacks a designated SFD system operator and relies on epoch-based finality (~12.8 minutes).
- **Our Architecture:** Upon `acceptRepo()`, `nhBOND NAV` tokens are locked in the autonomous `RepoDvP` escrow contract (dispossessing the borrower of unilateral control, equivalent to a tri-party **Security Financial Collateral Arrangement**), and `claimDefault()` enforces **close-out netting** (seizing only collateral worth `amountOwed` and returning `surplusCollateral` to the borrower).
- **What Must Be True to Proceed:** Counterparties must execute the **ICMA GMRA 2011** supplemented by the **GMRA Digital Assets Annex** (explicitly defining the Ethereum finalized block epoch as legal settlement finality and binding `proposeRepo` / `acceptRepo` to master confirmations), backed by an external legal opinion confirming FCD dispossession and close-out netting enforceability under German and French law.

### Pillar 2: Cash Leg Classification (Tokenised Deposit vs. Stablecoin vs. wCBDC)

- **The Risk:** Settling interbank sovereign repo in a third-party MiCA E-Money Token (EMT) stablecoin exposes Nordhaven to private stablecoin issuer credit risk, violates **CPMI-IOSCO PFMI Principle 9**, and disqualifies the cash leg from Level 1 HQLA treatment under CRR/Basel III. Conversely, a single-bank deposit token (`nhEUR`) introduces bilateral Nordhaven credit exposure for external bank lenders until wholesale Central Bank Money (wCBDC) is live 24/7.
- **Our Architecture:** We modeled `nhEUR` on **J.P. Morgan’s JPM Coin (`JPMD`)**—a permissioned 1:1 commercial bank deposit liability gated by the ERC-3643 `IdentityRegistry` and minted/burned strictly against RTGS/TARGET2 fiat references (`TREASURY_ROLE`).
- **What Must Be True to Proceed:** Phase 1 pilot trading must operate between Nordhaven entities and institutional clients/dealers maintaining Nordhaven correspondent deposit accounts (with capped bilateral exposure limits), while keeping the standard `IERC20` cash interface ready to plug into ECB Eurosystem wholesale DLT settlement rails (Trigger Solution / wCBDC) or multi-bank shared deposit networks (BIS Project Agorá).

### Pillar 3: Privacy on a Public Chain & Capital Treatment

- **The Risk:** While routing transactions through private RPC relays (**Flashbots Protect**) prevents pre-trade mempool front-running, **every mined transaction on public Ethereum L1 permanently exposes trade notionals, repo rates, maturities, and pseudonymous desk addresses on-chain**, risking market signaling of Nordhaven’s funding needs. Additionally, under **Basel III SCO60**, assets on permissionless chains risk punitive Group 2 capital charges unless Group 1b regulatory treatment is confirmed.
- **Our Architecture:** Counterparty wallets are separated from treasury accounts and gated by ERC-3643 `ONCHAINID` verification, keeping identity attributes off-chain while transactions route via private RPCs during the testnet and capped Phase 1 pilot.
- **What Must Be True to Proceed:** Phase 1 gross notional must be strictly capped (€250M) under regulatory sandbox notification (BaFin / CSSF), and full commercial scale must migrate the identical EVM contracts to an **Ethereum Layer-2 Confidential Validium / ZK-Rollup** that encrypts post-trade notionals and rates while anchoring state roots to Ethereum Mainnet.

---

## 3. Conditions for Full Commercial Launch

To mitigate operational, credit, and regulatory risk, we recommend proceeding under the following four mandatory conditions:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              PILOT GATE CONDITIONS                                     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  [ Gate 1: Security Audit ]                                                            │
│  - Independent dual smart contract security audits (e.g., Trail of Bits / OpenZeppelin)│
│  - Formal verification of RepoDvP escrow solvency invariants using Certora / Halmos   │
│                                                                                        │
│  [ Gate 2: Regulatory Sandbox & ECB Trial Participation ]                              │
│  - Formal notification to BaFin / CSSF under national distributed ledger legislation   │
│  - Enrollment in the Eurosystem exploratory trials for wholesale DLT settlement        │
│                                                                                        │
│  [ Gate 3: Legal Documentation & GMRA Annex ]                                          │
│  - Execution of bilateral GMRA 2011 Digital Assets Annex with initial pilot banks      │
│  - Legal opinion affirming FCD dispossession enforceability in Germany and France     │
│                                                                                        │
│  [ Gate 4: Risk Limits & Back-Office Integration ]                                     │
│  - Hard cap of €250,000,000 aggregate gross notional for Phase 1 pilot                 │
│  - Automated trade reconciliation into Murex / Calypso via JSON-RPC webhook bridges    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**Conclusion:** The tokenised repo prototype delivers decisive operational advantages over traditional market infrastructure. Approving **Go with Conditions** positions Nordhaven Bank at the forefront of digital asset securities financing in Europe.
