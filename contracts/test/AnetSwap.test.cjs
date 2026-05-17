const { expect } = require("chai");
const hre = require("hardhat");

describe("AnetSwap", function () {
  let contract, owner, feeRecipient, user1, user2;

  beforeEach(async function () {
    [owner, feeRecipient, user1, user2] = await hre.ethers.getSigners();
    const AnetSwap = await hre.ethers.getContractFactory("AnetSwap");
    contract = await AnetSwap.deploy(owner.address, feeRecipient.address);
    await contract.waitForDeployment();
  });

  describe("Deployment", function () {
    it("sets the correct owner and fee recipient", async function () {
      expect(await contract.owner()).to.equal(owner.address);
      expect(await contract.feeRecipient()).to.equal(feeRecipient.address);
    });

    it("accepts native coin by default", async function () {
      const cfg = await contract.tokenConfigs(hre.ethers.ZeroAddress);
      expect(cfg.accepted).to.be.true;
    });

    it("default feeBps is 100 (1%)", async function () {
      expect(await contract.feeBps()).to.equal(100n);
    });
  });

  describe("swapNativeForAnet", function () {
    it("records the swap and emits SwapRequested", async function () {
      const amount      = hre.ethers.parseEther("0.05");
      const anetAddress = "ANET1abc123testrecipient";

      await expect(
        contract.connect(user1).swapNativeForAnet(anetAddress, { value: amount })
      ).to.emit(contract, "SwapRequested")
        .withArgs(
          0n,
          user1.address,
          anetAddress,
          hre.ethers.ZeroAddress,
          amount,
          (amount * 9900n) / 10000n,  // netAmount (1% fee)
          (amount * 100n)  / 10000n,  // fee
          (v) => typeof v === "bigint" // timestamp
        );

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
      await contract.connect(owner).pause();
      await expect(
        contract.connect(user1).swapNativeForAnet("ANET1test", { value: hre.ethers.parseEther("0.05") })
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("swapTokenForAnet", function () {
    let mockToken;

    beforeEach(async function () {
      // Deploy a simple ERC-20 mock for testing
      const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
      mockToken = await MockERC20.deploy("Mock USDT", "USDT", 18);
      await mockToken.waitForDeployment();

      // Mint some to user1
      await mockToken.mint(user1.address, hre.ethers.parseUnits("1000", 18));

      // Whitelist the mock token
      await contract.connect(owner).configureToken(
        await mockToken.getAddress(),
        true,
        hre.ethers.parseUnits("1", 18),  // min 1 USDT
        0n,                               // no max
        18,
        "USDT"
      );
    });

    it("records token swap and emits SwapRequested", async function () {
      const amount = hre.ethers.parseUnits("10", 18);
      const addr   = await mockToken.getAddress();

      await mockToken.connect(user1).approve(await contract.getAddress(), amount);
      await expect(
        contract.connect(user1).swapTokenForAnet(addr, amount, "ANET1testrecip")
      ).to.emit(contract, "SwapRequested")
        .withArgs(0n, user1.address, "ANET1testrecip", addr, amount, (amount * 9900n) / 10000n, (amount * 100n) / 10000n, (v) => typeof v === "bigint");
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

  describe("markProcessed", function () {
    it("marks a swap as processed with the L1 tx ID", async function () {
      await contract.connect(user1).swapNativeForAnet("ANET1testrecip", { value: hre.ethers.parseEther("0.05") });

      await expect(
        contract.connect(owner).markProcessed(0, "L1_TX_ANET_abc123")
      ).to.emit(contract, "SwapProcessed")
        .withArgs(0n, "L1_TX_ANET_abc123", owner.address);

      const swap = await contract.getSwap(0);
      expect(swap.processed).to.be.true;
      expect(swap.anetTxId).to.equal("L1_TX_ANET_abc123");
    });

    it("reverts if already processed", async function () {
      await contract.connect(user1).swapNativeForAnet("ANET1testrecip", { value: hre.ethers.parseEther("0.05") });
      await contract.connect(owner).markProcessed(0, "L1TX1");
      await expect(contract.connect(owner).markProcessed(0, "L1TX2"))
        .to.be.revertedWith("AnetSwap: already processed");
    });

    it("non-owner cannot call markProcessed", async function () {
      await contract.connect(user1).swapNativeForAnet("ANET1test", { value: hre.ethers.parseEther("0.05") });
      await expect(contract.connect(user1).markProcessed(0, "L1TX1"))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("getPendingSwaps", function () {
    it("returns only unprocessed swaps", async function () {
      await contract.connect(user1).swapNativeForAnet("ANET1a", { value: hre.ethers.parseEther("0.05") });
      await contract.connect(user1).swapNativeForAnet("ANET1b", { value: hre.ethers.parseEther("0.05") });
      await contract.connect(owner).markProcessed(0, "L1TX1");

      const [ids, swaps] = await contract.getPendingSwaps();
      expect(ids.length).to.equal(1n);
      expect(swaps[0].anetRecipient).to.equal("ANET1b");
    });
  });

  describe("Admin: fee and access control", function () {
    it("owner can update feeBps", async function () {
      await contract.connect(owner).setFeeBps(200);
      expect(await contract.feeBps()).to.equal(200n);
    });

    it("feeBps cannot exceed 500 (5%)", async function () {
      await expect(contract.connect(owner).setFeeBps(501))
        .to.be.revertedWith("AnetSwap: fee exceeds 5%");
    });

    it("non-owner cannot update feeBps", async function () {
      await expect(contract.connect(user1).setFeeBps(200))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});

// ── MockERC20 helper (inline for test file self-containment) ──────────────────
// Hardhat compiles all .sol files in the sources directory; add MockERC20.sol
// only in the test/ folder by using the separate file approach below.
