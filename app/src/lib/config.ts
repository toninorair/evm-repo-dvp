import { isAddress, type Address } from 'viem'

const env = import.meta.env ?? ({} as ImportMetaEnv)

function addr(value: string | undefined): Address | undefined {
  return value && isAddress(value) ? (value as Address) : undefined
}

export const contracts = {
  repoDvP: addr(env.VITE_REPO_DVP),
  nhBOND: addr(env.VITE_NH_BOND),
  nhEUR: addr(env.VITE_NH_EUR),
  oracle: addr(env.VITE_NAV_ORACLE),
  compliance: addr(env.VITE_COMPLIANCE_REGISTRY),
}

export const rpcUrl: string | undefined = env.VITE_RPC_URL || undefined
export const deployBlock = BigInt(env.VITE_DEPLOY_BLOCK || 0)

/** With no deployment configured the console runs on the README's demo scenario. */
export const isDemo = !contracts.repoDvP || !contracts.nhBOND || !contracts.nhEUR || !contracts.oracle

export const explorer = 'https://sepolia.etherscan.io'
