import { formatUnits } from 'viem'
import { Tween } from '../../components/ui'
import { eur, price } from '../../lib/format'
import { INTEREST_DENOMINATOR, RepoStatus, collateralValue, interest, isOpen, openingCollateral, repurchasePrice, type Repo } from '../../lib/repo'
import { useLedger } from '../../lib/store'

export function Figures({ repo, now }: { repo: Repo; now: number }) {
  const { snapshot } = useLedger()
  const nav = snapshot!.oracle.price
  const s = repo.state.status
  const open = isOpen(s)
  const perSecond = Number(formatUnits((repo.order.borrowAmount * BigInt(repo.order.repoRateBps)) / INTEREST_DENOMINATOR, 18))
  const pastMaturity = open && now > repo.state.maturity
  const atMaturity = repo.order.borrowAmount + (repo.order.borrowAmount * BigInt(repo.order.repoRateBps) * BigInt(repo.order.termSeconds)) / INTEREST_DENOMINATOR
  const settled = repo.history.settled
  const owedAtDefault = repo.history.defaulted?.amountOwed
  const escrow = open
    ? repo.state.collateralAmount
    : s === RepoStatus.Proposed
      ? openingCollateral(repo.order.borrowAmount, repo.order.initialMarginBps, nav)
      : (settled?.collateralReturned ?? repo.history.defaulted?.seized ?? 0n)

  return (
    <div className="stats three reveal d1" style={{ borderTop: 0 }}>
      <div>
        <span className="small muted">
          {open ? 'Accrued interest · Act/360' : settled ? 'Interest paid' : owedAtDefault !== undefined ? 'Interest owed at default' : 'Interest to maturity'}
        </span>
        <span className="figure tick fig-sm">
          {eur(
            open
              ? interest(repo, now)
              : settled
                ? settled.totalRepaid - repo.order.borrowAmount
                : owedAtDefault !== undefined
                  ? owedAtDefault - repo.order.borrowAmount
                  : atMaturity - repo.order.borrowAmount,
          )}
        </span>
        <span className="small muted">{open ? `+€${perSecond.toFixed(4)} / second${pastMaturity ? ' · past maturity' : ''}` : ' '}</span>
      </div>
      <div>
        <span className="small muted">
          {open ? 'Repurchase price if settled now' : settled ? 'Repaid' : owedAtDefault !== undefined ? 'Owed at close-out' : 'Repurchase price at maturity'}
        </span>
        <span className="figure tick fig-sm">{eur(open ? repurchasePrice(repo, now) : settled ? settled.totalRepaid : (owedAtDefault ?? atMaturity))}</span>
        <span className="small muted">At maturity {eur(atMaturity)}</span>
      </div>
      <div>
        <span className="small muted">
          {open
            ? 'Collateral in DvP Repo Contract'
            : s === RepoStatus.Proposed
              ? 'Collateral at today’s NAV'
              : s === RepoStatus.Settled
                ? 'Collateral returned'
                : s === RepoStatus.Defaulted
                  ? 'Collateral seized'
                  : 'Collateral'}
        </span>
        <span className="figure fig-sm">
          <Tween value={Number(formatUnits(escrow, 18))} format={(n) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })} />
        </span>
        <span className="small muted">
          nhBOND · {eur(collateralValue(escrow, nav))} at {price(nav)}
        </span>
      </div>
    </div>
  )
}
