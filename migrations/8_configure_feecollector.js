const {BN} = require('@openzeppelin/test-helpers')

const FeeCollector = artifacts.require("FeeCollector");

const addresses = require('./addresses');

module.exports = async function (deployer, network) {
  if (network === 'test' || network === 'development' || network == 'soliditycoverage' || network === 'mainnet') {
    return;
  }

  const _addresses = addresses[network]

  const accounts = await web3.eth.getAccounts();

  let feeCollectorInstance = await FeeCollector.deployed()
  
  await web3.eth.sendTransaction({ from: accounts[0], to: _addresses.multisig, value: web3.utils.toWei('1') });

  await feeCollectorInstance.replaceAdmin(_addresses.timelock, {from: _addresses.multisig})
}
