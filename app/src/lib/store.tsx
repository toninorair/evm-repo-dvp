import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Address } from 'viem'
import { backend, explain, type Checks, type Progress, type Snapshot } from './backend'

type Toast = { id: number; tone: 'pending' | 'done' | 'error'; text: string }

type Ledger = {
  snapshot?: Snapshot
  error?: string
  account?: Address
  checks?: Checks
  demo: boolean
  busy: boolean
  toast?: Toast
  connect(): Promise<void>
  switchDesk(a: Address): void
  refresh(): Promise<void>
  run(label: string, action: (onStep: Progress) => Promise<unknown>): Promise<boolean>
  dismiss(): void
}

const Ctx = createContext<Ledger | null>(null)

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [error, setError] = useState<string>()
  const [account, setAccount] = useState<Address | undefined>(backend.demo ? backend.account() : undefined)
  const [checks, setChecks] = useState<Checks>()
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast>()
  const toastId = useRef(0)

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await backend.load())
      setError(undefined)
    } catch (e) {
      setError(explain(e))
    }
  }, [])

  useEffect(() => {
    refresh()
    if (backend.demo) return
    const t = setInterval(refresh, 12_000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (!account) return setChecks(undefined)
    backend.checks(account).then(setChecks).catch(() => setChecks(undefined))
  }, [account, snapshot])

  const connect = useCallback(async () => {
    try {
      setAccount(await backend.connect())
    } catch (e) {
      setToast({ id: ++toastId.current, tone: 'error', text: explain(e) })
    }
  }, [])

  const switchDesk = useCallback((a: Address) => {
    backend.setAccount?.(a)
    setAccount(a)
  }, [])

  const run = useCallback(
    async (label: string, action: (onStep: Progress) => Promise<unknown>) => {
      const id = ++toastId.current
      setBusy(true)
      setToast({ id, tone: 'pending', text: label })
      try {
        await action((step) => setToast({ id, tone: 'pending', text: step }))
        await refresh()
        setToast({ id, tone: 'done', text: `${label}: done` })
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
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? undefined : cur)), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const value = useMemo<Ledger>(
    () => ({
      snapshot,
      error,
      account,
      checks,
      demo: backend.demo,
      busy,
      toast,
      connect,
      switchDesk,
      refresh,
      run,
      dismiss: () => setToast(undefined),
    }),
    [snapshot, error, account, checks, busy, toast, connect, switchDesk, refresh, run],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLedger() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLedger outside LedgerProvider')
  return v
}

/** Unix seconds, ticking once per second; aligned to chain time when known. */
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

/** Minimal hash router: #/, #/propose, #/repo/42 */
export function useRoute() {
  const read = () => window.location.hash.replace(/^#/, '') || '/'
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => {
      setRoute(read())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}
