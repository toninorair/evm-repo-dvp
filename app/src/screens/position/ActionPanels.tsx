import { useEffect, useState } from 'react'
import { Check, Gauge, Tween, TxLink } from '../../components/ui'
import { backend } from '../../lib/backend'
import { amount, bps, dateTime, duration, eur, price, time } from '../../lib/format'
import { RepoStatus, closeOut, defaultReason, margin, openingCollateral, repurchasePrice, same, type Repo } from '../../lib/repo'
import { useLedger, useNow } from '../../lib/store'

export function AcceptPanel({ repo }: { repo: Repo }) {
  const { snapshot, account, checks, busy, run, connect, tab } = useLedger()
  const now = useNow()
  const nav = snapshot!.oracle.price
  const isBorrower = same(account, repo.order.borrower)
  const isLender = same(account, repo.order.lender)
  const required = openingCollateral(repo.order.borrowAmount, repo.order.initialMarginBps, nav)
  const expired = now > repo.order.acceptDeadline
  const [cp, setCp] = useState<{ bondBalance: bigint; bondAllowance: bigint; verified: boolean }>()

  useEffect(() => {
    let live = true
    backend
      .counterparty(repo)
      .then((c) => live && setCp(c))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [repo, snapshot])

  const lenderChecks = [
    { label: 'Your identity · ERC-3643 registry', ok: checks?.verified, fail: 'Not verified' },
    { label: 'nhEUR balance', ok: checks ? checks.cashBalance >= repo.order.borrowAmount : undefined, fail: 'Insufficient', detail: checks ? eur(checks.cashBalance) : undefined },
    { label: 'nhEUR not frozen or paused', ok: checks ? !checks.cashFrozen && !checks.cashPaused : undefined, fail: 'Blocked' },
  ]
  const tradeChecks = [
    { label: 'Before the deadline', ok: !expired, fail: 'Expired', detail: dateTime(repo.order.acceptDeadline) },
    { label: 'Acceptable nhBOND NAV oracle value', ok: !snapshot!.oracle.invalid, fail: 'No NAV' },
    { label: 'Max collateral cap', ok: nav > 0n ? required <= repo.order.maxCollateralAmount : undefined, fail: 'Above cap', detail: `${amount(required, 4)} required / ${amount(repo.order.maxCollateralAmount, 4)} max` },
    { label: 'Borrower identity verified', ok: cp?.verified, fail: 'Not verified' },
    { label: 'Borrower free nhBOND balance', ok: cp ? cp.bondBalance >= required : undefined, fail: 'Insufficient' },
    { label: 'Borrower nhBOND approval', ok: cp ? cp.bondAllowance >= required : undefined, fail: 'Too low' },
  ]
  const ready = [...(isLender ? lenderChecks : []), ...tradeChecks].every((c) => c.ok !== false)

  return (
    <div className="panel panel-pad stack gap-4">
      <h3>{expired ? 'Proposal expired' : 'Awaiting the lender'}</h3>
      <div className="stack gap-2 small">
        {isLender && lenderChecks.map((c) => <Check key={c.label} {...c} />)}
        {tradeChecks.map((c) => (
          <Check key={c.label} {...c} />
        ))}
      </div>
      {!account && (
        <button type="button" className="btn primary block" onClick={connect}>
          Connect {tab} wallet
        </button>
      )}
      {isLender && (
        <button type="button" className="btn primary block" disabled={busy || !ready} onClick={() => run('Opening leg', (st) => backend.accept(repo, st))}>
          Approve nhEUR and accept · DvP
        </button>
      )}
      {isBorrower && (
        <button type="button" className="btn block" disabled={busy} onClick={() => run('Cancellation', (st) => backend.cancel(repo, st))}>
          Cancel proposal
        </button>
      )}
      {account && !isBorrower && !isLender && <span className="small muted">Only the named lender can accept, and only the borrower can cancel.</span>}
    </div>
  )
}

export function MarginPanel({ repo }: { repo: Repo }) {
  const { snapshot, account, busy, run, connect } = useLedger()
  const now = useNow()
  const nav = snapshot!.oracle.price
  const m = margin(repo, nav, now)
  const canCall = repo.state.status === RepoStatus.Active && !m.healthy && !snapshot!.oracle.invalid

  return (
    <div className="panel panel-pad stack gap-4">
      <div className="row row-baseline">
        <h3>Margin Health</h3>
        <span className={`small ${m.healthy ? 'text-ok' : 'text-warn'}`}>{m.healthy ? 'Healthy' : 'Below threshold'}</span>
      </div>
      <div className="figure fig-xl">
        <Tween value={m.coverageBps} format={(n) => bps(n)} />
      </div>
      <div className="small muted">Collateral value ÷ repurchase price</div>
      <Gauge ratioBps={m.coverageBps} thresholdBps={m.thresholdBps} label={`Coverage ${bps(m.coverageBps)} against a ${bps(m.thresholdBps)} maintenance threshold`} />
      <div className="stack gap-3" style={{ fontSize: 13 }}>
        <div className="row">
          <span className="muted">Collateral value</span>
          <span>{eur(m.value)}</span>
        </div>
        <div className="row">
          <span className="muted">Required ({bps(m.thresholdBps)})</span>
          <span className="tick">{eur(m.required)}</span>
        </div>
        <div className="row row-strong">
          <span>{m.healthy ? 'Headroom' : 'Shortfall now'}</span>
          <span className="tick">{eur(m.healthy ? m.headroom : m.shortfall)}</span>
        </div>
        <div className="row">
          <span className="muted">Callable when NAV falls below</span>
          <span>{price(m.callPrice)}</span>
        </div>
      </div>
      {repo.state.status === RepoStatus.Active && (
        <>
          <button type="button" className="btn block" disabled={busy || (!!account && !canCall)} onClick={() => (account ? run('Margin call', (st) => backend.marginCall(repo, st)) : connect())}>
            {m.healthy ? 'Margin call · not due' : 'Issue margin call'}
          </button>
          <span className="small muted">Margin calls are permissionless and start a {duration(repo.order.curePeriodSeconds)} cure window.</span>
        </>
      )}
    </div>
  )
}

export function SettlePanel({ repo }: { repo: Repo }) {
  const { account, checks, busy, run } = useLedger()
  const now = useNow()
  if (!same(account, repo.order.borrower)) return null
  const owed = repurchasePrice(repo, now)
  const short = checks ? checks.cashBalance < owed : false

  return (
    <div className="panel panel-pad stack gap-3">
      <div className="fw-500">Repay and close · RvP</div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Pays <span className="tick">{eur(owed)}</span> nhEUR to the lender and releases all {amount(repo.state.collateralAmount, 2)} nhBOND to you in the same transaction.
      </p>
      {checks && (
        <span className={`small ${short ? 'text-bad' : 'muted'}`}>
          Your nhEUR: {eur(checks.cashBalance)}
          {short ? ' · not enough to repay' : ''}
        </span>
      )}
      <button type="button" className="btn primary block" disabled={busy || short} onClick={() => run('Closing leg', (st) => backend.settle(repo, now, st))}>
        {now > repo.state.maturity ? 'Repay now · overdue' : 'Settle now'}
      </button>
      <span className="small muted">The approval covers an extra hour of accrual so the price can’t move past it before the block.</span>
    </div>
  )
}

export function DefaultPanel({ repo }: { repo: Repo }) {
  const { snapshot, account, busy, run } = useLedger()
  const now = useNow()
  const nav = snapshot!.oracle.price
  const reason = defaultReason(repo, nav, now)
  const isLender = same(account, repo.order.lender)
  const c = closeOut(repo, nav, now)
  const when =
    repo.state.status === RepoStatus.MarginCalled
      ? now > repo.state.cureDeadline
        ? `after maturity · ${dateTime(repo.state.maturity)} (or if coverage drops below threshold)`
        : `after ${time(repo.state.cureDeadline)} if still uncured`
      : `after maturity · ${dateTime(repo.state.maturity)}`

  return (
    <div className="panel panel-pad stack gap-3">
      <div className="fw-500">Lender remedy · close-out</div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        After a missed maturity or an expired, uncured margin call the lender seizes nhBOND worth the amount owed; any surplus goes back to the borrower.
      </p>
      <div className="stack gap-2" style={{ fontSize: 13 }}>
        <div className="row">
          <span className="muted">Owed now</span>
          <span className="tick">{eur(c.owed)}</span>
        </div>
        <div className="row">
          <span className="muted">Seized at {price(nav)}</span>
          <span>{amount(c.seized, 4)} nhBOND</span>
        </div>
        <div className="row">
          <span className="muted">Surplus to borrower</span>
          <span>{amount(c.surplus, 4)} nhBOND</span>
        </div>
        {c.shortfall > 0n && (
          <div className="row text-bad">
            <span>Uncovered shortfall</span>
            <span>{eur(c.shortfall)}</span>
          </div>
        )}
      </div>
      {isLender ? (
        <button type="button" className={`btn block ${reason ? 'danger' : ''}`} disabled={busy || !reason || snapshot!.oracle.invalid} onClick={() => run('Default close-out', (st) => backend.claimDefault(repo, st))}>
          {reason ? `Claim default · ${reason === 'maturity' ? 'maturity non-payment' : 'cure expired'}` : `Claim default · ${when}`}
        </button>
      ) : (
        <span className="small muted">{reason ? 'Default is claimable by the lender now.' : `Claimable by the lender ${when}.`}</span>
      )}
    </div>
  )
}

export function Outcome({ repo }: { repo: Repo }) {
  const s = repo.state.status
  const { settled, defaulted } = repo.history
  const rows: [string, string][] = settled
    ? [
        ['Principal', eur(repo.order.borrowAmount)],
        ['Interest', eur(settled.totalRepaid - repo.order.borrowAmount)],
        ['Total repaid', eur(settled.totalRepaid)],
        ['Collateral returned', `${amount(settled.collateralReturned, 4)} nhBOND`],
        ['Settled at', dateTime(settled.at)],
      ]
    : defaulted
      ? [
          ['Reason', defaulted.reason],
          ['Amount owed', eur(defaulted.amountOwed)],
          ['Seized by lender', `${amount(defaulted.seized, 4)} nhBOND`],
          ['Returned to borrower', `${amount(defaulted.surplus, 4)} nhBOND`],
        ]
      : s === RepoStatus.Cancelled
        ? [['Status', 'Withdrawn by the borrower before acceptance']]
        : [['Status', 'Settlement details are still loading from event history']]

  return (
    <div className="panel panel-pad stack gap-4">
      <h3>Outcome</h3>
      {rows.map(([k, v]) => (
        <div key={k} className="row" style={{ fontSize: 13 }}>
          <span className="muted">{k}</span>
          <span>{v}</span>
        </div>
      ))}
      <span className="small">
        <TxLink hash={repo.history.txs.closed}>View Transaction</TxLink>
      </span>
    </div>
  )
}
