import { useEffect, useMemo, useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { AddressLink, Check, Empty, Gauge, Pill, Tween, TxLink, party } from '../components/ui'
import { backend } from '../lib/backend'
import { amount, bps, dateTime, duration, eur, price, tenor, time } from '../lib/format'
import {
  BPS,
  INTEREST_DENOMINATOR,
  RepoStatus,
  closeOut,
  collateralValue,
  defaultReason,
  interest,
  isOpen,
  margin,
  openingCollateral,
  repurchasePrice,
  same,
  unitsFor,
  type Repo,
} from '../lib/repo'
import { useLedger, useNow } from '../lib/store'

export function Position({ id }: { id: bigint }) {
  const { snapshot, account, tab, href } = useLedger()
  const now = useNow()
  const repo = snapshot?.repos.find((r) => r.id === id)

  if (!snapshot) return <Empty title="Loading position…" />
  if (!repo)
    return (
      <Empty title={`Repo #${String(id).padStart(4, '0')} not found`}>
        It may be older than the 200 most recent agreements, or the id is wrong. <a href={href('/')}>Back to positions</a>.
      </Empty>
    )

  const { oracle } = snapshot
  const s = repo.state.status
  const open = isOpen(s)
  const m = margin(repo, oracle.price, now)
  const isBorrower = same(account, repo.order.borrower)
  const isLender = same(account, repo.order.lender)
  const label = `#${String(repo.id).padStart(4, '0')}`
  const expired = s === RepoStatus.Proposed && now > repo.order.acceptDeadline
  const cureLeft = s === RepoStatus.MarginCalled ? repo.state.cureDeadline - now : 0
  const role = isBorrower ? 'You are the borrower' : isLender ? 'You are the lender' : account ? `This ${tab} wallet is not a party to this repo` : `Connect the ${tab} wallet to act`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      {s === RepoStatus.MarginCalled && (
        <div className="reveal" style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', padding: '14px 20px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--ink)' }}>
          <span>
            <strong style={{ fontWeight: 600 }}>Margin call on {label}.</strong>{' '}
            {cureLeft > 0
              ? now > repo.state.maturity
                ? 'Maturity has passed without repayment. The lender may close out.'
                : `The borrower has until ${time(repo.state.cureDeadline)} to top up or settle.`
              : !m.healthy
                ? 'The cure window has expired. The lender may close out.'
                : now > repo.state.maturity
                  ? 'Maturity has passed without repayment. The lender may close out.'
                  : 'The cure window has passed, but coverage is back above the threshold, so default cannot be claimed.'}
          </span>
          {repo.history.marginCalledValue !== undefined && <span>Collateral value at call {eur(repo.history.marginCalledValue)}</span>}
        </div>
      )}

      <section className="reveal" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a href={href('/')} className="small muted" style={{ textDecoration: 'none' }}>
            ← Positions
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <h1>Repo {label}</h1>
            <Pill status={s}>{expired ? 'Expired' : undefined}</Pill>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 15 }}>
            {party(repo.order.borrower, account)} {isBorrower ? 'borrow' : 'borrows'} {eur(repo.order.borrowAmount)} from {party(repo.order.lender, account)} against nhBOND · {tenor(repo.order.termSeconds)} at {bps(repo.order.repoRateBps)} · {role}
          </p>
        </div>
        {s === RepoStatus.MarginCalled && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <span className="eyebrow" style={{ color: 'var(--warn)' }}>
              Cure window remaining
            </span>
            <span className="figure tick" style={{ fontSize: 56, color: cureLeft > 0 ? 'var(--ink)' : 'var(--bad)' }}>
              {cureLeft > 0 ? duration(cureLeft) : 'Expired'}
            </span>
            <div aria-hidden="true" style={{ width: 240, height: 4, background: 'var(--track)', marginTop: 8 }}>
              <div style={{ height: 4, background: 'var(--warn-strong)', width: `${Math.max(0, Math.min(100, (1 - cureLeft / repo.order.curePeriodSeconds) * 100))}%`, transition: 'width 1s linear' }} />
            </div>
            <span className="small muted">
              of {duration(repo.order.curePeriodSeconds)} · deadline {time(repo.state.cureDeadline)}
            </span>
          </div>
        )}
      </section>

      <Lifecycle repo={repo} now={now} />

      <section className="split">
        <div className="main" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <Figures repo={repo} now={now} />
          {open && isBorrower && <TopUp repo={repo} />}
          <Legs repo={repo} now={now} />
          <Terms repo={repo} />
        </div>

        <aside className="side reveal d2" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {s === RepoStatus.Proposed && <AcceptPanel repo={repo} />}
          {open && <MarginPanel repo={repo} />}
          {open && <SettlePanel repo={repo} />}
          {open && <DefaultPanel repo={repo} />}
          {!open && s !== RepoStatus.Proposed && <Outcome repo={repo} />}
        </aside>
      </section>
    </div>
  )
}

