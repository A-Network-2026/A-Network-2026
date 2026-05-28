/**
 * deploy-vault.js — Deploy AnetBridgeVault to BSC (or testnet).
 *
 * Bitcoin-principle posture
 *   This vault replaces the legacy hot EOA escrow
 *   0x27766A070e6F55BD832A10aB9c5931FfA2037029 that currently holds 21M wANET.
 *   Once deployed, the founder transfers all 21M wANET into this vault and the
 *   asset becomes one-way: every release must carry M-of-N EIP-712 signatures
 *   from the L1 relayer signer set, bounded by per-tx / 24h / global caps,
 *   and the admin role itself has NO code path that can move wANET.
 *
 * Usage
 *   npm run deploy:vault:bsc-testnet
 *   npm run deploy:vault:bsc
 *
 * Required env vars (in ../pi-backend/.env or environment)
 *   DEPLOYER_PRIVATE_KEY               — funded BSC deployer key (gas only)
 *   VAULT_WANET_TOKEN                  — BEP-20 wANET token address
 *                                        (mainnet: 0x791055A7d52AA392eaE8De04250497f33807E46A)
 *   VAULT_ADMIN_SAFE                   — Gnosis Safe address that becomes admin
 *   VAULT_PAUSER                       — Separate cold-key pauser address
 *   VAULT_INITIAL_SIGNERS              — comma-separated 3..16 signer addresses
 *   VAULT_INITIAL_THRESHOLD            — integer M, where 1 ≤ M ≤ N
 *   VAULT_MAX_PER_TX_ANET              — e.g. "10000"   (whole ANET, not wei)
 *   VAULT_MAX_PER_RECIPIENT_24H_ANET   — e.g. "50000"
 *   VAULT_MAX_GLOBAL_24H_ANET          — e.g. "250000"
 *
 * Optional
 *   VERIFY_CONTRACT=true               — auto-verify on BscScan after deploy
 *
 * Post-deploy operator runbook
 *   1. From the legacy escrow EOA, transfer ALL wANET to the new vault address.
 *   2. Confirm:    vault.vaultBalance() == 21_000_000 * 1e18.
 *   3. Update the relayer service to build EIP-712 Release digests with the
 *      vault's chainId + address as the EIP-712 domain (name="AnetBridgeVault",
 *      version="1"). Each signer signs independently; submitter aggregates ≥M
 *      sigs sorted ascending by signer address.
 *   4. Flip ANET_BRIDGE_BURN_ENABLED=true ONLY after a canary burn of ~10 ANET
 *      succeeds end-to-end (L1 burn → ≥M sigs → vault.releaseBurn → on-chain
 *      Released event).
 *   5. Transfer ownership of the BEP-20 token contract to the same Safe.
 *   6. Publish vault address + signer set + caps in whitepaper.html v3.2.
 */

const hre = require("hardhat");

function parseAddressList(name) {
  const raw = (process.env[name] || "").trim();
  if (!raw) throw new Error(`Missing env: ${name}`);
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length < 1 || list.length > 16) {
    throw new Error(`${name} must contain 1..16 addresses, got ${list.length}`);
  }
  for (const a of list) {
    if (!hre.ethers.isAddress(a)) {
      throw new Error(`${name}: not a valid address: ${a}`);
    }
  }
  return list;
}

function sortAddressesAsc(addrs) {
  return [...addrs].sort((a, b) =>
    BigInt(a.toLowerCase()) < BigInt(b.toLowerCase()) ? -1 : 1
  );
}

function requireAddress(name) {
  const v = process.env[name];
  if (!v || !hre.ethers.isAddress(v)) throw new Error(`Missing/invalid env: ${name}`);
  return v;
}

