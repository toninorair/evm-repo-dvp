import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { sepolia } from 'viem/chains'
import { bondAbi, complianceAbi, erc20Abi, oracleAbi, repoDvpAbi } from './abi'
import { contracts, deployBlock, isDemo, rpcUrl } from './config'
import {
  RepoStatus,
  ZERO,
  collateralValue,
  marginStatus,
  maxRepurchasePrice,
  repurchasePrice,
  requiredOpeningValue,
  type Repo,
  type RiskParams,
} from './repo'

/* ============ Shared shapes ============ */

export type OracleSnapshot = {
  price: bigint // 8 decimals
  updatedAt: number
  stale: boolean
  maxStaleness: number
  maxDeviationBps: number
  previousPrice?: bigint
  description: string
}

export type LedgerEvent = {
  key: string
  name:
    | 'RepoProposed'
    | 'RepoOpened'
    | 'RepoSettled'
    | 'MarginCallTriggered'
    | 'MarginToppedUp'
    | 'RepoDefaulted'
    | 'RepoCancelled'
  repoId: bigint
  timestamp: number
  detail: string
  txHash?: Hash
}

export type Snapshot = {
  repos: Repo[]
  oracle: OracleSnapshot
  risk: RiskParams
  events: LedgerEvent[]
  chainTime: number
}

export type Checks = {
  kyc: boolean
  eligible: boolean
  frozen: boolean
  bondBalance: bigint
  cashBalance: bigint
}

export type ProposeInput = {
  counterparty: Address
  collateralAmount: bigint
  cashAmount: bigint
  repoRateBps: number
  tenorSeconds: number
  haircutBps: number
  asBorrower: boolean
}

export type Progress = (step: string) => void

export interface Backend {
  readonly demo: boolean
  load(): Promise<Snapshot>
  account(): Address | undefined
  connect(): Promise<Address>
  checks(account: Address): Promise<Checks>
  propose(input: ProposeInput, onStep: Progress): Promise<bigint | undefined>
  accept(repo: Repo, onStep: Progress): Promise<void>
  settle(repo: Repo, onStep: Progress): Promise<void>
  triggerMarginCall(repo: Repo, onStep: Progress): Promise<void>
  topUp(repo: Repo, units: bigint, onStep: Progress): Promise<void>
  claimDefault(repo: Repo, onStep: Progress): Promise<void>
  cancel(repo: Repo, onStep: Progress): Promise<void>
}

/* ============ Errors ============ */

const revertCopy: Record<string, string> = {
  Unauthorized: 'This wallet is not a party allowed to do that.',
  InvalidState: 'The repo is no longer in a state that allows this action.',
  NotKYCVerified: 'A counterparty is not verified in the compliance registry.',
  CounterpartyMismatch: 'This proposal names a different counterparty.',
  InsufficientCollateralValue: 'Collateral value is below cash ÷ (1 − haircut) at the current NAV.',
  MaturityNotReached: 'The repo has not reached maturity yet.',
  CurePeriodActive: 'The cure period is still running.',
  MarginSufficient: 'Coverage is above the maintenance threshold, so no call is due.',
  HaircutInvalid: 'Haircut must be at most 5,000 bps.',
  TenorInvalid: 'Tenor must be between 1 second and 365 days.',
  ZeroAmount: 'Amounts must be greater than zero.',
  StalePrice: 'The NAV oracle is stale. Wait for the next attestation.',
  InvalidPrice: 'The NAV oracle returned an invalid price.',
}

export function explain(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? ''
      return revertCopy[name] ?? revert.shortMessage
    }
    if (err.shortMessage.toLowerCase().includes('user rejected')) return 'You declined the request in your wallet.'
    return err.shortMessage
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

/* ============ Live backend (viem) ============ */

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
declare global {
  interface Window {
    ethereum?: Eip1193
  }
}

class LiveBackend implements Backend {
  readonly demo = false
  private client: PublicClient
  private wallet?: WalletClient
  private address?: Address
  private lastPrice?: bigint

