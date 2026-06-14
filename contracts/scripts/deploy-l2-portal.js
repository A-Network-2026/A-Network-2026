/**
 * deploy-l2-portal.js — Deploy the canonical AnetL2Portal (lock-and-mint).
 *
 * The portal LOCKS ANET on BSC and the L2 sequencer credits NATIVE ANET on the
 * L2 1:1. Locked ANET only leaves via M-of-N signed L2-burn attestations. This
 * makes L2 ANET fully 1:1 backed — never synthetic.
 *
 * Usage:
 *   ANET_TOKEN=0x791055A7d52AA392eaE8De04250497f33807E46A \
 *   L2_CHAIN_ID=204 \
 *   PORTAL_ADMIN=0xSafe... PORTAL_PAUSER=0xColdKey... \
 *   PORTAL_SIGNERS=0xA,0xB,0xC PORTAL_THRESHOLD=2 \
 *   PORTAL_MAX_PER_TX=1000 PORTAL_MAX_RECIP_24H=5000 PORTAL_MAX_GLOBAL_24H=20000 \
 *   npx hardhat run scripts/deploy-l2-portal.js --network bsc
 *
 * After deploy the script sets the transparency pointers (explorer links +
 * backing statement) so every movement is publicly verifiable on-chain.
 */

const hre = require("hardhat");

function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function sortAsc(addrs) {
  return [...addrs].sort((a, b) =>
    BigInt(a.toLowerCase()) < BigInt(b.toLowerCase()) ? -1 : 1
  );
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = hre.network.name;
  const isTestnet = net.includes("testnet");

  // Known ANET BEP-20 (BSC mainnet). On testnet you MUST supply a testnet ANET.
  const ANET_MAINNET = "0x791055A7d52AA392eaE8De04250497f33807E46A";
  const ANET = process.env.ANET_TOKEN || (isTestnet ? "" : ANET_MAINNET);
  if (!ANET) {
    throw new Error("ANET_TOKEN is required on testnet (deploy/point to a testnet ANET token first).");
  }

  // opBNB chain ids: mainnet 204, testnet 5611.
  const l2Chain = BigInt(process.env.L2_CHAIN_ID || (isTestnet ? 5611 : 204));

  const admin  = process.env.PORTAL_ADMIN  || deployer.address;
  const pauser = process.env.PORTAL_PAUSER || deployer.address;

  // For a testnet shakedown the signer set / threshold default to the deployer
  // (1-of-1) so the whole lock→mint→burn→release flow can be exercised solo.
  // On mainnet PORTAL_SIGNERS + PORTAL_THRESHOLD MUST be set to the real M-of-N.
  const rawSigners = process.env.PORTAL_SIGNERS
    ? process.env.PORTAL_SIGNERS.split(",").map((s) => s.trim()).filter(Boolean)
    : [deployer.address];
  const signers = sortAsc(rawSigners);
  const threshold = BigInt(process.env.PORTAL_THRESHOLD || 1);

  const ETH = (n) => hre.ethers.parseEther(String(n));
  const maxPerTx     = ETH(process.env.PORTAL_MAX_PER_TX     || 1000);
  const maxRecip24h  = ETH(process.env.PORTAL_MAX_RECIP_24H  || 5000);
  const maxGlobal24h = ETH(process.env.PORTAL_MAX_GLOBAL_24H || 20000);

  console.log(`\n─── AnetL2Portal Deployment ───────────────────────────`);
  console.log(`Network    : ${hre.network.name} (chainId ${hre.network.config.chainId})`);
  console.log(`Deployer   : ${deployer.address}`);
  console.log(`ANET token : ${ANET}`);
  console.log(`L2 chainId : ${l2Chain}`);
  console.log(`Admin      : ${admin}`);
  console.log(`Pauser     : ${pauser}`);
  console.log(`Signers    : ${signers.join(", ")}`);
  console.log(`Threshold  : ${threshold} of ${signers.length}`);
  console.log(`Caps       : tx=${maxPerTx} recip24h=${maxRecip24h} global24h=${maxGlobal24h}`);
  if (admin === deployer.address) console.warn("⚠  PORTAL_ADMIN not set — transfer to a Safe before going live.");
  if (!process.env.PORTAL_SIGNERS) console.warn("⚠  PORTAL_SIGNERS not set — defaulted to deployer (1-of-1). Set the real M-of-N before mainnet.");
  if (!isTestnet && threshold < 2n) console.warn("⚠  Threshold < 2 on mainnet — a single key can release. Use a real M-of-N.");
  console.log(`───────────────────────────────────────────────────────\n`);

  const Portal = await hre.ethers.getContractFactory("AnetL2Portal");
  const portal = await Portal.deploy(
    ANET, l2Chain, admin, pauser, signers, threshold, maxPerTx, maxRecip24h, maxGlobal24h
  );
  await portal.waitForDeployment();
  const address = await portal.getAddress();
  console.log(`✓ AnetL2Portal deployed: ${address}`);
  console.log(`  Tx hash              : ${portal.deploymentTransaction()?.hash}`);

  // Transparency pointers (admin-only, no timelock — informational).
  if (admin === deployer.address) {
    const bscBase = process.env.PORTAL_BSC_EXPLORER || "https://bscscan.com/tx/";
    const l2Base  = process.env.PORTAL_L2_EXPLORER  || "https://opbnbscan.com/tx/";
    const backing = process.env.PORTAL_BACKING_STATEMENT ||
      "L2 native ANET is 1:1 backed by ANET locked in this portal. Lock on BSC -> mint on L2; burn on L2 -> M-of-N signed release on BSC.";
    const tx = await portal.setTransparency(bscBase, l2Base, backing);
    await tx.wait();
    console.log(`✓ Transparency set (BSC: ${bscBase} | L2: ${l2Base})`);
  } else {
    console.log("ℹ Admin is external — call setTransparency(...) from the admin/Safe.");
  }

  if (process.env.VERIFY_CONTRACT === "true") {
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: [ANET, l2Chain, admin, pauser, signers, threshold, maxPerTx, maxRecip24h, maxGlobal24h],
      });
      console.log("✓ Verified on explorer.");
    } catch (e) {
      console.warn("Verification failed (may already be verified):", e.message);
    }
  }

  console.log(`\nNEXT STEPS:`);
  console.log(`  1. Fund/deposit flow: users approve ANET then call deposit(amount, l2Recipient, memo).`);
  console.log(`  2. Point the L2 sequencer/relayer at DepositInitiated events on ${address}.`);
  console.log(`  3. Wire L2 burn attestations to finalizeWithdrawal(...) with M-of-N signatures.`);
  console.log(`  4. Transfer admin to the Gnosis Safe via transferAdmin/acceptAdmin.\n`);

  return address;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
