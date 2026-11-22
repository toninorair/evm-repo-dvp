import { AddressLink, Empty, Pill } from '../components/ui'
import { bps, duration, eur, formatRepoId, tenor, time } from '../lib/format'
import { RepoStatus, isOpen, margin, same } from '../lib/repo'
import { useLedger, useNow } from '../lib/store'
import { AcceptPanel, DefaultPanel, MarginPanel, Outcome, SettlePanel } from './position/ActionPanels'
import { Figures } from './position/Figures'
import { Legs } from './position/Legs'
import { Lifecycle } from './position/Lifecycle'
import { Terms } from './position/Terms'
import { TopUp } from './position/TopUp'

export function Position({ id }: { id: bigint }) {
  const { snapshot, account, tab, href } = useLedger()
  const now = useNow()
  const repo = snapshot?.repos.find((r) => r.id === id)

  if (!snapshot) return <Empty title="Loading position…" />
  if (!repo) {
    return (
      <Empty title={`Repo ${formatRepoId(id)} not found`}>
        It may be older than the 200 most recent agreements, or the id is wrong. <a href={href('/')}>Back to positions</a>.
      </Empty>
    )
  }

  const { oracle } = snapshot
  const s = repo.state.status
  const open = isOpen(s)
  const m = margin(repo, oracle.price, now)
  const isBorrower = same(account, repo.order.borrower)
  const isLender = same(account, repo.order.lender)
  const label = formatRepoId(repo.id)
  const expired = s === RepoStatus.Proposed && now > repo.order.acceptDeadline
  const cureLeft = s === RepoStatus.MarginCalled ? repo.state.cureDeadline - now : 0
  const cureProgress = repo.order.curePeriodSeconds > 0 ? Math.max(0, Math.min(100, (1 - cureLeft / repo.order.curePeriodSeconds) * 100)) : 100
  const role = isBorrower ? 'You are the borrower' : isLender ? 'You are the lender' : account ? `This ${tab} wallet is not a party to this repo` : `Connect the ${tab} wallet to act`

  return (
    <div className="stack gap-10">
      {s === RepoStatus.MarginCalled && (
        <div className="reveal banner warn banner-spread">
          <span>
            <strong style={{ fontWeight: 600 }}>Margin call on {label}.</strong>{' '}
            {cureLeft > 0
              ? now > repo.state.maturity
                ? 'Maturity has passed without repayment. The lender may close out.'
                : `The borrower has until ${time(repo.state.cureDeadline)} to top up or settle.`
              : !m.healthy
                ? 'The cure window has expired. The lender may close out.'
                : now > repo.state.maturity
                  ? 'Maturity has passed without repayment. The lender may close out.'
                  : 'The cure window has passed, but coverage is back above the threshold, so default cannot be claimed.'}
          </span>
          {repo.history.marginCalledValue !== undefined && <span>Collateral value at call {eur(repo.history.marginCalledValue)}</span>}
        </div>
      )}

      <section className="reveal page-hero">
        <div className="page-intro">
          <a href={href('/')} className="small muted back-link">
            ← Positions
          </a>
          <div className="cluster">
            <h1>Repo {label}</h1>
            <Pill status={s}>{expired ? 'Expired' : undefined}</Pill>
          </div>
          <p className="muted lead">
            <AddressLink address={repo.order.borrower} me={account} /> {isBorrower ? 'borrow' : 'borrows'} {eur(repo.order.borrowAmount)} from{' '}
            <AddressLink address={repo.order.lender} me={account} /> against nhBOND · {tenor(repo.order.termSeconds)} at {bps(repo.order.repoRateBps)} · {role}
          </p>
        </div>
        {s === RepoStatus.MarginCalled && (
          <div className="stack gap-1" style={{ alignItems: 'flex-end' }}>
            <span className="eyebrow text-warn">Cure window remaining</span>
            <span className={`figure tick fig-2xl${cureLeft > 0 ? '' : ' text-bad'}`}>{cureLeft > 0 ? duration(cureLeft) : 'Expired'}</span>
            <div aria-hidden="true" className="cure-bar">
              <div className="cure-bar-fill" style={{ width: `${cureProgress}%` }} />
            </div>
            <span className="small muted">
              of {duration(repo.order.curePeriodSeconds)} · deadline {time(repo.state.cureDeadline)}
            </span>
          </div>
        )}
      </section>

      <Lifecycle repo={repo} now={now} />

      <section className="split">
        <div className="main stack gap-8">
          <Figures repo={repo} now={now} />
          {open && isBorrower && <TopUp repo={repo} />}
          <Legs repo={repo} now={now} />
          <Terms repo={repo} />
        </div>

        <aside className="side reveal d2 stack gap-6">
          {s === RepoStatus.Proposed && <AcceptPanel repo={repo} />}
          {open && <MarginPanel repo={repo} />}
          {open && <SettlePanel repo={repo} />}
          {open && <DefaultPanel repo={repo} />}
          {!open && s !== RepoStatus.Proposed && <Outcome repo={repo} />}
        </aside>
      </section>
    </div>
  )
}
