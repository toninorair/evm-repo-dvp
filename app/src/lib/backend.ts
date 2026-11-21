import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  http,
  keccak256,
  toHex,
  UserRejectedRequestError,
  type Address,
  type Hash,
  type Log,
  type PublicClient,
  isAddress,
  type WalletClient,
} from 'viem'
import { bondTokenAbi, cashTokenAbi, identityAbi, identityBytecode, identityRegistryAbi, oracleAbi, repoDvpAbi } from './abi'
import { chain, deployBlock, networkName, repoDvP, rpcUrl } from './config'
import { RepoStatus, interestFor, repurchasePrice, same, statusLabel, type Repo, type RepoHistory } from './repo'

/* ============ Shapes ============ */

export type Deployment = {
  repoDvP: Address
  cashToken: Address
  collateralToken: Address
  oracle: Address
  /** Registry nhBOND enforces; RepoDvP requires both parties verified here and in cashRegistry. */
  bondRegistry: Address
  /** Registry nhEUR enforces; usually the same address as bondRegistry. */
  cashRegistry: Address
}

export type OracleSnapshot = {
  price: bigint // 8 decimals
  roundId: bigint
  updatedAt: number
  /** No positive NAV posted, so RepoDvP can't price collateral. RepoDvP applies no age limit. */
  invalid: boolean
  description: string
  previousPrice?: bigint
}

export type EventName =
  | 'RepoProposed'
  | 'RepoOpened'
  | 'RepoSettled'
  | 'MarginCalled'
  | 'MarginToppedUp'
  | 'RepoDefaulted'
  | 'RepoCancelled'

export type LedgerEvent = {
  key: string
  name: EventName
  repoId: bigint
  timestamp: number
  args: Record<string, unknown>
  txHash?: Hash
}

export type Snapshot = {
  deployment: Deployment
  repos: Repo[]
  oracle: OracleSnapshot
  events: LedgerEvent[]
  chainTime: number
  /** False while older event history is still being scanned. */
  historyComplete: boolean
  /** Wallets currently registered in the identity registries, from IdentityRegistered / IdentityRemoved events. */
  registrations: Registration[]
}

export type Registration = {
  wallet: Address
  identity: Address
  /** Registered in nhBOND's and in nhEUR's registry (the same registry when both tokens share one). */
  bond: boolean
  cash: boolean
  block: bigint
}

/** What a registry lookup says about one wallet. */
export type IdentityStatus = {
  wallet: Address
  bond: { registered: boolean; verified: boolean; identity: Address; country: number }
  cash: { registered: boolean; verified: boolean; identity: Address; country: number }
  bondBalance: bigint
  cashBalance: bigint
}

/** What the operator wallet is allowed to do. */
export type OperatorRights = { bondRegistryAgent: boolean; cashRegistryAgent: boolean; bondAgent: boolean; treasury: boolean }

export type Checks = {
  /** The wallet these figures belong to. */
  account: Address
  verified: boolean
  bondBalance: bigint
  cashBalance: bigint
  bondAllowance: bigint
  cashAllowance: bigint
  bondFrozen: boolean
  cashFrozen: boolean
  bondFrozenTokens: bigint
  bondPaused: boolean
  cashPaused: boolean
  isNavAgent: boolean
  gas: bigint
}

export type ProposeInput = {
  lender: Address
  borrowAmount: bigint
  repoRateBps: number
  initialMarginBps: number
  maintenanceMarginBps: number
  termSeconds: number
  curePeriodSeconds: number
  maxCollateralAmount: bigint
  acceptDeadline: number
}

export type Progress = (step: string) => void

/** Who the console is acting for. Each role is bound to its own wallet address. */
export type Role = 'borrower' | 'lender' | 'agent'

type Signer = { wallet: WalletClient; account: Address; role: Role }

export type WalletState = {
  /** The account currently selected in the browser wallet; it is the only one the wallet will sign for. */
  selected?: Address
  chainId?: number
  /** Wallet bound to each role, remembered across reloads and shared between browser tabs. */
  roles: Partial<Record<Role, Address>>
}

const ROLES_KEY = 'repo-dvp:roles'
const roleLabel: Record<Role, string> = { borrower: 'borrower', lender: 'lender', agent: 'operator' }

