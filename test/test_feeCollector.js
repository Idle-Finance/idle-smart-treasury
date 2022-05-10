const {BN, constants, expectRevert} = require('@openzeppelin/test-helpers')

const { expect } = require('chai');

const FeeCollector = artifacts.require('FeeCollector')
const IUniswapV2Router02 = artifacts.require('IUniswapV2Router02')
const UniswapV2Exchange = artifacts.require('UniswapV2Exchange')
const StakeAaveManaget = artifacts.require('StakeAaveManaget')


const BPool = artifacts.require('BPool')
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool')
const mockIDLE = artifacts.require('IDLEMock')
const mockWETH = artifacts.require('WETHMock')
const mockDAI = artifacts.require('DAIMock')
const mockUSDC = artifacts.require('USDCMock')


const SmartTreasuryBootstrap = artifacts.require('SmartTreasuryBootstrap')

const addresses = require("../migrations/addresses").development

const BNify = n => new BN(String(n))

contract.only("FeeCollector", async accounts => {
  beforeEach(async function(){
    this.zeroAddress = "0x0000000000000000000000000000000000000000";
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
      web3.utils.toWei("500"), web3.utils.toWei("300000"), // 300,000 DAI deposit into pool
      0, 0,
      accounts[0],
      BNify(web3.eth.getBlockNumber())
    )

    // initialise the mockWETH/mockUSDC uniswap pool
    await this.uniswapRouterInstance.addLiquidity(
      this.mockWETH.address, this.mockUSDC.address,
      web3.utils.toWei("500"), BNify("300000").mul(BNify('1000000')), // 300,000 USDC deposit into pool
      0, 0,
      accounts[0],
      BNify(web3.eth.getBlockNumber())
    )

    const router = await UniswapV2Exchange.new()
    const stakeManager = await StakeAaveManaget.new(addresses.stakeAave)

    this.feeCollectorInstance = await FeeCollector.new(
      this.mockWETH.address,
      addresses.feeTreasuryAddress,
      addresses.idleRebalancer,
      accounts[0],
      [],
      router.address,
      stakeManager.address
    )


    this.smartTreasuryBootstrapInstance = await SmartTreasuryBootstrap.new(
      addresses.balancerCoreFactory,
      addresses.balancerCRPFactory,
      this.mockIDLE.address,
      this.mockWETH.address,
      addresses.timelock,
      this.feeCollectorInstance.address, // set the feecollector address
      accounts[0],
      [this.mockDAI.address, this.mockUSDC.address]
    )
    await this.mockDAI.transfer(this.smartTreasuryBootstrapInstance.address, web3.utils.toWei("20000"));
    await this.mockUSDC.transfer(this.smartTreasuryBootstrapInstance.address, BNify("20000").mul(BNify('1000000')));
    await this.mockIDLE.transfer(this.smartTreasuryBootstrapInstance.address, web3.utils.toWei("130000"));
    await this.smartTreasuryBootstrapInstance.swap([1, 1]); // swap all deposit tokens to WETH 

    await this.smartTreasuryBootstrapInstance.setIDLEPrice(web3.utils.toWei('135')); // Set price, this is used for setting initial weights
    await this.smartTreasuryBootstrapInstance.initialise();
    await this.smartTreasuryBootstrapInstance.bootstrap();

    let crpAddress = await this.smartTreasuryBootstrapInstance.getCRPAddress.call();
    let bPoolAddress = await this.smartTreasuryBootstrapInstance.getCRPBPoolAddress.call();
    this.bPool = await BPool.at(bPoolAddress)

    this.crp = await ConfigurableRightsPool.at(crpAddress)

  })

    
  it.skip("Should correctly deploy", async function() {
    let instance = this.feeCollectorInstance

    let allocation = await instance.getSplitAllocation.call()

    let deployerAddressWhitelisted = await instance.isAddressWhitelisted.call(accounts[0])
    let randomAddressWhitelisted = await instance.isAddressWhitelisted.call(accounts[1])
    let deployerAddressAdmin = await instance.isAddressAdmin.call(accounts[0])
    let randomAddressAdmin = await instance.isAddressAdmin.call(accounts[1])

    let beneficiaries = await instance.getBeneficiaries.call()

    let depositTokens = await instance.getDepositTokens.call()

    expect(depositTokens.length).to.be.equal(0) // called with no tokens
    
    expect(allocation[0], "Initial ratio is not set to 80%").to.be.bignumber.equal(BNify('80000'))
    expect(allocation[1], "Initial ratio is not set to 15%").to.be.bignumber.equal(BNify('15000'))
    expect(allocation[2], "Initial ratio is not set to 5%").to.be.bignumber.equal(BNify('5000'))

    expect(allocation.length).to.be.equal(3)

    assert.isTrue(deployerAddressWhitelisted, "Deployer account should be whitelisted")
    assert.isFalse(randomAddressWhitelisted, "Random account should not be whitelisted")

    assert.isTrue(deployerAddressAdmin, "Deployer account should be admin")
    assert.isFalse(randomAddressAdmin, "Random account should not be admin")

    assert.equal(beneficiaries[0].toLowerCase(), this.zeroAddress) // should be zero address on deploy
    assert.equal(beneficiaries[1].toLowerCase(), addresses.feeTreasuryAddress.toLowerCase())
    assert.equal(beneficiaries[2].toLowerCase(), addresses.idleRebalancer.toLowerCase())

    expect(beneficiaries.length).to.be.equal(3)
  })

  it("Should deposit tokens with split set to 50/50", async function() {
    let instance = this.feeCollectorInstance

    await instance.setSmartTreasuryAddress(this.crp.address)
    await instance.setSplitAllocation(
      [this.ratio_one_pecrent.mul(BNify('50')), this.ratio_one_pecrent.mul(BNify('50')), 0],
      {from: accounts[0]}) // set split 50/50
    await instance.registerTokenToDepositList(this.mockDAI.address, {from: accounts[0]}) // whitelist dai

    let depositTokens = await instance.getDepositTokens.call()
    expect(depositTokens.length).to.be.equal(1) // called with no tokens
    let feeTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let smartTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(this.bPool.address))
    let balancerPoolTokenSupplyBefore = BNify(await this.crp.totalSupply.call());
    
    let depositAmount = web3.utils.toWei("500")
    await this.mockDAI.transfer(instance.address, depositAmount, {from: accounts[0]}) // 500 DAI
    const deposit =  await instance.deposit([true], [0], 0, {from: accounts[0]}) // call deposit
    console.log('from',deposit.logs[0].args)
    const  newUniswapV2Exchange  = await UniswapV2Exchange.new()
    await instance.setExchange(newUniswapV2Exchange.address, {from: accounts[0]})

    await this.mockDAI.transfer(instance.address, depositAmount, {from: accounts[0]}) // 500 DAI
    await instance.deposit([true], [0], 0, {from: accounts[0]}) // call deposit
    
    let feeTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let smartTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(this.bPool.address))     
    let balancerPoolTokenSupplyAfter = BNify(await this.crp.totalSupply.call());
    
    
    let smartTreasuryWethBalanceDiff = smartTreasuryWethBalanceAfter.sub(smartTreasuryWethBalanceBefore)
    let feeTreasuryWethBalanceDiff = feeTreasuryWethBalanceAfter.sub(feeTreasuryWethBalanceBefore)
    let balancerPoolTokenSupplyDiff = balancerPoolTokenSupplyAfter.sub(balancerPoolTokenSupplyBefore)

    expect(feeTreasuryWethBalanceDiff).to.be.bignumber.equal(smartTreasuryWethBalanceDiff)
    expect(smartTreasuryWethBalanceDiff).to.be.bignumber.that.is.greaterThan(BNify('0'))
    
    expect(balancerPoolTokenSupplyDiff).to.be.bignumber.that.is.greaterThan(BNify('0'))
  })

  it.skip("Should deposit with max fee tokens and max beneficiaries", async function() {
    let instance = this.feeCollectorInstance
    await instance.setSmartTreasuryAddress(this.crp.address)

    let initialAllocation = [BNify('90'), BNify('5'), BNify('5')]

    for (let index=0; index < 2; index++) {
      initialAllocation[0] = BNify(85-5*index)
      initialAllocation.push(BNify('5'))
      
      let allocation = initialAllocation.map(x => this.ratio_one_pecrent.mul(x))
      await instance.addBeneficiaryAddress(accounts[index], allocation)
    }
    let tokensEnables = [];
    let minTokenBalance = []


    for (let index = 0; index < 8; index++) {
      let token = await mockDAI.new()
      await instance.registerTokenToDepositList(token.address)
      await token.approve(addresses.uniswapRouterAddress, constants.MAX_UINT256)
      console.log(token.address, this.mockWETH.address)

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

  it.skip('Should not be able to add duplicate beneficiaries', async function() {
    let instance = this.feeCollectorInstance
    await instance.setSmartTreasuryAddress(this.crp.address) // must set smart treasury address

    let allocationA = [this.ratio_one_pecrent.mul(BNify('100')), BNify('0'), BNify('0'), BNify('0')]
    let allocationB = [this.ratio_one_pecrent.mul(BNify('100')), BNify('0'), BNify('0'), BNify('0'), BNify('0')]

    await instance.addBeneficiaryAddress(accounts[0], allocationA)
    expectRevert(instance.addBeneficiaryAddress(accounts[0], allocationA), "Duplicate beneficiary")
  })

  it.skip("Should remove beneficiary", async function() {
    let instance = this.feeCollectorInstance
    await instance.setSmartTreasuryAddress(this.crp.address) // must set smart treasury address

    let allocation = [this.ratio_one_pecrent.mul(BNify('100')), BNify('0'), BNify('0'), BNify('0')]

    await instance.addBeneficiaryAddress(accounts[0], allocation)
    let beneficiaries = await instance.getBeneficiaries.call()

    expect(beneficiaries.length).to.be.equal(4)

    allocation.pop()
    await instance.removeBeneficiaryAt(1, allocation)
    beneficiaries = await instance.getBeneficiaries.call()
    expect(beneficiaries.length).to.be.equal(3)
    expect(beneficiaries[1].toLowerCase()).to.be.equal(accounts[0].toLowerCase())
  })

  it.skip("Should respect previous allocation when removing beneficiary", async function() {
    let instance = this.feeCollectorInstance
    await instance.setSmartTreasuryAddress(this.crp.address) // must set smart treasury address
    
    let allocation = [
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('25')),
      this.ratio_one_pecrent.mul(BNify('25')),
      this.ratio_one_pecrent.mul(BNify('0'))
    ]

    await instance.addBeneficiaryAddress(accounts[3], allocation)
    
    let depositAmount = web3.utils.toWei("500")
    await this.mockDAI.transfer(instance.address, depositAmount, {from: accounts[0]}) // 500 DAI

    let newAllocation = [
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('0'))
    ]

    let beneficiaryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(accounts[3]))
    let feeTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let smartTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(this.bPool.address))
    
    
    await instance.removeBeneficiaryAt(3, newAllocation)

    let beneficiaryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(accounts[3]))
    let feeTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let smartTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(this.bPool.address))

    let beneficiaryWethBalanceDiff = beneficiaryWethBalanceAfter.sub(beneficiaryWethBalanceBefore)
    let smartTreasuryWethBalanceDiff = smartTreasuryWethBalanceAfter.sub(smartTreasuryWethBalanceBefore)
    let feeTreasuryWethBalanceDiff = feeTreasuryWethBalanceAfter.sub(feeTreasuryWethBalanceBefore)

    expect(beneficiaryWethBalanceDiff).to.be.bignumber.equal(feeTreasuryWethBalanceDiff)
    expect(smartTreasuryWethBalanceDiff).to.be.bignumber.equal(feeTreasuryWethBalanceDiff.mul(BNify("2")))
    expect(smartTreasuryWethBalanceDiff).to.be.bignumber.equal(beneficiaryWethBalanceDiff.mul(BNify("2")))

  })

  it.skip("Should respect previous allocation when adding beneficiary", async function() {
    let instance = this.feeCollectorInstance
    await instance.setSmartTreasuryAddress(this.crp.address) // must set smart treasury address

    let allocation = [
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('0'))
    ]
    await instance.setSplitAllocation(allocation)

    let newAllocation = [
      this.ratio_one_pecrent.mul(BNify('50')),
      this.ratio_one_pecrent.mul(BNify('25')),
      this.ratio_one_pecrent.mul(BNify('25')),
      this.ratio_one_pecrent.mul(BNify('0'))
    ]

    let depositAmount = web3.utils.toWei("500")
    await this.mockDAI.transfer(instance.address, depositAmount, {from: accounts[0]}) // 500 DAI

    let feeTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let smartTreasuryWethBalanceBefore = BNify(await this.mockWETH.balanceOf.call(this.bPool.address))

    await instance.addBeneficiaryAddress(accounts[2], newAllocation) // internally calls deposit

    let feeTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(addresses.feeTreasuryAddress))
    let smartTreasuryWethBalanceAfter = BNify(await this.mockWETH.balanceOf.call(this.bPool.address))

    let smartTreasuryWethBalanceDiff = smartTreasuryWethBalanceAfter.sub(smartTreasuryWethBalanceBefore)
    let feeTreasuryWethBalanceDiff = feeTreasuryWethBalanceAfter.sub(feeTreasuryWethBalanceBefore)

    expect(feeTreasuryWethBalanceDiff).to.be.bignumber.equal(smartTreasuryWethBalanceDiff)
    expect(BNify(await this.mockWETH.balanceOf.call(accounts[2]))).to.be.bignumber.that.is.equal(BNify("0"))
  })

  it.skip("Should revert when calling function with onlyWhitelisted modifier from non-whitelisted address", async function() {
    let instance = this.feeCollectorInstance
    
    await instance.setSmartTreasuryAddress(this.crp.address) // must set smart treasury address
    await expectRevert(instance.deposit([], [], 0, {from: accounts[1]}), "Unauthorised") // call deposit
  })

  it.skip("Should revert when calling function with onlyAdmin modifier when not admin", async function() {
    let instance = this.feeCollectorInstance
    
    let allocation = [
      this.ratio_one_pecrent.mul(BNify('100')),
      this.ratio_one_pecrent.mul(BNify('0')),
      this.ratio_one_pecrent.mul(BNify('0'))
    ]
    
    await instance.setSmartTreasuryAddress(this.crp.address) // must set smart treasury address
    
    await expectRevert(instance.addBeneficiaryAddress(this.nonZeroAddress, allocation, {from: accounts[1]}), "Unauthorised")
    await expectRevert(instance.removeBeneficiaryAt(1, allocation, {from: accounts[1]}), "Unauthorised")
    await expectRevert(instance.replaceBeneficiaryAt(1, this.nonZeroAddress, allocation, {from: accounts[1]}), "Unauthorised")
    
    await expectRevert(instance.setSmartTreasuryAddress(this.crp.address, {from: accounts[1]}), "Unauthorised")
    await expectRevert(instance.addAddressToWhiteList(this.nonZeroAddress, {from: accounts[1]}), "Unauthorised")
    await expectRevert(instance.removeAddressFromWhiteList(this.nonZeroAddress, {from: accounts[1]}), "Unauthorised")
    
    await expectRevert(instance.registerTokenToDepositList(this.nonZeroAddress, {from: accounts[1]}), "Unauthorised")
    await expectRevert(instance.removeTokenFromDepositList(this.nonZeroAddress, {from: accounts[1]}), "Unauthorised")
    
    await expectRevert(instance.setSplitAllocation(allocation, {from: accounts[1]}), "Unauthorised")
    await expectRevert(instance.withdrawUnderlying(this.mockDAI.address, 1, [0, 0], {from: accounts[1]}), "Unauthorised")
    await expectRevert(instance.replaceAdmin(this.nonZeroAddress, {from: accounts[1]}), "Unauthorised")
  })

  it.skip("Should revert when calling function with smartTreasurySet modifier when smart treasury not set", async function() {
    let instance = this.feeCollectorInstance
    
    let allocation = [
      this.ratio_one_pecrent.mul(BNify('100')),
      this.ratio_one_pecrent.mul(BNify('0')),
      this.ratio_one_pecrent.mul(BNify('0'))
    ]
    await expectRevert(instance.setSplitAllocation(allocation, {from: accounts[0]}), "Smart Treasury not set")
  })

  it.skip("Should add & remove a token from the deposit list", async function() {
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

  it.skip("Should set beneficiary address", async function() {
    let instance = this.feeCollectorInstance
    await instance.setSmartTreasuryAddress(this.crp.address) // must set smart treasury address

    let allocation = [
      this.ratio_one_pecrent.mul(BNify('100')),
      this.ratio_one_pecrent.mul(BNify('0')),
      this.ratio_one_pecrent.mul(BNify('0'))
    ]

    let initialFeeTreasuryAddress = await instance.getBeneficiaries.call()
    expect(initialFeeTreasuryAddress[1].toLowerCase()).to.be.equal(addresses.feeTreasuryAddress.toLowerCase())

    await expectRevert(instance.replaceBeneficiaryAt(1, this.zeroAddress, allocation), "Beneficiary cannot be 0 address")
    await expectRevert(instance.replaceBeneficiaryAt(0, this.nonZeroAddress, allocation), "Invalid beneficiary to remove")
    await instance.replaceBeneficiaryAt(1, this.nonZeroAddress, allocation)

    let newFeeTreasuryAddress = await instance.getBeneficiaries.call()
    expect(newFeeTreasuryAddress[1].toLowerCase()).to.be.equal(this.nonZeroAddress)
  })

  it.skip("Should set smart treasury address", async function() {
    let instance = this.feeCollectorInstance

    let initialSmartTreasuryAddress = await instance.getSmartTreasuryAddress.call()
    expect(initialSmartTreasuryAddress.toLowerCase()).to.be.equal(this.zeroAddress) // initially this address will not be set

    await expectRevert(instance.setSmartTreasuryAddress(this.zeroAddress), "Smart treasury cannot be 0 address")
    await instance.setSmartTreasuryAddress(this.nonZeroAddress)

    let newFeeTreasuryAddress = await instance.getSmartTreasuryAddress.call()
    expect(newFeeTreasuryAddress.toLowerCase()).to.be.equal(this.nonZeroAddress)

    wethAllowance = await this.mockWETH.allowance(instance.address, this.nonZeroAddress)
    expect(wethAllowance).to.be.bignumber.equal(constants.MAX_UINT256)

    await instance.setSmartTreasuryAddress(this.nonZeroAddress2)
    wethAllowanceAfter = await this.mockWETH.allowance(instance.address, this.nonZeroAddress)
    expect(wethAllowanceAfter).to.be.bignumber.equal(BNify('0'))
  })

  it.skip("Should add & remove whitelist address", async function() {
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

  it.skip("Should withdraw underlying deposit token", async function() {
    let instance = this.feeCollectorInstance
    let allocation = [
      this.ratio_one_pecrent.mul(BNify('100')),
      this.ratio_one_pecrent.mul(BNify('0')),
      this.ratio_one_pecrent.mul(BNify('0'))
    ]

    await instance.setSmartTreasuryAddress(this.crp.address)
    await instance.setSplitAllocation(allocation, {from: accounts[0]}) // set split to 100% smart tresury
    await instance.registerTokenToDepositList(this.mockDAI.address, {from: accounts[0]}) // whitelist dai

    let depositAmount = web3.utils.toWei("500")
    await this.mockDAI.transfer(instance.address, depositAmount, {from: accounts[0]}) // 500 DAI
    await instance.deposit([true], [0], 0, {from: accounts[0]}) // call deposit

    let balancerPoolTokenBalanceBefore = BNify(await this.crp.balanceOf.call(instance.address));
    
    expect(balancerPoolTokenBalanceBefore).to.be.bignumber.that.is.greaterThan(BNify('0'))

    await instance.withdrawUnderlying(this.nonZeroAddress, balancerPoolTokenBalanceBefore.div(BNify("2")), [0, 0])

    let balancerPoolTokenBalanceAfter = BNify(await this.crp.balanceOf.call(instance.address));
    expect(balancerPoolTokenBalanceAfter).to.be.bignumber.that.is.equal(balancerPoolTokenBalanceBefore.div(BNify("2")))

    let idleBalanceWithdrawn = await this.mockIDLE.balanceOf.call(this.nonZeroAddress)
    let wethBalanceWithdrawn = await this.mockWETH.balanceOf.call(this.nonZeroAddress)
    
    expect(idleBalanceWithdrawn).to.be.bignumber.that.is.greaterThan(BNify('0'))
    expect(wethBalanceWithdrawn).to.be.bignumber.that.is.greaterThan(BNify('0'))
  })

  it.skip("Should withdraw arbitrary token", async function() {
    let instance = this.feeCollectorInstance

    let depositAmount = web3.utils.toWei("500")

    await this.mockDAI.transfer(instance.address, depositAmount, {from: accounts[0]}) // 500 DAI

    await instance.withdraw(this.mockDAI.address, this.nonZeroAddress, depositAmount)
    let daiBalance = await this.mockDAI.balanceOf.call(this.nonZeroAddress)

    expect(daiBalance).to.be.bignumber.equal(depositAmount)
  })

  it.skip("Should replace admin", async function() {
    let instance = this.feeCollectorInstance

    let nonZeroAddressIsAdmin = await instance.isAddressAdmin.call(this.nonZeroAddress)
    await instance.replaceAdmin(this.nonZeroAddress, {from: accounts[0]})

    let nonZeroAddressIsAdminAfter = await instance.isAddressAdmin.call(this.nonZeroAddress)
    let previousAdminRevoked = await instance.isAddressAdmin.call(accounts[0])

    expect(nonZeroAddressIsAdmin, "Address should not start off as admin").to.be.false
    expect(nonZeroAddressIsAdminAfter, "Address should be granted admin").to.be.true
    expect(previousAdminRevoked, "Previous admin should be revoked").to.be.false
  })

  it.skip("Should not be able to add duplicate deposit token", async function() {
    let instance = this.feeCollectorInstance

    await instance.registerTokenToDepositList(this.mockDAI.address)
    await expectRevert(instance.registerTokenToDepositList(this.mockDAI.address), "Already exists")

    let totalDepositTokens = await instance.getNumTokensInDepositList.call()
    expect(totalDepositTokens).to.be.bignumber.equal(BNify('1'))
  })

  it.skip("Should not add WETH as deposit token", async function() {
    let instance = this.feeCollectorInstance

    await expectRevert(instance.registerTokenToDepositList(this.mockWETH.address), "WETH not supported")
  })

  it.skip("Should not be able to add deposit tokens past limit", async function() {
    let instance = this.feeCollectorInstance

    for (let index = 0; index < 15; index++) {
      let token = await mockDAI.new()
      await instance.registerTokenToDepositList(token.address)
    }

    let token = await mockDAI.new()
    await expectRevert(instance.registerTokenToDepositList(token.address), "Too many tokens")
  })

  it.skip("Should not set invalid split ratio", async function() {
    let instance = this.feeCollectorInstance
    
    let allocation = [this.ratio_one_pecrent.mul(BNify('101')), BNify('0'), BNify('0')]
    
    
    await instance.setSmartTreasuryAddress(this.crp.address) // must set smart treasury address
    await expectRevert(instance.setSplitAllocation(allocation), "Ratio does not equal 100000")
  })
})
