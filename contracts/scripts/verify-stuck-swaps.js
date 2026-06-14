/**
 * verify-stuck-swaps.js — READ-ONLY verified refund ledger.
 *
 * The contract's `processed` flag is NOT reliable: the relayer credits L1 but
 * never calls markProcessed() on BSC, so many "unprocessed" swaps are in fact
 * already credited on L1. This script cross-checks every unprocessed swap
 * against the L1 credit status so we can separate:
 *   - ALREADY CREDITED on L1  → DO NOT refund (would double-pay)
 *   - GENUINELY STUCK         → candidate for refund / credit
 *
 * For each unprocessed swap it finds the deposit txHash via the SwapRequested
 * event log (id is indexed), then queries the L1 status endpoint.
 *
 * Makes NO transactions and needs NO private key.
 *
 * Usage:
 *   npx hardhat run scripts/verify-stuck-swaps.js --network bsc
 *
 * Optional env:
 *   EVM_BRIDGE_CONTRACT_BSC / CONTRACT_ADDRESS  AnetSwap address
 *   PI_BACKEND_URL                              status API base
 *   LOG_FROM_BLOCK                              earliest block to scan logs
 */

const hre = require("hardhat");

const DEFAULT_SWAP = "0x1A1AFE5BF1ffDB64aC10958cCe2D06B22Fb47Fb8";
const DEFAULT_PI_BACKEND = "https://pi-backend-q2ye.onrender.com";
// Old blocks are pruned on publicnode for LOGS, but its block HEADERS are
// available (used for the timestamp binary search). drpc serves archive logs
// (10k-block cap, rate-limited/timeouts on free tier).
const DEFAULT_HEADER_RPC = "https://bsc-rpc.publicnode.com";
const DEFAULT_LOG_RPC = "https://bsc.drpc.org";
const LOG_CHUNK = 5000; // smaller window to reduce drpc free-tier timeouts

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

