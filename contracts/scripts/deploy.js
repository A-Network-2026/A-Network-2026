/**
 * deploy.js — Deploy AnetSwap contract to any configured network.
 *
 * Usage:
 *   npm run deploy:bsc-testnet    # deploy + verify on BSC testnet
 *   npm run deploy:bsc            # deploy + verify on BSC mainnet
 *
 * Required env vars (in pi-backend/.env or environment):
 *   DEPLOYER_PRIVATE_KEY     - Private key of the deployer wallet (has gas funds)
 *   ANET_FEE_RECIPIENT       - EVM address that collects bridge fees
 *   ANET_BRIDGE_OWNER        - EVM address that will own the contract (defaults to deployer)
 *
 * After deploying:
 *   1. Copy the deployed address into dex.js ANET_SWAP_CONTRACTS[chainId].
 *   2. Copy the deployed address into pi-backend .env as EVM_BRIDGE_CONTRACT_BSC.
 *   3. Run setup-tokens.js to whitelist USDT, USDC, WBNB, etc.
 */

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network    = hre.network.name;
  const chainId    = hre.network.config.chainId;

  console.log(`\n─── AnetSwap Deployment ────────────────────────────────`);
  console.log(`Network      : ${network} (chainId ${chainId})`);
  console.log(`Deployer     : ${deployer.address}`);
  console.log(`Balance      : ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} native`);

  const feeRecipient   = process.env.ANET_FEE_RECIPIENT || deployer.address;
  const contractOwner  = process.env.ANET_BRIDGE_OWNER  || deployer.address;

  if (feeRecipient === deployer.address) {
    console.warn("⚠  ANET_FEE_RECIPIENT not set — fees will go to deployer address.");
  }

  console.log(`Fee recipient: ${feeRecipient}`);
  console.log(`Contract owner (post-transfer): ${contractOwner}`);
  console.log(`────────────────────────────────────────────────────────\n`);

  // Deploy
  const AnetSwap = await hre.ethers.getContractFactory("AnetSwap");
  const contract = await AnetSwap.deploy(contractOwner, feeRecipient);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`✓ AnetSwap deployed: ${address}`);
  console.log(`  Tx hash          : ${contract.deploymentTransaction()?.hash}`);

  // Verify on block explorer (optional, requires BSCSCAN_API_KEY etc.)
  if (process.env.VERIFY_CONTRACT === "true") {
    console.log("\nVerifying contract on block explorer...");
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: [contractOwner, feeRecipient],
      });
      console.log("✓ Contract verified.");
    } catch (e) {
      console.warn("Verification failed (may already be verified):", e.message);
    }
  }

  console.log(`\n────────────────────────────────────────────────────────`);
  console.log(`NEXT STEPS:`);
  console.log(`  1. Add to dex.js:  ANET_SWAP_CONTRACTS[${chainId}] = '${address}';`);
  console.log(`  2. Add to .env:    EVM_BRIDGE_CONTRACT_${network.toUpperCase()} = ${address}`);
  console.log(`  3. Run:            npm run setup:bsc`);
  console.log(`────────────────────────────────────────────────────────\n`);

  return address;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
