// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IComplianceRegistry} from "./interfaces/IComplianceRegistry.sol";
import {ICollateralPriceOracle} from "./interfaces/ICollateralPriceOracle.sol";
import {IRepoDvP} from "./interfaces/IRepoDvP.sol";

/// @title  RepoDvP
/// @notice Delivery-versus-Payment (DvP) smart contract engine for tokenised repurchase agreements.
/// @dev    Provides atomic gross settlement, Actual/360 interest calculations, and programmable margin management.
/// @author Ethereum Institutional / Nordhaven Bank
contract RepoDvP is IRepoDvP, ReentrancyGuard, AccessControl {
    using SafeERC20 for IERC20;

    /* ============ Constants ============ */

    /// @notice Denominator for basis points (10,000 = 100.00%).
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Seconds per Actual/360 financial year (360 days * 86,400 seconds).
    uint256 public constant SECONDS_PER_YEAR_ACT_360 = 31_104_000;

    /// @notice Combined interest denominator: SECONDS_PER_YEAR_ACT_360 * BPS_DENOMINATOR.
    uint256 public constant INTEREST_DENOMINATOR = 311_040_000_000;

    /// @notice Maximum allowed haircut (50.00% / 5,000 bps).
    uint32 public constant MAX_HAIRCUT_BPS = 5_000;

    /// @notice Maximum allowed tenor (1 year in seconds).
    uint32 public constant MAX_TENOR_SECONDS = 365 days;

    /// @notice Role authorized to configure risk and oracle parameters.
    bytes32 public constant RISK_MANAGER_ROLE = keccak256("RISK_MANAGER_ROLE");

    /* ============ Immutables ============ */

    /// @notice The institutional compliance registry.
    address public immutable complianceRegistry;

    /* ============ Storage ============ */

    /// @notice Price oracle reporting sovereign bond EUR prices (Chainlink AggregatorV3).
    address public bondPriceOracle;

    /// @notice Total number of repo agreements initialized.
    uint256 public repoCount;

    /// @notice Period in seconds granted to a borrower to cure a margin call (default: 2 hours).
    uint32 public curePeriodSeconds;

    /// @notice Maintenance margin buffer in basis points above repurchase price (default: 100 bps / 1.00%).
    uint32 public maintenanceMarginBps;

    /// @notice Contractual terms of each repo agreement.
    mapping(uint256 repoId => RepoTerms) private _terms;

    /// @notice Dynamic operational state of each repo agreement.
    mapping(uint256 repoId => RepoState) private _states;

    /* ============ Constructor ============ */

    /// @notice Constructs the RepoDvP settlement contract.
    /// @param  admin                Address granted DEFAULT_ADMIN_ROLE and RISK_MANAGER_ROLE.
    /// @param  complianceRegistry_ Address of the institutional KYC registry.
    /// @param  collateralOracle_    Address of the collateral price oracle.
    constructor(address admin, address complianceRegistry_, address collateralOracle_) {
        if (admin == address(0)) revert ZeroAdmin();
        if (complianceRegistry_ == address(0)) revert ZeroComplianceRegistry();
        if (collateralOracle_ == address(0)) revert ZeroPriceOracle();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RISK_MANAGER_ROLE, admin);

        complianceRegistry = complianceRegistry_;
        bondPriceOracle = collateralOracle_;

        curePeriodSeconds = 7_200; // 2 hours
        maintenanceMarginBps = 100; // 1.00%
    }

    /* ============ Interactive Functions ============ */

    /// @inheritdoc IRepoDvP
    function proposeRepo(
        address counterparty,
        address collateralToken,
        address cashToken,
        uint256 collateralAmount,
        uint256 cashAmount,
        uint32 repoRateBps,
        uint32 tenorSeconds,
        uint32 haircutBps,
        bool isBorrowerProposer
    ) external nonReentrant returns (uint256 repoId) {
        if (collateralToken == address(0)) revert ZeroCollateralToken();
        if (cashToken == address(0)) revert ZeroCashToken();
        if (collateralAmount == 0 || cashAmount == 0) revert ZeroAmount();
        if (haircutBps > MAX_HAIRCUT_BPS) revert HaircutInvalid();
        if (tenorSeconds == 0 || tenorSeconds > MAX_TENOR_SECONDS) revert TenorInvalid();

        address borrower = isBorrowerProposer ? msg.sender : counterparty;
        address lender = isBorrowerProposer ? counterparty : msg.sender;

        if (borrower != address(0) && !IComplianceRegistry(complianceRegistry).isVerified(borrower)) {
            revert NotKYCVerified(borrower);
        }
        if (lender != address(0) && !IComplianceRegistry(complianceRegistry).isVerified(lender)) {
            revert NotKYCVerified(lender);
        }

        unchecked {
            repoId = ++repoCount;
        }

        _terms[repoId] = RepoTerms({
            borrower: borrower,
            lender: lender,
            collateralToken: collateralToken,
            cashToken: cashToken,
            collateralAmount: collateralAmount,
            cashAmount: cashAmount,
            repoRateBps: repoRateBps,
            haircutBps: haircutBps,
            tenorSeconds: tenorSeconds
        });

        _states[repoId].status = RepoStatus.Proposed;

        emit RepoProposed(repoId, msg.sender, counterparty, cashAmount, collateralAmount, repoRateBps, tenorSeconds);
    }

    /// @inheritdoc IRepoDvP
    function acceptRepo(uint256 repoId) external nonReentrant {
        RepoTerms storage terms = _terms[repoId];
        RepoState storage state = _states[repoId];

        if (state.status != RepoStatus.Proposed) revert InvalidState(RepoStatus.Proposed, state.status);

        // Make sure that caller either lender or borrower is still KYC verified and compliant at the time of acceptance.
        // This prevents a situation where a counterparty is de-verified after proposal but before acceptance.
        if (!IComplianceRegistry(complianceRegistry).isVerified(msg.sender)) revert NotKYCVerified(msg.sender);

        if (terms.borrower == address(0)) {
            // Proposer was lender; accepter is borrower
            terms.borrower = msg.sender;
        } else if (terms.lender == address(0)) {
            // Proposer was borrower; accepter is lender
            terms.lender = msg.sender;
        } else {
            // Bilateral proposal with specific counterparty
            if (msg.sender != terms.borrower && msg.sender != terms.lender) {
                revert CounterpartyMismatch(terms.lender, msg.sender);
            }
        }

        _executeOpeningLeg(repoId, terms.borrower, terms.lender);
    }

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

    /// @inheritdoc IRepoDvP
    function settleRepo(uint256 repoId) external nonReentrant {
        RepoTerms storage terms = _terms[repoId];
        RepoState storage state = _states[repoId];

        if (state.status != RepoStatus.Active && state.status != RepoStatus.MarginCalled) {
            revert InvalidState(RepoStatus.Active, state.status);
        }

        if (msg.sender != terms.borrower) revert Unauthorized();

        (uint256 principal, uint256 interest, uint256 totalRepurchasePrice) = calculateRepurchasePrice(repoId);

        state.status = RepoStatus.Settled;
        state.principalRepaid = principal;
        state.interestRepaid = interest;
        state.collateralReturned = terms.collateralAmount;

        uint256 returnCollateral = terms.collateralAmount;
        terms.collateralAmount = 0;

        // 1. Transfer cash repayment from borrower to lender
        IERC20(terms.cashToken).safeTransferFrom(terms.borrower, terms.lender, totalRepurchasePrice);

        // 2. Release collateral from escrow back to borrower
        IERC20(terms.collateralToken).safeTransfer(terms.borrower, returnCollateral);

        emit RepoSettled(repoId, principal, interest, returnCollateral, uint40(block.timestamp));
    }

    /// @inheritdoc IRepoDvP
    function triggerMarginCall(uint256 repoId) external nonReentrant {
        RepoState storage state = _states[repoId];
        if (state.status != RepoStatus.Active) {
            revert InvalidState(RepoStatus.Active, state.status);
        }

        (bool isHealthy,, uint256 deficitEUR) = checkMarginStatus(repoId);
        if (isHealthy) revert MarginSufficient();

        state.status = RepoStatus.MarginCalled;
        state.cureDeadline = uint40(block.timestamp + curePeriodSeconds);
        state.deficitAmount = deficitEUR;

        uint256 currentVal = getCollateralValue(repoId);
        (,, uint256 totalDue) = calculateRepurchasePrice(repoId);
        uint256 requiredVal = (totalDue * (BPS_DENOMINATOR + maintenanceMarginBps)) / BPS_DENOMINATOR;

        emit MarginCallTriggered(repoId, currentVal, requiredVal, state.cureDeadline);
    }

    /// @inheritdoc IRepoDvP
    function topUpCollateral(uint256 repoId, uint256 topUpAmount) external nonReentrant {
        if (topUpAmount == 0) revert ZeroAmount();

        RepoTerms storage terms = _terms[repoId];
        RepoState storage state = _states[repoId];

        if (state.status != RepoStatus.MarginCalled && state.status != RepoStatus.Active) {
            revert InvalidState(RepoStatus.MarginCalled, state.status);
        }

        if (msg.sender != terms.borrower) revert Unauthorized();

        terms.collateralAmount += topUpAmount;

        IERC20(terms.collateralToken).safeTransferFrom(msg.sender, address(this), topUpAmount);

        (bool isHealthy,,) = checkMarginStatus(repoId);
        if (isHealthy && state.status == RepoStatus.MarginCalled) {
            state.status = RepoStatus.Active;
            state.cureDeadline = 0;
            state.deficitAmount = 0;
        }

        emit MarginToppedUp(repoId, topUpAmount, terms.collateralAmount);
    }

    /// @inheritdoc IRepoDvP
    function claimDefault(uint256 repoId) external nonReentrant {
        RepoTerms storage terms = _terms[repoId];
        RepoState storage state = _states[repoId];

        if (state.status != RepoStatus.Active && state.status != RepoStatus.MarginCalled) {
            revert InvalidState(RepoStatus.Active, state.status);
        }

        if (msg.sender != terms.lender) revert Unauthorized();

        bool isMaturityBreach = block.timestamp > state.maturity;
        bool isMarginCureBreach = state.status == RepoStatus.MarginCalled && block.timestamp > state.cureDeadline;

        if (!isMaturityBreach && !isMarginCureBreach) {
            if (state.status == RepoStatus.MarginCalled) {
                revert CurePeriodActive(state.cureDeadline, block.timestamp);
            } else {
                revert MaturityNotReached(state.maturity, block.timestamp);
            }
        }

        state.status = RepoStatus.Defaulted;
        uint256 seizedCollateral = terms.collateralAmount;
        terms.collateralAmount = 0;

        IERC20(terms.collateralToken).safeTransfer(terms.lender, seizedCollateral);

        string memory reason = isMarginCureBreach ? "Margin Call Cure Expired" : "Maturity Non-Payment";
        emit RepoDefaulted(repoId, terms.lender, seizedCollateral, reason);
    }

    /// @inheritdoc IRepoDvP
    function cancelProposal(uint256 repoId) external nonReentrant {
        RepoTerms storage terms = _terms[repoId];
        RepoState storage state = _states[repoId];

        if (state.status != RepoStatus.Proposed) {
            revert InvalidState(RepoStatus.Proposed, state.status);
        }

        if (msg.sender != terms.borrower && msg.sender != terms.lender) {
            revert Unauthorized();
        }

        state.status = RepoStatus.Cancelled;
        emit RepoCancelled(repoId, msg.sender);
    }

    /// @notice Configures the bond price oracle.
    function setBondPriceOracle(address newOracle) external onlyRole(RISK_MANAGER_ROLE) {
        if (newOracle == address(0)) revert ZeroPriceOracle();
        bondPriceOracle = newOracle;
    }

    /// @notice Configures the margin call cure period.
    function setCurePeriodSeconds(uint32 newCurePeriod) external onlyRole(RISK_MANAGER_ROLE) {
        if (newCurePeriod == 0) revert ZeroAmount();
        curePeriodSeconds = newCurePeriod;
    }

    /// @notice Configures the maintenance margin threshold.
    function setMaintenanceMarginBps(uint32 newMarginBps) external onlyRole(RISK_MANAGER_ROLE) {
        maintenanceMarginBps = newMarginBps;
    }

    /* ============ View Functions ============ */

    /// @inheritdoc IRepoDvP
    function getRepo(uint256 repoId) external view returns (RepoTerms memory terms, RepoState memory state) {
        return (_terms[repoId], _states[repoId]);
    }

    /// @inheritdoc IRepoDvP
    function calculateRepurchasePrice(uint256 repoId)
        public
        view
        returns (uint256 principal, uint256 interest, uint256 total)
    {
        RepoTerms storage terms = _terms[repoId];
        RepoState storage state = _states[repoId];

        principal = terms.cashAmount;
        if (state.status == RepoStatus.Proposed || state.status == RepoStatus.None) {
            interest = (principal * terms.repoRateBps * terms.tenorSeconds) / INTEREST_DENOMINATOR;
        } else if (state.status == RepoStatus.Settled) {
            interest = state.interestRepaid;
        } else {
            uint256 elapsed = block.timestamp > state.startTime ? block.timestamp - state.startTime : 0;
            if (elapsed > terms.tenorSeconds) {
                elapsed = terms.tenorSeconds;
            }
            interest = (principal * terms.repoRateBps * elapsed) / INTEREST_DENOMINATOR;
        }

        total = principal + interest;
    }

    /// @inheritdoc IRepoDvP
    function getCollateralValue(uint256 repoId) public view returns (uint256 collateralValueEUR) {
        RepoTerms storage terms = _terms[repoId];
        (, int256 price,,,) = ICollateralPriceOracle(bondPriceOracle).latestRoundData();
        if (price <= 0) revert ICollateralPriceOracle.InvalidPrice();

        // Bond price has 8 decimals; nhBOND has 18 decimals
        collateralValueEUR = (terms.collateralAmount * uint256(price)) / 1e8;
    }

    /// @inheritdoc IRepoDvP
    function checkMarginStatus(uint256 repoId)
        public
        view
        returns (bool isHealthy, uint256 currentRatioBps, uint256 deficitEUR)
    {
        uint256 collateralValue = getCollateralValue(repoId);
        (,, uint256 totalRepurchasePrice) = calculateRepurchasePrice(repoId);

        if (totalRepurchasePrice == 0) return (true, BPS_DENOMINATOR, 0);

        currentRatioBps = (collateralValue * BPS_DENOMINATOR) / totalRepurchasePrice;
        uint256 requiredValue = (totalRepurchasePrice * (BPS_DENOMINATOR + maintenanceMarginBps)) / BPS_DENOMINATOR;

        if (collateralValue >= requiredValue) {
            isHealthy = true;
            deficitEUR = 0;
        } else {
            isHealthy = false;
            deficitEUR = requiredValue - collateralValue;
        }
    }

    /* ============ Internal Functions ============ */

    function _executeOpeningLeg(uint256 repoId, address borrower, address lender) internal {
        RepoTerms storage terms = _terms[repoId];
        RepoState storage state = _states[repoId];

        uint256 collateralValueEUR = getCollateralValue(repoId);
        uint256 requiredCollateralEUR = (terms.cashAmount * BPS_DENOMINATOR) / (BPS_DENOMINATOR - terms.haircutBps);

        if (collateralValueEUR < requiredCollateralEUR) {
            revert InsufficientCollateralValue(collateralValueEUR, requiredCollateralEUR);
        }

        state.status = RepoStatus.Active;
        state.startTime = uint40(block.timestamp);
        state.maturity = uint40(block.timestamp + terms.tenorSeconds);

        // 1. Pull collateral into escrow
        IERC20(terms.collateralToken).safeTransferFrom(borrower, address(this), terms.collateralAmount);

        // 2. Transfer cash directly from lender to borrower
        IERC20(terms.cashToken).safeTransferFrom(lender, borrower, terms.cashAmount);

        emit RepoOpened(
            repoId, borrower, lender, terms.cashAmount, terms.collateralAmount, state.startTime, state.maturity
        );
    }
}
