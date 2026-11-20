import { useMemo, useState } from 'react'
import { isAddress, parseUnits, type Address } from 'viem'
import { backend, DEMO_DESKS } from '../lib/backend'
import { amount, bps, eur, price } from '../lib/format'
import {
  BPS,
  MAX_HAIRCUT_BPS,
  MAX_TENOR_SECONDS,
  ZERO,
  collateralValue,
  interestFor,
  requiredOpeningValue,
  unitsFor,
  WAD,
} from '../lib/repo'
import { useLedger } from '../lib/store'

const presets: [string, number][] = [
  ['O/N', 1],
  ['1W', 7],
  ['2W', 14],
  ['1M', 30],
  ['3M', 90],
]

function toWad(v: string) {
  try {
    return v.trim() ? parseUnits(v.replace(/,/g, ''), 18) : 0n
  } catch {
    return 0n
  }
}

export function Propose() {
  const { snapshot, account, checks, demo, busy, connect, run } = useLedger()
  const [asBorrower, setAsBorrower] = useState(true)
  const [rfq, setRfq] = useState(false)
  const [counterparty, setCounterparty] = useState<string>(demo ? DEMO_DESKS.B : '')
  const [cash, setCash] = useState('10000000')
  const [rate, setRate] = useState('350')
  const [haircut, setHaircut] = useState('200')
  const [days, setDays] = useState('7')
  const [units, setUnits] = useState<string>()

  const nav = snapshot?.oracle.price ?? 0n
  const maint = snapshot?.risk.maintenanceMarginBps ?? 100

  const q = useMemo(() => {
    const cashW = toWad(cash)
    const rateN = Math.max(0, Math.floor(Number(rate) || 0))
    const hcN = Math.max(0, Math.floor(Number(haircut) || 0))
    const tenorS = Math.round((Number(days) || 0) * 86_400)
    const hcOk = hcN <= MAX_HAIRCUT_BPS
    const req = hcOk ? requiredOpeningValue(cashW, hcN) : 0n
    const minUnitsRaw = unitsFor(req, nav)
    const minUnits = ((minUnitsRaw + WAD - 1n) / WAD) * WAD // whole units
    const unitsW = units === undefined ? minUnits : toWad(units)
    const interest = interestFor(cashW, rateN, tenorS)
    const value = collateralValue(unitsW, nav)
    const cpOk = rfq || (isAddress(counterparty) && counterparty.toLowerCase() !== account?.toLowerCase())
    const errors: string[] = []
    if (cashW <= 0n) errors.push('Enter the cash amount.')
    if (!hcOk) errors.push('Haircut must be at most 5,000 bps.')
    if (tenorS <= 0 || tenorS > MAX_TENOR_SECONDS) errors.push('Tenor must be between 1 and 365 days.')
    if (!cpOk) errors.push('Enter a valid counterparty address.')
    if (value < req) errors.push('Collateral is below the opening requirement at the current NAV.')
    return {
      cashW,
      rateN,
      hcN,
      tenorS,
      req,
      minUnits,
      unitsW,
      interest,
      value,
      errors,
      overBps: req > 0n ? Number(((value - req) * BPS) / req) : 0,
    }
  }, [cash, rate, haircut, days, units, nav, rfq, counterparty, account])

  const balanceShort = checks
    ? asBorrower
      ? checks.bondBalance < q.unitsW
      : checks.cashBalance < q.cashW
    : false

  const submit = async () => {
    if (!account) return connect()
    let newId: bigint | undefined
    const ok = await run('Proposal', async (onStep) => {
      newId = await backend.propose(
        {
          counterparty: rfq ? ZERO : (counterparty as Address),
          collateralAmount: q.unitsW,
          cashAmount: q.cashW,
          repoRateBps: q.rateN,
          tenorSeconds: q.tenorS,
          haircutBps: q.hcN,
          asBorrower,
        },
        onStep,
      )
    })
    if (ok && newId !== undefined) window.location.hash = `#/repo/${newId}`
  }

  const choice = (on: boolean) => ({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    gap: 2,
    padding: 16,
    border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`,
    background: on ? 'var(--surface)' : 'transparent',
    color: 'var(--ink)',
    textAlign: 'left' as const,
    cursor: 'pointer',
    minHeight: 44,
    transition: 'border-color 160ms, background-color 160ms',
  })

  const legend = (n: number, text: string) => (
    <legend style={{ padding: '0 0 12px', width: '100%', borderBottom: '1px solid var(--ink)' }}>
      <span style={{ fontFamily: 'var(--display)', fontSize: 22 }}>
        {n} · {text}
      </span>
    </legend>
  )

  const check = (label: string, ok: boolean | undefined, fail = 'Fail') => (
    <div className="row">
      <span>{label}</span>
      <span style={{ color: ok === undefined ? 'var(--muted)' : ok ? 'var(--ok)' : 'var(--warn)' }}>{ok === undefined ? '—' : ok ? 'Pass' : fail}</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      <section className="reveal" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760 }}>
        <a href="#/" className="small muted" style={{ textDecoration: 'none' }}>
          ← Repo book
        </a>
        <h1>Propose a repo.</h1>
        <p className="muted" style={{ margin: 0, fontSize: 15 }}>
          Set the terms on-chain. When your counterparty accepts, both legs settle in one transaction, or neither does.
        </p>
      </section>

      <section className="split">
        <form className="main reveal d1" style={{ display: 'flex', flexDirection: 'column', gap: 32 }} onSubmit={(e) => (e.preventDefault(), submit())}>
          <fieldset style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {legend(1, 'Your role')}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <button type="button" aria-pressed={asBorrower} style={choice(asBorrower)} onClick={() => setAsBorrower(true)}>
                <span style={{ fontWeight: 500 }}>Borrower</span>
                <span className="small muted">Post nhBOND, receive nhEUR when the lender accepts.</span>
              </button>
              <button type="button" aria-pressed={!asBorrower} style={choice(!asBorrower)} onClick={() => setAsBorrower(false)}>
                <span style={{ fontWeight: 500 }}>Lender</span>
                <span className="small muted">Fund nhEUR against nhBOND held in escrow.</span>
              </button>
            </div>
          </fieldset>

          <fieldset style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {legend(2, 'Counterparty')}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <button type="button" aria-pressed={!rfq} style={choice(!rfq)} onClick={() => setRfq(false)}>
                <span style={{ fontWeight: 500 }}>Bilateral</span>
                <span className="small muted">Name a KYC-verified {asBorrower ? 'lender' : 'borrower'}.</span>
              </button>
              <button type="button" aria-pressed={rfq} style={choice(rfq)} onClick={() => setRfq(true)}>
                <span style={{ fontWeight: 500 }}>Open RFQ</span>
                <span className="small muted">Any verified {asBorrower ? 'lender' : 'borrower'} may accept.</span>
              </button>
            </div>
            {!rfq && (
              <div className="field reveal">
                <label htmlFor="cp">{asBorrower ? 'Lender' : 'Borrower'} address</label>
                <input id="cp" value={counterparty} onChange={(e) => setCounterparty(e.target.value.trim())} placeholder="0x7a3f2b8e04d1c5a9f0e6b3c2d8a71e44b0c9c19e" spellCheck={false} />
                {counterparty && !isAddress(counterparty) && <span className="hint bad">That isn't a valid address.</span>}
                {isAddress(counterparty) && <span className="hint">KYC is checked again on acceptance.</span>}
              </div>
            )}
          </fieldset>

          <fieldset style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {legend(3, 'Terms')}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
              <div className="field">
                <label htmlFor="cash">Cash · nhEUR</label>
                <input id="cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="rate">Repo rate · bps p.a.</label>
                <input id="rate" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} />
                <span className="hint">{bps(q.rateN)} Actual/360</span>
              </div>
              <div className="field">
                <label htmlFor="hc">Haircut · bps (max 5,000)</label>
                <input id="hc" inputMode="numeric" value={haircut} onChange={(e) => setHaircut(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="tenor">Tenor · days (max 365)</label>
                <input id="tenor" inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {presets.map(([label, d]) => (
                <button key={label} type="button" className="chip" aria-pressed={Number(days) === d} onClick={() => setDays(String(d))}>
                  {label}
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="units">Collateral · nhBOND units</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="units"
                  inputMode="decimal"
                  style={{ flex: 1, minWidth: 0 }}
                  value={units ?? amount(q.minUnits, 0).replace(/,/g, '')}
                  onChange={(e) => setUnits(e.target.value)}
                />
                <button type="button" className="btn quiet" onClick={() => setUnits(undefined)}>
                  Use minimum
                </button>
              </div>
              <span className={`hint ${q.value < q.req ? 'bad' : ''}`}>
                Minimum {amount(q.minUnits, 0)} at {price(nav)} · {q.value >= q.req ? `${bps(q.overBps)} over requirement` : 'below requirement'}
              </span>
            </div>
          </fieldset>
        </form>

        <aside className="side panel reveal d2" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '24px 24px 20px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="eyebrow">Term sheet</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 26 }}>Repurchase agreement</div>
          </div>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
            <div className="row">
              <span className="muted">Purchase price</span>
              <span>{eur(q.cashW)}</span>
            </div>
            <div className="row">
              <span className="muted">Interest · Act/360</span>
              <span>{eur(q.interest)}</span>
            </div>
            <div className="row" style={{ paddingTop: 12, borderTop: '1px solid var(--line)', fontWeight: 500 }}>
              <span>Repurchase price</span>
              <span>{eur(q.cashW + q.interest)}</span>
            </div>
          </div>
          <div style={{ padding: '20px 24px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
            <div className="row">
              <span className="muted">NAV · nhNAVOracle</span>
              <span>{price(nav)}</span>
            </div>
            <div className="row">
              <span className="muted">Value required to open</span>
              <span>{eur(q.req)}</span>
            </div>
            <div className="row">
              <span className="muted">Collateral value</span>
              <span>{eur(q.value)}</span>
            </div>
            <div className="row" style={{ paddingTop: 12, borderTop: '1px solid var(--line)', fontWeight: 500 }}>
              <span>nhBOND to escrow</span>
              <span>{amount(q.unitsW, 0)}</span>
            </div>
            <span className="small muted">Minimum = cash ÷ (1 − haircut). A margin call is possible below {bps(10_000 + maint)} of the repurchase price.</span>
          </div>
          <div style={{ padding: '20px 24px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>Pre-trade checks</div>
            {check('Your KYC · ComplianceRegistry', checks?.kyc)}
            {asBorrower && check('ERC-3643 identity · nhBOND', checks?.eligible)}
            {asBorrower && check('Wallet not frozen', checks ? !checks.frozen : undefined)}
            {check(asBorrower ? 'nhBOND balance' : 'nhEUR balance', checks ? !balanceShort : undefined, 'Insufficient')}
            {check('Oracle fresh', snapshot ? !snapshot.oracle.stale : undefined, 'Stale')}
          </div>
          <div style={{ padding: '20px 24px 24px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {q.errors[0] && account && <span className="small" style={{ color: 'var(--bad)' }}>{q.errors[0]}</span>}
            <button type="button" className="btn primary block" disabled={busy || (!!account && q.errors.length > 0)} onClick={submit}>
              {!account ? 'Connect wallet' : `Approve ${asBorrower ? 'nhBOND' : 'nhEUR'} and propose`}
            </button>
            <span className="small muted" style={{ textAlign: 'center' }}>
              Calls proposeRepo() · cancellable until accepted
            </span>
          </div>
        </aside>
      </section>
    </div>
  )
}
