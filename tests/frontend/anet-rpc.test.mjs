// assets/js/anet-rpc.js: provider failover for the browser JSON-RPC reads (no real network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './harness.mjs';

const host = (u) => new URL(u).host;
const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** fetch stub driven by a per-host handler table; records the hosts hit in order. */
function fakeNetwork(handlers) {
  const calls = [], detail = [];
  const fetchImpl = async (url, init) => {
    const h = host(url);
    const body = JSON.parse(init.body);
    calls.push(h); detail.push({ host: h, method: Array.isArray(body) ? 'batch' : body.method });
    const handler = handlers[h] || handlers['*'];
    if (!handler) throw new TypeError('Failed to fetch');
    return handler(body, url, init);
  };
  return { fetchImpl, calls, detail };
}

test('fails over to the next endpoint on a transport error and reports the node that answered', async () => {
  const net = fakeNetwork({ 'bsc-dataseed.binance.org': (b) => okJson(reply(b.id, '0x7d74a8a')) });
  const ctx = loadModules({ solana: false, dex: false, fetch: net.fetchImpl });
  const R = ctx.AnetRpc;
  assert.equal(host(R.ENDPOINTS[56][0]), 'rpc.ankr.com', 'the project archive key stays primary');
  assert.equal(host(R.ENDPOINTS[56][1]), 'rpc.a-network.net', 'the project relay is the second tier');
  assert.equal(await R.call(56, 'eth_blockNumber'), '0x7d74a8a');
  assert.deepEqual(net.calls, ['rpc.ankr.com', 'rpc.a-network.net', 'bsc-dataseed.binance.org']);
  const s = R.status();
  assert.equal(s[56].active, 'bsc-dataseed.binance.org');
  assert.deepEqual([...s[56].down], ['rpc.ankr.com', 'rpc.a-network.net']);
  // The failed endpoint is demoted: the next call skips it instead of paying the failure again.
  net.calls.length = 0;
  assert.equal(await R.call(56, 'eth_blockNumber'), '0x7d74a8a');
  assert.deepEqual(net.calls, ['bsc-dataseed.binance.org']);
});

test('provider-side JSON-RPC errors fail over; a genuine call error surfaces immediately', async () => {
  const net = fakeNetwork({
    'rpc.ankr.com': (b) => ({ ok: false, status: 403, json: async () => rpcErr(b.id, -32000, 'Unauthorized: You must authenticate your request with an API key') }),
    'bsc-dataseed.binance.org': (b) => okJson(rpcErr(b.id, -32005, 'limit exceeded')),
    'bsc-rpc.publicnode.com': (b) => okJson(b.method === 'eth_call' && b.params[0].data === '0xdead' ? rpcErr(b.id, 3, 'execution reverted: PancakeRouter: INSUFFICIENT_OUTPUT_AMOUNT') : reply(b.id, '0x01')),
  });
  const ctx = loadModules({ solana: false, dex: false, fetch: net.fetchImpl });
  const R = ctx.AnetRpc;
  assert.equal(await R.call(56, 'eth_call', [{ to: '0x1', data: '0xbeef' }, 'latest']), '0x01');
  assert.deepEqual(net.calls, ['rpc.ankr.com', 'rpc.a-network.net', 'bsc-dataseed.binance.org', 'bsc-rpc.publicnode.com']);
  net.calls.length = 0;
  await assert.rejects(R.call(56, 'eth_call', [{ to: '0x1', data: '0xdead' }, 'latest']), /execution reverted: PancakeRouter/);
  assert.deepEqual(net.calls, ['bsc-rpc.publicnode.com'], 'a revert is not retried on other nodes');
});

