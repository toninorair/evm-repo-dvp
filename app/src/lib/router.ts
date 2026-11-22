import { useEffect, useState } from 'react'
import type { Role } from './types'

/**
 * A console tab. Borrower and lender each act through their own wallet. Market (NAV) and Identity (onboarding) share
 * the operator wallet: the deployer, which is the NAV calculation agent, registry agent, nhBOND agent and nhEUR treasury.
 */
export type Tab = 'borrower' | 'lender' | 'market' | 'identity'
export const tabs: Tab[] = ['borrower', 'lender', 'market', 'identity']
export const walletRole: Record<Tab, Role> = {
  borrower: 'borrower',
  lender: 'lender',
  market: 'agent',
  identity: 'agent',
}

/** Splits `#/lender/repo/4` into its tab and the page inside it. Bare routes belong to the borrower tab. */
export function parseRoute(route: string): { tab: Tab; page: string } {
  const m = route.match(/^\/(borrower|lender|market|identity)([/?].*)?$/)
  if (m) return { tab: m[1] as Tab, page: (m[2] ?? '').split('?')[0] || '/' }
  return { tab: 'borrower', page: route }
}

/** Minimal hash router: #/borrower, #/borrower/propose, #/lender/repo/42, #/market, #/identity */
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
