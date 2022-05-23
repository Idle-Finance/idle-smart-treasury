const contract = require("@truffle/contract");
const ITransparentUpgradeableProxy = require('@openzeppelin/contracts/build/contracts/TransparentUpgradeableProxy.json')

const deployProxy = async(implementationFactory, initializationArgs, proxyOwner, implementationOwner) => {
  const implementationLogic = await implementationFactory.new({from: implementationOwner})

  const TransparentUpgradableProxyFactory = contract(ITransparentUpgradeableProxy)
  
  TransparentUpgradableProxyFactory.setProvider(config.provider)

  const TransparentUpgradableProxy = await TransparentUpgradableProxyFactory.new(implementationLogic.address, proxyOwner, "0x", {from: proxyOwner})

  const implementationInstance = await implementationFactory.at(TransparentUpgradableProxy.address)

  await implementationInstance.initialize(...initializationArgs, {from: implementationOwner})

  return {
    implementationInstance,
    TransparentUpgradableProxy
  }
}

module.exports = {
  deployProxy
}