test('when every endpoint fails the error says so and names the last failure', async () => {
  const net = fakeNetwork({});
  const ctx = loadModules({ solana: false, dex: false, fetch: net.fetchImpl });
  const R = ctx.AnetRpc;
  await assert.rejects(R.call(1, 'eth_blockNumber'), (e) => e.allFailed === true && /all \d+ RPC endpoints for 1 failed/.test(e.message) && /Failed to fetch/.test(e.message));
  assert.equal(net.calls.length, R.ENDPOINTS[1].length);
  assert.equal(R.status()[1].active, null);
  assert.deepEqual([...R.status()[1].down], [...R.ENDPOINTS[1]].map(host));
});

test('batch: a node without batch support is skipped; results keep call order with null for failed entries', async () => {
  const net = fakeNetwork({
    'rpc.ankr.com': () => okJson({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'batch requests are not supported' } }),
    'bsc-dataseed.binance.org': (b) => okJson(b.map((c) => (c.method === 'eth_gasPrice' ? rpcErr(c.id, -32601, 'method not found') : reply(c.id, c.method)))),
  });
  const ctx = loadModules({ solana: false, dex: false, fetch: net.fetchImpl });
  const out = await ctx.AnetRpc.batch(56, [{ method: 'eth_blockNumber' }, { method: 'eth_gasPrice' }, { method: 'eth_chainId' }]);
  assert.deepEqual([...out], ['eth_blockNumber', null, 'eth_chainId']);
  assert.deepEqual(net.calls, ['rpc.ankr.com', 'rpc.a-network.net', 'bsc-dataseed.binance.org']);
  assert.deepEqual([...ctx.AnetRpc.status()[56].down], ['rpc.a-network.net'], 'a batch rejection says nothing about single calls: only the unreachable relay is demoted');
});

test('demotion policy: unreachable or rate-limiting nodes are demoted, request-specific rejections are not', async () => {
  const net = fakeNetwork({
    'rpc.ankr.com': () => { throw new TypeError('Failed to fetch'); },                                  // transport → demote
    'rpc.a-network.net': (b) => ({ ok: false, status: 502, json: async () => rpcErr(b.id, -32603, 'all 1 upstream failed: rpc.ankr.com: transport ECONNREFUSED') }), // relay alive, upstream down → keep
    'bsc-dataseed.binance.org': (b) => okJson(rpcErr(b.id, -32601, 'the method eth_getBlockByNumber does not exist/is not available')), // → keep
    'bsc-rpc.publicnode.com': (b) => okJson(rpcErr(b.id, -32602, 'Archive requests require a personal token')),               // → keep
    'bsc-dataseed1.defibit.io': (b) => ({ ok: false, status: 429, json: async () => rpcErr(b.id, 429, 'Too Many Requests') }), // → demote
    'bsc-dataseed1.ninicoin.io': (b) => okJson(reply(b.id, '0x2a')),
  });
  const ctx = loadModules({ solana: false, dex: false, fetch: net.fetchImpl });
  assert.equal(await ctx.AnetRpc.call(56, 'eth_getBlockByNumber', ['0x1', false]), '0x2a');
  assert.deepEqual([...ctx.AnetRpc.status()[56].down], ['rpc.ankr.com', 'bsc-dataseed1.defibit.io']);
  assert.equal(ctx.AnetRpc.status()[56].active, 'bsc-dataseed1.ninicoin.io');
});

