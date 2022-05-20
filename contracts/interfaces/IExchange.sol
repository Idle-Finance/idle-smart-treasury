// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <=0.7.5;

interface IExchange {
    function exchange(address token, uint amountOut, address to, address[] calldata path,bytes memory data) external;
    function approveToken(address depositToken, uint256 amount) external;
    function removeApproveToken(address token) external;
    function getAmoutOut(address tokenA, address tokenB, uint amountIn) external returns (uint amountOut, bytes memory data);
}