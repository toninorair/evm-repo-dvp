import { useEffect, useMemo, useState } from 'react'
import { isAddress, type Address } from 'viem'
import { Check, Empty } from '../components/ui'
import { backend } from '../lib/backend'
import { amount, bps, duration, eur, parseDecimal, price } from '../lib/format'
import {
  BPS,
  MAX_INITIAL_MARGIN_BPS,
  MAX_TERM_SECONDS,
  PRICE_PRECISION,
  collateralValue,
  interestFor,
  openingCollateral,
  same,
} from '../lib/repo'
import { useLedger, useNow } from '../lib/store'

type Unit = 'm' | 'h' | 'd'
const unitSeconds: Record<Unit, number> = { m: 60, h: 3600, d: 86_400 }
const unitLabel: Record<Unit, string> = { m: 'minutes', h: 'hours', d: 'days' }

/** Short presets are there for testing: a 10-minute repo reaches maturity (and default) within a session. */
const termPresets: [string, number, Unit][] = [
  ['10m', 10, 'm'],
  ['1h', 1, 'h'],
  ['O/N', 1, 'd'],
  ['1W', 7, 'd'],
  ['1M', 30, 'd'],
]

const int = (v: string) => Math.max(0, Math.floor(Number(v) || 0))

function Duration({ id, label, value, unit, onValue, onUnit, hint }: { id: string; label: string; value: string; unit: Unit; onValue(v: string): void; onUnit(u: Unit): void; hint?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="duration-row">
        <input id={id} inputMode="decimal" value={value} onChange={(e) => onValue(e.target.value)} />
        <select aria-label={`${label} unit`} value={unit} onChange={(e) => onUnit(e.target.value as Unit)}>
          {(Object.keys(unitLabel) as Unit[]).map((u) => (
            <option key={u} value={u}>
              {unitLabel[u]}
            </option>
          ))}
        </select>
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function Propose() {
  const { snapshot, account, checks, busy, connect, run, href, roles } = useLedger()
  const now = useNow() // chain-aligned, so the accept deadline is measured on the chain's clock
  const [lender, setLender] = useState<string>(roles.lender ?? '')
  useEffect(() => {
    if (roles.lender) setLender((cur) => cur || roles.lender!)
  }, [roles.lender])
  const [cash, setCash] = useState('1000000')
  const [rate, setRate] = useState('350')
  const [initial, setInitial] = useState('200')
  const [maint, setMaint] = useState('100')
  const [term, setTerm] = useState('10')
  const [termUnit, setTermUnit] = useState<Unit>('m')
  const [cure, setCure] = useState('3')
  const [cureUnit, setCureUnit] = useState<Unit>('m')
  const [window_, setWindow] = useState('2')
  const [windowUnit, setWindowUnit] = useState<Unit>('h')
  const [tolerance, setTolerance] = useState('100')
  const [lenderVerified, setLenderVerified] = useState<boolean>()

  useEffect(() => {
    setLenderVerified(undefined)
    if (!isAddress(lender)) return
    let live = true
    backend
      .isVerified(lender as Address)
      .then((v) => live && setLenderVerified(v))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [lender])

  const nav = snapshot?.oracle.price ?? 0n

  const q = useMemo(() => {
    const borrowAmount = parseDecimal(cash, 18)
    const repoRateBps = int(rate)
    const initialMarginBps = int(initial)
    const maintenanceMarginBps = int(maint)
    const termSeconds = Math.round((Number(term) || 0) * unitSeconds[termUnit])
    const curePeriodSeconds = Math.round((Number(cure) || 0) * unitSeconds[cureUnit])
    const windowSeconds = Math.round((Number(window_) || 0) * unitSeconds[windowUnit])
    const tolBps = Math.min(5_000, int(tolerance))
    const required = openingCollateral(borrowAmount, initialMarginBps, nav)
    // Cap = collateral needed if NAV falls by the tolerance before the lender accepts.
    const floorNav = (nav * (BPS - BigInt(tolBps))) / BPS
    const maxCollateralAmount = openingCollateral(borrowAmount, initialMarginBps, floorNav)
    const atMaturity = interestFor(borrowAmount, repoRateBps, termSeconds)
    const errors: string[] = []
    if (!isAddress(lender)) errors.push('Enter the lender’s wallet address.')
    else if (same(lender, account)) errors.push('The lender must be a different wallet from yours.')
    if (borrowAmount <= 0n) errors.push('Enter the cash amount to borrow.')
    if (initialMarginBps > MAX_INITIAL_MARGIN_BPS) errors.push('Initial margin must be at most 5,000 bps.')
    if (maintenanceMarginBps > initialMarginBps) errors.push('Maintenance margin cannot exceed the initial margin.')
    if (termSeconds <= 0 || termSeconds > MAX_TERM_SECONDS) errors.push('Term must be between 1 second and 365 days.')
    if (curePeriodSeconds <= 0 || curePeriodSeconds > termSeconds) errors.push('Cure period must be positive and no longer than the term.')
    if (windowSeconds <= 0) errors.push('Give the lender time to accept.')
    if (nav <= 0n) errors.push('The oracle has no NAV yet.')
    return {
      borrowAmount,
      repoRateBps,
      initialMarginBps,
      maintenanceMarginBps,
      termSeconds,
      curePeriodSeconds,
      windowSeconds,
      tolBps,
      required,
      maxCollateralAmount,
      floorNav,
      atMaturity,
      // NAV at which the freshly opened repo would be callable.
      callNav: required > 0n ? (((borrowAmount * (BPS + BigInt(maintenanceMarginBps))) / BPS) * PRICE_PRECISION) / required : 0n,
      errors,
    }
  }, [cash, rate, initial, maint, term, termUnit, cure, cureUnit, window_, windowUnit, tolerance, nav, lender, account])

  if (!snapshot) return <Empty title="Loading market data…" />

  const enoughBond = checks ? checks.bondBalance - checks.bondFrozenTokens >= q.maxCollateralAmount : undefined
  const blocked = !!checks && (!checks.verified || checks.bondPaused || checks.bondFrozen)

  const submit = async () => {
    if (!account) return connect()
    let id: bigint | undefined
    const ok = await run('Proposal', async (onStep) => {
      id = await backend.propose(
        {
          lender: lender as Address,
          borrowAmount: q.borrowAmount,
          repoRateBps: q.repoRateBps,
          initialMarginBps: q.initialMarginBps,
          maintenanceMarginBps: q.maintenanceMarginBps,
          termSeconds: q.termSeconds,
          curePeriodSeconds: q.curePeriodSeconds,
          maxCollateralAmount: q.maxCollateralAmount,
          acceptDeadline: now + q.windowSeconds,
        },
        onStep,
      )
    })
    if (ok && id !== undefined) window.location.hash = href(`/repo/${id}`)
  }

  return (
    <div className="stack gap-10">
      <section className="reveal page-intro">
        <a href={href('/')} className="small muted back-link">
          ← Positions
        </a>
        <h1>Propose a repo.</h1>
        <p className="muted lead">
          You are the borrower: you post nhBOND and receive nhEUR. The lender you name accepts before the deadline, and both legs settle in that one transaction, or neither does.
        </p>
      </section>

      <section className="split">
        <form className="main reveal d1 stack gap-8" onSubmit={(e) => (e.preventDefault(), submit())}>
          <fieldset className="fieldset">
            <legend className="form-legend">1 · Lender</legend>
            <div className="field">
              <label htmlFor="lender">Lender Wallet Address</label>
              <input id="lender" value={lender} onChange={(e) => setLender(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
              {lender && !isAddress(lender) && <span className="hint bad">That isn’t a valid address.</span>}
              {isAddress(lender) && lenderVerified === false && <span className="hint bad">Not verified in the identity registry: proposeRepo() will revert.</span>}
              {isAddress(lender) && lenderVerified && <span className="hint">Verified in the ERC-3643 identity registry.</span>}
            </div>
          </fieldset>

          <fieldset className="fieldset">
            <legend className="form-legend">2 · Cash and rate</legend>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="cash">Borrow · nhEUR</label>
                <input id="cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="rate">Repo Rate · bps p.a.</label>
                <input id="rate" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} />
                <span className="hint">{bps(q.repoRateBps)} Actual/360</span>
              </div>
            </div>
          </fieldset>

          <fieldset className="fieldset">
            <legend className="form-legend">3 · Margin</legend>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="im">Initial Margin · bps (max 5,000)</label>
                <input id="im" inputMode="numeric" value={initial} onChange={(e) => setInitial(e.target.value)} />
                <span className="hint">Collateral opens at {bps(10_000 + q.initialMarginBps)} of cash</span>
              </div>
              <div className="field">
                <label htmlFor="mm">Maintenance Margin · bps</label>
                <input id="mm" inputMode="numeric" value={maint} onChange={(e) => setMaint(e.target.value)} />
                <span className="hint">Callable below {bps(10_000 + q.maintenanceMarginBps)} of the repurchase price</span>
              </div>
            </div>
          </fieldset>

          <fieldset className="fieldset">
            <legend className="form-legend">4 · Timing</legend>
            <div className="field-grid">
              <Duration id="term" label="Term" value={term} unit={termUnit} onValue={setTerm} onUnit={setTermUnit} hint={q.termSeconds ? `Maturity ${duration(q.termSeconds)} after acceptance` : undefined} />
              <Duration id="cure" label="Cure period" value={cure} unit={cureUnit} onValue={setCure} onUnit={setCureUnit} hint="Time you get to top up after a margin call" />
            </div>
            <div className="cluster-sm">
              {termPresets.map(([label, v, u]) => (
                <button key={label} type="button" className="chip" aria-pressed={Number(term) === v && termUnit === u} onClick={() => (setTerm(String(v)), setTermUnit(u))}>
                  {label}
                </button>
              ))}
            </div>
            <div className="field-grid">
              <Duration id="window" label="Lender must accept within" value={window_} unit={windowUnit} onValue={setWindow} onUnit={setWindowUnit} />
              <div className="field">
                <label htmlFor="tol">NAV Tolerance · bps</label>
                <input id="tol" inputMode="numeric" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
                <span className="hint">Acceptance still succeeds if NAV falls to {price(q.floorNav)}</span>
              </div>
            </div>
          </fieldset>
        </form>

        <aside className="side panel reveal d2 stack">
          <div className="panel-section gap-1">
            <div className="eyebrow">Term sheet</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 26 }}>Repurchase agreement</div>
          </div>
          <div className="panel-section">
            <div className="row">
              <span className="muted">Purchase price</span>
              <span>{eur(q.borrowAmount)}</span>
            </div>
            <div className="row">
              <span className="muted">Interest to maturity · Act/360</span>
              <span>{eur(q.atMaturity)}</span>
            </div>
            <div className="row row-strong">
              <span>Repurchase price at maturity</span>
              <span>{eur(q.borrowAmount + q.atMaturity)}</span>
            </div>
            <span className="small muted">Interest keeps accruing after maturity until you settle.</span>
          </div>
          <div className="panel-section">
            <div className="row">
              <span className="muted">NAV · nhNAVOracle</span>
              <span>{price(nav)}</span>
            </div>
            <div className="row">
              <span className="muted">nhBOND pulled at today’s NAV</span>
              <span>{amount(q.required, 4)}</span>
            </div>
            <div className="row">
              <span className="muted">Worth</span>
              <span>{eur(collateralValue(q.required, nav))}</span>
            </div>
            <div className="row row-strong">
              <span>Collateral cap · approved</span>
              <span>{amount(q.maxCollateralAmount, 4)} nhBOND</span>
            </div>
            <span className="small muted">
              acceptRepo() sizes collateral at the NAV when the lender accepts and reverts above this cap. Callable at a NAV below {price(q.callNav)}.
            </span>
          </div>
          <div className="panel-section gap-2 small">
            <div className="fw-500" style={{ fontSize: 13 }}>
              Pre-trade checks
            </div>
            <Check label="Your identity · ERC-3643 registry" ok={checks?.verified} fail="Not verified" />
            <Check label="Lender identity" ok={isAddress(lender) ? lenderVerified : undefined} fail="Not verified" />
            <Check label="nhBOND available for the cap" ok={enoughBond} fail="Insufficient" detail={checks ? `${amount(checks.bondBalance - checks.bondFrozenTokens, 2)} free` : undefined} />
            <Check label="nhBOND wallet not frozen" ok={checks ? !checks.bondFrozen : undefined} fail="Frozen" />
            <Check label="nhBOND transfers live" ok={checks ? !checks.bondPaused : undefined} fail="Paused" />
            <Check label="Oracle has a NAV · needed when the lender accepts" ok={!snapshot.oracle.invalid} fail="No NAV" />
            <Check label="ETH for gas" ok={checks ? checks.gas > 0n : undefined} fail="Empty" />
          </div>
          <div className="panel-section gap-3">
            {q.errors[0] && account && <span className="small text-bad">{q.errors[0]}</span>}
            <button type="button" className="btn primary block" disabled={busy || (!!account && (q.errors.length > 0 || blocked))} onClick={submit}>
              {!account ? 'Connect borrower wallet' : 'Approve nhBOND and propose'}
            </button>
            <span className="small muted" style={{ textAlign: 'center' }}>
              Approves the cap, then calls proposeRepo(). You can cancel until the lender accepts.
            </span>
          </div>
        </aside>
      </section>
    </div>
  )
}
