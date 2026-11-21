import { Book } from './screens/Book'
import { Desk, Market } from './screens/Desk'
import { Identity } from './screens/Identity'
import { Footer, Header, Toast, tabLabel } from './components/ui'
import { Position } from './screens/Position'
import { Propose } from './screens/Propose'
import { networkName } from './lib/config'
import { LedgerProvider, parseRoute, useLedger, useRoute } from './lib/store'
import { shortAddr } from './lib/format'

function Screen({ route }: { route: string }) {
  const { tab, page } = parseRoute(route)
  if (tab === 'market') return <Market />
  if (tab === 'identity') return <Identity />
  const repo = page.match(/^\/repo\/(\d+)/)
  if (repo) return <Position key={repo[1]} id={BigInt(repo[1])} />
  if (tab === 'borrower' && page.startsWith('/propose')) return <Propose />
  if (page.startsWith('/wallet')) return <Desk />
  return <Book />
}

function Shell() {
  const route = useRoute()
  const { error, snapshot, wrongNetwork, mismatch, locked, connect, account, tab } = useLedger()
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header route={route} />
      {wrongNetwork && (
        <div className="small" style={{ background: 'var(--bad-bg)', color: 'var(--bad)', padding: '8px 0' }}>
          <div className="wrap">Your wallet is on another network. Transactions will ask to switch to {networkName}.</div>
        </div>
      )}
      {locked && (
        <div className="small" style={{ background: 'var(--bad-bg)', color: 'var(--bad)', padding: '8px 0' }}>
          <div className="wrap">
            Your wallet is locked or hasn’t authorised this site.{' '}
            <button type="button" className="chip" onClick={connect}>
              Reconnect
            </button>
          </div>
        </div>
      )}
      {mismatch && account && (
        <div className="small" style={{ background: 'var(--warn-bg, var(--bad-bg))', color: 'var(--bad)', padding: '8px 0' }}>
          <div className="wrap">
            Your wallet has {shortAddr(mismatch)} selected, but this {tabLabel[tab]} tab acts as {shortAddr(account)}. Switch accounts in your wallet before signing, or disconnect and connect the selected one.
          </div>
        </div>
      )}
      {error && snapshot && (
        <div className="small" style={{ background: 'var(--bad-bg)', color: 'var(--bad)', padding: '8px 0' }}>
          <div className="wrap">Live data paused: {error}</div>
        </div>
      )}
      <main className="wrap" style={{ flex: 1, width: '100%', paddingTop: 56, paddingBottom: 80 }}>
        <Screen key={route} route={route} />
      </main>
      <Footer />
      <Toast />
    </div>
  )
}

export default function App() {
  return (
    <LedgerProvider>
      <Shell />
    </LedgerProvider>
  )
}
