import { Footer, Header, Toast } from './components/ui'
import { Book } from './screens/Book'
import { Position } from './screens/Position'
import { Propose } from './screens/Propose'
import { LedgerProvider, useLedger, useRoute } from './lib/store'

function Screen({ route }: { route: string }) {
  const repo = route.match(/^\/repo\/(\d+)/)
  if (repo) return <Position key={repo[1]} id={BigInt(repo[1])} />
  if (route.startsWith('/propose')) return <Propose />
  return <Book />
}

function Shell() {
  const route = useRoute()
  const { error, snapshot } = useLedger()
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header route={route} />
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
