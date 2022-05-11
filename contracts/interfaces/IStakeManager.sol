pragma solidity >=0.6.0 <=0.7.5;

interface IStakeManager {
  function cooldown() external;
  function COOLDOWN_SECONDS() external returns (uint256);
}