test('getLogs goes to the relay first, then Ankr; a node that refuses a range gets it halved on that node', async () => {
  const MAX = 10_000_000;
  const ranges = [];
  const net = fakeNetwork({
    'rpc.ankr.com': (b) => {
      const f = b.params[0], from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16);
      ranges.push([from, to]);
      if (to - from > MAX) return okJson(rpcErr(b.id, -32005, 'query exceeds max block range'));
      return okJson(reply(b.id, [{ blockNumber: f.fromBlock, topics: f.topics, data: '0x' }]));
    },
  });
  const ctx = loadModules({ solana: false, dex: false, fetch: net.fetchImpl });
  const R = ctx.AnetRpc;
  assert.deepEqual([...R.LOG_ENDPOINTS[56]].map(host), ['rpc.a-network.net', 'rpc.ankr.com'], 'relay (cached, stale-while-error) first, Ankr direct second; no public node can serve archive history');
  const head = 131_549_966, cut = R.alignedCut(head);
  assert.equal(cut, 131_539_999, 'cut is the last block of the previous 20,000-block window');
  const logs = await R.getLogs(56, { address: '0xvault', topics: ['0xtopic'] }, 99_500_000, head, { noSplit: true });
  assert.equal(logs.length, 4, 'two halvings: 32M -> 16M -> 8M chunks');
  assert.deepEqual([...logs].map((l) => parseInt(l.blockNumber, 16)), ranges.filter(([f, t]) => t - f <= MAX).map(([f]) => f), 'chunks are concatenated in block order');
  assert.ok(ranges.every(([f, t]) => f >= 99_500_000 && t <= head));
  assert.deepEqual([...new Set(net.calls)], ['rpc.a-network.net', 'rpc.ankr.com'], 'relay tried once (unreachable), everything else on Ankr; never a public node');
  assert.equal(R.status().logs[56].active, 'rpc.ankr.com');
  assert.deepEqual([...R.status().logs[56].down], ['rpc.a-network.net']);
});

test('getLogs splits a long scan into an aligned immutable range (shared relay cache key) plus a live tail', async () => {
  const seen = [];
  const net = fakeNetwork({
    'rpc.a-network.net': (b) => { const f = b.params[0]; seen.push([parseInt(f.fromBlock, 16), parseInt(f.toBlock, 16)]); return okJson(reply(b.id, [{ blockNumber: f.fromBlock }])); },
  });
  const ctx = loadModules({ solana: false, dex: false, fetch: net.fetchImpl });
  const R = ctx.AnetRpc;
  const head = 131_549_966;
  const logs = await R.getLogs(56, { address: '0xvault' }, 99_500_000, head);
  assert.deepEqual(seen.sort((a, b) => a[0] - b[0]), [[99_500_000, 131_539_999], [131_540_000, head]]);
  assert.deepEqual([...logs].map((l) => parseInt(l.blockNumber, 16)), [99_500_000, 131_540_000], 'historical part first, tail appended');
  assert.equal(logs.partialFrom, undefined);
  // every visitor in the same ~2.5 h window sends the identical historical request → one cache entry on the relay
  seen.length = 0;
  await R.getLogs(56, { address: '0xvault' }, 99_500_000, head + 7_000);
  assert.deepEqual(seen.sort((a, b) => a[0] - b[0])[0], [99_500_000, 131_539_999], 'same cut for a later head in the same window');
  // short ranges are not split
  seen.length = 0;
  await R.getLogs(56, { address: '0xvault' }, head - 15_000, head);
  assert.deepEqual(seen, [[head - 15_000, head]]);
});

test('getLogs allowPartialTail: a cached history survives an upstream outage even when the live tail fails', async () => {
  // Relay serves the immutable range from its stale cache (200) but 502s on the tail (its upstream is down);
  // Ankr direct is unreachable for this visitor. The page must still get the history, flagged as partial.
  const net = fakeNetwork({
    'rpc.a-network.net': (b) => {
      const f = b.params[0];
      if (f.toBlock === '0x' + (131_539_999).toString(16)) return okJson(reply(b.id, [{ blockNumber: f.fromBlock }, { blockNumber: '0x7d74000' }]));
      return { ok: false, status: 502, json: async () => rpcErr(b.id, -32603, 'all 1 upstream failed: rpc.ankr.com: transport TIMEOUT') };
    },
  });
  const ctx = loadModules({ solana: false, dex: false, fetch: net.fetchImpl });
  const R = ctx.AnetRpc;
  const head = 131_549_966;
  const logs = await R.getLogs(56, { address: '0xvault' }, 99_500_000, head, { allowPartialTail: true });
  assert.equal(logs.length, 2);
  assert.equal(logs.partialFrom, 131_540_000, 'first block NOT covered');
  assert.ok(logs.partialError && logs.partialError.allFailed);
  assert.deepEqual([...R.status().logs[56].down], ['rpc.ankr.com'], 'unreachable Ankr is demoted; the relay whose upstream is down is NOT: it still holds the cache');
  // without the option the whole scan rejects, as before
  await assert.rejects(R.getLogs(56, { address: '0xvault' }, 99_500_000, head), (e) => e.allFailed === true);
});

