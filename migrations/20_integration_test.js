const FeeCollector = artifacts.require("FeeCollector");

const addresses = require('./addresses');

const TOKENS_HOLDER = "0xfbb1b73c4f0bda4f67dca266ce6ef42f520fbb98";
const FEE_COLLECTOR = "0xBecC659Bfc6EDcA552fa1A67451cC6b38a0108E4";

module.exports = async function (deployer, network) {
  if (network === 'test' || network === 'development' || network == 'soliditycoverage') {
    return;
  }
  const _addresses = addresses[network]

  await web3.eth.sendTransaction({ from: TOKENS_HOLDER, to: _addresses.timelock, value: web3.utils.toWei('10') });
  await web3.eth.sendTransaction({ from: TOKENS_HOLDER, to: _addresses.multisig, value:  web3.utils.toWei('10') });
  await web3.eth.sendTransaction({ from: TOKENS_HOLDER, to: _addresses.ecosystemFund, value: web3.utils.toWei('10') });
  await web3.eth.sendTransaction({ from: TOKENS_HOLDER, to: _addresses._founder, value:  web3.utils.toWei('10') });
    
  let feeCollectorInstance = await FeeCollector.at(FEE_COLLECTOR)

  //////////////////////////////////////////////////////////
  // gov or multisig can replaceAdmin in FC
  await feeCollectorInstance.replaceAdmin(_addresses.multisig, { from: _addresses.timelock });
  await feeCollectorInstance.replaceAdmin(_addresses.ecosystemFund, { from: _addresses.multisig });
  await feeCollectorInstance.replaceAdmin(_addresses.multisig, { from: _addresses.ecosystemFund });


  //////////////////////////////////////////////////////////
  // multisig can whitelist
  // console.log("multisig can whitelist");
  await feeCollectorInstance.addAddressToWhiteList(_addresses.ecosystemFund, { from: _addresses.multisig });
  await feeCollectorInstance.removeAddressFromWhiteList(_addresses.ecosystemFund, { from: _addresses.multisig });

  // // back to timelock as admin
  await feeCollectorInstance.replaceAdmin(_addresses.timelock, { from: _addresses.multisig });
}
