import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Address } from 'viem'
import { backend, explain, type Checks, type Progress, type Role, type Snapshot } from './backend'
import { chain, isLocal, networkName } from './config'
import { same } from './repo'
import { parseRoute, tabs, useRoute, walletRole, type Tab } from './router'

export { parseRoute, tabs, useRoute, walletRole, type Tab }

type Toast = { id: number; tone: 'pending' | 'done' | 'error'; text: string }

type Ledger = {
  snapshot?: Snapshot
  error?: string
  tab: Tab
  /** Link to a page inside the current tab, for example href('/repo/4'). */
  href(page: string): string
  /** The wallet bound to the current tab. Every screen acts as this account. */
  account?: Address
  /** Wallets bound to each role. */
  roles: Partial<Record<Role, Address>>
  /** Set when the browser wallet's selected account is not the current tab's wallet, so it cannot sign for it. */
  mismatch?: Address
  /** A wallet is bound to this tab but the browser wallet is locked or hasn't authorised the site. */
  locked: boolean
  disconnect(): void
  wrongNetwork: boolean
  checks?: Checks
  busy: boolean
  toast?: Toast
  connect(): Promise<void>
  refresh(poll?: boolean): Promise<void>
  run(label: string, action: (onStep: Progress) => Promise<unknown>): Promise<boolean>
  dismiss(): void
}

const Ctx = createContext<Ledger | null>(null)
const POLL_MS = isLocal ? 2_000 : 12_000 // about one block

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [error, setError] = useState<string>()
  const [wallet, setWallet] = useState(backend.walletState())
  const [checks, setChecks] = useState<Checks>()
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast>()
  const toastId = useRef(0)
  const loading = useRef(false)
  const mounted = useRef(true)
  const { tab } = parseRoute(useRoute())
  const role = walletRole[tab]

  // Sync before paint/interaction so a click on a newly rendered tab never signs as the previous role, while keeping render pure.
  useLayoutEffect(() => {
    backend.setActing(role)
  }, [role])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /** Polls skip while a load is running; explicit refreshes (after a transaction) always queue a fresh one. */
  const refresh = useCallback(async (poll = false) => {
    if (poll && loading.current) return
    loading.current = true
    try {
      const next = await backend.load()
      if (!mounted.current) return
      setSnapshot(next)
      setError(undefined)
    } catch (e) {
      if (!mounted.current) return
      setError(explain(e))
    } finally {
      loading.current = false
    }
  }, [])

  useEffect(() => {
    const off = backend.subscribe(setWallet)
    backend.restore().catch(() => undefined)
    refresh()
    const t = setInterval(() => refresh(true), POLL_MS)
    return () => {
      off()
      clearInterval(t)
    }
  }, [refresh])

  const account = wallet.roles[role]
  useEffect(() => {
    setChecks((c) => (c && same(c.account, account) ? c : undefined))
    if (!account) return
    let live = true
    backend
      .checks(account)
      .then((c) => live && setChecks(c))
      .catch(() => undefined) // keep the last good figures; the next poll retries
    return () => {
      live = false
    }
  }, [account, snapshot])

  const connect = useCallback(async () => {
    try {
      await backend.connect(role)
    } catch (e) {
      setToast({ id: ++toastId.current, tone: 'error', text: explain(e) })
    }
  }, [role])

  const run = useCallback(
    async (label: string, action: (onStep: Progress) => Promise<unknown>) => {
      const id = ++toastId.current
      setBusy(true)
      setToast({ id, tone: 'pending', text: label })
      try {
        await action((step) => setToast({ id, tone: 'pending', text: step }))
        await refresh()
        setToast({ id, tone: 'done', text: `${label}: confirmed on ${networkName}` })
        return true
      } catch (e) {
        setToast({ id, tone: 'error', text: explain(e) })
        return false
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  useEffect(() => {
    if (!toast || toast.tone === 'pending') return
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? undefined : cur)), toast.tone === 'error' ? 12_000 : 6_000)
    return () => clearTimeout(t)
  }, [toast])

  const value = useMemo<Ledger>(
    () => ({
      snapshot,
      error,
      tab,
      href: (page: string) => `#/${tab}${page === '/' ? '' : page}`,
      account,
      roles: wallet.roles,
      mismatch: account && wallet.selected && !same(account, wallet.selected) ? wallet.selected : undefined,
      locked: !!account && !wallet.selected,
      disconnect: () => backend.disconnect(role),
      wrongNetwork: !!account && wallet.chainId !== undefined && wallet.chainId !== chain.id,
      checks,
      busy,
      toast,
      connect,
      refresh,
      run,
      dismiss: () => setToast(undefined),
    }),
    [snapshot, error, tab, role, account, wallet, checks, busy, toast, connect, refresh, run],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLedger() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLedger outside LedgerProvider')
  return v
}

/** Unix seconds, ticking once per second and aligned to chain block time. */
export function useNow() {
  const { snapshot } = useLedger()
  const skew = useRef(0)
  useEffect(() => {
    if (snapshot) skew.current = snapshot.chainTime - Math.floor(Date.now() / 1000)
  }, [snapshot])
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])
  return now + skew.current
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Eases a number from its previous value to `target` over `ms`. Instant when motion is reduced. */
export function useTween(target: number, ms = 600) {
  const [value, setValue] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    if (reduced() || from.current === target) {
      from.current = target
      setValue(target)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const eased = 1 - Math.pow(1 - k, 3)
      setValue(a + (target - a) * eased)
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = target
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      from.current = target
    }
  }, [target, ms])
  return value
}
