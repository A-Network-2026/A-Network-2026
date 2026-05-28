const { expect } = require("chai");
const hre = require("hardhat");

const TIMELOCK_DELAY  = 48 * 60 * 60;
const EXECUTION_GRACE = 14 * 24 * 60 * 60;

async function advance(seconds) {
  await hre.ethers.provider.send("evm_increaseTime", [seconds]);
  await hre.ethers.provider.send("evm_mine");
}

// Schedule a parameter change and return the on-chain id from the
// ChangeScheduled event (we cannot trust client-side keccak because
// block.timestamp is the contract's, not ours).
async function scheduleAndGetId(tx) {
  const receipt = await tx.wait();
  const evt = receipt.logs
    .map(l => { try { return contractIface.parseLog(l); } catch { return null; } })
    .find(l => l && l.name === "ChangeScheduled");
  expect(evt, "ChangeScheduled event").to.not.be.undefined;
  return evt.args.id;
}

let contractIface;

describe("AnetSwap", function () {
  let contract, admin, pauser, operator, feeRecipient, user1, user2, stranger;

  beforeEach(async function () {
    [admin, pauser, operator, feeRecipient, user1, user2, stranger] = await hre.ethers.getSigners();
    const AnetSwap = await hre.ethers.getContractFactory("AnetSwap");
    contract = await AnetSwap.deploy(admin.address, pauser.address, operator.address, feeRecipient.address);
    await contract.waitForDeployment();
    contractIface = contract.interface;
  });

  // ── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("stores admin/pauser/operator/feeRecipient and exposes owner() shim", async function () {
      expect(await contract.admin()).to.equal(admin.address);
      expect(await contract.pauser()).to.equal(pauser.address);
      expect(await contract.operator()).to.equal(operator.address);
      expect(await contract.feeRecipient()).to.equal(feeRecipient.address);
      expect(await contract.owner()).to.equal(admin.address);
    });

    it("accepts native coin by default", async function () {
      const cfg = await contract.tokenConfigs(hre.ethers.ZeroAddress);
      expect(cfg.accepted).to.be.true;
    });

    it("default feeBps is 100 (1%)", async function () {
      expect(await contract.feeBps()).to.equal(100n);
    });

    it("rejects zero addresses in constructor", async function () {
      const AnetSwap = await hre.ethers.getContractFactory("AnetSwap");
      const Z = hre.ethers.ZeroAddress;
      await expect(AnetSwap.deploy(Z, pauser.address, operator.address, feeRecipient.address))
        .to.be.revertedWith("AnetSwap: zero admin");
      await expect(AnetSwap.deploy(admin.address, Z, operator.address, feeRecipient.address))
        .to.be.revertedWith("AnetSwap: zero pauser");
      await expect(AnetSwap.deploy(admin.address, pauser.address, Z, feeRecipient.address))
        .to.be.revertedWith("AnetSwap: zero operator");
      await expect(AnetSwap.deploy(admin.address, pauser.address, operator.address, Z))
        .to.be.revertedWith("AnetSwap: zero fee recipient");
    });
  });

  // ── Swap flows (carryover from v3.5) ──────────────────────────────────────

  describe("swapNativeForAnet", function () {
    it("records the swap and emits SwapRequested", async function () {
      const amount = hre.ethers.parseEther("0.05");
      await expect(
        contract.connect(user1).swapNativeForAnet("ANET1abc", { value: amount })
      ).to.emit(contract, "SwapRequested");
      expect(await contract.getSwapCount()).to.equal(1n);
    });

    it("collects 1% fee to feeRecipient", async function () {
      const amount = hre.ethers.parseEther("0.1");
      const fee    = (amount * 100n) / 10000n;
      const before = await hre.ethers.provider.getBalance(feeRecipient.address);
      await contract.connect(user1).swapNativeForAnet("ANET1test", { value: amount });
      const after = await hre.ethers.provider.getBalance(feeRecipient.address);
      expect(after - before).to.equal(fee);
    });

    it("rejects amounts below minimum", async function () {
      await expect(
        contract.connect(user1).swapNativeForAnet("ANET1test", { value: hre.ethers.parseEther("0.001") })
      ).to.be.revertedWith("AnetSwap: amount below minimum");
    });

    it("rejects empty ANET recipient", async function () {
      await expect(
        contract.connect(user1).swapNativeForAnet("", { value: hre.ethers.parseEther("0.05") })
      ).to.be.revertedWith("AnetSwap: invalid ANET recipient");
    });

    it("reverts when paused", async function () {
      await contract.connect(pauser).pause();
      await expect(
        contract.connect(user1).swapNativeForAnet("ANET1test", { value: hre.ethers.parseEther("0.05") })
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("swapTokenForAnet", function () {
    let mockToken;

    beforeEach(async function () {
      const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
      mockToken = await MockERC20.deploy("Mock USDT", "USDT", 18);
      await mockToken.waitForDeployment();
      await mockToken.mint(user1.address, hre.ethers.parseUnits("1000", 18));

      // Whitelist via timelock
      const tokenAddr = await mockToken.getAddress();
      const minAmt    = hre.ethers.parseUnits("1", 18);
      const tx = await contract.connect(admin).scheduleConfigureToken(
        tokenAddr, true, minAmt, 0n, 18, "USDT"
      );
      const id = await scheduleAndGetId(tx);
      await advance(TIMELOCK_DELAY + 1);
      await contract.connect(admin).executeConfigureToken(
        tokenAddr, true, minAmt, 0n, 18, "USDT", id
      );
    });

    it("records token swap and emits SwapRequested", async function () {
      const amount = hre.ethers.parseUnits("10", 18);
      const addr   = await mockToken.getAddress();
      await mockToken.connect(user1).approve(await contract.getAddress(), amount);
      await expect(
        contract.connect(user1).swapTokenForAnet(addr, amount, "ANET1testrecip")
      ).to.emit(contract, "SwapRequested");
    });

    it("rejects non-whitelisted token", async function () {
      const badToken = await (await hre.ethers.getContractFactory("MockERC20"))
        .deploy("Bad", "BAD", 18);
      await badToken.waitForDeployment();
      await badToken.mint(user1.address, hre.ethers.parseUnits("100", 18));
      await badToken.connect(user1).approve(await contract.getAddress(), hre.ethers.parseUnits("100", 18));
      await expect(
        contract.connect(user1).swapTokenForAnet(
          await badToken.getAddress(),
          hre.ethers.parseUnits("10", 18),
          "ANET1testrecip"
        )
      ).to.be.revertedWith("AnetSwap: token not accepted");
    });
  });

  // ── Operator / markProcessed ──────────────────────────────────────────────

  describe("markProcessed (operator role)", function () {
    beforeEach(async function () {
      await contract.connect(user1).swapNativeForAnet("ANET1recip", { value: hre.ethers.parseEther("0.05") });
    });

    it("operator can mark processed", async function () {
      await expect(contract.connect(operator).markProcessed(0, "L1_TX_abc"))
        .to.emit(contract, "SwapProcessed").withArgs(0n, "L1_TX_abc", operator.address);
      const swap = await contract.getSwap(0);
      expect(swap.processed).to.be.true;
    });

    it("admin can also mark processed (fallback)", async function () {
      await contract.connect(admin).markProcessed(0, "L1_TX_admin");
      expect((await contract.getSwap(0)).processed).to.be.true;
    });

    it("neither pauser nor stranger can mark processed", async function () {
      await expect(contract.connect(pauser).markProcessed(0, "L1_TX_pause"))
        .to.be.revertedWith("AnetSwap: not operator");
      await expect(contract.connect(stranger).markProcessed(0, "L1_TX_str"))
        .to.be.revertedWith("AnetSwap: not operator");
    });

    it("reverts if already processed", async function () {
      await contract.connect(operator).markProcessed(0, "L1TX1");
      await expect(contract.connect(operator).markProcessed(0, "L1TX2"))
        .to.be.revertedWith("AnetSwap: already processed");
    });
  });

  // ── Pause / Unpause role split ────────────────────────────────────────────

  describe("Pause / Unpause role split", function () {
    it("pauser can pause instantly", async function () {
      await contract.connect(pauser).pause();
      expect(await contract.paused()).to.be.true;
    });

    it("admin can also pause", async function () {
      await contract.connect(admin).pause();
      expect(await contract.paused()).to.be.true;
    });

    it("stranger cannot pause", async function () {
      await expect(contract.connect(stranger).pause())
        .to.be.revertedWith("AnetSwap: not pauser");
    });

    it("operator cannot pause", async function () {
      await expect(contract.connect(operator).pause())
        .to.be.revertedWith("AnetSwap: not pauser");
    });

    it("pauser CANNOT unpause (must go through admin timelock)", async function () {
      await contract.connect(pauser).pause();
      // pauser has no unpause path at all
      await expect(contract.connect(pauser).scheduleUnpause())
        .to.be.revertedWith("AnetSwap: not admin");
      await expect(contract.connect(pauser).executeUnpause(hre.ethers.ZeroHash))
        .to.be.revertedWith("AnetSwap: not admin");
    });

    it("admin unpause respects 48h timelock", async function () {
      await contract.connect(pauser).pause();
      const tx = await contract.connect(admin).scheduleUnpause();
      const id = await scheduleAndGetId(tx);
      // Cannot execute immediately
      await expect(contract.connect(admin).executeUnpause(id))
        .to.be.revertedWith("AnetSwap: timelock");
      await advance(TIMELOCK_DELAY + 1);
      await contract.connect(admin).executeUnpause(id);
      expect(await contract.paused()).to.be.false;
    });
  });

  // ── Timelocked admin parameter changes ────────────────────────────────────

  describe("Timelocked setFeeBps", function () {
    it("non-admin cannot schedule", async function () {
      await expect(contract.connect(stranger).scheduleFeeBps(200))
        .to.be.revertedWith("AnetSwap: not admin");
    });

    it("rejects feeBps > 500 at schedule time", async function () {
      await expect(contract.connect(admin).scheduleFeeBps(501))
        .to.be.revertedWith("AnetSwap: fee exceeds 5%");
    });

    it("respects 48h delay, then applies", async function () {
      const tx = await contract.connect(admin).scheduleFeeBps(250);
      const id = await scheduleAndGetId(tx);

      await expect(contract.connect(admin).executeFeeBps(250, id))
        .to.be.revertedWith("AnetSwap: timelock");

      await advance(TIMELOCK_DELAY + 1);
      await expect(contract.connect(admin).executeFeeBps(250, id))
        .to.emit(contract, "FeeBpsUpdated").withArgs(100n, 250n);
      expect(await contract.feeBps()).to.equal(250n);
    });

    it("rejects bait-and-switch (different value at execute)", async function () {
      const tx = await contract.connect(admin).scheduleFeeBps(250);
      const id = await scheduleAndGetId(tx);
      await advance(TIMELOCK_DELAY + 1);
      await expect(contract.connect(admin).executeFeeBps(300, id))
        .to.be.revertedWith("AnetSwap: value mismatch");
    });

    it("expires after EXECUTION_GRACE window", async function () {
      const tx = await contract.connect(admin).scheduleFeeBps(250);
      const id = await scheduleAndGetId(tx);
      // Move past ETA + 14 days
      await advance(TIMELOCK_DELAY + EXECUTION_GRACE + 1);
      await expect(contract.connect(admin).executeFeeBps(250, id))
        .to.be.revertedWith("AnetSwap: change expired");
    });

    it("can be cancelled by admin", async function () {
      const tx = await contract.connect(admin).scheduleFeeBps(250);
      const id = await scheduleAndGetId(tx);
      await contract.connect(admin).cancelChange(id);
      await advance(TIMELOCK_DELAY + 1);
      await expect(contract.connect(admin).executeFeeBps(250, id))
        .to.be.revertedWith("AnetSwap: no such change");
    });
  });

  describe("Timelocked setFeeRecipient", function () {
    it("respects 48h delay, then applies", async function () {
      const tx = await contract.connect(admin).scheduleFeeRecipient(user2.address);
      const id = await scheduleAndGetId(tx);
      await expect(contract.connect(admin).executeFeeRecipient(user2.address, id))
        .to.be.revertedWith("AnetSwap: timelock");
      await advance(TIMELOCK_DELAY + 1);
      await contract.connect(admin).executeFeeRecipient(user2.address, id);
      expect(await contract.feeRecipient()).to.equal(user2.address);
    });
  });

  describe("Timelocked setPauser / setOperator", function () {
    it("rotates pauser via 48h timelock", async function () {
      const tx = await contract.connect(admin).schedulePauser(user2.address);
      const id = await scheduleAndGetId(tx);
      await advance(TIMELOCK_DELAY + 1);
      await contract.connect(admin).executePauser(user2.address, id);
      expect(await contract.pauser()).to.equal(user2.address);
      // Old pauser no longer has the role
      await expect(contract.connect(pauser).pause())
        .to.be.revertedWith("AnetSwap: not pauser");
      // New pauser does
      await contract.connect(user2).pause();
      expect(await contract.paused()).to.be.true;
    });

    it("rotates operator via 48h timelock", async function () {
      const tx = await contract.connect(admin).scheduleOperator(user2.address);
      const id = await scheduleAndGetId(tx);
      await advance(TIMELOCK_DELAY + 1);
      await contract.connect(admin).executeOperator(user2.address, id);
      expect(await contract.operator()).to.equal(user2.address);
    });
  });

  // ── 2-step admin transfer ─────────────────────────────────────────────────

  describe("2-step admin transfer", function () {
    it("propose + accept rotates admin", async function () {
      await expect(contract.connect(admin).transferAdmin(user2.address))
        .to.emit(contract, "AdminTransferProposed").withArgs(admin.address, user2.address);
      expect(await contract.pendingAdmin()).to.equal(user2.address);
      // Original admin still in control
      expect(await contract.admin()).to.equal(admin.address);

      // Random caller cannot accept
      await expect(contract.connect(stranger).acceptAdmin())
        .to.be.revertedWith("AnetSwap: not pending admin");

      // Pending accepts
      await expect(contract.connect(user2).acceptAdmin())
        .to.emit(contract, "AdminTransferred").withArgs(admin.address, user2.address);
      expect(await contract.admin()).to.equal(user2.address);
      expect(await contract.pendingAdmin()).to.equal(hre.ethers.ZeroAddress);

      // Old admin no longer authorized
      await expect(contract.connect(admin).scheduleFeeBps(200))
        .to.be.revertedWith("AnetSwap: not admin");
    });

    it("transferAdmin(0) cancels pending", async function () {
      await contract.connect(admin).transferAdmin(user2.address);
      await contract.connect(admin).transferAdmin(hre.ethers.ZeroAddress);
      await expect(contract.connect(user2).acceptAdmin())
        .to.be.revertedWith("AnetSwap: not pending admin");
    });

    it("non-admin cannot transferAdmin", async function () {
      await expect(contract.connect(stranger).transferAdmin(user2.address))
        .to.be.revertedWith("AnetSwap: not admin");
    });
  });

  // ── Withdrawals (admin-only, not timelocked) ──────────────────────────────

  describe("Withdrawals", function () {
    beforeEach(async function () {
      // Seed the contract with some native: a swap of 0.05 BNB leaves
      // (0.05 - 1% fee) inside as netAmount only if fee forward succeeded;
      // because fee goes to feeRecipient instantly, contract has only the
      // *net* portion if the fee forward succeeded. Actually the contract
      // holds (msg.value - fee) since the fee is forwarded. Let's swap
      // a few times then check.
      await contract.connect(user1).swapNativeForAnet("ANET1a", { value: hre.ethers.parseEther("0.1") });
      await contract.connect(user1).swapNativeForAnet("ANET1b", { value: hre.ethers.parseEther("0.1") });
    });

    it("admin can withdrawNative to admin address (not timelocked)", async function () {
      const bal = await hre.ethers.provider.getBalance(await contract.getAddress());
      const before = await hre.ethers.provider.getBalance(admin.address);
      const tx = await contract.connect(admin).withdrawNative(bal);
      const receipt = await tx.wait();
      const gas = receipt.gasUsed * receipt.gasPrice;
      const after = await hre.ethers.provider.getBalance(admin.address);
      expect(after - before + gas).to.equal(bal);
    });

    it("non-admin cannot withdrawNative", async function () {
      await expect(contract.connect(operator).withdrawNative(1))
        .to.be.revertedWith("AnetSwap: not admin");
      await expect(contract.connect(pauser).withdrawNative(1))
        .to.be.revertedWith("AnetSwap: not admin");
      await expect(contract.connect(stranger).withdrawNative(1))
        .to.be.revertedWith("AnetSwap: not admin");
    });

    it("emits NativeWithdrawn event", async function () {
      const bal = await hre.ethers.provider.getBalance(await contract.getAddress());
      await expect(contract.connect(admin).withdrawNative(bal))
        .to.emit(contract, "NativeWithdrawn").withArgs(admin.address, bal);
    });
  });

  // ── getPendingSwaps view (carryover) ──────────────────────────────────────

  describe("getPendingSwaps", function () {
    it("returns only unprocessed swaps", async function () {
      await contract.connect(user1).swapNativeForAnet("ANET1a", { value: hre.ethers.parseEther("0.05") });
      await contract.connect(user1).swapNativeForAnet("ANET1b", { value: hre.ethers.parseEther("0.05") });
      await contract.connect(operator).markProcessed(0, "L1TX1");
      const [ids, swaps] = await contract.getPendingSwaps();
      expect(ids.length).to.equal(1n);
      expect(swaps[0].anetRecipient).to.equal("ANET1b");
    });
  });
});
