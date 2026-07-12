// SPDX-License-Identifier: MIT
//
// EndToEnd.bridge.test.cjs
// ─────────────────────────────────────────────────────────────────────────────
// Full bridge round-trip proving the RELAYER and the CONTRACTS agree:
//   1. L1 locks native ANET (simulated) → the relayer's REAL attest.js produces
//      the M-of-N EIP-712 bridgeIn attestation.
//   2. The spoke portal accepts those signatures and MINTS wANET 1:1.
//   3. The user bridges back: burns wANET → BridgeOut event (relayer would then
//      credit native ANET on L1).
//   4. The single-supply invariant (mintedIn − burnedOut == wANET.totalSupply)
//      holds at every step, and replay is impossible.
//
// This imports the relayer's actual signing module, so it proves the off-chain
// signer and the on-chain verifier are byte-compatible — the thing that makes a
// bridge safe or drained.

const { expect } = require("chai");
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ETH = (n) => hre.ethers.parseEther(String(n));
const L1_HUB_CHAIN = 999n;

describe("End-to-end bridge round-trip (relayer ↔ contracts)", () => {
  it("lock → relayer M-of-N attest → mint → burn → (credit) with invariant intact", async () => {
    // the relayer's REAL attestation code (ESM, imported dynamically)
    const attest = await import("../../bridge-relayer/src/attest.js");

    const [deployer, pauser, user, s1, s2, s3] = await hre.ethers.getSigners();
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;

    // ── deploy the spoke (wANET + portal), wire genesis bridge ───────────────
    const W = await hre.ethers.getContractFactory("WrappedANET");
    const wanet = await W.deploy(deployer.address, deployer.address);
    await wanet.waitForDeployment();

    const signerSet = [s1, s2, s3].sort((a, b) =>
      BigInt(a.address.toLowerCase()) < BigInt(b.address.toLowerCase()) ? -1 : 1
    );
    const P = await hre.ethers.getContractFactory("AnetMintBurnPortal");
    const portal = await P.deploy(
      wanet.target, deployer.address, pauser.address,
      signerSet.map((s) => s.address), 2, ETH(1000), ETH(5000), ETH(20000)
    );
    await portal.waitForDeployment();
    await wanet.connect(deployer).setInitialBridge(portal.target);

    // ── (1) L1 side: user locks 100 native ANET on the hub (simulated) ───────
    const lock = {
      lock_id: 1n,
      l1_tx_id: "portal-lock-1",
      dst_chain_id: Number(chainId),
      dst_recipient: user.address,
      amount: ETH(100),
      deadline: BigInt((await time.latest()) + 3600),
    };

    // ── (2) relayer signers each attest the bridgeIn with the REAL attest.js ─
    const messageId = attest.computeMessageId(L1_HUB_CHAIN, hre.ethers.id(lock.l1_tx_id), lock.lock_id);
    const attestation = {
      portalAddress: portal.target,
      spokeChainId: chainId,
      messageId,
      srcChainId: L1_HUB_CHAIN,
      recipient: lock.dst_recipient,
      amount: lock.amount,
      deadline: lock.deadline,
    };
    const signed = [];
    for (const s of [signerSet[0], signerSet[1]]) {
      signed.push({ signer: s.address, sig: await attest.signBridgeIn(s, attestation) });
    }
    // the relayer verifies its own bundle before submitting
    expect(attest.countValidSigners(signed, attestation, signerSet.map((s) => s.address))).to.equal(2);
    const sigs = attest.aggregate(signed);

    // ── (3) submitter mints on the spoke ─────────────────────────────────────
    const req = {
      messageId, srcChainId: L1_HUB_CHAIN, recipient: lock.dst_recipient,
      amount: lock.amount, deadline: lock.deadline, memo: `L1 lock ${lock.l1_tx_id}`,
    };
    await portal.connect(deployer).bridgeIn(req, sigs);

    expect(await wanet.balanceOf(user.address)).to.equal(ETH(100));
    let rec = await portal.reconciliation();
    expect(rec.spokeSupply).to.equal(ETH(100));
    expect(rec.mintedIn - rec.burnedOut).to.equal(ETH(100)); // invariant

    // replay impossible: the same L1 lock can never mint twice
    await expect(portal.connect(deployer).bridgeIn(req, sigs)).to.be.revertedWith("Portal: message used");

    // ── (4) user bridges 40 back: burn on spoke → BridgeOut for L1 credit ─────
    await wanet.connect(user).approve(portal.target, ETH(40));
    const tx = await portal.connect(user).bridgeOut(
      ETH(40), "ANET1234567890ABCDEF1234567890ABCDEF1234", "cash out to L1"
    );
    const rcpt = await tx.wait();
    const ev = rcpt.logs
      .map((l) => { try { return portal.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "BridgeOut");
    expect(ev.args.amount).to.equal(ETH(40));
    expect(ev.args.l1Recipient).to.equal("ANET1234567890ABCDEF1234567890ABCDEF1234");

    // spoke supply reduced 1:1; the relayer would now credit 40 ANET on L1
    expect(await wanet.balanceOf(user.address)).to.equal(ETH(60));
    rec = await portal.reconciliation();
    expect(rec.spokeSupply).to.equal(ETH(60));
    expect(rec.mintedIn - rec.burnedOut).to.equal(ETH(60)); // invariant after round-trip

    // wANET supply never exceeds the 21M canonical cap (checked on mint)
    expect(await wanet.totalSupply()).to.be.lessThanOrEqual(ETH(21_000_000));
  });
});