test('getLogs: an unreachable archive node fails fast (no range splitting) and does not demote the public reads', async () => {
  const net = fakeNetwork({ 'bsc-dataseed.binance.org': (b) => okJson(reply(b.id, '0x1')) });
  const ctx = loadModules({ solana: false, dex: false, fetch: net.fetchImpl });
  const R = ctx.AnetRpc;
  await assert.rejects(R.getLogs(56, { address: '0xvault' }, 99_500_000, 131_549_966, { noSplit: true }), (e) => e.allFailed === true);
  assert.deepEqual(net.calls, ['rpc.a-network.net', 'rpc.ankr.com'], 'one attempt per archive endpoint, no halving against nodes that cannot be reached');
  assert.equal(R.status().logs[56].active, null);
  assert.equal(await R.call(56, 'eth_blockNumber'), '0x1', 'plain reads still work through the public node');
});

test('call(eth_getLogs) from the trading terminal prefers the archive endpoints and still has the public nodes as a last resort', async () => {
  const net = fakeNetwork({ 'bsc-rpc.publicnode.com': (b) => okJson(reply(b.id, [])) });
  const ctx = loadModules({ solana: false, dex: false, fetch: net.fetchImpl });
  const R = ctx.AnetRpc;
  assert.deepEqual(await R.call(56, 'eth_getLogs', [{ address: '0xpair', fromBlock: '0x1', toBlock: '0x2' }]), []);
  assert.deepEqual(net.calls, ['rpc.a-network.net', 'rpc.ankr.com', 'bsc-dataseed.binance.org', 'bsc-rpc.publicnode.com']);
});

test('time budgets: the relay gets a short budget, and endpoints in cooldown are only probed briefly', async () => {
  const budgets = [];
  const ctx = loadModules({ solana: false, dex: false, fetch: async (url, init) => { budgets.push({ host: host(url), signal: !!init.signal }); throw new TypeError('Failed to fetch'); } });
  const R = ctx.AnetRpc;
  // Observe the timeouts through setTimeout: the harness setTimeout is the real one, so wrap it.
  const delays = [];
  const realSetTimeout = ctx.setTimeout; ctx.setTimeout = (fn, ms) => { delays.push(ms); return realSetTimeout(fn, ms); };
  await assert.rejects(R.getLogs(56, { address: '0xv' }, 1, 2, { noSplit: true }));
  assert.deepEqual(delays, [25_000, 60_000], 'relay 25 s for history, Ankr direct 60 s');
  delays.length = 0;
  await assert.rejects(R.getLogs(56, { address: '0xv' }, 1, 2, { noSplit: true }));
  assert.deepEqual(delays, [5_000, 5_000], 'both now in cooldown: 5 s probes instead of full timeouts');
  ctx.setTimeout = realSetTimeout;
});