function loadRoles(): WalletState['roles'] {
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

/* ============ Errors ============ */

const revertCopy: Record<string, string> = {
  Unauthorized: 'This wallet is not the party allowed to do that.',
  NotKYCVerified: 'A wallet is not verified in the ERC-3643 identity registry.',
  InvalidLender: 'The lender must be a different, non-zero address.',
  CollateralAboveCap: 'At the current NAV the collateral needed exceeds the borrower’s cap. Re-propose with a higher cap.',
  ProposalExpired: 'The acceptance deadline has passed.',
  MarginSufficient: 'Collateral is above the maintenance threshold, so no margin call is due.',
  InitialMarginInvalid: 'Initial margin must be at most 5,000 bps.',
  MaintenanceMarginInvalid: 'Maintenance margin cannot exceed the initial margin.',
  TermInvalid: 'Term must be between 1 second and 365 days.',
  CurePeriodInvalid: 'Cure period must be between 1 second and the term.',
  AcceptDeadlineInvalid: 'The acceptance deadline must be in the future.',
  ZeroAmount: 'Amounts must be greater than zero.',
  InvalidNAV: 'The NAV oracle returned an invalid price.',
  AccountIsFrozen: 'An nhEUR account involved is frozen.',
  EnforcedPause: 'nhEUR transfers are paused.',
  ERC20InsufficientAllowance: 'nhEUR allowance to RepoDvP is too low.',
  ERC20InsufficientBalance: 'Not enough nhEUR in the paying wallet.',
  AccessControlUnauthorizedAccount: 'This wallet does not hold the role needed for that.',
}

export function explain(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return 'You declined the request in your wallet.'
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? ''
      if (name === 'InvalidState') return `Not allowed while the repo is ${statusLabel[Number(revert.data?.args?.[0]) as RepoStatus]?.toLowerCase() ?? 'in this state'}.`
      if (name === 'Error') return `Rejected by the token or identity registry: ${String(revert.data?.args?.[0] ?? revert.reason).replace(/\.$/, '')}.` // ERC-3643 require strings
      if (revertCopy[name]) return revertCopy[name]
      if (revert.reason) return revert.reason
      return revert.shortMessage
    }
    if (/user (rejected|denied)/i.test(err.message)) return 'You declined the request in your wallet.'
    return err.shortMessage
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

/* ============ Wallet ============ */

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, fn: (...args: unknown[]) => void): void
}
declare global {
  interface Window {
    ethereum?: Eip1193
  }
}

/* ============ Log indexing ============ */

const EVENT_NAMES = new Set<string>(['RepoProposed', 'RepoOpened', 'RepoSettled', 'MarginCalled', 'MarginToppedUp', 'RepoDefaulted', 'RepoCancelled'])
const MAX_REPOS = 200
const MAX_CHUNK = 10_000n
/** eth_getLogs rejections that mean "ask for fewer blocks", across Alchemy, Infura, QuickNode and public RPCs. */
const RANGE_ERROR = /range|too many|limit|exceed|10,?000|results|block.*size|query returned more/i
/** Settle approvals cover this much future accrual, so the transaction can't fail on a few seconds of interest. */
const SETTLE_BUFFER_SECONDS = 3_600

type DecodedLog = Log<bigint, number, false> & { eventName: string; args: Record<string, unknown> }

class Backend {
  private client: PublicClient
  private wallet?: WalletClient
  private provider?: Eip1193
  private state: WalletState = { roles: loadRoles() }
  private acting?: Role
  private listeners = new Set<(s: WalletState) => void>()

  private deployment?: Deployment
  private logs: DecodedLog[] = []
  private scannedTo?: bigint
  private fromBlock?: bigint
  private chunk = MAX_CHUNK
  private blockTimes = new Map<bigint, number>()
  private navHistory: bigint[] = []
  /** registry address → wallet → registration, rebuilt from events. */
  private registry = new Map<string, Map<string, { wallet: Address; identity: Address; block: bigint }>>()

  constructor() {
    this.client = createPublicClient({
      chain,
      transport: http(rpcUrl),
      // Batch reads through Multicall3 where the chain has it (Sepolia); a bare anvil node does not.
      batch: chain.contracts?.multicall3 ? { multicall: true } : undefined,
    }) as PublicClient
    this.provider = typeof window !== 'undefined' ? window.ethereum : undefined
    this.provider?.on?.('accountsChanged', (a) => this.setWallet({ selected: (a as Address[])[0] }))
    // Another browser tab bound or unbound a role.
    if (typeof window !== 'undefined') window.addEventListener?.('storage', (e) => (e.key === ROLES_KEY || e.key === null) && this.setWallet({ roles: loadRoles() }))
    this.provider?.on?.('chainChanged', (id) => this.setWallet({ chainId: Number(id) }))
  }

