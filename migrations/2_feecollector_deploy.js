const addresses = require('./addresses');
const FeeCollector = artifacts.require("FeeCollector");
const UniswapV2Exchange = artifacts.require('UniswapV2Exchange')
const StakeAaveManager = artifacts.require('StakeAaveManager')

module.exports = async function (deployer, network) {
  if (network === 'test' || network === 'development' || network == 'soliditycoverage') {
    return;
  }

  _addresses = addresses[network];

  await deployer.deploy(UniswapV2Exchange)
  await deployer.deploy(StakeAaveManager)

  const exchangeManager = await UniswapV2Exchange.deployed()
  const stakeManager = await StakeAaveManager.deployed()
  
  deployer.deploy(FeeCollector, 
    _addresses.weth,
    _addresses.feeTreasuryAddress,
    _addresses.idleRebalancer,
    _addresses.multisig,
    _addresses.feeTokens,
    exchangeManager.address,
    stakeManager.address
  )
}
