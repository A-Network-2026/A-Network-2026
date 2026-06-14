// SPDX-License-Identifier: MIT
//
// AnetL2Portal.test.cjs
// ─────────────────────────────────────────────────────────────────────────────
// Canonical BSC ⇆ L2 lock-and-mint portal. The invariants tested here are the
// ones that make L2-native ANET fully 1:1 backed (not synthetic):
//   • deposit() locks ANET and credits depositId/totalDeposited 1:1.
//   • finalizeWithdrawal() releases locked ANET ONLY against M-of-N EIP-712
//     attestations of an L2 burn, bounded by caps and de-duped by withdrawalId.
//   • locked ANET can never be drained by admin (no rescue of ANET).

const { expect } = require("chai");
const hre        = require("hardhat");

const DOMAIN_NAME    = "AnetL2Portal";
const DOMAIN_VERSION = "1";
const WITHDRAW_TYPES = {
  Withdraw: [
    { name: "withdrawalId", type: "uint256" },
    { name: "l2BurnBlock",  type: "uint256" },
    { name: "l2Sender",     type: "string"  },
    { name: "recipient",    type: "address" },
    { name: "amount",       type: "uint256" },
    { name: "deadline",     type: "uint256" },
  ],
};

const ETH = (n) => hre.ethers.parseEther(String(n));

function sortAsc(addrs) {
  return [...addrs].sort((a, b) =>
    BigInt(a.toLowerCase()) < BigInt(b.toLowerCase()) ? -1 : 1
  );
}

async function signWithdraw(signer, verifyingContract, chainId, message) {
  const domain = { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId, verifyingContract };
  return signer.signTypedData(domain, WITHDRAW_TYPES, message);
}

// Deadlines must be relative to the EVM clock (other suites fast-forward time),
// not wall-clock Date.now().
async function chainDeadline(secondsAhead = 3600) {
  const block = await hre.ethers.provider.getBlock("latest");
  return BigInt(block.timestamp + secondsAhead);
}

// Build signatures sorted by signer address ascending (contract requirement).
async function buildSigs({ signers, portalAddress, chainId, message }) {
  const pairs = await Promise.all(
    signers.map(async (s) => ({
      addr: s.address,
      sig:  await signWithdraw(s, portalAddress, chainId, message),
    }))
  );
  pairs.sort((a, b) =>
    BigInt(a.addr.toLowerCase()) < BigInt(b.addr.toLowerCase()) ? -1 : 1
  );
  return pairs.map((p) => p.sig);
}

