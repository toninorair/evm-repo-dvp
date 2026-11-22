import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  RepoStatus,
  WAD,
  closeOut,
  collateralValue,
  defaultReason,
  interest,
  interestFor,
  isOpen,
  margin,
  openingCollateral,
  repurchasePrice,
  requiredValue,
  same,
  unitsFor,
  type Repo,
} from '../src/lib/repo.ts'

const BORROWER = '0x1111111111111111111111111111111111111111' as const
const LENDER = '0x2222222222222222222222222222222222222222' as const

function makeRepo(overrides?: {
  status?: RepoStatus
  borrowAmount?: bigint
  repoRateBps?: number
  initialMarginBps?: number
  maintenanceMarginBps?: number
  termSeconds?: number
  curePeriodSeconds?: number
  startTime?: number
  maturity?: number
  collateralAmount?: bigint
  cureDeadline?: number
}): Repo {
  const startTime = overrides?.startTime ?? 1_000_000
  const termSeconds = overrides?.termSeconds ?? 86_400
  return {
    id: 1n,
    order: {
      borrower: BORROWER,
      lender: LENDER,
      borrowAmount: overrides?.borrowAmount ?? 1_000_000n * WAD,
      repoRateBps: overrides?.repoRateBps ?? 360, // 3.60% p.a. (Act/360 → 0.01% per day)
      initialMarginBps: overrides?.initialMarginBps ?? 200, // 2%
      maintenanceMarginBps: overrides?.maintenanceMarginBps ?? 100, // 1%
      termSeconds,
      curePeriodSeconds: overrides?.curePeriodSeconds ?? 3_600,
      acceptDeadline: startTime + 7_200,
      maxCollateralAmount: 20_000n * WAD,
    },
    state: {
      status: overrides?.status ?? RepoStatus.Active,
      startTime,
      maturity: overrides?.maturity ?? startTime + termSeconds,
      collateralAmount: overrides?.collateralAmount ?? 10_200n * WAD,
      cureDeadline: overrides?.cureDeadline ?? 0,
    },
    history: { txs: {} },
  }
}

describe('repo math & lifecycle helpers', () => {
  it('computes Actual/360 interest accurately and zeroes when closed', () => {
    const repo = makeRepo()
    // 1,000,000 EUR at 3.60% Act/360 for 1 day (86,400s) = 100 EUR
    assert.equal(interest(repo, repo.state.startTime + 86_400), 100n * WAD)
    assert.equal(interestFor(1_000_000n * WAD, 360, 86_400), 100n * WAD)
    assert.equal(repurchasePrice(repo, repo.state.startTime + 86_400), 1_000_100n * WAD)

    // Accrual continues past maturity while open
    assert.equal(interest(repo, repo.state.startTime + 2 * 86_400), 200n * WAD)

    // No interest when proposed or settled
    assert.equal(interest(makeRepo({ status: RepoStatus.Proposed }), repo.state.startTime + 86_400), 0n)
    assert.equal(interest(makeRepo({ status: RepoStatus.Settled }), repo.state.startTime + 86_400), 0n)
  })

  it('sizes opening collateral with ceiling division', () => {
    // Borrow 1,000,000 with 200 bps initial margin = 1,020,000 EUR required at €100 NAV = 10,200 units
    assert.equal(openingCollateral(1_000_000n * WAD, 200, 100_00000000n), 10_200n * WAD)
    // Zero price returns 0
    assert.equal(openingCollateral(1_000_000n * WAD, 200, 0n), 0n)
    // Non-divisible price rounds up by 1 wei
    const units = openingCollateral(100n * WAD, 0, 3_00000000n)
    assert.ok(collateralValue(units, 3_00000000n) >= 100n * WAD)
  })

  it('evaluates margin health, shortfall, headroom, and callPrice', () => {
    const repo = makeRepo({ collateralAmount: 10_200n * WAD })
    // At €100 NAV, value = €1,020,000; owed at startTime = €1,000,000; required (101%) = €1,010,000
    const healthy = margin(repo, 100_00000000n, repo.state.startTime)
    assert.equal(healthy.healthy, true)
    assert.equal(healthy.coverageBps, 10_200)
    assert.equal(healthy.thresholdBps, 10_100)
    assert.equal(healthy.headroom, 10_000n * WAD)
    assert.equal(healthy.shortfall, 0n)
    assert.equal(requiredValue(repo, repo.state.startTime), 1_010_000n * WAD)

    // At €98 NAV, value = €999,600 < €1,010,000 → unhealthy
    const under = margin(repo, 98_00000000n, repo.state.startTime)
    assert.equal(under.healthy, false)
    assert.equal(under.shortfall, 10_400n * WAD)
    assert.equal(under.headroom, 0n)
    // Top-up unitsFor covers the shortfall
    const topUpUnits = unitsFor(under.shortfall, 98_00000000n)
    assert.ok(collateralValue(repo.state.collateralAmount + topUpUnits, 98_00000000n) >= under.required)
  })

  it('computes close-out seizure, surplus, and shortfall', () => {
    const repo = makeRepo({ collateralAmount: 10_200n * WAD })
    // At €100 NAV, owed = €1,000,000 → 10,000 seized, 200 surplus, 0 shortfall
    const normal = closeOut(repo, 100_00000000n, repo.state.startTime)
    assert.equal(normal.seized, 10_000n * WAD)
    assert.equal(normal.surplus, 200n * WAD)
    assert.equal(normal.shortfall, 0n)

    // Deep drop to €50 NAV → collateral worth €510,000 < €1,000,000 → all seized, €490,000 shortfall
    const underwater = closeOut(repo, 50_00000000n, repo.state.startTime)
    assert.equal(underwater.seized, 10_200n * WAD)
    assert.equal(underwater.surplus, 0n)
    assert.equal(underwater.shortfall, 490_000n * WAD)
  })

  it('detects default reasons for cure expiry and maturity', () => {
    const repo = makeRepo({ status: RepoStatus.MarginCalled, cureDeadline: 1_005_000 })
    // Before cure deadline & before maturity → not defaultable
    assert.equal(defaultReason(repo, 95_00000000n, 1_004_000), undefined)
    // After cure deadline while unhealthy → 'cure'
    assert.equal(defaultReason(repo, 95_00000000n, 1_005_001), 'cure')
    // After cure deadline but NAV recovered (healthy) and before maturity → undefined
    assert.equal(defaultReason(repo, 105_00000000n, 1_005_001), undefined)
    // After maturity while active → 'maturity'
    assert.equal(defaultReason(makeRepo(), 105_00000000n, 1_086_401), 'maturity')
  })

  it('checks open statuses and case-insensitive address equality', () => {
    assert.equal(isOpen(RepoStatus.Active), true)
    assert.equal(isOpen(RepoStatus.MarginCalled), true)
    assert.equal(isOpen(RepoStatus.Proposed), false)
    assert.equal(isOpen(RepoStatus.Settled), false)

    assert.equal(same('0xAbCd', '0xabcd'), true)
    assert.equal(same('0xAbCd', undefined), false)
  })
})
