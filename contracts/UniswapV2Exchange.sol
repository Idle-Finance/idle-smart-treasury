// SPDX-License-Identifier: MIT
pragma solidity 0.7.5;

import '@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol';
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import './interfaces/IExchangeManager.sol';

contract UniswapV2Exchange is IExchangeManager {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IUniswapV2Router02 private constant uniswapRouterV2 = IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);

  function exchange(address token, uint amountOut, address to, address[] calldata path) external override {

    uint256 amountIn = IERC20(token).balanceOf(address(this));

    uniswapRouterV2.swapExactTokensForTokensSupportingFeeOnTransferTokens(
      amountIn,
      amountOut, 
      path,
      to,
      block.timestamp.add(1800)
    );
  }

  function approveToken(address _depositToken, uint256 amount) external override {
    IERC20(_depositToken).safeIncreaseAllowance(address(uniswapRouterV2), amount);
  }

  function removeApproveToken(address _token) external override {
    IERC20(_token).safeApprove(address(uniswapRouterV2), 0);
  }
}
