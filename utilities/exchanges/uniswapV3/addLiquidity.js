const { Pool, Position, NonfungiblePositionManager, nearestUsableTick } = require('@uniswap/v3-sdk')
const { Percent, Token } = require('@uniswap/sdk-core')
const { abi: IUniswapV3PoolABI } = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json')
const { abi: IUniswapV3Factory } = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json')
const { abi: ERC20 }  = require('@openzeppelin/contracts/build/contracts/ERC20.json')
const { web3 } = require('@openzeppelin/test-helpers/src/setup')
const bn = require('bignumber.js')
const {constants} = require('@openzeppelin/test-helpers');
const addresses = require('../../../constants/addresses').development

bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

const encodePriceSqrt = (reserve1, reserve0) =>new bn(reserve1.toString()) .div(reserve0.toString()) .sqrt() .multipliedBy(new bn(2).pow(96)).integerValue(3).toString()

const getPoolImmutables = async (poolContract) => {

  const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] = await Promise.all([
    poolContract.methods.factory().call(),
    poolContract.methods.token0().call(),
    poolContract.methods.token1().call(),
    poolContract.methods.fee().call(),
    poolContract.methods.tickSpacing().call(),
    poolContract.methods.maxLiquidityPerTick().call()
  ])

  return {
    factory,
    token0,
    token1,
    fee: +fee,
    tickSpacing: +tickSpacing,
    maxLiquidityPerTick: +maxLiquidityPerTick,
  }
}

const getPoolState = async (poolContract) => {
  const slot = await poolContract.methods.slot0().call()

  const PoolState = {
    liquidity: await poolContract.methods.liquidity().call(),
    sqrtPriceX96: slot[0],
    tick: +slot[1],
    observationIndex: slot[2],
    observationCardinality: slot[3],
    observationCardinalityNext: slot[4],
    feeProtocol: slot[5],
    unlocked: slot[6],
  }
  return PoolState
}


const createPool = async (token0, token1, fee, toAddress) => {
  const uniswapV3Factory = new web3.eth.Contract(IUniswapV3Factory, addresses.uniswapV3FactoryAddress)

  let poolAddress = await uniswapV3Factory.methods.getPool(token0, token1, fee).call()

  if(poolAddress === constants.ZERO_ADDRESS) {
    const createPoolTX =  await uniswapV3Factory.methods.createPool(token0, token1, fee).send({from: toAddress, gasLimit: 5000000})
    
    poolAddress = createPoolTX.events.PoolCreated.returnValues.pool

    const poolContract = new web3.eth.Contract(IUniswapV3PoolABI, poolAddress)

    await poolContract.methods.initialize(encodePriceSqrt(100, 100)).send({from: toAddress})

  }

  return poolAddress
}

const getTokenInfo = async (token) => {
  const Token = new web3.eth.Contract(ERC20, token)

  const [name, symbol, decimals] = await Promise.all([
    Token.methods.name().call(),
    Token.methods.symbol().call(),
    Token.methods.decimals().call(),
  ])

  return {
    name,
    symbol,
    decimals: +decimals
  }
}


const addLiquidity = async (token0, token1, fee, toAddress, amount) => {

  const poolAddress = await createPool(token0, token1, fee, toAddress)

  const token0Contract = new web3.eth.Contract(ERC20, token0)
  
  await token0Contract.methods.approve(addresses.positionManagerAddress, constants.MAX_UINT256).send({from: toAddress})
  
  const token1Contract = new web3.eth.Contract(ERC20, token1)

  await token1Contract.methods.approve(addresses.positionManagerAddress, constants.MAX_UINT256).send({from: toAddress})
  
  const poolContract = new web3.eth.Contract(IUniswapV3PoolABI, poolAddress)

  const immutables = await getPoolImmutables(poolContract)
  
  const state = await getPoolState(poolContract)

  const { name: tokenAname, symbol: tokenAsymbol, decimals: tokenAdecimals } = await getTokenInfo(token0)
  const { name: tokenBname, symbol: tokenBsymbol, decimals: tokenBdecimals } = await getTokenInfo(token1)
  
  const TokenA = new Token(1, immutables.token0, tokenAdecimals, tokenAsymbol, tokenAname)
  const TokenB = new Token(1, immutables.token1, tokenBdecimals, tokenBsymbol, tokenBname)
  
  const POOL = new Pool(
    TokenA,
    TokenB,
    immutables.fee,
    state.sqrtPriceX96,
    state.liquidity,
    state.tick
  )
  
  const position = new Position({
    pool: POOL,
    liquidity: amount,
    tickLower: nearestUsableTick(state.tick, immutables.tickSpacing) - immutables.tickSpacing * 2,
    tickUpper: nearestUsableTick(state.tick, immutables.tickSpacing) + immutables.tickSpacing * 2,
  })

  const blockNumber = await web3.eth.getBlockNumber()
  const block = await web3.eth.getBlock(blockNumber)
  const deadline = block.timestamp + 60 * 20
  
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(position, { slippageTolerance: new Percent(50, 10_000), recipient: toAddress, deadline: deadline})

  const txData = { to: addresses.positionManagerAddress, from: toAddress, gas: 1000000, data: calldata, value: value}

  await web3.eth.sendTransaction(txData)

}

module.exports = addLiquidity
