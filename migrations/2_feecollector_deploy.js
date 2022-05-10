const addresses = require('./addresses');
const FeeCollector = artifacts.require("FeeCollector");
const UniswapV2Exchange = artifacts.require('UniswapV2Exchange')

module.exports = async function (deployer, network) {
  if (network === 'test' || network === 'development' || network == 'soliditycoverage') {
    return;
  }

  _addresses = addresses[network];

  await deployer.deploy(UniswapV2Exchange)

  const _router = await UniswapV2Exchange.deployed()
  
  deployer.deploy(FeeCollector, 
    _addresses.weth,
    _addresses.feeTreasuryAddress,
    _addresses.idleRebalancer,
    _addresses.multisig,
    _addresses.feeTokens,
    _router.address
    )
}
