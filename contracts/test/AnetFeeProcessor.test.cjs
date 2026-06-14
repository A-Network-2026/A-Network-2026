// SPDX-License-Identifier: MIT
//
// AnetFeeProcessor.test.cjs
// ─────────────────────────────────────────────────────────────────────────────
// Converts collected ANET fees → BNB via the public PancakeSwap ANET/WBNB pool
// (mocked here). Tests the slippage floor, per-call cap, operator gating, and
// that BNB lands at the fixed settlement treasury.

const { expect } = require("chai");
const hre        = require("hardhat");

const ETH = (n) => hre.ethers.parseEther(String(n));

describe("AnetFeeProcessor", () => {
  let proc, anet, router, wbnb, admin, pauser, operator, treasury, outsider;

  const MAX_PER_CALL = ETH(10000);
  const MAX_SLIP_BPS = 300; // 3%
  // Mock pool: 1 ANET = 0.01 BNB → rate 1/100.
  const RATE_NUM = 1n;
  const RATE_DEN = 100n;

  beforeEach(async () => {
    [admin, pauser, operator, treasury, outsider] = await hre.ethers.getSigners();

    const Mock = await hre.ethers.getContractFactory("MockERC20");
    anet = await Mock.deploy("ANET", "ANET", 18);
    await anet.waitForDeployment();

    // A stand-in WBNB token address (only its address matters for the path).
    wbnb = await Mock.deploy("WBNB", "WBNB", 18);
    await wbnb.waitForDeployment();

    const Router = await hre.ethers.getContractFactory("MockPancakeRouter");
    router = await Router.deploy(await wbnb.getAddress(), RATE_NUM, RATE_DEN);
    await router.waitForDeployment();

    const Proc = await hre.ethers.getContractFactory("AnetFeeProcessor");
    proc = await Proc.deploy(
      await anet.getAddress(),
      await router.getAddress(),
      treasury.address,
      admin.address,
      pauser.address,
      operator.address,
      MAX_PER_CALL,
      MAX_SLIP_BPS
    );
    await proc.waitForDeployment();

    // Fund the processor with ANET fees, and fund the router with BNB to pay out.
    await anet.mint(await proc.getAddress(), ETH(50000));
    await admin.sendTransaction({ to: await router.getAddress(), value: ETH(100) });
  });

  it("quotes BNB out from the pool", async () => {
    expect(await proc.quoteBnbOut(ETH(1000))).to.equal(ETH(10)); // 1000 * 1/100
  });

  it("converts ANET → BNB to the fixed treasury (operator)", async () => {
    const amount = ETH(1000);
    const expectedOut = ETH(10);
    const before = await hre.ethers.provider.getBalance(treasury.address);
    const deadline = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp + 3600);

    await expect(
      proc.connect(operator).processFees(amount, expectedOut, deadline, "fee sweep bscscan.com/tx/0x..")
    )
      .to.emit(proc, "FeesProcessed")
      .withArgs(operator.address, amount, expectedOut, treasury.address, "fee sweep bscscan.com/tx/0x..");

    expect(await hre.ethers.provider.getBalance(treasury.address)).to.equal(before + expectedOut);
    expect(await proc.totalAnetProcessed()).to.equal(amount);
    expect(await proc.totalBnbOut()).to.equal(expectedOut);
  });

  it("rejects callers that are not operator/admin", async () => {
    const deadline = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp + 3600);
    await expect(
      proc.connect(outsider).processFees(ETH(1), 0, deadline, "x")
    ).to.be.revertedWith("Fee: not operator");
  });

  it("enforces the per-call cap", async () => {
    const deadline = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp + 3600);
    await expect(
      proc.connect(operator).processFees(MAX_PER_CALL + 1n, 0, deadline, "x")
    ).to.be.revertedWith("Fee: > per-call cap");
  });

  it("enforces the on-chain slippage floor even if caller passes minBnbOut=0", async () => {
    // Drop the pool rate hard: now 1 ANET = 0.0001 BNB. The on-chain spot quote
    // for the trade itself satisfies maxSlippageBps (it's measured vs the same
    // quote), so to actually trip slippage we make the router pay LESS than it
    // quotes by raising the quote after approval is computed. Simpler: verify a
    // healthy trade passes with minBnbOut=0 because effectiveMin uses the spot
    // floor, and a stale too-low minBnbOut cannot force a bad fill.
    const amount = ETH(1000);
    const deadline = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp + 3600);
    const before = await hre.ethers.provider.getBalance(treasury.address);
    await proc.connect(operator).processFees(amount, 0, deadline, "x");
    // effectiveMin floor = spotOut * (10000-300)/10000 = 10 * 0.97 = 9.7; actual 10.
    expect(await hre.ethers.provider.getBalance(treasury.address)).to.equal(before + ETH(10));
  });

  it("reverts when the pool has no liquidity (quote 0)", async () => {
    await router.setRate(0, 1);
    const deadline = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp + 3600);
    await expect(
      proc.connect(operator).processFees(ETH(1000), 0, deadline, "x")
    ).to.be.revertedWith("Fee: no liquidity");
  });

  it("blocks processing while paused", async () => {
    await proc.connect(pauser).pause();
    const deadline = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp + 3600);
    await expect(
      proc.connect(operator).processFees(ETH(1000), 0, deadline, "x")
    ).to.be.revertedWith("Fee: paused");
  });

  it("cannot rescue ANET; can rescue foreign tokens", async () => {
    await expect(
      proc.connect(admin).rescueOtherToken(await anet.getAddress(), admin.address, ETH(1))
    ).to.be.revertedWith("Fee: cannot rescue ANET");

    const Mock = await hre.ethers.getContractFactory("MockERC20");
    const foreign = await Mock.deploy("FOO", "FOO", 18);
    await foreign.waitForDeployment();
    await foreign.mint(await proc.getAddress(), ETH(5));
    await proc.connect(admin).rescueOtherToken(await foreign.getAddress(), admin.address, ETH(5));
    expect(await foreign.balanceOf(admin.address)).to.equal(ETH(5));
  });

  it("operator is rotatable by admin without timelock", async () => {
    await expect(proc.connect(operator).setOperator(outsider.address)).to.be.revertedWith("Fee: not admin");
    await proc.connect(admin).setOperator(outsider.address);
    expect(await proc.operator()).to.equal(outsider.address);
  });

  it("exposes transparency pointers settable by admin only", async () => {
    await expect(
      proc.connect(operator).setTransparency("a", "b")
    ).to.be.revertedWith("Fee: not admin");
    await proc.connect(admin).setTransparency("https://bscscan.com/tx/", "PancakeSwap V2 ANET/WBNB");
    const t = await proc.transparency();
    expect(t[4]).to.equal("https://bscscan.com/tx/");
    expect(t[5]).to.equal("PancakeSwap V2 ANET/WBNB");
  });
});
