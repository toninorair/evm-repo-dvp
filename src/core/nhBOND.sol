// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "ERC-3643/token/Token.sol";
import "./interfaces/InhBOND.sol";

/// @title  nhBOND
/// @notice Nordhaven Tokenised Sovereign Bond NAV (nhBOND NAV).
/// @dev    Derives directly from the authentic ERC-3643 Token.sol (T-REX standard).
///         Adds sovereign bond master data (ISIN, maturity, coupon, NAV oracle)
///         and institutional banking lifecycle operations.
/// @author Ethereum Institutional / Nordhaven Bank
contract nhBOND is Token, InhBOND {
    /* ============ Sovereign Bond Master Data ============ */

    string private _isin;
    uint256 private _maturityDate;
    uint32 private _couponRateBps;
    address private _navOracle;

    /* ============ Institutional Claim Topics ============ */

    uint256 public constant CLAIM_TOPIC_KYC_AML = 101;
    uint256 public constant CLAIM_TOPIC_QUALIFIED_INSTITUTION = 102;

    /* ============ Sovereign Bond Configuration ============ */

    /// @inheritdoc InhBOND
    function setBondDetails(
        string calldata isin_,
        uint256 maturityDate_,
        uint32 couponRateBps_,
        address navOracle_
    ) external override onlyOwner {
        _isin = isin_;
        _maturityDate = maturityDate_;
        _couponRateBps = couponRateBps_;
        _navOracle = navOracle_;

        emit BondDetailsUpdated(isin_, maturityDate_, couponRateBps_, navOracle_);
    }

    /* ============ Banking / Issuance Functions ============ */

    /// @inheritdoc InhBOND
    function issue(address to, uint256 amount) external override onlyAgent {
        mint(to, amount);
        emit BondIssued(to, amount, _isin);
    }

    /// @inheritdoc InhBOND
    function redeem(address from, uint256 amount) external override onlyAgent {
        if (block.timestamp < _maturityDate) revert BondNotMatured(block.timestamp, _maturityDate);
        burn(from, amount);
        emit BondRedeemed(from, amount);
    }

    /* ============ Institutional View Helpers ============ */

    /// @inheritdoc InhBOND
    function isin() external view override returns (string memory) {
        return _isin;
    }

    /// @inheritdoc InhBOND
    function maturityDate() external view override returns (uint256) {
        return _maturityDate;
    }

    /// @inheritdoc InhBOND
    function couponRateBps() external view override returns (uint32) {
        return _couponRateBps;
    }

    /// @inheritdoc InhBOND
    function navOracle() external view override returns (address) {
        return _navOracle;
    }

    /// @inheritdoc InhBOND
    function isMatured() external view override returns (bool) {
        return block.timestamp >= _maturityDate;
    }

    /// @inheritdoc InhBOND
    function isEligibleInvestor(address account) external view override returns (bool) {
        return _tokenIdentityRegistry.isVerified(account);
    }
}