/* ============ Main column ============ */

function Figures({ repo, now }: { repo: Repo; now: number }) {
  const { snapshot } = useLedger()
  const nav = snapshot!.oracle.price
  const s = repo.state.status
  const open = isOpen(s)
  const perSecond = Number(formatUnits((repo.order.borrowAmount * BigInt(repo.order.repoRateBps)) / INTEREST_DENOMINATOR, 18))
  const pastMaturity = open && now > repo.state.maturity
  const atMaturity = repo.order.borrowAmount + (repo.order.borrowAmount * BigInt(repo.order.repoRateBps) * BigInt(repo.order.termSeconds)) / INTEREST_DENOMINATOR
  const settled = repo.history.settled
  const owedAtDefault = repo.history.defaulted?.amountOwed
  const escrow = open ? repo.state.collateralAmount : s === RepoStatus.Proposed ? openingCollateral(repo.order.borrowAmount, repo.order.initialMarginBps, nav) : (settled?.collateralReturned ?? repo.history.defaulted?.seized ?? 0n)

  return (
    <div className="stats three reveal d1" style={{ borderTop: 0 }}>
      <div>
        <span className="small muted">{open ? 'Accrued interest · Act/360' : settled ? 'Interest paid' : owedAtDefault !== undefined ? 'Interest owed at default' : 'Interest to maturity'}</span>
        <span className="figure tick" style={{ fontSize: 32 }}>
          {eur(open ? interest(repo, now) : settled ? settled.totalRepaid - repo.order.borrowAmount : owedAtDefault !== undefined ? owedAtDefault - repo.order.borrowAmount : atMaturity - repo.order.borrowAmount)}
        </span>
        <span className="small muted">{open ? `+€${perSecond.toFixed(4)} / second${pastMaturity ? ' · past maturity' : ''}` : ' '}</span>
      </div>
      <div>
        <span className="small muted">{open ? 'Repurchase price if settled now' : settled ? 'Repaid' : owedAtDefault !== undefined ? 'Owed at close-out' : 'Repurchase price at maturity'}</span>
        <span className="figure tick" style={{ fontSize: 32 }}>
          {eur(open ? repurchasePrice(repo, now) : settled ? settled.totalRepaid : (owedAtDefault ?? atMaturity))}
        </span>
        <span className="small muted">At maturity {eur(atMaturity)}</span>
      </div>
      <div>
        <span className="small muted">{open ? 'Collateral in escrow' : s === RepoStatus.Proposed ? 'Collateral at today’s NAV' : s === RepoStatus.Settled ? 'Collateral returned' : s === RepoStatus.Defaulted ? 'Collateral seized' : 'Collateral'}</span>
        <span className="figure" style={{ fontSize: 32 }}>
          <Tween value={Number(formatUnits(escrow, 18))} format={(n) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })} />
        </span>
        <span className="small muted">
          nhBOND · {eur(collateralValue(escrow, nav))} at {price(nav)}
        </span>
      </div>
    </div>
  )
}

