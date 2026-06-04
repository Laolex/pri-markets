// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConfidentialBatchAuction} from "../ConfidentialBatchAuction.sol";

/// @dev Test-only harness that overrides the hardcoded CUSDC_TOKEN constant
///      with an injected address so unit tests can use MockConfidentialUSDC.
///
///      This is only deployed in the test environment — never in production.
///      Inherits all production logic unchanged; only the token address differs.
contract CBATokenTestHarness is ConfidentialBatchAuction {
    address private immutable _testToken;

    // treasury_ = address(0) → parent defaults treasury to the deployer (test signer).
    constructor(address testToken_) ConfidentialBatchAuction(address(0)) {
        _testToken = testToken_;
    }

    /// @dev Override to replace the hardcoded constant with the test mock address.
    function _tokenAddress() internal view override returns (address) {
        return _testToken;
    }
}
