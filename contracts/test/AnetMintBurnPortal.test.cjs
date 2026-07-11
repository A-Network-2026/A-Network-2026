// SPDX-License-Identifier: MIT
//
// AnetMintBurnPortal.test.cjs
// ─────────────────────────────────────────────────────────────────────────────
// Canonical L1 ⇆ spoke-chain mint/burn bridge. The invariants tested here make
// wANET fully 1:1 backed by ANET locked on L1 (single canonical supply):
//   • bridgeIn() MINTS only against M-of-N EIP-712 attestations of an L1 lock,
//     de-duped by messageId (no double-mint), bounded by rolling caps.
//   • bridgeOut() BURNS the user's wANET permissionlessly and emits for L1 unlock.
//   • WrappedANET enforces the 21,000,000 hard cap so no chain can inflate.

const { expect } = require("chai");
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ETH = (n) => hre.ethers.parseEther(String(n));
const DOMAIN_NAME = "AnetMintBurnPortal";
const DOMAIN_VERSION = "1";
const BRIDGE_IN_TYPES = {
  BridgeIn: [
    { name: "messageId", type: "bytes32" },
    { name: "srcChainId", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

async function chainDeadline(secondsAhead = 3600) {
  const block = await hre.ethers.provider.getBlock("latest");
  return BigInt(block.timestamp + secondsAhead);
}

async function buildSigs({ signers, portalAddress, chainId, message }) {
  const domain = { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId, verifyingContract: portalAddress };
  const pairs = await Promise.all(
    signers.map(async (s) => ({ addr: s.address, sig: await s.signTypedData(domain, BRIDGE_IN_TYPES, message) }))
  );
  pairs.sort((a, b) => (BigInt(a.addr.toLowerCase()) < BigInt(b.addr.toLowerCase()) ? -1 : 1));
  return pairs.map((p) => p.sig);
}

const SRC_CHAIN = 999n; // L1 hub chain id (placeholder)

describe("AnetMintBurnPortal + WrappedANET", () => {
  let wanet, portal, admin, pauser, user, recipient, s1, s2, s3, chainId, signerSet;

  const PER_TX = ETH(1000);
  const PER_RECIP = ETH(5000);
  const GLOBAL = ETH(20000);

  beforeEach(async () => {
    [admin, pauser, user, recipient, s1, s2, s3] = await hre.ethers.getSigners();
    chainId = (await hre.ethers.provider.getNetwork()).chainId;

    const W = await hre.ethers.getContractFactory("WrappedANET");
    wanet = await W.deploy(admin.address, admin.address); // temp bridge = admin
    await wanet.waitForDeployment();

    signerSet = [s1, s2, s3].sort((a, b) => (BigInt(a.address.toLowerCase()) < BigInt(b.address.toLowerCase()) ? -1 : 1));

    const P = await hre.ethers.getContractFactory("AnetMintBurnPortal");
    portal = await P.deploy(
      wanet.target, admin.address, pauser.address,
      signerSet.map((s) => s.address), 2, PER_TX, PER_RECIP, GLOBAL
    );
    await portal.waitForDeployment();

    await wanet.connect(admin).setInitialBridge(portal.target);
  });

  function mintReq(overrides = {}) {
    return {
      messageId: hre.ethers.id("lock-1"),
      srcChainId: SRC_CHAIN,
      recipient: recipient.address,
      amount: ETH(100),
      deadline: 0n, // filled by caller
      memo: "L1 lock https://explorer.a-network.net/tx/abc",
      ...overrides,
    };
  }

  it("bridgeIn mints wANET against 2-of-3 signatures (1:1)", async () => {
    const deadline = await chainDeadline();
    const req = mintReq({ deadline });
    const message = { messageId: req.messageId, srcChainId: req.srcChainId, recipient: req.recipient, amount: req.amount, deadline };
    const sigs = await buildSigs({ signers: [signerSet[0], signerSet[1]], portalAddress: portal.target, chainId, message });

    await expect(portal.connect(user).bridgeIn(req, sigs))
      .to.emit(portal, "BridgeIn")
      .withArgs(req.messageId, req.srcChainId, req.recipient, req.amount, 2n, req.memo);

    expect(await wanet.balanceOf(recipient.address)).to.equal(ETH(100));
    expect(await wanet.totalSupply()).to.equal(ETH(100));
    expect(await portal.totalMinted()).to.equal(ETH(100));
    expect(await portal.mintConsumed(req.messageId)).to.equal(true);
    expect(await portal.backingRequired()).to.equal(ETH(100));
  });

  it("rejects a replayed messageId (no double-mint)", async () => {
    const deadline = await chainDeadline();
    const req = mintReq({ deadline });
    const message = { messageId: req.messageId, srcChainId: req.srcChainId, recipient: req.recipient, amount: req.amount, deadline };
    const sigs = await buildSigs({ signers: [signerSet[0], signerSet[1]], portalAddress: portal.target, chainId, message });
    await portal.connect(user).bridgeIn(req, sigs);
    await expect(portal.connect(user).bridgeIn(req, sigs)).to.be.revertedWith("Portal: message used");
  });

  it("rejects below-threshold signatures", async () => {
    const deadline = await chainDeadline();
    const req = mintReq({ deadline });
    const message = { messageId: req.messageId, srcChainId: req.srcChainId, recipient: req.recipient, amount: req.amount, deadline };
    const sigs = await buildSigs({ signers: [signerSet[0]], portalAddress: portal.target, chainId, message });
    await expect(portal.connect(user).bridgeIn(req, sigs)).to.be.revertedWith("Portal: not enough signatures");
  });

  it("rejects a non-signer signature", async () => {
    const deadline = await chainDeadline();
    const req = mintReq({ deadline });
    const message = { messageId: req.messageId, srcChainId: req.srcChainId, recipient: req.recipient, amount: req.amount, deadline };
    const sigs = await buildSigs({ signers: [signerSet[0], user], portalAddress: portal.target, chainId, message });
    await expect(portal.connect(user).bridgeIn(req, sigs)).to.be.revertedWith("Portal: not a signer");
  });

  it("enforces the per-tx cap on mint", async () => {
    const deadline = await chainDeadline();
    const req = mintReq({ amount: ETH(1001), deadline });
    const message = { messageId: req.messageId, srcChainId: req.srcChainId, recipient: req.recipient, amount: req.amount, deadline };
    const sigs = await buildSigs({ signers: [signerSet[0], signerSet[1]], portalAddress: portal.target, chainId, message });
    await expect(portal.connect(user).bridgeIn(req, sigs)).to.be.revertedWith("Portal: > per-tx cap");
  });

  it("bridgeOut burns the user's wANET and emits for L1 unlock", async () => {
    // first mint 100 to recipient
    const deadline = await chainDeadline();
    const req = mintReq({ deadline });
    const message = { messageId: req.messageId, srcChainId: req.srcChainId, recipient: req.recipient, amount: req.amount, deadline };
    const sigs = await buildSigs({ signers: [signerSet[0], signerSet[1]], portalAddress: portal.target, chainId, message });
    await portal.connect(user).bridgeIn(req, sigs);

    // recipient approves the portal and bridges out 40
    await wanet.connect(recipient).approve(portal.target, ETH(40));
    await expect(portal.connect(recipient).bridgeOut(ETH(40), "ANET1234567890ABCDEF1234567890ABCDEF1234", "cash out"))
      .to.emit(portal, "BridgeOut")
      .withArgs(1n, recipient.address, "ANET1234567890ABCDEF1234567890ABCDEF1234", ETH(40), chainId, "cash out");

    expect(await wanet.balanceOf(recipient.address)).to.equal(ETH(60));
    expect(await wanet.totalSupply()).to.equal(ETH(60));
    expect(await portal.totalBurned()).to.equal(ETH(40));
  });

  it("pause blocks bridgeIn and bridgeOut", async () => {
    await portal.connect(pauser).pause();
    const deadline = await chainDeadline();
    const req = mintReq({ deadline });
    const message = { messageId: req.messageId, srcChainId: req.srcChainId, recipient: req.recipient, amount: req.amount, deadline };
    const sigs = await buildSigs({ signers: [signerSet[0], signerSet[1]], portalAddress: portal.target, chainId, message });
    await expect(portal.connect(user).bridgeIn(req, sigs)).to.be.revertedWith("Portal: paused");
    await expect(portal.connect(user).bridgeOut(ETH(1), "ANET1", "x")).to.be.revertedWith("Portal: paused");
  });

  it("signer-set rotation requires the 48h timelock", async () => {
    const newSet = [s1.address].sort();
    await portal.connect(admin).scheduleSignerSet(newSet, 1);
    await expect(portal.connect(admin).executeSignerSet(newSet, 1)).to.be.revertedWith("Portal: timelock");
    await time.increase(48 * 3600 + 1);
    await portal.connect(admin).executeSignerSet(newSet, 1);
    expect(await portal.threshold()).to.equal(1n);
  });

  it("WrappedANET enforces the 21,000,000 hard cap", async () => {
    const W = await hre.ethers.getContractFactory("WrappedANET");
    const t = await W.deploy(admin.address, admin.address); // bridge = admin for direct mint
    await t.waitForDeployment();
    await t.connect(admin).mint(recipient.address, ETH(21_000_000));
    await expect(t.connect(admin).mint(recipient.address, 1)).to.be.revertedWith("wANET: over max supply");
    expect(await t.totalSupply()).to.equal(ETH(21_000_000));
  });

  it("setInitialBridge is one-time and only while supply is zero", async () => {
    await expect(wanet.connect(admin).setInitialBridge(user.address)).to.be.revertedWith("wANET: initial bridge set");
  });
});
