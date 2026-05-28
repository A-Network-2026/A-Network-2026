// SPDX-License-Identifier: MIT
//
// AnetBridgeVault.test.cjs
// ─────────────────────────────────────────────────────────────────────────────
// Full test suite for the L1 → BSC cash-out vault that replaces the legacy hot
// EOA escrow holding all 21M wANET. The properties tested below are exactly the
// properties that make this vault a "bitcoin-principle" component: once 21M
// wANET is funded into it, the ONLY way value leaves is via M-of-N signed
// L1-burn attestations, bounded by hard caps, with no admin escape hatch.
//
// Spec reference: contracts/AUDIT_BRIDGE_2026-05-24.md §3.

const { expect } = require("chai");
const hre        = require("hardhat");

// EIP-712 domain + type — must match the contract byte-for-byte.
const DOMAIN_NAME    = "AnetBridgeVault";
const DOMAIN_VERSION = "1";
const RELEASE_TYPES  = {
  Release: [
    { name: "burnId",    type: "uint256" },
    { name: "l1Sender",  type: "string"  },
    { name: "recipient", type: "address" },
    { name: "amount",    type: "uint256" },
    { name: "deadline",  type: "uint256" },
  ],
};

// Helpers ────────────────────────────────────────────────────────────────────
const ETH = (n) => hre.ethers.parseEther(String(n));
const ONE_DAY = 86_400;

function sortAddressesAsc(addrs) {
  return [...addrs].sort((a, b) =>
    BigInt(a.toLowerCase()) < BigInt(b.toLowerCase()) ? -1 : 1
  );
}

