require("@nomicfoundation/hardhat-toolbox");
// Deployer config reads ITS OWN .env in this folder. It must NOT pull from the
// backend service's env file — the backend host has no business knowing the
// mainnet deployer key.
require("dotenv").config();

// ── Key resolution ─────────────────────────────────────────────────────────
// Hard rule (Satoshi posture):
//   1. NEVER fall back to a hard-coded burner key. A missing env must FAIL,
//      never silently substitute a publicly-known private key.
//   2. Each chain gets its OWN deployer key. One chain compromise must not
//      cascade. A per-chain key falls back to DEPLOYER_PRIVATE_KEY only if
//      ALLOW_SHARED_DEPLOYER=true is set explicitly.
//   3. The well-known "0x0…01" burner is explicitly rejected.
const PLACEHOLDER_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const ALLOW_SHARED = String(process.env.ALLOW_SHARED_DEPLOYER || "")
  .toLowerCase() === "true";

function keyFor(chain) {
  const specific = process.env[`DEPLOYER_PRIVATE_KEY_${chain}`];
  const shared   = process.env.DEPLOYER_PRIVATE_KEY;
  const k = specific || (ALLOW_SHARED ? shared : undefined);
  if (!k) return undefined;                  // network unusable; that's fine
  if (k.toLowerCase() === PLACEHOLDER_KEY) {
    throw new Error(
      `Refusing to use the public burner key for ${chain}. ` +
      `Set DEPLOYER_PRIVATE_KEY_${chain} to a real key (or hardware wallet).`
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error(`DEPLOYER_PRIVATE_KEY_${chain} is not a valid 0x-prefixed 32-byte hex key`);
  }
  return [k];
}

const BSCSCAN_API_KEY   = process.env.BSCSCAN_API_KEY   || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

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
      accounts: keyFor("BSC") || [],
      gasPrice: 3_000_000_000, // 3 gwei
    },
    // ── BNB Smart Chain (testnet) ─────────────────────────────────────────────
    bsc_testnet: {
      url:      "https://data-seed-prebsc-1-s1.binance.org:8545/",
      chainId:  97,
      accounts: keyFor("BSC_TESTNET") || [],
      gasPrice: 10_000_000_000,
    },
    // ── Ethereum mainnet ──────────────────────────────────────────────────────
    eth: {
      url:      `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY || ""}`,
      chainId:  1,
      accounts: keyFor("ETH") || [],
    },
    // ── Ethereum testnet (Sepolia) ────────────────────────────────────────────
    sepolia: {
      url:      process.env.SEPOLIA_RPC_URL
                  || `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY || ""}`,
      chainId:  11155111,
      accounts: keyFor("SEPOLIA") || [],
    },
    // ── Polygon ───────────────────────────────────────────────────────────────
    polygon: {
      url:      "https://polygon-rpc.com/",
      chainId:  137,
      accounts: keyFor("POLYGON") || [],
      gasPrice: 50_000_000_000, // 50 gwei
    },
    // ── Base ──────────────────────────────────────────────────────────────────
    base: {
      url:      "https://mainnet.base.org/",
      chainId:  8453,
      accounts: keyFor("BASE") || [],
    },
    // ── Local Hardhat node ────────────────────────────────────────────────────
    hardhat: {
      chainId: 31337,
    },
  },
  // Etherscan API V2: a single unified key verifies across all supported
  // chains (BSC, ETH, Polygon, Base, ...). The legacy per-network object is
  // deprecated. Falls back to ETHERSCAN_API_KEY if BSCSCAN_API_KEY is unset.
  etherscan: {
    apiKey: BSCSCAN_API_KEY || ETHERSCAN_API_KEY,
  },
  paths: {
    sources:   "./src",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};
