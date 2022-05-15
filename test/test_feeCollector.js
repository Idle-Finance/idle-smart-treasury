const {BN, constants, expectRevert} = require('@openzeppelin/test-helpers')

const { expect } = require('chai');

const FeeCollector = artifacts.require('FeeCollector')
const IUniswapV2Router02 = artifacts.require('IUniswapV2Router02')
const UniswapV2Exchange = artifacts.require('UniswapV2Exchange')
const StakeAaveManager = artifacts.require('StakeAaveManager')

const mockIDLE = artifacts.require('IDLEMock')
const mockWETH = artifacts.require('WETHMock')
const mockDAI = artifacts.require('DAIMock')
const mockUSDC = artifacts.require('USDCMock')

const addresses = require("../migrations/addresses").development

const BNify = n => new BN(String(n))

contract("FeeCollector", async accounts => {
  beforeEach(async function(){
    const [owner] = accounts
    this.owner = owner

    this.zeroAddress = "0x0000000000000000000000000000000000000000"
    this.nonZeroAddress = "0x0000000000000000000000000000000000000001"
    this.nonZeroAddress2 = "0x0000000000000000000000000000000000000002"

    this.one = BNify('1000000000000000000') // 18 decimals
    this.ratio_one_pecrent = BNify('1000')

    this.mockWETH = await mockWETH.new()
    this.mockDAI  = await mockDAI.new() // 600 dai == 1 WETH
    this.mockIDLE  = await mockIDLE.new()
    this.mockUSDC  = await mockUSDC.new()

    await this.mockWETH.approve(addresses.uniswapRouterAddress, constants.MAX_UINT256)
    await this.mockDAI.approve(addresses.uniswapRouterAddress, constants.MAX_UINT256)
    await this.mockUSDC.approve(addresses.uniswapRouterAddress, constants.MAX_UINT256)

    this.uniswapRouterInstance = await IUniswapV2Router02.at(addresses.uniswapRouterAddress);

    // initialise the mockWETH/mockDAI uniswap pool
    await this.uniswapRouterInstance.addLiquidity(
      this.mockWETH.address, this.mockDAI.address,
      web3.utils.toWei("1000"), web3.utils.toWei("600000"), // 600,000 DAI deposit into pool
      0, 0,
      this.owner,
      BNify(web3.eth.getBlockNumber())
    )

    // initialise the mockWETH/mockUSDC uniswap pool
    await this.uniswapRouterInstance.addLiquidity(
      this.mockWETH.address, this.mockUSDC.address,
      web3.utils.toWei("500"), BNify("300000").mul(BNify('1000000')), // 300,000 USDC deposit into pool
      0, 0,
      this.owner,
      BNify(web3.eth.getBlockNumber())
    )

    const exchangeManager = await UniswapV2Exchange.new()

    const stakeManager = await StakeAaveManager.new(addresses.stakeAave)

    this.feeCollectorInstance = await FeeCollector.new(
      this.mockWETH.address,
      addresses.feeTreasuryAddress,
      addresses.idleRebalancer,
      accounts[0],
      [],
      exchangeManager.address,
      stakeManager.address
    )

  })

    
  it("Should correctly deploy", async function() {
    const [,otherAddress] = accounts
    let instance = this.feeCollectorInstance

    let allocation = await instance.getSplitAllocation.call()

    let deployerAddressWhitelisted = await instance.isAddressWhitelisted.call(this.owner)
    let randomAddressWhitelisted = await instance.isAddressWhitelisted.call(otherAddress)
    let deployerAddressAdmin = await instance.isAddressAdmin.call(this.owner)
    let randomAddressAdmin = await instance.isAddressAdmin.call(otherAddress)

    let beneficiaries = await instance.getBeneficiaries.call()

    let depositTokens = await instance.getDepositTokens.call()

    expect(depositTokens.length).to.be.equal(0) // called with no tokens
    
    expect(allocation.length).to.be.equal(2)

    expect(allocation[0], "Initial ratio is not set to 15%").to.be.bignumber.equal(BNify('15000'))
    expect(allocation[1], "Initial ratio is not set to 5%").to.be.bignumber.equal(BNify('5000'))

    assert.isTrue(deployerAddressWhitelisted, "Deployer account should be whitelisted")
    assert.isFalse(randomAddressWhitelisted, "Random account should not be whitelisted")

    assert.isTrue(deployerAddressAdmin, "Deployer account should be admin")
    assert.isFalse(randomAddressAdmin, "Random account should not be admin")

    assert.equal(beneficiaries[0].toLowerCase(), addresses.feeTreasuryAddress.toLowerCase())
    assert.equal(beneficiaries[1].toLowerCase(), addresses.idleRebalancer.toLowerCase())
  })

  it("Should deposit tokens with split set to 50/50", async function() {
    let instance = this.feeCollectorInstance

    await instance.setSplitAllocation( [this.ratio_one_pecrent.mul(BNify('50')), this.ratio_one_pecrent.mul(BNify('50'))], {from: accounts[0]}) // set split 50/50

    await instance.registerTokenToDepositList(this.mockDAI.address, {from: accounts[0]}) // whitelist dai

    let depositTokens = await instance.getDepositTokens.call()
    expect(depositTokens.length).to.be.equal(1) // called with no tokens

    let feeTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceBefore =  BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    let depositAmount = web3.utils.toWei("500")
    await this.mockDAI.transfer(instance.address, depositAmount, {from: accounts[0]}) // 500 DAI
    await instance.deposit([true], [0], 0, {from: accounts[0]}) // call deposit

    let feeTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    let feeTreasuryWethBalanceDiff = feeTreasuryWethBalanceAfter.sub(feeTreasuryWethBalanceBefore)
    let idleRebalancerWethBalanceDiff = idleRebalancerWethBalanceAfter.sub(idleRebalancerWethBalanceBefore)

    expect(feeTreasuryWethBalanceDiff).to.be.bignumber.equal(idleRebalancerWethBalanceDiff)
  })
  it("Should change the Exchange Manager", async function () {
    let instance = this.feeCollectorInstance

    await instance.setSplitAllocation( [this.ratio_one_pecrent.mul(BNify('50')), this.ratio_one_pecrent.mul(BNify('50'))], {from: accounts[0]}) // set split 50/50

    await instance.registerTokenToDepositList(this.mockDAI.address, {from: accounts[0]}) // whitelist dai
    
    const newUniswapV2Exchange = await UniswapV2Exchange.new()

    await instance.setExchangeManager(newUniswapV2Exchange.address, {from: accounts[0]})

    let feeTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceBefore =  BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    let depositAmount = web3.utils.toWei("500")
    await this.mockDAI.transfer(instance.address, depositAmount, {from: accounts[0]}) // 500 DAI

    await instance.deposit([true], [0], 0, {from: accounts[0]}) // call deposit

    let feeTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    let feeTreasuryWethBalanceDiff = feeTreasuryWethBalanceAfter.sub(feeTreasuryWethBalanceBefore)
    let idleRebalancerWethBalanceDiff = idleRebalancerWethBalanceAfter.sub(idleRebalancerWethBalanceBefore)

    expect(feeTreasuryWethBalanceDiff).to.be.bignumber.equal(idleRebalancerWethBalanceDiff)
  })

  it("Should deposit with max fee tokens and max beneficiaries", async function() {
    let instance = this.feeCollectorInstance

    let initialAllocation = [BNify('90'), BNify('5')]

    for (let index = 0; index < 3; index++) {
      initialAllocation[0] = BNify(90-5*index)
      initialAllocation.push(BNify('5'))
      
      let allocation = initialAllocation.map(x => this.ratio_one_pecrent.mul(x))
      await instance.addBeneficiaryAddress(accounts[index], allocation)
    }
    let tokensEnables = [];
    let minTokenBalance = []


    for (let index = 0; index < 15; index++) {
      let token = await mockDAI.new()
      await instance.registerTokenToDepositList(token.address)
      await token.approve(addresses.uniswapRouterAddress, constants.MAX_UINT256)

      await this.uniswapRouterInstance.addLiquidity(
        this.mockWETH.address, token.address,
        web3.utils.toWei("100"), web3.utils.toWei("60000"), // 600,000 DAI deposit into pool
        0, 0,
        accounts[0],
        BNify(web3.eth.getBlockNumber())
      )

      let depositAmount = web3.utils.toWei("500")
      await token.transfer(instance.address, depositAmount, {from: accounts[0]}) // 500 DAI
      tokensEnables.push(true);
      minTokenBalance.push(1)
    }
    let transaction = await instance.deposit(tokensEnables, minTokenBalance, 1)

    console.log(`Gas used: ${transaction.receipt.gasUsed}`)
  })

  it('Should not be able to add duplicate beneficiaries', async function() {
    const [,randomBeneficiary] = accounts
    let instance = this.feeCollectorInstance

    let allocationA = [this.ratio_one_pecrent.mul(BNify('100')), BNify('0'), BNify('0')]

    await instance.addBeneficiaryAddress(randomBeneficiary, allocationA)

    await expectRevert(instance.addBeneficiaryAddress(randomBeneficiary, allocationA), "Duplicate beneficiary")
  })

  it("Should remove beneficiary", async function() {
    let instance = this.feeCollectorInstance
    const [,randomBeneficiary] = accounts

    let allocation = [this.ratio_one_pecrent.mul(BNify('100')), BNify('0'), BNify('0')]

    await instance.addBeneficiaryAddress(randomBeneficiary, allocation)

    let beneficiaries = await instance.getBeneficiaries.call()

    expect(beneficiaries.length).to.be.equal(3)

    allocation.pop()
    await instance.removeBeneficiaryAt(1, allocation)

    beneficiaries = await instance.getBeneficiaries.call()

    expect(beneficiaries.length).to.be.equal(2)
    expect(beneficiaries[1].toLowerCase()).to.be.equal(randomBeneficiary.toLowerCase())
  })

  it("Should respect previous allocation when removing beneficiary", async function() {
    let instance = this.feeCollectorInstance
    const [,randomBeneficiary] = accounts

    let allocation = [
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('25')),
      this.ratio_one_pecrent.mul(BNify('25')),
    ]

    await instance.addBeneficiaryAddress(randomBeneficiary, allocation)
    
    let depositAmount = web3.utils.toWei("500")
    await this.mockDAI.transfer(instance.address, depositAmount, {from: this.owner}) // 500 DAI
    
    let newAllocation = [
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('0'))
    ]
    
    let beneficiaryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(randomBeneficiary))
    let feeTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceBefore =  BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))
    
    await instance.setSplitAllocation(newAllocation)

    let beneficiaryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(randomBeneficiary))
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
    let instance = this.feeCollectorInstance
    const [,randomBeneficiary] = accounts

    let allocation = [
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('50')),
    ]
    await instance.setSplitAllocation(allocation)

    let newAllocation = [
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('25')),
      this.ratio_one_pecrent.mul(BNify('25')),
    ]

    let depositAmount = web3.utils.toWei("500")
    await this.mockDAI.transfer(instance.address, depositAmount, {from: this.owner}) // 500 DAI

    let feeTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceBefore =  BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    await instance.addBeneficiaryAddress(randomBeneficiary, newAllocation) // internally calls deposit

    let feeTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let idleRebalancerWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.idleRebalancer))

    let idleRebalancerWethBalanceDiff = idleRebalancerWethBalanceAfter.sub(idleRebalancerWethBalanceBefore)
    let feeTreasuryWethBalanceDiff = feeTreasuryWethBalanceAfter.sub(feeTreasuryWethBalanceBefore)

    expect(feeTreasuryWethBalanceDiff).to.be.bignumber.equal(idleRebalancerWethBalanceDiff)
    expect(BNify(await this.mockWETH.balanceOf.call(randomBeneficiary))).to.be.bignumber.that.is.equal(BNify("0"))
  })

  it("Should revert when calling function with onlyWhitelisted modifier from non-whitelisted address", async function() {
    let instance = this.feeCollectorInstance
    const [,other] = accounts

    await expectRevert(instance.deposit([], [], 0, {from: other}), "Unauthorised") // call deposit
  })

  it("Should revert when calling function with onlyAdmin modifier when not admin", async function() {
    let instance = this.feeCollectorInstance
    const [,other] = accounts

    let allocation = [
      this.ratio_one_pecrent.mul(BNify('100')),
      this.ratio_one_pecrent.mul(BNify('0')),
      this.ratio_one_pecrent.mul(BNify('0')),
    ]
    
    await expectRevert(instance.addBeneficiaryAddress(this.nonZeroAddress, allocation, {from: other}), "Unauthorised")
    await expectRevert(instance.removeBeneficiaryAt(1, allocation, {from: other}), "Unauthorised")
    await expectRevert(instance.replaceBeneficiaryAt(1, this.nonZeroAddress, allocation, {from: other}), "Unauthorised")

    await expectRevert(instance.addAddressToWhiteList(this.nonZeroAddress, {from: other}), "Unauthorised")
    await expectRevert(instance.removeAddressFromWhiteList(this.nonZeroAddress, {from: other}), "Unauthorised")
    
    await expectRevert(instance.registerTokenToDepositList(this.nonZeroAddress, {from: other}), "Unauthorised")
    await expectRevert(instance.removeTokenFromDepositList(this.nonZeroAddress, {from: other}), "Unauthorised")
    
    await expectRevert(instance.setSplitAllocation(allocation, {from: other}), "Unauthorised")
    await expectRevert(instance.replaceAdmin(this.nonZeroAddress, {from: other}), "Unauthorised")
  })

  it("Should add & remove a token from the deposit list", async function() {
    let instance = this.feeCollectorInstance
    let mockDaiAddress = this.mockDAI.address

    let isDaiInDepositListFromBootstrap = await instance.isTokenInDespositList.call(mockDaiAddress)
    assert.isFalse(isDaiInDepositListFromBootstrap)

    await instance.registerTokenToDepositList(mockDaiAddress, {from: accounts[0]})
    
    let daiInDepositList = await instance.isTokenInDespositList.call(mockDaiAddress)
    assert.isTrue(daiInDepositList)

    await instance.removeTokenFromDepositList(mockDaiAddress, {from: accounts[0]})
    let daiNoLongerInDepositList = await instance.isTokenInDespositList.call(mockDaiAddress)
    assert.isFalse(daiNoLongerInDepositList)
  })

  it("Should set beneficiary address", async function() {
    let instance = this.feeCollectorInstance

    let allocation = [
      this.ratio_one_pecrent.mul(BNify('100')),
      this.ratio_one_pecrent.mul(BNify('0')),
    ]

    let initialFeeTreasuryAddress = await instance.getBeneficiaries.call()
    expect(initialFeeTreasuryAddress[0].toLowerCase()).to.be.equal(addresses.feeTreasuryAddress.toLowerCase())

    await expectRevert(instance.replaceBeneficiaryAt(0, this.zeroAddress, allocation), "Beneficiary cannot be 0 address")

    await instance.replaceBeneficiaryAt(0, this.nonZeroAddress, allocation)

    let newFeeTreasuryAddress = await instance.getBeneficiaries.call()
    expect(newFeeTreasuryAddress[0].toLowerCase()).to.be.equal(this.nonZeroAddress)
  })

  it("Should add & remove whitelist address", async function() {
    let instance = this.feeCollectorInstance

    let before = await instance.isAddressWhitelisted(this.nonZeroAddress)
    expect(before, "Address should not be whitelisted initially").to.be.false

    await instance.addAddressToWhiteList(this.nonZeroAddress, {from: accounts[0]})
    let after = await instance.isAddressWhitelisted(this.nonZeroAddress)
    expect(after, "Address should now be whitelisted").to.be.true

    await instance.removeAddressFromWhiteList(this.nonZeroAddress, {from: accounts[0]})
    let final = await instance.isAddressWhitelisted(this.nonZeroAddress)
    expect(final, "Address should not be whitelisted").to.be.false
  })

  it("Should withdraw arbitrary token", async function() {
    let instance = this.feeCollectorInstance

    let depositAmount = web3.utils.toWei("500")

    await this.mockDAI.transfer(instance.address, depositAmount, {from: accounts[0]}) // 500 DAI

    await instance.withdraw(this.mockDAI.address, this.nonZeroAddress, depositAmount)
    let daiBalance = await this.mockDAI.balanceOf.call(this.nonZeroAddress)

    expect(daiBalance).to.be.bignumber.equal(depositAmount)
  })

  it("Should replace admin", async function() {
    let instance = this.feeCollectorInstance

    let nonZeroAddressIsAdmin = await instance.isAddressAdmin.call(this.nonZeroAddress)
    await instance.replaceAdmin(this.nonZeroAddress, {from: this.owner})

    let nonZeroAddressIsAdminAfter = await instance.isAddressAdmin.call(this.nonZeroAddress)
    let previousAdminRevoked = await instance.isAddressAdmin.call(this.owner)

    expect(nonZeroAddressIsAdmin, "Address should not start off as admin").to.be.false
    expect(nonZeroAddressIsAdminAfter, "Address should be granted admin").to.be.true
    expect(previousAdminRevoked, "Previous admin should be revoked").to.be.false
  })

  it("Should not be able to add duplicate deposit token", async function() {
    let instance = this.feeCollectorInstance

    await instance.registerTokenToDepositList(this.mockDAI.address)
    await expectRevert(instance.registerTokenToDepositList(this.mockDAI.address), "Already exists")

    let totalDepositTokens = await instance.getNumTokensInDepositList.call()
    expect(totalDepositTokens).to.be.bignumber.equal(BNify('1'))
  })

  it("Should not add WETH as deposit token", async function() {
    let instance = this.feeCollectorInstance

    await expectRevert(instance.registerTokenToDepositList(this.mockWETH.address), "WETH not supported")
  })

  it("Should not be able to add deposit tokens past limit", async function() {
    let instance = this.feeCollectorInstance
    let token
    for (let index = 0; index < 15; index++) {
      token = await mockDAI.new()
      await instance.registerTokenToDepositList(token.address)
    }

    token = await mockDAI.new()
    await expectRevert(instance.registerTokenToDepositList(token.address), "Too many tokens")
  })

  it("Should not set invalid split ratio", async function() {
    let instance = this.feeCollectorInstance
    
    let allocation = [this.ratio_one_pecrent.mul(BNify('100')), BNify('5'),]
    
    await expectRevert(instance.setSplitAllocation(allocation), "Ratio does not equal 100000")
  })
})
