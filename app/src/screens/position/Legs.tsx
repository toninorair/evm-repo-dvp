import type { ReactNode } from 'react'
import { AddressLink, TxLink } from '../../components/ui'
import { amount, dateTime } from '../../lib/format'
import { RepoStatus, isOpen, repurchasePrice, type Repo } from '../../lib/repo'
import { useLedger } from '../../lib/store'

function LegFlow({ from, to, value, last = false }: { from: ReactNode; to: ReactNode; value: string; last?: boolean }) {
  return (
    <>
      <div className="leg-flow">
        <span>{from}</span>
        <span aria-hidden="true" className="muted">
          →
        </span>
        <span className="leg-flow-to">{to}</span>
      </div>
      <div className={`leg-amount${last ? ' last' : ''}`}>{value}</div>
    </>
  )
}

export function Legs({ repo, now }: { repo: Repo; now: number }) {
  const { account } = useLedger()
  const s = repo.state.status
  const started = repo.state.startTime > 0
  const settled = repo.history.settled
  const defaulted = repo.history.defaulted
  const borrower = <AddressLink address={repo.order.borrower} me={account} />
  const lender = <AddressLink address={repo.order.lender} me={account} />
  const opened = repo.history.openedCollateral
  const closed = !!(settled || defaulted)

  return (
    <div className="reveal d2 stack gap-4">
      <h2>Settlement Legs</h2>
      <div className="leg-grid">
        <div className={started ? 'panel leg-box' : 'leg-box pending'}>
          <div className="row row-baseline">
            <span className="fw-500">Opening leg · DvP</span>
            <span className={`small ${started ? 'text-ok' : 'muted'}`}>{started ? 'Settled' : s === RepoStatus.Cancelled ? 'Never opened' : 'On acceptance'}</span>
          </div>
          <div className="stack gap-3">
            <LegFlow from={borrower} to="DvP Repo Contract" value={opened !== undefined ? `${amount(opened, 4)} nhBOND` : 'Sized at the NAV on acceptance'} />
            <LegFlow from={lender} to={borrower} value={`${amount(repo.order.borrowAmount)} nhEUR`} last />
          </div>
          <div className="small muted">
            {started ? (
              <TxLink hash={repo.history.txs.opened}>View Transaction</TxLink>
            ) : (
              'Both legs settle atomically on acceptance, or the transaction reverts.'
            )}
          </div>
        </div>
        <div className={closed ? 'panel leg-box' : 'leg-box pending'}>
          <div className="row row-baseline">
            <span className="fw-500">{defaulted ? 'Close-out · default' : 'Closing leg · RvP'}</span>
            <span className={`small ${settled ? 'text-ok' : defaulted ? 'text-bad' : 'muted'}`}>
              {settled ? 'Settled' : defaulted ? defaulted.reason : started ? `Due ${dateTime(repo.state.maturity)}` : 'Pending'}
            </span>
          </div>
          <div className="stack gap-3">
            {defaulted ? (
              <>
                <LegFlow from="DvP Repo Contract" to={lender} value={`${amount(defaulted.seized, 4)} nhBOND seized`} />
                <LegFlow from="DvP Repo Contract" to={borrower} value={`${amount(defaulted.surplus, 4)} nhBOND surplus`} last />
              </>
            ) : (
              <>
                <LegFlow
                  from={borrower}
                  to={lender}
                  value={`${amount(settled ? settled.totalRepaid : isOpen(s) ? repurchasePrice(repo, now) : repo.order.borrowAmount)} nhEUR`}
                />
                <LegFlow
                  from="DvP Repo Contract"
                  to={borrower}
                  value={settled ? `${amount(settled.collateralReturned, 4)} nhBOND` : isOpen(s) ? `${amount(repo.state.collateralAmount, 4)} nhBOND` : 'All locked nhBOND'}
                  last
                />
              </>
            )}
          </div>
          <div className="small muted">
            {closed ? <TxLink hash={repo.history.txs.closed}>View Transaction</TxLink> : 'The borrower may settle at any time; interest stops at the settlement second.'}
          </div>
        </div>
      </div>
    </div>
  )
}