  /* ---------- wallet ---------- */

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
    if (other && same(this.state.roles[other], account))
      throw new Error(`${account.slice(0, 6)}…${account.slice(-4)} is already the ${other} wallet. Select a different account in your wallet, then connect again.`)
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
  private async signer(role: Role = this.acting ?? 'borrower'): Promise<Signer> {
    const wallet = this.walletClient()
    const account = this.state.roles[role]
    if (!account) throw new Error(`Connect the ${roleLabel[role]} wallet first.`)
    if (role !== 'agent' && same(this.state.roles.borrower, this.state.roles.lender))
      throw new Error('The borrower and lender tabs are bound to the same account. Disconnect one and connect a different account.')
    const signer = { wallet, account, role }
    await this.assertSelected(signer)
    await this.ensureChain(wallet)
    return signer
  }

  /** A wallet only signs for its selected account, so refuse rather than send from the wrong counterparty. */
  private async assertSelected({ account, role }: Signer) {
    let [selected] = (await this.provider!.request({ method: 'eth_accounts' })) as Address[]
    // Locked or not yet authorised: ask the wallet, which unlocks or prompts.
    if (!selected) [selected] = await this.walletClient().requestAddresses()
    if (!same(selected, account)) throw new Error(`Switch your wallet to the ${roleLabel[role]} account ${account.slice(0, 6)}…${account.slice(-4)} to sign.`)
  }

