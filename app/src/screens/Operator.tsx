import { useEffect, useState } from 'react'
import { isAddress, type Address } from 'viem'
import { AddressLink, Check, Empty, TxLink } from '../components/ui'
import { backend, type IdentityStatus, type OperatorRights } from '../lib/backend'
import { ago, amount, date, eur, formatRepoId, parseDecimal, price, shortAddr, time } from '../lib/format'
import { ZERO, isOpen, margin, same, statusLabel } from '../lib/repo'
import { useLedger, useNow } from '../lib/store'

const COUNTRY_DE = 276

/** `#/operator?wallet=0x…` (or legacy `#/identity?wallet=0x…`) preselects a wallet. */
function walletFromHash() {
  const q = window.location.hash.split('?')[1]
  const w = q ? new URLSearchParams(q).get('wallet') : null
  return w && isAddress(w) ? w : ''
}

function NavControl() {
  const { snapshot, busy, run } = useLedger()
  const now = useNow()
  const o = snapshot!.oracle
  const d = snapshot!.deployment
  const current = Number(o.price) / 1e8
  const [input, setInput] = useState(current ? current.toFixed(2) : '100.00')
  const next = parseDecimal(input, 8)
  const move = o.price > 0n && next > 0n ? Number(((next - o.price) * 10_000n) / o.price) : 0
  const nudge = (bpsMove: number) => setInput(((current * (10_000 + bpsMove)) / 10_000).toFixed(2))

  return (
    <div className="panel panel-tinted panel-pad stack gap-4">
      <div className="row row-baseline">
        <h3>nhBOND NAV Oracle</h3>
        <span className={`small ${o.invalid ? 'text-bad' : 'text-ok'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {!o.invalid && <span className="pulse-dot" aria-hidden="true" />}
          {o.invalid ? 'No NAV' : 'Live'}
        </span>
      </div>
      <div className="small muted">{o.description}</div>
      <div className="stack gap-1" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
        <span className="small muted">Current NAV</span>
        <span className="cluster-sm" style={{ alignItems: 'baseline' }}>
          <span className="figure fig-lg">{price(o.price)}</span>
          <span className="muted">per nhBOND</span>
        </span>
        <span className={`small ${o.invalid ? 'text-bad' : 'muted'}`}>Updated {o.updatedAt ? ago(now - o.updatedAt) : 'never'}</span>
      </div>
      <div className="row" style={{ fontSize: 13 }}>
        <span className="muted">Oracle contract</span>
        <AddressLink address={d.oracle} />
      </div>
      <div className="field">
        <label htmlFor="nav">New NAV · EUR per nhBOND</label>
        <input id="nav" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} />
        <span className="hint">{move === 0 ? 'Same as the current NAV.' : `${move > 0 ? '+' : '−'}${Math.abs(move)} bps vs current`}</span>
      </div>
      <div className="cluster-sm">
        {[-500, -200, -100, 100, 200, 500].map((b) => (
          <button key={b} type="button" className="chip" onClick={() => nudge(b)}>
            {b > 0 ? '+' : '−'}
            {Math.abs(b) / 100}%
          </button>
        ))}
      </div>
      <button type="button" className="btn primary block" disabled={busy || next <= 0n} onClick={() => run('NAV update', (st) => backend.updateNav(next, st))}>
        Post NAV {price(next)}
      </button>
    </div>
  )
}

function OracleReadOnly() {
  const { snapshot } = useLedger()
  const now = useNow()
  const o = snapshot!.oracle
  const d = snapshot!.deployment
  return (
    <div className="panel panel-tinted panel-pad stack gap-4">
      <div className="row row-baseline">
        <h3>nhBOND NAV Oracle</h3>
        <span className={`small ${o.invalid ? 'text-bad' : 'text-ok'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {!o.invalid && <span className="pulse-dot" aria-hidden="true" />}
          {o.invalid ? 'No NAV' : 'Live'}
        </span>
      </div>
      <div className="small muted">{o.description}</div>
      <div className="stack gap-1" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
        <span className="small muted">Current NAV</span>
        <span className="cluster-sm" style={{ alignItems: 'baseline' }}>
          <span className="figure fig-lg">{price(o.price)}</span>
          <span className="muted">per nhBOND</span>
        </span>
        <span className={`small ${o.invalid ? 'text-bad' : 'muted'}`}>Updated {o.updatedAt ? ago(now - o.updatedAt) : 'never'}</span>
      </div>
      <div className="row" style={{ fontSize: 13 }}>
        <span className="muted">Oracle contract</span>
        <AddressLink address={d.oracle} />
      </div>
    </div>
  )
}

/**
 * Unified Operator tab: combines Market NAV controls & active repo call prices with ERC-3643 Identity onboarding.
 */
export function Operator() {
  const { snapshot, account, checks, roles, busy, run, connect } = useLedger()
  const now = useNow()
  const [input, setInput] = useState(() => walletFromHash() || roles.borrower || '')
  const [status, setStatus] = useState<IdentityStatus>()
  const [loadedRights, setRights] = useState<OperatorRights>()
  const [country, setCountry] = useState(String(COUNTRY_DE))
  const [bonds, setBonds] = useState('250000')
  const [cash, setCash] = useState('25000000')

  const wallet = isAddress(input.trim()) ? (input.trim() as Address) : undefined

  useEffect(() => {
    setStatus((cur) => (cur && same(cur.wallet, wallet) ? cur : undefined))
    if (!wallet) return
    let live = true
    backend
      .identityStatus(wallet)
      .then((s) => live && setStatus(s))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [wallet, snapshot])

  const [rightsOf, setRightsOf] = useState<Address>()
  useEffect(() => {
    if (!account) return
    let live = true
    backend
      .operatorRights(account)
      .then((r) => {
        if (!live) return
        setRights(r)
        setRightsOf(account)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [account, snapshot])
  const rights = rightsOf && same(rightsOf, account) ? loadedRights : undefined

  if (!snapshot) return <Empty title="Loading operator console…" />

  const d = snapshot.deployment
  const shared = same(d.bondRegistry, d.cashRegistry)
  const verified = !!status && status.bond.verified && status.cash.verified
  const registered = !!status && (status.bond.registered || status.cash.registered)
  const bondAmount = parseDecimal(bonds, 18, -1n)
  const cashAmount = parseDecimal(cash, 18, -1n)
  const countryCode = Number(country)
  const isOperator = !!rights && rights.bondRegistryAgent && rights.cashRegistryAgent
  const badInput = bondAmount < 0n || cashAmount < 0n || !Number.isInteger(countryCode) || countryCode <= 0 || countryCode > 65535
  const tag = (w: Address) => {
    if (same(w, d.repoDvP)) return 'DvP Repo Contract'
    const labels: string[] = []
    if (same(w, roles.borrower) || snapshot.repos.some((r) => same(r.order.borrower, w))) labels.push('Borrower')
    if (same(w, roles.lender) || snapshot.repos.some((r) => same(r.order.lender, w))) labels.push('Lender')
    if (same(w, roles.agent)) labels.push('Operator')
    return labels.join(' · ')
  }
  const open = snapshot.repos.filter((r) => isOpen(r.state.status))

  const onboard = () =>
    run(verified ? 'Funding' : 'Onboarding', async (st) => {
      if (!verified) await backend.registerIdentity(wallet!, countryCode, st)
      if (bondAmount > 0n) await backend.issueBonds(wallet!, bondAmount, st)
      if (cashAmount > 0n) await backend.mintCash(wallet!, cashAmount, st)
    })

  return (
    <div className="stack gap-10">
      <section className="reveal operator-banner">
        <div className="eyebrow">
          Operator · {date(now)}, {time(now)}
        </div>
        <h1>Market &amp; Identity Operations</h1>
      </section>

      <section className="split">
        <div className="main reveal d1 stack gap-8">
          <div className="stack gap-4">
            <h2>Active Repo Call Prices</h2>
            {open.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                No active repos yet. Once a lender accepts a proposal, each repo’s margin-call price appears here.
              </p>
            ) : (
              <div className="panel panel-pad stack gap-3" style={{ fontSize: 13 }}>
                {open.map((r) => {
                  const m = margin(r, snapshot.oracle.price, now)
                  return (
                    <div key={String(r.id)} className="row">
                      <a href={`#/lender/repo/${r.id}`}>{formatRepoId(r.id)}</a>
                      <span className="muted">{statusLabel[r.state.status]}</span>
                      <span>
                        call below {price(m.callPrice)} · {m.healthy ? 'healthy' : 'under-collateralised'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="stack gap-4">
            <div className="row row-baseline" style={{ flexWrap: 'wrap' }}>
              <h2>Identity Onboarding &amp; Funding</h2>
              <span className="small muted">
                {shared ? 'Identity Registry' : 'nhBOND Identity Registry'} · <AddressLink address={d.bondRegistry} />
                {!shared && (
                  <>
                    {' · nhEUR Identity Registry · '}
                    <AddressLink address={d.cashRegistry} />
                  </>
                )}
              </span>
            </div>
            <div className="panel panel-pad stack gap-4">
              <div className="field">
                <label htmlFor="wallet">Wallet Address</label>
                <input id="wallet" spellCheck={false} placeholder="0x…" value={input} onChange={(e) => setInput(e.target.value)} />
                {input.trim() && !wallet && <span className="hint bad">Not a valid address.</span>}
              </div>
              <div className="cluster-sm">
                {(['borrower', 'lender', 'agent'] as const).map((r) =>
                  roles[r] ? (
                    <button key={r} type="button" className="chip" aria-pressed={same(wallet, roles[r])} onClick={() => setInput(roles[r]!)}>
                      {r === 'agent' ? 'Operator' : r[0].toUpperCase() + r.slice(1)} · {shortAddr(roles[r])}
                    </button>
                  ) : null,
                )}
              </div>

              {wallet && !status && <span className="small muted">Reading the registry…</span>}
              {status && (
                <div className="stack gap-2 row-divider" style={{ fontSize: 13 }}>
                  {shared ? (
                    <Check label="Verified · identity registry" ok={status.bond.verified} fail={status.bond.registered ? 'Registered, not verified' : 'Not registered'} />
                  ) : (
                    <>
                      <Check label="Verified · nhBOND registry" ok={status.bond.verified} fail={status.bond.registered ? 'Registered, not verified' : 'Not registered'} />
                      <Check label="Verified · nhEUR registry" ok={status.cash.verified} fail={status.cash.registered ? 'Registered, not verified' : 'Not registered'} />
                    </>
                  )}
                  <div className="row">
                    <span className="muted">ONCHAINID identity</span>
                    <span>{status.bond.identity !== ZERO ? <AddressLink address={status.bond.identity} /> : '—'}</span>
                  </div>
                  <div className="row">
                    <span className="muted">Country (ISO 3166 numeric)</span>
                    <span>{status.bond.registered ? status.bond.country : '—'}</span>
                  </div>
                  <div className="row">
                    <span className="muted">nhBOND balance</span>
                    <span>{amount(status.bondBalance, 2)}</span>
                  </div>
                  <div className="row">
                    <span className="muted">nhEUR balance</span>
                    <span>{eur(status.cashBalance)}</span>
                  </div>
                </div>
              )}

              {status && account && isOperator && (
                <div className="stack gap-4 divider-top">
                  <div className="field-grid-compact">
                    {!verified && (
                      <div className="field">
                        <label htmlFor="country">Country Code</label>
                        <input id="country" inputMode="numeric" value={country} onChange={(e) => setCountry(e.target.value)} />
                        <span className="hint">276 = Germany</span>
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor="bonds">Issue nhBOND</label>
                      <input id="bonds" inputMode="decimal" value={bonds} onChange={(e) => setBonds(e.target.value)} />
                      <span className="hint">Collateral to post · 0 to skip</span>
                    </div>
                    <div className="field">
                      <label htmlFor="cash">Mint nhEUR</label>
                      <input id="cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
                      <span className="hint">Cash to lend or repay · 0 to skip</span>
                    </div>
                  </div>
                  {bondAmount > 0n && !rights.bondAgent && <span className="small text-bad">The operator wallet is not an nhBOND agent, so it can’t issue bonds.</span>}
                  {cashAmount > 0n && !rights.treasury && <span className="small text-bad">The operator wallet lacks nhEUR TREASURY_ROLE, so it can’t mint.</span>}
                  <button
                    type="button"
                    className="btn primary block"
                    disabled={busy || badInput || (bondAmount > 0n && !rights.bondAgent) || (cashAmount > 0n && !rights.treasury) || (verified && bondAmount === 0n && cashAmount === 0n)}
                    onClick={onboard}
                  >
                    {verified ? 'Fund wallet' : bondAmount > 0n || cashAmount > 0n ? 'Register identity and fund' : 'Register identity'}
                  </button>
                  {registered && (
                    <button type="button" className="btn block" disabled={busy} onClick={() => run('Identity removal', (st) => backend.removeIdentity(wallet!, st))}>
                      Remove from registry
                    </button>
                  )}
                </div>
              )}
              {status && !account && (
                <button type="button" className="btn primary block" onClick={connect}>
                  Connect operator wallet to onboard
                </button>
              )}
            </div>
          </div>

          <div className="stack gap-4">
            <h2>Registered Wallets</h2>
            {!snapshot.historyComplete && <p className="small muted">Scanning older blocks…</p>}
            {snapshot.registrations.length === 0 && snapshot.historyComplete ? (
              <p className="small muted" style={{ margin: 0 }}>
                No registrations found.
              </p>
            ) : (
              <table className="book">
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Role</th>
                    <th>Identity</th>
                    <th>Registration Tx</th>
                    {!shared && <th>Registries</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {snapshot.registrations.map((r) => (
                    <tr key={r.wallet}>
                      <td>
                        <AddressLink address={r.wallet} />
                      </td>
                      <td>{tag(r.wallet) || <span className="muted">—</span>}</td>
                      <td>
                        <AddressLink address={r.identity} />
                      </td>
                      <td>{r.txHash ? <TxLink hash={r.txHash} /> : <span className="muted">—</span>}</td>
                      {!shared && <td>{r.bond && r.cash ? 'nhBOND · nhEUR' : r.bond ? 'nhBOND only' : 'nhEUR only'}</td>}
                      <td className="num">
                        <button type="button" className="chip" onClick={() => setInput(r.wallet)}>
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <aside className="side reveal d2 stack gap-6">
          {account && checks?.isNavAgent ? (
            <NavControl />
          ) : (
            <div className="stack gap-3">
              {account && checks && !checks.isNavAgent && (
                <div className="banner bad small">
                  This wallet does not hold CALCULATION_AGENT_ROLE, so it cannot post a NAV. Disconnect and connect the deployer wallet.
                </div>
              )}
              <OracleReadOnly />
            </div>
          )}

          <div className="panel panel-pad stack gap-3" style={{ fontSize: 13 }}>
            <h3>Operator Wallet</h3>
            {!account ? (
              <>
                <span className="small muted">Posting NAV updates and onboarding wallets require the deployer wallet.</span>
                <button type="button" className="btn primary block" onClick={connect}>
                  Connect operator wallet
                </button>
              </>
            ) : (
              <>
                <span className="small muted" style={{ wordBreak: 'break-all' }}>
                  <AddressLink address={account} full />
                </span>
                <Check label="nhBOND NAV Oracle Calculation Agent" ok={checks?.isNavAgent} fail="No" />
                <Check label={shared ? 'Identity Registry Agent' : 'nhBOND Identity Registry Agent'} ok={rights?.bondRegistryAgent} fail="No" />
                {!shared && <Check label="nhEUR Identity Registry Agent" ok={rights?.cashRegistryAgent} fail="No" />}
                <Check label="nhBOND Agent" ok={rights?.bondAgent} fail="No" />
                <Check label="nhEUR TREASURY_ROLE · mint" ok={rights?.treasury} fail="No" />
                {rights && !isOperator && <span className="small text-bad">This wallet can’t register identities. Disconnect and connect the deployer wallet.</span>}
              </>
            )}
          </div>
        </aside>
      </section>
    </div>
  )
}
