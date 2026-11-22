import { useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { Tween } from '../../components/ui'
import { backend } from '../../lib/backend'
import { amount, bps, eur, parseDecimal } from '../../lib/format'
import { BPS, RepoStatus, margin, unitsFor, type Repo } from '../../lib/repo'
import { useLedger, useNow } from '../../lib/store'

export function TopUp({ repo }: { repo: Repo }) {
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
  const units = useMemo(() => parseDecimal(input, 18), [input])
  const after = margin({ ...repo, state: { ...repo.state, collateralAmount: repo.state.collateralAmount + units } }, nav, now)
  const free = checks ? checks.bondBalance - checks.bondFrozenTokens : undefined
  const short = free !== undefined && free < units
  const called = repo.state.status === RepoStatus.MarginCalled

  return (
    <div className="reveal d1 stack gap-5">
      <h2>{called ? 'Cure the margin call' : 'Top up collateral'}</h2>
      <div className="panel stack gap-5" style={{ borderColor: called ? 'var(--ink)' : undefined, padding: 28 }}>
        <div className="row row-baseline" style={{ flexWrap: 'wrap' }}>
          <span className="fw-500" style={{ fontSize: 15 }}>
            Post more nhBOND to escrow
          </span>
          <span className="small muted">Top Up Collateral</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label htmlFor="topup">nhBOND to post{free !== undefined ? ` · ${amount(free, 2)} available` : ''}</label>
            <input id="topup" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} style={{ fontSize: 18, height: 48, background: '#fff' }} />
          </div>
          <div className="cluster-sm">
            <button type="button" className="btn quiet lg" disabled={toThreshold === 0n} onClick={() => setInput(formatUnits(toThreshold, 18))}>
              Minimum
            </button>
            <button type="button" className="btn quiet lg" disabled={toInitial === 0n} onClick={() => setInput(formatUnits(toInitial, 18))}>
              Back to {bps(10_000 + repo.order.initialMarginBps, 0)}
            </button>
          </div>
        </div>
        <div className="topup-grid">
          <div className="stack gap-1">
            <span className="small muted">New collateral value</span>
            <span style={{ fontSize: 15 }}>{eur(after.value)}</span>
          </div>
          <div className="stack gap-1">
            <span className="small muted">New coverage</span>
            <span className={after.healthy ? 'text-ok' : 'text-bad'} style={{ fontSize: 15 }}>
              <Tween value={after.coverageBps} ms={300} format={(n) => bps(n)} />
            </span>
          </div>
          <div className="stack gap-1">
            <span className="small muted">Result</span>
            <span className={`fw-500 ${after.healthy ? 'text-ok' : 'text-bad'}`} style={{ fontSize: 15 }}>
              {after.healthy ? (called ? 'Clears the call → Active' : 'Above threshold') : `Still below ${bps(m.thresholdBps)}`}
            </span>
          </div>
        </div>
        {short && <span className="small text-bad">Your wallet holds less free nhBOND than this.</span>}
        <button type="button" className="btn primary block lg" disabled={busy || units <= 0n || short} onClick={() => run('Top-up', (st) => backend.topUp(repo, units, st))}>
          Approve and post {amount(units, 2)} nhBOND
        </button>
        <span className="small muted">The call clears in the same transaction once coverage is back above {bps(m.thresholdBps)}. The requirement creeps up as interest accrues.</span>
      </div>
    </div>
  )
}
