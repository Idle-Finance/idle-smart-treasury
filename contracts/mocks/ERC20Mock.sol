// SPDX-License-Identifier: MIT
pragma solidity = 0.7.5;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
  constructor(string memory _name, string memory _symbol, uint8 _decimals)
    ERC20(_name, _symbol) {
      _setupDecimals(_decimals); // explicitly set decimals
      _mint(msg.sender, 100_000 * 10**_decimals); // 100,000 tokens
  }
}
