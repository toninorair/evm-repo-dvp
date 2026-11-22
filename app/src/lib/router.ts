import { useEffect, useState } from 'react'
import type { Role } from './types'

/**
 * A console tab. Borrower and lender each act through their own wallet. Operator covers both Market NAV updates
 * and ERC-3643 Identity onboarding using the deployer wallet (calculation agent, registry agent, nhBOND agent, nhEUR treasury).
 */
export type Tab = 'borrower' | 'lender' | 'operator'
export const tabs: Tab[] = ['borrower', 'lender', 'operator']
export const walletRole: Record<Tab, Role> = {
  borrower: 'borrower',
  lender: 'lender',
  operator: 'agent',
}

/** Splits `#/lender/repo/4` into its tab and the page inside it. Legacy `#/market` and `#/identity` map to `operator`. */
export function parseRoute(route: string): { tab: Tab; page: string } {
  const m = route.match(/^\/(borrower|lender|operator|market|identity)([/?].*)?$/)
  if (m) {
    const raw = m[1]
    const tab: Tab = raw === 'market' || raw === 'identity' ? 'operator' : (raw as Tab)
    return { tab, page: (m[2] ?? '').split('?')[0] || '/' }
  }
  return { tab: 'borrower', page: route }
}

/** Minimal hash router: #/borrower, #/borrower/propose, #/lender/repo/42, #/operator */
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
