import { isAddress, type Address } from 'viem'
import { anvil, sepolia } from 'viem/chains'

const env = import.meta.env ?? ({} as ImportMetaEnv)

/** VITE_NETWORK=local targets a local anvil node (chain id 31337) for wallet testing before Sepolia. */
export const isLocal = env.VITE_NETWORK === 'local'
export const chain = isLocal ? anvil : sepolia
export const networkName = isLocal ? 'Local anvil' : 'Sepolia'

/** Default verified Sepolia deployment from deployments/11155111.json. */
const SEPOLIA_DEFAULT_REPO_DVP: Address = '0x9b7d0BaE4acDE189DAe646FEfbafFd9842E39233'
const SEPOLIA_DEFAULT_DEPLOY_BLOCK = 12183467n

/** The one address the console needs: tokens, oracle and identity registry are read from RepoDvP itself. */
export const repoDvP: Address | undefined =
  env.VITE_REPO_DVP && isAddress(env.VITE_REPO_DVP)
    ? (env.VITE_REPO_DVP as Address)
    : isLocal
      ? undefined
      : SEPOLIA_DEFAULT_REPO_DVP

/** Reliable CORS-enabled public Sepolia RPC fallbacks when VITE_RPC_URL is not set or fails. */
export const sepoliaFallbackRpcs = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.drpc.org',
  'https://1rpc.io/sepolia',
] as const

export const rpcUrl: string | undefined = env.VITE_RPC_URL || undefined

/** Event history is scanned from this block. Set it to the deployment block to keep start-up fast. */
export const deployBlock =
  env.VITE_DEPLOY_BLOCK !== undefined && env.VITE_DEPLOY_BLOCK !== ''
    ? BigInt(env.VITE_DEPLOY_BLOCK)
    : isLocal
      ? 0n
      : SEPOLIA_DEFAULT_DEPLOY_BLOCK

/** Block explorer for links; none for a local node. */
export const explorer: string | undefined = isLocal ? undefined : 'https://sepolia.etherscan.io'
