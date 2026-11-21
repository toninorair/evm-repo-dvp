import { useEffect, useState } from 'react'
import { Book } from './screens/Book'
import { Desk, Market } from './screens/Desk'
import { Identity } from './screens/Identity'
import { Footer, Header, Toast, tabLabel } from './components/ui'
import { Position } from './screens/Position'
import { Propose } from './screens/Propose'
import { networkName } from './lib/config'
import { LedgerProvider, parseRoute, useLedger, useRoute } from './lib/store'
import { shortAddr } from './lib/format'

const BANNER_TIMEOUT_MS = 6_000

function NoticeBanner({
  noticeKey,
  background,
  children,
}: {
  noticeKey: string
  background: string
  children: React.ReactNode
}) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    setVisible(true)
    const t = setTimeout(() => setVisible(false), BANNER_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [noticeKey])

  if (!visible) return null
  return (
    <div className="small" style={{ background, color: 'var(--bad)', padding: '8px 0' }}>
      <div className="wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span>{children}</span>
        <button
          type="button"
          aria-label="Dismiss notice"
          onClick={() => setVisible(false)}
          style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px', opacity: 0.7 }}
        >
          ×
        </button>
      </div>
    </div>
  )
}

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
        <NoticeBanner noticeKey={`net:${tab}:${account ?? ''}`} background="var(--bad-bg)">
          Your wallet is on another network. Transactions will ask to switch to {networkName}.
        </NoticeBanner>
      )}
      {locked && (
        <NoticeBanner noticeKey={`lock:${tab}:${account ?? ''}`} background="var(--bad-bg)">
          Your wallet is locked or hasn’t authorised this site.{' '}
          <button type="button" className="chip" onClick={connect}>
            Reconnect
          </button>
        </NoticeBanner>
      )}
      {mismatch && account && (
        <NoticeBanner noticeKey={`mismatch:${tab}:${account}:${mismatch}`} background="var(--warn-bg, var(--bad-bg))">
          Your wallet has {shortAddr(mismatch)} selected, but this {tabLabel[tab]} tab acts as {shortAddr(account)}. Switch accounts in your wallet before signing, or disconnect and connect the selected one.
        </NoticeBanner>
      )}
      {error && snapshot && (
        <NoticeBanner noticeKey={`err:${error}`} background="var(--bad-bg)">
          Live data paused: {error}
        </NoticeBanner>
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
