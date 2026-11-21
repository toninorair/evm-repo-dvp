import type { Address, Hash } from 'viem'

/** Constants and formulas mirror src/RepoDvP.sol so the UI previews exactly what the contract computes. */
export const BPS = 10_000n
export const INTEREST_DENOMINATOR = 311_040_000_000n // 31,104,000 s (360-day year) × BPS
export const PRICE_PRECISION = 10n ** 8n
export const MAX_INITIAL_MARGIN_BPS = 5_000
export const MAX_TERM_SECONDS = 365 * 86_400
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

/** `orders(repoId)`: terms fixed at proposal. */
export type RepoOrder = {
  borrower: Address
  lender: Address
  borrowAmount: bigint
  repoRateBps: number
  initialMarginBps: number
  maintenanceMarginBps: number
  termSeconds: number
  curePeriodSeconds: number
  acceptDeadline: number
  maxCollateralAmount: bigint
}

/** `states(repoId)`: lifecycle state. `collateralAmount` is zeroed once escrow is released or seized. */
export type RepoState = {
  status: RepoStatus
  startTime: number
  maturity: number
  collateralAmount: bigint
  cureDeadline: number
}

/** Facts only recorded in events, filled in from the log history. */
export type RepoHistory = {
  openedCollateral?: bigint
  settled?: { totalRepaid: bigint; collateralReturned: bigint; at: number; tx?: Hash }
  defaulted?: { amountOwed: bigint; seized: bigint; surplus: bigint; reason: string; tx?: Hash }
  marginCalledValue?: bigint
  txs: Partial<Record<'proposed' | 'opened' | 'closed', Hash>>
}

export type Repo = { id: bigint; order: RepoOrder; state: RepoState; history: RepoHistory }

export const ZERO = '0x0000000000000000000000000000000000000000' as Address

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b

export const isOpen = (s: RepoStatus) => s === RepoStatus.Active || s === RepoStatus.MarginCalled

/** getRepoInterest(): accrues per second while Active or MarginCalled, and keeps accruing after maturity. */
export function interest(repo: Repo, now: number) {
  if (!isOpen(repo.state.status)) return 0n
  const elapsed = BigInt(Math.max(0, now - repo.state.startTime))
  return (repo.order.borrowAmount * BigInt(repo.order.repoRateBps) * elapsed) / INTEREST_DENOMINATOR
}

export function interestFor(cash: bigint, rateBps: number, seconds: number) {
  return (cash * BigInt(rateBps) * BigInt(Math.max(0, seconds))) / INTEREST_DENOMINATOR
}

/** getCurrentRepurchasePrice() */
export function repurchasePrice(repo: Repo, now: number) {
  return repo.order.borrowAmount + interest(repo, now)
}

/** getCollateralValue(): 18-dec units × 8-dec price ÷ 1e8 → 18-dec EUR. */
export function collateralValue(units: bigint, price: bigint) {
  return (units * price) / PRICE_PRECISION
}

/** acceptRepo() sizing: ceil(borrow × (1 + initial margin) ÷ price). */
export function openingCollateral(borrowAmount: bigint, initialMarginBps: number, price: bigint) {
  if (price <= 0n) return 0n
  const value = (borrowAmount * (BPS + BigInt(initialMarginBps))) / BPS
  return ceilDiv(value * PRICE_PRECISION, price)
}

/** getRequiredCollateralValue(): repurchase price × (1 + maintenance margin). */
export function requiredValue(repo: Repo, now: number) {
  return (repurchasePrice(repo, now) * (BPS + BigInt(repo.order.maintenanceMarginBps))) / BPS
}

/** Smallest unit count whose value clears `target` at `price`. */
export function unitsFor(target: bigint, price: bigint) {
  return price > 0n && target > 0n ? ceilDiv(target * PRICE_PRECISION, price) : 0n
}

/** isMarginHealthy() plus the figures the UI shows around it. */
export function margin(repo: Repo, price: bigint, now: number) {
  const units = repo.state.collateralAmount
  const value = collateralValue(units, price)
  const owed = repurchasePrice(repo, now)
  const required = requiredValue(repo, now)
  const healthy = value >= required
  return {
    value,
    owed,
    required,
    healthy,
    coverageBps: owed > 0n ? Number((value * BPS) / owed) : 0,
    thresholdBps: 10_000 + repo.order.maintenanceMarginBps,
    shortfall: healthy ? 0n : required - value,
    headroom: healthy ? value - required : 0n,
    /** NAV (8 decimals) below which a margin call becomes possible right now. */
    callPrice: units > 0n ? (required * PRICE_PRECISION) / units : 0n,
  }
}

/** claimDefault() close-out: the lender takes collateral worth what is owed, the rest goes back to the borrower. */
export function closeOut(repo: Repo, price: bigint, now: number) {
  const owed = repurchasePrice(repo, now)
  const units = repo.state.collateralAmount
  const needed = price > 0n ? ceilDiv(owed * PRICE_PRECISION, price) : units
  const seized = needed < units ? needed : units
  const value = collateralValue(units, price)
  return { owed, seized, surplus: units - seized, shortfall: value < owed ? owed - value : 0n }
}

/** Which remedy, if any, claimDefault() would accept right now. */
export function defaultReason(repo: Repo, price: bigint, now: number): 'maturity' | 'cure' | undefined {
  const s = repo.state.status
  if (s === RepoStatus.Active && now > repo.state.maturity) return 'maturity'
  if (s === RepoStatus.MarginCalled && now > repo.state.cureDeadline && !margin(repo, price, now).healthy) return 'cure'
  return undefined
}

export const statusLabel: Record<RepoStatus, string> = {
  [RepoStatus.None]: 'Unknown',
  [RepoStatus.Proposed]: 'Proposed',
  [RepoStatus.Active]: 'Active',
  [RepoStatus.MarginCalled]: 'Margin called',
  [RepoStatus.Settled]: 'Settled',
  [RepoStatus.Defaulted]: 'Defaulted',
  [RepoStatus.Cancelled]: 'Cancelled',
}

export const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
