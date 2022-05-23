// SPDX-License-Identifier: MIT
pragma solidity = 0.7.5;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/EnumerableSetUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "./interfaces/IExchange.sol";
import "./interfaces/IStakeManager.sol";

contract FeeCollector is Initializable, AccessControlUpgradeable {

  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
  using SafeMathUpgradeable for uint256;
  using SafeERC20Upgradeable for IERC20Upgradeable;

  IExchange[] private ExchangeManagers;
  IStakeManager[] private StakeManagers;
  IERC20Upgradeable private Weth;
  EnumerableSetUpgradeable.AddressSet private depositTokens;

  uint256[] private allocations; // 100000 = 100%
  address[] private beneficiaries;

  mapping (address => bool) private beneficiariesExists;
  mapping (address => bool) private depositTokensExists;
  mapping (address => bool) private exchangeManagerExists;
  mapping (address => bool) private stakeManagerExists;

  uint128 public constant MAX_BENEFICIARIES = 5;
  uint128 public constant MIN_BENEFICIARIES = 1;
  uint256 public constant FULL_ALLOC = 100000;
  uint256 public constant MAX_NUM_FEE_TOKENS = 15;
  bytes32 public constant WHITELISTED = keccak256("WHITELISTED_ROLE");

  event DepositTokens(address _depositor, uint256 _amountOut);

	// initializes exchange and skake managers
	// total beneficiaries' allocation should be 100%
  function initialize(
    address _weth,
    address[] memory _beneficiaries,
    uint256[] memory _allocations,
    address[] memory _initialDepositTokens,
    address[] memory _exchangeManagers,
    address[] memory _stakeManagers
  ) initializer public {
    require(_weth != address(0), "WETH cannot be the 0 address");
    Weth = IERC20Upgradeable(_weth);
    
    // get managers
    _setExchangeManagers(_exchangeManagers);
    _setStakeManagers(_stakeManagers);

    // setup access control
    __AccessControl_init();
    _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    _setupRole(WHITELISTED, msg.sender);
    
    // setup beneficiaries and deposit tokens
    _setBeneficiaries(_beneficiaries, _allocations);
    _setDepositTokens(_initialDepositTokens);

  }

  // converts all registered fee tokens to WETH and deposits to
  // beneficiaries' based on split allocations
  function deposit(
    bool[] memory _depositTokensEnabled,
    uint256[] memory _minTokenOut
  ) public onlyWhitelisted {
    _deposit(_depositTokensEnabled, _minTokenOut);
  }
  
	// cannot set an existing exchange manager
	// also approve the exchange manager to use all deposit tokens
  function addExchangeManager(address exchangeAddress) external onlyAdmin {
    
    require(exchangeManagerExists[exchangeAddress] == false, "Duplicate exchange manager");
    require(exchangeAddress != address(0), "Exchange Manager cannot be 0 address");
    
    IExchange exchange = IExchange(exchangeAddress);
    ExchangeManagers.push(exchange);
    exchangeManagerExists[exchangeAddress] = true;

    address _tokenAddress;
    for (uint256 index = 0; index < depositTokens.length(); index++) {
      _tokenAddress = depositTokens.at(index);
      exchange.approveToken(_tokenAddress, type(uint256).max);
    }
  }

	// replaces the last exchange manager with the one on the given index
	// also removes exchange manager approval of deposit tokens
  function removeExchangeManager(uint256 _index) external onlyAdmin {

    IExchange exchange = ExchangeManagers[_index];
    exchangeManagerExists[address(exchange)] = false;

    ExchangeManagers[_index] = ExchangeManagers[ExchangeManagers.length-1];
    ExchangeManagers.pop();

    address _tokenAddress;
    for (uint256 index = 0; index < depositTokens.length(); index++) {
      _tokenAddress = depositTokens.at(index);
      exchange.removeApproveToken(_tokenAddress);
    }
  }

	// cannot set an existing stake manager
  function addStakeManager(address stakeAddress) external onlyAdmin {
    require(stakeManagerExists[stakeAddress] == false, "Duplicate stake manager");
    require(stakeAddress != address(0), "Steke Manager cannot be 0 address");
    
    IStakeManager stake = IStakeManager(stakeAddress);
    StakeManagers.push(stake);
    stakeManagerExists[stakeAddress] = true;
  }

	// replaces the last stake manager with the one on the given index
  function removeStakeManager(uint256 _index) external onlyAdmin {
    IStakeManager stake = StakeManagers[_index];
    stakeManagerExists[address(stake)] = false;

    StakeManagers[_index] = StakeManagers[StakeManagers.length-1];
    StakeManagers.pop();
  }

	// find the respective stake manager for each unstake token
	// and unstakes / starts cooldown for that token
  function claimStakedToken(address[] memory _unstakeTokens) external onlyAdmin {

    IERC20Upgradeable unstakeToken;
    uint256 currentBalance;

    for (uint256 i=0; i < StakeManagers.length; i++) {
      for (uint256 y=0; y < _unstakeTokens.length; y++) {
        if (StakeManagers[i].stakedToken() == _unstakeTokens[y]) {
          unstakeToken = IERC20Upgradeable(_unstakeTokens[y]);
          currentBalance = unstakeToken.balanceOf(address(this));

          if (currentBalance > 0) {
            unstakeToken.safeTransfer(address(StakeManagers[0]), currentBalance);
          }
          StakeManagers[0].claimStaked();
          break;
        }
      }
    }

  }

	// before the split allocation is updated internally a call to `deposit()` is made
  // such that all fee accrued using the previous allocations.
  // the split allocations must sum to 100000.
  function setSplitAllocation(uint256[] calldata _allocations) external onlyAdmin {
    _depositAllTokens();

    _setSplitAllocation(_allocations);
  }

  // the new allocations must include the new beneficiary
  // there's also a maximum of 5 beneficiaries
  function addBeneficiaryAddress(address _newBeneficiary, uint256[] calldata _newAllocation) external onlyAdmin {
    require(beneficiaries.length < MAX_BENEFICIARIES, "Max beneficiaries");
    require(_newBeneficiary!=address(0), "beneficiary cannot be 0 address");

    require(beneficiariesExists[_newBeneficiary] == false, "Duplicate beneficiary");
    beneficiariesExists[_newBeneficiary] = true;

    _depositAllTokens();

    beneficiaries.push(_newBeneficiary);

    _setSplitAllocation(_newAllocation);
  }

  // the beneficiary at the last index, will be replaced with the beneficiary at a given index
  function removeBeneficiaryAt(uint256 _index, uint256[] calldata _newAllocation) external onlyAdmin {
    require(_index < beneficiaries.length, "Out of range");
    require(beneficiaries.length > MIN_BENEFICIARIES, "Min beneficiaries");
    
    _depositAllTokens();

    beneficiaries[_index] = beneficiaries[beneficiaries.length-1];
    beneficiaries.pop();

    beneficiariesExists[beneficiaries[_index]] = false;
    
    _setSplitAllocation(_newAllocation);
  }

	// this is used for calling deposit at the momemnt
  function addAddressToWhiteList(address _addressToAdd) external onlyAdmin{
    grantRole(WHITELISTED, _addressToAdd);
  }

  function removeAddressFromWhiteList(address _addressToRemove) external onlyAdmin {
    revokeRole(WHITELISTED, _addressToRemove);
  }
  
  // respects the of 15 fee tokens than can be registered
  // WETH cannot be accepted as a fee token
  // the fee token is approved for the uniswap router
  function registerTokenToDepositList(address _tokenAddress) external onlyAdmin {
    require(depositTokens.length() < MAX_NUM_FEE_TOKENS, "Too many tokens");
    require(_tokenAddress != address(0), "Token cannot be 0 address");
    require(_tokenAddress != address(Weth), "WETH not supported"); // as there is no WETH to WETH pool in some exchanges
    require(depositTokensExists[_tokenAddress] == false, "Duplicate deposit token");
    depositTokensExists[_tokenAddress] = true;
    for (uint256 index = 0; index < ExchangeManagers.length; index++) {
      ExchangeManagers[index].approveToken(_tokenAddress, type(uint256).max);
    }
    depositTokens.add(_tokenAddress);
  }

  // also resets uniswap approval
  function removeTokenFromDepositList(address _tokenAddress) external onlyAdmin {
    for (uint256 index = 0; index < ExchangeManagers.length; index++) {
      ExchangeManagers[index].removeApproveToken(_tokenAddress);
    }
    depositTokens.remove(_tokenAddress);
    depositTokensExists[_tokenAddress] = false;
  }

	// moves a specific token to a given address for a given amount
  function withdraw(address _token, address _toAddress, uint256 _amount) external onlyAdmin {
    IERC20Upgradeable(_token).safeTransfer(_toAddress, _amount);
  }

	// there can only be one admin
	// this is different from the proxy admin of the contract
  function replaceAdmin(address _newAdmin) external onlyAdmin {
    grantRole(DEFAULT_ADMIN_ROLE, _newAdmin);
    revokeRole(DEFAULT_ADMIN_ROLE, msg.sender); 
  }

	/***********************/
	/*****  INTERNAL   *****/
	/***********************/

	function _setStakeManagers(address[] memory _stakeManagers) internal {
    for (uint256 index = 0; index < _stakeManagers.length; index++) {
      require(stakeManagerExists[_stakeManagers[index]] == false, "Duplicate stake manager");
      require(_stakeManagers[index] != address(0), "Stake Manager cannot be 0 address");
      stakeManagerExists[_stakeManagers[index]] = true;
      StakeManagers.push(IStakeManager(_stakeManagers[index]));
    }
  }

  function _setExchangeManagers(address[] memory _exchangeManagers) internal {
    for (uint256 index = 0; index < _exchangeManagers.length; index++) {
      require(exchangeManagerExists[_exchangeManagers[index]] == false, "Duplicate exchange manager");
      require(_exchangeManagers[index] != address(0), "Exchange Manager cannot be 0 address");
      exchangeManagerExists[_exchangeManagers[index]] = true; 
      ExchangeManagers.push(IExchange(_exchangeManagers[index]));
    }
  }

  function _setBeneficiaries(address[] memory _beneficiaries, uint256[] memory _allocations) internal {
    require(_beneficiaries.length == _allocations.length, "Allocations length != beneficiaries length");
    require(_beneficiaries.length <= MAX_BENEFICIARIES);

    uint256 totalAllocation = 0;
    for (uint256 index = 0; index < _beneficiaries.length; index++) {
      require(beneficiariesExists[_beneficiaries[index]] == false, "Duplicate beneficiary");
      require(_beneficiaries[index] != address(0), "Beneficiary cannot be 0 address");
      beneficiaries.push(_beneficiaries[index]);
      allocations.push(_allocations[index]);
      totalAllocation = totalAllocation.add(_allocations[index]);
      beneficiariesExists[_beneficiaries[index]] = true;
    }
    require(totalAllocation == FULL_ALLOC, "Ratio does not equal 100000");
  }

  function _setDepositTokens(address[] memory _initialDepositTokens) internal {
    require(_initialDepositTokens.length <= MAX_NUM_FEE_TOKENS);

    address _depositToken;
    for (uint256 index = 0; index < _initialDepositTokens.length; index++) {
      _depositToken = _initialDepositTokens[index];
      require(_depositToken != address(0), "Token cannot be 0 address");
      require(_depositToken != address(Weth), "WETH not supported");
      require(depositTokensExists[_depositToken] == false, "Duplicate deposit token");
      depositTokensExists[_depositToken] = true;
      for (uint256 y = 0; y < ExchangeManagers.length; y++) {
        ExchangeManagers[y].approveToken(_depositToken, type(uint256).max);
      }
      depositTokens.add(_depositToken);
    }
  }

	function _deposit(
    bool[] memory _depositTokensEnabled,
    uint256[] memory _minTokenOut
  ) internal {
    uint256 counter = depositTokens.length();
    require(_depositTokensEnabled.length == counter, "Invalid length");
    require(_minTokenOut.length == counter, "Invalid length");

    uint256 _currentBalance;
    IERC20Upgradeable _tokenInterface;

    uint256 wethBalance;

    address[] memory path = new address[](2);
    path[1] = address(Weth);


    for (uint256 index = 0; index < counter; index++) {
      if (_depositTokensEnabled[index] == false) {continue;}

      _tokenInterface = IERC20Upgradeable(depositTokens.at(index));

      _currentBalance = _tokenInterface.balanceOf(address(this));

      uint256 _maxAmountOut = 0;
      uint256 _exchangeManagerIndex;
      uint256 _currentAmountOut;
      bytes memory _amountOutData;

      for (uint256 y = 0; y < ExchangeManagers.length; y++) {
        (_currentAmountOut, _amountOutData) = ExchangeManagers[y].getAmoutOut(address(_tokenInterface), address(Weth), _currentBalance);
        if (_currentAmountOut > _maxAmountOut) {
          _maxAmountOut = _currentAmountOut;
          _exchangeManagerIndex = y;
        }
      }
      

      if (_currentBalance > 0) {
        _tokenInterface.safeTransfer(address(ExchangeManagers[_exchangeManagerIndex]), _currentBalance);

        path[0] = address(_tokenInterface);

        ExchangeManagers[_exchangeManagerIndex].exchange(
          address(_tokenInterface),
          _minTokenOut[index],
          address(this),
          path,
          _amountOutData
        );
      }
    }

    wethBalance = Weth.balanceOf(address(this));

    if (wethBalance > 0){
      uint256[] memory feeBalances = _amountsFromAllocations(allocations, wethBalance);

      for (uint256 a_index = 0; a_index < allocations.length; a_index++){
        Weth.safeTransfer(beneficiaries[a_index], feeBalances[a_index]);
      }
    }
    emit DepositTokens(msg.sender, wethBalance);
  }

  function _setSplitAllocation(uint256[] memory _allocations) internal {
    require(_allocations.length == beneficiaries.length, "Invalid length");
    
    uint256 sum=0;
    for (uint256 i=0; i<_allocations.length; i++) {
      sum = sum.add(_allocations[i]);
    }

    require(sum == FULL_ALLOC, "Ratio does not equal 100000");

    allocations = _allocations;
  }
	
  function _depositAllTokens() internal {
    uint256 numTokens = depositTokens.length();
    bool[] memory depositTokensEnabled = new bool[](numTokens);
    uint256[] memory minTokenOut = new uint256[](numTokens);

    for (uint256 i = 0; i < numTokens; i++) {
      depositTokensEnabled[i] = true;
      minTokenOut[i] = 1;
    }

    _deposit(depositTokensEnabled, minTokenOut);
  }

  function _amountsFromAllocations(uint256[] memory _allocations, uint256 total) internal pure returns (uint256[] memory newAmounts) {
    newAmounts = new uint256[](_allocations.length);
    uint256 currBalance;
    uint256 allocatedBalance;

    for (uint256 i = 0; i < _allocations.length; i++) {
      if (i == _allocations.length - 1) {
        newAmounts[i] = total.sub(allocatedBalance);
      } else {
        currBalance = total.mul(_allocations[i]).div(FULL_ALLOC);
        allocatedBalance = allocatedBalance.add(currBalance);
        newAmounts[i] = currBalance;
      }
    }
    return newAmounts;
  }


	/***********************/
	/*****  MODIFIERS  *****/
	/***********************/

  modifier onlyAdmin {
    require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Unauthorised: Not admin");
    _;
  }

  modifier onlyWhitelisted {
    require(hasRole(WHITELISTED, msg.sender), "Unauthorised: Not whitelisted");
    _;
  }


	/***********************/
	/*****  VIEWS      *****/
	/***********************/

  function getSplitAllocation() external view returns (uint256[] memory) { return (allocations); }

  function isAddressWhitelisted(address _address) external view returns (bool) {return (hasRole(WHITELISTED, _address)); }
  function isAddressAdmin(address _address) external view returns (bool) {return (hasRole(DEFAULT_ADMIN_ROLE, _address)); }

  function getBeneficiaries() external view returns (address[] memory) { return (beneficiaries); }

  function isTokenInDespositList(address _tokenAddress) external view returns (bool) {return depositTokensExists[_tokenAddress]; }
  function getNumTokensInDepositList() external view returns (uint256) {return (depositTokens.length());}

  function getDepositTokens() external view returns (address[] memory) {
    uint256 numTokens = depositTokens.length();

    address[] memory depositTokenList = new address[](numTokens);
    for (uint256 index = 0; index < numTokens; index++) {
      depositTokenList[index] = depositTokens.at(index);
    }
    return (depositTokenList);
  }
}