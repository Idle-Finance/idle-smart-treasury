// SPDX-License-Identifier: MIT
pragma solidity = 0.7.5;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./interfaces/IFeeCollector.sol";
import "./interfaces/IExchangeManager.sol";
import "./interfaces/IStakeManager.sol";


/**
@title Idle finance Fee collector
@author Asaf Silman
@notice Receives fees from idle strategy tokens and routes to fee treasury and smart treasury
 */
contract FeeCollector is IFeeCollector, AccessControl {
  using EnumerableSet for EnumerableSet.AddressSet;
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IExchangeManager private ExchangeManager;
  IStakeManager private StakeManager;

  address private immutable weth;

  // Need to use openzeppelin enumerableset
  EnumerableSet.AddressSet private depositTokens;

  uint256[] private allocations; // 100000 = 100%. allocation sent to beneficiaries
  address[] private beneficiaries; // Who are the beneficiaries of the fees generated from IDLE. The first beneficiary is always going to be the smart treasury

  uint128 public constant MAX_BENEFICIARIES = 5;
  uint128 public constant MIN_BENEFICIARIES = 2;
  uint256 public constant FULL_ALLOC = 100000;

  uint256 public constant MAX_NUM_FEE_TOKENS = 15; // Cap max tokens to 15
  bytes32 public constant WHITELISTED = keccak256("WHITELISTED_ROLE");

  event DepositTokens(address _depositor, uint256 _amountOut); // weth
  
  event UnstakeCooldown(address _token, uint256 _amount);


  modifier onlyAdmin {
    require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Unauthorised");
    _;
  }

  modifier onlyWhitelisted {
    require(hasRole(WHITELISTED, msg.sender), "Unauthorised");
    _;
  }

  /*
  @author Asaf Silman
  @notice Initialise the FeeCollector contract.
  @dev Sets the smartTreasury, weth address, uniswap router, and fee split allocations.
  @dev Also initialises the sender as admin, and whitelists for calling `deposit()`
  @dev At deploy time the smart treasury will not have been deployed yet.
       setSmartTreasuryAddress should be called after the treasury has been deployed.
  @param _weth The wrapped ethereum address.
  @param _feeTreasuryAddress The address of idle's fee treasury.
  @param _idleRebalancer Idle rebalancer address
  @param _multisig The multisig account to transfer ownership to after contract initialised
  @param _initialDepositTokens The initial tokens to register with the fee deposit
  @param _router the router
  */
  constructor (
    address _weth,
    address _feeTreasuryAddress,
    address _idleRebalancer,
    address _multisig,
    address[] memory _initialDepositTokens,
    address _exchangeManager,
    address _stakeManager
  ) {
    require(_weth != address(0), "WETH cannot be the 0 address");
    require(_feeTreasuryAddress != address(0), "Fee Treasury cannot be 0 address");
    require(_idleRebalancer != address(0), "Rebalancer cannot be 0 address");
    require(_multisig != address(0), "Multisig cannot be 0 address");
    require(_exchangeManager != address(0), "Exchange Manager cannot be 0 address");
    require(_stakeManager != address(0), "Stake Manager cannot be 0 address");

    require(_initialDepositTokens.length <= MAX_NUM_FEE_TOKENS);
    
    _setupRole(DEFAULT_ADMIN_ROLE, _multisig); // setup multisig as admin
    _setupRole(WHITELISTED, _multisig); // setup multisig as whitelisted address
    _setupRole(WHITELISTED, _idleRebalancer); // setup multisig as whitelisted address
    
    ExchangeManager = IExchangeManager(_exchangeManager);

    StakeManager = IStakeManager(_stakeManager);

    // configure weth address and ERC20 interface
    weth = _weth;

    allocations = new uint256[](2); // setup fee split ratio
    allocations[0] = 15000;
    allocations[1] = 5000;

    beneficiaries = new address[](2); // setup beneficiaries
    beneficiaries[0] = _feeTreasuryAddress; // setup fee treasury address
    beneficiaries[1] = _idleRebalancer; // setup fee treasury address

    address _depositToken;
    for (uint256 index = 0; index < _initialDepositTokens.length; index++) {
      _depositToken = _initialDepositTokens[index];
      require(_depositToken != address(0), "Token cannot be 0 address");
      require(_depositToken != _weth, "WETH not supported"); // There is no WETH -> WETH pool in uniswap
      require(depositTokens.contains(_depositToken) == false, "Already exists");
      ExchangeManager.approveToken(_depositToken, type(uint256).max); // max approval
      depositTokens.add(_depositToken);
    }
  }

  /*
  @author Asaf Silman
  @notice Converts all registered fee tokens to WETH and deposits to
          fee treasury and smart treasury based on split allocations.
  @dev The fees are swaped using Uniswap simple route. E.g. Token -> WETH.
   */
  function deposit(
    bool[] memory _depositTokensEnabled,
    uint256[] memory _minTokenOut,
    uint256 _minPoolAmountOut
  ) public override onlyWhitelisted {
    _deposit(_depositTokensEnabled, _minTokenOut, _minPoolAmountOut);
  }

  /*
  @author Asaf Silman
  @dev implements deposit()
   */
  function _deposit(
    bool[] memory _depositTokensEnabled,
    uint256[] memory _minTokenOut,
    uint256 _minPoolAmountOut
  ) internal {
    uint256 counter = depositTokens.length();
    require(_depositTokensEnabled.length == counter, "Invalid length");
    require(_minTokenOut.length == counter, "Invalid length");

    uint256 _currentBalance;
    IERC20 _tokenInterface;

    uint256 wethBalance;

    address[] memory path = new address[](2);
    path[1] = weth; // output will always be weth
    // iterate through all registered deposit tokens
    for (uint256 index = 0; index < counter; index++) {
      if (_depositTokensEnabled[index] == false) {continue;}

      _tokenInterface = IERC20(depositTokens.at(index));

      _currentBalance = _tokenInterface.balanceOf(address(this));

      _tokenInterface.safeTransfer(address(ExchangeManager), _currentBalance);

      // Only swap if balance > 0
      if (_currentBalance > 0) {
        // create simple route; token->WETH
        
        path[0] = address(_tokenInterface);
        
        ExchangeManager.exchange(
          address(_tokenInterface),
          _minTokenOut[index],
          address(this),
          path
        );
      }
    }

    wethBalance = IERC20(weth).balanceOf(address(this));

    if (wethBalance > 0){
      uint256[] memory feeBalances = _amountsFromAllocations(allocations, wethBalance);

      for (uint256 a_index = 0; a_index < allocations.length; a_index++){
        IERC20(weth).safeTransfer(beneficiaries[a_index], feeBalances[a_index]);
      }
    }
    emit DepositTokens(msg.sender, wethBalance);
  }
  
  function setExchangeManager(address exchangeAddress) external onlyAdmin {
    address oldExchangeManagerAddress = address(ExchangeManager);

    IExchangeManager oldExchangeManager = IExchangeManager(oldExchangeManagerAddress);

    ExchangeManager = IExchangeManager(exchangeAddress);

    address _tokenAddress;

    for (uint256 index = 0; index < depositTokens.length(); index++) {
      _tokenAddress = depositTokens.at(index);

      oldExchangeManager.removeApproveToken(_tokenAddress);

      ExchangeManager.approveToken(_tokenAddress, type(uint256).max);
    }
  }

  function startUnstakeCooldown(address _unstakeToken) external onlyAdmin {
    require(IERC20(_unstakeToken).balanceOf(address(this)) >  0, 'NO_BALANCE_IN_THIS_TOKEN');

    IERC20 unstakeToken = IERC20(_unstakeToken);

    uint256 currentBalance = unstakeToken.balanceOf(address(this));

    unstakeToken.safeTransfer(address(StakeManager), currentBalance);

    StakeManager.cooldown();

    emit UnstakeCooldown(_unstakeToken, currentBalance);
  }

  function claimStakeToken() external onlyAdmin {
    StakeManager.claimStaked();
  }

  /*
  @author Asaf Silman
  @notice Sets the split allocations of fees to send to fee beneficiaries
  @dev The split allocations must sum to 100000.
  @dev Before the split allocation is updated internally a call to `deposit()` is made
       such that all fee accrued using the previous allocations.
  @dev smartTreasury must be set for this to be called.
  @param _allocations The updated split ratio.
   */
  function setSplitAllocation(uint256[] calldata _allocations) external override  onlyAdmin {
    _depositAllTokens();

    _setSplitAllocation(_allocations);
  }

  /*
  @author Asaf Silman
  @notice Internal function to sets the split allocations of fees to send to fee beneficiaries
  @dev The split allocations must sum to 100000.
  @dev smartTreasury must be set for this to be called.
  @param _allocations The updated split ratio.
   */
  function _setSplitAllocation(uint256[] memory _allocations) internal {
    require(_allocations.length == beneficiaries.length, "Invalid length");
    
    uint256 sum=0;
    for (uint256 i=0; i<_allocations.length; i++) {
      sum = sum.add(_allocations[i]);
    }

    require(sum == FULL_ALLOC, "Ratio does not equal 100000");

    allocations = _allocations;
  }

  /*
  @author Andrea @ idle.finance
  @notice Helper function to deposit all tokens
   */
  function _depositAllTokens() internal {
    uint256 numTokens = depositTokens.length();
    bool[] memory depositTokensEnabled = new bool[](numTokens);
    uint256[] memory minTokenOut = new uint256[](numTokens);

    for (uint256 i = 0; i < numTokens; i++) {
      depositTokensEnabled[i] = true;
      minTokenOut[i] = 1;
    }

    _deposit(depositTokensEnabled, minTokenOut, 1);
  }

  /*
  @author Asaf Silman
  @notice Adds an address as a beneficiary to the idle fees
  @dev The new beneficiary will be pushed to the end of the beneficiaries array.
  The new allocations must include the new beneficiary
  @dev There is a maximum of 5 beneficiaries which can be registered with the fee collector
  @param _newBeneficiary The new beneficiary to add
  @param _newAllocation The new allocation of fees including the new beneficiary
   */
  function addBeneficiaryAddress(address _newBeneficiary, uint256[] calldata _newAllocation) external override  onlyAdmin {
    require(beneficiaries.length < MAX_BENEFICIARIES, "Max beneficiaries");
    require(_newBeneficiary!=address(0), "beneficiary cannot be 0 address");

    for (uint256 i = 0; i < beneficiaries.length; i++) {
      require(beneficiaries[i] != _newBeneficiary, "Duplicate beneficiary");
    }

    _depositAllTokens();

    beneficiaries.push(_newBeneficiary);

    _setSplitAllocation(_newAllocation);
  }

  /*
  @author Asaf Silman
  @notice removes a beneficiary at a given index.
  @notice WARNING: when using this method be very careful to note the new allocations
  The beneficiary at the LAST index, will be replaced with the beneficiary at `_index`.
  The new allocations need to reflect this updated array.

  eg.
  if beneficiaries = [a, b, c, d]
  and removeBeneficiaryAt(1, [...]) is called

  the final beneficiaries array will be
  [a, d, c]
  `_newAllocations` should be based off of this final array.

  @dev Cannot remove beneficiary past MIN_BENEFICIARIES. set to 2
  @dev Cannot replace the smart treasury beneficiary at index 0
  @param _index The index of the beneficiary to remove
  @param _newAllocation The new allocation of fees removing the beneficiary. NOTE !! The order of beneficiaries will change !!
   */
  function removeBeneficiaryAt(uint256 _index, uint256[] calldata _newAllocation) external override onlyAdmin {
    require(_index < beneficiaries.length, "Out of range");
    require(beneficiaries.length > MIN_BENEFICIARIES, "Min beneficiaries");
    
    _depositAllTokens();

    // replace beneficiary with index with final beneficiary, and call pop
    beneficiaries[_index] = beneficiaries[beneficiaries.length-1];
    beneficiaries.pop();
    
    // NOTE THE ORDER OF ALLOCATIONS
    _setSplitAllocation(_newAllocation);
  }

  /*
  @author Asaf Silman
  @notice replaces a beneficiary at a given index with a new one
  @notice a new allocation must be passed for this method
  @dev Cannot replace the smart treasury beneficiary at index 0
  @param _index The index of the beneficiary to replace
  @param _newBeneficiary The new beneficiary address
  @param _newAllocation The new allocation of fees
  */
  function replaceBeneficiaryAt(uint256 _index, address _newBeneficiary, uint256[] calldata _newAllocation) external override  onlyAdmin {
    require(_newBeneficiary!=address(0), "Beneficiary cannot be 0 address");

    for (uint256 i = 0; i < beneficiaries.length; i++) {
      require(beneficiaries[i] != _newBeneficiary, "Duplicate beneficiary");
    }

    _depositAllTokens();
    
    beneficiaries[_index] = _newBeneficiary;

    _setSplitAllocation(_newAllocation);
  }
  


  /*
  @author Asaf Silman
  @notice Gives an address the WHITELISTED role. Used for calling `deposit()`.
  @dev Can only be called by admin.
  @param _addressToAdd The address to grant the role.
   */
  function addAddressToWhiteList(address _addressToAdd) external override onlyAdmin{
    grantRole(WHITELISTED, _addressToAdd);
  }

  /*
  @author Asaf Silman
  @notice Removed an address from whitelist.
  @dev Can only be called by admin
  @param _addressToRemove The address to revoke the WHITELISTED role.
   */
  function removeAddressFromWhiteList(address _addressToRemove) external override onlyAdmin {
    revokeRole(WHITELISTED, _addressToRemove);
  }
    
  /*
  @author Asaf Silman
  @notice Registers a fee token to the fee collecter
  @dev There is a maximum of 15 fee tokens than can be registered.
  @dev WETH cannot be accepted as a fee token.
  @dev The token must be a complient ERC20 token.
  @dev The fee token is approved for the uniswap router
  @param _tokenAddress The token address to register
   */
  function registerTokenToDepositList(address _tokenAddress) external override onlyAdmin {
    require(depositTokens.length() < MAX_NUM_FEE_TOKENS, "Too many tokens");
    require(_tokenAddress != address(0), "Token cannot be 0 address");
    require(_tokenAddress != weth, "WETH not supported"); // There is no WETH -> WETH pool in uniswap
    require(depositTokens.contains(_tokenAddress) == false, "Already exists");
    ExchangeManager.approveToken(_tokenAddress, type(uint256).max);
    depositTokens.add(_tokenAddress);
  }

  /*
  @author Asaf Silman
  @notice Removed a fee token from the fee collector.
  @dev Resets uniswap approval to 0.
  @param _tokenAddress The fee token address to remove.
   */
  function removeTokenFromDepositList(address _tokenAddress) external override onlyAdmin {
    ExchangeManager.removeApproveToken(_tokenAddress);
    depositTokens.remove(_tokenAddress);
  }

  /*
  @author Asaf Silman
  @notice Withdraws a arbitrarty ERC20 token from feeCollector to an arbitrary address.
  @param _token The ERC20 token address.
  @param _toAddress The destination address.
  @param _amount The amount to transfer.
   */
  function withdraw(address _token, address _toAddress, uint256 _amount) external override onlyAdmin {
    IERC20(_token).safeTransfer(_toAddress, _amount);
  }

  /*
   * Copied from idle.finance IdleTokenGovernance.sol
   *
   * Calculate amounts from percentage allocations (100000 => 100%)
   * @author idle.finance
   * @param _allocations : token allocations percentages
   * @param total : total amount
   * @return newAmounts : array with amounts
   */
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

  /*
  @author Asaf Silman
  @notice Replaces the current admin with a new admin.
  @dev The current admin rights are revoked, and given the new address.
  @dev The caller must be admin (see onlyAdmin modifier).
  @param _newAdmin The new admin address.
   */
  function replaceAdmin(address _newAdmin) external override onlyAdmin {
    grantRole(DEFAULT_ADMIN_ROLE, _newAdmin);
    revokeRole(DEFAULT_ADMIN_ROLE, msg.sender); // caller must be admin
  }

  function getSplitAllocation() external view returns (uint256[] memory) { return (allocations); }

  function isAddressWhitelisted(address _address) external view returns (bool) {return (hasRole(WHITELISTED, _address)); }
  function isAddressAdmin(address _address) external view returns (bool) {return (hasRole(DEFAULT_ADMIN_ROLE, _address)); }

  function getBeneficiaries() external view returns (address[] memory) { return (beneficiaries); }

  function isTokenInDespositList(address _tokenAddress) external view returns (bool) {return (depositTokens.contains(_tokenAddress)); }
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
