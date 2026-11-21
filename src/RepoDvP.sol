// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IIdentityRegistry } from "./interfaces/IIdentityRegistry.sol";
import { InhNAVOracle } from "./interfaces/InhNAVOracle.sol";
import { IRepoDvP } from "./interfaces/IRepoDvP.sol";

/// @title  RepoDvP
/// @notice Delivery-versus-Payment (DvP) smart contract engine for tokenised repurchase agreements.
/// @dev    Provides atomic gross settlement, Actual/360 interest calculations, and programmable margin management.
/// @author Ethereum Institutional / Nordhaven Bank
contract RepoDvP is IRepoDvP, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ============ Enums ============ */

    /// @notice Lifecycle status of a repo agreement.
    enum RepoStatus {
        None,
        Proposed,
        Active,
        MarginCalled,
        Settled,
        Defaulted,
        Cancelled
    }

    /* ============ Structs ============ */

    /// @notice Terms of a repo agreement, fixed at proposal.
    struct RepoOrder {
        address borrower;
        address lender;
        uint256 borrowAmount;
        uint32 repoRateBps;
        uint32 initialMarginBps;
        uint32 maintenanceMarginBps;
        uint32 termSeconds;
        uint32 curePeriodSeconds;
        uint40 acceptDeadline;
        uint256 maxCollateralAmount;
    }

    /// @notice Dynamic operational and settlement state of a repo agreement.
    struct RepoState {
        RepoStatus status;
        uint40 startTime;
        uint40 maturity;
        uint256 collateralAmount;
        // Margin call
        uint40 cureDeadline;
    }

    error InvalidState(RepoStatus status);

    /* ============ Constants ============ */

    /// @notice Denominator for basis points (10,000 = 100.00%).
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Combined interest denominator: Actual/360 year in seconds (31,104,000) * BPS_DENOMINATOR.
    uint256 public constant INTEREST_DENOMINATOR = 311_040_000_000;

    /// @notice Oracle price precision (8 decimals, Chainlink AggregatorV3 convention).
    uint256 public constant ORACLE_PRICE_PRECISION = 1e8;

    /// @notice Maximum allowed initial margin over the repurchase price (50.00% / 5,000 bps).
    uint32 public constant MAX_INITIAL_MARGIN_BPS = 5_000;

    /// @notice Maximum allowed term (1 year in seconds).
    uint32 public constant MAX_REPO_TERM_SECONDS = 365 days;

    /* ============ Immutables ============ */

    /// @notice ERC-3643 IdentityRegistry of the collateral token (ONCHAINID-based KYC).
    address public immutable identityRegistry;

    /// @notice Price oracle reporting sovereign bond EUR prices (Chainlink AggregatorV3).
    address public immutable collateralOracle;

    /// @notice Maximum age (seconds) of the oracle price before it is rejected as stale.
    uint256 public immutable maxPriceAge;

    /// @notice The collateral (securities leg) token accepted by this engine, e.g. nhBOND.
    address public immutable collateralToken;

    /// @notice The cash (payment leg) token accepted by this engine, e.g. nhEUR.
    address public immutable cashToken;

    /* ============ Storage ============ */

    /// @notice Total number of repo agreements initialized.
    uint256 public repoCount;

    /// @notice Agreed terms of each repo, fixed at proposal.
    mapping(uint256 repoId => RepoOrder) public orders;

    /// @notice Dynamic operational state of each repo agreement.
    mapping(uint256 repoId => RepoState) public states;

    /* ============ Constructor ============ */

    /// @notice Constructs the RepoDvP settlement contract.
    /// @param  identityRegistry_    Address of the collateral token's ERC-3643 IdentityRegistry.
    /// @param  collateralOracle_    Address of the collateral price oracle.
    /// @param  maxPriceAge_         Maximum accepted age of the oracle price, in seconds.
    /// @param  collateralToken_     Address of the collateral token.
    /// @param  cashToken_           Address of the cash token.
    constructor(
        address identityRegistry_,
        address collateralOracle_,
        uint256 maxPriceAge_,
        address collateralToken_,
        address cashToken_
    ) {
        if ((identityRegistry = identityRegistry_) == address(0)) revert ZeroIdentityRegistry();
        if ((collateralOracle = collateralOracle_) == address(0)) revert ZeroPriceOracle();
        if ((maxPriceAge = maxPriceAge_) == 0) revert ZeroMaxPriceAge();
        if ((collateralToken = collateralToken_) == address(0)) revert ZeroCollateralToken();
        if ((cashToken = cashToken_) == address(0)) revert ZeroCashToken();
    }

    /* ============ Interactive Functions ============ */

    /// @inheritdoc IRepoDvP
    function proposeRepo(
        address lender,
        uint256 borrowAmount,
        uint32 repoRateBps,
        uint32 initialMarginBps,
        uint32 maintenanceMarginBps,
        uint32 termSeconds,
        uint32 curePeriodSeconds,
        uint256 maxCollateralAmount,
        uint40 acceptDeadline
    ) external nonReentrant returns (uint256 repoId) {
        // The borrower proposes (msg.sender); the lender is the named counterparty who must accept.
        address borrower = msg.sender;

        if (lender == address(0) || borrower == lender) revert InvalidLender();
        if (borrowAmount == 0 || maxCollateralAmount == 0) revert ZeroAmount();
        if (initialMarginBps > MAX_INITIAL_MARGIN_BPS) revert InitialMarginInvalid();
        if (maintenanceMarginBps >= initialMarginBps) revert MaintenanceMarginInvalid();
        if (termSeconds == 0 || termSeconds > MAX_REPO_TERM_SECONDS) revert TermInvalid();
        if (curePeriodSeconds == 0 || curePeriodSeconds > termSeconds) revert CurePeriodInvalid();
        if (acceptDeadline <= block.timestamp) revert AcceptDeadlineInvalid();
        if (!IIdentityRegistry(identityRegistry).isVerified(borrower)) revert NotKYCVerified(borrower);
        if (!IIdentityRegistry(identityRegistry).isVerified(lender)) revert NotKYCVerified(lender);

        unchecked {
            repoId = ++repoCount;
        }

        orders[repoId] = RepoOrder({
            borrower: borrower,
            lender: lender,
            borrowAmount: borrowAmount,
            maxCollateralAmount: maxCollateralAmount,
            repoRateBps: repoRateBps,
            initialMarginBps: initialMarginBps,
            maintenanceMarginBps: maintenanceMarginBps,
            termSeconds: termSeconds,
            curePeriodSeconds: curePeriodSeconds,
            acceptDeadline: acceptDeadline
        });

        states[repoId].status = RepoStatus.Proposed;

        emit RepoProposed(repoId, borrower, lender, borrowAmount, maxCollateralAmount, repoRateBps, termSeconds);
    }

    /// @inheritdoc IRepoDvP
    function acceptRepo(uint256 repoId) external nonReentrant {
        RepoOrder storage order = orders[repoId];
        RepoState storage state = states[repoId];

        if (state.status != RepoStatus.Proposed) revert InvalidState(state.status);

        // Only the lender may accept: the borrower accepting would pull the lender's
        // cash via a pre-existing allowance without their consent.
        if (msg.sender != order.lender) revert Unauthorized();
        if (block.timestamp > order.acceptDeadline) revert ProposalExpired(order.acceptDeadline, block.timestamp);

        // Size the collateral at the opening price: the lender gets exactly the agreed initial
        // margin, and the borrower's cap bounds the price move they accepted since proposing.
        uint256 requiredInitialCollateralValue =
            (order.borrowAmount * (BPS_DENOMINATOR + order.initialMarginBps)) / BPS_DENOMINATOR;
        uint256 requiredInitialCollateralAmount = Math.ceilDiv(
            requiredInitialCollateralValue * ORACLE_PRICE_PRECISION,
            getCollateralPrice()
        );
        if (requiredInitialCollateralAmount > order.maxCollateralAmount) {
            revert CollateralAboveCap(requiredInitialCollateralAmount, order.maxCollateralAmount);
        }

        state.status = RepoStatus.Active;
        state.collateralAmount = requiredInitialCollateralAmount;
        state.startTime = uint40(block.timestamp);
        state.maturity = uint40(block.timestamp + order.termSeconds);

        // DvP Settlement: Atomic Gross Settlement of Repo Opening Leg
        // 1. Pull collateral into escrow
        IERC20(collateralToken).safeTransferFrom(order.borrower, address(this), requiredInitialCollateralAmount);
        // 2. Transfer cash directly from lender to borrower
        IERC20(cashToken).safeTransferFrom(order.lender, order.borrower, order.borrowAmount);

        emit RepoOpened(
            repoId,
            order.borrower,
            order.lender,
            order.borrowAmount,
            requiredInitialCollateralAmount,
            state.startTime,
            state.maturity
        );
    }

    /// @inheritdoc IRepoDvP
    function cancelRepo(uint256 repoId) external nonReentrant {
        RepoState storage state = states[repoId];

        if (msg.sender != orders[repoId].borrower) revert Unauthorized();
        if (state.status != RepoStatus.Proposed) revert InvalidState(state.status);

        state.status = RepoStatus.Cancelled;

        emit RepoCancelled(repoId, msg.sender);
    }

    /// @inheritdoc IRepoDvP
    function settleRepo(uint256 repoId) external nonReentrant {
        RepoOrder storage order = orders[repoId];
        RepoState storage state = states[repoId];

        if (msg.sender != order.borrower) revert Unauthorized();
        if (state.status != RepoStatus.Active && state.status != RepoStatus.MarginCalled) {
            revert InvalidState(state.status);
        }

        uint256 totalRepurchasePrice = getCurrentRepurchasePrice(repoId);
        uint256 returnCollateral = state.collateralAmount;

        state.status = RepoStatus.Settled;
        state.collateralAmount = 0;

        // 1. Transfer cash repayment from borrower to lender
        IERC20(cashToken).safeTransferFrom(order.borrower, order.lender, totalRepurchasePrice);

        // 2. Release collateral from smart contract escrow back to borrower
        IERC20(collateralToken).safeTransfer(order.borrower, returnCollateral);

        emit RepoSettled(repoId, totalRepurchasePrice, returnCollateral, uint40(block.timestamp));
    }

    /// @inheritdoc IRepoDvP
    function marginCall(uint256 repoId) external nonReentrant {
        RepoState storage state = states[repoId];
        if (state.status != RepoStatus.Active) revert InvalidState(state.status);

        if (isMarginHealthy(repoId)) revert MarginSufficient();

        state.status = RepoStatus.MarginCalled;
        state.cureDeadline = uint40(block.timestamp + orders[repoId].curePeriodSeconds);

        emit MarginCalled(repoId, getCollateralValue(repoId), state.cureDeadline);
    }

    /// @inheritdoc IRepoDvP
    function topUpCollateral(uint256 repoId, uint256 topUpAmount) external nonReentrant {
        if (topUpAmount == 0) revert ZeroAmount();
        if (msg.sender != orders[repoId].borrower) revert Unauthorized();

        RepoState storage state = states[repoId];
        if (state.status != RepoStatus.MarginCalled && state.status != RepoStatus.Active) {
            revert InvalidState(state.status);
        }

        state.collateralAmount += topUpAmount;

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), topUpAmount);

        // Clear the margin call if the top-up restored a healthy level. If the oracle is unavailable the
        // top-up still lands and the repo stays MarginCalled until a live price confirms the cure.
        try this.isMarginHealthy(repoId) returns (bool healthy) {
            if (healthy) {
                state.status = RepoStatus.Active;
                state.cureDeadline = 0;
            }
        } catch {}

        emit MarginToppedUp(repoId, topUpAmount, state.collateralAmount);
    }

    /// @inheritdoc IRepoDvP
    function claimDefault(uint256 repoId) external nonReentrant {
        RepoOrder storage order = orders[repoId];
        RepoState storage state = states[repoId];

        if (msg.sender != order.lender) revert Unauthorized();

        bool isMaturityBreach = (state.status == RepoStatus.Active) && (block.timestamp > state.maturity);
        bool isMarginCureBreach =
            (state.status == RepoStatus.MarginCalled) &&
                (block.timestamp > state.cureDeadline) &&
                !isMarginHealthy(repoId);
        if (!isMaturityBreach && !isMarginCureBreach) revert InvalidState(state.status);

        uint256 amountOwed = getCurrentRepurchasePrice(repoId);
        // Close-out netting: the lender seizes collateral worth exactly the amount owed (rounded up), no margin.
        uint256 seizedCollateral = Math.min(
            state.collateralAmount,
            Math.ceilDiv(amountOwed * ORACLE_PRICE_PRECISION, getCollateralPrice())
        );
        uint256 surplusCollateral = state.collateralAmount - seizedCollateral;

        state.status = RepoStatus.Defaulted;
        state.collateralAmount = 0;

        IERC20(collateralToken).safeTransfer(order.lender, seizedCollateral);

        if (surplusCollateral > 0) {
            IERC20(collateralToken).safeTransfer(order.borrower, surplusCollateral);
        }

        string memory reason = isMaturityBreach ? "Maturity Non-Payment" : "Margin Call Cure Expired";
        emit RepoDefaulted(repoId, order.lender, amountOwed, seizedCollateral, surplusCollateral, reason);
    }

    /* ============ View Functions ============ */

    /// @inheritdoc IRepoDvP
    function getCollateralPrice() public view returns (uint256) {
        (, int256 price, , uint256 updatedAt, ) = InhNAVOracle(collateralOracle).latestRoundData();
        if (price <= 0) revert InhNAVOracle.InvalidNAV();
        if (block.timestamp - updatedAt > maxPriceAge) revert StalePrice(updatedAt, block.timestamp);
        return uint256(price);
    }

    /// @inheritdoc IRepoDvP
    function getCurrentRepurchasePrice(uint256 repoId) public view returns (uint256) {
        return orders[repoId].borrowAmount + getRepoInterest(repoId);
    }

    /// @inheritdoc IRepoDvP
    function getRepoInterest(uint256 repoId) public view returns (uint256) {
        RepoOrder storage order = orders[repoId];
        RepoState storage state = states[repoId];

        if (state.status != RepoStatus.Active && state.status != RepoStatus.MarginCalled) return 0;

        uint256 elapsed = block.timestamp > state.startTime ? block.timestamp - state.startTime : 0;
        return (order.borrowAmount * order.repoRateBps * elapsed) / INTEREST_DENOMINATOR;
    }

    function getCollateralValue(uint256 repoId) public view returns (uint256) {
        return (states[repoId].collateralAmount * getCollateralPrice()) / ORACLE_PRICE_PRECISION;
    }

    function getRequiredCollateralValue(uint256 repoId) public view returns (uint256) {
        return
            (getCurrentRepurchasePrice(repoId) * (BPS_DENOMINATOR + orders[repoId].maintenanceMarginBps)) /
            BPS_DENOMINATOR;
    }

    function getRequiredCollateralAmount(uint256 repoId) public view returns (uint256) {
        return Math.ceilDiv(getRequiredCollateralValue(repoId) * ORACLE_PRICE_PRECISION, getCollateralPrice());
    }

    function isMarginHealthy(uint256 repoId) public view returns (bool) {
        return getCollateralValue(repoId) >= getRequiredCollateralValue(repoId);
    }
}