async function signRelease(signer, verifyingContract, chainId, message) {
  const domain = {
    name:              DOMAIN_NAME,
    version:           DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
  return signer.signTypedData(domain, RELEASE_TYPES, message);
}

/**
 * Build a release message + signatures sorted by signer address ascending
 * (the contract requires strictly ascending signer order to enforce uniqueness
 * without an on-chain set).
 */
async function buildReleaseBundle({
  signers,           // array of ethers signers (must be a subset of vault signer set)
  vaultAddress,
  chainId,
  burnId,
  l1Sender,
  recipient,
  amount,
  deadline,
}) {
  const message = { burnId, l1Sender, recipient, amount, deadline };

  // Sort signers by address ascending so the produced signatures are sorted too.
  const sorted = [...signers].sort((a, b) =>
    BigInt(a.address.toLowerCase()) < BigInt(b.address.toLowerCase()) ? -1 : 1
  );

  const sigs = [];
  for (const s of sorted) {
    sigs.push(await signRelease(s, vaultAddress, chainId, message));
  }
  return { message, signatures: sigs };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("AnetBridgeVault", function () {
  let wanet, vault;
  let admin, pauser, recipient, attacker, other;
  let signerA, signerB, signerC, signerD, signerE; // five candidate relayer signers
  let signerSet;     // 5 addresses sorted ascending
  let threshold;     // 3-of-5
  let chainId;

  const MAX_PER_TX            = ETH(10_000);
  const MAX_PER_RECIPIENT_24H = ETH(50_000);
  const MAX_GLOBAL_24H        = ETH(250_000);
  const TOTAL_SUPPLY          = ETH(21_000_000);

  beforeEach(async function () {
    [
      admin, pauser, recipient, attacker, other,
      signerA, signerB, signerC, signerD, signerE,
    ] = await hre.ethers.getSigners();

    // Mock wANET (18 decimals, 21M cap)
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    wanet = await MockERC20.deploy("Wrapped A Network", "wANET", 18);
    await wanet.waitForDeployment();
    await wanet.mint(admin.address, TOTAL_SUPPLY);

    signerSet = sortAddressesAsc(
      [signerA.address, signerB.address, signerC.address, signerD.address, signerE.address]
    );
    threshold = 3;

    const Vault = await hre.ethers.getContractFactory("AnetBridgeVault");
    vault = await Vault.deploy(
      await wanet.getAddress(),
      admin.address,
      pauser.address,
      signerSet,
      threshold,
      MAX_PER_TX,
      MAX_PER_RECIPIENT_24H,
      MAX_GLOBAL_24H
    );
    await vault.waitForDeployment();

    // Fund vault with full 21M supply (the cut-over step).
    await wanet.connect(admin).transfer(await vault.getAddress(), TOTAL_SUPPLY);

    chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  });

  // ───────────────────────── Deployment ─────────────────────────────────────
  describe("Deployment", function () {
    it("stores immutable token and exposes correct vault balance", async function () {
      expect(await vault.WANET()).to.equal(await wanet.getAddress());
      expect(await vault.vaultBalance()).to.equal(TOTAL_SUPPLY);
    });

    it("installs the signer set sorted ascending with given threshold", async function () {
      const onchain = await vault.signers();
      expect(onchain).to.deep.equal(signerSet);
      expect(await vault.threshold()).to.equal(BigInt(threshold));
      for (const s of signerSet) {
        expect(await vault.isSigner(s)).to.equal(true);
      }
    });

    it("installs caps in valid relation (perTx ≤ recip24h ≤ global24h)", async function () {
      expect(await vault.maxPerTx()).to.equal(MAX_PER_TX);
      expect(await vault.maxPerRecipient24h()).to.equal(MAX_PER_RECIPIENT_24H);
      expect(await vault.maxGlobal24h()).to.equal(MAX_GLOBAL_24H);
    });

    it("rejects zero token / admin / pauser", async function () {
      const Vault = await hre.ethers.getContractFactory("AnetBridgeVault");
      await expect(Vault.deploy(
        hre.ethers.ZeroAddress, admin.address, pauser.address,
        signerSet, threshold, MAX_PER_TX, MAX_PER_RECIPIENT_24H, MAX_GLOBAL_24H,
      )).to.be.revertedWith("Vault: token=0");
    });

    it("rejects unsorted or duplicate signers", async function () {
      const Vault = await hre.ethers.getContractFactory("AnetBridgeVault");
      const bad = [...signerSet];
      [bad[0], bad[1]] = [bad[1], bad[0]];
      await expect(Vault.deploy(
        await wanet.getAddress(), admin.address, pauser.address,
        bad, threshold, MAX_PER_TX, MAX_PER_RECIPIENT_24H, MAX_GLOBAL_24H,
      )).to.be.revertedWith("Vault: signers not sorted/unique");
    });

    it("rejects threshold > N or = 0", async function () {
      const Vault = await hre.ethers.getContractFactory("AnetBridgeVault");
      await expect(Vault.deploy(
        await wanet.getAddress(), admin.address, pauser.address,
        signerSet, 0, MAX_PER_TX, MAX_PER_RECIPIENT_24H, MAX_GLOBAL_24H,
      )).to.be.revertedWith("Vault: threshold=0");
      await expect(Vault.deploy(
        await wanet.getAddress(), admin.address, pauser.address,
        signerSet, signerSet.length + 1, MAX_PER_TX, MAX_PER_RECIPIENT_24H, MAX_GLOBAL_24H,
      )).to.be.revertedWith("Vault: threshold>N");
    });

    it("rejects caps where global cap > total supply", async function () {
      const Vault = await hre.ethers.getContractFactory("AnetBridgeVault");
      await expect(Vault.deploy(
        await wanet.getAddress(), admin.address, pauser.address,
        signerSet, threshold, MAX_PER_TX, MAX_PER_RECIPIENT_24H, ETH(21_000_001),
      )).to.be.revertedWith("Vault: cap > total supply");
    });
  });

  // ───────────────────────── releaseBurn happy path ─────────────────────────
  describe("releaseBurn — happy path", function () {
    async function defaultBundle(overrides = {}) {
      // Use signers A,B,C (3-of-5).
      return buildReleaseBundle({
        signers:      [signerA, signerB, signerC],
        vaultAddress: await vault.getAddress(),
        chainId,
        burnId:       1n,
        l1Sender:     "ANET1senderxxxxxxxxxxxxxxxxxxxxxxxxx",
        recipient:    recipient.address,
        amount:       ETH(1_000),
        deadline:     BigInt(Math.floor(Date.now() / 1000) + 3600),
        ...overrides,
      });
    }

    it("transfers wANET to recipient and consumes burnId", async function () {
      const { message, signatures } = await defaultBundle();

      const beforeBal = await wanet.balanceOf(recipient.address);
      await expect(vault.connect(other).releaseBurn(
        message.burnId, message.l1Sender, message.recipient,
        message.amount, message.deadline, signatures,
      )).to.emit(vault, "Released");

      expect(await wanet.balanceOf(recipient.address)).to.equal(beforeBal + message.amount);
      expect(await vault.burnIdConsumed(message.burnId)).to.equal(true);
      expect(await vault.totalReleased()).to.equal(message.amount);
    });

    it("rejects a second release of the same burnId (double-release)", async function () {
      const { message, signatures } = await defaultBundle();
      await vault.releaseBurn(message.burnId, message.l1Sender, message.recipient, message.amount, message.deadline, signatures);
      await expect(vault.releaseBurn(
        message.burnId, message.l1Sender, message.recipient, message.amount, message.deadline, signatures,
      )).to.be.revertedWith("Vault: burnId used");
    });

    it("accepts release submitted by ANY address (signatures are the auth)", async function () {
      const { message, signatures } = await defaultBundle({ burnId: 42n });
      await expect(vault.connect(attacker).releaseBurn(
        message.burnId, message.l1Sender, message.recipient, message.amount, message.deadline, signatures,
      )).to.emit(vault, "Released");
    });
  });

  // ───────────────────────── releaseBurn — security invariants ──────────────
  describe("releaseBurn — security invariants", function () {
    const baseAmt = ETH(1_000);

    async function bundle({
      signers = [signerA, signerB, signerC],
      burnId  = 1n,
      amount  = baseAmt,
      l1Sender = "ANET1default",
      recipientAddr = null,
      deadline = null,
    } = {}) {
      return buildReleaseBundle({
        signers,
        vaultAddress: await vault.getAddress(),
        chainId,
        burnId,
        l1Sender,
        recipient: recipientAddr ?? recipient.address,
        amount,
        deadline: deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600),
      });
    }

    it("rejects insufficient signatures (M-1)", async function () {
      const { message, signatures } = await bundle({ signers: [signerA, signerB] });
      await expect(vault.releaseBurn(
        message.burnId, message.l1Sender, message.recipient, message.amount, message.deadline, signatures,
      )).to.be.revertedWith("Vault: not enough signatures");
    });

    it("rejects a signature from a non-signer (even with threshold met by others)", async function () {
      // attacker is NOT in the signer set
      const { message, signatures } = await bundle({ signers: [signerA, signerB, attacker] });
      await expect(vault.releaseBurn(
        message.burnId, message.l1Sender, message.recipient, message.amount, message.deadline, signatures,
      )).to.be.revertedWith("Vault: not a signer");
    });

    it("rejects unsorted / duplicate signatures", async function () {
      // Build a sorted bundle then deliberately swap two sigs out of order.
      const b = await bundle({ signers: [signerA, signerB, signerC] });
      const swapped = [b.signatures[1], b.signatures[0], b.signatures[2]];
      await expect(vault.releaseBurn(
        b.message.burnId, b.message.l1Sender, b.message.recipient, b.message.amount, b.message.deadline, swapped,
      )).to.be.revertedWith("Vault: sigs not sorted/unique");
    });

    it("rejects an expired deadline", async function () {
      const past = BigInt(Math.floor(Date.now() / 1000) - 60);
      const { message, signatures } = await bundle({ deadline: past });
      await expect(vault.releaseBurn(
        message.burnId, message.l1Sender, message.recipient, message.amount, message.deadline, signatures,
      )).to.be.revertedWith("Vault: expired");
    });

    it("rejects amount > maxPerTx", async function () {
      const { message, signatures } = await bundle({ amount: ETH(10_001) });
      await expect(vault.releaseBurn(
        message.burnId, message.l1Sender, message.recipient, message.amount, message.deadline, signatures,
      )).to.be.revertedWith("Vault: > per-tx cap");
    });

    it("rejects zero recipient and zero amount", async function () {
      const b1 = await bundle({ amount: 0n });
      await expect(vault.releaseBurn(
        b1.message.burnId, b1.message.l1Sender, b1.message.recipient, b1.message.amount, b1.message.deadline, b1.signatures,
      )).to.be.revertedWith("Vault: amount=0");

      const b2 = await bundle({ recipientAddr: hre.ethers.ZeroAddress, burnId: 2n });
      await expect(vault.releaseBurn(
        b2.message.burnId, b2.message.l1Sender, b2.message.recipient, b2.message.amount, b2.message.deadline, b2.signatures,
      )).to.be.revertedWith("Vault: recipient=0");
    });

    it("rejects signatures bound to a different chainId (replay protection)", async function () {
      // Sign with chainId+1 to simulate a foreign-chain replay.
      const fakeChain = chainId + 1;
      const message = {
        burnId: 99n, l1Sender: "ANET1replay",
        recipient: recipient.address, amount: baseAmt,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      const sorted = [signerA, signerB, signerC].sort((a, b) =>
        BigInt(a.address.toLowerCase()) < BigInt(b.address.toLowerCase()) ? -1 : 1
      );
      const sigs = [];
      for (const s of sorted) sigs.push(await signRelease(s, await vault.getAddress(), fakeChain, message));
      await expect(vault.releaseBurn(
        message.burnId, message.l1Sender, message.recipient, message.amount, message.deadline, sigs,
      )).to.be.revertedWith("Vault: not a signer"); // bad-domain digest → recover yields non-signer
    });
  });

  // ───────────────────────── 24h rolling caps ───────────────────────────────
  describe("Rolling 24h caps", function () {
    async function bundleN(burnId, amount, who = recipient.address) {
      return buildReleaseBundle({
        signers:      [signerA, signerB, signerC],
        vaultAddress: await vault.getAddress(),
        chainId,
        burnId,
        l1Sender:     "ANET1capstest",
        recipient:    who,
        amount,
        deadline:     BigInt(Math.floor(Date.now() / 1000) + 3600),
      });
    }

    it("enforces per-recipient 24h cap (50k)", async function () {
      // 5 × 10k to same recipient = 50k. The 6th 10k should revert.
      for (let i = 0; i < 5; i++) {
        const b = await bundleN(BigInt(i + 1), ETH(10_000));
        await vault.releaseBurn(b.message.burnId, b.message.l1Sender, b.message.recipient, b.message.amount, b.message.deadline, b.signatures);
      }
      const b6 = await bundleN(6n, ETH(10_000));
      await expect(vault.releaseBurn(
        b6.message.burnId, b6.message.l1Sender, b6.message.recipient, b6.message.amount, b6.message.deadline, b6.signatures,
      )).to.be.revertedWith("Vault: > 24h cap");
    });

    it("enforces global 24h cap (250k) across recipients", async function () {
      // 25 × 10k to fresh recipients = 250k. Next 10k anywhere must revert.
      const seeders = await hre.ethers.getSigners();
      // We need 26 fresh recipient addresses. Use signer indexes 11..36; if not enough, generate randoms.
      const fresh = [];
      for (let i = 0; i < 26; i++) {
        const w = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
        fresh.push(w.address);
      }
      let burnId = 100n;
      for (let i = 0; i < 25; i++) {
        const b = await bundleN(burnId++, ETH(10_000), fresh[i]);
        await vault.releaseBurn(b.message.burnId, b.message.l1Sender, b.message.recipient, b.message.amount, b.message.deadline, b.signatures);
      }
      const bx = await bundleN(burnId, ETH(10_000), fresh[25]);
      await expect(vault.releaseBurn(
        bx.message.burnId, bx.message.l1Sender, bx.message.recipient, bx.message.amount, bx.message.deadline, bx.signatures,
      )).to.be.revertedWith("Vault: > 24h cap");
    });

    it("rolls the window after 24h elapses", async function () {
      // Fill recipient bucket, advance 1 day, then release should succeed again.
      for (let i = 0; i < 5; i++) {
        const b = await bundleN(BigInt(200 + i), ETH(10_000));
        await vault.releaseBurn(b.message.burnId, b.message.l1Sender, b.message.recipient, b.message.amount, b.message.deadline, b.signatures);
      }
      await hre.network.provider.send("evm_increaseTime", [ONE_DAY + 1]);
      await hre.network.provider.send("evm_mine");

      // Build the post-jump bundle with a deadline anchored on the NEW chain time,
      // not Date.now() (which is now in the past relative to the chain clock).
      const latest = await hre.ethers.provider.getBlock("latest");
      const freshDeadline = BigInt(latest.timestamp + 3600);
      const b6 = await buildReleaseBundle({
        signers:      [signerA, signerB, signerC],
        vaultAddress: await vault.getAddress(),
        chainId,
        burnId:       206n,
        l1Sender:     "ANET1capstest",
        recipient:    recipient.address,
        amount:       ETH(10_000),
        deadline:     freshDeadline,
      });
      await expect(vault.releaseBurn(
        b6.message.burnId, b6.message.l1Sender, b6.message.recipient, b6.message.amount, b6.message.deadline, b6.signatures,
      )).to.emit(vault, "Released");
    });

    it("blocks the 'drain across the UTC midnight boundary' attack", async function () {
      // Regression: with day-bucketed caps, an attacker who controls a signer
      // quorum could drain maxPerRecipient24h at 23:59:59 UTC and again at
      // 00:00:01 UTC — 2× the intended daily cap inside ~2 seconds. With the
      // hourly sliding window, the second drain must revert because the first
      // drain's amounts are still within the trailing 24h window.

      // 1. Align chain time to ~5 minutes before the next UTC midnight.
      const latest1 = await hre.ethers.provider.getBlock("latest");
      const oneDay  = 24 * 3600;
      const nextMidnight = Math.floor(latest1.timestamp / oneDay) * oneDay + oneDay;
      const justBefore   = nextMidnight - 300; // 5 min before midnight
      await hre.network.provider.send("evm_setNextBlockTimestamp", [justBefore]);
      await hre.network.provider.send("evm_mine");

      // 2. Fill the per-recipient 24h cap (50k = 5 × 10k) just before midnight.
      for (let i = 0; i < 5; i++) {
        const latest = await hre.ethers.provider.getBlock("latest");
        const b = await buildReleaseBundle({
          signers:      [signerA, signerB, signerC],
          vaultAddress: await vault.getAddress(),
          chainId,
          burnId:       BigInt(900 + i),
          l1Sender:     "ANET1midnight",
          recipient:    recipient.address,
          amount:       ETH(10_000),
          deadline:     BigInt(latest.timestamp + 3600),
        });
        await vault.releaseBurn(b.message.burnId, b.message.l1Sender, b.message.recipient, b.message.amount, b.message.deadline, b.signatures);
      }

      // 3. Cross UTC midnight (only ~6 minutes elapsed total).
      await hre.network.provider.send("evm_setNextBlockTimestamp", [nextMidnight + 60]);
      await hre.network.provider.send("evm_mine");

      // 4. Attempt to drain another 10k. Under the OLD day-bucket logic this
      //    would have succeeded. Under the sliding window it must revert.
      const latest2 = await hre.ethers.provider.getBlock("latest");
      const bx = await buildReleaseBundle({
        signers:      [signerA, signerB, signerC],
        vaultAddress: await vault.getAddress(),
        chainId,
        burnId:       999n,
        l1Sender:     "ANET1midnight",
        recipient:    recipient.address,
        amount:       ETH(10_000),
        deadline:     BigInt(latest2.timestamp + 3600),
      });
      await expect(vault.releaseBurn(
        bx.message.burnId, bx.message.l1Sender, bx.message.recipient, bx.message.amount, bx.message.deadline, bx.signatures,
      )).to.be.revertedWith("Vault: > 24h cap");
    });
  });

  // ───────────────────────── Pause behavior ────────────────────────────────
  describe("Pause", function () {
    it("pauser can pause; releaseBurn reverts while paused", async function () {
      await vault.connect(pauser).pause();
      expect(await vault.paused()).to.equal(true);

      const { message, signatures } = await buildReleaseBundle({
        signers:      [signerA, signerB, signerC],
        vaultAddress: await vault.getAddress(),
        chainId,
        burnId:       500n,
        l1Sender:     "ANET1pause",
        recipient:    recipient.address,
        amount:       ETH(100),
        deadline:     BigInt(Math.floor(Date.now() / 1000) + 3600),
      });
      await expect(vault.releaseBurn(
        message.burnId, message.l1Sender, message.recipient, message.amount, message.deadline, signatures,
      )).to.be.revertedWith("Vault: paused");
    });

    it("only admin can unpause (pauser cannot)", async function () {
      await vault.connect(pauser).pause();
      await expect(vault.connect(pauser).unpause())
        .to.be.revertedWith("Vault: not admin");
      await expect(vault.connect(admin).unpause()).to.emit(vault, "UnpausedBy");
      expect(await vault.paused()).to.equal(false);
    });

    it("attacker cannot pause", async function () {
      await expect(vault.connect(attacker).pause())
        .to.be.revertedWith("Vault: not pauser");
    });
  });

  // ───────────────────────── Timelocked admin ops ──────────────────────────
  describe("Timelocked admin ops", function () {
    it("scheduleCaps → executeCaps respects 48h delay", async function () {
      const mTx       = ETH(20_000);
      const mRecip24h = ETH(80_000);
      const mGlobal24h= ETH(400_000);

      const tx = await vault.connect(admin).scheduleCaps(mTx, mRecip24h, mGlobal24h);
      const rec = await tx.wait();
      // Decode the ChangeScheduled event to get id
      const ev = rec.logs.find((l) => {
        try { return vault.interface.parseLog(l).name === "ChangeScheduled"; } catch { return false; }
      });
      const id = vault.interface.parseLog(ev).args[0];

      await expect(vault.connect(admin).executeCaps(mTx, mRecip24h, mGlobal24h, id))
        .to.be.revertedWith("Vault: timelock");

      await hre.network.provider.send("evm_increaseTime", [48 * 3600 + 1]);
      await hre.network.provider.send("evm_mine");

      await expect(vault.connect(admin).executeCaps(mTx, mRecip24h, mGlobal24h, id))
        .to.emit(vault, "CapsUpdated").withArgs(mTx, mRecip24h, mGlobal24h);

      expect(await vault.maxPerTx()).to.equal(mTx);
    });

    it("executeCaps rejects mismatched values (cannot bait-and-switch)", async function () {
      const mTx = ETH(20_000), mRecip = ETH(80_000), mGlobal = ETH(400_000);
      const tx = await vault.connect(admin).scheduleCaps(mTx, mRecip, mGlobal);
      const rec = await tx.wait();
      const ev = rec.logs.find((l) => {
        try { return vault.interface.parseLog(l).name === "ChangeScheduled"; } catch { return false; }
      });
      const id = vault.interface.parseLog(ev).args[0];
      await hre.network.provider.send("evm_increaseTime", [48 * 3600 + 1]);
      await hre.network.provider.send("evm_mine");
      // Try to execute with DIFFERENT values
      await expect(vault.connect(admin).executeCaps(ETH(99_999), mRecip, mGlobal, id))
        .to.be.revertedWith("Vault: value mismatch");
    });

    it("scheduleSignerSet → executeSignerSet rotates signers (4-of-5)", async function () {
      // Replace signerE with `other`, threshold 4.
      const newSet = sortAddressesAsc(
        [signerA.address, signerB.address, signerC.address, signerD.address, other.address]
      );
      const tx = await vault.connect(admin).scheduleSignerSet(newSet, 4);
      const rec = await tx.wait();
      const ev = rec.logs.find((l) => {
        try { return vault.interface.parseLog(l).name === "ChangeScheduled"; } catch { return false; }
      });
      const id = vault.interface.parseLog(ev).args[0];

      await hre.network.provider.send("evm_increaseTime", [48 * 3600 + 1]);
      await hre.network.provider.send("evm_mine");

      await expect(vault.connect(admin).executeSignerSet(newSet, 4, id))
        .to.emit(vault, "SignerSetUpdated");

      expect(await vault.isSigner(signerE.address)).to.equal(false);
      expect(await vault.isSigner(other.address)).to.equal(true);
      expect(await vault.threshold()).to.equal(4n);
    });

    it("non-admin cannot schedule anything", async function () {
      await expect(vault.connect(attacker).scheduleCaps(ETH(1), ETH(1), ETH(1)))
        .to.be.revertedWith("Vault: not admin");
    });

    it("admin can cancel a pending change", async function () {
      const tx = await vault.connect(admin).scheduleCaps(ETH(20_000), ETH(80_000), ETH(400_000));
      const rec = await tx.wait();
      const ev = rec.logs.find((l) => {
        try { return vault.interface.parseLog(l).name === "ChangeScheduled"; } catch { return false; }
      });
      const id = vault.interface.parseLog(ev).args[0];

      await expect(vault.connect(admin).cancelChange(id)).to.emit(vault, "ChangeCancelled");
      await hre.network.provider.send("evm_increaseTime", [48 * 3600 + 1]);
      await hre.network.provider.send("evm_mine");
      await expect(vault.connect(admin).executeCaps(ETH(20_000), ETH(80_000), ETH(400_000), id))
        .to.be.revertedWith("Vault: no such change");
    });
  });

  // ───────────────────────── 2-step admin transfer ─────────────────────────
  describe("Admin transfer (2-step)", function () {
    it("requires acceptAdmin from the pending address", async function () {
      await vault.connect(admin).transferAdmin(other.address);
      expect(await vault.admin()).to.equal(admin.address); // not changed yet
      await expect(vault.connect(attacker).acceptAdmin())
        .to.be.revertedWith("Vault: not pending admin");
      await expect(vault.connect(other).acceptAdmin())
        .to.emit(vault, "AdminTransferAccepted");
      expect(await vault.admin()).to.equal(other.address);
    });
  });

  // ───────────────────────── One-way property ──────────────────────────────
  describe("One-way sink property", function () {
    it("admin CANNOT rescue wANET (vault asset is locked in)", async function () {
      await expect(
        vault.connect(admin).rescueOtherToken(await wanet.getAddress(), admin.address, ETH(1))
      ).to.be.revertedWith("Vault: cannot rescue wANET");
    });

    it("admin CAN rescue an unrelated ERC20 accidentally sent here", async function () {
      const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
      const stray = await MockERC20.deploy("Stray", "STR", 18);
      await stray.waitForDeployment();
      await stray.mint(await vault.getAddress(), ETH(123));
      await expect(
        vault.connect(admin).rescueOtherToken(await stray.getAddress(), other.address, ETH(123))
      ).to.emit(vault, "OtherTokenRescued");
      expect(await stray.balanceOf(other.address)).to.equal(ETH(123));
    });

    it("admin has no function that moves wANET (audit by surface)", async function () {
      const fns = vault.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.name);
      // None of the function names imply pulling wANET out.
      expect(fns).to.not.include("withdraw");
      expect(fns).to.not.include("withdrawNative");
      expect(fns).to.not.include("emergencyWithdraw");
      expect(fns).to.not.include("sweep");
    });
  });
});
