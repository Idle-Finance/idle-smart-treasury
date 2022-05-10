// SPDX-License-Identifier: MIT

pragma solidity = 0.7.5;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import '@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol';

import "./interfaces/ISmartTreasuryBootstrap.sol";
import "./interfaces/BalancerInterface.sol";

import "./libraries/BalancerConstants.sol";

/*
@author Asaf Silman
@notice Smart contract for initialising the idle smart treasury
 */
contract SmartTreasuryBootstrap is ISmartTreasuryBootstrap, Ownable {
  using EnumerableSet for EnumerableSet.AddressSet;
  using SafeERC20 for IERC20;
  using SafeMath for uint256;

  address public immutable timelock;
  address public immutable feeCollectorAddress;

  address private crpaddress;

  uint256 private idlePerWeth; // internal price oracle for IDLE

  enum ContractState { DEPLOYED, SWAPPED, INITIALISED, BOOTSTRAPPED, RENOUNCED }
  ContractState private contractState;

  IBFactory private immutable balancer_bfactory;
  ICRPFactory private immutable balancer_crpfactory;

  // hardcoded as this value is the same across all networks
  // https://uniswap.org/docs/v2/smart-contracts/router02
  IUniswapV2Router02 private constant uniswapRouterV2 = IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);

  IERC20 private immutable idle;
  IERC20 private immutable weth;

  EnumerableSet.AddressSet private depositTokens;

  /*
  @author Asaf Silman
  @notice Initialises the bootstrap contract.
  @dev Configures balancer factories
  @dev Configures uniswap router
  @dev Configures IDLE and WETH token
  @param _balancerBFactory Balancer core factory
  @param _balancerBFactory Balancer configurable rights pool (CRP) factory
  @param _idle IDLE governance token address
  @param _weth WETH token address
  @param _timelock address of IDLE timelock
  @param _feeCollectorAddress address of IDLE fee collector
  @param _multisig The multisig account to transfer ownership to after contract initialised
  @param _initialDepositTokens The initial tokens to register with the fee deposit
   */
  constructor (
    address _balancerBFactory,
    address _balancerCRPFactory,
    address _idle,
    address _weth,
    address _timelock,
    address _feeCollectorAddress,
    address _multisig,
    address[] memory _initialDepositTokens
  ) {
    require(_balancerBFactory != address(0), "BFactory cannot be the 0 address");
    require(_balancerCRPFactory != address(0), "CRPFactory cannot be the 0 address");
    require(_idle != address(0), "IDLE cannot be the 0 address");
    require(_weth != address(0), "WETH cannot be the 0 address");
    require(_timelock != address(0), "Timelock cannot be the 0 address");
    require(_feeCollectorAddress != address(0), "FeeCollector cannot be the 0 address");
    require(_multisig != address(0), "Multisig cannot be 0 address");

    // initialise balancer factories
    balancer_bfactory = IBFactory(_balancerBFactory);
    balancer_crpfactory = ICRPFactory(_balancerCRPFactory);

    // configure tokens
    idle = IERC20(_idle);
    weth = IERC20(_weth);

    // configure network addresses
    timelock = _timelock;
    feeCollectorAddress = _feeCollectorAddress;

    address _depositToken;
    for (uint256 index = 0; index < _initialDepositTokens.length; index++) {
      _depositToken = _initialDepositTokens[index];
      require(_depositToken != address(_weth), "WETH fees are not supported"); // There is no WETH -> WETH pool in uniswap
      require(_depositToken != address(_idle), "IDLE fees are not supported"); // Dont swap IDLE to WETH

      IERC20(_depositToken).safeIncreaseAllowance(address(uniswapRouterV2), type(uint256).max); // max approval
      depositTokens.add(_depositToken);
    }

    transferOwnership(_multisig);
    contractState = ContractState.DEPLOYED;
  }

  /*
  @author Asaf Silman
  @notice Converts all tokens in depositToken enumerable set to WETH.
  @dev Can be called after deployment as many times an necissary.
  @dev Converts tokens using uniswap simple path. E.g. token -> WETH.
  @dev This should be called after the governance proposal has transfered funds to bootstrapping address
  @dev After this has been called, `swap()` should be called.
  @param minTokenOut Array of minimum tokens to recieve from swap
   */
  function swap(uint256[] calldata minTokenOut) external override onlyOwner {
    require(contractState==ContractState.DEPLOYED || contractState==ContractState.SWAPPED, "Invalid state");
    uint256 counter = depositTokens.length();

    require(minTokenOut.length == counter, "Invalid length");

    address[] memory path = new address[](2);
    path[1] = address(weth);

    address _tokenAddress;
    IERC20 _tokenInterface;
    uint256 _currentBalance;

    for (uint256 index = 0; index < counter; index++) {
      _tokenAddress = depositTokens.at(index);
      _tokenInterface = IERC20(_tokenAddress);

      _currentBalance = _tokenInterface.balanceOf(address(this));

      path[0] = _tokenAddress;
      
      uniswapRouterV2.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        _currentBalance,
        minTokenOut[index],
        path,
        address(this),
        block.timestamp.add(1800)
      );
    }

    contractState = ContractState.SWAPPED;
  }

  /*
  @author Asaf Silman
  @notice Initialises the smart treasury with bootstrapping parameters
  @notice Calculated initial weights based on total value of IDLE and WETH.
  @dev This function should be called after all fees have been swapped, by calling `swap()`
  @dev After this has been called, `bootstrap()` should be called.
   */
  function initialise() external override onlyOwner {
    require(contractState == ContractState.SWAPPED, "Invalid State");
    require(crpaddress==address(0), "Cannot initialise if CRP already exists");
    require(idlePerWeth!=0, "IDLE price not set");
    
    uint256 idleBalance = idle.balanceOf(address(this));
    uint256 wethBalance = weth.balanceOf(address(this));

    // hard-coded minimums of atleast 100 IDLE and 1 WETH
    require(idleBalance > uint256(100).mul(10**18), "Cannot initialise without idle in contract");
    require(wethBalance > uint256(1).mul(10**18), "Cannot initialise without weth in contract");

    address[] memory tokens = new address[](2);
    tokens[0] = address(idle);
    tokens[1] = address(weth);

    uint256[] memory balances = new uint256[](2);
    balances[0] = idleBalance;
    balances[1] = wethBalance;

    
    uint256 idleValueInWeth = balances[0].mul(10**18).div(idlePerWeth);
    uint256 wethValue = balances[1];

    uint256 totalValueInPool = idleValueInWeth.add(wethValue); // expressed in WETH

    uint256[] memory weights = new uint256[](2);
    weights[0] = idleValueInWeth.mul(BalancerConstants.BONE * 25).div(totalValueInPool); // IDLE value / total value
    weights[1] = wethValue.mul(BalancerConstants.BONE * 25).div(totalValueInPool); // WETH value / total value

    require(weights[0] >= BalancerConstants.BONE  && weights[0] <= BalancerConstants.BONE.mul(24), "Invalid weights");

    ICRPFactory.PoolParams memory params = ICRPFactory.PoolParams({
      poolTokenSymbol: "ISTT",
      poolTokenName: "Idle Smart Treasury Token",
      constituentTokens: tokens,
      tokenBalances: balances,
      tokenWeights: weights,
      swapFee: 5 * 10**15 // .5% fee = 5000000000000000
    });

    ICRPFactory.Rights memory rights = ICRPFactory.Rights({
      canPauseSwapping:   true,
      canChangeSwapFee:   true,
      canChangeWeights:   true,
      canAddRemoveTokens: true,
      canWhitelistLPs:    true,
      canChangeCap:       false
    });
    
    /*** DEPLOY POOL ****/

    ConfigurableRightsPool crp = balancer_crpfactory.newCrp(
      address(balancer_bfactory),
      params,
      rights
    );

    // A balancer pool with canWhitelistLPs does not initially whitelist the controller
    // This must be manually set
    crp.whitelistLiquidityProvider(address(this));
    crp.whitelistLiquidityProvider(timelock);
    crp.whitelistLiquidityProvider(feeCollectorAddress);

    crpaddress = address(crp);

    idle.safeIncreaseAllowance(crpaddress, balances[0]); // approve transfer of idle
    weth.safeIncreaseAllowance(crpaddress, balances[1]); // approve transfer of idle

    contractState = ContractState.INITIALISED;
  }

  /*
  @author Asaf Silman
  @notice Creates the smart treasury, pulls underlying funds, and mints 1000 liquidity tokens
  @notice calls updateWeightsGradually to being updating the token weights to the desired initial distribution.
  @dev Can only be called after initialise has been called
   */
  function bootstrap() external override onlyOwner {
    require(contractState == ContractState.INITIALISED, "Invalid State");
    require(crpaddress!=address(0), "Cannot bootstrap if CRP does not exist");
    
    ConfigurableRightsPool crp = ConfigurableRightsPool(crpaddress);

    /*** CREATE POOL ****/
    crp.createPool(
      1000 * 10 ** 18, // mint 1000 shares
      3 days, // minimumWeightChangeBlockPeriodParam
      3 days  // addTokenTimeLockInBlocksParam
    );

    uint256[] memory finalWeights = new uint256[](2);
    finalWeights[0] = BalancerConstants.BONE.mul(225).div(10); // 90 %
    finalWeights[1] = BalancerConstants.BONE.mul(25).div(10); // 10 %

    /*** CALL GRADUAL POOL WEIGHT UPDATE ****/

    crp.updateWeightsGradually(
      finalWeights,
      block.timestamp,
      block.timestamp.add(30 days)  // ~ 1 months
    );

    contractState = ContractState.BOOTSTRAPPED;
  }

  /*
  @author Asaf Silman
  @notice Renounces ownership of the smart treasury from this contract to idle governance
  @notice Transfers balancer liquidity tokens to fee collector
   */
  function renounce() external override onlyOwner {
    require(contractState == ContractState.BOOTSTRAPPED, "Invalid State");
    require(crpaddress != address(0), "Cannot renounce if CRP does not exist");

    ConfigurableRightsPool crp = ConfigurableRightsPool(crpaddress);
    
    require(address(crp.bPool()) != address(0), "Cannot renounce if bPool does not exist");

    crp.removeWhitelistedLiquidityProvider(address(this));
    crp.setController(timelock);

    // transfer using safe transfer
    IERC20(crpaddress).safeTransfer(feeCollectorAddress, crp.balanceOf(address(this)));
    
    contractState = ContractState.RENOUNCED;
  }

  /*
  @author Asaf Silman
  @notice Withdraws a arbitrarty ERC20 token from this contract to an arbitrary address.
  @param _token The ERC20 token address.
  @param _toAddress The destination address.
  @param _amount The amount to transfer.
   */
  function withdraw(address _token, address _toAddress, uint256 _amount) external {
    require((msg.sender == owner() && contractState == ContractState.RENOUNCED) || msg.sender == timelock, "Only admin");

    IERC20 token = IERC20(_token);
    token.safeTransfer(_toAddress, _amount);
  }

  /*
  @author Asaf Silman
  @notice Set idle price per weth. Used for setting initial weights of smart treasury
  @dev expressed in Wei
  @param _idlePerWeth idle price per weth expressed in Wei
   */
  function setIDLEPrice(uint256 _idlePerWeth) external onlyOwner {
    idlePerWeth = _idlePerWeth;
  }

  /*
  @author Asaf Silman
  @notice Registers a fee token to depositTokens for swapping to WETH
  @dev All fee tokens from fee treasury should be added in this manor
  @param _tokenAddress Token address to register with bootstrap contract
   */
  function registerTokenToDepositList(address _tokenAddress) public onlyOwner {
    require(_tokenAddress != address(weth), "WETH fees are not supported"); // There is no WETH -> WETH pool in uniswap
    require(_tokenAddress != address(idle), "IDLE fees are not supported"); // Dont swap IDLE to WETH

    IERC20(_tokenAddress).safeIncreaseAllowance(address(uniswapRouterV2), type(uint256).max); // max approval
    depositTokens.add(_tokenAddress);
  }

  /*
  @author Asaf Silman
  @notice Removes a fee token depositTokens
  @param _tokenAddress Token address to remove
   */
  function removeTokenFromDepositList(address _tokenAddress) external onlyOwner {
    IERC20(_tokenAddress).safeApprove(address(uniswapRouterV2), 0); // 0 approval for uniswap
    depositTokens.remove(_tokenAddress);
  }

  function getState() external view returns (ContractState) {return contractState; }
  function getIDLEperWETH() external view returns (uint256) {return idlePerWeth; }
  function getCRPAddress() external view returns (address) { return crpaddress; }
  function getCRPBPoolAddress() external view returns (address) {
    require(crpaddress!=address(0), "CRP is not configured yet");
    return address(ConfigurableRightsPool(crpaddress).bPool());
  }
  function tokenInDepositList(address _tokenAddress) external view returns (bool) {return depositTokens.contains(_tokenAddress);}
  function getDepositTokens() external view returns (address[] memory) {
    uint256 numTokens = depositTokens.length();

    address[] memory depositTokenList = new address[](numTokens);
    for (uint256 index = 0; index < numTokens; index++) {
      depositTokenList[index] = depositTokens.at(index);
    }
    return (depositTokenList);
  }
}
