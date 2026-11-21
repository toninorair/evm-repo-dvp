// SPDX-License-Identifier: MIT
// ERC-3643 Token is pinned to solc 0.8.17.
// solhint-disable-next-line compiler-version
pragma solidity >=0.8.17 <0.9.0;

/// @title  InhBOND
/// @notice Interface for Nordhaven Tokenised Sovereign Bond NAV (nhBOND NAV).
/// @dev    Defines sovereign bond master data, banking lifecycle methods,
///         and institutional view helpers on top of ERC-3643.
/// @author Ethereum Institutional / Nordhaven Bank
interface InhBOND {
    /* ============ Events ============ */

    /// @notice Emitted when new sovereign bond tokens are issued.
    event BondIssued(address indexed to, uint256 amount, string isin);

    /// @notice Emitted when sovereign bond tokens are redeemed upon maturity.
    event BondRedeemed(address indexed from, uint256 amount);

    /// @notice Emitted when sovereign bond master details are updated.
    event BondDetailsUpdated(string isin, uint256 maturityDate, uint32 couponRateBps, address navOracle);

    /* ============ Custom Errors ============ */

    error BondNotMatured(uint256 currentTimestamp, uint256 maturityDate);
    error ZeroAddress();
    error ZeroAmount();

    /* ============ Banking / Issuance Functions ============ */

    /// @notice Primary issuance of bond tokens to an authorized counterparty.
    function issue(address to, uint256 amount) external;

    /// @notice Redemption of bond tokens upon or after maturity.
    function redeem(address from, uint256 amount) external;

    /// @notice Configures sovereign bond static master data.
    function setBondDetails(
        string calldata isin_,
        uint256 maturityDate_,
        uint32 couponRateBps_,
        address navOracle_
    ) external;

    /* ============ Institutional View Helpers ============ */

    /// @notice Returns the ISIN identifier of the underlying sovereign bond.
    function isin() external view returns (string memory);

    /// @notice Returns the bond maturity Unix timestamp.
    function maturityDate() external view returns (uint256);

    /// @notice Returns the annual coupon rate in basis points (e.g. 250 = 2.50%).
    function couponRateBps() external view returns (uint32);

    /// @notice Returns the linked RWA Fund NAV Oracle address.
    function navOracle() external view returns (address);

    /// @notice Returns whether the bond has reached maturity.
    function isMatured() external view returns (bool);

    /// @notice Returns whether an account has verified identity on the linked IdentityRegistry.
    function isEligibleInvestor(address account) external view returns (bool);
}
