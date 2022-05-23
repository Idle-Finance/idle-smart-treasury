const addresses = require('../constants/addresses');
const FeeCollector = artifacts.require("FeeCollector");
const UniswapV2Exchange = artifacts.require('UniswapV2Exchange')
const StakeAaveManager = artifacts.require('StakeAaveManager')
const contract = require("@truffle/contract");
const ITransparentUpgradeableProxy = require('@openzeppelin/contracts/build/contracts/TransparentUpgradeableProxy.json')

module.exports = async function (deployer, network, accounts) {
  if (network === 'test' || network === 'development' || network == 'soliditycoverage') {
    return;
  }

  const _addresses = addresses[network];

  await deployer.deploy(UniswapV2Exchange, _addresses.uniswapFactory, _addresses.uniswapRouterAddress, {from: accounts[1]});
  await deployer.deploy(StakeAaveManager, _addresses.aave, _addresses.stakeAave,  {from: accounts[1]});


  const exchangeManager = await UniswapV2Exchange.deployed()
  const stakeManager = await StakeAaveManager.deployed()

  const initializationArgs = [
    _addresses.weth,
    [_addresses.feeTreasuryAddress, _addresses.idleRebalancer],
    [80000, 20000],
    _addresses.feeTokens,
    [exchangeManager.address],
    [stakeManager.address]
  ]
  
  await deployer.deploy(FeeCollector, {from: accounts[1]});
  const implementationLogic = await FeeCollector.deployed()
  
  const TransparentUpgradableProxyFactory = contract(ITransparentUpgradeableProxy)
  TransparentUpgradableProxyFactory.setProvider(config.provider)
  await deployer.deploy(TransparentUpgradableProxyFactory, implementationLogic.address, accounts[0], "0x", {from: accounts[0]})

  const TransparentUpgradableProxy = await TransparentUpgradableProxyFactory.deployed()

  const feeCollectorInstance = await FeeCollector.at(TransparentUpgradableProxy.address)
  
  await exchangeManager.transferOwnership(feeCollectorInstance.address, {from: accounts[1]})
  await stakeManager.transferOwnership(feeCollectorInstance.address, {from: accounts[1]})


  await feeCollectorInstance.initialize(...initializationArgs, {from: accounts[1]})
}
