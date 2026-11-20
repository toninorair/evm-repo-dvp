import { useMemo, useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { Empty, Gauge, Pill, Tween, party } from '../components/ui'
import { backend } from '../lib/backend'
import { explorer } from '../lib/config'
import { amount, bps, date, dateTime, duration, eur, price, shortAddr, tenor, time } from '../lib/format'
import {
  BPS,
  INTEREST_DENOMINATOR,
  RepoStatus,
  ZERO,
  callPrice,
  collateralValue,
  isOpen,
  marginStatus,
  maxRepurchasePrice,
  repurchasePrice,
  unitsFor,
  WAD,
  type Repo,
} from '../lib/repo'
import { useLedger, useNow } from '../lib/store'

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export function Position({ id }: { id: bigint }) {
  const { snapshot, account, checks, busy, run, connect } = useLedger()
  const now = useNow()
  const repo = snapshot?.repos.find((r) => r.id === id)

  if (!snapshot) return <Empty title="Loading position…" />
  if (!repo) return <Empty title={`Repo #${String(id).padStart(4, '0')} not found`}>It may be older than the 100 most recent agreements, or the id is wrong. <a href="#/">Back to the repo book</a>.</Empty>

  const { oracle, risk } = snapshot
  const s = repo.state.status
  const open = isOpen(s)
  const m = marginStatus(repo, oracle.price, now, risk)
  const rp = repurchasePrice(repo, now)
  const perSecond = Number(formatUnits((repo.terms.cashAmount * BigInt(repo.terms.repoRateBps)) / INTEREST_DENOMINATOR, 18))
  const isBorrower = same(account, repo.terms.borrower)
  const isLender = same(account, repo.terms.lender)
  const thresholdBps = 10_000 + risk.maintenanceMarginBps
  const pastMaturity = open && now > repo.state.maturity
  const cureLeft = s === RepoStatus.MarginCalled ? repo.state.cureDeadline - now : 0
  const defaultable = open && (pastMaturity || (s === RepoStatus.MarginCalled && cureLeft < 0))
  const label = `#${String(repo.id).padStart(4, '0')}`

  const act = (name: string, fn: (step: (t: string) => void) => Promise<unknown>) => (account ? run(name, fn) : connect())

  const who = (a: string) => (a === ZERO ? 'any verified desk' : party(a as typeof repo.terms.borrower, account))
  const b = who(repo.terms.borrower)
  const verb = b === 'You' ? 'borrow' : 'borrows'
  const subtitle =
    repo.terms.borrower === ZERO
      ? `${who(repo.terms.lender)} ${who(repo.terms.lender) === 'You' ? 'offer' : 'offers'} cash to any verified borrower against nhBOND · ${tenor(repo.terms.tenorSeconds)} at ${bps(repo.terms.repoRateBps)} · haircut ${bps(repo.terms.haircutBps)}`
      : `${b} ${verb} from ${who(repo.terms.lender)} against nhBOND · ${tenor(repo.terms.tenorSeconds)} at ${bps(repo.terms.repoRateBps)} · haircut ${bps(repo.terms.haircutBps)}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      {s === RepoStatus.MarginCalled && (
        <div className="reveal" style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', padding: '14px 20px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, fontSize: 13, color: '#4f3400' }}>
          <span>
            <strong style={{ fontWeight: 600 }}>Margin call on {label}.</strong>{' '}
            {cureLeft > 0 ? `Cure by ${time(repo.state.cureDeadline)} or the lender may seize all escrowed collateral.` : 'The cure window has expired. The lender may now claim default.'}
          </span>
          <span>Deficit at call {eur(repo.state.deficitAmount)}</span>
        </div>
      )}

      <section className="reveal" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a href="#/" className="small muted" style={{ textDecoration: 'none' }}>
            ← Repo book
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <h1>{s === RepoStatus.MarginCalled ? 'Restore the margin.' : `Repo ${label}`}</h1>
            <Pill status={s} />
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 15 }}>
            {s === RepoStatus.MarginCalled ? `${label} · ` : ''}
            {subtitle}
          </p>
        </div>
        {s === RepoStatus.MarginCalled ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <span className="eyebrow" style={{ color: 'var(--warn)' }}>
              Cure window remaining
            </span>
            <span className="figure tick" style={{ fontSize: 56, color: cureLeft > 0 ? 'var(--ink)' : 'var(--bad)' }}>
              {cureLeft > 0 ? duration(cureLeft) : 'Expired'}
            </span>
            <div aria-hidden="true" style={{ width: 240, height: 4, background: 'var(--track)', marginTop: 8 }}>
              <div style={{ height: 4, background: 'var(--warn-strong)', width: `${Math.max(0, Math.min(100, (1 - cureLeft / risk.curePeriodSeconds) * 100))}%`, transition: 'width 1s linear' }} />
            </div>
            <span className="small muted">
              of {duration(risk.curePeriodSeconds)} · deadline {time(repo.state.cureDeadline)}
            </span>
          </div>
        ) : (
          <Actions />
        )}
      </section>

      <Lifecycle repo={repo} now={now} />

      <section className="split">
        <div className="main" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div className="stats three reveal d1" style={{ borderTop: 0 }}>
            <div>
              <span className="small muted">{s === RepoStatus.Settled ? 'Interest paid' : open ? 'Accrued interest · Act/360' : 'Interest at full tenor'}</span>
              <span className="figure tick" style={{ fontSize: 32 }}>
                {eur(rp.interest)}
              </span>
              <span className="small muted">{open && !pastMaturity ? `+€${perSecond.toFixed(4)} / second` : open ? 'Accrual capped at maturity' : ' '}</span>
            </div>
            <div>
              <span className="small muted">{open ? 'Repurchase price if settled now' : s === RepoStatus.Settled ? 'Repaid' : 'Repurchase price'}</span>
              <span className="figure tick" style={{ fontSize: 32 }}>
                {eur(rp.total)}
              </span>
              <span className="small muted">At maturity {eur(maxRepurchasePrice(repo.terms))}</span>
            </div>
            <div>
              <span className="small muted">{s === RepoStatus.Defaulted ? 'Collateral seized' : 'Collateral in escrow'}</span>
              <span className="figure" style={{ fontSize: 32 }}>
                {repo.terms.collateralAmount || repo.state.collateralReturned ? (
                  <Tween value={Number(formatUnits(repo.terms.collateralAmount || repo.state.collateralReturned, 18))} format={(n) => Math.round(n).toLocaleString('en-US')} />
                ) : (
                  'Full escrow'
                )}
              </span>
              <span className="small muted">
                {open || s === RepoStatus.Proposed ? `nhBOND · ${eur(collateralValue(repo.terms.collateralAmount, oracle.price))} at ${price(oracle.price)}` : s === RepoStatus.Settled ? 'nhBOND returned to borrower' : 'Delivered to the lender'}
              </span>
            </div>
          </div>

          {s === RepoStatus.MarginCalled && <Cure repo={repo} />}

          <Legs repo={repo} now={now} />

          <div className="reveal d3" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2>Contract terms</h2>
            <dl className="terms">
              {[
                ['Borrower', repo.terms.borrower === ZERO ? 'Open' : shortAddr(repo.terms.borrower)],
                ['Lender', repo.terms.lender === ZERO ? 'Open' : shortAddr(repo.terms.lender)],
                ['Repo rate', `${repo.terms.repoRateBps} bps`],
                ['Collateral token · ERC-3643', `nhBOND ${shortAddr(repo.terms.collateralToken)}`],
                ['Cash token · deposit', `nhEUR ${shortAddr(repo.terms.cashToken)}`],
                ['Haircut', `${repo.terms.haircutBps} bps`],
                ['Tenor', `${repo.terms.tenorSeconds.toLocaleString('en-US')} s`],
                ['Cure period', `${risk.curePeriodSeconds.toLocaleString('en-US')} s`],
                ['Maintenance margin', `${risk.maintenanceMarginBps} bps`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <aside className="side reveal d2" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {open ? (
            <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="row" style={{ alignItems: 'baseline' }}>
                <h3>Margin health</h3>
                <span className="small" style={{ color: m.healthy ? 'var(--ok)' : 'var(--warn)' }}>
                  {m.healthy ? 'Healthy' : 'Below threshold'}
                </span>
              </div>
              <div className="figure" style={{ fontSize: 48 }}>
                <Tween value={m.ratioBps} format={(n) => bps(n)} />
              </div>
              <div className="small muted">Collateral value ÷ repurchase price</div>
              <Gauge ratioBps={m.ratioBps} thresholdBps={thresholdBps} label={`Coverage ${bps(m.ratioBps)} against a ${bps(thresholdBps)} maintenance threshold`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                <div className="row">
                  <span className="muted">Collateral value</span>
                  <span>{eur(m.value)}</span>
                </div>
                <div className="row">
                  <span className="muted">Required ({bps(thresholdBps)})</span>
                  <span className="tick">{eur(m.required)}</span>
                </div>
                <div className="row" style={{ paddingTop: 10, borderTop: '1px solid var(--line)', fontWeight: 500 }}>
                  <span>{m.healthy ? 'Headroom' : 'Shortfall now'}</span>
                  <span className="tick">{eur(m.healthy ? m.headroom : m.deficit)}</span>
                </div>
                <div className="row">
                  <span className="muted">NAV at which a call is possible</span>
                  <span>{price(callPrice(repo, now, risk))}</span>
                </div>
              </div>
              {!m.healthy && s === RepoStatus.Active && (
                <button type="button" className="btn block" disabled={busy} onClick={() => act('Margin call', (st) => backend.triggerMarginCall(repo, st))}>
                  Trigger margin call
                </button>
              )}
            </div>
          ) : (
            <Outcome repo={repo} />
          )}

          {open && (
            <div style={{ border: '1px solid var(--line)', padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontWeight: 500 }}>Lender remedies</div>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                The lender can claim default and take the full escrow only after a missed maturity or an expired margin cure.
              </p>
              <button
                type="button"
                className={`btn block ${defaultable ? 'danger' : ''}`}
                disabled={busy || !defaultable || (!!account && !isLender)}
                onClick={() => act('Default claim', (st) => backend.claimDefault(repo, st))}
              >
                {defaultable
                  ? isLender || !account
                    ? 'Claim default'
                    : 'Claim default · lender only'
                  : `Claim default · after ${s === RepoStatus.MarginCalled ? time(repo.state.cureDeadline) : dateTime(repo.state.maturity)}`}
              </button>
            </div>
          )}
          {isBorrower && checks && open && (
            <p className="small muted" style={{ margin: 0 }}>
              Your wallet: {amount(checks.bondBalance, 0)} nhBOND · {eur(checks.cashBalance)} nhEUR
            </p>
          )}
        </aside>
      </section>
    </div>
  )

  function Actions() {
    if (s === RepoStatus.Proposed) {
      const open = repo!.terms.borrower === ZERO || repo!.terms.lender === ZERO
      const proposer = open ? (repo!.terms.borrower === ZERO ? repo!.terms.lender : repo!.terms.borrower) : undefined
      const iAmProposer = same(account, proposer)
      const canAccept = !account || (open ? !iAmProposer : isBorrower || isLender)
      const canCancel = isBorrower || isLender
      return (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {canCancel && (
            <button type="button" className="btn" disabled={busy} onClick={() => act('Cancellation', (st) => backend.cancel(repo!, st))}>
              Cancel proposal
            </button>
          )}
          {canAccept && (
            <button type="button" className="btn primary" disabled={busy} onClick={() => act('Opening leg', (st) => backend.accept(repo!, st))}>
              Accept and settle DvP
            </button>
          )}
        </div>
      )
    }
    if (open && (isBorrower || !account)) {
      return (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" disabled={busy} onClick={() => act('Closing leg', (st) => backend.settle(repo!, st))}>
            {pastMaturity ? 'Repay · RvP' : 'Settle now · RvP'}
          </button>
        </div>
      )
    }
    return null
  }
}

function Lifecycle({ repo, now }: { repo: Repo; now: number }) {
  const s = repo.state.status
  const started = repo.state.startTime > 0
  const day = started ? Math.min(Math.ceil((now - repo.state.startTime) / 86_400), Math.ceil(repo.terms.tenorSeconds / 86_400)) : 0
  const totalDays = Math.max(1, Math.ceil(repo.terms.tenorSeconds / 86_400))
  const closed = s >= RepoStatus.Settled
  const final =
    s === RepoStatus.Settled
      ? { t: 'Closed · RvP', d: 'Cash repaid, collateral released', cls: 'done' }
      : s === RepoStatus.Defaulted
        ? { t: 'Defaulted', d: 'Escrow seized by lender', cls: 'now bad' }
        : s === RepoStatus.Cancelled
          ? { t: 'Cancelled', d: 'Proposal withdrawn', cls: 'now bad' }
          : { t: 'Closed · RvP', d: 'Cash back, collateral released', cls: '' }
  const steps = [
    { n: '01', t: 'Proposed', d: 'proposeRepo()', cls: s === RepoStatus.Proposed ? 'now' : 'done' },
    { n: '02', t: 'Opened · DvP', d: started ? dateTime(repo.state.startTime) : 'On acceptance', cls: started ? 'done' : '' },
    {
      n: s === RepoStatus.MarginCalled ? '03 · now' : '03',
      t: s === RepoStatus.MarginCalled ? 'Margin called' : 'Accruing',
      d: started ? (closed ? 'Complete' : `Day ${day} of ${totalDays}`) : 'Interest per second',
      cls: started ? (isOpen(s) ? `now ${s === RepoStatus.MarginCalled ? 'warn' : ''}` : 'done') : '',
    },
    { n: '04', t: 'Maturity', d: repo.state.maturity ? dateTime(repo.state.maturity) : `${tenor(repo.terms.tenorSeconds)} after opening`, cls: closed && s !== RepoStatus.Cancelled ? 'done' : isOpen(s) && now > repo.state.maturity ? 'now bad' : '' },
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

function Legs({ repo, now }: { repo: Repo; now: number }) {
  const s = repo.state.status
  const started = repo.state.startTime > 0
  const closedOk = s === RepoStatus.Settled
  const borrower = party(repo.terms.borrower)
  const lender = party(repo.terms.lender)
  const unitsRaw = repo.terms.collateralAmount || repo.state.collateralReturned
  const unitsText = unitsRaw ? `${amount(unitsRaw)} nhBOND` : 'Full escrow'
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
  return (
    <div className="reveal d2" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2>Settlement legs</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <div className={started ? 'panel' : ''} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18, border: started ? undefined : '1px dashed #b8b1a3' }}>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <span style={{ fontWeight: 500 }}>Opening leg · DvP</span>
            <span className="small" style={{ color: started ? 'var(--ok)' : 'var(--muted)' }}>
              {started ? 'Settled' : 'On acceptance'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {leg(borrower, 'Escrow', unitsText)}
            {leg(lender, borrower, `${amount(repo.terms.cashAmount)} nhEUR`, true)}
          </div>
          <div className="small muted">{started ? `One transaction · ${dateTime(repo.state.startTime)}` : 'Both legs settle in acceptRepo() or the call reverts.'}</div>
        </div>
        <div className={closedOk ? 'panel' : ''} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18, border: closedOk ? undefined : '1px dashed #b8b1a3' }}>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <span style={{ fontWeight: 500 }}>Closing leg · RvP</span>
            <span className="small" style={{ color: closedOk ? 'var(--ok)' : s === RepoStatus.Defaulted ? 'var(--bad)' : 'var(--muted)' }}>
              {closedOk ? 'Settled' : s === RepoStatus.Defaulted ? 'Replaced by close-out' : started ? `Due ${date(repo.state.maturity)}` : 'Pending'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {leg(borrower, lender, `${amount(closedOk ? repo.state.principalRepaid + repo.state.interestRepaid : isOpen(s) ? repurchasePrice(repo, now).total : maxRepurchasePrice(repo.terms))} nhEUR`)}
            {s === RepoStatus.Defaulted ? leg('Escrow', lender, `${unitsText} seized`, true) : leg('Escrow', borrower, unitsText, true)}
          </div>
          <div className="small muted">The borrower may settle early; interest stops at the settlement second.</div>
        </div>
      </div>
    </div>
  )
}

function Cure({ repo }: { repo: Repo }) {
  const { snapshot, account, busy, run, connect, checks } = useLedger()
  const now = useNow()
  const nav = snapshot!.oracle.price
  const risk = snapshot!.risk
  const isBorrower = same(account, repo.terms.borrower)
  const rp = repurchasePrice(repo, now)
  const target = (pctBps: number) => {
    const needed = (rp.total * BigInt(pctBps)) / BPS - collateralValue(repo.terms.collateralAmount, nav)
    const u = needed > 0n ? unitsFor(needed, nav) : 0n
    return ((u + WAD - 1n) / WAD) * WAD
  }
  const minUnits = target(10_000 + risk.maintenanceMarginBps)
  const [input, setInput] = useState<string>(() => formatUnits(target(10_500), 18))

  const units = useMemo(() => {
    try {
      return input.trim() ? parseUnits(input.replace(/,/g, ''), 18) : 0n
    } catch {
      return 0n
    }
  }, [input])
  const after = marginStatus({ ...repo, terms: { ...repo.terms, collateralAmount: repo.terms.collateralAmount + units } }, nav, now, risk)
  const short = checks ? checks.bondBalance < units : false

  return (
    <div className="reveal d1" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2>Choose a cure</h2>
      <div className="panel" style={{ borderColor: 'var(--ink)', padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="row" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500, fontSize: 15 }}>Top up collateral</span>
          <span className="small muted">topUpCollateral({String(repo.id)}, amount)</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label htmlFor="topup">nhBOND to post{checks ? ` · wallet balance ${amount(checks.bondBalance, 0)}` : ''}</label>
            <input id="topup" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} style={{ fontSize: 18, height: 48, background: '#fff' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn quiet" style={{ minHeight: 48 }} onClick={() => setInput(formatUnits(minUnits, 18))}>
              Minimum
            </button>
            <button type="button" className="btn quiet" style={{ minHeight: 48 }} onClick={() => setInput(formatUnits(target(10_500), 18))}>
              Back to 105%
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
              <Tween value={after.ratioBps} ms={300} format={(n) => bps(n)} />
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="small muted">Result</span>
            <span style={{ fontSize: 15, fontWeight: 500, color: after.healthy ? 'var(--ok)' : 'var(--bad)' }}>{after.healthy ? 'Cures call → Active' : `Still below ${bps(10_000 + risk.maintenanceMarginBps)}`}</span>
          </div>
        </div>
        {short && <span className="small" style={{ color: 'var(--bad)' }}>Your wallet holds less nhBOND than this.</span>}
        <button
          type="button"
          className="btn primary block"
          style={{ minHeight: 48 }}
          disabled={busy || units <= 0n || (!!account && !isBorrower) || short}
          onClick={() => (account ? run('Top-up', (st) => backend.topUp(repo, units, st)) : connect())}
        >
          {!account ? 'Connect wallet' : isBorrower ? `Post ${amount(units, 0)} nhBOND to escrow` : 'Only the borrower can top up'}
        </button>
        <span className="small muted">Minimum now: {amount(minUnits, 0)} nhBOND at {price(nav)}. The deficit grows slowly as interest accrues.</span>
      </div>

      <div style={{ border: '1px solid var(--line)', padding: 28, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 480 }}>
          <span style={{ fontWeight: 500, fontSize: 15 }}>Repay and close · RvP</span>
          <span className="small muted">
            Allowed while margin-called. Pays {eur(rp.total)} nhEUR to the lender and releases all {amount(repo.terms.collateralAmount, 0)} nhBOND in the same transaction.
          </span>
        </div>
        <button type="button" className="btn" disabled={busy || (!!account && !isBorrower)} onClick={() => (account ? run('Closing leg', (st) => backend.settle(repo, st)) : connect())}>
          Settle early
        </button>
      </div>
    </div>
  )
}

function Outcome({ repo }: { repo: Repo }) {
  const s = repo.state.status
  const rows: [string, string][] =
    s === RepoStatus.Settled
      ? [
          ['Principal repaid', eur(repo.state.principalRepaid)],
          ['Interest repaid', eur(repo.state.interestRepaid)],
          ['Collateral returned', `${amount(repo.state.collateralReturned, 0)} nhBOND`],
        ]
      : s === RepoStatus.Defaulted
        ? [
            ['Cash outstanding', eur(repo.terms.cashAmount)],
            ['Collateral seized', 'Full escrow to lender'],
          ]
        : s === RepoStatus.Proposed
          ? [
              ['Opening requirement', `cash ÷ (1 − ${bps(repo.terms.haircutBps)})`],
              ['Collateral offered', `${amount(repo.terms.collateralAmount, 0)} nhBOND`],
              ['Both legs', 'Approve before accepting'],
            ]
          : [['Status', 'No settlement occurred']]
  return (
    <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3>{s === RepoStatus.Proposed ? 'Awaiting acceptance' : 'Outcome'}</h3>
      {rows.map(([k, v]) => (
        <div key={k} className="row" style={{ fontSize: 13 }}>
          <span className="muted">{k}</span>
          <span>{v}</span>
        </div>
      ))}
      {s === RepoStatus.Proposed && <span className="small muted">Accepting checks KYC, values the collateral at the live NAV and settles both legs atomically.</span>}
      {s !== RepoStatus.Proposed && (
        <a className="small" href={explorer} target="_blank" rel="noreferrer">
          View on Etherscan ↗
        </a>
      )}
    </div>
  )
}
