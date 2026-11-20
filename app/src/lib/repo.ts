import type { Address } from 'viem'

/** Values mirror RepoDvP.sol so the UI previews exactly what the contract will compute. */
export const BPS = 10_000n
export const INTEREST_DENOMINATOR = 311_040_000_000n // BPS * 31,104,000 s (360-day year)
export const MAX_HAIRCUT_BPS = 5_000
export const MAX_TENOR_SECONDS = 365 * 86_400
export const PRICE_DECIMALS = 8n
export const WAD = 10n ** 18n

export enum RepoStatus {
  None,
  Proposed,
  Active,
  MarginCalled,
  Settled,
  Defaulted,
  Cancelled,
}

export type RepoTerms = {
  borrower: Address
  lender: Address
  collateralToken: Address
  cashToken: Address
  collateralAmount: bigint
  cashAmount: bigint
  repoRateBps: number
  haircutBps: number
  tenorSeconds: number
}

export type RepoState = {
  status: RepoStatus
  startTime: number
  maturity: number
  cureDeadline: number
  principalRepaid: bigint
  interestRepaid: bigint
  collateralReturned: bigint
  deficitAmount: bigint
}

export type Repo = { id: bigint; terms: RepoTerms; state: RepoState }

export type RiskParams = { maintenanceMarginBps: number; curePeriodSeconds: number }

export const ZERO = '0x0000000000000000000000000000000000000000' as Address

/** calculateRepurchasePrice(), evaluated client-side at `now` (unix seconds) so it can tick live. */
export function repurchasePrice(repo: Repo, now: number) {
  const { terms, state } = repo
  const principal = terms.cashAmount
  let interest: bigint
  if (state.status === RepoStatus.Proposed || state.status === RepoStatus.None || state.status === RepoStatus.Cancelled) {
    interest = (principal * BigInt(terms.repoRateBps) * BigInt(terms.tenorSeconds)) / INTEREST_DENOMINATOR
  } else if (state.status === RepoStatus.Settled) {
    interest = state.interestRepaid
  } else {
    let elapsed = Math.max(0, now - state.startTime)
    if (elapsed > terms.tenorSeconds) elapsed = terms.tenorSeconds
    interest = (principal * BigInt(terms.repoRateBps) * BigInt(elapsed)) / INTEREST_DENOMINATOR
  }
  return { principal, interest, total: principal + interest }
}

/** Repurchase price at full tenor: the most the closing leg can ever cost. */
export function maxRepurchasePrice(terms: RepoTerms) {
  return terms.cashAmount + (terms.cashAmount * BigInt(terms.repoRateBps) * BigInt(terms.tenorSeconds)) / INTEREST_DENOMINATOR
}

export function interestFor(cash: bigint, rateBps: number, seconds: number) {
  return (cash * BigInt(rateBps) * BigInt(seconds)) / INTEREST_DENOMINATOR
}

/** getCollateralValue(): 18-dec units × 8-dec price ÷ 1e8 → 18-dec EUR. */
export function collateralValue(units: bigint, price: bigint) {
  return (units * price) / 10n ** PRICE_DECIMALS
}

/** _executeOpeningLeg() minimum: cash ÷ (1 − haircut). */
export function requiredOpeningValue(cash: bigint, haircutBps: number) {
  return (cash * BPS) / (BPS - BigInt(haircutBps))
}

/** Smallest unit count whose value clears `target` at `price`. */
export function unitsFor(target: bigint, price: bigint) {
  if (price <= 0n) return 0n
  const scaled = target * 10n ** PRICE_DECIMALS
  return (scaled + price - 1n) / price
}

/** checkMarginStatus() */
export function marginStatus(repo: Repo, price: bigint, now: number, risk: RiskParams) {
  const value = collateralValue(repo.terms.collateralAmount, price)
  const { total } = repurchasePrice(repo, now)
  if (total === 0n) return { value, total, required: 0n, ratioBps: Number(BPS), healthy: true, deficit: 0n, headroom: value }
  const ratioBps = Number((value * BPS) / total)
  const required = (total * (BPS + BigInt(risk.maintenanceMarginBps))) / BPS
  const healthy = value >= required
  return {
    value,
    total,
    required,
    ratioBps,
    healthy,
    deficit: healthy ? 0n : required - value,
    headroom: healthy ? value - required : 0n,
  }
}

/** NAV at which a margin call becomes possible, 8 decimals. */
export function callPrice(repo: Repo, now: number, risk: RiskParams) {
  const { total } = repurchasePrice(repo, now)
  const required = (total * (BPS + BigInt(risk.maintenanceMarginBps))) / BPS
  if (repo.terms.collateralAmount === 0n) return 0n
  return (required * 10n ** PRICE_DECIMALS) / repo.terms.collateralAmount
}

export const isOpen = (s: RepoStatus) => s === RepoStatus.Active || s === RepoStatus.MarginCalled

export const statusLabel: Record<RepoStatus, string> = {
  [RepoStatus.None]: 'Unknown',
  [RepoStatus.Proposed]: 'Proposed',
  [RepoStatus.Active]: 'Active',
  [RepoStatus.MarginCalled]: 'Margin called',
  [RepoStatus.Settled]: 'Settled',
  [RepoStatus.Defaulted]: 'Defaulted',
  [RepoStatus.Cancelled]: 'Cancelled',
}
