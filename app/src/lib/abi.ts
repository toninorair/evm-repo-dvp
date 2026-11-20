import { parseAbi } from 'viem'

const repoTerms =
  '(address borrower, address lender, address collateralToken, address cashToken, uint256 collateralAmount, uint256 cashAmount, uint32 repoRateBps, uint32 haircutBps, uint32 tenorSeconds)'
const repoState =
  '(uint8 status, uint40 startTime, uint40 maturity, uint40 cureDeadline, uint256 principalRepaid, uint256 interestRepaid, uint256 collateralReturned, uint256 deficitAmount)'

/** Mirrors src/interfaces/IRepoDvP.sol and the public getters on src/RepoDvP.sol. */
export const repoDvpAbi = parseAbi([
  'function proposeRepo(address counterparty, address collateralToken, address cashToken, uint256 collateralAmount, uint256 cashAmount, uint32 repoRateBps, uint32 tenorSeconds, uint32 haircutBps, bool isBorrowerProposer) returns (uint256 repoId)',
  'function acceptRepo(uint256 repoId)',
  'function settleRepo(uint256 repoId)',
  'function triggerMarginCall(uint256 repoId)',
  'function topUpCollateral(uint256 repoId, uint256 topUpAmount)',
  'function claimDefault(uint256 repoId)',
  'function cancelProposal(uint256 repoId)',
  `function getRepo(uint256 repoId) view returns (${repoTerms} terms, ${repoState} state)`,
  'function calculateRepurchasePrice(uint256 repoId) view returns (uint256 principal, uint256 interest, uint256 total)',
  'function getCollateralValue(uint256 repoId) view returns (uint256 collateralValueEUR)',
  'function checkMarginStatus(uint256 repoId) view returns (bool isHealthy, uint256 currentRatioBps, uint256 deficitEUR)',
  'function repoCount() view returns (uint256)',
  'function curePeriodSeconds() view returns (uint32)',
  'function maintenanceMarginBps() view returns (uint32)',
  'function bondPriceOracle() view returns (address)',
  'event RepoProposed(uint256 indexed repoId, address indexed proposer, address indexed counterparty, uint256 cashAmount, uint256 collateralAmount, uint32 repoRateBps, uint32 tenorSeconds)',
  'event RepoOpened(uint256 indexed repoId, address indexed borrower, address indexed lender, uint256 cashAmount, uint256 collateralAmount, uint40 startTime, uint40 maturity)',
  'event RepoSettled(uint256 indexed repoId, uint256 principalRepaid, uint256 interestRepaid, uint256 collateralReturned, uint40 settlementTimestamp)',
  'event MarginCallTriggered(uint256 indexed repoId, uint256 currentCollateralValue, uint256 requiredCollateralValue, uint40 cureDeadline)',
  'event MarginToppedUp(uint256 indexed repoId, uint256 additionalCollateral, uint256 newTotalCollateral)',
  'event RepoDefaulted(uint256 indexed repoId, address indexed lender, uint256 collateralSeized, string reason)',
  'event RepoCancelled(uint256 indexed repoId, address indexed proposer)',
  'error ZeroAmount()',
  'error Unauthorized()',
  'error InvalidState(uint8 expected, uint8 actual)',
  'error NotKYCVerified(address account)',
  'error CounterpartyMismatch(address expected, address actual)',
  'error InsufficientCollateralValue(uint256 providedValue, uint256 requiredValue)',
  'error MaturityNotReached(uint256 maturity, uint256 currentTimestamp)',
  'error CurePeriodActive(uint256 cureDeadline, uint256 currentTimestamp)',
  'error MarginSufficient()',
  'error HaircutInvalid()',
  'error TenorInvalid()',
  'error InvalidPrice()',
  'error StalePrice(uint256 updatedAt, uint256 currentTimestamp)',
])

/** nhNAVOracle: Chainlink AggregatorV3 surface plus attestation getters. */
export const oracleAbi = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function maxStalenessPeriod() view returns (uint256)',
  'function maxDailyDeviationBps() view returns (uint256)',
  'function totalAUM() view returns (uint256)',
  'function totalShares() view returns (uint256)',
  'function lastAuditReportHash() view returns (bytes32)',
  'event NAVSubmitted(uint80 indexed roundId, int256 navEur, uint256 totalAUM, uint256 totalShares, bytes32 auditReportHash, uint256 timestamp)',
])

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])

/** Extra views on nhBOND (ERC-3643) used for pre-trade checks. */
export const bondAbi = parseAbi([
  'function isEligibleInvestor(address account) view returns (bool)',
  'function isFrozen(address account) view returns (bool)',
  'function getFrozenTokens(address account) view returns (uint256)',
])

export const complianceAbi = parseAbi(['function isVerified(address account) view returns (bool)'])
