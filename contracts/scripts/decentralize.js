/**
 * Decentralize the live ANET (ANetwork) BEP-20 deployment.
 *
 * Default action: renounceOwnership() — permanently sets owner to 0x0.
 *   This DISABLES (forever):
 *     - mint(address,uint256)
 *     - pause() / unpause()
 *     - setBlacklist(address,bool)
 *   Supply is frozen at the current circulating amount (max 21,000,000 ANET).
 *   burn() / burnFrom() remain available to every holder for their own tokens.
 *
 * Alternative: transfer ownership to a multisig / timelock / DAO.
 *   Set NEW_OWNER env var to an address (e.g. a Gnosis Safe) and the script
 *   will call transferOwnership(NEW_OWNER) instead of renouncing.
 *
 * Usage:
 *   # Permanently renounce (truly decentralized, irreversible)
 *   cd A-Network-2026/contracts
 *   npx hardhat run scripts/decentralize.js --network bsc
 *
 *   # Or hand control to a Gnosis Safe (recommended if you want emergency pause)
 *   NEW_OWNER=0xYourGnosisSafeAddress \
 *     npx hardhat run scripts/decentralize.js --network bsc
 *
 * Requires DEPLOYER_PRIVATE_KEY in pi-backend/.env to be the CURRENT owner key.
 */

const { ethers } = require("hardhat");

const ANET_ADDRESS = "0x791055A7d52AA392eaE8De04250497f33807E46A";

const ABI = [
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`Network:  ${net.name} (chainId ${net.chainId})`);
  console.log(`Signer:   ${signer.address}`);

  const anet = new ethers.Contract(ANET_ADDRESS, ABI, signer);
  const currentOwner = await anet.owner();
  console.log(`Contract: ${ANET_ADDRESS}`);
  console.log(`Owner:    ${currentOwner}`);

  if (currentOwner.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    console.log("✅ Ownership is already renounced. Contract is already decentralized.");
    return;
  }

  if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Signer (${signer.address}) is not the current owner (${currentOwner}). ` +
        `Use the owner's private key in DEPLOYER_PRIVATE_KEY.`
    );
  }

  const newOwner = process.env.NEW_OWNER;
  let tx;

  if (newOwner) {
    if (!ethers.isAddress(newOwner)) {
      throw new Error(`NEW_OWNER is not a valid address: ${newOwner}`);
    }
    console.log(`\nAction: transferOwnership -> ${newOwner}`);
    console.log("Sending tx...");
    tx = await anet.transferOwnership(newOwner);
  } else {
    console.log("\nAction: renounceOwnership() — IRREVERSIBLE");
    console.log("This permanently disables mint / pause / unpause / setBlacklist.");
    console.log("Sending tx in 5 seconds. Ctrl-C to abort.");
    await new Promise((r) => setTimeout(r, 5000));
    tx = await anet.renounceOwnership();
  }

  console.log(`Tx hash:  ${tx.hash}`);
  const rcpt = await tx.wait();
  console.log(`Mined in block ${rcpt.blockNumber}, status=${rcpt.status}`);

  const finalOwner = await anet.owner();
  console.log(`\nFinal owner: ${finalOwner}`);
  console.log(
    finalOwner === "0x0000000000000000000000000000000000000000"
      ? "✅ Ownership renounced. ANET is now fully decentralized."
      : `✅ Ownership transferred to ${finalOwner}.`
  );
  console.log(
    `Verify: https://bscscan.com/address/${ANET_ADDRESS}#readContract`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
