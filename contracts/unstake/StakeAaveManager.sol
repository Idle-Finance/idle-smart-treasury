pragma solidity = 0.7.5;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


import "../interfaces/IStakedAave.sol";
import "../interfaces/IStakeManager.sol";

contract StakeAaveManager is IStakeManager , Ownable {

  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IERC20 private Aave;
  IStakedAave private StkAave;

  constructor (address _aave, address _stakeAave) {
    StkAave = IStakedAave(_stakeAave);

    Aave = IERC20(_aave);
  }

  function COOLDOWN_SECONDS() external override onlyOwner returns (uint256) {
    return StkAave.COOLDOWN_SECONDS();
  }

  function claimStaked () external override onlyOwner {
    _claimStkAave();
  }

  function _claimStkAave() internal {
    uint256 _stakersCooldown = StkAave.stakersCooldowns(address(this));
      // If there is a pending cooldown:
    if (_stakersCooldown > 0) {
      uint256 _cooldownEnd = _stakersCooldown + StkAave.COOLDOWN_SECONDS();
      // If it is over
      if (_cooldownEnd < block.timestamp) {
        // If the unstake window is active
        if (block.timestamp - _cooldownEnd <= StkAave.UNSTAKE_WINDOW()) {
          // redeem stkAave AND begin new cooldown
          StkAave.redeem(address(this), type(uint256).max);

          uint256 currentBa =  Aave.balanceOf(address(this));

          Aave.transfer(msg.sender, currentBa);
        }
      } else {
        // If it is not over, do nothing
        return;
      }
    }

    // If there's no pending cooldown or we just redeem the prev locked rewards,
    // then begin a new cooldown
    if (StkAave.balanceOf(address(this)) > 0) {
      // start a new cooldown
      StkAave.cooldown();
    }
  }

  function token() external view  override returns (address) {
    return address(Aave);
  }

  function stakedToken() external view override returns (address) {
    return address(StkAave);
  }


}