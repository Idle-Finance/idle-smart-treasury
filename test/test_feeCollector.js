const {BN, constants, expectRevert} = require('@openzeppelin/test-helpers');

const { expect } = require('chai');

const FeeCollector = artifacts.require('FeeCollector')
const IUniswapV2Router02 = artifacts.require('IUniswapV2Router02')
const UniswapV2Exchange = artifacts.require('UniswapV2Exchange')
const UniswapV3Exchange = artifacts.require('UniswapV3Exchange')
const StakeAaveManager = artifacts.require('StakeAaveManager')

const mockERC20 = artifacts.require('ERC20Mock')

const IStakedAave = artifacts.require('IStakedAave')

const { increaseTo }= require('../utilities/rpc')
const { swap: swapUniswapV2 }= require('../utilities/exchanges/uniswapV2')
const { addLiquidity: addLiquidityUniswapV3}= require('../utilities/exchanges/uniswapV3')
const {deployProxy} = require('../utilities/proxy')
const addresses = require("../constants/addresses").development
const { abi: ERC20abi} = require('@openzeppelin/contracts/build/contracts/ERC20.json')

const BNify = n => new BN(String(n))

contract("FeeCollector", async accounts => {
  beforeEach(async function(){
    const [feeCollectorOwner, proxyOwner, otherAddress] = accounts
    this.feeCollectorOwner = feeCollectorOwner
    this.proxyOwner = proxyOwner
    this.otherAddress = otherAddress

    this.provider = web3.currentProvider.HttpProvider

    this.zeroAddress = "0x0000000000000000000000000000000000000000"
    this.nonZeroAddress = "0x0000000000000000000000000000000000000001"
    this.nonZeroAddress2 = "0x0000000000000000000000000000000000000002"

    this.one = BNify('1000000000000000000')
    this.ratio_one_pecrent = BNify('1000')

    this.mockWETH = await mockERC20.new('WETH', 'WETH', 18)
    this.mockDAI  = await mockERC20.new('DAI', 'DAI', 18)
    this.mockIDLE  = await mockERC20.new('IDLE', 'IDLE', 18)
    this.mockUSDC  = await mockERC20.new('USDC', 'USDC', 6)

    this.aaveInstance = new web3.eth.Contract(ERC20abi, addresses.aave)
    this.stakeAaveInstance = await IStakedAave.at(addresses.stakeAave)

    await this.mockWETH.approve(addresses.uniswapRouterAddress, constants.MAX_UINT256)
    await this.mockDAI.approve(addresses.uniswapRouterAddress, constants.MAX_UINT256)
    await this.mockUSDC.approve(addresses.uniswapRouterAddress, constants.MAX_UINT256)
    await this.aaveInstance.methods.approve(addresses.uniswapRouterAddress, constants.MAX_UINT256).send({from: this.feeCollectorOwner})
    
    this.uniswapRouterInstance = await IUniswapV2Router02.at(addresses.uniswapRouterAddress);

    // initialise the mockWETH/mockDAI uniswap pool
    await this.uniswapRouterInstance.addLiquidity(
      this.mockWETH.address, this.mockDAI.address,
      web3.utils.toWei("1000"), web3.utils.toWei("5000"),
      0, 0,
      this.feeCollectorOwner,
      BNify(web3.eth.getBlockNumber())
    )
  
    this.stakeManager = await StakeAaveManager.new(addresses.aave, addresses.stakeAave)
    const exchangeManager = await UniswapV2Exchange.new(addresses.uniswapFactory, addresses.uniswapRouterAddress)

    const initializationArgs = [
      this.mockWETH.address,
      [addresses.feeTreasuryAddress, addresses.idleRebalancer],
      [80000, 20000],
      [],
      [exchangeManager.address],
      [this.stakeManager.address]
    ]

    const {implementationInstance, TransparentUpgradableProxy} = await deployProxy(FeeCollector,initializationArgs, this.proxyOwner, this.feeCollectorOwner)
    this.TransparentUpgradableProxy = TransparentUpgradableProxy
    this.feeCollectorInstance = implementationInstance

    await this.stakeManager.transferOwnership(this.feeCollectorInstance.address, {from: this.feeCollectorOwner})
    await exchangeManager.transferOwnership(this.feeCollectorInstance.address, {from: this.feeCollectorOwner})
  })

  it("Should replace proxy admin", async function () {
    const adminBefore = await this.TransparentUpgradableProxy.admin.call({from: this.proxyOwner})
    await this.TransparentUpgradableProxy.changeAdmin(this.otherAddress, {from: this.proxyOwner})
    const adminAfter = await this.TransparentUpgradableProxy.admin.call({from: this.otherAddress})
    expect(adminAfter).to.not.eq(adminBefore)
  })
    
  it("Should upgrade the contract implementation", async function () {
    const implementationBefore = await this.TransparentUpgradableProxy.implementation.call({from: this.proxyOwner})
    await this.TransparentUpgradableProxy.upgradeTo(this.feeCollectorInstance.address, {from: this.proxyOwner})
    const implementationAfter = await this.TransparentUpgradableProxy.implementation.call({from: this.proxyOwner})
    expect(implementationAfter).to.not.eq(implementationBefore)
  })

  it("Should correctly deploy", async function() {
    let allocation = await this.feeCollectorInstance.getSplitAllocation.call()

    let deployerAddressWhitelisted = await this.feeCollectorInstance.isAddressWhitelisted.call(this.feeCollectorOwner)
    let randomAddressWhitelisted = await this.feeCollectorInstance.isAddressWhitelisted.call(this.otherAddress)
    let deployerAddressAdmin = await this.feeCollectorInstance.isAddressAdmin.call(this.feeCollectorOwner)
    let randomAddressAdmin = await this.feeCollectorInstance.isAddressAdmin.call(this.otherAddress)

    let beneficiaries = await this.feeCollectorInstance.getBeneficiaries.call()

    let depositTokens = await this.feeCollectorInstance.getDepositTokens.call()

    expect(depositTokens.length).to.be.equal(0)
    
    expect(allocation.length).to.be.equal(2)

    expect(allocation[0], "Initial ratio is not set to 15%").to.be.bignumber.equal(BNify('80000'))
    expect(allocation[1], "Initial ratio is not set to 5%").to.be.bignumber.equal(BNify('20000'))

    assert.isTrue(deployerAddressWhitelisted, "Deployer account should be whitelisted")
    assert.isFalse(randomAddressWhitelisted, "Random account should not be whitelisted")

    assert.isTrue(deployerAddressAdmin, "Deployer account should be admin")
    assert.isFalse(randomAddressAdmin, "Random account should not be admin")

    assert.equal(beneficiaries[0].toLowerCase(), addresses.feeTreasuryAddress.toLowerCase())
    assert.equal(beneficiaries[1].toLowerCase(), addresses.idleRebalancer.toLowerCase())
  })

  it("Should deposit tokens with split set to 50/50", async function() {

    await this.feeCollectorInstance.setSplitAllocation( [this.ratio_one_pecrent.mul(BNify('50')), this.ratio_one_pecrent.mul(BNify('50'))])

    await this.feeCollectorInstance.registerTokenToDepositList(this.mockDAI.address)

    let depositTokens = await this.feeCollectorInstance.getDepositTokens.call()
    expect(depositTokens.length).to.be.equal(1)

    let feeTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceBefore =  BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    let depositAmount = web3.utils.toWei("500")
    await this.mockDAI.transfer(this.feeCollectorInstance.address, depositAmount)
    await this.feeCollectorInstance.deposit([true], [0]) 
    
    let feeTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    let feeTreasuryWethBalanceDiff = feeTreasuryWethBalanceAfter.sub(feeTreasuryWethBalanceBefore)
    let idleRebalancerWethBalanceDiff = idleRebalancerWethBalanceAfter.sub(idleRebalancerWethBalanceBefore)

    expect(feeTreasuryWethBalanceDiff).to.be.bignumber.equal(idleRebalancerWethBalanceDiff)
  })

  it("Should cloud stake and unstake aave token and deposit tokens with split set to 50/50", async function() {
    const COOLDOWN_SECONDS = new BN(await this.stakeAaveInstance.COOLDOWN_SECONDS())

    await swapUniswapV2(200, addresses.aave, addresses.weth, this.provider, this.feeCollectorOwner)
    
    await this.uniswapRouterInstance.addLiquidity(
      this.mockWETH.address, addresses.aave,
      web3.utils.toWei("50"), web3.utils.toWei("150"),
      0, 0,
      this.feeCollectorOwner,
      BNify(web3.eth.getBlockNumber())
    )

    let amountToStkAave = web3.utils.toWei('10')

    await this.aaveInstance.methods.approve(addresses.stakeAave, constants.MAX_UINT256).send({from: this.feeCollectorOwner})
    
    await this.stakeAaveInstance.stake(this.feeCollectorOwner, amountToStkAave, {from: this.feeCollectorOwner, gasLimit: 400000})

    const stakeAaveBalance =  await this.stakeAaveInstance.balanceOf(this.feeCollectorOwner)
    
    await this.stakeAaveInstance.transfer(this.feeCollectorInstance.address, stakeAaveBalance, {from: this.feeCollectorOwner, gasLimit: 400000})

    await this.feeCollectorInstance.claimStakedToken([addresses.stakeAave])
  
    let feeCollectorbalanceOfStkAave = await this.stakeAaveInstance.balanceOf(this.feeCollectorInstance.address)

    expect(feeCollectorbalanceOfStkAave.toNumber()).equal(0)

    let feeCollectorBalanceOfAave =  await this.aaveInstance.methods.balanceOf(this.feeCollectorInstance.address).call()
    
    await this.feeCollectorInstance.claimStakedToken([addresses.stakeAave])

    expect(+feeCollectorBalanceOfAave).equal(0)

    const stakersCooldown =  new BN(await this.stakeAaveInstance.stakersCooldowns(this.stakeManager.address))
    
    const cooldownOffset = new BN(1000)
    await increaseTo(stakersCooldown.add(COOLDOWN_SECONDS).add(cooldownOffset))
    
    await this.feeCollectorInstance.claimStakedToken([addresses.stakeAave])

    feeCollectorBalanceOfAave =  await this.aaveInstance.methods.balanceOf(this.feeCollectorInstance.address).call()
    stakeManagerbalanceOfStkAave = await this.stakeAaveInstance.balanceOf(this.stakeManager.address)

    expect(stakeManagerbalanceOfStkAave.toNumber()).equal(0)

    await this.feeCollectorInstance.setSplitAllocation([this.ratio_one_pecrent.mul(BNify('50')), this.ratio_one_pecrent.mul(BNify('50'))], {from: this.feeCollectorOwner}) 

    await this.feeCollectorInstance.registerTokenToDepositList(this.aaveInstance._address)

    let feeTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceBefore =  BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    await this.feeCollectorInstance.deposit([true], [0], {from: this.feeCollectorOwner})

    let feeTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    let feeTreasuryWethBalanceDiff = feeTreasuryWethBalanceAfter.sub(feeTreasuryWethBalanceBefore)
    let idleRebalancerWethBalanceDiff = idleRebalancerWethBalanceAfter.sub(idleRebalancerWethBalanceBefore)

    expect(feeTreasuryWethBalanceDiff).to.be.bignumber.equal(idleRebalancerWethBalanceDiff)

  })

  it("Should change the Exchange Manager and deposit tokens with split set to 50/50", async function () {

    await addLiquidityUniswapV3(this.mockDAI.address, this.mockWETH.address, 500, this.feeCollectorOwner, web3.utils.toWei('100'))
    
    await this.feeCollectorInstance.setSplitAllocation( [this.ratio_one_pecrent.mul(BNify('50')), this.ratio_one_pecrent.mul(BNify('50'))], {from: this.feeCollectorOwner})
    
    await this.feeCollectorInstance.registerTokenToDepositList(this.mockDAI.address, {from: this.feeCollectorOwner}) 
    
    const uniswapV3Exchange = await UniswapV3Exchange.new(addresses.swapRouter, addresses.quoter, addresses.uniswapV3FactoryAddress)
    
    await uniswapV3Exchange.transferOwnership(this.feeCollectorInstance.address, {from: this.feeCollectorOwner})

    await this.feeCollectorInstance.addExchangeManager(uniswapV3Exchange.address, {from: this.feeCollectorOwner})

    let feeTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceBefore =  BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))
    
    let depositAmount = web3.utils.toWei("50")
    await this.mockDAI.transfer(this.feeCollectorInstance.address, depositAmount, {from: this.feeCollectorOwner})
    await this.feeCollectorInstance.deposit([true], [0], {from: this.feeCollectorOwner})

    let feeTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    let feeTreasuryWethBalanceDiff = feeTreasuryWethBalanceAfter.sub(feeTreasuryWethBalanceBefore)
    let idleRebalancerWethBalanceDiff = idleRebalancerWethBalanceAfter.sub(idleRebalancerWethBalanceBefore)

    expect(feeTreasuryWethBalanceDiff).to.be.bignumber.equal(idleRebalancerWethBalanceDiff)
  })

  it("Should deposit with max fee tokens and max beneficiaries", async function() {
    let initialAllocation = [BNify('90'), BNify('5')]

    for (let index = 0; index <= 2; index++) {
      initialAllocation[0] = BNify(90-5*index)
      initialAllocation.push(BNify('5'))
      
      let allocation = initialAllocation.map(x => this.ratio_one_pecrent.mul(x))
      await this.feeCollectorInstance.addBeneficiaryAddress(accounts[index], allocation)
    }
    let tokensEnables = [];
    let minTokenBalance = []


    for (let index = 0; index < 15; index++) {
      let token = await mockERC20.new('Token', 'TKN', 18)
      await this.feeCollectorInstance.registerTokenToDepositList(token.address)
      await token.approve(addresses.uniswapRouterAddress, constants.MAX_UINT256)

      await this.uniswapRouterInstance.addLiquidity(
        this.mockWETH.address, token.address,
        web3.utils.toWei("100"), web3.utils.toWei("60000"),
        0, 0,
        this.feeCollectorOwner,
        BNify(web3.eth.getBlockNumber())
      )

      let depositAmount = web3.utils.toWei("500")
      await token.transfer(this.feeCollectorInstance.address, depositAmount, {from: this.feeCollectorOwner})
      tokensEnables.push(true);
      minTokenBalance.push(1)
    }

    await this.feeCollectorInstance.deposit(tokensEnables, minTokenBalance)
  })

  it('Should not be able to add duplicate beneficiaries', async function() {
    let allocationA = [this.ratio_one_pecrent.mul(BNify('100')), BNify('0'), BNify('0')]

    await this.feeCollectorInstance.addBeneficiaryAddress(this.otherAddress, allocationA)

    await expectRevert(this.feeCollectorInstance.addBeneficiaryAddress(this.otherAddress, allocationA), "Duplicate beneficiary")
  })

  it("Should remove beneficiary", async function() {
    let allocation = [this.ratio_one_pecrent.mul(BNify('100')), BNify('0'), BNify('0')]

    await this.feeCollectorInstance.addBeneficiaryAddress(this.otherAddress, allocation)

    let beneficiaries = await this.feeCollectorInstance.getBeneficiaries.call()

    expect(beneficiaries.length).to.be.equal(3)

    allocation.pop()
    await this.feeCollectorInstance.removeBeneficiaryAt(1, allocation)

    beneficiaries = await this.feeCollectorInstance.getBeneficiaries.call()

    expect(beneficiaries.length).to.be.equal(2)
    expect(beneficiaries[1].toLowerCase()).to.be.equal(this.otherAddress.toLowerCase())
  })

  it("Should respect previous allocation when removing beneficiary", async function() {

    let allocation = [
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('25')),
      this.ratio_one_pecrent.mul(BNify('25')),
    ]

    await this.feeCollectorInstance.addBeneficiaryAddress(this.otherAddress, allocation)
    
    let depositAmount = web3.utils.toWei("500")
    await this.mockDAI.transfer(this.feeCollectorInstance.address, depositAmount, {from: this.feeCollectorOwner})
    
    let newAllocation = [
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('0'))
    ]
    
    let beneficiaryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(this.otherAddress))
    let feeTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceBefore =  BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))
    
    await this.feeCollectorInstance.setSplitAllocation(newAllocation, {from: this.feeCollectorOwner})

    let beneficiaryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(this.otherAddress))
    let feeTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceAfter =  BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    let beneficiaryWethBalanceDiff = beneficiaryWethBalanceAfter.sub(beneficiaryWethBalanceBefore)
    let idleRebalancerWethBalanceDiff = idleRebalancerWethBalanceAfter.sub(idleRebalancerWethBalanceBefore)
    let feeTreasuryWethBalanceDiff = feeTreasuryWethBalanceAfter.sub(feeTreasuryWethBalanceBefore)

    expect(beneficiaryWethBalanceDiff).to.be.bignumber.equal(feeTreasuryWethBalanceDiff)
    expect(idleRebalancerWethBalanceDiff).to.be.bignumber.equal(feeTreasuryWethBalanceDiff.mul(BNify("2")))
    expect(idleRebalancerWethBalanceDiff).to.be.bignumber.equal(beneficiaryWethBalanceDiff.mul(BNify("2")))
  })

  it("Should respect previous allocation when adding beneficiary", async function() {

    let allocation = [
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('50')),
    ]
    await this.feeCollectorInstance.setSplitAllocation(allocation)

    let newAllocation = [
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('25')),
      this.ratio_one_pecrent.mul(BNify('25')),
    ]

    let depositAmount = web3.utils.toWei("500")
    await this.mockDAI.transfer(this.feeCollectorInstance.address, depositAmount, {from: this.feeCollectorOwner})

    let feeTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceBefore =  BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    await this.feeCollectorInstance.addBeneficiaryAddress(this.otherAddress, newAllocation)

    let feeTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    let idleRebalancerWethBalanceDiff = idleRebalancerWethBalanceAfter.sub(idleRebalancerWethBalanceBefore)
    let feeTreasuryWethBalanceDiff = feeTreasuryWethBalanceAfter.sub(feeTreasuryWethBalanceBefore)

    expect(feeTreasuryWethBalanceDiff).to.be.bignumber.equal(idleRebalancerWethBalanceDiff)
    expect(BNify(await this.mockWETH.balanceOf.call(this.otherAddress))).to.be.bignumber.that.is.equal(BNify("0"))
  })

  it("Should revert when calling function with onlyWhitelisted modifier from non-whitelisted address", async function() {

    await expectRevert(this.feeCollectorInstance.deposit([], [], {from: this.otherAddress}), "Unauthorised") // call deposit
  })

  it("Should revert when calling function with onlyAdmin modifier when not admin", async function() {

    let allocation = [
      this.ratio_one_pecrent.mul(BNify('100')),
      this.ratio_one_pecrent.mul(BNify('0')),
      this.ratio_one_pecrent.mul(BNify('0')),
    ]
    
    await expectRevert(this.feeCollectorInstance.addBeneficiaryAddress(this.nonZeroAddress, allocation, {from: this.otherAddress}), "Unauthorised")
    await expectRevert(this.feeCollectorInstance.removeBeneficiaryAt(1, allocation, {from: this.otherAddress}), "Unauthorised")

    await expectRevert(this.feeCollectorInstance.addAddressToWhiteList(this.nonZeroAddress, {from: this.otherAddress}), "Unauthorised")
    await expectRevert(this.feeCollectorInstance.removeAddressFromWhiteList(this.nonZeroAddress, {from: this.otherAddress}), "Unauthorised")
    
    await expectRevert(this.feeCollectorInstance.registerTokenToDepositList(this.nonZeroAddress, {from: this.otherAddress}), "Unauthorised")
    await expectRevert(this.feeCollectorInstance.removeTokenFromDepositList(this.nonZeroAddress, {from: this.otherAddress}), "Unauthorised")
    
    await expectRevert(this.feeCollectorInstance.setSplitAllocation(allocation, {from: this.otherAddress}), "Unauthorised")
    await expectRevert(this.feeCollectorInstance.replaceAdmin(this.nonZeroAddress, {from: this.otherAddress}), "Unauthorised")
  })

  it("Should add & remove a token from the deposit list", async function() {

    let isDaiInDepositListFromBootstrap = await this.feeCollectorInstance.isTokenInDespositList.call(this.mockDAI.address)
    assert.isFalse(isDaiInDepositListFromBootstrap)

    await this.feeCollectorInstance.registerTokenToDepositList(this.mockDAI.address, {from: this.feeCollectorOwner})
    
    let daiInDepositList = await this.feeCollectorInstance.isTokenInDespositList.call(this.mockDAI.address)
    assert.isTrue(daiInDepositList)

    await this.feeCollectorInstance.removeTokenFromDepositList(this.mockDAI.address, {from: this.feeCollectorOwner})
    let daiNoLongerInDepositList = await this.feeCollectorInstance.isTokenInDespositList.call(this.mockDAI.address)
    assert.isFalse(daiNoLongerInDepositList)
  })

  it("Should add & remove whitelist address", async function() {

    let before = await this.feeCollectorInstance.isAddressWhitelisted(this.nonZeroAddress)
    expect(before, "Address should not be whitelisted initially").to.be.false

    await this.feeCollectorInstance.addAddressToWhiteList(this.nonZeroAddress, {from: this.feeCollectorOwner})
    let after = await this.feeCollectorInstance.isAddressWhitelisted(this.nonZeroAddress)
    expect(after, "Address should now be whitelisted").to.be.true

    await this.feeCollectorInstance.removeAddressFromWhiteList(this.nonZeroAddress, {from: this.feeCollectorOwner})
    let final = await this.feeCollectorInstance.isAddressWhitelisted(this.nonZeroAddress)
    expect(final, "Address should not be whitelisted").to.be.false
  })

  it("Should withdraw arbitrary token", async function() {

    let depositAmount = web3.utils.toWei("500")

    await this.mockDAI.transfer(this.feeCollectorInstance.address, depositAmount, {from: this.feeCollectorOwner})

    await this.feeCollectorInstance.withdraw(this.mockDAI.address, this.nonZeroAddress, depositAmount)
    let daiBalance = await this.mockDAI.balanceOf.call(this.nonZeroAddress)

    expect(daiBalance).to.be.bignumber.equal(depositAmount)
  })

  it("Should replace admin", async function() {

    let nonZeroAddressIsAdmin = await this.feeCollectorInstance.isAddressAdmin.call(this.nonZeroAddress)
    await this.feeCollectorInstance.replaceAdmin(this.nonZeroAddress, {from: this.feeCollectorOwner})

    let nonZeroAddressIsAdminAfter = await this.feeCollectorInstance.isAddressAdmin.call(this.nonZeroAddress)
    let previousAdminRevoked = await this.feeCollectorInstance.isAddressAdmin.call(this.feeCollectorOwner)

    expect(nonZeroAddressIsAdmin, "Address should not start off as admin").to.be.false
    expect(nonZeroAddressIsAdminAfter, "Address should be granted admin").to.be.true
    expect(previousAdminRevoked, "Previous admin should be revoked").to.be.false
  })

  it("Should not be able to add duplicate deposit token", async function() {

    await this.feeCollectorInstance.registerTokenToDepositList(this.mockDAI.address)
    await expectRevert(this.feeCollectorInstance.registerTokenToDepositList(this.mockDAI.address), "Duplicate deposit token")

    let totalDepositTokens = await this.feeCollectorInstance.getNumTokensInDepositList.call()
    expect(totalDepositTokens).to.be.bignumber.equal(BNify('1'))
  })

  it("Should not add WETH as deposit token", async function() {

    await expectRevert(this.feeCollectorInstance.registerTokenToDepositList(this.mockWETH.address), "WETH not supported")
  })

  it("Should not be able to add deposit tokens past limit", async function() {
    let token
    for (let index = 0; index < 15; index++) {
      token = await mockERC20.new('Token', 'TKN', 18)
      await this.feeCollectorInstance.registerTokenToDepositList(token.address)
    }

    token = await mockERC20.new('Token', 'TKN', 18)
    await expectRevert(this.feeCollectorInstance.registerTokenToDepositList(token.address), "Too many tokens")
  })

  it("Should not set invalid split ratio", async function() {
    
    let allocation = [this.ratio_one_pecrent.mul(BNify('100')), BNify('5'),]
    
    await expectRevert(this.feeCollectorInstance.setSplitAllocation(allocation), "Ratio does not equal 100000")
  })
})