  constructor() {
    this.client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) }) as PublicClient
  }

  account() {
    return this.address
  }

  async connect() {
    if (!window.ethereum) throw new Error('No browser wallet found. Install one to sign transactions.')
    this.wallet = createWalletClient({ chain: sepolia, transport: custom(window.ethereum) })
    const [address] = await this.wallet.requestAddresses()
    if ((await this.wallet.getChainId()) !== sepolia.id) await this.wallet.switchChain({ id: sepolia.id })
    this.address = address
    return address
  }

  async load(): Promise<Snapshot> {
    const repo = contracts.repoDvP!
    const oracle = contracts.oracle!
    const [count, cure, maint, block] = await Promise.all([
      this.client.readContract({ address: repo, abi: repoDvpAbi, functionName: 'repoCount' }),
      this.client.readContract({ address: repo, abi: repoDvpAbi, functionName: 'curePeriodSeconds' }),
      this.client.readContract({ address: repo, abi: repoDvpAbi, functionName: 'maintenanceMarginBps' }),
      this.client.getBlock(),
    ])

    const first = count > 100n ? count - 99n : 1n
    const ids: bigint[] = []
    for (let i = count; i >= first; i--) ids.push(i)

    const results = ids.length
      ? await this.client.multicall({
          contracts: ids.map((id) => ({ address: repo, abi: repoDvpAbi, functionName: 'getRepo', args: [id] }) as const),
          allowFailure: false,
        })
      : []

    const repos: Repo[] = results.map(([terms, state], i) => ({
      id: ids[i],
      terms: { ...terms },
      state: { ...state, status: state.status as RepoStatus },
    }))

    const [round, staleness, deviation, description] = await this.client.multicall({
      contracts: [
        { address: oracle, abi: oracleAbi, functionName: 'latestRoundData' },
        { address: oracle, abi: oracleAbi, functionName: 'maxStalenessPeriod' },
        { address: oracle, abi: oracleAbi, functionName: 'maxDailyDeviationBps' },
        { address: oracle, abi: oracleAbi, functionName: 'description' },
      ],
    })

    const stale = round.status === 'failure'
    const price = round.status === 'success' ? round.result[1] : (this.lastPrice ?? 0n)
    const updatedAt = round.status === 'success' ? Number(round.result[3]) : 0
    if (!stale) this.lastPrice = price

    return {
      repos,
      oracle: {
        price,
        updatedAt,
        stale,
        maxStaleness: staleness.status === 'success' ? Number(staleness.result) : 86_400,
        maxDeviationBps: deviation.status === 'success' ? Number(deviation.result) : 50,
        previousPrice: await this.previousPrice(oracle),
        description: description.status === 'success' ? description.result : 'NAV / EUR',
      },
      risk: { curePeriodSeconds: Number(cure), maintenanceMarginBps: Number(maint) },
      events: await this.events(repo),
      chainTime: Number(block.timestamp),
    }
  }

  private async previousPrice(oracle: Address) {
    try {
      const logs = await this.client.getContractEvents({
        address: oracle,
        abi: oracleAbi,
        eventName: 'NAVSubmitted',
        fromBlock: deployBlock,
      })
      return logs.length > 1 ? logs[logs.length - 2].args.navEur : undefined
    } catch {
      return undefined
    }
  }

  private async events(repo: Address): Promise<LedgerEvent[]> {
    try {
      const logs = await this.client.getContractEvents({ address: repo, abi: repoDvpAbi, fromBlock: deployBlock })
      const recent = logs.slice(-12).reverse()
      const blocks = [...new Set(recent.map((l) => l.blockNumber))]
      const times = new Map<bigint, number>()
      await Promise.all(
        blocks.map(async (n) => times.set(n, Number((await this.client.getBlock({ blockNumber: n })).timestamp))),
      )
      return recent.map((log) => describeLog(log, times.get(log.blockNumber) ?? 0))
    } catch {
      return []
    }
  }

  async checks(account: Address): Promise<Checks> {
    const [kyc, eligible, frozen, bondBalance, cashBalance] = await this.client.multicall({
      contracts: [
        { address: contracts.compliance ?? ZERO, abi: complianceAbi, functionName: 'isVerified', args: [account] },
        { address: contracts.nhBOND!, abi: bondAbi, functionName: 'isEligibleInvestor', args: [account] },
        { address: contracts.nhBOND!, abi: bondAbi, functionName: 'isFrozen', args: [account] },
        { address: contracts.nhBOND!, abi: erc20Abi, functionName: 'balanceOf', args: [account] },
        { address: contracts.nhEUR!, abi: erc20Abi, functionName: 'balanceOf', args: [account] },
      ],
    })
    return {
      kyc: kyc.status === 'success' ? kyc.result : false,
      eligible: eligible.status === 'success' ? eligible.result : false,
      frozen: frozen.status === 'success' ? frozen.result : false,
      bondBalance: bondBalance.status === 'success' ? bondBalance.result : 0n,
      cashBalance: cashBalance.status === 'success' ? cashBalance.result : 0n,
    }
  }

  private requireWallet() {
    if (!this.wallet || !this.address) throw new Error('Connect a wallet first.')
    return { wallet: this.wallet, account: this.address }
  }

  private async ensureAllowance(token: Address, amount: bigint, label: string, onStep: Progress) {
    const { wallet, account } = this.requireWallet()
    const current = await this.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account, contracts.repoDvP!],
    })
    if (current >= amount) return
    onStep(`Approve ${label} in your wallet`)
    const hash = await wallet.writeContract({
      account,
      chain: sepolia,
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [contracts.repoDvP!, amount],
    })
    onStep(`Approving ${label}…`)
    await this.client.waitForTransactionReceipt({ hash })
  }

  private async send(
    functionName: 'acceptRepo' | 'settleRepo' | 'triggerMarginCall' | 'claimDefault' | 'cancelProposal',
    id: bigint,
    label: string,
    onStep: Progress,
  ) {
    const { wallet, account } = this.requireWallet()
    const { request } = await this.client.simulateContract({
      account,
      address: contracts.repoDvP!,
      abi: repoDvpAbi,
      functionName,
      args: [id],
    })
    onStep(`Confirm ${label} in your wallet`)
    const hash = await wallet.writeContract(request)
    onStep(`${label}…`)
    await this.client.waitForTransactionReceipt({ hash })
  }

  async propose(input: ProposeInput, onStep: Progress) {
    const { wallet, account } = this.requireWallet()
    // The opening leg pulls both legs on acceptRepo(): approve this side up front.
    if (input.asBorrower) await this.ensureAllowance(contracts.nhBOND!, input.collateralAmount, 'nhBOND', onStep)
    else await this.ensureAllowance(contracts.nhEUR!, input.cashAmount, 'nhEUR', onStep)
    const { request, result } = await this.client.simulateContract({
      account,
      address: contracts.repoDvP!,
      abi: repoDvpAbi,
      functionName: 'proposeRepo',
      args: [
        input.counterparty,
        contracts.nhBOND!,
        contracts.nhEUR!,
        input.collateralAmount,
        input.cashAmount,
        input.repoRateBps,
        input.tenorSeconds,
        input.haircutBps,
        input.asBorrower,
      ],
    })
    onStep('Confirm the proposal in your wallet')
    const hash = await wallet.writeContract(request)
    onStep('Proposing…')
    await this.client.waitForTransactionReceipt({ hash })
    return result
  }

  async accept(repo: Repo, onStep: Progress) {
    const { account } = this.requireWallet()
    const me = account.toLowerCase()
    const isBorrower =
      repo.terms.borrower.toLowerCase() === me || (repo.terms.borrower === ZERO && repo.terms.lender.toLowerCase() !== me)
    if (isBorrower) await this.ensureAllowance(repo.terms.collateralToken, repo.terms.collateralAmount, 'nhBOND', onStep)
    else await this.ensureAllowance(repo.terms.cashToken, repo.terms.cashAmount, 'nhEUR', onStep)
    await this.send('acceptRepo', repo.id, 'Settling the opening leg', onStep)
  }

  async settle(repo: Repo, onStep: Progress) {
    // Interest is capped at full tenor, so the maximum repurchase price is a safe allowance.
    await this.ensureAllowance(repo.terms.cashToken, maxRepurchasePrice(repo.terms), 'nhEUR', onStep)
    await this.send('settleRepo', repo.id, 'Settling the closing leg', onStep)
  }

  triggerMarginCall(repo: Repo, onStep: Progress) {
    return this.send('triggerMarginCall', repo.id, 'Issuing the margin call', onStep)
  }

  async topUp(repo: Repo, units: bigint, onStep: Progress) {
    const { wallet, account } = this.requireWallet()
    await this.ensureAllowance(repo.terms.collateralToken, units, 'nhBOND', onStep)
    const { request } = await this.client.simulateContract({
      account,
      address: contracts.repoDvP!,
      abi: repoDvpAbi,
      functionName: 'topUpCollateral',
      args: [repo.id, units],
    })
    onStep('Confirm the top-up in your wallet')
    const hash = await wallet.writeContract(request)
    onStep('Posting collateral…')
    await this.client.waitForTransactionReceipt({ hash })
  }

  claimDefault(repo: Repo, onStep: Progress) {
    return this.send('claimDefault', repo.id, 'Seizing collateral', onStep)
  }

  cancel(repo: Repo, onStep: Progress) {
    return this.send('cancelProposal', repo.id, 'Cancelling', onStep)
  }
}

