// SPDX-License-Identifier: MIT
/**
 * deploy-mint-burn-portal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Deploys the canonical mint/burn spoke for one EVM chain:
 *   1. WrappedANET (wANET) — bridge-controlled, 21M hard cap.
 *   2. AnetMintBurnPortal — M-of-N mint against attested L1 locks, burn on exit.
 *   3. Wires the token's genesis bridge to the portal (one-time, supply == 0).
 *   4. Hands wANET admin to the Safe (2-step: deployer proposes, Safe accepts).
 *
 * Reuse this identical script per spoke chain (Ethereum, BSC-new, …). Solana
 * uses an equivalent SPL mint + Anchor portal (separate program).
 *
 * Required env (see deploy.env.example):
 *   PORTAL_ADMIN            Safe that governs the portal (timelocked params)
 *   WANET_ADMIN             Safe that governs the wANET token (bridge rotation)
 *   PORTAL_PAUSER           separate cold pauser key
 *   PORTAL_SIGNERS          comma-separated M-of-N relayer signer addresses
 *   PORTAL_THRESHOLD        M (required signatures)
 *   PORTAL_MAX_PER_TX       whole wANET, per-tx mint cap
 *   PORTAL_MAX_RECIP_24H    whole wANET, per-recipient rolling-24h mint cap
 *   PORTAL_MAX_GLOBAL_24H   whole wANET, global rolling-24h mint cap
 */
const hre = require("hardhat");

function reqEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing required env: ${name}`);
  return String(v).trim();
}
function reqAddr(name) {
  const v = reqEnv(name);
  if (!hre.ethers.isAddress(v)) throw new Error(`${name} is not a valid address: ${v}`);
  return hre.ethers.getAddress(v);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const E = (n) => hre.ethers.parseEther(String(n));

  const portalAdmin = reqAddr("PORTAL_ADMIN");
  const wanetAdmin = reqAddr("WANET_ADMIN");
  const pauser = reqAddr("PORTAL_PAUSER");
  const signers = reqEnv("PORTAL_SIGNERS").split(",").map((s) => reqAddrRaw(s));
  const threshold = BigInt(reqEnv("PORTAL_THRESHOLD"));
  const maxPerTx = E(reqEnv("PORTAL_MAX_PER_TX"));
  const maxRecip = E(reqEnv("PORTAL_MAX_RECIP_24H"));
  const maxGlobal = E(reqEnv("PORTAL_MAX_GLOBAL_24H"));

  // signers must be sorted ascending + unique (contract requirement)
  const sorted = [...signers].sort((a, b) => (BigInt(a.toLowerCase()) < BigInt(b.toLowerCase()) ? -1 : 1));

  console.log(`\n=== Deploy mint/burn spoke on chainId ${net.chainId} ===`);
  console.log("Deployer:      ", deployer.address);
  console.log("Portal admin:  ", portalAdmin);
  console.log("wANET admin:   ", wanetAdmin);
  console.log("Pauser:        ", pauser);
  console.log("Signers:       ", sorted.join(", "));
  console.log("Threshold:     ", threshold.toString());
  console.log("Caps (wANET):  ", `${reqEnv("PORTAL_MAX_PER_TX")} / ${reqEnv("PORTAL_MAX_RECIP_24H")} / ${reqEnv("PORTAL_MAX_GLOBAL_24H")}`);

  // 1. WrappedANET — temp bridge = deployer, temp admin = deployer (for genesis wiring)
  const W = await hre.ethers.getContractFactory("WrappedANET");
  const wanet = await W.deploy(deployer.address, deployer.address);
  await wanet.waitForDeployment();
  console.log("\nWrappedANET:   ", wanet.target);

  // 2. Portal (admin = Safe directly)
  const P = await hre.ethers.getContractFactory("AnetMintBurnPortal");
  const portal = await P.deploy(
    wanet.target, portalAdmin, pauser, sorted, threshold, maxPerTx, maxRecip, maxGlobal
  );
  await portal.waitForDeployment();
  console.log("Portal:        ", portal.target);

  // 3. Genesis bridge wiring (supply == 0, one-time)
  await (await wanet.connect(deployer).setInitialBridge(portal.target)).wait();
  console.log("Genesis bridge set -> portal");

  // 4. Hand wANET admin to the Safe (Safe must call acceptAdmin())
  await (await wanet.connect(deployer).transferAdmin(wanetAdmin)).wait();
  console.log(`wANET admin transfer proposed -> ${wanetAdmin} (Safe must call acceptAdmin())`);

  console.log("\n=== NEXT STEPS ===");
  console.log(`1. Safe ${wanetAdmin} calls wANET.acceptAdmin()`);
  console.log(`2. Configure the relayer with portal ${portal.target} + signer set`);
  console.log(`3. Verify: npx hardhat verify --network ${hre.network.name} ${wanet.target} ${deployer.address} ${deployer.address}`);
  console.log(`           npx hardhat verify --network ${hre.network.name} ${portal.target} ${wanet.target} ${portalAdmin} ${pauser} '[${sorted.map((s) => `"${s}"`).join(",")}]' ${threshold} ${maxPerTx} ${maxRecip} ${maxGlobal}`);
}

function reqAddrRaw(v) {
  const t = String(v).trim();
  if (!hre.ethers.isAddress(t)) throw new Error(`Invalid signer address: ${t}`);
  return hre.ethers.getAddress(t);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
