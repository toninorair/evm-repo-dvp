import { formatEther } from 'viem'
import { AddressLink, Check, Empty } from '../components/ui'
import { networkName } from '../lib/config'
import { amount, eur } from '../lib/format'
import { collateralValue, same } from '../lib/repo'
import { useLedger } from '../lib/store'

/** The current tab's wallet: identity, balances, approvals and validations. */
export function Desk() {
  const { snapshot, account, checks, connect, tab, href } = useLedger()

  if (!account) {
    return (
      <Empty title={`Connect the ${tab} wallet`}>
        <button type="button" className="btn primary" onClick={connect} style={{ marginTop: 12 }}>
          Connect {tab} wallet
        </button>
      </Empty>
    )
  }
  if (!snapshot || !checks) return <Empty title="Reading your wallet…" />

  const mine = snapshot.repos.filter((r) => same(r.order.borrower, account) || same(r.order.lender, account))
  const free = checks.bondBalance - checks.bondFrozenTokens
  const gasLabel = networkName === 'Sepolia' ? 'Sepolia ETH' : 'ETH'

  return (
    <div className="stack gap-10">
      <section className="reveal page-intro">
        <a href={href('/')} className="small muted back-link">
          ← Positions
        </a>
        <h1>{tab === 'borrower' ? 'Borrower' : 'Lender'} Wallet</h1>
        <p className="muted lead" style={{ wordBreak: 'break-all' }}>
          <AddressLink address={account} full />
        </p>
      </section>

      {!checks.verified && (
        <section className="reveal banner bad">
          This wallet is not registered in the ERC-3643 identity registry, so RepoDvP and both tokens will reject it. Onboard it in the{' '}
          <a href={`#/operator?wallet=${account}`}>Operator</a> tab with the operator wallet.
        </section>
      )}

      <section className="stats three reveal d1">
        <div>
          <span className="small muted">nhBOND · collateral</span>
          <span className="figure fig-sm">{amount(checks.bondBalance, 2)}</span>
          <span className="small muted">
            {checks.bondFrozenTokens > 0n ? `${amount(checks.bondFrozenTokens, 2)} frozen · ` : ''}worth {eur(collateralValue(free, snapshot.oracle.price))}
          </span>
        </div>
        <div>
          <span className="small muted">nhEUR · cash</span>
          <span className="figure fig-sm">{eur(checks.cashBalance)}</span>
          <span className="small muted">Tokenised deposit</span>
        </div>
        <div>
          <span className="small muted">{gasLabel}</span>
          <span className="figure fig-sm">{Number(formatEther(checks.gas)).toFixed(4)}</span>
          <span className="small muted">For gas</span>
        </div>
      </section>

      <section className="reveal d2 stack gap-4">
        <h2>Validations</h2>
        <div className="panel panel-pad stack gap-3" style={{ fontSize: 13 }}>
          <Check label="Identity verified · ERC-3643 registry" ok={checks.verified} fail="Not verified" />
          <Check label="nhBOND wallet not frozen" ok={!checks.bondFrozen} fail="Frozen" />
          <Check label="nhEUR wallet not frozen" ok={!checks.cashFrozen} fail="Frozen" />
          <Check label="nhBOND contract not paused" ok={!checks.bondPaused} fail="Paused" />
          <Check label="nhEUR contract not paused" ok={!checks.cashPaused} fail="Paused" />
          <div className="row row-divider">
            <span className="muted">nhBOND approved to RepoDvP</span>
            <span>{amount(checks.bondAllowance, 4)}</span>
          </div>
          <div className="row">
            <span className="muted">nhEUR approved to RepoDvP</span>
            <span>{eur(checks.cashAllowance)}</span>
          </div>
        </div>
        {mine.length > 0 && (
          <p className="small muted" style={{ margin: 0 }}>
            Your repos are listed under <a href={href('/')}>Positions</a>.
          </p>
        )}
      </section>
    </div>
  )
}
