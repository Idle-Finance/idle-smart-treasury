const { BN } = require('@openzeppelin/test-helpers');

const evmMine = () =>  {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      { jsonrpc: "2.0", method: "evm_mine", id: new Date().getTime()},
      (error, result) => {
          if (error) {
              return reject(error);
          }
          return resolve(result);
      });
  });
};

const evmIncreaseTime = (seconds) => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {method: "evm_increaseTime", params: [seconds], jsonrpc: "2.0", id: new Date().getTime()},
      (error, result) => {
        if (error) {
            return reject(error);
        }
        return evmMine().then(()=> resolve(result));
      })
  })
}

const increaseTo = async (amount) => {
  const target = amount
  const block = await web3.eth.getBlock('latest')
  const now = new BN(block.timestamp)
  const duration = target.sub(now)
  await evmIncreaseTime(duration.toNumber())
}

module.exports.increaseTo = increaseTo
