// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IERC3643} from "./IERC3643.sol";
import {InhBOND} from "../../src/interfaces/InhBOND.sol";

/// @title  ITestBond
/// @notice Comprehensive interface combining authentic ERC-3643 compliance functions with Nordhaven sovereign bond operations.
interface ITestBond is IERC3643, InhBOND {}
