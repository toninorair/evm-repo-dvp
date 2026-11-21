# Architectural Notes & Future Extensions

This document records architectural decisions, simplified settlement patterns, and reference implementations of methods removed from the core `RepoDvP.sol` contract to maintain a lean, highly auditable settlement state machine.

---

## 1. Summary Note on Removed Methods & Architectural Simplification

```solidity
// =========================================================================
// NOTE ON REMOVED METHODS & ARCHITECTURAL SIMPLIFICATION:
//
// --- Note on Gasless Approvals (EIP-2612 / Permit) ---
// Suggestion for future extension:
// EIP-2612 permit helpers (e.g. acceptProposalWithPermit / settleRepoWithPermit) can be introduced
// via a peripheral router or multicall forwarder rather than in this core settlement engine.
// Keeping this core contract strictly based on standard ERC-20 allowances simplifies the execution
// flow, minimizes contract bytecode size, and eliminates try/catch branching overhead.
//
// --- Note on Off-Chain Order Execution (EIP-712) ---
// The off-chain signed order execution method:
// `function executeRepoOrder(RepoOrder calldata order, bytes calldata proposerSignature)`
// was removed for now in favor of on-chain `proposeRepo` and `acceptRepo`.
// Keeping this core contract strictly focused on on-chain proposals and acceptance simplifies the
// settlement workflow, eliminates signature verification and nonce management overhead, and ensures
// maximum auditability and bytecode efficiency for institutional deployment.
// =========================================================================
```

---

## 2. Reference Implementation: Off-Chain Order Execution (`executeRepoOrder`)

### Context

Originally designed to enable zero-gas off-chain RFQ matching where Party A signs an EIP-712 structured order and Party B executes the match on-chain in a single transaction.

### Rationale for Removal from Core

- **Eliminates Cryptographic Overhead:** Removes `EIP712` domain hashing and `ECDSA` signature recovery dependencies from the core clearing engine.
- **Removes State Overhead:** Eliminates mapping storage for replay nonces (`mapping(address => mapping(uint256 => bool)) private _usedNonces`) and nonce invalidation transactions (`invalidateNonce`).
- **Separation of Concerns:** In production institutional architectures, off-chain trade matching is decoupled into a peripheral matching router (forwarder), leaving the core settlement engine focused strictly on escrow, atomic settlement, and margin management.

### Saved Implementation

```solidity
/// @notice EIP-712 structured order for off-chain repo negotiation.
struct RepoOrder {
    address proposer;
    address counterparty;
    bool isBorrower;
    address collateralToken;
    address cashToken;
    uint256 collateralAmount;
    uint256 cashAmount;
    uint32 repoRateBps;
    uint32 tenorSeconds;
    uint32 haircutBps;
    uint256 nonce;
    uint256 deadline;
}

/// @notice EIP-712 typehash for off-chain RepoOrder structs.
bytes32 public constant REPO_ORDER_TYPEHASH = keccak256(
    "RepoOrder(address proposer,address counterparty,bool isBorrower,address collateralToken,address cashToken,uint256 collateralAmount,uint256 cashAmount,uint32 repoRateBps,uint32 tenorSeconds,uint32 haircutBps,uint256 nonce,uint256 deadline)"
);

/// @notice Executes a single-transaction trade match from an off-chain signed order.
function executeRepoOrder(RepoOrder calldata order, bytes calldata proposerSignature)
    external
    nonReentrant
    returns (uint256 repoId)
{
    if (block.timestamp > order.deadline) revert DeadlineExpired();
    if (order.collateralToken == address(0)) revert ZeroCollateralToken();
    if (order.cashToken == address(0)) revert ZeroCashToken();
    if (order.collateralAmount == 0 || order.cashAmount == 0) revert ZeroAmount();
    if (order.haircutBps > MAX_HAIRCUT_BPS) revert HaircutInvalid();
    if (order.tenorSeconds == 0 || order.tenorSeconds > MAX_TENOR_SECONDS) revert TenorInvalid();

    if (_usedNonces[order.proposer][order.nonce]) revert NonceAlreadyUsed();
    _usedNonces[order.proposer][order.nonce] = true;

    bytes32 structHash = _hashRepoOrder(order);
    bytes32 hash = _hashTypedDataV4(structHash);
    address recoveredSigner = ECDSA.recover(hash, proposerSignature);
    if (recoveredSigner != order.proposer) revert SignatureInvalid();

    if (order.counterparty != address(0) && msg.sender != order.counterparty) {
        revert CounterpartyMismatch(order.counterparty, msg.sender);
    }

    if (!IComplianceRegistry(complianceRegistry).isVerified(order.proposer)) revert NotKYCVerified(order.proposer);
    if (!IComplianceRegistry(complianceRegistry).isVerified(msg.sender)) revert NotKYCVerified(msg.sender);

    unchecked {
        repoId = ++repoCount;
    }

    address borrower = order.isBorrower ? order.proposer : msg.sender;
    address lender = order.isBorrower ? msg.sender : order.proposer;

    _terms[repoId] = RepoTerms({
        borrower: borrower,
        lender: lender,
        collateralToken: order.collateralToken,
        cashToken: order.cashToken,
        collateralAmount: order.collateralAmount,
        cashAmount: order.cashAmount,
        repoRateBps: order.repoRateBps,
        haircutBps: order.haircutBps,
        tenorSeconds: order.tenorSeconds
    });

    _executeOpeningLeg(repoId, borrower, lender);
}

function _hashRepoOrder(RepoOrder calldata order) internal pure returns (bytes32) {
    return keccak256(
        bytes.concat(
            abi.encode(
                REPO_ORDER_TYPEHASH,
                order.proposer,
                order.counterparty,
                order.isBorrower,
                order.collateralToken,
                order.cashToken
            ),
            abi.encode(
                order.collateralAmount,
                order.cashAmount,
                order.repoRateBps,
                order.tenorSeconds,
                order.haircutBps,
                order.nonce,
                order.deadline
            )
        )
    );
}
```