type AnyLog = { eventName: string; args: Record<string, unknown>; transactionHash: Hash | null; logIndex: number | null }

function describeLog(log: AnyLog, timestamp: number): LedgerEvent {
  const a = log.args as Record<string, bigint> & { reason?: string; counterparty?: string }
  const name = log.eventName as LedgerEvent['name']
  const e = (v: bigint) => `€${(Number(v / 10n ** 14n) / 10_000).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
  const u = (v: bigint) => (Number(v / 10n ** 16n) / 100).toLocaleString('en-US')
  const detail: Record<string, () => string> = {
    RepoProposed: () => `${a.counterparty === ZERO ? 'Open RFQ' : 'Bilateral'} · ${e(a.cashAmount)}`,
    RepoOpened: () => `DvP · ${u(a.collateralAmount)} nhBOND ⇄ ${e(a.cashAmount)}`,
    RepoSettled: () => `RvP · interest ${e(a.interestRepaid)}`,
    MarginCallTriggered: () => `Shortfall vs required ${e(a.requiredCollateralValue - a.currentCollateralValue)}`,
    MarginToppedUp: () => `+${u(a.additionalCollateral)} nhBOND posted`,
    RepoDefaulted: () => `${u(a.collateralSeized)} nhBOND seized · ${a.reason}`,
    RepoCancelled: () => 'Proposal withdrawn',
  }
  return {
    key: `${log.transactionHash}-${log.logIndex}`,
    name,
    repoId: a.repoId,
    timestamp,
    detail: detail[name]?.() ?? '',
    txHash: log.transactionHash ?? undefined,
  }
}

/* ============ Demo backend (README scenario, in memory) ============ */

export const DEMO_DESKS = {
  A: '0x91cd5a0b2e7f43c18d6a9e2b4f70c1d8ae3e3e07' as Address,
  B: '0x7a3f2b8e04d1c5a9f0e6b3c2d8a71e44b0c9c19e' as Address,
  C: '0x4c8e1f02b93a6d7e55f0c1a2b3d4e5f6a7b8c9d0' as Address,
  D: '0x2b7d9e3f4a5c6b8d0e1f2a3b4c5d6e7f8091a2b3' as Address,
  E: '0x6e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c4b3' as Address,
}
export const DEMO_TOKENS = {
  bond: '0x2c0b4e7a91f35d6c08b2a4e6f1d3c5b7a9e871af' as Address,
  cash: '0xe81d3a5c7e9f0b2d4f6a8c0e2b4d6f8a0c2e04b3' as Address,
}

const E = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 16n

class DemoBackend implements Backend {
  readonly demo = true
  private repos: Repo[] = []
  private events: LedgerEvent[] = []
  private price = 92_00000000n
  private previous = 92_16600000n
  private updatedAt = 0
  private risk: RiskParams = { curePeriodSeconds: 7_200, maintenanceMarginBps: 100 }
  private me: Address = DEMO_DESKS.A
  private bonds: Record<string, bigint> = {}
  private cash: Record<string, bigint> = {}

  constructor() {
    const now = Math.floor(Date.now() / 1000)
    const h = 3600
    const d = 86_400
    this.updatedAt = now - 12 * h
    const mk = (
      id: number,
      borrower: Address,
      lender: Address,
      units: number,
      cash: number,
      rate: number,
      days: number,
      status: RepoStatus,
      start: number,
      extra: Partial<Repo['state']> = {},
    ): Repo => ({
      id: BigInt(id),
      terms: {
        borrower,
        lender,
        collateralToken: DEMO_TOKENS.bond,
        cashToken: DEMO_TOKENS.cash,
        collateralAmount: E(units),
        cashAmount: E(cash),
        repoRateBps: rate,
        haircutBps: 200,
        tenorSeconds: days * d,
      },
      state: {
        status,
        startTime: start,
        maturity: start ? start + days * d : 0,
        cureDeadline: 0,
        principalRepaid: 0n,
        interestRepaid: 0n,
        collateralReturned: 0n,
        deficitAmount: 0n,
        ...extra,
      },
    })
    const callAt = now - 18 * 60
    const r42 = mk(42, DEMO_DESKS.A, DEMO_DESKS.B, 105_000, 10_000_000, 350, 7, RepoStatus.MarginCalled, now - (8 * h + 51 * 60), {
      cureDeadline: callAt + this.risk.curePeriodSeconds,
    })
    r42.state.deficitAmount = marginStatus({ ...r42, state: { ...r42.state, status: RepoStatus.Active } }, this.price, callAt, this.risk).deficit
    this.repos = [
      mk(43, DEMO_DESKS.A, ZERO, 55_500, 5_000_000, 340, 14, RepoStatus.Proposed, 0),
      r42,
      mk(41, DEMO_DESKS.A, DEMO_DESKS.B, 114_200, 10_000_000, 350, 7, RepoStatus.Active, now - (3 * d + 8 * h + 51 * 60)),
      mk(40, DEMO_DESKS.C, DEMO_DESKS.B, 170_000, 15_000_000, 345, 30, RepoStatus.Active, now - 2 * d),
      mk(39, DEMO_DESKS.D, DEMO_DESKS.B, 84_050, 7_500_000, 348, 1, RepoStatus.Active, now - 9 * h),
      mk(38, DEMO_DESKS.A, DEMO_DESKS.B, 105_000, 10_000_000, 350, 7, RepoStatus.Settled, now - 9 * d, {
        principalRepaid: E(10_000_000),
        interestRepaid: E(6_805.56),
        collateralReturned: E(105_000),
      }),
      mk(37, DEMO_DESKS.E, DEMO_DESKS.B, 21_000, 2_000_000, 355, 7, RepoStatus.Defaulted, now - 10 * d),
    ]
    // RepoDvP zeroes collateralAmount once escrow is released or seized.
    for (const r of this.repos) if (r.state.status >= RepoStatus.Settled) r.terms.collateralAmount = 0n
    this.bonds = { [DEMO_DESKS.A]: E(38_400), [DEMO_DESKS.B]: 0n }
    this.cash = { [DEMO_DESKS.A]: E(2_500_000), [DEMO_DESKS.B]: E(40_000_000) }
    this.events = [
      ev('MarginCallTriggered', 42n, callAt, `Shortfall vs required ${fmtEur(r42.state.deficitAmount)}`),
      ev('RepoProposed', 43n, now - 4 * h, 'Open RFQ · €5,000,000.00'),
      ev('RepoOpened', 42n, r42.state.startTime, 'DvP · 105,000 nhBOND ⇄ €10,000,000.00'),
      ev('RepoOpened', 39n, now - 9 * h, 'DvP · 84,050 nhBOND ⇄ €7,500,000.00'),
      ev('RepoSettled', 38n, now - 2 * d, 'RvP · interest €6,805.56'),
      ev('RepoDefaulted', 37n, now - 3 * d + 2 * h, '21,000 nhBOND seized · Maturity Non-Payment'),
    ]
  }

  /** Demo only: act as another desk to explore lender-side actions. */
  setAccount(a: Address) {
    this.me = a
  }
  account() {
    return this.me
  }
  async connect() {
    return this.me
  }

  async load(): Promise<Snapshot> {
    await wait(120)
    return {
      repos: this.repos.map((r) => ({ id: r.id, terms: { ...r.terms }, state: { ...r.state } })),
      oracle: {
        price: this.price,
        previousPrice: this.previous,
        updatedAt: this.updatedAt,
        stale: false,
        maxStaleness: 86_400,
        maxDeviationBps: 50,
        description: 'Nordhaven EUR Sovereign Fund NAV / EUR',
      },
      risk: { ...this.risk },
      events: [...this.events].sort((a, b) => b.timestamp - a.timestamp),
      chainTime: Math.floor(Date.now() / 1000),
    }
  }

  async checks(account: Address): Promise<Checks> {
    return {
      kyc: true,
      eligible: true,
      frozen: false,
      bondBalance: this.bonds[account] ?? 0n,
      cashBalance: this.cash[account] ?? 0n,
    }
  }

  private find(id: bigint) {
    const r = this.repos.find((x) => x.id === id)
    if (!r) throw new Error('Repo not found.')
    return r
  }

  private async tx(onStep: Progress, label: string) {
    onStep(`Confirm ${label} in your wallet`)
    await wait(500)
    onStep(`${label}…`)
    await wait(700)
  }

  async propose(input: ProposeInput, onStep: Progress) {
    await this.tx(onStep, 'the proposal')
    const now = nowS()
    const id = this.repos.reduce((m, r) => (r.id > m ? r.id : m), 0n) + 1n
    this.repos.unshift({
      id,
      terms: {
        borrower: input.asBorrower ? this.me : input.counterparty,
        lender: input.asBorrower ? input.counterparty : this.me,
        collateralToken: DEMO_TOKENS.bond,
        cashToken: DEMO_TOKENS.cash,
        collateralAmount: input.collateralAmount,
        cashAmount: input.cashAmount,
        repoRateBps: input.repoRateBps,
        haircutBps: input.haircutBps,
        tenorSeconds: input.tenorSeconds,
      },
      state: emptyState(RepoStatus.Proposed),
    })
    this.events.push(
      ev('RepoProposed', id, now, `${input.counterparty === ZERO ? 'Open RFQ' : 'Bilateral'} · ${fmtEur(input.cashAmount)}`),
    )
    return id
  }

  async accept(repo: Repo, onStep: Progress) {
    const r = this.find(repo.id)
    if (r.state.status !== RepoStatus.Proposed) throw new Error(revertCopy.InvalidState)
    const value = collateralValue(r.terms.collateralAmount, this.price)
    if (value < requiredOpeningValue(r.terms.cashAmount, r.terms.haircutBps)) throw new Error(revertCopy.InsufficientCollateralValue)
    await this.tx(onStep, 'the opening leg')
    if (r.terms.borrower === ZERO) r.terms.borrower = this.me
    else if (r.terms.lender === ZERO) r.terms.lender = this.me
    const now = nowS()
    r.state = { ...r.state, status: RepoStatus.Active, startTime: now, maturity: now + r.terms.tenorSeconds }
    this.events.push(ev('RepoOpened', r.id, now, `DvP · ${fmtUnits(r.terms.collateralAmount)} nhBOND ⇄ ${fmtEur(r.terms.cashAmount)}`))
  }

  async settle(repo: Repo, onStep: Progress) {
    const r = this.find(repo.id)
    if (r.terms.borrower !== this.me) throw new Error(revertCopy.Unauthorized)
    await this.tx(onStep, 'the closing leg')
    const now = nowS()
    const { principal, interest } = repurchasePrice(r, now)
    r.state = {
      ...r.state,
      status: RepoStatus.Settled,
      principalRepaid: principal,
      interestRepaid: interest,
      collateralReturned: r.terms.collateralAmount,
    }
    r.terms.collateralAmount = 0n
    this.events.push(ev('RepoSettled', r.id, now, `RvP · interest ${fmtEur(interest)}`))
  }

  async triggerMarginCall(repo: Repo, onStep: Progress) {
    const r = this.find(repo.id)
    const now = nowS()
    const m = marginStatus(r, this.price, now, this.risk)
    if (m.healthy) throw new Error(revertCopy.MarginSufficient)
    await this.tx(onStep, 'the margin call')
    r.state = { ...r.state, status: RepoStatus.MarginCalled, cureDeadline: now + this.risk.curePeriodSeconds, deficitAmount: m.deficit }
    this.events.push(ev('MarginCallTriggered', r.id, now, `Shortfall vs required ${fmtEur(m.deficit)}`))
  }

  async topUp(repo: Repo, units: bigint, onStep: Progress) {
    const r = this.find(repo.id)
    if (r.terms.borrower !== this.me) throw new Error(revertCopy.Unauthorized)
    if (units <= 0n) throw new Error(revertCopy.ZeroAmount)
    await this.tx(onStep, 'the top-up')
    r.terms.collateralAmount += units
    this.bonds[this.me] = (this.bonds[this.me] ?? 0n) - units
    const now = nowS()
    if (r.state.status === RepoStatus.MarginCalled && marginStatus(r, this.price, now, this.risk).healthy) {
      r.state = { ...r.state, status: RepoStatus.Active, cureDeadline: 0, deficitAmount: 0n }
    }
    this.events.push(ev('MarginToppedUp', r.id, now, `+${fmtUnits(units)} nhBOND posted`))
  }

  async claimDefault(repo: Repo, onStep: Progress) {
    const r = this.find(repo.id)
    if (r.terms.lender !== this.me) throw new Error(revertCopy.Unauthorized)
    const now = nowS()
    const maturityBreach = now > r.state.maturity
    const cureBreach = r.state.status === RepoStatus.MarginCalled && now > r.state.cureDeadline
    if (!maturityBreach && !cureBreach)
      throw new Error(r.state.status === RepoStatus.MarginCalled ? revertCopy.CurePeriodActive : revertCopy.MaturityNotReached)
    await this.tx(onStep, 'the default claim')
    const seized = r.terms.collateralAmount
    r.state = { ...r.state, status: RepoStatus.Defaulted }
    r.terms.collateralAmount = 0n
    this.events.push(
      ev('RepoDefaulted', r.id, now, `${fmtUnits(seized)} nhBOND seized · ${cureBreach ? 'Margin Call Cure Expired' : 'Maturity Non-Payment'}`),
    )
  }

  async cancel(repo: Repo, onStep: Progress) {
    const r = this.find(repo.id)
    if (r.terms.borrower !== this.me && r.terms.lender !== this.me) throw new Error(revertCopy.Unauthorized)
    await this.tx(onStep, 'the cancellation')
    r.state = { ...r.state, status: RepoStatus.Cancelled }
    this.events.push(ev('RepoCancelled', r.id, nowS(), 'Proposal withdrawn'))
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const nowS = () => Math.floor(Date.now() / 1000)
const emptyState = (status: RepoStatus): Repo['state'] => ({
  status,
  startTime: 0,
  maturity: 0,
  cureDeadline: 0,
  principalRepaid: 0n,
  interestRepaid: 0n,
  collateralReturned: 0n,
  deficitAmount: 0n,
})
let seq = 0
const ev = (name: LedgerEvent['name'], repoId: bigint, timestamp: number, detail: string): LedgerEvent => ({
  key: `demo-${seq++}`,
  name,
  repoId,
  timestamp,
  detail,
})
const fmtEur = (v: bigint) => `€${(Number(v / 10n ** 14n) / 10_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtUnits = (v: bigint) => (Number(v / 10n ** 16n) / 100).toLocaleString('en-US')

export const backend: Backend & { setAccount?: (a: Address) => void } = isDemo ? new DemoBackend() : new LiveBackend()
