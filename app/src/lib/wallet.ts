import { createWalletClient, custom, isAddress, type Address, type WalletClient } from 'viem'
import { chain } from './config'
import { same } from './repo'
import type { Eip1193, Role, Signer, WalletState } from './types'

const ROLES_KEY = 'repo-dvp:roles'
const roleLabel: Record<Role, string> = { borrower: 'borrower', lender: 'lender', agent: 'operator' }

export function loadRoles(): WalletState['roles'] {
  const roles: WalletState['roles'] = {}
  try {
    const v: unknown = JSON.parse(localStorage.getItem(ROLES_KEY) ?? '{}')
    if (!v || typeof v !== 'object' || Array.isArray(v)) return roles
    for (const role of Object.keys(roleLabel) as Role[]) {
      const a = (v as Record<string, unknown>)[role]
      if (typeof a === 'string' && isAddress(a)) roles[role] = a
    }
  } catch {}
  // A stale or hand-edited store must not leave one account acting for both sides.
  if (same(roles.borrower, roles.lender)) delete roles.lender
  return roles
}

export class WalletManager {
  private wallet?: WalletClient
  private provider?: Eip1193
  private state: WalletState = { roles: loadRoles() }
  private acting?: Role
  private listeners = new Set<(s: WalletState) => void>()

  constructor() {
    this.provider = typeof window !== 'undefined' ? window.ethereum : undefined
    this.provider?.on?.('accountsChanged', (a) => this.setWallet({ selected: (a as Address[])[0] }))
    // Another browser tab bound or unbound a role.
    if (typeof window !== 'undefined') {
      window.addEventListener?.('storage', (e) => (e.key === ROLES_KEY || e.key === null) && this.setWallet({ roles: loadRoles() }))
    }
    this.provider?.on?.('chainChanged', (id) => this.setWallet({ chainId: Number(id) }))
  }

  walletState(): WalletState {
    return this.state
  }

  subscribe(fn: (s: WalletState) => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private setWallet(patch: Partial<WalletState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn(this.state))
  }

  private walletClient() {
    if (!this.provider) throw new Error('No browser wallet found. Install MetaMask or another EIP-1193 wallet.')
    this.wallet ??= createWalletClient({ chain, transport: custom(this.provider) })
    return this.wallet
  }

  /** Reconnects silently if the site was already authorised in the wallet. */
  async restore() {
    if (!this.provider) return
    const accounts = (await this.provider.request({ method: 'eth_accounts' })) as Address[]
    const chainId = Number(await this.provider.request({ method: 'eth_chainId' }))
    this.setWallet({ selected: accounts[0], chainId })
  }

  /** Binds the wallet account currently selected in the browser wallet to `role`. */
  async connect(role: Role = 'borrower') {
    const wallet = this.walletClient()
    const [account] = await wallet.requestAddresses()
    const other = role === 'borrower' ? 'lender' : role === 'lender' ? 'borrower' : undefined
    if (other && same(this.state.roles[other], account)) {
      throw new Error(
        `${account.slice(0, 6)}…${account.slice(-4)} is already the ${other} wallet. Select a different account in your wallet, then connect again.`,
      )
    }
    await this.ensureChain(wallet)
    this.bind(role, account)
    this.acting = role
    this.setWallet({ selected: account, chainId: chain.id })
    return account
  }

  disconnect(role: Role) {
    this.bind(role, undefined)
  }

  private bind(role: Role, account: Address | undefined) {
    const roles = { ...this.state.roles, [role]: account }
    if (!account) delete roles[role]
    try {
      localStorage.setItem(ROLES_KEY, JSON.stringify(roles))
    } catch {}
    this.setWallet({ roles })
  }

  /** The role whose wallet signs the next transactions (the tab the user is on). */
  setActing(role: Role) {
    this.acting = role
  }

  /**
   * Resolves the signing role and account once per action. Every write method calls this first, synchronously
   * reading the role, so switching tabs mid-flow can't move later steps of the same action to the other counterparty.
   */
  async signer(role: Role = this.acting ?? 'borrower'): Promise<Signer> {
    const wallet = this.walletClient()
    const account = this.state.roles[role]
    if (!account) throw new Error(`Connect the ${roleLabel[role]} wallet first.`)
    if (role !== 'agent' && same(this.state.roles.borrower, this.state.roles.lender)) {
      throw new Error('The borrower and lender tabs are bound to the same account. Disconnect one and connect a different account.')
    }
    const signer = { wallet, account, role }
    await this.assertSelected(signer)
    await this.ensureChain(wallet)
    return signer
  }

  /** A wallet only signs for its selected account, so refuse rather than send from the wrong counterparty. */
  async assertSelected({ account, role }: Signer) {
    let [selected] = (await this.provider!.request({ method: 'eth_accounts' })) as Address[]
    // Locked or not yet authorised: ask the wallet, which unlocks or prompts.
    if (!selected) [selected] = await this.walletClient().requestAddresses()
    if (!same(selected, account)) {
      throw new Error(`Switch your wallet to the ${roleLabel[role]} account ${account.slice(0, 6)}…${account.slice(-4)} to sign.`)
    }
  }

  /** Sends a simulated request from the action's signer, re-checking the wallet's selected account first. */
  async send(s: Signer, request: Parameters<WalletClient['writeContract']>[0]) {
    await this.assertSelected(s)
    return s.wallet.writeContract(request)
  }

  /** Switches the wallet to the console's network, adding it first if the wallet doesn't know it (e.g. local anvil). */
  private async ensureChain(wallet: WalletClient) {
    if ((await wallet.getChainId()) === chain.id) return
    try {
      await wallet.switchChain({ id: chain.id })
    } catch (e) {
      if ((e as { code?: number }).code !== 4902 && !/unrecognized|not been added|4902/i.test(String(e))) throw e
      await wallet.addChain({ chain })
      await wallet.switchChain({ id: chain.id })
    }
  }
}
