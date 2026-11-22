import { createPublicClient, fallback, http, keccak256, toHex, type Address, type Hash, type PublicClient } from 'viem'
import { bondTokenAbi, cashTokenAbi, identityAbi, identityBytecode, identityRegistryAbi, oracleAbi, repoDvpAbi } from './abi'
import { chain, isLocal, networkName, repoDvP, rpcUrl, sepoliaFallbackRpcs } from './config'
import { LogIndexer } from './indexer'
import { RepoStatus, interestFor, repurchasePrice, same, type Repo } from './repo'
import type { Checks, Deployment, IdentityStatus, OperatorRights, Progress, ProposeInput, Role, Signer, Snapshot, WalletState } from './types'
import { WalletManager } from './wallet'

export { explain } from './errors'
export type {
  Checks,
  Deployment,
  EventName,
  IdentityStatus,
  LedgerEvent,
  OperatorRights,
  OracleSnapshot,
  Progress,
  ProposeInput,
  Registration,
  Role,
  Snapshot,
  WalletState,
} from './types'

const MAX_REPOS = 200
/** Settle approvals cover this much future accrual, so the transaction can't fail on a few seconds of interest. */
const SETTLE_BUFFER_SECONDS = 3_600

class Backend {
  private client: PublicClient
  private wallet = new WalletManager()
  private indexer: LogIndexer
  private deployment?: Deployment
  private queue: Promise<unknown> = Promise.resolve()

  constructor() {
    const transport = isLocal
      ? http(rpcUrl)
      : fallback(
          [...(rpcUrl ? [rpcUrl] : []), ...sepoliaFallbackRpcs].map((url) =>
            http(url, { timeout: 10_000, retryCount: 1 }),
          ),
        )
    this.client = createPublicClient({
      chain,
      transport,
      // Batch reads through Multicall3 where the chain has it (Sepolia); a bare anvil node does not.
      batch: chain.contracts?.multicall3 ? { multicall: true } : undefined,
    }) as PublicClient
    this.indexer = new LogIndexer(this.client)
  }

  /* ---------- wallet delegation ---------- */

  walletState(): WalletState {
    return this.wallet.walletState()
  }

  subscribe(fn: (s: WalletState) => void) {
    return this.wallet.subscribe(fn)
  }

  restore() {
    return this.wallet.restore()
  }

  connect(role: Role = 'borrower') {
    return this.wallet.connect(role)
  }

  disconnect(role: Role) {
    this.wallet.disconnect(role)
  }