function Legs({ repo, now }: { repo: Repo; now: number }) {
  const { account } = useLedger()
  const s = repo.state.status
  const started = repo.state.startTime > 0
  const settled = repo.history.settled
  const defaulted = repo.history.defaulted
  const borrower = party(repo.order.borrower, account)
  const lender = party(repo.order.lender, account)
  const opened = repo.history.openedCollateral
  const leg = (from: string, to: string, value: string, last = false) => (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10, fontSize: 13 }}>
        <span>{from}</span>
        <span aria-hidden="true" className="muted">
          →
        </span>
        <span style={{ textAlign: 'right' }}>{to}</span>
      </div>
      <div style={{ fontSize: 13, paddingBottom: last ? 0 : 12, borderBottom: last ? 0 : '1px solid var(--line)' }}>{value}</div>
    </>
  )
  const box = (on: boolean) => ({ padding: 24, display: 'flex', flexDirection: 'column' as const, gap: 18, border: on ? undefined : '1px dashed var(--field)' })
  return (
    <div className="reveal d2" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2>Settlement Legs</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <div className={started ? 'panel' : ''} style={box(started)}>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <span style={{ fontWeight: 500 }}>Opening leg · DvP</span>
            <span className="small" style={{ color: started ? 'var(--ok)' : 'var(--muted)' }}>
              {started ? 'Settled' : s === RepoStatus.Cancelled ? 'Never opened' : 'On acceptance'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {leg(borrower, 'Escrow', opened !== undefined ? `${amount(opened, 4)} nhBOND` : 'Sized at the NAV on acceptance')}
            {leg(lender, borrower, `${amount(repo.order.borrowAmount)} nhEUR`, true)}
          </div>
          <div className="small muted">
            {started ? (
              <>
                One transaction · {dateTime(repo.state.startTime)} <TxLink hash={repo.history.txs.opened} />
              </>
            ) : (
              'Both legs settle in acceptRepo() or the call reverts.'
            )}
          </div>
        </div>
        <div className={settled || defaulted ? 'panel' : ''} style={box(!!(settled || defaulted))}>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <span style={{ fontWeight: 500 }}>{defaulted ? 'Close-out · default' : 'Closing leg · RvP'}</span>
            <span className="small" style={{ color: settled ? 'var(--ok)' : defaulted ? 'var(--bad)' : 'var(--muted)' }}>
              {settled ? 'Settled' : defaulted ? defaulted.reason : started ? `Due ${dateTime(repo.state.maturity)}` : 'Pending'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {defaulted ? (
              <>
                {leg('Escrow', lender, `${amount(defaulted.seized, 4)} nhBOND seized`)}
                {leg('Escrow', borrower, `${amount(defaulted.surplus, 4)} nhBOND surplus`, true)}
              </>
            ) : (
              <>
                {leg(borrower, lender, `${amount(settled ? settled.totalRepaid : isOpen(s) ? repurchasePrice(repo, now) : repo.order.borrowAmount)} nhEUR`)}
                {leg('Escrow', borrower, settled ? `${amount(settled.collateralReturned, 4)} nhBOND` : isOpen(s) ? `${amount(repo.state.collateralAmount, 4)} nhBOND` : 'All escrowed nhBOND', true)}
              </>
            )}
          </div>
          <div className="small muted">
            {settled || defaulted ? <TxLink hash={repo.history.txs.closed}>Transaction</TxLink> : 'The borrower may settle at any time; interest stops at the settlement second.'}
          </div>
        </div>
      </div>
    </div>
  )
}

function Terms({ repo }: { repo: Repo }) {
  const { account } = useLedger()
  const o = repo.order
  const rows: [string, React.ReactNode][] = [
    ['Borrower', <AddressLink address={o.borrower} me={account} />],
    ['Lender', <AddressLink address={o.lender} me={account} />],
    ['Borrow amount', `${amount(o.borrowAmount)} nhEUR`],
    ['Repo rate', `${o.repoRateBps} bps`],
    ['Initial margin', `${o.initialMarginBps} bps`],
    ['Maintenance margin', `${o.maintenanceMarginBps} bps`],
    ['Term', `${tenor(o.termSeconds)} · ${o.termSeconds.toLocaleString('en-US')} s`],
    ['Cure period', `${duration(o.curePeriodSeconds)} · ${o.curePeriodSeconds.toLocaleString('en-US')} s`],
    ['Accept by', dateTime(o.acceptDeadline)],
    ['Collateral cap', `${amount(o.maxCollateralAmount, 4)} nhBOND`],
  ]
  return (
    <div className="reveal d3" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2>Contract Terms</h2>
      <dl className="terms">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {repo.history.txs.proposed && (
        <span className="small muted">
          Proposed in <TxLink hash={repo.history.txs.proposed} />
        </span>
      )}
    </div>
  )
}

function TopUp({ repo }: { repo: Repo }) {
  const { snapshot, busy, run, checks } = useLedger()
  const now = useNow()
  const nav = snapshot!.oracle.price
  const m = margin(repo, nav, now)
  const target = (coverageBps: number) => {
    const needed = (m.owed * BigInt(coverageBps)) / BPS - m.value
    return needed > 0n ? unitsFor(needed, nav) : 0n
  }
  const toThreshold = target(m.thresholdBps + 1)
  const toInitial = target(10_000 + repo.order.initialMarginBps)
  const [input, setInput] = useState(() => (toThreshold > 0n ? formatUnits(toInitial, 18) : ''))
  const units = useMemo(() => {
    try {
      return input.trim() ? parseUnits(input.replace(/,/g, ''), 18) : 0n
    } catch {
      return 0n
    }
  }, [input])
  const after = margin({ ...repo, state: { ...repo.state, collateralAmount: repo.state.collateralAmount + units } }, nav, now)
  const free = checks ? checks.bondBalance - checks.bondFrozenTokens : undefined
  const short = free !== undefined && free < units
  const called = repo.state.status === RepoStatus.MarginCalled

  return (
    <div className="reveal d1" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2>{called ? 'Cure the margin call' : 'Top up collateral'}</h2>
      <div className="panel" style={{ borderColor: called ? 'var(--ink)' : undefined, padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="row" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500, fontSize: 15 }}>Post more nhBOND to escrow</span>
          <span className="small muted">topUpCollateral({String(repo.id)}, amount)</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label htmlFor="topup">nhBOND to post{free !== undefined ? ` · ${amount(free, 2)} available` : ''}</label>
            <input id="topup" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} style={{ fontSize: 18, height: 48, background: '#fff' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn quiet" style={{ minHeight: 48 }} disabled={toThreshold === 0n} onClick={() => setInput(formatUnits(toThreshold, 18))}>
              Minimum
            </button>
            <button type="button" className="btn quiet" style={{ minHeight: 48 }} disabled={toInitial === 0n} onClick={() => setInput(formatUnits(toInitial, 18))}>
              Back to {bps(10_000 + repo.order.initialMarginBps, 0)}
            </button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="small muted">New collateral value</span>
            <span style={{ fontSize: 15 }}>{eur(after.value)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="small muted">New coverage</span>
            <span style={{ fontSize: 15, color: after.healthy ? 'var(--ok)' : 'var(--bad)' }}>
              <Tween value={after.coverageBps} ms={300} format={(n) => bps(n)} />
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="small muted">Result</span>
            <span style={{ fontSize: 15, fontWeight: 500, color: after.healthy ? 'var(--ok)' : 'var(--bad)' }}>
              {after.healthy ? (called ? 'Clears the call → Active' : 'Above threshold') : `Still below ${bps(m.thresholdBps)}`}
            </span>
          </div>
        </div>
        {short && <span className="small" style={{ color: 'var(--bad)' }}>Your wallet holds less free nhBOND than this.</span>}
        <button type="button" className="btn primary block" style={{ minHeight: 48 }} disabled={busy || units <= 0n || short} onClick={() => run('Top-up', (st) => backend.topUp(repo, units, st))}>
          Approve and post {amount(units, 2)} nhBOND
        </button>
        <span className="small muted">The call clears in the same transaction once coverage is back above {bps(m.thresholdBps)}. The requirement creeps up as interest accrues.</span>
      </div>
    </div>
  )
}

/* ============ Sidebar panels ============ */

function AcceptPanel({ repo }: { repo: Repo }) {
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
    { label: 'Oracle has a NAV', ok: !snapshot!.oracle.invalid, fail: 'No NAV' },
    { label: 'Collateral within cap', ok: nav > 0n ? required <= repo.order.maxCollateralAmount : undefined, fail: 'Above cap', detail: `${amount(required, 2)} of ${amount(repo.order.maxCollateralAmount, 2)}` },
    { label: 'Borrower identity verified', ok: cp?.verified, fail: 'Not verified' },
    { label: 'Borrower free nhBOND balance', ok: cp ? cp.bondBalance >= required : undefined, fail: 'Insufficient' },
    { label: 'Borrower nhBOND approval', ok: cp ? cp.bondAllowance >= required : undefined, fail: 'Too low' },
  ]
  const ready = [...(isLender ? lenderChecks : []), ...tradeChecks].every((c) => c.ok !== false)

  return (
    <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3>{expired ? 'Proposal expired' : 'Awaiting the lender'}</h3>
      <p className="small muted" style={{ margin: 0 }}>
        On acceptance RepoDvP pulls {amount(required, 4)} nhBOND (at {price(nav)}) from the borrower into escrow and {eur(repo.order.borrowAmount)} from the lender to the borrower, atomically.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
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
        <>
          <button type="button" className="btn block" disabled={busy} onClick={() => run('Cancellation', (st) => backend.cancel(repo, st))}>
            Cancel proposal
          </button>
          <span className="small muted">Only {party(repo.order.lender)} can accept. They accept it from the Lender tab: {`${window.location.origin}${window.location.pathname}#/lender/repo/${repo.id}`}</span>
        </>
      )}
      {account && !isBorrower && !isLender && <span className="small muted">Only the named lender can accept, and only the borrower can cancel.</span>}
    </div>
  )
}