function requirePositiveInt(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network    = hre.network.name;
  const chainId    = hre.network.config.chainId;

  // ── Inputs ──────────────────────────────────────────────────────────────
  const wanetAddr  = requireAddress("VAULT_WANET_TOKEN");
  const admin      = requireAddress("VAULT_ADMIN_SAFE");
  const pauser     = requireAddress("VAULT_PAUSER");

  const signersRaw = parseAddressList("VAULT_INITIAL_SIGNERS");
  const signers    = sortAddressesAsc(signersRaw);
  const threshold  = requirePositiveInt("VAULT_INITIAL_THRESHOLD");
  if (threshold > signers.length) {
    throw new Error(`VAULT_INITIAL_THRESHOLD (${threshold}) > N signers (${signers.length})`);
  }

  const maxPerTx       = hre.ethers.parseEther(process.env.VAULT_MAX_PER_TX_ANET            || "10000");
  const maxRecipient24 = hre.ethers.parseEther(process.env.VAULT_MAX_PER_RECIPIENT_24H_ANET || "50000");
  const maxGlobal24    = hre.ethers.parseEther(process.env.VAULT_MAX_GLOBAL_24H_ANET        || "250000");

  // ── Pre-flight ──────────────────────────────────────────────────────────
  console.log(`\n─── AnetBridgeVault Deployment ─────────────────────────`);
  console.log(`Network          : ${network} (chainId ${chainId})`);
  console.log(`Deployer         : ${deployer.address}`);
  console.log(`Deployer balance : ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} native`);
  console.log(`wANET token      : ${wanetAddr}`);
  console.log(`Admin (Safe)     : ${admin}`);
  console.log(`Pauser (cold key): ${pauser}`);
  console.log(`Signers (sorted) :`);
  signers.forEach((s, i) => console.log(`  [${i}] ${s}`));
  console.log(`Threshold        : ${threshold}-of-${signers.length}`);
  console.log(`Caps             :`);
  console.log(`  perTx          : ${hre.ethers.formatEther(maxPerTx)} ANET`);
  console.log(`  perRecipient24h: ${hre.ethers.formatEther(maxRecipient24)} ANET`);
  console.log(`  global24h      : ${hre.ethers.formatEther(maxGlobal24)} ANET`);
  console.log(`────────────────────────────────────────────────────────\n`);

  if (maxPerTx > maxRecipient24)  throw new Error("perTx > perRecipient24h");
  if (maxRecipient24 > maxGlobal24) throw new Error("perRecipient24h > global24h");
  if (admin.toLowerCase()  === deployer.address.toLowerCase()) {
    console.warn("⚠  VAULT_ADMIN_SAFE equals deployer — STRONGLY recommend a real multisig before mainnet cut-over.");
  }
  if (pauser.toLowerCase() === admin.toLowerCase()) {
    console.warn("⚠  Pauser == admin — use a separate cold key for pauser (audit §3.2).");
  }

  // ── Deploy ──────────────────────────────────────────────────────────────
  const Vault = await hre.ethers.getContractFactory("AnetBridgeVault");
  const vault = await Vault.deploy(
    wanetAddr,
    admin,
    pauser,
    signers,
    threshold,
    maxPerTx,
    maxRecipient24,
    maxGlobal24,
  );
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  const txHash  = vault.deploymentTransaction()?.hash;
  console.log(`✓ AnetBridgeVault deployed: ${address}`);
  console.log(`  Tx hash                  : ${txHash}`);

  // ── Post-deploy sanity reads ────────────────────────────────────────────
  console.log(`\nPost-deploy on-chain sanity:`);
  console.log(`  WANET()             = ${await vault.WANET()}`);
  console.log(`  admin()             = ${await vault.admin()}`);
  console.log(`  pauser()            = ${await vault.pauser()}`);
  console.log(`  threshold()         = ${await vault.threshold()}`);
  console.log(`  maxPerTx()          = ${hre.ethers.formatEther(await vault.maxPerTx())} ANET`);
  console.log(`  maxPerRecipient24h()= ${hre.ethers.formatEther(await vault.maxPerRecipient24h())} ANET`);
  console.log(`  maxGlobal24h()      = ${hre.ethers.formatEther(await vault.maxGlobal24h())} ANET`);
  console.log(`  vaultBalance()      = ${hre.ethers.formatEther(await vault.vaultBalance())} wANET`);
  console.log(`  signers()           = [${(await vault.signers()).join(", ")}]`);

  // ── Verify ──────────────────────────────────────────────────────────────
  if (process.env.VERIFY_CONTRACT === "true") {
    console.log(`\nVerifying on block explorer...`);
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: [
          wanetAddr, admin, pauser, signers, threshold,
          maxPerTx, maxRecipient24, maxGlobal24,
        ],
      });
      console.log("✓ Verified.");
    } catch (e) {
      console.warn("Verification failed (may already be verified):", e.message);
    }
  }

  console.log(`\n────────────────────────────────────────────────────────`);
  console.log(`NEXT STEPS (operator):`);
  console.log(`  1. From legacy escrow EOA, transfer ALL 21M wANET to:`);
  console.log(`        ${address}`);
  console.log(`  2. Verify vaultBalance() == 21,000,000 wANET on BscScan.`);
  console.log(`  3. Set in pi-backend/.env:`);
  console.log(`        ANET_BRIDGE_VAULT_ADDRESS=${address}`);
  console.log(`        ANET_BRIDGE_VAULT_CHAIN_ID=${chainId}`);
  console.log(`  4. Update relayer to sign EIP-712 Release digests (see audit §3).`);
  console.log(`  5. Canary burn (10 ANET) end-to-end before enabling global burns.`);
  console.log(`  6. Publish vault address + signer set + caps in whitepaper.html.`);
  console.log(`────────────────────────────────────────────────────────\n`);

  return address;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