  setActing(role: Role) {
    this.wallet.setActing(role)
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

    const historyComplete = await this.indexer.scan(d, block.number)
    const history = this.indexer.histories()

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
        previousPrice: this.indexer.previousNav(),
      },
      events: this.indexer.recentEvents(),
      chainTime,
      historyComplete,
      registrations: this.indexer.registrations(d),
    }
  }

  async checks(account: Address): Promise<Checks> {
    const d = await this.loadDeployment()
    const agentRole = keccak256(toHex('CALCULATION_AGENT_ROLE'))
    const safe = <T,>(p: Promise<T>, fb: T) => p.catch(() => fb)
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
    await this.confirm(await this.wallet.send(s, request), `Approving ${label}`, onStep)
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
    const s = signer ?? (await this.wallet.signer())
    const d = await this.loadDeployment()
    const { request } = await this.client.simulateContract({ account: s.account, address: d.repoDvP, abi: repoDvpAbi, functionName, args: [id] })
    onStep(`Confirm ${label.toLowerCase()} in your wallet`)
    return this.confirm(await this.wallet.send(s, request), label, onStep)
  }

  async propose(input: ProposeInput, onStep: Progress): Promise<bigint> {
    const s = await this.wallet.signer()
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
    await this.confirm(await this.wallet.send(s, request), 'Proposing', onStep)
    return result
  }

  async accept(repo: Repo, onStep: Progress) {
    const s = await this.wallet.signer()
    await this.ensureAllowance(s, 'cash', repo.order.borrowAmount, onStep)
    await this.call('acceptRepo', repo.id, 'Settling the opening leg', onStep, s)
  }

  cancel(repo: Repo, onStep: Progress) {
    return this.call('cancelRepo', repo.id, 'Cancelling', onStep)
  }

  async settle(repo: Repo, now: number, onStep: Progress) {
    const s = await this.wallet.signer()
    // Interest accrues every second, so approve the price an hour from now rather than the price at click time.
    const target = repurchasePrice(repo, now) + interestFor(repo.order.borrowAmount, repo.order.repoRateBps, SETTLE_BUFFER_SECONDS)
    await this.ensureAllowance(s, 'cash', target, onStep)
    await this.call('settleRepo', repo.id, 'Settling the closing leg', onStep, s)
  }

  marginCall(repo: Repo, onStep: Progress) {
    return this.call('marginCall', repo.id, 'Issuing the margin call', onStep)
  }

  async topUp(repo: Repo, units: bigint, onStep: Progress) {
    const s = await this.wallet.signer()
    const { account } = s
    const d = await this.loadDeployment()
    await this.ensureAllowance(s, 'bond', (await this.reservedBond(account)) + units, onStep)
    const { request } = await this.client.simulateContract({ account, address: d.repoDvP, abi: repoDvpAbi, functionName: 'topUpCollateral', args: [repo.id, units] })
    onStep('Confirm the top-up in your wallet')
    await this.confirm(await this.wallet.send(s, request), 'Posting collateral', onStep)
  }

  claimDefault(repo: Repo, onStep: Progress) {
    return this.call('claimDefault', repo.id, 'Closing out the default', onStep)
  }

  /** Calculation agent only: posts a new NAV (8 decimals). Used to move the market and exercise margin calls. */
  async updateNav(price: bigint, onStep: Progress) {
    const s = await this.wallet.signer('agent')
    const { account } = s
    const d = await this.loadDeployment()
    const { request } = await this.client.simulateContract({ account, address: d.oracle, abi: oracleAbi, functionName: 'updateNAV', args: [price] })
    onStep('Confirm the NAV update in your wallet')
    await this.confirm(await this.wallet.send(s, request), 'Posting NAV', onStep)
  }

  /**
   * Registry agent only. Mirrors script/deploy/OnboardDesk.s.sol: deploys an ONCHAINID identity owned by the wallet
   * and registers it in each token's registry that doesn't hold it yet. No claim topics are required, so this verifies.
   */
  async registerIdentity(wallet: Address, country: number, onStep: Progress) {
    const s = await this.wallet.signer('agent')
    const d = await this.loadDeployment()
    const registries = [...new Set([d.bondRegistry, d.cashRegistry])]
    let identity: Address | undefined
    for (const registry of registries) {
      if (await this.client.readContract({ address: registry, abi: identityRegistryAbi, functionName: 'contains', args: [wallet] })) continue
      if (!identity) {
        await this.wallet.assertSelected(s)
        onStep('Deploy the ONCHAINID identity in your wallet')
        const hash = await s.wallet.deployContract({ abi: identityAbi, bytecode: identityBytecode, args: [wallet, false], account: s.account, chain })
        const receipt = await this.confirm(hash, 'Deploying identity', onStep)
        if (!receipt.contractAddress) throw new Error('The identity contract was not created.')
        identity = receipt.contractAddress
      }
      const { request } = await this.client.simulateContract({ account: s.account, address: registry, abi: identityRegistryAbi, functionName: 'registerIdentity', args: [wallet, identity, country] })
      onStep('Confirm the registration in your wallet')
      await this.confirm(await this.wallet.send(s, request), 'Registering identity', onStep)
    }
    if (!identity) throw new Error('This wallet is already registered.')
  }

  /** Registry agent only: removes the wallet from every registry, so RepoDvP and both tokens reject it again. */
  async removeIdentity(wallet: Address, onStep: Progress) {
    const s = await this.wallet.signer('agent')
    const d = await this.loadDeployment()
    for (const registry of [...new Set([d.bondRegistry, d.cashRegistry])]) {
      if (!(await this.client.readContract({ address: registry, abi: identityRegistryAbi, functionName: 'contains', args: [wallet] }))) continue
      const { request } = await this.client.simulateContract({ account: s.account, address: registry, abi: identityRegistryAbi, functionName: 'deleteIdentity', args: [wallet] })
      onStep('Confirm the removal in your wallet')
      await this.confirm(await this.wallet.send(s, request), 'Removing identity', onStep)
    }
  }

  /** nhBOND agent only. The wallet must already be verified. */
  async issueBonds(wallet: Address, amount: bigint, onStep: Progress) {
    const s = await this.wallet.signer('agent')
    const d = await this.loadDeployment()
    const { request } = await this.client.simulateContract({ account: s.account, address: d.collateralToken, abi: bondTokenAbi, functionName: 'issue', args: [wallet, amount] })
    onStep('Confirm the nhBOND issue in your wallet')
    await this.confirm(await this.wallet.send(s, request), 'Issuing nhBOND', onStep)
  }

  /** nhEUR TREASURY_ROLE only. The wallet must already be verified. */
  async mintCash(wallet: Address, amount: bigint, onStep: Progress) {
    const s = await this.wallet.signer('agent')
    const d = await this.loadDeployment()
    const { request } = await this.client.simulateContract({ account: s.account, address: d.cashToken, abi: cashTokenAbi, functionName: 'mint', args: [wallet, amount, 'CONSOLE-ONBOARDING'] })
    onStep('Confirm the nhEUR mint in your wallet')
    await this.confirm(await this.wallet.send(s, request), 'Minting nhEUR', onStep)
  }
}

export const backend = new Backend()
