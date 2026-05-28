/**
 * setup-tokens.js — Whitelist ERC-20/BEP-20 tokens on the deployed AnetSwap contract.
 *
 * Usage (after deploy):
 *   npm run setup:bsc
 *
 * Required env:
 *   DEPLOYER_PRIVATE_KEY
 *   EVM_BRIDGE_CONTRACT_BSC  (or set CONTRACT_ADDRESS env var)
 */

const hre = require("hardhat");

// Token configurations per chain (chainId → token list)
const TOKEN_CONFIGS = {
  56: [ // BNB Smart Chain mainnet
    {
      address:   "0x791055A7d52AA392eaE8De04250497f33807E46A", // ANET BEP-20 (A Network native token)
      symbol:    "ANET",
      decimals:  18,
      minAmount: "100000000000000000000",  // 100 ANET
      maxAmount: "0",                      // no cap
    },
    {
      address:   "0x55d398326f99059fF775485246999027B3197955", // USDT BEP-20
      symbol:    "USDT",
      decimals:  18,
      minAmount: "1000000000000000000",   // 1 USDT
      maxAmount: "500000000000000000000000", // 500,000 USDT
    },
    {
      address:   "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC BEP-20
      symbol:    "USDC",
      decimals:  18,
      minAmount: "1000000000000000000",
      maxAmount: "500000000000000000000000",
    },
    {
      address:   "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
      symbol:    "WBNB",
      decimals:  18,
      minAmount: "10000000000000000",   // 0.01 WBNB
      maxAmount: "0",                   // no cap
    },
    {
      address:   "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", // BUSD
      symbol:    "BUSD",
      decimals:  18,
      minAmount: "1000000000000000000",
      maxAmount: "500000000000000000000000",
    },
  ],
  97: [ // BSC testnet
    {
      address:   "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", // USDT testnet (common faucet addr)
      symbol:    "USDT",
      decimals:  18,
      minAmount: "1000000000000000000",
      maxAmount: "0",
    },
  ],
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network    = hre.network.name;
  const chainId    = hre.network.config.chainId;

  const contractAddress = process.env.CONTRACT_ADDRESS
    || process.env[`EVM_BRIDGE_CONTRACT_${network.toUpperCase()}`];

  if (!contractAddress || contractAddress === "0x") {
    throw new Error(`CONTRACT_ADDRESS or EVM_BRIDGE_CONTRACT_${network.toUpperCase()} not set.`);
  }

  console.log(`\n─── AnetSwap Token Setup ────────────────────────────────`);
  console.log(`Network : ${network} (${chainId})`);
  console.log(`Contract: ${contractAddress}`);
  console.log(`Caller  : ${deployer.address}`);

  const tokens = TOKEN_CONFIGS[chainId];
  if (!tokens || !tokens.length) {
    console.log(`No token configs defined for chainId ${chainId}. Exiting.`);
    return;
  }

  // v3.6 governance: configureToken is timelocked. Schedule now, execute after 48h.
  // TOKEN_SETUP_PHASE=schedule (default) calls scheduleConfigureToken and records ids.
  // TOKEN_SETUP_PHASE=execute reads the recorded ids and calls executeConfigureToken.
  const phase = (process.env.TOKEN_SETUP_PHASE || "schedule").toLowerCase();
  if (phase !== "schedule" && phase !== "execute") {
    throw new Error(`TOKEN_SETUP_PHASE must be 'schedule' or 'execute', got: ${phase}`);
  }

  const fs   = require("fs");
  const path = require("path");
  const stateFile = path.join(__dirname, `.token-setup-${chainId}.json`);

  const ABI = [
    "function scheduleConfigureToken(address token, bool accepted, uint256 minAmount, uint256 maxAmount, uint8 decimals, string calldata symbol) external returns (bytes32 id)",
    "function executeConfigureToken(address token, bool accepted, uint256 minAmount, uint256 maxAmount, uint8 decimals, string calldata symbol, bytes32 id) external",
    "event ChangeScheduled(bytes32 indexed id, bytes32 indexed paramKey, uint64 eta)",
  ];
  const contract = new hre.ethers.Contract(contractAddress, ABI, deployer);

  if (phase === "schedule") {
    const records = [];
    for (const token of tokens) {
      console.log(`\nScheduling ${token.symbol} (${token.address})...`);
      const tx = await contract.scheduleConfigureToken(
        token.address, true, token.minAmount, token.maxAmount, token.decimals, token.symbol
      );
      const receipt = await tx.wait();
      const iface   = new hre.ethers.Interface(ABI);
      let id;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === "ChangeScheduled") { id = parsed.args.id; break; }
        } catch (_) { /* not our event */ }
      }
      if (!id) throw new Error("ChangeScheduled event not found in receipt");
      console.log(`  ✓ scheduled ${token.symbol}. id=${id} tx=${tx.hash}`);
      records.push({ id, ...token });
    }
    fs.writeFileSync(stateFile, JSON.stringify(records, null, 2));
    console.log(`\nRecorded ${records.length} scheduled changes to ${stateFile}.`);
    console.log(`Wait 48 hours, then re-run with TOKEN_SETUP_PHASE=execute.`);
  } else {
    if (!fs.existsSync(stateFile)) {
      throw new Error(`No schedule state at ${stateFile}. Run with TOKEN_SETUP_PHASE=schedule first.`);
    }
    const records = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    for (const r of records) {
      console.log(`\nExecuting ${r.symbol} (${r.address})...`);
      const tx = await contract.executeConfigureToken(
        r.address, true, r.minAmount, r.maxAmount, r.decimals, r.symbol, r.id
      );
      await tx.wait();
      console.log(`  ✓ executed ${r.symbol}. tx=${tx.hash}`);
    }
    fs.unlinkSync(stateFile);
    console.log(`\nAll changes executed. State file removed.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
