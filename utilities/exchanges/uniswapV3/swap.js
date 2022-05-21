const {constants} = require('@openzeppelin/test-helpers');
const {
  abi: ISwapRouter,
} = require("@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json");
const ERC20  = require('@openzeppelin/contracts/build/contracts/ERC20.json')
const addresses = require('../../../constants/addresses').development

const swap = async (tokenIn, tokenOut, fee, toAddress, amountIn) => {

  const tokenInContract = new web3.eth.Contract(ERC20, tokenIn)

  await tokenInContract.methods.approve(addresses.swapRouter, constants.MAX_UINT256).send({from: toAddress})

  const tokenOutContract = new web3.eth.Contract(ERC20, tokenOut)

  await tokenOutContract.methods.approve(addresses.swapRouter, constants.MAX_UINT256).send({from: toAddress})
  
  const block = await web3.eth.getBlock('latest');
  
  const deadline = block.timestamp + 60 * 20;
  
  const params = {
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    fee: fee,
    recipient: toAddress,
    deadline: deadline,
    amountIn: amountIn,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0,
  };

  const swapUniswapV3 = new web3.eth.Contract(ISwapRouter, addresses.swapRouter)
  
  await swapUniswapV3.methods.exactInputSingle(params).send({from: toAddress, gasLimit: 5000000})
}

module.exports = swap