function MarginPanel({ repo }: { repo: Repo }) {
  const { snapshot, account, busy, run, connect } = useLedger()
  const now = useNow()
  const nav = snapshot!.oracle.price
  const m = margin(repo, nav, now)
  const canCall = repo.state.status === RepoStatus.Active && !m.healthy && !snapshot!.oracle.invalid
  return (
    <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3>Margin Health</h3>
        <span className="small" style={{ color: m.healthy ? 'var(--ok)' : 'var(--warn)' }}>
          {m.healthy ? 'Healthy' : 'Below threshold'}
        </span>
      </div>
      <div className="figure" style={{ fontSize: 48 }}>
        <Tween value={m.coverageBps} format={(n) => bps(n)} />
      </div>
      <div className="small muted">Collateral value ÷ repurchase price</div>
      <Gauge ratioBps={m.coverageBps} thresholdBps={m.thresholdBps} label={`Coverage ${bps(m.coverageBps)} against a ${bps(m.thresholdBps)} maintenance threshold`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
        <div className="row">
          <span className="muted">Collateral value</span>
          <span>{eur(m.value)}</span>
        </div>
        <div className="row">
          <span className="muted">Required ({bps(m.thresholdBps)})</span>
          <span className="tick">{eur(m.required)}</span>
        </div>
        <div className="row" style={{ paddingTop: 10, borderTop: '1px solid var(--line)', fontWeight: 500 }}>
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
          <span className="small muted">marginCall() is permissionless. It starts a {duration(repo.order.curePeriodSeconds)} cure window.</span>
        </>
      )}
    </div>
  )
}

