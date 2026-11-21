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

    /// @notice ISIN identifier of the underlying European sovereign bond (e.g. "DE0001102580").
    string public isin;

    /// @notice Maturity Unix timestamp of the underlying sovereign bond.
    uint256 public maturityDate;

    /// @notice Annual coupon rate of the underlying sovereign bond in basis points (e.g. 250 = 2.50%).
    uint32 public couponRateBps;

    /// @notice Address of the linked RWA Fund NAV Oracle reporting the bond's EUR Net Asset Value.
    address public navOracle;

    /* ============ Sovereign Bond Configuration ============ */

    /// @notice Configures sovereign bond static master data and linked NAV oracle.
    /// @dev    Callable only by the ERC-3643 token owner (`onlyOwner`). Assumes a coupon-bearing sovereign bond
    ///         (`couponRateBps_ > 0`). Kept re-callable by `onlyOwner` in the POC for testnet/demo reconfiguration;
    ///         in production, static bond master data (`isin`, `maturityDate`, `couponRateBps`) would be locked at init.
    /// @param  isin_           Non-empty ISIN string identifier for the sovereign bond.
    /// @param  maturityDate_   Non-zero maturity Unix timestamp.
    /// @param  couponRateBps_  Non-zero annual coupon rate in basis points.
    /// @param  navOracle_      Non-zero address of the `nhNAVOracle` contract.
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

    /// @notice Issues new sovereign bond tokens in the primary market to a verified institutional investor.
    /// @dev    Callable only by an authorized ERC-3643 token agent (`onlyAgent`). Delegates to ERC-3643 `mint(to, amount)`,
    ///         which enforces `IdentityRegistry.isVerified(to)` and `ModularCompliance.canTransfer`.
    /// @param  to      Verified recipient wallet address.
    /// @param  amount  Number of `nhBOND` units (18 decimals) to issue.
    function issue(address to, uint256 amount) external override onlyAgent {
        mint(to, amount);

        emit BondIssued(to, amount, isin);
    }

    /// @notice Redeems and burns sovereign bond tokens from a holder on or after `maturityDate`.
    /// @dev    Callable only by an authorized ERC-3643 token agent (`onlyAgent`). Reverts with `BondNotMatured`
    ///         if `block.timestamp < maturityDate`. Delegates to ERC-3643 `burn(from, amount)`.
    /// @param  from    Holder address whose matured bond tokens are being redeemed.
    /// @param  amount  Number of `nhBOND` units (18 decimals) to burn.
    function redeem(address from, uint256 amount) external override onlyAgent {
        if (!isMatured()) revert BondNotMatured(block.timestamp, maturityDate);

        burn(from, amount);

        emit BondRedeemed(from, amount);
    }

    /* ============ Institutional View Helpers ============ */

    /// @notice Checks whether the underlying sovereign bond has reached or passed `maturityDate`.
    /// @return matured  True if `block.timestamp >= maturityDate`; false otherwise.
    function isMatured() public view override returns (bool matured) {
        return block.timestamp >= maturityDate;
    }

    /// @notice Checks whether an account holds a verified identity in the linked ERC-3643 `IdentityRegistry`.
    /// @param  account   Wallet address to check.
    /// @return eligible  True if `_tokenIdentityRegistry.isVerified(account)` is true.
    function isEligibleInvestor(address account) external view override returns (bool eligible) {
        return _tokenIdentityRegistry.isVerified(account);
    }
}
