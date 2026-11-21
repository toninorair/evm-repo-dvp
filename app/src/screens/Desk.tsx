import { useState } from 'react'
import { formatEther, parseUnits } from 'viem'
import { AddressLink, Check, Empty } from '../components/ui'
import { backend } from '../lib/backend'
import { ago, amount, eur, price } from '../lib/format'
import { RepoStatus, isOpen, margin, same, statusLabel } from '../lib/repo'
import { useLedger, useNow } from '../lib/store'

/** The current tab's wallet: identity, balances, approvals and readiness to trade. */
export function Desk() {
  const { snapshot, account, checks, connect, tab, href } = useLedger()

  if (!account)
    return (
      <Empty title={`Connect the ${tab} wallet`}>
        <button type="button" className="btn primary" onClick={connect} style={{ marginTop: 12 }}>
          Connect {tab} wallet
        </button>
      </Empty>
    )
  if (!snapshot || !checks) return <Empty title="Reading your wallet…" />

  const mine = snapshot.repos.filter((r) => same(r.order.borrower, account) || same(r.order.lender, account))
  const borrowing = mine.filter((r) => same(r.order.borrower, account) && isOpen(r.state.status))
  const lending = mine.filter((r) => same(r.order.lender, account) && isOpen(r.state.status))
  const pending = mine.filter((r) => same(r.order.borrower, account) && r.state.status === RepoStatus.Proposed)
  const free = checks.bondBalance - checks.bondFrozenTokens

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      <section className="reveal" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760 }}>
        <a href={href('/')} className="small muted" style={{ textDecoration: 'none' }}>
          ← Positions
        </a>
        <h1>{tab === 'borrower' ? 'Borrower' : 'Lender'} wallet.</h1>
        <p className="muted" style={{ margin: 0, fontSize: 15 }}>
          <AddressLink address={account} /> · {account}
        </p>
      </section>

      {!checks.verified && (
        <section className="reveal" style={{ background: 'var(--bad-bg)', color: 'var(--bad)', padding: '14px 20px', fontSize: 13 }}>
          This wallet is not registered in the ERC-3643 identity registry, so RepoDvP and both tokens will reject it. Onboard it in the <a href={`#/identity?wallet=${account}`}>Identity</a> tab with the operator wallet.
        </section>
      )}

      <section className="stats reveal d1">
        <div>
          <span className="small muted">nhBOND · collateral</span>
          <span className="figure" style={{ fontSize: 32 }}>
            {amount(checks.bondBalance, 2)}
          </span>
          <span className="small muted">{checks.bondFrozenTokens > 0n ? `${amount(checks.bondFrozenTokens, 2)} frozen · ` : ''}worth {eur((free * snapshot.oracle.price) / 10n ** 8n)}</span>
        </div>
        <div>
          <span className="small muted">nhEUR · cash</span>
          <span className="figure" style={{ fontSize: 32 }}>
            {eur(checks.cashBalance)}
          </span>
          <span className="small muted">Tokenised deposit</span>
        </div>
        <div>
          <span className="small muted">Borrowing · lending</span>
          <span className="figure" style={{ fontSize: 32 }}>
            {borrowing.length} · {lending.length}
          </span>
          <span className="small muted">{pending.length} proposal{pending.length === 1 ? '' : 's'} awaiting a lender</span>
        </div>
        <div>
          <span className="small muted">ETH</span>
          <span className="figure" style={{ fontSize: 32 }}>
            {Number(formatEther(checks.gas)).toFixed(4)}
          </span>
          <span className="small muted">For gas</span>
        </div>
      </section>

      <section className="split">
        <div className="main reveal d2" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2>Readiness</h2>
          <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <Check label="Identity verified · ERC-3643 registry" ok={checks.verified} fail="Not verified" />
            <Check label="nhBOND wallet not frozen" ok={!checks.bondFrozen} fail="Frozen" />
            <Check label="nhEUR wallet not frozen" ok={!checks.cashFrozen} fail="Frozen" />
            <Check label="nhBOND transfers live" ok={!checks.bondPaused} fail="Paused" />
            <Check label="nhEUR transfers live" ok={!checks.cashPaused} fail="Paused" />
            <Check label="Gas" ok={checks.gas > 0n} fail="No ETH" />
            <div className="row" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <span className="muted">nhBOND approved to RepoDvP</span>
              <span>{amount(checks.bondAllowance, 4)}</span>
            </div>
            <div className="row">
              <span className="muted">nhEUR approved to RepoDvP</span>
              <span>{eur(checks.cashAllowance)}</span>
            </div>
            <span className="small muted">
              {tab === 'borrower' ? 'The borrower needs nhBOND, posted on acceptance, and nhEUR to repay principal and interest.' : 'The lender needs nhEUR to fund accepted repos.'} Approvals are requested automatically for the exact amount each action needs.
            </span>
          </div>
          {mine.length > 0 && (
            <p className="small muted" style={{ margin: 0 }}>
              Your repos are listed under <a href={href('/')}>Positions</a>.
            </p>
          )}
        </div>
        <aside className="side reveal d3">
          <OracleInfo />
        </aside>
      </section>
    </div>
  )
}