describe("AnetL2Portal", () => {
  let portal, anet, admin, pauser, user, recipient, s1, s2, s3, chainId;
  let signerSet; // sorted signer addresses

  const PER_TX     = ETH(1000);
  const PER_RECIP  = ETH(5000);
  const GLOBAL     = ETH(20000);
  const L2_CHAIN   = 204; // opBNB mainnet chainId (example)

  beforeEach(async () => {
    [admin, pauser, user, recipient, s1, s2, s3] = await hre.ethers.getSigners();
    chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

    const Mock = await hre.ethers.getContractFactory("MockERC20");
    anet = await Mock.deploy("ANET", "ANET", 18);
    await anet.waitForDeployment();

    signerSet = sortAsc([s1.address, s2.address, s3.address]);

    const Portal = await hre.ethers.getContractFactory("AnetL2Portal");
    portal = await Portal.deploy(
      await anet.getAddress(),
      L2_CHAIN,
      admin.address,
      pauser.address,
      signerSet,
      2,           // threshold 2-of-3
      PER_TX,
      PER_RECIP,
      GLOBAL
    );
    await portal.waitForDeployment();

    // Fund the user, and pre-seed the portal with locked ANET so withdrawals
    // have backing to release (simulating prior deposits).
    await anet.mint(user.address, ETH(100000));
    await anet.mint(await portal.getAddress(), ETH(50000));
  });

  // ── Deposit (BSC → L2) ───────────────────────────────────────────────────
  describe("deposit", () => {
    it("locks ANET 1:1 and emits DepositInitiated with memo", async () => {
      const amount = ETH(250);
      await anet.connect(user).approve(await portal.getAddress(), amount);

      const before = await anet.balanceOf(await portal.getAddress());
      await expect(
        portal.connect(user).deposit(amount, recipient.address, "L2 credit -> opbnbscan.com")
      )
        .to.emit(portal, "DepositInitiated")
        .withArgs(1, user.address, recipient.address, amount, "L2 credit -> opbnbscan.com");

      expect(await anet.balanceOf(await portal.getAddress())).to.equal(before + amount);
      expect(await portal.depositCount()).to.equal(1);
      expect(await portal.totalDeposited()).to.equal(amount);
      expect(await portal.expectedL2Supply()).to.equal(amount);
    });

    it("rejects zero amount, zero recipient, and over-long memo", async () => {
      await anet.connect(user).approve(await portal.getAddress(), ETH(1));
      await expect(
        portal.connect(user).deposit(0, recipient.address, "x")
      ).to.be.revertedWith("Portal: amount=0");
      await expect(
        portal.connect(user).deposit(ETH(1), hre.ethers.ZeroAddress, "x")
      ).to.be.revertedWith("Portal: l2Recipient=0");
      const longMemo = "a".repeat(257);
      await expect(
        portal.connect(user).deposit(ETH(1), recipient.address, longMemo)
      ).to.be.revertedWith("Portal: memo too long");
    });

    it("blocks deposits while paused", async () => {
      await portal.connect(pauser).pause();
      await anet.connect(user).approve(await portal.getAddress(), ETH(1));
      await expect(
        portal.connect(user).deposit(ETH(1), recipient.address, "x")
      ).to.be.revertedWith("Portal: paused");
    });
  });

  // ── Withdraw (L2 → BSC) ────────────────────────────────────────────────────
  describe("finalizeWithdrawal", () => {
    async function req(overrides = {}) {
      return {
        withdrawalId: 1n,
        l2BurnBlock:  123456n,
        l2Sender:     "0xL2SENDER",
        recipient:    recipient.address,
        amount:       ETH(100),
        deadline:     await chainDeadline(),
        memo:         "burn tx https://opbnbscan.com/tx/0xabc",
        ...overrides,
      };
    }

    async function sigsFor(r, signers) {
      const portalAddress = await portal.getAddress();
      const message = {
        withdrawalId: r.withdrawalId,
        l2BurnBlock:  r.l2BurnBlock,
        l2Sender:     r.l2Sender,
        recipient:    r.recipient,
        amount:       r.amount,
        deadline:     r.deadline,
      };
      return buildSigs({ signers, portalAddress, chainId, message });
    }

    it("releases locked ANET 1:1 with a valid 2-of-3 quorum", async () => {
      const r = await req();
      const sigs = await sigsFor(r, [s1, s2]);
      const before = await anet.balanceOf(recipient.address);

      await expect(portal.connect(user).finalizeWithdrawal(r, sigs))
        .to.emit(portal, "WithdrawalFinalized")
        .withArgs(r.withdrawalId, r.recipient, r.amount, r.l2Sender, 2, r.memo);

      expect(await anet.balanceOf(recipient.address)).to.equal(before + r.amount);
      expect(await portal.withdrawalConsumed(r.withdrawalId)).to.equal(true);
      expect(await portal.totalReleased()).to.equal(r.amount);
    });

    it("rejects below-threshold signatures", async () => {
      const r = await req();
      const sigs = await sigsFor(r, [s1]); // only 1 of 2 required
      await expect(
        portal.connect(user).finalizeWithdrawal(r, sigs)
      ).to.be.revertedWith("Portal: not enough signatures");
    });

    it("rejects a signature from a non-signer", async () => {
      const r = await req();
      const sigs = await sigsFor(r, [s1, user]); // user is not a signer
      await expect(
        portal.connect(user).finalizeWithdrawal(r, sigs)
      ).to.be.revertedWith("Portal: not a signer");
    });

    it("prevents double-release of the same withdrawalId", async () => {
      const r = await req();
      const sigs = await sigsFor(r, [s1, s2]);
      await portal.connect(user).finalizeWithdrawal(r, sigs);
      await expect(
        portal.connect(user).finalizeWithdrawal(r, sigs)
      ).to.be.revertedWith("Portal: withdrawal used");
    });

    it("enforces the per-tx cap", async () => {
      const r = await req({ amount: PER_TX + 1n });
      const sigs = await sigsFor(r, [s1, s2]);
      await expect(
        portal.connect(user).finalizeWithdrawal(r, sigs)
      ).to.be.revertedWith("Portal: > per-tx cap");
    });

    it("rejects expired attestations", async () => {
      const r = await req({ deadline: 1n });
      const sigs = await sigsFor(r, [s1, s2]);
      await expect(
        portal.connect(user).finalizeWithdrawal(r, sigs)
      ).to.be.revertedWith("Portal: expired");
    });

    it("rejects unsorted/duplicate signatures", async () => {
      const r = await req();
      // Force descending order to violate the strictly-ascending requirement.
      const portalAddress = await portal.getAddress();
      const message = {
        withdrawalId: r.withdrawalId, l2BurnBlock: r.l2BurnBlock, l2Sender: r.l2Sender,
        recipient: r.recipient, amount: r.amount, deadline: r.deadline,
      };
      const sigsSorted = await buildSigs({ signers: [s1, s2], portalAddress, chainId, message });
      const reversed = [...sigsSorted].reverse();
      await expect(
        portal.connect(user).finalizeWithdrawal(r, reversed)
      ).to.be.revertedWith("Portal: sigs not sorted/unique");
    });
  });

  // ── Safety: locked ANET cannot be rescued ──────────────────────────────────
  describe("rescue safety", () => {
    it("cannot rescue the portal's own ANET", async () => {
      await expect(
        portal.connect(admin).rescueOtherToken(await anet.getAddress(), admin.address, ETH(1))
      ).to.be.revertedWith("Portal: cannot rescue ANET");
    });

    it("can rescue a foreign token", async () => {
      const Mock = await hre.ethers.getContractFactory("MockERC20");
      const foreign = await Mock.deploy("FOO", "FOO", 18);
      await foreign.waitForDeployment();
      await foreign.mint(await portal.getAddress(), ETH(10));
      await portal.connect(admin).rescueOtherToken(await foreign.getAddress(), admin.address, ETH(10));
      expect(await foreign.balanceOf(admin.address)).to.equal(ETH(10));
    });
  });

  // ── Transparency ───────────────────────────────────────────────────────────
  it("exposes transparency pointers settable by admin only", async () => {
    await expect(
      portal.connect(user).setTransparency("a", "b", "c")
    ).to.be.revertedWith("Portal: not admin");

    await portal.connect(admin).setTransparency(
      "https://bscscan.com/tx/",
      "https://opbnbscan.com/tx/",
      "L2 ANET is 1:1 backed by ANET locked in this portal."
    );
    const t = await portal.transparency();
    expect(t[1]).to.equal(BigInt(L2_CHAIN));
    expect(t[2]).to.equal("https://bscscan.com/tx/");
    expect(t[3]).to.equal("https://opbnbscan.com/tx/");
  });

  // ── Pause is panic-only; resume requires admin ─────────────────────────────
  it("pauser can pause but only admin can unpause", async () => {
    await portal.connect(pauser).pause();
    await expect(portal.connect(pauser).unpause()).to.be.revertedWith("Portal: not admin");
    await portal.connect(admin).unpause();
    expect(await portal.paused()).to.equal(false);
  });
});
