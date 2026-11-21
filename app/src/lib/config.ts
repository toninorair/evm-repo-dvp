import { isAddress, type Address } from 'viem'
import { anvil, sepolia } from 'viem/chains'

const env = import.meta.env ?? ({} as ImportMetaEnv)

/** The one address the console needs: tokens, oracle and identity registry are read from RepoDvP itself. */
export const repoDvP: Address | undefined =
  env.VITE_REPO_DVP && isAddress(env.VITE_REPO_DVP) ? (env.VITE_REPO_DVP as Address) : undefined

export const rpcUrl: string | undefined = env.VITE_RPC_URL || undefined

/** Event history is scanned from this block. Set it to the deployment block to keep start-up fast. */
export const deployBlock = BigInt(env.VITE_DEPLOY_BLOCK || 0)

/** VITE_NETWORK=local targets a local anvil node (chain id 31337) for wallet testing before Sepolia. */
export const isLocal = env.VITE_NETWORK === 'local'
export const chain = isLocal ? anvil : sepolia
export const networkName = isLocal ? 'Local anvil' : 'Sepolia'

/** Block explorer for links; none for a local node. */
export const explorer: string | undefined = isLocal ? undefined : 'https://sepolia.etherscan.io'
