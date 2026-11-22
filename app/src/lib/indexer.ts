import type { Address, Hash, PublicClient } from 'viem'
import { identityRegistryAbi, oracleAbi, repoDvpAbi } from './abi'
import { deployBlock } from './config'
import type { RepoHistory } from './repo'
import type { DecodedLog, Deployment, EventName, LedgerEvent, Registration } from './types'

const EVENT_NAMES = new Set<string>([
  'RepoProposed',
  'RepoOpened',
  'RepoSettled',
  'MarginCalled',
  'MarginToppedUp',
  'RepoDefaulted',
  'RepoCancelled',
])
const MAX_CHUNK = 10_000n
/** Free tier RPCs (e.g. Alchemy Free) limit eth_getLogs to 10 blocks; public RPCs allow 10,000. */
const RANGE_ERROR = /range|too many|limit|exceed|10,?000|10 block|up to a \d+|results|block.*size|query returned more|free tier|http request failed/i

export class LogIndexer {
  private client: PublicClient
  private logs: DecodedLog[] = []
  private scannedTo?: bigint
  private fromBlock?: bigint
  private chunk = MAX_CHUNK
  private blockTimes = new Map<bigint, number>()
  private navHistory: bigint[] = []
  /** registry address → wallet → registration, rebuilt from events. */
  private registry = new Map<string, Map<string, { wallet: Address; identity: Address; block: bigint; txHash?: Hash }>>()

  constructor(client: PublicClient) {
    this.client = client
  }

  previousNav(): bigint | undefined {
    return this.navHistory.length > 1 ? this.navHistory[this.navHistory.length - 2] : undefined
  }

  /** Fetches new RepoDvP and oracle logs since the last scan, shrinking the block range if the RPC refuses it. */
  async scan(d: Deployment, head: bigint): Promise<boolean> {
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
          if (l.eventName === 'IdentityRegistered') {
            map.set(a.investorAddress.toLowerCase(), {
              wallet: a.investorAddress,
              identity: a.identity!,
              block: l.blockNumber,
              txHash: l.transactionHash ?? undefined,
            })
          } else if (l.eventName === 'IdentityRemoved') {
            map.delete(a.investorAddress.toLowerCase())
          }
        }
        for (const l of repoLogs as unknown as DecodedLog[]) {
          if (EVENT_NAMES.has(l.eventName)) this.logs.push(l)
        }
        for (const l of navLogs) {
          if (l.args.navEur !== undefined) this.navHistory.push(l.args.navEur)
        }
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

  histories(): Map<bigint, RepoHistory> {
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

  recentEvents(): LedgerEvent[] {
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

  registrations(d: Deployment): Registration[] {
    const bond = this.registry.get(d.bondRegistry.toLowerCase()) ?? new Map()
    const cash = this.registry.get(d.cashRegistry.toLowerCase()) ?? new Map()
    const out = new Map<string, Registration>()
    for (const [k, r] of bond) out.set(k, { ...r, bond: true, cash: cash.has(k) })
    for (const [k, r] of cash) if (!out.has(k)) out.set(k, { ...r, bond: false, cash: true })
    return [...out.values()].sort((a, b) => Number(b.block - a.block))
  }
}
