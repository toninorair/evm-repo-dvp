import type { ReactNode } from 'react'
import type { Address } from 'viem'
import { DEMO_DESKS } from '../lib/backend'
import { contracts, explorer } from '../lib/config'
import { shortAddr } from '../lib/format'
import { RepoStatus, ZERO, statusLabel } from '../lib/repo'
import { useLedger, useTween } from '../lib/store'

const deskNames: Record<string, string> = Object.fromEntries(
  Object.entries(DEMO_DESKS).map(([k, v]) => [v.toLowerCase(), `Desk ${k}`]),
)

/** Human name for a party: "Desk A" in demo, "You" for the connected wallet, else short address. */
export function party(a: Address, me?: Address) {
  if (a === ZERO) return 'Open RFQ'
  if (me && a.toLowerCase() === me.toLowerCase()) return 'You'
  return deskNames[a.toLowerCase()] ?? shortAddr(a)
}

const nav = [
  { href: '#/', label: 'Repo book', match: (r: string) => r === '/' },
  { href: '#/propose', label: 'Propose', match: (r: string) => r.startsWith('/propose') },
]

export function Header({ route }: { route: string }) {
  const { account, demo, connect, switchDesk } = useLedger()
  return (
    <header style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="wrap" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 18, paddingBottom: 18 }}>
        <a href="#/" style={{ display: 'flex', alignItems: 'center', gap: 14, color: 'var(--ink)', textDecoration: 'none' }}>
          <span aria-hidden="true" style={{ width: 28, height: 28, border: '1.5px solid var(--ink)', borderRadius: '50%', display: 'grid', placeItems: 'center', fontFamily: 'var(--display)', fontSize: 15 }}>r</span>
          <span style={{ fontFamily: 'var(--display)', fontSize: 20 }}>Repo DvP</span>
          <span className="small muted" style={{ borderLeft: '1px solid var(--line)', paddingLeft: 14 }}>
            Nordhaven Bank · Securities Financing
          </span>
        </a>
        <nav aria-label="Primary" style={{ display: 'flex', gap: 28, fontSize: 13 }}>
          {nav.map((n) => {
            const on = n.match(route)
            return (
              <a
                key={n.href}
                href={n.href}
                aria-current={on ? 'page' : undefined}
                style={{ color: on ? 'var(--ink)' : 'var(--muted)', textDecoration: 'none', borderBottom: `1px solid ${on ? 'var(--ink)' : 'transparent'}`, paddingBottom: 2, transition: 'color 160ms, border-color 160ms' }}
              >
                {n.label}
              </a>
            )
          })}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', border: '1px solid var(--line)', borderRadius: 999, color: 'var(--muted)' }}>
            <span className="pulse-dot" aria-hidden="true" />
            {demo ? 'Demo data' : 'Sepolia'}
          </span>
          {demo ? (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="muted">Acting as</span>
              <select
                value={account}
                onChange={(e) => switchDesk(e.target.value as Address)}
                style={{ height: 30, padding: '0 10px', borderRadius: 999, border: 0, background: 'var(--ink)', color: 'var(--ground)', font: 'inherit', fontSize: 12 }}
              >
                <option value={DEMO_DESKS.A}>Desk A · borrower</option>
                <option value={DEMO_DESKS.B}>Desk B · lender</option>
              </select>
            </label>
          ) : account ? (
            <span style={{ padding: '5px 12px', background: 'var(--ink)', color: 'var(--ground)', borderRadius: 999 }}>{shortAddr(account)}</span>
          ) : (
            <button type="button" className="btn primary" style={{ minHeight: 32, padding: '0 14px', fontSize: 12, borderRadius: 999 }} onClick={connect}>
              Connect wallet
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--line)' }}>
      <div className="wrap small muted" style={{ paddingTop: 20, paddingBottom: 20, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
        <span>
          RepoDvP{' '}
          {contracts.repoDvP ? (
            <a href={`${explorer}/address/${contracts.repoDvP}`} target="_blank" rel="noreferrer">
              {shortAddr(contracts.repoDvP)}
            </a>
          ) : (
            'not deployed'
          )}{' '}
          · ERC-3643 collateral · tokenised-deposit cash leg
        </span>
        <span>Case study prototype for Ethereum Institutional · testnet only</span>
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
        <span style={{ color: 'var(--warn)' }}>{(thresholdBps / 100).toFixed(0)}% call</span>
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
