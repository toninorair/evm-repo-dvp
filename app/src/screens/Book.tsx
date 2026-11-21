import { useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { Empty, Pill, Tween, party } from '../components/ui'
import type { LedgerEvent } from '../lib/backend'
import { networkName, repoDvP } from '../lib/config'
import { amount, ago, bps, date, duration, eur, eurCompact, price, tenor, time } from '../lib/format'
import { RepoStatus, collateralValue, defaultReason, isOpen, margin, same } from '../lib/repo'
import { useLedger, useNow } from '../lib/store'

type Filter = 'mine' | 'all' | 'open' | 'proposed' | 'closed'

const eventTone: Partial<Record<LedgerEvent['name'], string>> = {
  MarginCalled: 'var(--warn)',
  RepoDefaulted: 'var(--bad)',
}

function describe(e: LedgerEvent) {
  const a = e.args as Record<string, bigint> & { reason?: string }
  switch (e.name) {
    case 'RepoProposed':
      return `${eur(a.borrowAmount)} at ${bps(Number(a.repoRateBps))} · cap ${amount(a.maxCollateralAmount, 0)} nhBOND`
    case 'RepoOpened':
      return `DvP · ${amount(a.collateralAmount, 2)} nhBOND ⇄ ${eur(a.borrowAmount)}`
    case 'RepoSettled':
      return `RvP · ${eur(a.totalRepaid)} repaid`
    case 'MarginCalled':
      return `Collateral value ${eur(a.currentCollateralValue)}`
    case 'MarginToppedUp':
      return `+${amount(a.additionalCollateral, 2)} nhBOND posted`
    case 'RepoDefaulted':
      return `${amount(a.collateralSeized, 2)} nhBOND seized · ${a.reason}`
    case 'RepoCancelled':
      return 'Proposal withdrawn'
  }
}

export function Book() {
  const { snapshot, error, account, tab, href } = useLedger()
  const now = useNow()
  const [filter, setFilter] = useState<Filter>('mine')

  const view = useMemo(() => {
    if (!snapshot) return undefined
    const { repos, oracle } = snapshot
    const open = repos.filter((r) => isOpen(r.state.status))
    const cash = open.reduce((s, r) => s + r.order.borrowAmount, 0n)
    const units = open.reduce((s, r) => s + r.state.collateralAmount, 0n)
    const weighted = cash > 0n ? Number(open.reduce((s, r) => s + r.order.borrowAmount * BigInt(r.order.repoRateBps), 0n) / cash) : 0
    const calls = open.filter((r) => r.state.status === RepoStatus.MarginCalled)
    const nextCure = calls.map((r) => r.state.cureDeadline).sort((a, b) => a - b)[0]
    const mine = (r: (typeof repos)[number]) => same(r.order.borrower, account) || same(r.order.lender, account)
    const needsYou = repos.filter((r) => {
      if (!account) return false
      const s = r.state.status
      if (s === RepoStatus.Proposed) return same(r.order.lender, account) && r.order.acceptDeadline >= now
      if (s === RepoStatus.MarginCalled) return same(r.order.borrower, account) || (same(r.order.lender, account) && !!defaultReason(r, oracle.price, now))
      if (s === RepoStatus.Active) return same(r.order.lender, account) && !!defaultReason(r, oracle.price, now)
      return false
    })
    const rows = repos
      .filter((r) => {
        if (filter === 'mine') return mine(r)
        if (filter === 'open') return isOpen(r.state.status)
        if (filter === 'proposed') return r.state.status === RepoStatus.Proposed
        if (filter === 'closed') return r.state.status >= RepoStatus.Settled
        return true
      })
      .map((r) => ({ repo: r, m: isOpen(r.state.status) && oracle.price > 0n ? margin(r, oracle.price, now) : undefined }))
    return { cash, units, weighted, calls, nextCure, rows, needsYou, oracle, events: snapshot.events, count: repos.length, mineCount: repos.filter(mine).length }
  }, [snapshot, filter, now, account])

  if (!repoDvP)
    return (
      <Empty title="Point the console at a deployment">
        Set <code>VITE_REPO_DVP</code> in <code>app/.env</code> to the RepoDvP address printed by <code>script/deploy/DeployAll.s.sol</code>, then restart <code>npm run dev</code>. The token, oracle and identity registry addresses are read from the contract.
      </Empty>
    )
  if (error && !snapshot) return <Empty title="Can't reach the settlement contract">{error}</Empty>
  if (!view) return <Empty title={`Loading the repo book from ${networkName}…`} />

  const { oracle } = view
  const move = oracle.previousPrice ? Number(((oracle.price - oracle.previousPrice) * 10_000n) / oracle.previousPrice) : undefined
  const age = now - oracle.updatedAt

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>
      <section className="reveal" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
          <div className="eyebrow">
            {tab === 'borrower' ? 'Borrower' : 'Lender'} · {date(now)}, {time(now)}
          </div>
          <h1>{tab === 'borrower' ? 'Borrow cash against nhBOND.' : 'Lend cash, secured by nhBOND.'}</h1>
          <p className="muted" style={{ margin: 0, fontSize: 15, maxWidth: 600 }}>
            {tab === 'borrower'
              ? 'Propose a repo to a named lender, cure margin calls with extra collateral and settle to get your bonds back. Interest accrues Actual/360 per second.'
              : 'Accept proposals addressed to you; both legs settle in one transaction. Call margin when coverage drops below the threshold, and claim the collateral if the borrower defaults.'}
          </p>
        </div>
        {tab === 'borrower' && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a className="btn primary" href={href('/propose')}>
              Propose repo
            </a>
          </div>
        )}
      </section>

      {view.needsYou.length > 0 && (
        <section className="reveal" style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', padding: '14px 20px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', fontSize: 13 }}>
          <strong style={{ fontWeight: 600 }}>Waiting on you:</strong>
          {view.needsYou.map((r) => (
            <a key={String(r.id)} href={href(`/repo/${r.id}`)}>
              #{String(r.id).padStart(4, '0')} · {r.state.status === RepoStatus.Proposed ? 'accept or let lapse' : r.state.status === RepoStatus.MarginCalled && same(r.order.borrower, account) ? 'cure the margin call' : 'default claimable'}
            </a>
          ))}
        </section>
      )}

      <section aria-label="Book summary" className="stats reveal d1">
        <div>
          <span className="small muted">Cash outstanding</span>
          <span className="figure" style={{ fontSize: 36 }}>
            <Tween value={Number(formatUnits(view.cash, 18))} format={(n) => eurCompact(BigInt(Math.round(n)) * 10n ** 18n)} />
          </span>
          <span className="small muted">{view.rows.filter((r) => r.m).length || 'No'} open trades shown · nhEUR</span>
        </div>
        <div>
          <span className="small muted">Collateral in escrow (MTM)</span>
          <span className="figure" style={{ fontSize: 36 }}>
            <Tween value={Number(formatUnits(collateralValue(view.units, oracle.price), 18))} format={(n) => eurCompact(BigInt(Math.round(n)) * 10n ** 18n)} />
          </span>
          <span className="small muted">{amount(view.units, 2)} nhBOND at NAV</span>
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
            {view.nextCure ? (view.nextCure > now ? `Next cure deadline in ${duration(view.nextCure - now)}` : 'A cure window has expired') : 'No outstanding calls'}
          </span>
        </div>
      </section>

      <section className="split">
        <div className="main reveal d2" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <h2>Positions</h2>
            <div role="group" aria-label="Filter positions" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {(
                [
                  ['mine', `Mine · ${view.mineCount}`],
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
                {view.rows.map(({ repo, m }) => {
                  const closed = repo.state.status >= RepoStatus.Settled
                  const expired = repo.state.status === RepoStatus.Proposed && repo.order.acceptDeadline < now
                  return (
                    <tr key={String(repo.id)} className={closed || expired ? 'closed' : ''} onClick={() => (window.location.hash = href(`/repo/${repo.id}`))}>
                      <td>
                        <a href={href(`/repo/${repo.id}`)} style={{ color: 'var(--ink)' }}>
                          #{String(repo.id).padStart(4, '0')}
                        </a>
                      </td>
                      <td>{party(repo.order.borrower, account)}</td>
                      <td>{party(repo.order.lender, account)}</td>
                      <td className="num">{eur(repo.order.borrowAmount)}</td>
                      <td className="num">{bps(repo.order.repoRateBps)}</td>
                      <td>
                        {repo.state.maturity ? `${date(repo.state.maturity)} ${time(repo.state.maturity)}` : '—'} · {tenor(repo.order.termSeconds)}
                      </td>
                      <td className="num" style={{ color: m && !m.healthy ? 'var(--warn-strong)' : undefined }}>
                        {m ? bps(m.coverageBps, 1) : '—'}
                      </td>
                      <td>
                        <Pill status={repo.state.status}>{expired ? 'Expired' : undefined}</Pill>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {view.rows.length === 0 && (
              <p className="muted" style={{ padding: '24px 0' }}>
                {filter === 'mine' ? (account ? `No repos involve this ${tab} wallet yet. ` : `Connect the ${tab} wallet to see its repos. `) : 'No positions match this filter. '}
                {tab === 'borrower' ? <a href={href('/propose')}>Propose one</a> : filter === 'mine' && account ? 'Proposals addressed to you appear here.' : null}
              </p>
            )}
          </div>
        </div>

        <aside className="side reveal d3" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <h3>Collateral Oracle</h3>
              <span className="small" style={{ color: oracle.invalid ? 'var(--bad)' : 'var(--ok)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {!oracle.invalid && <span className="pulse-dot" aria-hidden="true" />}
                {oracle.invalid ? 'No NAV' : 'Live'}
              </span>
            </div>
            <div className="small muted">nhNAVOracle · {oracle.description}</div>
            <div className="figure" style={{ fontSize: 40 }}>
              <Tween value={Number(oracle.price) / 1e8} format={(n) => price(BigInt(Math.round(n * 1e8)))} />
              <span className="muted" style={{ fontFamily: 'var(--sans)', fontSize: 14, marginLeft: 8 }}>
                per nhBOND
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, fontSize: 12 }}>
              {[
                ['Last update', oracle.updatedAt ? `${time(oracle.updatedAt)} · ${ago(age)}` : '—'],
                ['Change vs previous', move === undefined ? '—' : `${move > 0 ? '+' : move < 0 ? '−' : ''}${Math.abs(move)} bps`],
                ['Round', String(oracle.roundId)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <span className="muted">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            {oracle.invalid && <p className="small" style={{ margin: 0, color: 'var(--bad)' }}>No valid NAV: accepting, margin calls, top-ups and defaults revert until the calculation agent posts one (Market tab).</p>}
          </div>

          <div>
            <h3 style={{ marginBottom: 12 }}>Settlement Events</h3>
            {!snapshot!.historyComplete && <p className="muted small">Scanning older blocks…</p>}
            {view.events.length === 0 && snapshot!.historyComplete && <p className="muted small">No events yet.</p>}
            {view.events.slice(0, 8).map((e, i) => (
              <a
                key={e.key}
                href={href(`/repo/${e.repoId}`)}
                className="reveal"
                style={{
                  animationDelay: `${240 + i * 50}ms`,
                  display: 'flex',
                  gap: 14,
                  padding: '14px 0',
                  borderTop: '1px solid var(--line)',
                  borderBottom: i === Math.min(7, view.events.length - 1) ? '1px solid var(--line)' : undefined,
                  textDecoration: 'none',
                  color: 'var(--ink)',
                }}
              >
                <span className="small muted" style={{ width: 52, flexShrink: 0 }}>
                  {!e.timestamp ? '…' : now - e.timestamp < 86_400 ? time(e.timestamp) : date(e.timestamp)}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 500, color: eventTone[e.name] }}>{e.name}</span>
                  <span className="small muted">
                    #{String(e.repoId).padStart(4, '0')} · {describe(e)}
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
