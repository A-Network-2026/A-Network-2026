// SPDX-License-Identifier: MIT
/**
 * live-roundtrip-bsc-testnet.js — proves the deployed BSC-testnet bridge end-to-end.
 *
 *   1. Simulate an L1 lock of 100 ANET destined for a recipient.
 *   2. Two of the three M-of-N signers sign the EIP-712 bridgeIn attestation.
 *   3. Submit bridgeIn -> mint 100 wANET (replay-protected by messageId).
 *   4. bridgeOut 40 wANET -> burn + BridgeOut event (relayer would credit L1).
 *   5. Assert the supply invariant (mintedIn - burnedOut == totalSupply) holds.
 *
 * Reads keys from contracts/.env (deployer + the commented SIGNER_1..3 lines).
 */
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = "https://data-seed-prebsc-1-s1.binance.org:8545/";
const WANET = "0x1874FA198ea93b56acb34f86f59F557710A667AA";
const PORTAL = "0x1C1A048C02E13Ec336C920D67246d786D3BFDA54";
const CHAIN_ID = 97;

function envValue(txt, key) {
  const m = txt.match(new RegExp(`^#?\\s*${key}=([^\\s]+)`, "m"));
  if (!m) throw new Error(`${key} not found in .env`);
  return m[1];
}
function abiOf(name) {
  const p = path.join(__dirname, "..", "artifacts", "src", `${name}.sol`, `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8")).abi;
}

async function main() {
  const envTxt = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
  const provider = new ethers.JsonRpcProvider(RPC);
  const deployer = new ethers.Wallet(envValue(envTxt, "DEPLOYER_PRIVATE_KEY_BSC_TESTNET"), provider);
  const s1 = new ethers.Wallet(envValue(envTxt, "SIGNER_1"));
  const s2 = new ethers.Wallet(envValue(envTxt, "SIGNER_2"));

  const portal = new ethers.Contract(PORTAL, abiOf("AnetMintBurnPortal"), deployer);
  const wanet = new ethers.Contract(WANET, abiOf("WrappedANET"), provider);

  const recipient = deployer.address;
  const amount = ethers.parseEther("100");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const srcChainId = 999n; // L1 hub
  const messageId = ethers.keccak256(
    ethers.solidityPacked(["uint256", "bytes32", "uint256"], [srcChainId, ethers.id("testnet-lock-1"), 0n])
  );

  const domain = { name: "AnetMintBurnPortal", version: "1", chainId: CHAIN_ID, verifyingContract: PORTAL };
  const types = {
    BridgeIn: [
      { name: "messageId", type: "bytes32" },
      { name: "srcChainId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const value = { messageId, srcChainId, recipient, amount, deadline };

  // Two independent signers, aggregated ascending by address (contract requires it).
  const signed = [
    { signer: s1.address, sig: await s1.signTypedData(domain, types, value) },
    { signer: s2.address, sig: await s2.signTypedData(domain, types, value) },
  ].sort((a, b) => (BigInt(a.signer.toLowerCase()) < BigInt(b.signer.toLowerCase()) ? -1 : 1));
  const sigs = signed.map((x) => x.sig);

  console.log("=== 1) bridgeIn: mint 100 wANET on M-of-N attestation ===");
  const req = { messageId, srcChainId, recipient, amount, deadline, memo: "L1 lock testnet-lock-1" };
  const tx1 = await portal.bridgeIn(req, sigs);
  const r1 = await tx1.wait();
  console.log("  bridgeIn tx:", r1.hash);
  console.log("  recipient wANET balance:", ethers.formatEther(await wanet.balanceOf(recipient)));
  let rec = await portal.reconciliation();
  console.log("  reconciliation [supply, mintedIn, burnedOut]:", rec[0].toString(), rec[1].toString(), rec[2].toString());

  console.log("\n=== 2) replay protection: same messageId must revert ===");
  try {
    await (await portal.bridgeIn(req, sigs)).wait();
    console.log("  ERROR: replay did NOT revert");
  } catch (e) {
    console.log("  replay correctly rejected:", (e.shortMessage || e.message).split("(")[0].trim());
  }

  console.log("\n=== 3) bridgeOut: burn 40 wANET (relayer would credit L1) ===");
  const wanetD = new ethers.Contract(WANET, abiOf("WrappedANET"), deployer);
  await (await wanetD.approve(PORTAL, ethers.parseEther("40"))).wait();
  const tx3 = await portal.bridgeOut(ethers.parseEther("40"), "ANET" + "A".repeat(36), "cash out");
  const r3 = await tx3.wait();
  console.log("  bridgeOut tx:", r3.hash);
  console.log("  recipient wANET balance:", ethers.formatEther(await wanet.balanceOf(recipient)));

  console.log("\n=== 4) invariant check ===");
  rec = await portal.reconciliation();
  const supply = await wanet.totalSupply();
  const ok = rec[1] - rec[2] === rec[0] && rec[0] === supply;
  console.log("  reconciliation [supply, mintedIn, burnedOut]:", rec[0].toString(), rec[1].toString(), rec[2].toString());
  console.log("  totalSupply:", ethers.formatEther(supply));
  console.log("  INVARIANT (mintedIn - burnedOut == spokeSupply == totalSupply):", ok ? "HOLDS ✅" : "VIOLATED ❌");
}

main().catch((e) => { console.error("ERR", e); process.exit(1); });
