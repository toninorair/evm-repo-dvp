// SPDX-License-Identifier: MIT
// ERC-3643 Token is pinned to solc 0.8.17.
// solhint-disable-next-line compiler-version
pragma solidity 0.8.17;

import { Token } from "ERC-3643/token/Token.sol";
import { InhBOND } from "./interfaces/InhBOND.sol";

/// @title  nhBOND
/// @notice Nordhaven Tokenised Sovereign Bond NAV (nhBOND NAV).
/// @dev    Derives directly from the authentic ERC-3643 Token.sol (T-REX standard).
///         Adds sovereign bond master data (ISIN, maturity, coupon, NAV oracle)
///         and institutional banking lifecycle operations.
/// @author Ethereum Institutional / Nordhaven Bank
contract nhBOND is Token, InhBOND {
    /* ============ Sovereign Bond Master Data ============ */

    /// @inheritdoc InhBOND
    string public isin;
    /// @inheritdoc InhBOND
    uint256 public maturityDate;
    /// @inheritdoc InhBOND
    uint32 public couponRateBps;
    /// @inheritdoc InhBOND
    address public navOracle;

    /* ============ Sovereign Bond Configuration ============ */

    /// @inheritdoc InhBOND
    /// @dev POC simplification: kept re-callable by `onlyOwner` for testnet/demo reconfiguration; in production,
    ///      static bond master data (`isin`, `maturityDate`, `couponRateBps`) would be locked at initialization.
    function setBondDetails(
        string calldata isin_,
        uint256 maturityDate_,
        uint32 couponRateBps_,
        address navOracle_
    ) external override onlyOwner {
        if (bytes(isin = isin_).length == 0) revert ZeroAmount();
        if ((maturityDate = maturityDate_) == 0) revert ZeroAmount();
        if ((couponRateBps = couponRateBps_) == 0) revert ZeroAmount();
        if ((navOracle = navOracle_) == address(0)) revert ZeroAddress();

        emit BondDetailsUpdated(isin_, maturityDate_, couponRateBps_, navOracle_);
    }

    /* ============ Banking / Issuance Functions ============ */

    /// @inheritdoc InhBOND
    function issue(address to, uint256 amount) external override onlyAgent {
        mint(to, amount);

        emit BondIssued(to, amount, isin);
    }

    /// @inheritdoc InhBOND
    function redeem(address from, uint256 amount) external override onlyAgent {
        if (!isMatured()) revert BondNotMatured(block.timestamp, maturityDate);

        burn(from, amount);

        emit BondRedeemed(from, amount);
    }

    /* ============ Institutional View Helpers ============ */

    /// @inheritdoc InhBOND
    function isMatured() public view override returns (bool) {
        return block.timestamp >= maturityDate;
    }

    /// @inheritdoc InhBOND
    function isEligibleInvestor(address account) external view override returns (bool) {
        return _tokenIdentityRegistry.isVerified(account);
    }
}
