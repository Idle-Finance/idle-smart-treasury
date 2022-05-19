const contract = require("@truffle/contract");
const ITransparentUpgradeableProxy = require('@openzeppelin/contracts/build/contracts/TransparentUpgradeableProxy.json')

const deployProxy = async(implementationFactory, initializationArgs, owner, sender) => {
  const implementationLogic = await implementationFactory.new()

  const TransparentUpgradableProxyFactory = contract(ITransparentUpgradeableProxy)
  
  TransparentUpgradableProxyFactory.setProvider(config.provider)

  const TransparentUpgradableProxy = await TransparentUpgradableProxyFactory.new(implementationLogic.address, owner, "0x", {from: owner})

  const implementationInstance = await implementationFactory.at(TransparentUpgradableProxy.address)

  await implementationInstance.initialize(...initializationArgs, {from: sender})

  return {
    implementationInstance,
    TransparentUpgradableProxy
  }
}

module.exports = {
  deployProxy
}