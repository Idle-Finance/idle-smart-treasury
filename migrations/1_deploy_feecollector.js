const addresses = require('../constants/addresses');
const FeeCollector = artifacts.require("FeeCollector");
const UniswapV2Exchange = artifacts.require('UniswapV2Exchange')
const StakeAaveManager = artifacts.require('StakeAaveManager')
const {deployProxy} = require('../utilities/proxy')

module.exports = async function (deployer, network) {
  if (network === 'test' || network === 'development' || network == 'soliditycoverage') {
    return;
  }

  const _addresses = addresses[network];
  const accounts = await web3.eth.getAccounts()

  await deployer.deploy(UniswapV2Exchange, _addresses.uniswapFactory, _addresses.uniswapRouterAddress)
  await deployer.deploy(StakeAaveManager, _addresses.aave, _addresses.stakeAave)

  const exchangeManager = await UniswapV2Exchange.deployed()
  const stakeManager = await StakeAaveManager.deployed()

  const initializationArgs = [
    _addresses.weth,
    [addresses.feeTreasuryAddress, addresses.idleRebalancer],
    [80000, 20000],
    _addresses.feeTokens,
    [exchangeManager.address],
    [stakeManager.address]
  ]
  
  await deployProxy(FeeCollector, initializationArgs, accounts[0], accounts[1])
}