---

## 3. Reference Implementation: Gasless Approvals (`EIP-2612 Permit`)

### Context

Originally designed to allow counterparties to approve collateral or cash spending via signed permits without executing a preceding `approve()` transaction.

### Rationale for Removal from Core

- **Minimizes Gas & Bytecode:** Eliminates `try/catch` branching overhead in the critical settlement path.
- **Prevents Divergent Token Semantics:** Not all institutional ERC-20 / ERC-3643 tokens implement EIP-2612 permits identically.
- **Recommended Architecture:** Use a peripheral multicall router or forwarder that calls `token.permit(...)` followed immediately by `repoDvP.acceptRepo(...)` or `repoDvP.settleRepo(...)`.

### Saved Implementation

```solidity
/// @notice Accepts a proposal with an inline EIP-2612 permit for the payer's asset.
function acceptProposalWithPermit(
  uint256 repoId,
  uint256 permitDeadline,
  uint8 v,
  bytes32 r,
  bytes32 s
) external nonReentrant {
  RepoTerms storage terms = _terms[repoId];
  RepoState storage state = _states[repoId];

  if (state.status != RepoStatus.Proposed) {
    revert InvalidState(RepoStatus.Proposed, state.status);
  }

  address payer =
    (terms.lender == address(0) || terms.lender == msg.sender)
      ? msg.sender
      : terms.borrower;
  address token =
    (payer == terms.lender) ? terms.cashToken : terms.collateralToken;
  uint256 amount =
    (payer == terms.lender) ? terms.cashAmount : terms.collateralAmount;

  try
    IERC20Permit(token).permit(
      payer,
      address(this),
      amount,
      permitDeadline,
      v,
      r,
      s
    )
  {} catch {}

  _acceptProposal(repoId);
}

/// @notice Settles a repo with an inline EIP-2612 permit for the cash repayment.
function settleRepoWithPermit(
  uint256 repoId,
  uint256 permitDeadline,
  uint8 v,
  bytes32 r,
  bytes32 s
) external nonReentrant {
  RepoOrder storage order = orders[repoId];
  uint256 totalRepurchasePrice = getCurrentRepurchasePrice(repoId);

  try
    IERC20Permit(cashToken).permit(
      order.borrower,
      address(this),
      totalRepurchasePrice,
      permitDeadline,
      v,
      r,
      s
    )
  {} catch {}

  _settleRepo(repoId);
}
```
