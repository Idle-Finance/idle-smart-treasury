// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <=0.7.5;

interface ITokenExchange {
    function exchange(address token, uint amountOut, address to, address[] calldata path) external;
    function tokenApprove(address depositToken, uint256 amount) external;
    function removeTokenApprove(address token) external;
}