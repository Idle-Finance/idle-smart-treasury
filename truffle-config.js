require('dotenv').config();

const HDWalletProvider = require('@truffle/hdwallet-provider');

const rpcUrlMainnet = process.env.RPC_URL_MAINNET ?? ""
const rpcUrlKovan = process.env.RPC_URL_KOVAN ?? ""

const defaultMnemonic = "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat"
const mnemonic = process.env.MNEMONIC ?? defaultMnemonic

module.exports = {
  networks: {
    local: {
      host: "127.0.0.1",
      port: 8545,
      network_id: "*",
      skipDryRun: true
    },
    test: {
      host: "127.0.0.1",
      port: 8545,
      network_id: "*",
      skipDryRun: true
    },
    kovan: {
      provider: () => new HDWalletProvider(mnemonic, rpcUrlKovan),
      network_id: 42,
      gas: 5500000,
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true
    },
    mainnet: {
      provider: () => new HDWalletProvider(mnemonic, rpcUrlMainnet),
      network_id: 1,
      gas: 5500000,
      gasPrice: 78 * 1e9,
      confirmations: 2,
      timeoutBlocks: 500,
      skipDryRun: true
    }
  },
  mocha: {
    useColors: true,
    timeout: 0
  },
  plugins: ["solidity-coverage"],
  compilers: {
    solc: {
      version: "0.7.5",
      // docker: true,
      settings: {
       optimizer: {
         enabled: true,
         runs: 200
       }
      }
    }
  }
};
