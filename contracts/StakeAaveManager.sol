pragma solidity = 0.7.5;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./interfaces/IStakedAave.sol";
import "./interfaces/IStakeManager.sol";

contract StakeAaveManager is IStakeManager {

  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IStakedAave private StakeAeve;

  constructor (address _stakeAave) {
    StakeAeve = IStakedAave(_stakeAave);
  }

  function cooldown() external override {
    StakeAeve.cooldown();
  }

  function stakersCooldowns() external override returns (uint256) {
    return StakeAeve.stakersCooldowns(address(this));
  }

  function COOLDOWN_SECONDS() external override returns (uint256) {
    return StakeAeve.COOLDOWN_SECONDS();
  }
}