  /** Sends a simulated request from the action's signer, re-checking the wallet's selected account first. */
  private async send(s: Signer, request: Parameters<WalletClient['writeContract']>[0]) {
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

  /* ---------- reads ---------- */

  private async loadDeployment(): Promise<Deployment> {
    if (this.deployment) return this.deployment
    if (!repoDvP) throw new Error('VITE_REPO_DVP is not set. Copy app/.env.example to app/.env and add the RepoDvP address.')
    const code = await this.client.getCode({ address: repoDvP })
    if (!code || code === '0x') throw new Error(`No contract at ${repoDvP} on ${networkName}. Check VITE_REPO_DVP.`)
    const read = (functionName: 'cashToken' | 'collateralToken' | 'collateralOracle') =>
      this.client.readContract({ address: repoDvP!, abi: repoDvpAbi, functionName })
    const [cashToken, collateralToken, oracle] = await Promise.all([read('cashToken'), read('collateralToken'), read('collateralOracle')])
    // RepoDvP reads each token's registry live, so mirror that rather than caching one registry.
    const [bondRegistry, cashRegistry] = await Promise.all([
      this.client.readContract({ address: collateralToken as Address, abi: bondTokenAbi, functionName: 'identityRegistry' }),
      this.client.readContract({ address: cashToken as Address, abi: cashTokenAbi, functionName: 'identityRegistry' }),
    ])
    this.deployment = {
      repoDvP,
      cashToken: cashToken as Address,
      collateralToken: collateralToken as Address,
      oracle: oracle as Address,
      bondRegistry: bondRegistry as Address,
      cashRegistry: cashRegistry as Address,
    }
    return this.deployment
  }

  private queue: Promise<unknown> = Promise.resolve()

  /** Loads are serialised: the log index is incremental and must not be advanced by two scans at once. */
  load(): Promise<Snapshot> {
    const next = this.queue.then(() => this.loadOnce())
    this.queue = next.catch(() => undefined)
    return next
  }

  private async loadOnce(): Promise<Snapshot> {
    const d = await this.loadDeployment()
    const [count, block] = await Promise.all([
      this.client.readContract({ address: d.repoDvP, abi: repoDvpAbi, functionName: 'repoCount' }),
      this.client.getBlock(),
    ])
    const chainTime = Number(block.timestamp)

    const first = count > BigInt(MAX_REPOS) ? count - BigInt(MAX_REPOS) + 1n : 1n
    const ids: bigint[] = []
    for (let i = count; i >= first; i--) ids.push(i)

    const [orders, states, round, description] = await Promise.all([
      Promise.all(ids.map((id) => this.client.readContract({ address: d.repoDvP, abi: repoDvpAbi, functionName: 'orders', args: [id] }))),
      Promise.all(ids.map((id) => this.client.readContract({ address: d.repoDvP, abi: repoDvpAbi, functionName: 'states', args: [id] }))),
      this.client.readContract({ address: d.oracle, abi: oracleAbi, functionName: 'latestRoundData' }),
      this.client.readContract({ address: d.oracle, abi: oracleAbi, functionName: 'description' }).catch(() => 'NAV / EUR'),
    ])

    const historyComplete = await this.scan(d, block.number)
    const history = this.histories()

    const repos: Repo[] = ids.map((id, i) => {
      const [borrower, lender, borrowAmount, repoRateBps, initialMarginBps, maintenanceMarginBps, termSeconds, curePeriodSeconds, acceptDeadline, maxCollateralAmount] = orders[i]
      const [status, collateralAmount, startTime, maturity, cureDeadline] = states[i]
      return {
        id,
        order: { borrower, lender, borrowAmount, repoRateBps, initialMarginBps, maintenanceMarginBps, termSeconds, curePeriodSeconds, acceptDeadline, maxCollateralAmount },
        state: { status: status as RepoStatus, startTime, maturity, collateralAmount, cureDeadline },
        history: history.get(id) ?? { txs: {} },
      }
    })

    const [roundId, answer, , updatedAt] = round
    return {
      deployment: d,
      repos,
      oracle: {
        price: answer > 0n ? answer : 0n,
        roundId,
        updatedAt: Number(updatedAt),
        invalid: answer <= 0n,
        description,
        previousPrice: this.navHistory.length > 1 ? this.navHistory[this.navHistory.length - 2] : undefined,
      },
      events: this.recentEvents(),
      chainTime,
      historyComplete,
      registrations: this.registrations(d),
    }
  }

  /** Fetches new RepoDvP and oracle logs since the last scan, shrinking the block range if the RPC refuses it. */
  private async scan(d: Deployment, head: bigint): Promise<boolean> {
    // Start at the oracle's deployment: DeployAll creates it before RepoDvP and posts the first NAV there.
    this.fromBlock ??= deployBlock > 0n ? deployBlock : await this.findDeployBlock(d.oracle, head)
    let from = this.scannedTo === undefined ? this.fromBlock : this.scannedTo + 1n
    const budget = Date.now() + 4_000 // keep each refresh responsive; the rest is picked up next time
    while (from <= head) {
      if (Date.now() > budget) return false
      const to = from + this.chunk - 1n < head ? from + this.chunk - 1n : head
      try {
        const [repoLogs, navLogs, idLogs] = await Promise.all([
          this.client.getContractEvents({ address: d.repoDvP, abi: repoDvpAbi, fromBlock: from, toBlock: to }),
          this.client.getContractEvents({ address: d.oracle, abi: oracleAbi, eventName: 'NAVSubmitted', fromBlock: from, toBlock: to }),
          this.client.getContractEvents({ address: [...new Set([d.bondRegistry, d.cashRegistry])], abi: identityRegistryAbi, fromBlock: from, toBlock: to }),
        ])
        for (const l of idLogs) {
          const key = l.address.toLowerCase()
          const map = this.registry.get(key) ?? new Map()
          this.registry.set(key, map)
          const a = l.args as { investorAddress?: Address; identity?: Address }
          if (!a.investorAddress) continue
          if (l.eventName === 'IdentityRegistered') map.set(a.investorAddress.toLowerCase(), { wallet: a.investorAddress, identity: a.identity!, block: l.blockNumber })
          else if (l.eventName === 'IdentityRemoved') map.delete(a.investorAddress.toLowerCase())
        }
        for (const l of repoLogs as unknown as DecodedLog[]) if (EVENT_NAMES.has(l.eventName)) this.logs.push(l)
        for (const l of navLogs) if (l.args.navEur !== undefined) this.navHistory.push(l.args.navEur)
        this.scannedTo = to
        from = to + 1n
        if (this.chunk < MAX_CHUNK) this.chunk = this.chunk * 2n < MAX_CHUNK ? this.chunk * 2n : MAX_CHUNK
      } catch (e) {
        // Shrink only when the RPC refuses the range; other failures (rate limits, timeouts) retry on the next poll.
        if (!RANGE_ERROR.test(e instanceof Error ? e.message : String(e)) || this.chunk <= 10n) throw e
        this.chunk = this.chunk / 4n > 10n ? this.chunk / 4n : 10n
      }
    }
    await this.fillBlockTimes()
    return true
  }

  /** Binary-searches the block a contract was deployed in, so history starts there instead of at genesis. */
  private async findDeployBlock(address: Address, head: bigint) {
    const key = `repo-dvp:deploy-block:${address.toLowerCase()}`
    try {
      const cached = localStorage.getItem(key)
      if (cached) return BigInt(cached)
    } catch {}
    try {
      let lo = 0n
      let hi = head
      while (lo < hi) {
        const mid = (lo + hi) / 2n
        const code = await this.client.getCode({ address, blockNumber: mid })
        if (code && code !== '0x') hi = mid
        else lo = mid + 1n
      }
      try {
        localStorage.setItem(key, String(lo))
      } catch {}
      return lo
    } catch {
      // RPC without historical state: fall back to roughly the last week of blocks.
      return head > 50_000n ? head - 50_000n : 0n
    }
  }

  private async fillBlockTimes() {
    const missing = [...new Set(this.logs.slice(-40).map((l) => l.blockNumber))].filter((n) => !this.blockTimes.has(n))
    await Promise.all(
      missing.map(async (n) => {
        try {
          this.blockTimes.set(n, Number((await this.client.getBlock({ blockNumber: n })).timestamp))
        } catch {}
      }),
    )
  }

  private histories() {
    const map = new Map<bigint, RepoHistory>()
    for (const l of this.logs) {
      const a = l.args as Record<string, never>
      const id = a.repoId as unknown as bigint
      const h = map.get(id) ?? { txs: {} }
      const tx = l.transactionHash ?? undefined
      switch (l.eventName) {
        case 'RepoProposed':
          h.txs.proposed = tx
          break
        case 'RepoOpened':
          h.openedCollateral = a.collateralAmount
          h.txs.opened = tx
          break
        case 'MarginCalled':
          h.marginCalledValue = a.currentCollateralValue
          break
        case 'RepoSettled':
          h.settled = { totalRepaid: a.totalRepaid, collateralReturned: a.collateralReturned, at: Number(a.settlementTimestamp), tx }
          h.txs.closed = tx
          break
        case 'RepoDefaulted':
          h.defaulted = { amountOwed: a.amountOwed, seized: a.collateralSeized, surplus: a.surplusCollateral, reason: a.reason, tx }
          h.txs.closed = tx
          break
        case 'RepoCancelled':
          h.txs.closed = tx
          break
      }
      map.set(id, h)
    }
    return map
  }

  private recentEvents(): LedgerEvent[] {
    return this.logs
      .slice(-40)
      .reverse()
      .map((l) => ({
        key: `${l.transactionHash}-${l.logIndex}`,
        name: l.eventName as EventName,
        repoId: (l.args as { repoId: bigint }).repoId,
        timestamp: this.blockTimes.get(l.blockNumber) ?? 0,
        args: l.args,
        txHash: l.transactionHash ?? undefined,
      }))
  }

  async checks(account: Address): Promise<Checks> {
    const d = await this.loadDeployment()
    const agentRole = keccak256(toHex('CALCULATION_AGENT_ROLE'))
    const safe = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback)
    const [verified, bondBalance, cashBalance, bondAllowance, cashAllowance, bondFrozen, cashFrozen, bondFrozenTokens, bondPaused, cashPaused, isNavAgent, gas] =
      await Promise.all([
        safe(this.verifiedOn(d, account), false),
        safe(this.client.readContract({ address: d.collateralToken, abi: bondTokenAbi, functionName: 'balanceOf', args: [account] }), 0n),
        safe(this.client.readContract({ address: d.cashToken, abi: cashTokenAbi, functionName: 'balanceOf', args: [account] }), 0n),
        safe(this.client.readContract({ address: d.collateralToken, abi: bondTokenAbi, functionName: 'allowance', args: [account, d.repoDvP] }), 0n),
        safe(this.client.readContract({ address: d.cashToken, abi: cashTokenAbi, functionName: 'allowance', args: [account, d.repoDvP] }), 0n),
        safe(this.client.readContract({ address: d.collateralToken, abi: bondTokenAbi, functionName: 'isFrozen', args: [account] }), false),
        safe(this.client.readContract({ address: d.cashToken, abi: cashTokenAbi, functionName: 'isFrozen', args: [account] }), false),
        safe(this.client.readContract({ address: d.collateralToken, abi: bondTokenAbi, functionName: 'getFrozenTokens', args: [account] }), 0n),
        safe(this.client.readContract({ address: d.collateralToken, abi: bondTokenAbi, functionName: 'paused' }), false),
        safe(this.client.readContract({ address: d.cashToken, abi: cashTokenAbi, functionName: 'paused' }), false),
        safe(this.client.readContract({ address: d.oracle, abi: oracleAbi, functionName: 'hasRole', args: [agentRole, account] }), false),
        safe(this.client.getBalance({ address: account }), 0n),
      ])
    return { account, verified, bondBalance, cashBalance, bondAllowance, cashAllowance, bondFrozen, cashFrozen, bondFrozenTokens, bondPaused, cashPaused, isNavAgent, gas }
  }

