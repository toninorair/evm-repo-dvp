import { dateTime, tenor } from '../../lib/format'
import { RepoStatus, isOpen, type Repo } from '../../lib/repo'

export function Lifecycle({ repo, now }: { repo: Repo; now: number }) {
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
  const progress = started && repo.order.termSeconds > 0 ? Math.min(100, Math.round(((now - repo.state.startTime) / repo.order.termSeconds) * 100)) : 0
  const steps = [
    {
      n: '01',
      t: 'Proposed',
      d: s === RepoStatus.Proposed ? `Accept by ${dateTime(repo.order.acceptDeadline)}` : 'Proposal submitted',
      cls: s === RepoStatus.Proposed ? (now > repo.order.acceptDeadline ? 'now bad' : 'now') : 'done',
    },
    {
      n: '02',
      t: 'Opened · DvP',
      d: started ? dateTime(repo.state.startTime) : 'On acceptance',
      cls: started ? 'done' : '',
    },
    {
      n: s === RepoStatus.MarginCalled ? '03 · now' : '03',
      t: s === RepoStatus.MarginCalled ? 'Margin called' : 'Accruing',
      d: started ? (closed ? 'Complete' : `${progress}% of term`) : 'Interest per second',
      cls: started ? (isOpen(s) ? `now ${s === RepoStatus.MarginCalled ? 'warn' : ''}` : 'done') : '',
    },
    {
      n: '04',
      t: 'Maturity',
      d: repo.state.maturity ? dateTime(repo.state.maturity) : `${tenor(repo.order.termSeconds)} after opening`,
      cls: closed && started ? 'done' : isOpen(s) && now > repo.state.maturity ? 'now bad' : '',
    },
    { n: '05', ...final },
  ]

  return (
    <section aria-label="Lifecycle" className="steps reveal d1" style={{ borderTopColor: 'var(--ink)' }}>
      {steps.map((st) => (
        <div key={st.n} className={st.cls}>
          <span className={`small${st.cls.startsWith('now') ? '' : ' muted'}`}>{st.n}</span>
          <span className="fw-500">{st.t}</span>
          <span className="small muted">{st.d}</span>
        </div>
      ))}
    </section>
  )
}
