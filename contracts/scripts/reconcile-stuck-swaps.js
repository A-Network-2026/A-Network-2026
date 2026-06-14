/**
 * reconcile-stuck-swaps.js — READ-ONLY audit of unprocessed AnetSwap deposits.
 *
 * Lists every swap the AnetSwap contract has NOT marked processed, grouped by
 * token, so we can see exactly which depositors are owed a refund (or a credit)
 * and the precise net amount each is owed. Makes NO transactions and needs NO
 * private key — it only calls view functions over a public RPC.
 *
 * Usage:
 *   npx hardhat run scripts/reconcile-stuck-swaps.js --network bsc
 *
 * Optional env:
 *   EVM_BRIDGE_CONTRACT_BSC / CONTRACT_ADDRESS  AnetSwap address
 *                                               (defaults to the live mainnet one)
 */

const hre = require("hardhat");

const DEFAULT_SWAP = "0x1A1AFE5BF1ffDB64aC10958cCe2D06B22Fb47Fb8";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const addr =
    process.env.EVM_BRIDGE_CONTRACT_BSC ||
    process.env.CONTRACT_ADDRESS ||
    DEFAULT_SWAP;

  const { ethers } = hre;
  const swap = await ethers.getContractAt("AnetSwap", addr);

  const total = await swap.getSwapCount();
  const [ids, pending] = await swap.getPendingSwaps();

  console.log("AnetSwap:", addr);
  console.log("Total swaps:", total.toString());
  console.log("Unprocessed swaps:", pending.length);
  console.log("");

  if (pending.length === 0) {
    console.log("Nothing unprocessed — no refunds owed.");
    return;
  }

  // Cache token metadata so we only fetch symbol/decimals once per token.
  const meta = new Map(); // tokenAddr(lower) -> { symbol, decimals }
  async function tokenMeta(tokenAddr) {
    const isNative = tokenAddr === ethers.ZeroAddress;
    if (isNative) return { symbol: "BNB", decimals: 18 };
    const key = tokenAddr.toLowerCase();
    if (meta.has(key)) return meta.get(key);
    const erc20 = new ethers.Contract(tokenAddr, ERC20_ABI, ethers.provider);
    let symbol = "UNKNOWN";
    let decimals = 18;
    try {
      symbol = await erc20.symbol();
    } catch (_) {}
    try {
      decimals = Number(await erc20.decimals());
    } catch (_) {}
    const m = { symbol, decimals };
    meta.set(key, m);
    return m;
  }

  // Build the per-swap refund ledger.
  const rows = [];
  const byToken = new Map(); // symbol -> { tokenAddr, decimals, netSum(bigint), count }

  for (let i = 0; i < pending.length; i++) {
    const s = pending[i];
    const m = await tokenMeta(s.tokenAddress);
    const net = s.netAmount; // bigint (ethers v6)
    rows.push({
      id: ids[i].toString(),
      symbol: m.symbol,
      token: s.tokenAddress,
      depositor: s.evmSender,
      anetRecipient: s.anetRecipient,
      netRaw: net.toString(),
      net: ethers.formatUnits(net, m.decimals),
      gross: ethers.formatUnits(s.grossAmount, m.decimals),
      fee: ethers.formatUnits(s.feePaid, m.decimals),
      when: new Date(Number(s.timestamp) * 1000).toISOString(),
    });

    const agg =
      byToken.get(m.symbol) ||
      { tokenAddr: s.tokenAddress, decimals: m.decimals, netSum: 0n, count: 0 };
    agg.netSum += net;
    agg.count += 1;
    byToken.set(m.symbol, agg);
  }

  console.log("── Unprocessed swaps (refund ledger) ─────────────────────────");
  for (const r of rows) {
    console.log(
      `#${r.id}  ${r.net} ${r.symbol}  net  (gross ${r.gross}, fee ${r.fee})\n` +
        `      depositor: ${r.depositor}\n` +
        `      anetRecipient: ${r.anetRecipient}\n` +
        `      token: ${r.token}\n` +
        `      netRaw: ${r.netRaw}\n` +
        `      when: ${r.when}`
    );
  }

  console.log("");
  console.log("── Totals owed by token (sum of net amounts) ─────────────────");
  for (const [symbol, agg] of byToken) {
    console.log(
      `${symbol}: ${ethers.formatUnits(agg.netSum, agg.decimals)} across ${agg.count} swap(s)` +
        `   [token ${agg.tokenAddr}]`
    );
  }

  console.log("");
  console.log("── Contract token balances (what is actually withdrawable) ───");
  for (const [symbol, agg] of byToken) {
    if (agg.tokenAddr === ethers.ZeroAddress) {
      const bal = await ethers.provider.getBalance(addr);
      console.log(`${symbol} (native): ${ethers.formatEther(bal)}`);
    } else {
      const erc20 = new ethers.Contract(agg.tokenAddr, ERC20_ABI, ethers.provider);
      const bal = await erc20.balanceOf(addr);
      console.log(
        `${symbol}: ${ethers.formatUnits(bal, agg.decimals)}  [token ${agg.tokenAddr}]`
      );
    }
  }

  console.log("");
  console.log(
    "NOTE: read-only. To refund, admin calls withdrawToken(token, netRaw) (sends to admin),\n" +
      "then forwards each depositor their net. withdrawToken destination is hard-wired to admin."
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
