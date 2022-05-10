// SPDX-License-Identifier: MIT
pragma solidity 0.7.5;
pragma abicoder v2;

import '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import './interfaces/ITokenExchange.sol';

contract UniswapV3Exchange is ITokenExchange {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  ISwapRouter private constant uniswapRouterV3 = ISwapRouter(0xE592427A0AEce92De3Edee1F18E0157C05861564);

  uint24 public constant poolFee = 3000;

  function exchange(address token, uint amountOut, address to, address[] calldata path) external override {

    uint256 _amountIn = IERC20(token).balanceOf(address(this));

    address _tokenIn = path[0];
    address _tokenOut = path[1];

    ISwapRouter.ExactInputSingleParams memory params =  ISwapRouter.ExactInputSingleParams({
        tokenIn: _tokenIn,
        tokenOut: _tokenOut,
        fee: poolFee,
        recipient: to,
        deadline: block.timestamp.add(1800),
        amountIn: _amountIn,
        amountOutMinimum: amountOut,
        sqrtPriceLimitX96: 0
    });

    uniswapRouterV3.exactInputSingle(params);
  }

  function tokenApprove(address _depositToken, uint256 amount) external override {
    IERC20(_depositToken).safeIncreaseAllowance(address(uniswapRouterV3), amount);
  }

  function removeTokenApprove(address _token) external override {
    IERC20(_token).safeApprove(address(uniswapRouterV3), 0);
  }
}
