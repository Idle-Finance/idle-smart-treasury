const {constants} = require('@openzeppelin/test-helpers');
const {
  abi: ISwapRouter,
} = require("@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json");
const ERC20 = require('../../abi/erc20')
const addresses = require('../../migrations/addresses').development

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
  
  const swapV3 = new web3.eth.Contract(ISwapRouter, addresses.swapRouter)

  console.log(await tokenInContract.methods.balanceOf(toAddress).call())
  console.log(await tokenOutContract.methods.balanceOf(toAddress).call())
  
  await swapV3.methods.exactInputSingle(params).send({from: toAddress, gasLimit: 500000})
  console.log()
  
  console.log(await tokenInContract.methods.balanceOf(toAddress).call())
  console.log(await tokenOutContract.methods.balanceOf(toAddress).call())
}

module.exports = swap
