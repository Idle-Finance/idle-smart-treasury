// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <=0.7.5;

interface IExchangeManager {
    function exchange(address token, uint amountOut, address to, address[] calldata path) external;
    function approveToken(address depositToken, uint256 amount) external;
    function removeApproveToken(address token) external;
}