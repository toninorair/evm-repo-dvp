// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IIdentityRegistry, IIdentityRegistryBound } from "./interfaces/IIdentityRegistry.sol";
import { InhNAVOracle } from "./interfaces/InhNAVOracle.sol";
import { IRepoDvP } from "./interfaces/IRepoDvP.sol";

/// @title  RepoDvP
/// @notice Delivery-versus-Payment (DvP) smart contract engine for tokenised repurchase agreements.
/// @dev    Provides atomic gross settlement, Actual/360 interest calculations, and programmable margin management.
/// @author Ethereum Institutional / Nordhaven Bank
contract RepoDvP is IRepoDvP {
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
        uint256 collateralAmount;
        uint40 startTime;
        uint40 maturity;
        uint40 cureDeadline;
    }

    error InvalidState(RepoStatus status);

    /* ============ Constants ============ */

    /// @notice Denominator for basis points (10,000 = 100.00%).
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Combined interest denominator: Actual/360 year in seconds (31,104,000) * BPS_DENOMINATOR.
    uint256 public constant INTEREST_DENOMINATOR = 311_040_000_000;

    /// @notice Maximum allowed initial margin over the borrow amount (50.00% / 5,000 bps).
    uint32 public constant MAX_INITIAL_MARGIN_BPS = 5_000;

    /// @notice Maximum allowed term (1 year in seconds).
    uint32 public constant MAX_REPO_TERM_SECONDS = 365 days;

    /* ============ Immutables ============ */

    /// @notice Price oracle reporting sovereign bond EUR prices (Chainlink AggregatorV3).
    address public immutable collateralOracle;

    /// @notice Oracle price precision derived from `collateralOracle.decimals()` at construction (`10 ** decimals()`).
    uint256 public immutable oraclePricePrecision;

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
    /// @param  collateralOracle_    Address of the collateral price oracle.
    /// @param  collateralToken_     Address of the collateral token.
    /// @param  cashToken_           Address of the cash token.
    constructor(address collateralOracle_, address collateralToken_, address cashToken_) {
        if ((collateralOracle = collateralOracle_) == address(0)) revert ZeroPriceOracle();
        if ((collateralToken = collateralToken_) == address(0)) revert ZeroCollateralToken();
        if ((cashToken = cashToken_) == address(0)) revert ZeroCashToken();
        oraclePricePrecision = 10 ** InhNAVOracle(collateralOracle_).decimals();
    }

    /* ============ Interactive Functions ============ */

    /// @notice Proposes a bilateral repo agreement on-chain.
    /// @dev    Callable only by the borrower (`msg.sender`), who names the counterparty `lender`. Both borrower
    ///         and lender must be verified in the live ERC-3643 `IdentityRegistry` of both the collateral token
    ///         and the cash token. No tokens move during proposal; opening collateral is sized dynamically at
    ///         acceptance from `initialMarginBps` and bounded by `maxCollateralAmount`.
    /// @param  lender                Designated lender address authorized to accept (non-zero, not borrower).
    /// @param  borrowAmount          Cash principal to borrow in `cashToken` units (18 decimals).
    /// @param  repoRateBps           Annualized repo interest rate in basis points (Actual/360).
    /// @param  initialMarginBps      Initial over-collateralization margin in bps over `borrowAmount` (max 5,000 bps).
    /// @param  maintenanceMarginBps  Maintenance margin in bps over the repurchase price (`<= initialMarginBps`).
    /// @param  termSeconds           Duration of the repo from acceptance to maturity in seconds (1s to 365 days).
    /// @param  curePeriodSeconds     Grace period in seconds for the borrower to cure a margin call (`<= termSeconds`).
    /// @param  maxCollateralAmount   Maximum `collateralToken` units the borrower consents to post at acceptance.
    /// @param  acceptDeadline        Unix timestamp after which the proposal expires and can no longer be accepted.
    /// @return repoId                Unique sequential identifier assigned to the proposed repo agreement.
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
    ) external returns (uint256 repoId) {
        // The borrower proposes (msg.sender); the lender is the named counterparty who must accept.
        address borrower = msg.sender;

        if (lender == address(0) || borrower == lender) revert InvalidLender();
        if (borrowAmount == 0 || maxCollateralAmount == 0) revert ZeroAmount();
        if (initialMarginBps > MAX_INITIAL_MARGIN_BPS) revert InitialMarginInvalid();
        if (maintenanceMarginBps > initialMarginBps) revert MaintenanceMarginInvalid();
        if (termSeconds == 0 || termSeconds > MAX_REPO_TERM_SECONDS) revert TermInvalid();
        if (curePeriodSeconds == 0 || curePeriodSeconds > termSeconds) revert CurePeriodInvalid();
        if (acceptDeadline <= block.timestamp) revert AcceptDeadlineInvalid();

        _requireVerified(borrower);
        _requireVerified(lender);

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

    /// @notice Accepts a pending repo proposal and executes the Opening Leg via atomic Delivery-versus-Payment (DvP).
    /// @dev    Callable only by `order.lender` while `status == Proposed` and `block.timestamp <= acceptDeadline`.
    ///         Sizes required opening collateral from `borrowAmount`, `initialMarginBps`, and the live oracle NAV
    ///         (rounded up in the lender's favor). Reverts with `CollateralAboveCap` if the required units exceed
    ///         `order.maxCollateralAmount`. Atomically pulls collateral from borrower into contract escrow and
    ///         transfers cash principal directly from lender to borrower.
    /// @param  repoId  Identifier of the proposed repo agreement to accept.
    function acceptRepo(uint256 repoId) external {
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
            requiredInitialCollateralValue * oraclePricePrecision,
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

    /// @notice Cancels an unaccepted repo proposal.
    /// @dev    Callable only by `order.borrower` while `status == Proposed`. Transitions status to `Cancelled`.
    /// @param  repoId  Identifier of the proposed repo agreement to cancel.
    function cancelRepo(uint256 repoId) external {
        RepoState storage state = states[repoId];

        if (msg.sender != orders[repoId].borrower) revert Unauthorized();
        if (state.status != RepoStatus.Proposed) revert InvalidState(state.status);

        state.status = RepoStatus.Cancelled;

        emit RepoCancelled(repoId, msg.sender);
    }

    /// @notice Executes the Closing Leg via atomic Receipt-versus-Payment (RvP).
    /// @dev    Callable only by `order.borrower` while the repo is `Active` or `MarginCalled`. Computes the
    ///         repurchase price (`borrowAmount` + Actual/360 accrued interest up to `block.timestamp`),
    ///         atomically transfers cash repayment from borrower to lender, and releases all escrowed
    ///         collateral back to the borrower.
    /// @param  repoId  Identifier of the open repo agreement to settle.
    function settleRepo(uint256 repoId) external {
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

    /// @notice Triggers an on-chain margin call when mark-to-market collateral value breaches maintenance margin.
    /// @dev    Permissionless while `status == Active`. Reverts with `MarginSufficient` if `isMarginHealthy(repoId)`
    ///         is true. Transitions status to `MarginCalled` and sets `cureDeadline = block.timestamp + curePeriod`.
    /// @param  repoId  Identifier of the active repo agreement to evaluate.
    function marginCall(uint256 repoId) external {
        RepoState storage state = states[repoId];
        if (state.status != RepoStatus.Active) revert InvalidState(state.status);

        if (isMarginHealthy(repoId)) revert MarginSufficient();

        state.status = RepoStatus.MarginCalled;
        state.cureDeadline = uint40(block.timestamp + orders[repoId].curePeriodSeconds);

        emit MarginCalled(repoId, getCollateralValue(repoId), state.cureDeadline);
    }

    /// @notice Posts additional collateral to escrow to cure a margin call or add margin buffer.
    /// @dev    Callable only by `order.borrower` while `status == Active` or `MarginCalled`. Pulls `topUpAmount`
    ///         of `collateralToken` into escrow; if `isMarginHealthy(repoId)` is satisfied after the top-up,
    ///         restores `status` to `Active` and resets `cureDeadline` to `0`.
    /// @param  repoId       Identifier of the open repo agreement.
    /// @param  topUpAmount  Amount of additional `collateralToken` units (18 decimals) to transfer into escrow.
    function topUpCollateral(uint256 repoId, uint256 topUpAmount) external {
        if (topUpAmount == 0) revert ZeroAmount();
        if (msg.sender != orders[repoId].borrower) revert Unauthorized();

        RepoState storage state = states[repoId];
        if (state.status != RepoStatus.MarginCalled && state.status != RepoStatus.Active) {
            revert InvalidState(state.status);
        }

        state.collateralAmount += topUpAmount;

        if (isMarginHealthy(repoId)) {
            state.status = RepoStatus.Active;
            state.cureDeadline = 0;
        }

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), topUpAmount);

        emit MarginToppedUp(repoId, topUpAmount, state.collateralAmount);
    }

    /// @notice Executes default close-out netting upon post-maturity non-payment or an expired, uncured margin call.
    /// @dev    Callable only by `order.lender` when (`(Active || MarginCalled) && block.timestamp > maturity`)
    ///         or (`status == MarginCalled && block.timestamp > cureDeadline && !isMarginHealthy(repoId)`).
    ///         Seizes escrowed collateral worth `getCurrentRepurchasePrice(repoId)` at the live oracle NAV (rounded up,
    ///         capped at `state.collateralAmount`) and transfers it to the lender.
    ///         POC simplification: any `surplusCollateral` is pushed directly to `order.borrower` in the same tx.
    ///         If `order.borrower` is frozen or de-verified in ERC-3643 when `surplusCollateral > 0`, the push
    ///         reverts; in production, surplus can be credited to a pull-claim mapping or compliance escrow.
    /// @param  repoId  Identifier of the defaulting repo agreement.
    function claimDefault(uint256 repoId) external {
        RepoOrder storage order = orders[repoId];
        RepoState storage state = states[repoId];

        if (msg.sender != order.lender) revert Unauthorized();

        bool isMaturityBreach =
            (state.status == RepoStatus.Active || state.status == RepoStatus.MarginCalled) &&
                (block.timestamp > state.maturity);
        bool isMarginCureBreach =
            (state.status == RepoStatus.MarginCalled) &&
                (block.timestamp > state.cureDeadline) &&
                !isMarginHealthy(repoId);
        if (!isMaturityBreach && !isMarginCureBreach) revert InvalidState(state.status);

        uint256 amountOwed = getCurrentRepurchasePrice(repoId);
        // Close-out netting: the lender seizes collateral worth exactly the amount owed (rounded up), no margin.
        uint256 seizedCollateral = Math.min(
            state.collateralAmount,
            Math.ceilDiv(amountOwed * oraclePricePrecision, getCollateralPrice())
        );
        uint256 surplusCollateral = state.collateralAmount - seizedCollateral;

        state.status = RepoStatus.Defaulted;
        state.collateralAmount = 0;

        IERC20(collateralToken).safeTransfer(order.lender, seizedCollateral);

        // POC simplification: push surplus back in the same tx so escrow ends empty.
        // Note: if the borrower is frozen or de-verified in ERC-3643 while surplusCollateral > 0,
        // this push reverts; production Phase 2 can isolate surplus in a pull-claim mapping.
        if (surplusCollateral > 0) {
            IERC20(collateralToken).safeTransfer(order.borrower, surplusCollateral);
        }

        string memory reason = isMarginCureBreach ? "Margin Call Cure Expired" : "Maturity Non-Payment";
        emit RepoDefaulted(repoId, order.lender, amountOwed, seizedCollateral, surplusCollateral, reason);
    }

    /* ============ View Functions ============ */

    /// @notice Returns the latest collateral NAV price in EUR (8 decimals) from `collateralOracle`.
    /// @dev    Reads `latestRoundData()` without enforcing an on-chain staleness window (POC simplification;
    ///         fund NAVs update once daily off-chain). Reverts with `InhNAVOracle.InvalidNAV` if price is `<= 0`.
    /// @return price  Positive collateral price per token unit with 8 decimals (`1e8 = €1.00`).
    function getCollateralPrice() public view returns (uint256 price) {
        (, int256 answer, , , ) = InhNAVOracle(collateralOracle).latestRoundData();
        if (answer <= 0) revert InhNAVOracle.InvalidNAV();
        return uint256(answer);
    }

    /// @notice Returns the total repurchase price (`borrowAmount` + accrued interest) currently owed for a repo.
    /// @param  repoId           Identifier of the repo agreement.
    /// @return repurchasePrice  Total cash repayment in `cashToken` units (18 decimals).
    function getCurrentRepurchasePrice(uint256 repoId) public view returns (uint256 repurchasePrice) {
        return orders[repoId].borrowAmount + getRepoInterest(repoId);
    }

    /// @notice Calculates the Actual/360 interest accrued since `startTime` up to `block.timestamp`.
    /// @dev    Formula: `(borrowAmount * repoRateBps * elapsedSeconds) / (360 days * 10,000)`, rounded down.
    ///         Returns `0` unless the repo is `Active` or `MarginCalled`.
    /// @param  repoId    Identifier of the repo agreement.
    /// @return interest  Accrued interest in `cashToken` units (18 decimals).
    function getRepoInterest(uint256 repoId) public view returns (uint256 interest) {
        RepoOrder storage order = orders[repoId];
        RepoState storage state = states[repoId];

        if (state.status != RepoStatus.Active && state.status != RepoStatus.MarginCalled) return 0;

        uint256 elapsed = block.timestamp > state.startTime ? block.timestamp - state.startTime : 0;
        return (order.borrowAmount * order.repoRateBps * elapsed) / INTEREST_DENOMINATOR;
    }

    /// @notice Calculates the current mark-to-market EUR value (18 decimals) of a repo's escrowed collateral.
    /// @dev    Formula: `(collateralAmount * getCollateralPrice()) / oraclePricePrecision`.
    /// @param  repoId              Identifier of the repo agreement.
    /// @return collateralValueEUR  Mark-to-market collateral value in EUR (18 decimals).
    function getCollateralValue(uint256 repoId) public view returns (uint256 collateralValueEUR) {
        return (states[repoId].collateralAmount * getCollateralPrice()) / oraclePricePrecision;
    }

    /// @notice Calculates the minimum collateral value in EUR (18 decimals) required to satisfy `maintenanceMarginBps`.
    /// @dev    Formula: `(getCurrentRepurchasePrice(repoId) * (10,000 + maintenanceMarginBps)) / 10,000`.
    /// @param  repoId         Identifier of the repo agreement.
    /// @return requiredValue  Minimum required collateral value in EUR (18 decimals).
    function getRequiredCollateralValue(uint256 repoId) public view returns (uint256 requiredValue) {
        return
            (getCurrentRepurchasePrice(repoId) * (BPS_DENOMINATOR + orders[repoId].maintenanceMarginBps)) /
            BPS_DENOMINATOR;
    }

    /// @notice Calculates the minimum `collateralToken` units (18 decimals) required to satisfy `maintenanceMarginBps`.
    /// @dev    Formula: `ceilDiv(getRequiredCollateralValue(repoId) * oraclePricePrecision, getCollateralPrice())`.
    /// @param  repoId          Identifier of the repo agreement.
    /// @return requiredAmount  Minimum required collateral token units (18 decimals).
    function getRequiredCollateralAmount(uint256 repoId) public view returns (uint256 requiredAmount) {
        return Math.ceilDiv(getRequiredCollateralValue(repoId) * oraclePricePrecision, getCollateralPrice());
    }

    /// @notice Checks whether a repo's escrowed collateral value meets or exceeds its maintenance margin requirement.
    /// @param  repoId   Identifier of the repo agreement.
    /// @return healthy  True if `getCollateralValue(repoId) >= getRequiredCollateralValue(repoId)`.
    function isMarginHealthy(uint256 repoId) public view returns (bool healthy) {
        return getCollateralValue(repoId) >= getRequiredCollateralValue(repoId);
    }

    /* ============ Internal Functions ============ */

    /// @dev Reverts unless `account` is verified in the registry each leg's token enforces right now.
    ///      Read live because either token can switch registries, and the two legs may use different ones.
    ///      A fail-fast only: the tokens re-check on every transfer, so settlement is still guarded.
    function _requireVerified(address account) private view {
        if (
            !IIdentityRegistry(IIdentityRegistryBound(collateralToken).identityRegistry()).isVerified(account) ||
            !IIdentityRegistry(IIdentityRegistryBound(cashToken).identityRegistry()).isVerified(account)
        ) revert NotKYCVerified(account);
    }
}