function SettlePanel({ repo }: { repo: Repo }) {
  const { account, checks, busy, run } = useLedger()
  const now = useNow()
  if (!same(account, repo.order.borrower)) return null
  const owed = repurchasePrice(repo, now)
  const short = checks ? checks.cashBalance < owed : false
  return (
    <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontWeight: 500 }}>Repay and close · RvP</div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Pays <span className="tick">{eur(owed)}</span> nhEUR to the lender and releases all {amount(repo.state.collateralAmount, 2)} nhBOND to you in the same transaction.
      </p>
      {checks && (
        <span className="small" style={{ color: short ? 'var(--bad)' : 'var(--muted)' }}>
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

function DefaultPanel({ repo }: { repo: Repo }) {
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
    <div style={{ border: '1px solid var(--line)', padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontWeight: 500 }}>Lender remedy · close-out</div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        After a missed maturity or an expired, uncured margin call the lender seizes nhBOND worth the amount owed; any surplus goes back to the borrower.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
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
          <div className="row" style={{ color: 'var(--bad)' }}>
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

function Outcome({ repo }: { repo: Repo }) {
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
    <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3>Outcome</h3>
      {rows.map(([k, v]) => (
        <div key={k} className="row" style={{ fontSize: 13 }}>
          <span className="muted">{k}</span>
          <span>{v}</span>
        </div>
      ))}
      <span className="small">
        <TxLink hash={repo.history.txs.closed}>View transaction</TxLink>
      </span>
    </div>
  )
}

/* ============ Lifecycle strip ============ */

function Lifecycle({ repo, now }: { repo: Repo; now: number }) {
  const s = repo.state.status
  const started = repo.state.startTime > 0
  const closed = s >= RepoStatus.Settled
  const final =
    s === RepoStatus.Settled
      ? { t: 'Closed · RvP', d: 'Cash repaid, collateral released', cls: 'done' }
      : s === RepoStatus.Defaulted
        ? { t: 'Defaulted', d: 'Collateral closed out', cls: 'now bad' }
        : s === RepoStatus.Cancelled
          ? { t: 'Cancelled', d: 'Proposal withdrawn', cls: 'now bad' }
          : { t: 'Closed · RvP', d: 'Cash back, collateral released', cls: '' }
  const progress = started ? Math.min(100, Math.round(((now - repo.state.startTime) / repo.order.termSeconds) * 100)) : 0
  const steps = [
    { n: '01', t: 'Proposed', d: s === RepoStatus.Proposed ? `Accept by ${dateTime(repo.order.acceptDeadline)}` : 'proposeRepo()', cls: s === RepoStatus.Proposed ? (now > repo.order.acceptDeadline ? 'now bad' : 'now') : 'done' },
    { n: '02', t: 'Opened · DvP', d: started ? dateTime(repo.state.startTime) : 'On acceptance', cls: started ? 'done' : '' },
    {
      n: s === RepoStatus.MarginCalled ? '03 · now' : '03',
      t: s === RepoStatus.MarginCalled ? 'Margin called' : 'Accruing',
      d: started ? (closed ? 'Complete' : `${progress}% of term`) : 'Interest per second',
      cls: started ? (isOpen(s) ? `now ${s === RepoStatus.MarginCalled ? 'warn' : ''}` : 'done') : '',
    },
    { n: '04', t: 'Maturity', d: repo.state.maturity ? dateTime(repo.state.maturity) : `${tenor(repo.order.termSeconds)} after opening`, cls: closed && started ? 'done' : isOpen(s) && now > repo.state.maturity ? 'now bad' : '' },
    { n: '05', ...final },
  ]
  return (
    <section aria-label="Lifecycle" className="steps reveal d1" style={{ borderTopColor: 'var(--ink)' }}>
      {steps.map((st) => (
        <div key={st.n} className={st.cls}>
          <span className="small" style={{ color: st.cls.startsWith('now') ? undefined : 'var(--muted)' }}>
            {st.n}
          </span>
          <span style={{ fontWeight: 500 }}>{st.t}</span>
          <span className="small muted">{st.d}</span>
        </div>
      ))}
    </section>
  )
}