async function l1Status(piBase, txHash) {
  const url = `${piBase}/api/bridge/evm/status/${txHash}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, found: false, processed: false };
    return await res.json();
  } catch (_) {
    return { ok: false, found: false, processed: false };
  }
}

async function main() {
  const { ethers } = hre;
  const addr =
    process.env.EVM_BRIDGE_CONTRACT_BSC ||
    process.env.CONTRACT_ADDRESS ||
    DEFAULT_SWAP;
  const piBase = process.env.PI_BACKEND_URL || DEFAULT_PI_BACKEND;

  const swap = await ethers.getContractAt("AnetSwap", addr);
  const [ids, pending] = await swap.getPendingSwaps();

  console.log("AnetSwap:", addr);
  console.log("L1 status API:", piBase);
  console.log("Unprocessed swaps:", pending.length);
  console.log("");

  if (pending.length === 0) {
    console.log("Nothing unprocessed.");
    return;
  }

  // Map each unprocessed swap id -> deposit txHash via SwapRequested logs.
  // Old blocks are pruned on most public RPCs; drpc serves archive data but
  // caps free-tier getLogs to 10k-block ranges and rate-limits. We therefore
  // bound the scan tightly using the swaps' own timestamps (binary search to
  // block), then scan only that window in 10k chunks with backoff.
  const logRpc = process.env.LOG_RPC_URL || DEFAULT_LOG_RPC;
  const headerRpc = process.env.HEADER_RPC_URL || DEFAULT_HEADER_RPC;
  const topic0 = swap.interface.getEvent("SwapRequested").topicHash;
  const wantIds = new Set(ids.map((x) => x.toString()));
  const txById = new Map(); // id(string) -> txHash

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function makeRpc(endpoint) {
    return async function rpc(method, params) {
      for (let a = 0; a < 12; a++) {
        let j;
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          });
          j = await res.json();
        } catch (_) {
          await sleep(1200);
          continue;
        }
        if (j.error) {
          const msg = j.error.message || "";
          if (j.error.code === 15 || /too many|rate|timeout|free tier/i.test(msg)) {
            await sleep(1500);
            continue;
          }
          throw new Error(`${method}: ${msg}`);
        }
        return j.result;
      }
      throw new Error(`${method}: retries exhausted`);
    };
  }
  const headerCall = makeRpc(headerRpc);
  const logCall = makeRpc(logRpc);

  async function blockTimestamp(bn) {
    const b = await headerCall("eth_getBlockByNumber", ["0x" + bn.toString(16), false]);
    return parseInt(b.timestamp, 16);
  }
  // Binary search for the first block with timestamp >= target.
  async function blockForTs(targetTs, loHint, hiHint) {
    let lo = loHint, hi = hiHint;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const ts = await blockTimestamp(mid);
      if (ts < targetTs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Bound the window from swap timestamps.
  const tsList = pending.map((s) => Number(s.timestamp)).filter((t) => t > 0);
  const minTs = Math.min(...tsList) - 120;
  const maxTs = Math.max(...tsList) + 120;
  const tip = Number(await headerCall("eth_blockNumber"));
  console.log(`Header RPC ${headerRpc} | Log RPC ${logRpc}`);
  console.log(`Resolving block window for ts ${minTs}..${maxTs} (tip ${tip})`);
  const startBlock = await blockForTs(minTs, 1, tip);
  const endBlock = await blockForTs(maxTs, startBlock, tip);
  console.log(`Block window ${startBlock}..${endBlock} (${endBlock - startBlock} blocks)`);

  let scanErrors = 0;
  for (let start = startBlock; start <= endBlock && txById.size < wantIds.size; start += LOG_CHUNK) {
    const end = Math.min(start + LOG_CHUNK - 1, endBlock);
    let logs;
    try {
      logs = await logCall("eth_getLogs", [
        { address: addr, topics: [topic0], fromBlock: "0x" + start.toString(16), toBlock: "0x" + end.toString(16) },
      ]);
    } catch (e) {
      scanErrors++;
      if (scanErrors <= 5) console.log(`  getLogs error @${start}-${end}: ${e.message}`);
      continue;
    }
    for (const lg of logs) {
      const id = BigInt(lg.topics[1]).toString();
      if (wantIds.has(id) && !txById.has(id)) txById.set(id, lg.transactionHash);
    }
  }
  console.log(`Mapped ${txById.size}/${wantIds.size} swaps to deposit tx (scan errors: ${scanErrors})`);
  console.log("");

  // Token metadata cache.
  const meta = new Map();
  async function tokenMeta(t) {
    if (t === ethers.ZeroAddress) return { symbol: "BNB", decimals: 18 };
    const key = t.toLowerCase();
    if (meta.has(key)) return meta.get(key);
    const c = new ethers.Contract(t, ERC20_ABI, ethers.provider);
    let symbol = "UNKNOWN", decimals = 18;
    try { symbol = await c.symbol(); } catch (_) {}
    try { decimals = Number(await c.decimals()); } catch (_) {}
    const m = { symbol, decimals };
    meta.set(key, m);
    return m;
  }

  const credited = [];
  const stuck = [];
  const unknownTx = [];

  for (let i = 0; i < pending.length; i++) {
    const s = pending[i];
    const id = ids[i].toString();
    const m = await tokenMeta(s.tokenAddress);
    const net = ethers.formatUnits(s.netAmount, m.decimals);
    const txHash = txById.get(id);

    if (!txHash) {
      unknownTx.push({ id, symbol: m.symbol, net, depositor: s.evmSender });
      continue;
    }
    const st = await l1Status(piBase, txHash);
    const row = {
      id,
      symbol: m.symbol,
      net,
      netRaw: s.netAmount.toString(),
      token: s.tokenAddress,
      depositor: s.evmSender,
      anetRecipient: s.anetRecipient,
      txHash,
      l1: st,
    };
    if (st && st.processed) credited.push(row);
    else stuck.push(row);
  }

  console.log("══ ALREADY CREDITED on L1 (DO NOT refund) ════════════════════");
  for (const r of credited) {
    console.log(
      `#${r.id}  ${r.net} ${r.symbol}  → L1 anetTxId ${r.l1.anetTxId || "(set)"}\n` +
        `      depositor ${r.depositor}  tx ${r.txHash}`
    );
  }
  if (credited.length === 0) console.log("(none)");

  console.log("");
  console.log("══ GENUINELY STUCK (candidate for refund / credit) ══════════");
  for (const r of stuck) {
    console.log(
      `#${r.id}  ${r.net} ${r.symbol}  (L1 found=${r.l1.found} processed=${r.l1.processed})\n` +
        `      depositor ${r.depositor}\n` +
        `      anetRecipient ${r.anetRecipient}\n` +
        `      token ${r.token}\n` +
        `      netRaw ${r.netRaw}\n` +
        `      tx ${r.txHash}`
    );
  }
  if (stuck.length === 0) console.log("(none)");

  if (unknownTx.length) {
    console.log("");
    console.log("══ COULD NOT FIND deposit tx in scanned range (widen LOG_FROM_BLOCK) ══");
    for (const r of unknownTx) {
      console.log(`#${r.id}  ${r.net} ${r.symbol}  depositor ${r.depositor}`);
    }
  }

  // Stuck totals by token.
  const totals = new Map();
  for (const r of stuck) {
    const cur = totals.get(r.symbol) || 0;
    totals.set(r.symbol, cur + Number(r.net));
  }
  console.log("");
  console.log("══ STUCK totals by token ════════════════════════════════════");
  for (const [sym, sum] of totals) {
    console.log(`${sym}: ${sum}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
