import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'
import { RepoStatus, statusLabel } from './repo'

const revertCopy: Record<string, string> = {
  Unauthorized: 'This wallet is not the party allowed to do that.',
  NotKYCVerified: 'A wallet is not verified in the ERC-3643 identity registry.',
  InvalidLender: 'The lender must be a different, non-zero address.',
  RequiredCollateralAboveCap: 'At the current NAV the collateral needed exceeds the borrower’s cap. Re-propose with a higher cap.',
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
      if (name === 'InvalidState') {
        const stateLabel = statusLabel[Number(revert.data?.args?.[0]) as RepoStatus]?.toLowerCase() ?? 'in this state'
        return `Not allowed while the repo is ${stateLabel}.`
      }
      if (name === 'Error') {
        return `Rejected by the token or identity registry: ${String(revert.data?.args?.[0] ?? revert.reason).replace(/\.$/, '')}.`
      }
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
