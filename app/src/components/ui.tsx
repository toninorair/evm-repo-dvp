import type { ReactNode } from 'react'
import type { Address, Hash } from 'viem'
import { explorer, networkName } from '../lib/config'
import { shortAddr } from '../lib/format'
import { RepoStatus, ZERO, same, statusLabel } from '../lib/repo'
import { Mark } from './Mark'
import { parseRoute, tabs, useLedger, useTween, walletRole, type Tab } from '../lib/store'

/** "You" for the connected wallet, otherwise a short address. */
export function party(a: Address, me?: Address) {
  if (a === ZERO) return '—'
  return same(a, me) ? 'You' : shortAddr(a)
}

export function AddressLink({ address, me }: { address: Address; me?: Address }) {
  if (!explorer) return <span title={address}>{party(address, me)}</span>
  return (
    <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" title={address} onClick={(e) => e.stopPropagation()}>
      {party(address, me)}
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

export const tabLabel: Record<Tab, string> = { borrower: 'Borrower', lender: 'Lender', market: 'Market', identity: 'Identity' }

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
  market: [],
  identity: [],
}

export function Header({ route }: { route: string }) {
  const { tab, href, roles, account, wrongNetwork, checks, connect, disconnect } = useLedger()
  const { page } = parseRoute(route)
  const current = page.startsWith('/repo') ? '/' : page
  return (
    <header style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="wrap" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 18, paddingBottom: 12 }}>
        <a href={href('/')} style={{ display: 'flex', alignItems: 'center', gap: 14, color: 'var(--ink)', textDecoration: 'none' }}>
          <Mark size={44} />
          <span style={{ fontFamily: 'var(--display)', fontSize: 30 }}>Ethereum Institutional</span>
          <span className="muted" style={{ borderLeft: '1px solid var(--line)', paddingLeft: 16, fontSize: 18 }}>
            Repo DvP · Nordhaven Bank
          </span>
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', border: '1px solid var(--line)', borderRadius: 999, color: wrongNetwork ? 'var(--bad)' : 'var(--muted)' }}>
            {!wrongNetwork && <span className="pulse-dot" aria-hidden="true" />}
            {wrongNetwork ? 'Wrong network' : networkName}
          </span>
          {account ? (
            <span style={{ padding: '5px 6px 5px 12px', background: 'var(--ink)', color: 'var(--ground)', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>
                {tabLabel[tab]} · {shortAddr(account)}
              </span>
              {checks && !checks.verified && <span style={{ color: '#ff8a80' }}>· not verified</span>}
              <button type="button" onClick={disconnect} title={`Disconnect the ${tabLabel[tab].toLowerCase()} wallet`} style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', opacity: 0.7, fontSize: 12, padding: '0 6px' }}>
                Disconnect
              </button>
            </span>
          ) : (
            <button type="button" className="btn primary" style={{ minHeight: 32, padding: '0 14px', fontSize: 12, borderRadius: 999 }} onClick={connect}>
              Connect {tab === 'market' || tab === 'identity' ? 'operator' : tabLabel[tab].toLowerCase()} wallet
            </button>
          )}
        </div>
      </div>
      <div className="wrap" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <nav aria-label="Counterparty" role="tablist" style={{ display: 'flex', gap: 4 }}>
          {tabs.map((t) => {
            const on = t === tab
            const bound = roles[walletRole[t]]
            return (
              <a
                key={t}
                role="tab"
                aria-selected={on}
                href={`#/${t}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 16px 10px', textDecoration: 'none', color: on ? 'var(--ink)' : 'var(--muted)', borderBottom: `2px solid ${on ? 'var(--ink)' : 'transparent'}`, transition: 'color 160ms, border-color 160ms' }}
              >
                <span style={{ fontSize: 14, fontWeight: on ? 600 : 400 }}>{tabLabel[t]}</span>
                <span className="small" style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {bound ? shortAddr(bound) : 'Not connected'}
                </span>
              </a>
            )
          })}
        </nav>
        <nav aria-label={`${tabLabel[tab]} pages`} style={{ display: 'flex', gap: 24, fontSize: 13, paddingBottom: 12 }}>
          {pages[tab].map((p) => {
            const on = p.page === current
            return (
              <a
                key={p.page}
                href={href(p.page)}
                aria-current={on ? 'page' : undefined}
                style={{ color: on ? 'var(--ink)' : 'var(--muted)', textDecoration: 'none', borderBottom: `1px solid ${on ? 'var(--ink)' : 'transparent'}`, paddingBottom: 2 }}
              >
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
    <footer style={{ borderTop: '1px solid var(--line)' }}>
      <div className="wrap small muted" style={{ paddingTop: 20, paddingBottom: 20, display: 'flex', justifyContent: 'flex-end' }}>
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
    <div role="img" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="gauge">
        <div className="fill" style={{ width: `${pct}%`, background: healthy ? 'var(--ok)' : 'var(--warn-strong)' }} />
        <div className="mark" style={{ left: '50%' }} />
      </div>
      <div className="row small muted" style={{ fontSize: 11 }}>
        <span>{(lo / 100).toFixed(0)}%</span>
        <span style={{ color: 'var(--warn)' }}>{(thresholdBps / 100).toFixed(2)}% call</span>
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
    <div className="reveal" style={{ padding: '48px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2>{title}</h2>
      {children && <div className="muted">{children}</div>}
    </div>
  )
}

/** Pass / fail line used by the pre-trade checklists. */
export function Check({ label, ok, fail = 'Fail', detail }: { label: string; ok?: boolean; fail?: string; detail?: ReactNode }) {
  return (
    <div className="row" style={{ gap: 12 }}>
      <span>
        {label}
        {detail && <span className="muted"> · {detail}</span>}
      </span>
      <span style={{ color: ok === undefined ? 'var(--muted)' : ok ? 'var(--ok)' : 'var(--warn)', flexShrink: 0 }}>{ok === undefined ? '—' : ok ? 'Pass' : fail}</span>
    </div>
  )
}
