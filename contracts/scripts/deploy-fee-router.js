/**
 * deploy-fee-router.js — Deploy the AnetFeeRouter (non-custodial atomic fee-on-top swap forwarder).
 *
 * The router takes the interface fee from the swap INPUT and pays it to the fixed
 * treasury in the same transaction as the public-DEX swap. It has no owner, no
 * pause and no setters: to change anything, deploy a new instance and update
 * `FEE_ROUTER` in assets/js/dex-onchain.js.
 *
 * Usage (fee = 875 / 100_000 = 0.875 %):
 *   FEE_ROUTER_TREASURY=0x9C7C1058fdc9b710f688ECb7562924D9AE771417 \
 *   FEE_ROUTER_NUMERATOR=875 \
 *   npx hardhat run scripts/deploy-fee-router.js --network bsc
 *
 * Optional:
 *   DEX_ROUTER=0x...   override the underlying V2 router (defaults below per chain)
 *
 * Underlying V2 routers:
 *   BSC mainnet     PancakeSwap V2  0x10ED43C718714eb63d5aA57B78B54704E256024E
 *   BSC testnet     PancakeSwap V2  0xD99D1c33F9fC3444f8101754aBC46c52416550D1
 *   Ethereum        Uniswap V2      0x7a250d5630B4cF539739dF2C5dACb4c659F2488D
 *   Sepolia         Uniswap V2      0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3
 */

const hre = require("hardhat");

const DEFAULT_TREASURY = "0x9C7C1058fdc9b710f688ECb7562924D9AE771417"; // EVM Reserve Treasury
const DEFAULT_FEE_NUMERATOR = 875n;                                     // 0.875 %
const FEE_DENOMINATOR = 100_000n;

const V2_ROUTERS = {
  56:       "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  97:       "0xD99D1c33F9fC3444f8101754aBC46c52416550D1",
  1:        "0x7a250d5630B4cF539739dF2C5dACb4c659F2488D",
  11155111: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = hre.network.config.chainId;

  const dexRouter = process.env.DEX_ROUTER || V2_ROUTERS[chainId];
  if (!dexRouter) throw new Error(`No default V2 router for chainId ${chainId}; set DEX_ROUTER.`);

  const treasury = process.env.FEE_ROUTER_TREASURY || DEFAULT_TREASURY;
  if (!hre.ethers.isAddress(treasury)) throw new Error("FEE_ROUTER_TREASURY is not a valid address");

  const feeNumerator = BigInt(process.env.FEE_ROUTER_NUMERATOR || DEFAULT_FEE_NUMERATOR);
  if (feeNumerator > 3_000n) throw new Error("FEE_ROUTER_NUMERATOR above the 3% hard cap (3000)");

  const feePct = (Number(feeNumerator) * 100) / Number(FEE_DENOMINATOR);

  console.log(`\n─── AnetFeeRouter Deployment ─────────────────────────`);
  console.log(`Network     : ${hre.network.name} (chainId ${chainId})`);
  console.log(`Deployer    : ${deployer.address}`);
  console.log(`DEX router  : ${dexRouter}`);
  console.log(`Treasury    : ${treasury}${process.env.FEE_ROUTER_TREASURY ? "" : "  (default EVM Reserve Treasury)"}`);
  console.log(`Fee         : ${feeNumerator} / ${FEE_DENOMINATOR} = ${feePct}%`);
  console.log(`Balance     : ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))}`);
  console.log(`───────────────────────────────────────────────────────\n`);

  const Factory = await hre.ethers.getContractFactory("AnetFeeRouter");
  const router = await Factory.deploy(dexRouter, treasury, feeNumerator);
  await router.waitForDeployment();
  const address = await router.getAddress();

  // Sanity: the router must have resolved the wrapped-native token.
  const weth = await router.WETH();
  console.log(`✓ AnetFeeRouter deployed : ${address}`);
  console.log(`  WETH/WBNB resolved     : ${weth}`);
  console.log(`  treasury()             : ${await router.treasury()}`);
  console.log(`  feeNumerator()         : ${await router.feeNumerator()}`);

  console.log(`\nNext steps:`);
  console.log(`  1. Verify:  npx hardhat verify --network ${hre.network.name} ${address} ${dexRouter} ${treasury} ${feeNumerator}`);
  console.log(`  2. Paste the address into FEE_ROUTER[${chainId}] in assets/js/dex-onchain.js`);
  console.log(`  3. Bump the dex-onchain.js cache-busting query string in dex.html and redeploy the site.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