function OracleInfo() {
  const { snapshot } = useLedger()
  const now = useNow()
  const o = snapshot!.oracle
  return (
    <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      <h3>Oracle</h3>
      <div className="row">
        <span className="muted">NAV</span>
        <span>{price(o.price)}</span>
      </div>
      <div className="row">
        <span className="muted">Updated</span>
        <span>{o.updatedAt ? ago(now - o.updatedAt) : '—'}</span>
      </div>
      <span className="small muted">
        Only the nhNAVOracle calculation agent can post a NAV. Use the <a href="#/market">Market</a> tab to move the price and test margin calls.
      </span>
    </div>
  )
}

/** The calculation agent's tab: posts NAVs to move the market and shows what each open repo needs. */
export function Market() {
  const { snapshot, account, checks, connect } = useLedger()
  const now = useNow()
  if (!account)
    return (
      <Empty title="Connect the NAV calculation agent">
        <span className="small muted" style={{ display: 'block' }}>Only the wallet holding CALCULATION_AGENT_ROLE on nhNAVOracle can post a NAV. Locally that is anvil account #0, the deployer.</span>
        <button type="button" className="btn primary" onClick={connect} style={{ marginTop: 12 }}>
          Connect NAV agent wallet
        </button>
      </Empty>
    )
  if (!snapshot || !checks) return <Empty title="Reading the oracle…" />
  const open = snapshot.repos.filter((r) => isOpen(r.state.status))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      <section className="reveal" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760 }}>
        <h1>Market.</h1>
        <p className="muted" style={{ margin: 0, fontSize: 15 }}>
          Move the nhBOND NAV to put repos under margin pressure. RepoDvP reads this price on accept, margin call, top-up and default.
        </p>
      </section>
      <section className="split">
        <div className="main reveal d1" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2>Call Prices</h2>
          {open.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>No active repos yet. Once a lender accepts, each repo’s margin-call price shows here.</p>
          ) : (
            <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              {open.map((r) => {
                const m = margin(r, snapshot.oracle.price, now)
                return (
                  <div key={String(r.id)} className="row">
                    <a href={`#/lender/repo/${r.id}`}>#{String(r.id).padStart(4, '0')}</a>
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
        <aside className="side reveal d2">
          {checks.isNavAgent ? (
            <NavControl />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="small" style={{ background: 'var(--bad-bg)', color: 'var(--bad)', padding: '12px 16px' }}>
                This wallet does not hold CALCULATION_AGENT_ROLE, so it cannot post a NAV. Disconnect and connect the deployer wallet.
              </div>
              <OracleInfo />
            </div>
          )}
        </aside>
      </section>
    </div>
  )
}

function NavControl() {
  const { snapshot, busy, run } = useLedger()
  const now = useNow()
  const o = snapshot!.oracle
  const current = Number(o.price) / 1e8
  const [input, setInput] = useState(current ? current.toFixed(2) : '100.00')
  let next = 0n
  try {
    next = input.trim() ? parseUnits(input.replace(/,/g, ''), 8) : 0n
  } catch {}
  const move = o.price > 0n && next > 0n ? Number(((next - o.price) * 10_000n) / o.price) : 0
  const nudge = (bpsMove: number) => setInput(((current * (10_000 + bpsMove)) / 10_000).toFixed(2))

  return (
    <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3>Oracle · Calculation Agent</h3>
        <span className="small" style={{ color: o.stale ? 'var(--bad)' : 'var(--ok)' }}>
          {o.stale ? 'Stale' : 'Live'}
        </span>
      </div>
      <div className="small muted">
        Current NAV {price(o.price)} · updated {o.updatedAt ? ago(now - o.updatedAt) : 'never'}. This wallet holds CALCULATION_AGENT_ROLE.
      </div>
      <div className="field">
        <label htmlFor="nav">New NAV · EUR per nhBOND</label>
        <input id="nav" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} />
        <span className="hint">{move === 0 ? 'Re-posting the same NAV refreshes staleness.' : `${move > 0 ? '+' : '−'}${Math.abs(move)} bps vs current`}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {[-500, -200, -100, 100].map((b) => (
          <button key={b} type="button" className="chip" onClick={() => nudge(b)}>
            {b > 0 ? '+' : '−'}
            {Math.abs(b) / 100}%
          </button>
        ))}
      </div>
      <button type="button" className="btn primary block" disabled={busy || next <= 0n} onClick={() => run('NAV update', (st) => backend.updateNav(next, st))}>
        Post NAV {price(next)}
      </button>
      <span className="small muted">Drop the NAV below a repo’s call price to make marginCall() succeed; post it again before it ages out of RepoDvP’s max price age.</span>
    </div>
  )
}
