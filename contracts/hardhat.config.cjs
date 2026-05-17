require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../pi-backend/.env" });

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
const BSCSCAN_API_KEY      = process.env.BSCSCAN_API_KEY      || "";
const ETHERSCAN_API_KEY    = process.env.ETHERSCAN_API_KEY    || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // ── BNB Smart Chain (mainnet) ─────────────────────────────────────────────
    bsc: {
      url:      "https://bsc-dataseed1.binance.org/",
      chainId:  56,
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: 3_000_000_000, // 3 gwei
    },
    // ── BNB Smart Chain (testnet) ─────────────────────────────────────────────
    bsc_testnet: {
      url:      "https://data-seed-prebsc-1-s1.binance.org:8545/",
      chainId:  97,
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: 10_000_000_000,
    },
    // ── Ethereum mainnet ──────────────────────────────────────────────────────
    eth: {
      url:      `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY || ""}`,
      chainId:  1,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    // ── Polygon ───────────────────────────────────────────────────────────────
    polygon: {
      url:      "https://polygon-rpc.com/",
      chainId:  137,
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: 50_000_000_000, // 50 gwei
    },
    // ── Base ──────────────────────────────────────────────────────────────────
    base: {
      url:      "https://mainnet.base.org/",
      chainId:  8453,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    // ── Local Hardhat node ────────────────────────────────────────────────────
    hardhat: {
      chainId: 31337,
    },
  },
  etherscan: {
    apiKey: {
      bsc:            BSCSCAN_API_KEY,
      bscTestnet:     BSCSCAN_API_KEY,
      mainnet:        ETHERSCAN_API_KEY,
      polygon:        process.env.POLYGONSCAN_API_KEY || "",
      base:           process.env.BASESCAN_API_KEY    || "",
    },
  },
  paths: {
    sources:   "./src",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};
