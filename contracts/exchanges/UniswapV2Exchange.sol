// SPDX-License-Identifier: MIT
pragma solidity 0.7.5;

import '@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol';
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import '../interfaces/IExchange.sol';

contract UniswapV2Exchange is IExchange, Ownable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IUniswapV2Router02 private immutable uniswapRouterV2;
  IUniswapV2Factory private immutable factory;

  constructor(address factory_, address router_) {
      factory = IUniswapV2Factory(factory_);
      uniswapRouterV2 = IUniswapV2Router02(router_);
  }

  function exchange(address token, uint amountOut, address to, address[] calldata path, bytes memory data) external override onlyOwner {

    uint256 amountIn = IERC20(token).balanceOf(address(this));

    uniswapRouterV2.swapExactTokensForTokensSupportingFeeOnTransferTokens(
      amountIn,
      amountOut, 
      path,
      to,
      block.timestamp.add(1800)
    );
  }

  function sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
      require(tokenA != tokenB, 'IDENTICAL_ADDRESSES');
      (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
      require(token0 != address(0), 'ZERO_ADDRESS');
  }

  function getAmoutOut(address tokenA, address tokenB, uint amountIn) external override onlyOwner returns (uint amountOut, bytes memory data) {
    (address token0,) = sortTokens(tokenA, tokenB);
    address pairAddress = factory.getPair(tokenA, tokenB);

    data = abi.encode();
    
    if(pairAddress == address(0)) {
      amountOut = 0;
      return (amountOut, data);
    }


    (uint reserve0, uint reserve1,) = IUniswapV2Pair(pairAddress).getReserves();
    (uint reserveA, uint reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);

    uint amountInWithFee = amountIn.mul(997);
    uint numerator = amountInWithFee.mul(reserveB);
    uint denominator = reserveA.mul(1000).add(amountInWithFee);
    amountOut = numerator.div(denominator);
  }

  function approveToken(address _depositToken, uint256 amount) external override onlyOwner {
    IERC20(_depositToken).safeIncreaseAllowance(address(uniswapRouterV2), amount);
  }

  function removeApproveToken(address _token) external override onlyOwner {
    IERC20(_token).safeApprove(address(uniswapRouterV2), 0);
  }
}
