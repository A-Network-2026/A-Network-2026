/**
 * deploy-fee-processor.js — Deploy the AnetFeeProcessor.
 *
 * Converts collected ANET fees → BNB via the PUBLIC PancakeSwap ANET/WBNB pool
 * and forwards the BNB to a fixed settlement treasury. Every conversion is
 * price-discovered and visible on-chain.
 *
 * Usage:
 *   ANET_TOKEN=0x791055A7d52AA392eaE8De04250497f33807E46A \
 *   PANCAKE_ROUTER=0x10ED43C718714eb63d5aA57B78B54704E256024E \
 *   FEE_TREASURY=0xSafe... \
 *   FEE_ADMIN=0xSafe... FEE_PAUSER=0xColdKey... FEE_OPERATOR=0xBackend... \
 *   FEE_MAX_PER_CALL=10000 FEE_MAX_SLIPPAGE_BPS=300 \
 *   npx hardhat run scripts/deploy-fee-processor.js --network bsc
 *
 * PancakeSwap V2 router (BSC mainnet): 0x10ED43C718714eb63d5aA57B78B54704E256024E
 */

const hre = require("hardhat");

function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = hre.network.name;
  const isTestnet = net.includes("testnet");

  const ANET_MAINNET = "0x791055A7d52AA392eaE8De04250497f33807E46A";
  const ANET = process.env.ANET_TOKEN || (isTestnet ? "" : ANET_MAINNET);
  if (!ANET) {
    throw new Error("ANET_TOKEN is required on testnet (point to a testnet ANET token).");
  }

  // PancakeSwap V2 router: BSC mainnet vs testnet.
  const ROUTER_MAINNET = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
  const ROUTER_TESTNET = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
  const router = process.env.PANCAKE_ROUTER || (isTestnet ? ROUTER_TESTNET : ROUTER_MAINNET);

  // Treasury defaults to the deployer for a testnet shakedown; set FEE_TREASURY
  // (a Safe) before mainnet so converted BNB lands in the right place.
  const treasury = process.env.FEE_TREASURY || deployer.address;

  const admin    = process.env.FEE_ADMIN    || deployer.address;
  const pauser   = process.env.FEE_PAUSER   || deployer.address;
  const operator = process.env.FEE_OPERATOR || deployer.address;

  const ETH = (n) => hre.ethers.parseEther(String(n));
  const maxPerCall = ETH(process.env.FEE_MAX_PER_CALL || 10000);
  const maxSlipBps = BigInt(process.env.FEE_MAX_SLIPPAGE_BPS || 300);

  console.log(`\n─── AnetFeeProcessor Deployment ──────────────────────`);
  console.log(`Network     : ${hre.network.name} (chainId ${hre.network.config.chainId})`);
  console.log(`Deployer    : ${deployer.address}`);
  console.log(`ANET token  : ${ANET}`);
  console.log(`Router      : ${router}`);
  console.log(`Treasury    : ${treasury}`);
  console.log(`Admin       : ${admin}`);
  console.log(`Pauser      : ${pauser}`);
  console.log(`Operator    : ${operator}`);
  console.log(`Max/call    : ${maxPerCall}`);
  console.log(`Max slippage: ${maxSlipBps} bps`);
  if (admin === deployer.address) console.warn("⚠  FEE_ADMIN not set — transfer to a Safe before going live.");
  if (!process.env.FEE_TREASURY) console.warn("⚠  FEE_TREASURY not set — converted BNB will go to the deployer. Set a Safe before mainnet.");
  console.log(`──────────────────────────────────────────────────────\n`);

  const Proc = await hre.ethers.getContractFactory("AnetFeeProcessor");
  const proc = await Proc.deploy(
    ANET, router, treasury, admin, pauser, operator, maxPerCall, maxSlipBps
  );
  await proc.waitForDeployment();
  const address = await proc.getAddress();
  console.log(`✓ AnetFeeProcessor deployed: ${address}`);
  console.log(`  Tx hash                  : ${proc.deploymentTransaction()?.hash}`);

  if (admin === deployer.address) {
    const bscBase  = process.env.FEE_BSC_EXPLORER || "https://bscscan.com/tx/";
    const poolInfo = process.env.FEE_POOL_INFO || "PancakeSwap V2 ANET/WBNB — converts ANET fees to BNB on the open market.";
    const tx = await proc.setTransparency(bscBase, poolInfo);
    await tx.wait();
    console.log(`✓ Transparency set (${bscBase})`);
  } else {
    console.log("ℹ Admin is external — call setTransparency(...) from the admin/Safe.");
  }

  if (process.env.VERIFY_CONTRACT === "true") {
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: [ANET, router, treasury, admin, pauser, operator, maxPerCall, maxSlipBps],
      });
      console.log("✓ Verified on explorer.");
    } catch (e) {
      console.warn("Verification failed (may already be verified):", e.message);
    }
  }

  console.log(`\nNEXT STEPS:`);
  console.log(`  1. Route protocol/bridge fees (ANET) to ${address}.`);
  console.log(`  2. Operator calls processFees(anetAmount, minBnbOut, deadline, memo) to convert.`);
  console.log(`  3. Transfer admin to the Gnosis Safe via transferAdmin/acceptAdmin.\n`);

  return address;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
