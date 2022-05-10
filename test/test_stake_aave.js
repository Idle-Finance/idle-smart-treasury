const { BN, constants } = require('@openzeppelin/test-helpers');
const { Fetcher, Route, Trade, TokenAmount, TradeType, ChainId, Percent } = require('@uniswap/sdk')
const { expect } = require('chai');
const FeeCollector = artifacts.require('FeeCollector')
const UniswapV2Exchange = artifacts.require('UniswapV2Exchange')
const StakeAaveManaget = artifacts.require('StakeAaveManaget')
const mockWETH = artifacts.require('WETHMock')
const addresses = require("../migrations/addresses").development
const ERC20abi = require("../abi/erc20")
const IStakedAave = require('../abi/stakeAave')
const IUniswapV2Router02 = artifacts.require('IUniswapV2Router02')

const toHex = (Amount) => `0x${Amount.raw.toString(16)}`

const getAmountOutMin = (trade) => toHex(trade.minimumAmountOut(new Percent(1, 100)))


const getETHForTokenTrade = async (amount, tokenAddress1, tokenAddress2, provider) => {

  const token = await Fetcher.fetchTokenData(ChainId.MAINNET, tokenAddress1, provider)
  const token2 = await Fetcher.fetchTokenData(ChainId.MAINNET, tokenAddress2, provider)
  const pair = await Fetcher.fetchPairData(token, token2, provider)
  const pair1 = await Fetcher.fetchPairData(token2, token, provider)

  const route = new Route([pair], token2)
  const amountIn = amount / +route.midPrice.toSignificant(6)

  const trade = new Trade(route, new TokenAmount(token2, Math.floor(amountIn * 10 ** 18)), TradeType.EXACT_INPUT)

  return trade
}

const swap = async (amount, tokenAddress1, tokenAddress2, provider, toAddress) => {

  const uniswapRouterV2 = await IUniswapV2Router02.at(addresses.uniswapRouterAddress)

  const trade = await getETHForTokenTrade(amount, tokenAddress1, tokenAddress2, provider)

  const token = trade.inputAmount.token
  const token2 = trade.outputAmount.token

  const amountOutMin = getAmountOutMin(trade)

  const value = toHex(trade.inputAmount)

  const path = [token.address, token2.address]

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20

  const maxPriorityFeePerGas = web3.utils.toWei('5', 'gwei')

  const maxFeePerGas =  web3.utils.toWei('500', 'gwei')

  const tx = await uniswapRouterV2.swapExactETHForTokens(amountOutMin, path, toAddress, deadline, { from: toAddress, value, gasLimit: 500000, maxPriorityFeePerGas, maxFeePerGas})

  return { tx, trade }
}

contract("Stake Aave", async accounts => {
  beforeEach(async function() {
    const provider = web3.currentProvider.HttpProvider
    
    const token0 = addresses.aave
    const token1 = addresses.weth

    const token0Contract = new web3.eth.Contract(ERC20abi, token0)

    const beforeBalToken0 = await token0Contract.methods.balanceOf(accounts[0]).call()

    await token0Contract.methods.approve(addresses.uniswapRouterAddress, constants.MAX_UINT256).send({from: accounts[0]})
    
    const beforeBalToken1 = await web3.eth.getBalance(accounts[0])

    await swap(10, token0, token1, provider, accounts[0])
    
    const afterBalToken0 = await token0Contract.methods.balanceOf(accounts[0]).call()

    const afterBalToken1 =  await web3.eth.getBalance(accounts[0])

    const StakeAave = new web3.eth.Contract(IStakedAave, addresses.stakeAave)

    await token0Contract.methods.approve(addresses.stakeAave, constants.MAX_UINT256).send({from: accounts[0]})
    
    await StakeAave.methods.stake(accounts[0], afterBalToken0).send({from: accounts[0], gasLimit: 400000})
    this.mockWETH = await mockWETH.new()
    
    const router = await UniswapV2Exchange.new()

    const stakeManaget = await StakeAaveManaget.new(addresses.stakeAave)
    
    this.feeCollectorInstance = await FeeCollector.new(
      this.mockWETH.address,
      addresses.feeTreasuryAddress,
      addresses.idleRebalancer,
      accounts[0],
      [],
      router.address,
      stakeManaget.address
    )
      
    const stakeAaveBalance =  await StakeAave.methods.balanceOf(accounts[0]).call()
    
    await StakeAave.methods.transfer(this.feeCollectorInstance.address, stakeAaveBalance).send({from: accounts[0], gasLimit: 400000})

  })

    
  it("Start cooldown of stake aave", async function() {
     await this.feeCollectorInstance.startCooldown(addresses.stakeAave)
  })
})