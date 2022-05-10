pragma solidity >=0.6.0 <=0.7.5;

interface IStakeManager {
  function cooldown() external;
  function stakersCooldowns() external returns (uint256);
  function COOLDOWN_SECONDS() external returns (uint256);

}