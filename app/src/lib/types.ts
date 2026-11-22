import type { Address, Hash, Log, WalletClient } from 'viem'
import type { Repo } from './repo'

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

export type Registration = {
  wallet: Address
  identity: Address
  /** Registered in nhBOND's and in nhEUR's registry (the same registry when both tokens share one). */
  bond: boolean
  cash: boolean
  block: bigint
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

/** What a registry lookup says about one wallet. */
export type IdentityStatus = {
  wallet: Address
  bond: { registered: boolean; verified: boolean; identity: Address; country: number }
  cash: { registered: boolean; verified: boolean; identity: Address; country: number }
  bondBalance: bigint
  cashBalance: bigint
}

/** What the operator wallet is allowed to do. */
export type OperatorRights = {
  bondRegistryAgent: boolean
  cashRegistryAgent: boolean
  bondAgent: boolean
  treasury: boolean
}

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

export type Signer = { wallet: WalletClient; account: Address; role: Role }

export type WalletState = {
  /** The account currently selected in the browser wallet; it is the only one the wallet will sign for. */
  selected?: Address
  chainId?: number
  /** Wallet bound to each role, remembered across reloads and shared between browser tabs. */
  roles: Partial<Record<Role, Address>>
}

export type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, fn: (...args: unknown[]) => void): void
}

export type DecodedLog = Log<bigint, number, false> & {
  eventName: string
  args: Record<string, unknown>
}

declare global {
  interface Window {
    ethereum?: Eip1193
  }
}
