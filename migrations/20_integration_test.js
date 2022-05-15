const FeeCollector = artifacts.require("FeeCollector");
const IGovernorAlpha = artifacts.require("IGovernorAlpha");
// const SmartTreasuryBootstrap = artifacts.require("SmartTreasuryBootstrap");
// const ConfigurableRightsPool = artifacts.require("ConfigurableRightsPool");
// const BPool = artifacts.require("BPool");
const IIdle = artifacts.require("IIdle");
const IERC20 = artifacts.require("IERC20");
const addresses = require('./addresses');
const {BN, time} = require('@openzeppelin/test-helpers');

const TOKENS_HOLDER = "0xfbb1b73c4f0bda4f67dca266ce6ef42f520fbb98";

const toBN = (v) => new BN(v.toString());
const timelockDelay = 172800

const check = (a, b, message) => {
  let [icon, symbol] = a === b ? ["✔️", "==="] : ["🚨🚨🚨", "!=="];
  console.log(`${icon}  `, a, symbol, b, message ? message : "");
}

const checkGreater = (a, b, message) => {
  let [icon, symbol] = b.gt(a) ? ["✔️", ">"] : ["🚨🚨🚨", "<="];
  console.log(`${icon}  `, a.toString(), symbol, b.toString(), message ? message : "");
}

const advanceBlocks = async n => {
  for (var i = 0; i < n; i++) {
    if (i === 0 || i % 100 === 0) {
      process.stdout.clearLine();  // clear current text
      process.stdout.cursorTo(0);
      process.stdout.write(`waiting for ${n - i} blocks`);
    }

    await time.advanceBlock();
  }
};


module.exports = async function (deployer, network) {
  if (network === 'test' || network === 'development' || network == 'soliditycoverage') {
    return;
  }
  const _addresses = addresses[network]

  await web3.eth.sendTransaction({ from: TOKENS_HOLDER, to: _addresses.timelock, value: web3.utils.toWei('10') });
  await web3.eth.sendTransaction({ from: TOKENS_HOLDER, to: _addresses.multisig, value:  web3.utils.toWei('10') });
  await web3.eth.sendTransaction({ from: TOKENS_HOLDER, to: _addresses.ecosystemFund, value: web3.utils.toWei('10') });
  await web3.eth.sendTransaction({ from: TOKENS_HOLDER, to: _addresses._founder, value:  web3.utils.toWei('10') });

  // tests (SB = SmartTreasuryBootstrap, ST = Smart treasury, FC = FeeCollector)
  
  // governance or multisig can withdraw funds from FC
  // governance can set ST params as ST controller
  // gov or multisig can withdrawUnderlying from FC
  // gov or multisig can replaceAdmin in FC
  // multisig can whitelist
  // whitelist can call deposit in FC ?
  
  const getLatestPropsal = async (gov) => {
    return gov.proposalCount.call()
  }
  
  const createProposal = async (gov, founder, {targets, values, signatures, calldatas, description, from}, log) => {
    console.log(`Proposing: ${log}`);
    await gov.propose(targets, values, signatures, calldatas, description,
      {from}
      );
      // need 1 block to pass before being able to vote but less than 10
      await advanceBlocks(2);
      const proposalId = await getLatestPropsal(gov);
      await gov.castVote(proposalId, true, {from: founder});
      console.log('voted');
      
      // Need to advance 3d in blocs + 1
      await advanceBlocks(17281);
      
      await gov.queue(proposalId);
      console.log('queued');
      
      await time.increase(timelockDelay+100)
      console.log("time increased")
      await advanceBlocks(1)
      console.log("advanced 1")
      
      await gov.execute(proposalId);
      console.log('executed');
      await advanceBlocks(2);
    };
    
    
  let feeCollectorInstance = await FeeCollector.at("0xBecC659Bfc6EDcA552fa1A67451cC6b38a0108E4")
  const govInstance = await IGovernorAlpha.at(_addresses.governor)
    
  let founder = _addresses._founder;
  let propName, proposal

  // tests (SB = SmartTreasuryBootstrap, ST = Smart treasury, FC = FeeCollector)

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
