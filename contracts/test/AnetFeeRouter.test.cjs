// SPDX-License-Identifier: MIT
//
// AnetFeeRouter.test.cjs
// ─────────────────────────────────────────────────────────────────────────────
// Non-custodial atomic fee-on-top router. Proves:
//   • the fee lands at the immutable treasury in the SAME tx as the swap,
//   • the swap output goes straight to the user (router `to` = user),
//   • a failed swap (slippage / deadline / bad path) takes NO fee at all,
//   • the contract never retains a balance,
//   • there is no privileged path: sweep() can only pay the treasury.

const { expect } = require("chai");
const hre        = require("hardhat");

const ETH = (n) => hre.ethers.parseEther(String(n));
const ZERO = hre.ethers.ZeroAddress;

describe("AnetFeeRouter", () => {
  let feeRouter, dexRouter, weth, anet, usdt, fot;
  let deployer, user, treasury, stranger;

  const FEE_NUM = 875n;          // 0.875 %
  const FEE_DEN = 100_000n;
  // Mock pool rate: out = in * 2 (easy to reason about).
  const RATE_NUM = 2n, RATE_DEN = 1n;

  const fee  = (x) => (x * FEE_NUM) / FEE_DEN;
  const rest = (x) => x - fee(x);
  const deadline = async () => BigInt((await hre.ethers.provider.getBlock("latest")).timestamp + 600);

  beforeEach(async () => {
    [deployer, user, treasury, stranger] = await hre.ethers.getSigners();

    const Mock = await hre.ethers.getContractFactory("MockERC20");
    weth = await Mock.deploy("Wrapped BNB", "WBNB", 18);
    anet = await Mock.deploy("A Network", "ANET", 18);
    usdt = await Mock.deploy("Tether", "USDT", 18);
    await Promise.all([weth.waitForDeployment(), anet.waitForDeployment(), usdt.waitForDeployment()]);

    const FOT = await hre.ethers.getContractFactory("MockFeeOnTransferToken");
    fot = await FOT.deploy(100); // burns 1 % per transfer
    await fot.waitForDeployment();

    const Router = await hre.ethers.getContractFactory("MockV2Router");
    dexRouter = await Router.deploy(await weth.getAddress(), RATE_NUM, RATE_DEN);
    await dexRouter.waitForDeployment();

    const FeeRouter = await hre.ethers.getContractFactory("AnetFeeRouter");
    feeRouter = await FeeRouter.deploy(await dexRouter.getAddress(), treasury.address, FEE_NUM);
    await feeRouter.waitForDeployment();

    // Fund the mock DEX with inventory so it can pay out.
    await anet.mint(await dexRouter.getAddress(), ETH(1_000_000));
    await usdt.mint(await dexRouter.getAddress(), ETH(1_000_000));
    await deployer.sendTransaction({ to: await dexRouter.getAddress(), value: ETH(50) });

    // Fund the user.
    await anet.mint(user.address, ETH(10_000));
    await usdt.mint(user.address, ETH(10_000));
    await fot.mint(user.address, ETH(10_000));
  });

  // ── Deployment ────────────────────────────────────────────────────────────

  describe("deployment", () => {
    it("stores immutable router, WETH, treasury and fee", async () => {
      expect(await feeRouter.router()).to.equal(await dexRouter.getAddress());
      expect(await feeRouter.WETH()).to.equal(await weth.getAddress());
      expect(await feeRouter.treasury()).to.equal(treasury.address);
      expect(await feeRouter.feeNumerator()).to.equal(FEE_NUM);
      expect(await feeRouter.FEE_DENOMINATOR()).to.equal(FEE_DEN);
    });

    it("rejects router=0 / treasury=0 / fee above the 3% hard cap", async () => {
      const F = await hre.ethers.getContractFactory("AnetFeeRouter");
      await expect(F.deploy(ZERO, treasury.address, FEE_NUM)).to.be.revertedWith("FeeRouter: router=0");
      await expect(F.deploy(await dexRouter.getAddress(), ZERO, FEE_NUM)).to.be.revertedWith("FeeRouter: treasury=0");
      await expect(F.deploy(await dexRouter.getAddress(), treasury.address, 3_001n)).to.be.revertedWith("FeeRouter: fee too high");
      // exactly the cap is allowed
      const ok = await F.deploy(await dexRouter.getAddress(), treasury.address, 3_000n);
      await ok.waitForDeployment();
      expect(await ok.feeNumerator()).to.equal(3_000n);
    });

    it("quoteFee splits 0.875% exactly", async () => {
      const [f, s] = await feeRouter.quoteFee(ETH(1));
      expect(f).to.equal(ETH("0.00875"));
      expect(s).to.equal(ETH("0.99125"));
      expect(f + s).to.equal(ETH(1));
    });
  });

  // ── Native → token ────────────────────────────────────────────────────────

  describe("swapExactETHForTokens (BNB → ANET)", () => {
    it("pays the fee to the treasury and the swap output to the user atomically", async () => {
      const amountIn = ETH(1);
      const path = [await weth.getAddress(), await anet.getAddress()];
      const expectedOut = rest(amountIn) * RATE_NUM / RATE_DEN;

      const tx = feeRouter.connect(user).swapExactETHForTokens(expectedOut, path, await deadline(), { value: amountIn });

      await expect(tx).to.changeEtherBalances(
        [user, treasury, dexRouter],
        [-amountIn, fee(amountIn), rest(amountIn)]
      );
      await expect(tx)
        .to.emit(feeRouter, "SwapWithFee")
        .withArgs(user.address, ZERO, await anet.getAddress(), amountIn, fee(amountIn), rest(amountIn));

      expect(await anet.balanceOf(user.address)).to.equal(ETH(10_000) + expectedOut);
      expect(await dexRouter.lastTo()).to.equal(user.address);
      expect(await dexRouter.lastAmountIn()).to.equal(rest(amountIn));
      // nothing left behind
      expect(await hre.ethers.provider.getBalance(await feeRouter.getAddress())).to.equal(0n);
    });

    it("takes NO fee when the swap reverts on slippage", async () => {
      const amountIn = ETH(1);
      const path = [await weth.getAddress(), await anet.getAddress()];
      const tooHigh = rest(amountIn) * RATE_NUM / RATE_DEN + 1n;

      const before = await hre.ethers.provider.getBalance(treasury.address);
      await expect(
        feeRouter.connect(user).swapExactETHForTokens(tooHigh, path, await deadline(), { value: amountIn })
      ).to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
      expect(await hre.ethers.provider.getBalance(treasury.address)).to.equal(before);
    });

    it("takes NO fee when the deadline has passed", async () => {
      const path = [await weth.getAddress(), await anet.getAddress()];
      const before = await hre.ethers.provider.getBalance(treasury.address);
      await expect(
        feeRouter.connect(user).swapExactETHForTokens(0, path, 1n, { value: ETH(1) })
      ).to.be.revertedWith("UniswapV2Router: EXPIRED");
      expect(await hre.ethers.provider.getBalance(treasury.address)).to.equal(before);
    });

    it("rejects a path that does not start with WETH, short paths and zero value", async () => {
      await expect(
        feeRouter.connect(user).swapExactETHForTokens(0, [await anet.getAddress(), await weth.getAddress()], await deadline(), { value: ETH(1) })
      ).to.be.revertedWith("FeeRouter: path[0] != WETH");
      await expect(
        feeRouter.connect(user).swapExactETHForTokens(0, [await weth.getAddress()], await deadline(), { value: ETH(1) })
      ).to.be.revertedWith("FeeRouter: bad path");
      await expect(
        feeRouter.connect(user).swapExactETHForTokens(0, [await weth.getAddress(), await anet.getAddress()], await deadline(), { value: 0 })
      ).to.be.revertedWith("FeeRouter: zero amount");
    });

    it("works with a zero-fee deployment (fee router becomes a pure forwarder)", async () => {
      const F = await hre.ethers.getContractFactory("AnetFeeRouter");
      const free = await F.deploy(await dexRouter.getAddress(), treasury.address, 0n);
      await free.waitForDeployment();
      const path = [await weth.getAddress(), await anet.getAddress()];
      const tx = free.connect(user).swapExactETHForTokens(0, path, await deadline(), { value: ETH(1) });
      await expect(tx).to.changeEtherBalances([treasury, dexRouter], [0n, ETH(1)]);
    });
  });

  // ── Token → native ────────────────────────────────────────────────────────

  describe("swapExactTokensForETH (ANET → BNB)", () => {
    it("pays the token fee to the treasury and the native output to the user", async () => {
      const amountIn = ETH(10); // → ~19.825 BNB out, within the mock router's 50 BNB inventory
      const path = [await anet.getAddress(), await weth.getAddress()];
      await anet.connect(user).approve(await feeRouter.getAddress(), amountIn);

      const expectedOut = rest(amountIn) * RATE_NUM / RATE_DEN;
      const tx = feeRouter.connect(user).swapExactTokensForETH(amountIn, expectedOut, path, await deadline());

      await expect(tx).to.changeEtherBalances([user, dexRouter], [expectedOut, -expectedOut]);
      await expect(tx)
        .to.emit(feeRouter, "SwapWithFee")
        .withArgs(user.address, await anet.getAddress(), ZERO, amountIn, fee(amountIn), rest(amountIn));

      expect(await anet.balanceOf(treasury.address)).to.equal(fee(amountIn));
      expect(await anet.balanceOf(user.address)).to.equal(ETH(10_000) - amountIn);
      expect(await anet.balanceOf(await feeRouter.getAddress())).to.equal(0n);
      // exact approval fully consumed by the DEX router
      expect(await anet.allowance(await feeRouter.getAddress(), await dexRouter.getAddress())).to.equal(0n);
      expect(await dexRouter.lastTo()).to.equal(user.address);
    });

    it("takes NO fee when the swap reverts (atomic)", async () => {
      const amountIn = ETH(1000);
      const path = [await anet.getAddress(), await weth.getAddress()];
      await anet.connect(user).approve(await feeRouter.getAddress(), amountIn);
      const tooHigh = rest(amountIn) * RATE_NUM / RATE_DEN + 1n;
      await expect(
        feeRouter.connect(user).swapExactTokensForETH(amountIn, tooHigh, path, await deadline())
      ).to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
      expect(await anet.balanceOf(treasury.address)).to.equal(0n);
      expect(await anet.balanceOf(user.address)).to.equal(ETH(10_000));
    });

    it("rejects a path that does not end with WETH and amounts of zero", async () => {
      await expect(
        feeRouter.connect(user).swapExactTokensForETH(ETH(1), 0, [await anet.getAddress(), await usdt.getAddress()], await deadline())
      ).to.be.revertedWith("FeeRouter: path[last] != WETH");
      await expect(
        feeRouter.connect(user).swapExactTokensForETH(0, 0, [await anet.getAddress(), await weth.getAddress()], await deadline())
      ).to.be.revertedWith("FeeRouter: zero amount");
    });

    it("reverts without allowance (never moves tokens it was not authorised to)", async () => {
      await expect(
        feeRouter.connect(user).swapExactTokensForETH(ETH(1), 0, [await anet.getAddress(), await weth.getAddress()], await deadline())
      ).to.be.revertedWith("FeeRouter: transferFrom failed");
    });
  });

  // ── Token → token ─────────────────────────────────────────────────────────

  describe("swapExactTokensForTokens (USDT → ANET)", () => {
    it("pays the fee in the input token and delivers the output token to the user", async () => {
      const amountIn = ETH(500);
      const path = [await usdt.getAddress(), await weth.getAddress(), await anet.getAddress()];
      await usdt.connect(user).approve(await feeRouter.getAddress(), amountIn);
      const expectedOut = rest(amountIn) * RATE_NUM / RATE_DEN;

      await expect(feeRouter.connect(user).swapExactTokensForTokens(amountIn, expectedOut, path, await deadline()))
        .to.emit(feeRouter, "SwapWithFee")
        .withArgs(user.address, await usdt.getAddress(), await anet.getAddress(), amountIn, fee(amountIn), rest(amountIn));

      expect(await usdt.balanceOf(treasury.address)).to.equal(fee(amountIn));
      expect(await anet.balanceOf(user.address)).to.equal(ETH(10_000) + expectedOut);
      expect(await usdt.balanceOf(await feeRouter.getAddress())).to.equal(0n);
      expect(await anet.balanceOf(await feeRouter.getAddress())).to.equal(0n);
    });

    it("charges fee-on-transfer tokens on the amount actually received", async () => {
      const amountIn = ETH(1000);
      const received = amountIn - amountIn / 100n; // token burns 1 %
      const path = [await fot.getAddress(), await anet.getAddress()];
      await fot.connect(user).approve(await feeRouter.getAddress(), amountIn);

      await expect(feeRouter.connect(user).swapExactTokensForTokens(amountIn, 0, path, await deadline()))
        .to.emit(feeRouter, "SwapWithFee")
        .withArgs(user.address, await fot.getAddress(), await anet.getAddress(), received, fee(received), rest(received));

      // treasury receives fee minus the token's own 1 % transfer burn
      expect(await fot.balanceOf(treasury.address)).to.equal(fee(received) - fee(received) / 100n);
      expect(await fot.balanceOf(await feeRouter.getAddress())).to.equal(0n);
    });

    it("blocks reentrancy from a malicious input token", async () => {
      const REE = await hre.ethers.getContractFactory("MockReentrantToken");
      const ree = await REE.deploy();
      await ree.waitForDeployment();
      await ree.mint(user.address, ETH(100));
      await ree.arm(await feeRouter.getAddress(), await anet.getAddress());
      await ree.connect(user).approve(await feeRouter.getAddress(), ETH(100));

      const path = [await ree.getAddress(), await anet.getAddress()];
      // The re-entrant call reverts with "reentrant"; the outer transfer fails because
      // the inner revert bubbles up through the token's transfer() as a failed call.
      await expect(
        feeRouter.connect(user).swapExactTokensForTokens(ETH(100), 0, path, await deadline())
      ).to.be.reverted;
      expect(await anet.balanceOf(await feeRouter.getAddress())).to.equal(0n);
    });
  });

  // ── No privileged surface ─────────────────────────────────────────────────

  describe("trust-minimisation", () => {
    it("has no owner / pause / setter functions in its ABI", async () => {
      const names = feeRouter.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.name);
      for (const forbidden of ["owner", "pause", "unpause", "setTreasury", "setFee", "setRouter", "withdraw", "upgradeTo", "transferOwnership"]) {
        expect(names, `unexpected privileged function ${forbidden}`).to.not.include(forbidden);
      }
    });

    it("rejects plain native transfers (no receive/fallback)", async () => {
      await expect(user.sendTransaction({ to: await feeRouter.getAddress(), value: ETH(1) })).to.be.reverted;
    });

    it("sweep() is permissionless and can only pay the treasury", async () => {
      // Someone sends tokens to the router by mistake.
      await anet.connect(user).transfer(await feeRouter.getAddress(), ETH(5));
      await expect(feeRouter.connect(stranger).sweep(await anet.getAddress()))
        .to.emit(feeRouter, "Swept").withArgs(await anet.getAddress(), ETH(5));
      expect(await anet.balanceOf(treasury.address)).to.equal(ETH(5));
      expect(await anet.balanceOf(stranger.address)).to.equal(0n);
      // nothing left → reverts
      await expect(feeRouter.sweep(await anet.getAddress())).to.be.revertedWith("FeeRouter: nothing to sweep");
      await expect(feeRouter.sweep(ZERO)).to.be.revertedWith("FeeRouter: nothing to sweep");
    });
  });
});
