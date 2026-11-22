import { Book } from './screens/Book'
import { Desk, Market } from './screens/Desk'
import { Identity } from './screens/Identity'
import { Overview } from './screens/Overview'
import { Footer, Header, Toast } from './components/ui'
import { Mark } from './components/Mark'
import { Position } from './screens/Position'
import { Propose } from './screens/Propose'
import { networkName } from './lib/config'
import { LedgerProvider, parseRoute, useRoute } from './lib/store'

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

function OpenerHeader() {
  return (
    <header style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="wrap" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 18, paddingBottom: 16 }}>
        <a href="#/" style={{ display: 'flex', alignItems: 'center', gap: 14, color: 'var(--ink)', textDecoration: 'none' }}>
          <Mark size={44} />
          <span style={{ fontFamily: 'var(--display)', fontSize: 30 }}>Ethereum Institutional</span>
          <span style={{ borderLeft: '1px solid var(--line)', paddingLeft: 16, fontSize: 18, color: 'var(--ok)' }}>
            Repo DvP · Nordhaven Bank
          </span>
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', border: '1px solid var(--line)', borderRadius: 999, color: 'var(--muted)' }}>
            <span className="pulse-dot" aria-hidden="true" />
            {networkName}
          </span>
          <a href="./presentation.html" className="btn" style={{ minHeight: 32, padding: '0 14px', fontSize: 12, textDecoration: 'none' }}>
            Presentation
          </a>
          <a href="#/borrower" className="btn primary" style={{ minHeight: 32, padding: '0 14px', fontSize: 12, textDecoration: 'none' }}>
            Demo App →
          </a>
        </div>
      </div>
    </header>
  )
}

function Shell() {
  const route = useRoute()
  const isOpener = route === '/' || route === '/plan'
  if (isOpener) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <OpenerHeader />
        <main className="wrap" style={{ flex: 1, width: '100%', paddingTop: 48, paddingBottom: 72 }}>
          <Overview />
        </main>
        <Footer />
      </div>
    )
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header route={route} />
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
