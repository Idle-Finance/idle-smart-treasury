// SPDX-License-Identifier: MIT
pragma solidity 0.7.5;
pragma abicoder v2;

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IQuoter.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../interfaces/IExchange.sol";

contract UniswapV3Exchange is IExchange, Ownable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  ISwapRouter private immutable uniswapRouterV3;
  IQuoter private immutable uniswapQuoterV3;
  IUniswapV3Factory private immutable uniswapFactoryV3;

  uint24[] private poolFees; 

  constructor(address _router, address _quoter, address _factory) {

    uniswapRouterV3 = ISwapRouter(_router);
    uniswapQuoterV3 = IQuoter(_quoter);
    uniswapFactoryV3 = IUniswapV3Factory(_factory);

    poolFees = new uint24[](3); 
    poolFees[0] = 500;
    poolFees[1] = 3000;
    poolFees[2] = 10000;

  }

  function exchange(address token, uint amountOut, address to, address[] calldata path, bytes memory data) external override onlyOwner {

    uint256 _amountIn = IERC20(token).balanceOf(address(this));

    address _tokenIn = path[0];
    address _tokenOut = path[1];

    uint24 poolFee;

    (poolFee)= abi.decode(data, (uint24));

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

  function getAmoutOut(address tokenA, address tokenB, uint amountIn) external override onlyOwner returns (uint amountOut, bytes memory data) {
    uint256 _currentAmountOut;
    uint256 _MaxAmountOut = 0;
    uint24 _fee;

    for (uint256 index = 0; index < poolFees.length; index++) {
      if(uniswapFactoryV3.getPool(tokenA, tokenB, poolFees[index]) == address(0)) {
        continue;
      }
      _currentAmountOut =  uniswapQuoterV3.quoteExactInputSingle(tokenA, tokenB, poolFees[index], amountIn, 0);

      if(_currentAmountOut > _MaxAmountOut)  {
        _MaxAmountOut = _currentAmountOut;
        _fee = poolFees[index];
      }
    }

    amountOut = _MaxAmountOut;
    data = abi.encode(_fee);
  }

  function approveToken(address _depositToken, uint256 amount) external override  onlyOwner {
    IERC20(_depositToken).safeIncreaseAllowance(address(uniswapRouterV3), amount);
  }

  function removeApproveToken(address _token) external override onlyOwner {
    IERC20(_token).safeApprove(address(uniswapRouterV3), 0);
  }
}
