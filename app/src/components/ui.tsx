import type { ReactNode } from 'react'
import type { Address, Hash } from 'viem'
import { explorer, networkName } from '../lib/config'
import { shortAddr } from '../lib/format'
import { RepoStatus, ZERO, same, statusLabel } from '../lib/repo'
import { parseRoute, tabs, useLedger, useTween, walletRole, type Tab } from '../lib/store'
import { Mark } from './Mark'

/** "You" for the connected wallet, otherwise a short address. */
export function party(a: Address, me?: Address) {
  if (a === ZERO) return '—'
  return same(a, me) ? 'You' : shortAddr(a)
}

export function AddressLink({ address, me, full = false }: { address: Address; me?: Address; full?: boolean }) {
  const text = full ? (address === ZERO ? '—' : address) : party(address, me)
  if (!explorer || address === ZERO) return <span title={address}>{text}</span>
  return (
    <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" title={address} onClick={(e) => e.stopPropagation()}>
      {text}
    </a>
  )
}

export function TxLink({ hash, children }: { hash?: Hash; children?: ReactNode }) {
  if (!hash) return null
  if (!explorer) return <span title={hash}>{children ?? `${hash.slice(0, 10)}…`}</span>
  return (
    <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
      {children ?? `${hash.slice(0, 10)}…`} ↗
    </a>
  )
}

export const tabLabel: Record<Tab, string> = {
  borrower: 'Borrower',
  lender: 'Lender',
  operator: 'Operator',
}

/** Pages inside each counterparty tab. */
const pages: Record<Tab, { page: string; label: string }[]> = {
  borrower: [
    { page: '/', label: 'Positions' },
    { page: '/propose', label: 'Propose' },
    { page: '/wallet', label: 'Wallet' },
  ],
  lender: [
    { page: '/', label: 'Positions' },
    { page: '/wallet', label: 'Wallet' },
  ],
  operator: [],
}

export function BrandLink({ title }: { title?: string }) {
  return (
    <a href="#/" className="brand-link" title={title}>
      <Mark size={44} />
      <span className="brand-title">Ethereum Institutional</span>
      <span className="brand-sub">Repo DvP · Nordhaven Bank</span>
    </a>
  )
}

export function NetworkBadge({ wrongNetwork = false }: { wrongNetwork?: boolean }) {
  const label = networkName === 'Sepolia' ? 'Ethereum Sepolia' : networkName
  return (
    <span className={`badge-pill${wrongNetwork ? ' bad' : ''}`}>
      {!wrongNetwork && <span className="pulse-dot" aria-hidden="true" />}
      {wrongNetwork ? 'Wrong network' : label}
    </span>
  )
}

export function Header({ route }: { route: string }) {
  const { tab, href, roles, account, wrongNetwork, checks, connect, disconnect } = useLedger()
  const { page } = parseRoute(route)
  const current = page.startsWith('/repo') ? '/' : page
  const roleName = tabLabel[tab]

  return (
    <header className="site-header">
      <div className="wrap site-header-bar">
        <BrandLink title="Back to Session Plan" />
        <div className="header-actions">
          <a href="#/" className="badge-pill ink">
            ← Session Plan
          </a>
          {account ? (
            <span className="wallet-pill">
              <span>
                {roleName} ·{' '}
                {explorer ? (
                  <a href={`${explorer}/address/${account}`} target="_blank" rel="noreferrer" title={account} style={{ color: 'inherit' }}>
                    {shortAddr(account)}
                  </a>
                ) : (
                  shortAddr(account)
                )}
              </span>
              {tab !== 'operator' && checks && !checks.verified && <span className="wallet-pill-unverified">· not verified</span>}
              <button
                type="button"
                onClick={disconnect}
                title={`Disconnect the ${roleName.toLowerCase()} wallet`}
                className="wallet-pill-btn"
              >
                Disconnect
              </button>
            </span>
          ) : (
            <button type="button" className="btn primary sm pill-btn" onClick={connect}>
              Connect {roleName.toLowerCase()} wallet
            </button>
          )}
          <NetworkBadge wrongNetwork={wrongNetwork} />
        </div>
      </div>
      <div className="wrap site-nav-bar">
        <nav aria-label="Counterparty" role="tablist" className="tab-list">
          {tabs.map((t) => {
            const on = t === tab
            const bound = roles[walletRole[t]]
            return (
              <a key={t} role="tab" aria-selected={on} href={`#/${t}`} className="tab-link">
                <span className="tab-link-title">{tabLabel[t]}</span>
                <span className="small muted">{bound ? shortAddr(bound) : 'Not connected'}</span>
              </a>
            )
          })}
        </nav>
        <nav aria-label={`${tabLabel[tab]} pages`} className="subnav">
          {pages[tab].map((p) => {
            const on = p.page === current
            return (
              <a key={p.page} href={href(p.page)} aria-current={on ? 'page' : undefined} className="subnav-link">
                {p.label}
              </a>
            )
          })}
        </nav>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap small muted site-footer-inner">
        <span>Proof of Concept · Testnet Only</span>
      </div>
    </footer>
  )
}

export function Pill({ status, children }: { status: RepoStatus; children?: ReactNode }) {
  return <span className={`pill s${status}`}>{children ?? statusLabel[status]}</span>
}

/** Number that eases to its new value. */
export function Tween({ value, format, ms }: { value: number; format: (n: number) => string; ms?: number }) {
  const v = useTween(value, ms)
  return <>{format(v)}</>
}

export function Gauge({ ratioBps, thresholdBps, label }: { ratioBps: number; thresholdBps: number; label: string }) {
  // Scale: threshold sits at 50%; ±6 points either side.
  const lo = thresholdBps - 600
  const hi = thresholdBps + 600
  const pct = Math.max(0, Math.min(100, ((ratioBps - lo) / (hi - lo)) * 100))
  const healthy = ratioBps >= thresholdBps
  return (
    <div role="img" aria-label={label} className="stack gap-1">
      <div className="gauge">
        <div className="fill" style={{ width: `${pct}%`, background: healthy ? 'var(--ok)' : 'var(--warn-strong)' }} />
        <div className="mark" style={{ left: '50%' }} />
      </div>
      <div className="row small muted" style={{ fontSize: 11 }}>
        <span>{(lo / 100).toFixed(0)}%</span>
        <span className="text-warn">{(thresholdBps / 100).toFixed(2)}% call</span>
        <span>{(hi / 100).toFixed(0)}%</span>
      </div>
    </div>
  )
}

export function Toast() {
  const { toast, dismiss } = useLedger()
  if (!toast) return null
  return (
    <div key={toast.id} className={`toast ${toast.tone === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
      {toast.tone === 'pending' ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">{toast.tone === 'done' ? '✓' : '!'}</span>}
      <span style={{ flex: 1 }}>{toast.text}</span>
      {toast.tone !== 'pending' && (
        <button type="button" onClick={dismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="reveal stack gap-2" style={{ padding: '48px 0' }}>
      <h2>{title}</h2>
      {children && <div className="muted">{children}</div>}
    </div>
  )
}

/** Pass / fail line used by the pre-trade checklists. */
export function Check({ label, ok, fail = 'Fail', detail }: { label: string; ok?: boolean; fail?: string; detail?: ReactNode }) {
  return (
    <div className="row">
      <span>
        {label}
        {detail && <span className="muted"> · {detail}</span>}
      </span>
      <span className={ok === undefined ? 'muted' : ok ? 'text-ok' : 'text-warn'} style={{ flexShrink: 0 }}>
        {ok === undefined ? '—' : ok ? 'Pass' : fail}
      </span>
    </div>
  )
}
