import { useEffect, useState } from 'react'
import { isAddress, parseUnits, type Address } from 'viem'
import { AddressLink, Check, Empty } from '../components/ui'
import { backend, type IdentityStatus, type OperatorRights } from '../lib/backend'
import { amount, eur, shortAddr } from '../lib/format'
import { same } from '../lib/repo'
import { useLedger } from '../lib/store'

const COUNTRY_DE = 276
const ZERO = '0x0000000000000000000000000000000000000000'

/** `#/identity?wallet=0x…` preselects a wallet, e.g. from a "not verified" warning. */
function walletFromHash() {
  const q = window.location.hash.split('?')[1]
  const w = q ? new URLSearchParams(q).get('wallet') : null
  return w && isAddress(w) ? w : ''
}

function whole(input: string) {
  try {
    return input.trim() ? parseUnits(input.replace(/[,_\s]/g, ''), 18) : 0n
  } catch {
    return -1n
  }
}

/**
 * ERC-3643 onboarding, the in-browser equivalent of script/deploy/OnboardDesk.s.sol. RepoDvP rejects any wallet not
 * verified in both tokens' identity registries; with no claim topics required, registration alone verifies.
 */
export function Identity() {
  const { snapshot, account, roles, busy, run, connect } = useLedger()
  const [input, setInput] = useState(() => walletFromHash() || roles.borrower || '')
  const [status, setStatus] = useState<IdentityStatus>()
  const [loadedRights, setRights] = useState<OperatorRights>()
  const [country, setCountry] = useState(String(COUNTRY_DE))
  const [bonds, setBonds] = useState('100000')
  const [cash, setCash] = useState('10000000')

  const wallet = isAddress(input.trim()) ? (input.trim() as Address) : undefined

  // Polls refresh the figures in place; only a different wallet clears them, so the panel doesn't blink every refresh.
  useEffect(() => {
    setStatus((cur) => (cur && same(cur.wallet, wallet) ? cur : undefined))
    if (!wallet) return
    let live = true
    backend
      .identityStatus(wallet)
      .then((s) => live && setStatus(s))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [wallet, snapshot])

  const [rightsOf, setRightsOf] = useState<Address>()
  useEffect(() => {
    if (!account) return
    let live = true
    backend
      .operatorRights(account)
      .then((r) => {
        if (!live) return
        setRights(r)
        setRightsOf(account)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [account, snapshot])
  // Rights belong to the account they were read for; a switched wallet shows nothing until its own read lands.
  const rights = rightsOf && same(rightsOf, account) ? loadedRights : undefined

  if (!snapshot) return <Empty title="Reading the identity registry…" />

  const d = snapshot.deployment
  const shared = same(d.bondRegistry, d.cashRegistry)
  const verified = !!status && status.bond.verified && status.cash.verified
  const registered = !!status && (status.bond.registered || status.cash.registered)
  const bondAmount = whole(bonds)
  const cashAmount = whole(cash)
  const countryCode = Number(country)
  const isOperator = !!rights && rights.bondRegistryAgent && rights.cashRegistryAgent
  const badInput = bondAmount < 0n || cashAmount < 0n || !Number.isInteger(countryCode) || countryCode <= 0 || countryCode > 65535
  const tag = (w: Address) => (same(w, roles.borrower) ? 'Borrower' : same(w, roles.lender) ? 'Lender' : same(w, roles.agent) ? 'Operator' : '')

  const onboard = () =>
    run(verified ? 'Funding' : 'Onboarding', async (st) => {
      if (!verified) await backend.registerIdentity(wallet!, countryCode, st)
      if (bondAmount > 0n) await backend.issueBonds(wallet!, bondAmount, st)
      if (cashAmount > 0n) await backend.mintCash(wallet!, cashAmount, st)
    })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      <section className="reveal" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760 }}>
        <h1>Identity registry.</h1>
        <p className="muted" style={{ margin: 0, fontSize: 15 }}>
          nhBOND, nhEUR and RepoDvP only deal with wallets verified in the ERC-3643 identity registry. Onboarding deploys an ONCHAINID identity owned by the wallet and registers it{shared ? '' : ' in both token registries'}. No claim topics are
          required, so registration alone verifies. The operator wallet can then fund the desk with nhBOND and nhEUR.
        </p>
      </section>

      <section className="split">
        <div className="main reveal d1" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2>Wallet</h2>
          <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label htmlFor="wallet">Wallet Address</label>
              <input id="wallet" spellCheck={false} placeholder="0x…" value={input} onChange={(e) => setInput(e.target.value)} />
              {input.trim() && !wallet && <span className="hint" style={{ color: 'var(--bad)' }}>Not a valid address.</span>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(['borrower', 'lender', 'agent'] as const).map((r) =>
                roles[r] ? (
                  <button key={r} type="button" className="chip" aria-pressed={same(wallet, roles[r])} onClick={() => setInput(roles[r]!)}>
                    {r === 'agent' ? 'Operator' : r[0].toUpperCase() + r.slice(1)} · {shortAddr(roles[r])}
                  </button>
                ) : null,
              )}
            </div>

            {wallet && !status && <span className="small muted">Reading the registry…</span>}
            {status && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                {shared ? (
                  <Check label="Verified · identity registry" ok={status.bond.verified} fail={status.bond.registered ? 'Registered, not verified' : 'Not registered'} />
                ) : (
                  <>
                    <Check label="Verified · nhBOND registry" ok={status.bond.verified} fail={status.bond.registered ? 'Registered, not verified' : 'Not registered'} />
                    <Check label="Verified · nhEUR registry" ok={status.cash.verified} fail={status.cash.registered ? 'Registered, not verified' : 'Not registered'} />
                  </>
                )}
                <div className="row">
                  <span className="muted">ONCHAINID identity</span>
                  <span>{status.bond.identity !== ZERO ? <AddressLink address={status.bond.identity} /> : '—'}</span>
                </div>
                <div className="row">
                  <span className="muted">Country (ISO 3166 numeric)</span>
                  <span>{status.bond.registered ? status.bond.country : '—'}</span>
                </div>
                <div className="row">
                  <span className="muted">nhBOND balance</span>
                  <span>{amount(status.bondBalance, 2)}</span>
                </div>
                <div className="row">
                  <span className="muted">nhEUR balance</span>
                  <span>{eur(status.cashBalance)}</span>
                </div>
              </div>
            )}

            {status && account && isOperator && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                  {!verified && (
                    <div className="field">
                      <label htmlFor="country">Country Code</label>
                      <input id="country" inputMode="numeric" value={country} onChange={(e) => setCountry(e.target.value)} />
                      <span className="hint">276 = Germany</span>
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="bonds">Issue nhBOND</label>
                    <input id="bonds" inputMode="decimal" value={bonds} onChange={(e) => setBonds(e.target.value)} />
                    <span className="hint">Collateral to post · 0 to skip</span>
                  </div>
                  <div className="field">
                    <label htmlFor="cash">Mint nhEUR</label>
                    <input id="cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
                    <span className="hint">Cash to lend or repay · 0 to skip</span>
                  </div>
                </div>
                {bondAmount > 0n && !rights.bondAgent && <span className="small" style={{ color: 'var(--bad)' }}>The operator wallet is not an nhBOND agent, so it can’t issue bonds.</span>}
                {cashAmount > 0n && !rights.treasury && <span className="small" style={{ color: 'var(--bad)' }}>The operator wallet lacks nhEUR TREASURY_ROLE, so it can’t mint.</span>}
                <button
                  type="button"
                  className="btn primary block"
                  disabled={busy || badInput || (bondAmount > 0n && !rights.bondAgent) || (cashAmount > 0n && !rights.treasury) || (verified && bondAmount === 0n && cashAmount === 0n)}
                  onClick={onboard}
                >
                  {verified ? 'Fund wallet' : bondAmount > 0n || cashAmount > 0n ? 'Register identity and fund' : 'Register identity'}
                </button>
                {registered && (
                  <button type="button" className="btn block" disabled={busy} onClick={() => run('Identity removal', (st) => backend.removeIdentity(wallet!, st))}>
                    Remove from registry
                  </button>
                )}
              </div>
            )}
            {status && !account && (
              <button type="button" className="btn primary block" onClick={connect}>
                Connect operator wallet to onboard
              </button>
            )}
          </div>

          <h2 style={{ marginTop: 24 }}>Registered Wallets</h2>
          {!snapshot.historyComplete && <p className="small muted">Scanning older blocks…</p>}
          {snapshot.registrations.length === 0 && snapshot.historyComplete ? (
            <p className="small muted" style={{ margin: 0 }}>No registrations found.</p>
          ) : (
            <table className="book">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Console Role</th>
                  <th>Identity</th>
                  {!shared && <th>Registries</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {snapshot.registrations.map((r) => (
                  <tr key={r.wallet}>
                    <td>
                      <AddressLink address={r.wallet} />
                    </td>
                    <td>{tag(r.wallet) || <span className="muted">—</span>}</td>
                    <td>
                      <AddressLink address={r.identity} />
                    </td>
                    {!shared && <td>{r.bond && r.cash ? 'nhBOND · nhEUR' : r.bond ? 'nhBOND only' : 'nhEUR only'}</td>}
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="chip" onClick={() => setInput(r.wallet)}>
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="side reveal d2">
          <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <h3>Operator Wallet</h3>
            {!account ? (
              <>
                <span className="small muted">Onboarding needs the registry agent: the deployer wallet (anvil account #0 locally). Looking up wallets needs no wallet.</span>
                <button type="button" className="btn primary block" onClick={connect}>
                  Connect operator wallet
                </button>
              </>
            ) : (
              <>
                <span className="small muted">{account}</span>
                <Check label={shared ? 'Identity registry agent' : 'nhBOND registry agent'} ok={rights?.bondRegistryAgent} fail="No" />
                {!shared && <Check label="nhEUR registry agent" ok={rights?.cashRegistryAgent} fail="No" />}
                <Check label="nhBOND agent · issue" ok={rights?.bondAgent} fail="No" />
                <Check label="nhEUR TREASURY_ROLE · mint" ok={rights?.treasury} fail="No" />
                {rights && !isOperator && <span className="small" style={{ color: 'var(--bad)' }}>This wallet can’t register identities. Disconnect and connect the deployer wallet.</span>}
              </>
            )}
            <div className="row" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <span className="muted">{shared ? 'Registry' : 'nhBOND registry'}</span>
              <AddressLink address={d.bondRegistry} />
            </div>
            {!shared && (
              <div className="row">
                <span className="muted">nhEUR registry</span>
                <AddressLink address={d.cashRegistry} />
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  )
}
