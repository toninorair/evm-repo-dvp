import { useEffect, useMemo, useState } from 'react'
import { formatEther, formatUnits, isAddress, type Address } from 'viem'
import { Check, Empty } from '../components/ui'
import { backend } from '../lib/backend'
import { networkName } from '../lib/config'
import { amount, bps, duration, eur, parseDecimal, price } from '../lib/format'
import {
  BPS,
  MAX_INITIAL_MARGIN_BPS,
  MAX_TERM_SECONDS,
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
  ['1D', 1, 'd'],
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

function SectionHead({ step, title }: { step: string; title: string }) {
  return (
    <div className="form-section-head">
      <span className="form-step">{step}</span>
      <h2 className="form-section-title">{title}</h2>
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
  const [maxCollateralInput, setMaxCollateralInput] = useState('')
  const [maxCollateralTouched, setMaxCollateralTouched] = useState(false)
  const [term, setTerm] = useState('10')
  const [termUnit, setTermUnit] = useState<Unit>('m')
  const [cure, setCure] = useState('3')
  const [cureUnit, setCureUnit] = useState<Unit>('m')
  const [window_, setWindow] = useState('2')
  const [windowUnit, setWindowUnit] = useState<Unit>('h')
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

  // Default max collateral cap = opening collateral with a 1% NAV buffer until the user edits it directly.
  const suggestedCap = useMemo(() => {
    const borrowAmount = parseDecimal(cash, 18)
    const initialMarginBps = int(initial)
    if (nav <= 0n || borrowAmount <= 0n) return 0n
    const bufferedNav = (nav * (BPS - 100n)) / BPS
    return openingCollateral(borrowAmount, initialMarginBps, bufferedNav)
  }, [cash, initial, nav])

  useEffect(() => {
    if (!maxCollateralTouched && suggestedCap > 0n) {
      setMaxCollateralInput(Number(formatUnits(suggestedCap, 18)).toFixed(4))
    }
  }, [suggestedCap, maxCollateralTouched])

  const q = useMemo(() => {
    const borrowAmount = parseDecimal(cash, 18)
    const repoRateBps = int(rate)
    const initialMarginBps = int(initial)
    const maintenanceMarginBps = int(maint)
    const termSeconds = Math.round((Number(term) || 0) * unitSeconds[termUnit])
    const curePeriodSeconds = Math.round((Number(cure) || 0) * unitSeconds[cureUnit])
    const windowSeconds = Math.round((Number(window_) || 0) * unitSeconds[windowUnit])
    const required = openingCollateral(borrowAmount, initialMarginBps, nav)
    const maxCollateralAmount = parseDecimal(maxCollateralInput, 18)
    const atMaturity = interestFor(borrowAmount, repoRateBps, termSeconds)
    const errors: string[] = []
    if (!isAddress(lender)) errors.push('Enter the lender’s wallet address.')
    else if (same(lender, account)) errors.push('The lender must be a different wallet from yours.')
    if (borrowAmount <= 0n) errors.push('Enter the cash amount to borrow.')
    if (initialMarginBps > MAX_INITIAL_MARGIN_BPS) errors.push('Initial margin must be at most 5,000 bps.')
    if (maintenanceMarginBps > initialMarginBps) errors.push('Maintenance margin cannot exceed the initial margin.')
    if (maxCollateralAmount <= 0n) errors.push('Enter a maximum collateral amount.')
    else if (required > 0n && maxCollateralAmount < required) errors.push('Max collateral amount is below the collateral required at today’s NAV.')
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
      required,
      maxCollateralAmount,
      atMaturity,
      errors,
    }
  }, [cash, rate, initial, maint, maxCollateralInput, term, termUnit, cure, cureUnit, window_, windowUnit, nav, lender, account])

  if (!snapshot) return <Empty title="Loading market data…" />

  const enoughBond = checks ? checks.bondBalance - checks.bondFrozenTokens >= q.maxCollateralAmount : undefined
  const blocked = !!checks && (!checks.verified || checks.bondPaused || checks.bondFrozen)
  const gasLabel = networkName === 'Sepolia' ? 'Sepolia ETH' : 'ETH'

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
        <h1>Propose New Repo Agreement</h1>
      </section>

      <section className="split">
        <form className="main reveal d1 stack gap-10" onSubmit={(e) => (e.preventDefault(), submit())}>
          <section className="form-section">
            <SectionHead step="01" title="Counterparty & Acceptance Window" />
            <div className="field">
              <label htmlFor="lender">Lender Wallet Address</label>
              <input id="lender" value={lender} onChange={(e) => setLender(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
              {lender && !isAddress(lender) && <span className="hint bad">That isn’t a valid address.</span>}
              {isAddress(lender) && lenderVerified === false && <span className="hint bad">Not verified in the identity registry: Propose Repo will revert.</span>}
              {isAddress(lender) && lenderVerified && <span className="hint ok">Verified in the ERC-3643 identity registry.</span>}
            </div>
            <div style={{ maxWidth: 340 }}>
              <Duration
                id="window"
                label="Lender Must Accept Within"
                value={window_}
                unit={windowUnit}
                onValue={setWindow}
                onUnit={setWindowUnit}
                hint="Proposal expires automatically if not accepted in time."
              />
            </div>
          </section>

          <section className="form-section">
            <SectionHead step="02" title="Cash & Repo Rate" />
            <div className="field-grid">
              <div className="field">
                <label htmlFor="cash">Borrow Amount · nhEUR</label>
                <input id="cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
                <span className="hint">Principal cash received on opening settlement</span>
              </div>
              <div className="field">
                <label htmlFor="rate">Repo Rate · bps p.a.</label>
                <input id="rate" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} />
                <span className="hint">{bps(q.repoRateBps)} Actual/360 · continuous per-second accrual</span>
              </div>
            </div>
          </section>

          <section className="form-section">
            <SectionHead step="03" title="Margin & Collateral Cap" />
            <div className="field-grid">
              <div className="field">
                <label htmlFor="im">Initial Margin · bps (max 5,000)</label>
                <input id="im" inputMode="numeric" value={initial} onChange={(e) => setInitial(e.target.value)} />
                <span className="hint">Collateral opens at {bps(10_000 + q.initialMarginBps)} of principal cash</span>
              </div>
              <div className="field">
                <label htmlFor="mm">Maintenance Margin · bps</label>
                <input id="mm" inputMode="numeric" value={maint} onChange={(e) => setMaint(e.target.value)} />
                <span className="hint">Callable below {bps(10_000 + q.maintenanceMarginBps)} of repurchase price</span>
              </div>
            </div>
            <div className="field">
              <div className="row row-baseline">
                <label htmlFor="maxcol">Max Collateral Amount · nhBOND</label>
                {maxCollateralTouched && suggestedCap > 0n && (
                  <button
                    type="button"
                    className="small muted"
                    style={{ background: 'none', border: 0, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                    onClick={() => {
                      setMaxCollateralTouched(false)
                      setMaxCollateralInput(Number(formatUnits(suggestedCap, 18)).toFixed(4))
                    }}
                  >
                    Reset to +1% buffer
                  </button>
                )}
              </div>
              <input
                id="maxcol"
                inputMode="decimal"
                value={maxCollateralInput}
                onChange={(e) => {
                  setMaxCollateralTouched(true)
                  setMaxCollateralInput(e.target.value)
                }}
              />
              <span className="hint">
                Maximum nhBOND units authorised on acceptance (defaults to +1% buffer over {amount(q.required, 4)} nhBOND at today’s NAV).
              </span>
            </div>
          </section>

          <section className="form-section">
            <SectionHead step="04" title="Term & Cure Period" />
            <div className="cluster-sm">
              <span className="small muted" style={{ marginRight: 4 }}>
                Quick presets:
              </span>
              {termPresets.map(([label, v, u]) => (
                <button key={label} type="button" className="chip" aria-pressed={Number(term) === v && termUnit === u} onClick={() => (setTerm(String(v)), setTermUnit(u))}>
                  {label}
                </button>
              ))}
            </div>
            <div className="field-grid">
              <Duration id="term" label="Repo Term" value={term} unit={termUnit} onValue={setTerm} onUnit={setTermUnit} hint={q.termSeconds ? `Matures ${duration(q.termSeconds)} after acceptance` : undefined} />
              <Duration id="cure" label="Margin Call Cure Period" value={cure} unit={cureUnit} onValue={setCure} onUnit={setCureUnit} hint="Window to top up collateral after a margin call" />
            </div>
          </section>
        </form>

        <aside className="side panel panel-tinted reveal d2 stack sticky-side">
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
            <span className="small muted" style={{ lineHeight: 1.5 }}>
              Interest continues accruing after maturity until settled.
            </span>
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
              <span className="muted">Collateral value</span>
              <span>{eur(collateralValue(q.required, nav))}</span>
            </div>
            <div className="row row-strong">
              <span>Max collateral cap · approved</span>
              <span>{amount(q.maxCollateralAmount, 4)} nhBOND</span>
            </div>
          </div>
          <div className="panel-section gap-3 small">
            <div className="fw-500" style={{ fontSize: 13 }}>
              Pre-trade checks
            </div>
            <Check label="Your identity · ERC-3643 registry" ok={checks?.verified} fail="Not verified" />
            <Check label="Lender identity" ok={isAddress(lender) ? lenderVerified : undefined} fail="Not verified" />
            <Check label="nhBOND available for the cap" ok={enoughBond} fail="Insufficient" detail={checks ? `${amount(checks.bondBalance - checks.bondFrozenTokens, 2)} free` : undefined} />
            <Check label="nhBOND wallet not frozen" ok={checks ? !checks.bondFrozen : undefined} fail="Frozen" />
            <div className="row">
              <span>{gasLabel} for gas payment</span>
              <span className={!checks ? 'muted' : checks.gas > 0n ? 'text-ok' : 'text-warn'} style={{ flexShrink: 0 }}>
                {!checks ? '—' : checks.gas > 0n ? `${Number(formatEther(checks.gas)).toFixed(4)} ETH` : 'Empty'}
              </span>
            </div>
          </div>
          <div className="panel-section gap-3">
            {q.errors[0] && account && <span className="small text-bad">{q.errors[0]}</span>}
            <button type="button" className="btn primary block" disabled={busy || (!!account && (q.errors.length > 0 || blocked))} onClick={submit}>
              {!account ? 'Connect borrower wallet' : 'Approve nhBOND and Propose Repo'}
            </button>
            <span className="small muted" style={{ textAlign: 'center', lineHeight: 1.5 }}>
              Approves the collateral cap, then submits Propose Repo. You can cancel until the lender accepts.
            </span>
          </div>
        </aside>
      </section>
    </div>
  )
}
