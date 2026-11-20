import { useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { Empty, Pill, Tween, party } from '../components/ui'
import { ago, bps, date, duration, eur, eurCompact, price, tenor, time } from '../lib/format'
import { RepoStatus, collateralValue, isOpen, marginStatus } from '../lib/repo'
import { useLedger, useNow } from '../lib/store'

type Filter = 'all' | 'open' | 'proposed' | 'closed'

const eventTone: Record<string, string> = {
  MarginCallTriggered: 'var(--warn)',
  RepoDefaulted: 'var(--bad)',
}

export function Book() {
  const { snapshot, error, account } = useLedger()
  const now = useNow()
  const [filter, setFilter] = useState<Filter>('all')

  const view = useMemo(() => {
    if (!snapshot) return undefined
    const { repos, oracle, risk } = snapshot
    const open = repos.filter((r) => isOpen(r.state.status))
    const cash = open.reduce((s, r) => s + r.terms.cashAmount, 0n)
    const units = open.reduce((s, r) => s + r.terms.collateralAmount, 0n)
    const weighted = cash > 0n ? Number(open.reduce((s, r) => s + r.terms.cashAmount * BigInt(r.terms.repoRateBps), 0n) / cash) : 0
    const calls = open.filter((r) => r.state.status === RepoStatus.MarginCalled)
    const nextCure = calls.map((r) => r.state.cureDeadline).sort((a, b) => a - b)[0]
    const rows = repos
      .filter((r) => {
        if (filter === 'open') return isOpen(r.state.status)
        if (filter === 'proposed') return r.state.status === RepoStatus.Proposed
        if (filter === 'closed') return r.state.status >= RepoStatus.Settled
        return true
      })
      .map((r) => ({ repo: r, margin: isOpen(r.state.status) ? marginStatus(r, oracle.price, now, risk) : undefined }))
    return { cash, units, weighted, calls, nextCure, rows, oracle, risk, events: snapshot.events, count: repos.length }
  }, [snapshot, filter, now])

  if (error && !snapshot) return <Empty title="Can't reach the settlement contract">{error}</Empty>
  if (!view) return <Empty title="Loading the repo book…" />

  const { oracle } = view
  const dayMove = oracle.previousPrice ? Number(((oracle.price - oracle.previousPrice) * 10_000n) / oracle.previousPrice) : 0
  const breakerPct = Math.min(100, (Math.abs(dayMove) / Math.max(1, oracle.maxDeviationBps)) * 50)
  const sinceAttest = now - oracle.updatedAt

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>
      <section className="reveal" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
          <div className="eyebrow">Repo book · {date(now)}, {time(now)}</div>
          <h1>Tokenised repo, settled atomically.</h1>
          <p className="muted" style={{ margin: 0, fontSize: 15, maxWidth: 600 }}>
            Every open trade settled both legs in a single transaction: nhBOND into escrow, nhEUR to the borrower. Actual/360 accrual and mark-to-market run continuously.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a className="btn primary" href="#/propose">
            Propose repo
          </a>
          {view.calls[0] && (
            <a className="btn" href={`#/repo/${view.calls[0].id}`}>
              Review margin call
            </a>
          )}
        </div>
      </section>

      <section aria-label="Book summary" className="stats reveal d1">
        <div>
          <span className="small muted">Cash outstanding</span>
          <span className="figure" style={{ fontSize: 36 }}>
            <Tween value={Number(formatUnits(view.cash, 18))} format={(n) => eurCompact(BigInt(Math.round(n)) * 10n ** 18n)} />
          </span>
          <span className="small muted">{view.rows.filter((r) => r.margin).length || 'No'} open trades · nhEUR</span>
        </div>
        <div>
          <span className="small muted">Collateral in escrow (MTM)</span>
          <span className="figure" style={{ fontSize: 36 }}>
            <Tween value={Number(formatUnits(collateralValue(view.units, oracle.price), 18))} format={(n) => eurCompact(BigInt(Math.round(n)) * 10n ** 18n)} />
          </span>
          <span className="small muted">{Number(formatUnits(view.units, 18)).toLocaleString('en-US')} nhBOND at NAV</span>
        </div>
        <div>
          <span className="small muted">Weighted repo rate</span>
          <span className="figure" style={{ fontSize: 36 }}>
            <Tween value={view.weighted} format={(n) => bps(n)} />
          </span>
          <span className="small muted">Actual/360 · per-second accrual</span>
        </div>
        <div>
          <span className="small muted">Open margin calls</span>
          <span className="figure" style={{ fontSize: 36, color: view.calls.length ? 'var(--warn-strong)' : undefined }}>{view.calls.length}</span>
          <span className="small" style={{ color: view.calls.length ? 'var(--warn)' : 'var(--muted)' }}>
            {view.nextCure ? (view.nextCure > now ? `Next cure deadline in ${duration(view.nextCure - now)}` : 'Cure window expired') : 'All positions above threshold'}
          </span>
        </div>
      </section>

      <section className="split">
        <div className="main reveal d2" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <h2>Positions</h2>
            <div role="group" aria-label="Filter by status" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {(
                [
                  ['all', `All · ${view.count}`],
                  ['open', 'Open'],
                  ['proposed', 'Proposed'],
                  ['closed', 'Closed'],
                ] as [Filter, string][]
              ).map(([k, label]) => (
                <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }} className="rule-top">
            <table className="book">
              <thead>
                <tr>
                  <th scope="col">Repo</th>
                  <th scope="col">Borrower</th>
                  <th scope="col">Lender</th>
                  <th scope="col" className="num">Cash</th>
                  <th scope="col" className="num">Rate</th>
                  <th scope="col">Maturity</th>
                  <th scope="col" className="num">Coverage</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map(({ repo, margin }) => {
                  const closed = repo.state.status >= RepoStatus.Settled
                  const go = () => (window.location.hash = `#/repo/${repo.id}`)
                  return (
                    <tr key={String(repo.id)} className={closed ? 'closed' : ''} onClick={go}>
                      <td>
                        <a href={`#/repo/${repo.id}`} style={{ color: 'var(--ink)' }}>
                          #{String(repo.id).padStart(4, '0')}
                        </a>
                      </td>
                      <td>{party(repo.terms.borrower, account)}</td>
                      <td>{party(repo.terms.lender, account)}</td>
                      <td className="num">{eur(repo.terms.cashAmount)}</td>
                      <td className="num">{bps(repo.terms.repoRateBps)}</td>
                      <td>
                        {repo.state.maturity ? date(repo.state.maturity) : '—'} · {tenor(repo.terms.tenorSeconds)}
                      </td>
                      <td className="num" style={{ color: margin && !margin.healthy ? 'var(--warn-strong)' : undefined }}>
                        {margin ? bps(margin.ratioBps, 1) : '—'}
                      </td>
                      <td>
                        <Pill status={repo.state.status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {view.rows.length === 0 && <p className="muted" style={{ padding: '24px 0' }}>No positions match this filter.</p>}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Coverage = collateral value ÷ repurchase price. Maintenance threshold {bps(10_000 + view.risk.maintenanceMarginBps)}; anyone may trigger a margin call below it.
          </p>
        </div>

        <aside className="side reveal d3" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <h3>Collateral oracle</h3>
              <span className="small" style={{ color: oracle.stale ? 'var(--bad)' : 'var(--ok)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {!oracle.stale && <span className="pulse-dot" aria-hidden="true" />}
                {oracle.stale ? 'Stale' : 'Live'}
              </span>
            </div>
            <div className="small muted">nhNAVOracle · {oracle.description}</div>
            <div className="figure" style={{ fontSize: 40 }}>
              <Tween value={Number(oracle.price) / 1e8} format={(n) => price(BigInt(Math.round(n * 1e8)))} />
              <span className="muted" style={{ fontFamily: 'var(--sans)', fontSize: 14, marginLeft: 8 }}>
                per unit
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, fontSize: 12 }}>
              {[
                ['Last attestation', oracle.updatedAt ? `${time(oracle.updatedAt)} · ${ago(sinceAttest)}` : '—'],
                ['Heartbeat', `${duration(oracle.maxStaleness)} · ${oracle.stale ? 'missed' : 'fresh'}`],
                ['Day move', oracle.previousPrice ? `${dayMove > 0 ? '+' : dayMove < 0 ? '−' : ''}${Math.abs(dayMove)} bps` : '—'],
                ['Breaker', `±${oracle.maxDeviationBps} bps · armed`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <span className="muted">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            <div aria-hidden="true" style={{ height: 6, background: 'var(--track)', position: 'relative' }}>
              <div style={{ position: 'absolute', left: '50%', top: -3, width: 1, height: 12, background: 'var(--ink)' }} />
              <div
                style={{
                  position: 'absolute',
                  height: 6,
                  background: 'var(--accent)',
                  left: dayMove < 0 ? `${50 - breakerPct}%` : '50%',
                  width: `${breakerPct}%`,
                  transition: 'all 700ms var(--ease)',
                }}
              />
            </div>
            <div className="row muted" style={{ fontSize: 11 }}>
              <span>−{oracle.maxDeviationBps}</span>
              <span>0</span>
              <span>+{oracle.maxDeviationBps} bps</span>
            </div>
          </div>

          <div>
            <h3 style={{ marginBottom: 12 }}>Settlement events</h3>
            {view.events.length === 0 && <p className="muted small">No events yet.</p>}
            {view.events.slice(0, 6).map((e, i) => (
              <a
                key={e.key}
                href={`#/repo/${e.repoId}`}
                className="reveal"
                style={{
                  animationDelay: `${240 + i * 50}ms`,
                  display: 'flex',
                  gap: 14,
                  padding: '14px 0',
                  borderTop: '1px solid var(--line)',
                  borderBottom: i === Math.min(5, view.events.length - 1) ? '1px solid var(--line)' : undefined,
                  textDecoration: 'none',
                  color: 'var(--ink)',
                }}
              >
                <span className="small muted" style={{ width: 52, flexShrink: 0 }}>
                  {now - e.timestamp < 86_400 ? time(e.timestamp) : date(e.timestamp)}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 500, color: eventTone[e.name] }}>{e.name}</span>
                  <span className="small muted">
                    #{String(e.repoId).padStart(4, '0')} · {e.detail}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </aside>
      </section>
    </div>
  )
}