  /* ---------- writes ---------- */

  private async confirm(hash: Hash, label: string, onStep: Progress) {
    onStep(`${label}… waiting for ${networkName}`)
    const receipt = await this.client.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${label} reverted on-chain (${hash.slice(0, 10)}…).`)
    return receipt
  }

  /** Sets the RepoDvP allowance to `target` when it is below it. ERC-20 approve replaces, so callers pass the total needed. */
  private async ensureAllowance(s: Signer, token: 'cash' | 'bond', target: bigint, onStep: Progress) {
    const d = await this.loadDeployment()
    const { account } = s
    const address = token === 'cash' ? d.cashToken : d.collateralToken
    const abi = token === 'cash' ? cashTokenAbi : bondTokenAbi
    const label = token === 'cash' ? 'nhEUR' : 'nhBOND'
    const current = await this.client.readContract({ address, abi, functionName: 'allowance', args: [account, d.repoDvP] })
    if (current >= target) return
    const { request } = await this.client.simulateContract({ account, address, abi, functionName: 'approve', args: [d.repoDvP, target] })
    onStep(`Approve ${label} for RepoDvP in your wallet`)
    await this.confirm(await this.send(s, request), `Approving ${label}`, onStep)
  }

  /**
   * nhBOND the borrower's still-acceptable proposals need: acceptRepo() pulls from this same allowance, and
   * approve() replaces it. Read from a fresh load and chain time so a stale page or a fast local clock can't undercount.
   */
  private async reservedBond(account: Address) {
    const { repos, chainTime } = await this.load()
    return repos
      .filter((r) => r.state.status === RepoStatus.Proposed && same(r.order.borrower, account) && r.order.acceptDeadline >= chainTime)
      .reduce((sum, r) => sum + r.order.maxCollateralAmount, 0n)
  }

  private async call(
    functionName: 'acceptRepo' | 'cancelRepo' | 'settleRepo' | 'marginCall' | 'claimDefault',
    id: bigint,
    label: string,
    onStep: Progress,
    signer?: Signer,
  ) {
    const s = signer ?? (await this.signer())
    const d = await this.loadDeployment()
    const { request } = await this.client.simulateContract({ account: s.account, address: d.repoDvP, abi: repoDvpAbi, functionName, args: [id] })
    onStep(`Confirm ${label.toLowerCase()} in your wallet`)
    return this.confirm(await this.send(s, request), label, onStep)
  }

  async propose(input: ProposeInput, onStep: Progress): Promise<bigint> {
    const s = await this.signer()
    const { account } = s
    const d = await this.loadDeployment()
    await this.ensureAllowance(s, 'bond', (await this.reservedBond(account)) + input.maxCollateralAmount, onStep)
    const { request, result } = await this.client.simulateContract({
      account,
      address: d.repoDvP,
      abi: repoDvpAbi,
      functionName: 'proposeRepo',
      args: [
        input.lender,
        input.borrowAmount,
        input.repoRateBps,
        input.initialMarginBps,
        input.maintenanceMarginBps,
        input.termSeconds,
        input.curePeriodSeconds,
        input.maxCollateralAmount,
        input.acceptDeadline,
      ],
    })
    onStep('Confirm the proposal in your wallet')
    await this.confirm(await this.send(s, request), 'Proposing', onStep)
    return result
  }

  async accept(repo: Repo, onStep: Progress) {
    const s = await this.signer()
    await this.ensureAllowance(s, 'cash', repo.order.borrowAmount, onStep)
    await this.call('acceptRepo', repo.id, 'Settling the opening leg', onStep, s)
  }

  cancel(repo: Repo, onStep: Progress) {
    return this.call('cancelRepo', repo.id, 'Cancelling', onStep)
  }

  async settle(repo: Repo, now: number, onStep: Progress) {
    const s = await this.signer()
    // Interest accrues every second, so approve the price an hour from now rather than the price at click time.
    const target = repurchasePrice(repo, now) + interestFor(repo.order.borrowAmount, repo.order.repoRateBps, SETTLE_BUFFER_SECONDS)
    await this.ensureAllowance(s, 'cash', target, onStep)
    await this.call('settleRepo', repo.id, 'Settling the closing leg', onStep, s)
  }

  marginCall(repo: Repo, onStep: Progress) {
    return this.call('marginCall', repo.id, 'Issuing the margin call', onStep)
  }

  async topUp(repo: Repo, units: bigint, onStep: Progress) {
    const s = await this.signer()
    const { account } = s
    const d = await this.loadDeployment()
    await this.ensureAllowance(s, 'bond', (await this.reservedBond(account)) + units, onStep)
    const { request } = await this.client.simulateContract({ account, address: d.repoDvP, abi: repoDvpAbi, functionName: 'topUpCollateral', args: [repo.id, units] })
    onStep('Confirm the top-up in your wallet')
    await this.confirm(await this.send(s, request), 'Posting collateral', onStep)
  }

  claimDefault(repo: Repo, onStep: Progress) {
    return this.call('claimDefault', repo.id, 'Closing out the default', onStep)
  }

  /** Calculation agent only: posts a new NAV (8 decimals). Used to move the market and exercise margin calls. */
  async updateNav(price: bigint, onStep: Progress) {
    const s = await this.signer('agent')
    const { account } = s
    const d = await this.loadDeployment()
    const { request } = await this.client.simulateContract({ account, address: d.oracle, abi: oracleAbi, functionName: 'updateNAV', args: [price] })
    onStep('Confirm the NAV update in your wallet')
    await this.confirm(await this.send(s, request), 'Posting NAV', onStep)
  }

  private registrations(d: Deployment): Registration[] {
    const bond = this.registry.get(d.bondRegistry.toLowerCase()) ?? new Map()
    const cash = this.registry.get(d.cashRegistry.toLowerCase()) ?? new Map()
    const out = new Map<string, Registration>()
    for (const [k, r] of bond) out.set(k, { ...r, bond: true, cash: cash.has(k) })
    for (const [k, r] of cash) if (!out.has(k)) out.set(k, { ...r, bond: false, cash: true })
    return [...out.values()].sort((a, b) => Number(b.block - a.block))
  }

  /** Registry status and token balances of any wallet, read live. */
  async identityStatus(wallet: Address): Promise<IdentityStatus> {
    const d = await this.loadDeployment()
    const one = async (registry: Address) => {
      const [registered, verified, identity, country] = await Promise.all([
        this.client.readContract({ address: registry, abi: identityRegistryAbi, functionName: 'contains', args: [wallet] }),
        this.client.readContract({ address: registry, abi: identityRegistryAbi, functionName: 'isVerified', args: [wallet] }),
        this.client.readContract({ address: registry, abi: identityRegistryAbi, functionName: 'identity', args: [wallet] }),
        this.client.readContract({ address: registry, abi: identityRegistryAbi, functionName: 'investorCountry', args: [wallet] }),
      ])
      return { registered, verified, identity, country: Number(country) }
    }
    const [bond, cash, bondBalance, cashBalance] = await Promise.all([
      one(d.bondRegistry),
      d.cashRegistry === d.bondRegistry ? undefined : one(d.cashRegistry),
      this.client.readContract({ address: d.collateralToken, abi: bondTokenAbi, functionName: 'balanceOf', args: [wallet] }),
      this.client.readContract({ address: d.cashToken, abi: cashTokenAbi, functionName: 'balanceOf', args: [wallet] }),
    ])
    return { wallet, bond, cash: cash ?? bond, bondBalance, cashBalance }
  }

  async operatorRights(account: Address): Promise<OperatorRights> {
    const d = await this.loadDeployment()
    const treasuryRole = await this.client.readContract({ address: d.cashToken, abi: cashTokenAbi, functionName: 'TREASURY_ROLE' })
    const [bondRegistryAgent, cashRegistryAgent, bondAgent, treasury] = await Promise.all([
      this.client.readContract({ address: d.bondRegistry, abi: identityRegistryAbi, functionName: 'isAgent', args: [account] }),
      this.client.readContract({ address: d.cashRegistry, abi: identityRegistryAbi, functionName: 'isAgent', args: [account] }),
      this.client.readContract({ address: d.collateralToken, abi: bondTokenAbi, functionName: 'isAgent', args: [account] }),
      this.client.readContract({ address: d.cashToken, abi: cashTokenAbi, functionName: 'hasRole', args: [treasuryRole, account] }),
    ])
    return { bondRegistryAgent, cashRegistryAgent, bondAgent, treasury }
  }

  /**
   * Registry agent only. Mirrors script/deploy/OnboardDesk.s.sol: deploys an ONCHAINID identity owned by the wallet
   * and registers it in each token's registry that doesn't hold it yet. No claim topics are required, so this verifies.
   */
  async registerIdentity(wallet: Address, country: number, onStep: Progress) {
    const s = await this.signer('agent')
    const d = await this.loadDeployment()
    const registries = [...new Set([d.bondRegistry, d.cashRegistry])]
    let identity: Address | undefined
    for (const registry of registries) {
      if (await this.client.readContract({ address: registry, abi: identityRegistryAbi, functionName: 'contains', args: [wallet] })) continue
      if (!identity) {
        await this.assertSelected(s)
        onStep('Deploy the ONCHAINID identity in your wallet')
        const hash = await s.wallet.deployContract({ abi: identityAbi, bytecode: identityBytecode, args: [wallet, false], account: s.account, chain })
        const receipt = await this.confirm(hash, 'Deploying identity', onStep)
        if (!receipt.contractAddress) throw new Error('The identity contract was not created.')
        identity = receipt.contractAddress
      }
      const { request } = await this.client.simulateContract({ account: s.account, address: registry, abi: identityRegistryAbi, functionName: 'registerIdentity', args: [wallet, identity, country] })
      onStep('Confirm the registration in your wallet')
      await this.confirm(await this.send(s, request), 'Registering identity', onStep)
    }
    if (!identity) throw new Error('This wallet is already registered.')
  }

  /** Registry agent only: removes the wallet from every registry, so RepoDvP and both tokens reject it again. */
  async removeIdentity(wallet: Address, onStep: Progress) {
    const s = await this.signer('agent')
    const d = await this.loadDeployment()
    for (const registry of [...new Set([d.bondRegistry, d.cashRegistry])]) {
      if (!(await this.client.readContract({ address: registry, abi: identityRegistryAbi, functionName: 'contains', args: [wallet] }))) continue
      const { request } = await this.client.simulateContract({ account: s.account, address: registry, abi: identityRegistryAbi, functionName: 'deleteIdentity', args: [wallet] })
      onStep('Confirm the removal in your wallet')
      await this.confirm(await this.send(s, request), 'Removing identity', onStep)
    }
  }

  /** nhBOND agent only. The wallet must already be verified. */
  async issueBonds(wallet: Address, amount: bigint, onStep: Progress) {
    const s = await this.signer('agent')
    const d = await this.loadDeployment()
    const { request } = await this.client.simulateContract({ account: s.account, address: d.collateralToken, abi: bondTokenAbi, functionName: 'issue', args: [wallet, amount] })
    onStep('Confirm the nhBOND issue in your wallet')
    await this.confirm(await this.send(s, request), 'Issuing nhBOND', onStep)
  }

  /** nhEUR TREASURY_ROLE only. The wallet must already be verified. */
  async mintCash(wallet: Address, amount: bigint, onStep: Progress) {
    const s = await this.signer('agent')
    const d = await this.loadDeployment()
    const { request } = await this.client.simulateContract({ account: s.account, address: d.cashToken, abi: cashTokenAbi, functionName: 'mint', args: [wallet, amount, 'CONSOLE-ONBOARDING'] })
    onStep('Confirm the nhEUR mint in your wallet')
    await this.confirm(await this.send(s, request), 'Minting nhEUR', onStep)
  }

  async isVerified(account: Address) {
    return this.verifiedOn(await this.loadDeployment(), account)
  }

  /** Same rule as RepoDvP._requireVerified: verified in both the nhBOND and the nhEUR registry. */
  private async verifiedOn(d: Deployment, account: Address) {
    const registries = d.bondRegistry === d.cashRegistry ? [d.bondRegistry] : [d.bondRegistry, d.cashRegistry]
    const results = await Promise.all(
      registries.map((address) => this.client.readContract({ address, abi: identityRegistryAbi, functionName: 'isVerified', args: [account] })),
    )
    return results.every(Boolean)
  }

  /** Balance and allowance of the other side of a trade, so a doomed acceptRepo() is flagged before signing. */
  async counterparty(repo: Repo) {
    const d = await this.loadDeployment()
    const b = repo.order.borrower
    const [balance, frozen, bondAllowance, verified] = await Promise.all([
      this.client.readContract({ address: d.collateralToken, abi: bondTokenAbi, functionName: 'balanceOf', args: [b] }),
      this.client.readContract({ address: d.collateralToken, abi: bondTokenAbi, functionName: 'getFrozenTokens', args: [b] }),
      this.client.readContract({ address: d.collateralToken, abi: bondTokenAbi, functionName: 'allowance', args: [b, d.repoDvP] }),
      this.verifiedOn(d, b),
    ])
    // ERC-3643 only lets the unfrozen part of a balance move.
    return { bondBalance: balance > frozen ? balance - frozen : 0n, bondAllowance, verified }
  }
}

export const backend = new Backend()