test('reserves: Solana SPL balances fall back to the associated token accounts when the indexed query is blocked', async () => {
  const seen = [];
  const net = fakeNetwork({
    'rpc.ankr.com': () => { throw new TypeError('Failed to fetch'); },
    'solana-rpc.publicnode.com': (b) => {
      seen.push(b.method);
      if (b.method === 'getTokenAccountsByOwner') return { ok: false, status: 403, json: async () => rpcErr(b.id, -32602, 'Request blocked') };
      if (b.method === 'getMultipleAccounts') {
        const [atas] = b.params;
        assert.deepEqual(atas, ['2cVCwf4beGya6KMJG4wMfp6ufdkdUYoFdrULqDAjwWax', 'D9PEa91U4QhiBE72J4dnvoWNpMs8arCJVrtFHGbhws6Q'], 'treasury USDC/USDT ATAs (verified on-chain in dex-onchain tests)');
        return okJson(reply(b.id, { context: { slot: 1 }, value: [{ data: { parsed: { info: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tokenAmount: { uiAmount: 12.5 } } } } }, null] }));
      }
      return okJson(rpcErr(b.id, -32601, 'method not found'));
    },
  });
  const ctx = loadModules({ dex: false, reserves: true, fetch: net.fetchImpl });
  const T = ctx.AnetReserves.__test;
  const { byMint, method } = await T.solTokenBalances(ctx.AnetReserves.PUB.solTreasury, T.SOL_MINTS);
  assert.equal(method, 'getMultipleAccounts (associated token accounts)');
  assert.equal(byMint['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'], 12.5);
  assert.equal('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' in byMint, false, 'a missing ATA stays "not initialized"');
  assert.deepEqual(seen, ['getTokenAccountsByOwner', 'getMultipleAccounts']);
  assert.equal(ctx.AnetRpc.status().solana.active, 'solana-rpc.publicnode.com');
});

test('dex-onchain reads go through the shared client when it is loaded', async () => {
  const net = fakeNetwork({ 'ethereum-rpc.publicnode.com': (b) => okJson(reply(b.id, '0x' + (5n * 10n ** 18n).toString(16))) });
  const ctx = loadModules({ solana: false, bridge: false, fetch: net.fetchImpl });
  // boot() registers its RPC helpers with the terminal after an await; capture that registration.
  let provider = null;
  ctx.AnetTerminal.registerProvider = (p) => { provider = p; };
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(provider && typeof provider.evmRpc === 'function', 'provider registered');
  assert.equal(await provider.evmRpc(1, 'eth_getBalance', ['0x9C7C1058fdc9b710f688ECb7562924D9AE771417', 'latest']), '0x' + (5n * 10n ** 18n).toString(16));
  assert.deepEqual(net.detail.filter((c) => c.method === 'eth_getBalance').map((c) => c.host), ['rpc.ankr.com', 'rpc.a-network.net', 'ethereum-rpc.publicnode.com'], 'Ankr and relay unreachable → public Ethereum node');
  assert.equal(ctx.AnetRpc.status()[1].active, 'ethereum-rpc.publicnode.com');
});

test('reserves: the page asks for partial history and renders an honest note about the unscanned tail', async () => {
  // Relay serves the immutable range (stale) and 502s on the live tail; Ankr direct unreachable.
  const net = fakeNetwork({
    'rpc.a-network.net': (b) => {
      const f = b.params[0];
      if (f.toBlock === '0x' + (131_539_999).toString(16)) return okJson(reply(b.id, [{ topics: ['0x1', '0x2', '0x3'], data: '0x', blockNumber: '0x5f5e100', transactionHash: '0xaa', logIndex: '0x0' }]));
      return { ok: false, status: 502, json: async () => rpcErr(b.id, -32603, 'all 1 upstream failed: rpc.ankr.com: transport TIMEOUT') };
    },
  });
  const ctx = loadModules({ dex: false, reserves: true, fetch: net.fetchImpl });
  const T = ctx.AnetReserves.__test;
  const head = 131_549_966;
  const raw = await T.getLogs(56, { address: ctx.AnetReserves.PUB.vault, topics: ['0x1'] }, 99_500_000, head, { allowPartialTail: true });
  assert.equal(raw.length, 1, 'the wrapper forwards allowPartialTail: history survives the tail failure');
  assert.equal(raw.partialFrom, 131_540_000);
  assert.match(T.partialNote(raw, head), /from block #131,540,000 to #131,549,966 \(the most recent 9,967 blocks\) could not be scanned/);
  assert.equal(T.partialNote([], head), '', 'complete scans carry no note');
  await assert.rejects(T.getLogs(56, { address: ctx.AnetReserves.PUB.vault }, 99_500_000, head), (e) => e.allFailed === true, 'without the flag the scan still fails as a whole');
});
