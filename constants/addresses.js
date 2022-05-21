const addresses = {
  mainnet: {
    uniswapFactory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    uniswapRouterAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // https://uniswap.org/docs/v2/smart-contracts/router02
    stakeAave: '0x4da27a545c0c5B758a6BA100e3a049001de870f5', 

    positionManagerAddress:"0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    uniswapV3FactoryAddress:'0x1F98431c8aD98523631AE4a59f267346ea31F984',
    swapRouter:"0xE592427A0AEce92De3Edee1F18E0157C05861564",
    quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    // development addresses
    weth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // https://etherscan.io/token/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
    dai: '0x6b175474e89094c44da98b954eedeac495271d0f', // https://etherscan.io/token/0x6b175474e89094c44da98b954eedeac495271d0f
    idle: '0x875773784Af8135eA0ef43b5a374AaD105c5D39e', // https://developers.idle.finance/contracts-and-codebase
    aave: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',  // https://etherscan.io/token/0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9 
    // idle contracts
    feeTreasuryAddress: '0x69a62C24F16d4914a48919613e8eE330641Bcb94', // https://developers.idle.finance/contracts-and-codebase
    ecosystemFund: '0xb0aA1f98523Ec15932dd5fAAC5d86e57115571C7',
    timelock: '0xD6dABBc2b275114a2366555d6C481EF08FDC2556', // timelock address
    governor: '0x2256b25CFC8E35c3135664FD03E77595042fe31B',

    // fee tokens
    feeTokens: [
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // wbtc
      '0x0000000000085d4780B73119b644AE5ecd22b376', // tusd
      '0x57ab1ec28d129707052df4df418d58a2d46d5f51', // susd
      '0x6b175474e89094c44da98b954eedeac495271d0f', // dai
      '0xdac17f958d2ee523a2206206994597c13d831ec7', // tusd
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // usdc
      '0xc00e94cb662c3520282e6f5717214004a7f26888'  // comp
    ],

    idleTokens: [
      "0x3fE7940616e5Bc47b0775a0dccf6237893353bB4", // IdleDAI Best Yield
      "0x5274891bEC421B39D23760c04A6755eCB444797C", // IdleUSDC Best Yield
      "0xF34842d05A1c888Ca02769A633DF37177415C2f8", // IdleUSDT Best Yield
      "0xf52cdcd458bf455aed77751743180ec4a595fd3f", // IdleSUSD Best Yield
      "0xc278041fDD8249FE4c1Aad1193876857EEa3D68c", // IdleTUSD Best Yield
      "0x8C81121B15197fA0eEaEE1DC75533419DcfD3151", // IdleWBTC Best Yield
      "0xa14eA0E11121e6E951E87c66AFe460A00BCD6A16", // IdleDAI Risk Adjusted
      "0x3391bc034f2935ef0e1e41619445f998b2680d35", // IdleUSDC Risk Adjusted
      "0x28fAc5334C9f7262b3A3Fe707e250E01053e07b5" // IdleUSDT Risk Adjusted
    ],

    multisig: "0xe8eA8bAE250028a8709A3841E0Ae1a44820d677b",

    idleRebalancer: "0xb3c8e5534f0063545cbbb7ce86854bf42db8872b",

    _founder: "0x3675D2A334f17bCD4689533b7Af263D48D96eC72",
    _vesterFactory: "0xbF875f2C6e4Cc1688dfe4ECf79583193B6089972"
  },
  kovan: {
    uniswapFactory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    uniswapRouterAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // https://uniswap.org/docs/v2/smart-contracts/router02,

    weth: '0xd0a1e359811322d97991e03f863a0c30c2cf029c',
    dai: '0x4F96Fe3b7A6Cf9725f59d353F723c1bDb64CA6Aa',
    idle: '0xAB6Bdb5CCF38ECDa7A92d04E86f7c53Eb72833dF',

    feeTreasuryAddress: '0x69a62C24F16d4914a48919613e8eE330641Bcb94',
    ecosystemFund: '0xb0aA1f98523Ec15932dd5fAAC5d86e57115571C7',
    timelock: '0xfD88D7E737a06Aa9c62B950C1cB5eE63DA379AFd',
    governor: '0x782cB1dbd0bD4df95c2497819be3984EeA5c2c25',

    multisig: "0x33d3C1cbeaf31519495894f8655B6f9005fD44dA",

    feeTokens: [
      '0x4F96Fe3b7A6Cf9725f59d353F723c1bDb64CA6Aa' // DAI
    ]
  },

  rinkeby: {
    uniswapFactory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    uniswapRouterAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',

    weth: '0xc778417e063141139fce010982780140aa0cd5ab',
    dai: '0x569aaff8f90a5e48b27c154249ee5a08ed0c44e2',
    idle: '0x20b6a30ab799a62c6538f84d1c58c711870ad75b',

    feeTreasuryAddress: '0x69a62C24F16d4914a48919613e8eE330641Bcb94', // test
    idleRebalancer: "0xb3c8e5534f0063545cbbb7ce86854bf42db8872b",

    multisig: "0x330bE2478E07C927b99980a444a511787c2d6F1a", // test multisig

    feeTokens: [
      '0x569aaff8f90a5e48b27c154249ee5a08ed0c44e2', // dai
    ]
  }
};

addresses['development'] = addresses.mainnet
addresses['development-fork'] = addresses.mainnet
addresses['soliditycoverage'] = addresses.mainnet
addresses['local'] = addresses.mainnet

module.exports = addresses;
