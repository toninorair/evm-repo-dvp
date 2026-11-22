import type { ReactNode } from 'react'
import { AddressLink, TxLink } from '../../components/ui'
import { amount, dateTime, duration, tenor } from '../../lib/format'
import type { Repo } from '../../lib/repo'
import { useLedger } from '../../lib/store'

export function Terms({ repo }: { repo: Repo }) {
  const { account } = useLedger()
  const o = repo.order
  const rows: [string, ReactNode][] = [
    ['Borrower', <AddressLink address={o.borrower} me={account} />],
    ['Lender', <AddressLink address={o.lender} me={account} />],
    ['Borrow amount', `${amount(o.borrowAmount)} nhEUR`],
    ['Repo rate', `${o.repoRateBps} bps`],
    ['Initial margin', `${o.initialMarginBps} bps`],
    ['Maintenance margin', `${o.maintenanceMarginBps} bps`],
    ['Term', `${tenor(o.termSeconds)} · ${o.termSeconds.toLocaleString('en-US')} s`],
    ['Cure period', `${duration(o.curePeriodSeconds)} · ${o.curePeriodSeconds.toLocaleString('en-US')} s`],
    ['Accept by', dateTime(o.acceptDeadline)],
    ['Collateral cap', `${amount(o.maxCollateralAmount, 4)} nhBOND`],
  ]

  return (
    <div className="reveal d3 stack gap-3">
      <h2>Contract Terms</h2>
      <dl className="terms">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {repo.history.txs.proposed && (
        <span className="small muted">
          <TxLink hash={repo.history.txs.proposed}>View Transaction</TxLink>
        </span>
      )}
    </div>
  )
}
