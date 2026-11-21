// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { IIdentity } from "../interfaces/IIdentity.sol";

/// @title MockIdentity
/// @notice Lightweight ONCHAINID mock contract for institutional counterparty testing.
contract MockIdentity is IIdentity {
    address public immutable wallet;

    constructor(address _wallet) {
        wallet = _wallet;
    }

    function addKey(bytes32, uint256, uint256) external pure returns (bool) {
        return true;
    }

    function approve(uint256, bool) external pure returns (bool) {
        return true;
    }

    function removeKey(bytes32, uint256) external pure returns (bool) {
        return true;
    }

    function execute(address, uint256, bytes calldata) external payable returns (uint256) {
        return 0;
    }

    function getKey(bytes32) external pure returns (uint256[] memory purposes, uint256 keyType, bytes32 key) {
        purposes = new uint256[](1);
        purposes[0] = 1;
        return (purposes, 1, bytes32(0));
    }

    function getKeyPurposes(bytes32) external pure returns (uint256[] memory _purposes) {
        _purposes = new uint256[](1);
        _purposes[0] = 1;
    }

    function getKeysByPurpose(uint256) external pure returns (bytes32[] memory keys) {
        keys = new bytes32[](1);
    }

    function keyHasPurpose(bytes32, uint256 purpose) external pure returns (bool) {
        return purpose == 1;
    }

    function addClaim(
        uint256,
        uint256,
        address,
        bytes calldata,
        bytes calldata,
        string calldata
    ) external pure returns (bytes32) {
        return bytes32(0);
    }

    function removeClaim(bytes32) external pure returns (bool) {
        return true;
    }

    function getClaim(
        bytes32 claimId
    )
        external
        view
        returns (
            uint256 topic,
            uint256 scheme,
            address issuer,
            bytes memory signature,
            bytes memory data,
            string memory uri
        )
    {
        return (1, 1, address(this), "", "", "ipfs://claim");
    }

    function getClaimIdsByTopic(uint256) external pure returns (bytes32[] memory claimIds) {
        claimIds = new bytes32[](0);
    }

    function isClaimValid(IIdentity, uint256, bytes calldata, bytes calldata) external pure returns (bool) {
        return true;
    }
}
