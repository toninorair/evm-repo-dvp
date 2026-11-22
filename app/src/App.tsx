import { BrandLink, Footer, Header, NetworkBadge, Toast } from './components/ui'
import { LedgerProvider, parseRoute, useRoute } from './lib/store'
import { Book } from './screens/Book'
import { Desk, Market } from './screens/Desk'
import { Identity } from './screens/Identity'
import { Overview } from './screens/Overview'
import { Position } from './screens/Position'
import { Propose } from './screens/Propose'

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
    <header className="site-header">
      <div className="wrap site-header-bar opener">
        <BrandLink />
        <div className="header-actions">
          <NetworkBadge />
          <a href="./presentation.html" className="btn sm">
            Presentation
          </a>
          <a href="#/borrower" className="btn primary sm">
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
      <div className="shell">
        <OpenerHeader />
        <main className="wrap shell-main opener">
          <Overview />
        </main>
        <Footer />
      </div>
    )
  }
  return (
    <div className="shell">
      <Header route={route} />
      <main className="wrap shell-main">
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
