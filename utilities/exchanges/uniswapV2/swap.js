const { Fetcher, Route, Trade, TokenAmount, TradeType, ChainId, Percent } = require('@uniswap/sdk')
const addresses = require('../../../constants/addresses').development
const IUniswapV2Router02 = artifacts.require('IUniswapV2Router02')

const toHex = (Amount) => `0x${Amount.raw.toString(16)}`

const getAmountOutMin = (trade) => toHex(trade.minimumAmountOut(new Percent(10, 100)))

const getETHForTokenTrade = async (amount, tokenAddress0, tokenAddress1, provider) => {

  const token = await Fetcher.fetchTokenData(ChainId.MAINNET, tokenAddress0, provider)
  const token2 = await Fetcher.fetchTokenData(ChainId.MAINNET, tokenAddress1, provider)
  const pair = await Fetcher.fetchPairData(token, token2, provider)

  const route = new Route([pair], token2)
  const amountIn = amount / +route.midPrice.toSignificant(6)
  const trade = new Trade(route, new TokenAmount(token2, Math.floor(amountIn * 10 ** 18)), TradeType.EXACT_INPUT)

  return trade
}


const swap = async (amount, tokenAddress0, tokenAddress1, provider, toAddress) => {

  const uniswapRouterV2 = await IUniswapV2Router02.at(addresses.uniswapRouterAddress)

  const trade = await getETHForTokenTrade(amount, tokenAddress0, tokenAddress1, provider)

  const token = trade.inputAmount.token
  const token2 = trade.outputAmount.token

  const amountOutMin = getAmountOutMin(trade)

  const value = toHex(trade.inputAmount)

  const path = [token.address, token2.address]

  const deadline = Math.floor(Date.now() / 1000) + 60 * 30

  const maxPriorityFeePerGas = web3.utils.toWei('5', 'gwei')

  const maxFeePerGas = web3.utils.toWei('500', 'gwei')

  await uniswapRouterV2.swapExactETHForTokens(amountOutMin, path, toAddress, deadline, { from: toAddress, value, gasLimit: 500000, maxPriorityFeePerGas, maxFeePerGas})

}

module.exports = swap