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
  assert.equal(await R.call(56, 'eth_blockNumber'), '0x7d74a8a');
  assert.deepEqual(net.calls, ['rpc.ankr.com', 'bsc-dataseed.binance.org']);
  const s = R.status();
  assert.equal(s[56].active, 'bsc-dataseed.binance.org');
  assert.deepEqual([...s[56].down], ['rpc.ankr.com']);
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
  assert.deepEqual(net.calls, ['rpc.ankr.com', 'bsc-dataseed.binance.org', 'bsc-rpc.publicnode.com']);
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
  assert.deepEqual(net.calls, ['rpc.ankr.com', 'bsc-dataseed.binance.org']);
  assert.deepEqual([...ctx.AnetRpc.status()[56].down], [], 'a batch rejection says nothing about single calls: nobody is demoted');
});

test('demotion policy: unreachable or rate-limiting nodes are demoted, request-specific rejections are not', async () => {
  const net = fakeNetwork({
    'rpc.ankr.com': () => { throw new TypeError('Failed to fetch'); },                                  // transport → demote
    'bsc-dataseed.binance.org': (b) => okJson(rpcErr(b.id, -32601, 'the method eth_getLogs does not exist/is not available')), // → keep
    'bsc-rpc.publicnode.com': (b) => okJson(rpcErr(b.id, -32602, 'Archive requests require a personal token')),               // → keep
    'bsc-dataseed1.defibit.io': (b) => ({ ok: false, status: 429, json: async () => rpcErr(b.id, 429, 'Too Many Requests') }), // → demote
    'bsc-dataseed1.ninicoin.io': (b) => okJson(reply(b.id, '0x2a')),
  });
  const ctx = loadModules({ solana: false, dex: false, fetch: net.fetchImpl });
  assert.equal(await ctx.AnetRpc.call(56, 'eth_getLogs', [{}]), '0x2a');
  assert.deepEqual([...ctx.AnetRpc.status()[56].down], ['rpc.ankr.com', 'bsc-dataseed1.defibit.io']);
  assert.equal(ctx.AnetRpc.status()[56].active, 'bsc-dataseed1.ninicoin.io');
});

test('getLogs only uses archive-capable endpoints and splits the range when the node refuses it', async () => {
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
  assert.deepEqual([...R.LOG_ENDPOINTS[56]].map(host), ['rpc.ankr.com'], 'public nodes cap or refuse historical eth_getLogs');
  const logs = await R.getLogs(56, { address: '0xvault', topics: ['0xtopic'] }, 99_500_000, 131_549_966);
  assert.equal(logs.length, 4, 'two halvings: 32M -> 16M -> 8M chunks');
  assert.deepEqual([...logs].map((l) => parseInt(l.blockNumber, 16)), ranges.filter(([f, t]) => t - f <= MAX).map(([f]) => f), 'chunks are concatenated in block order');
  assert.ok(ranges.every(([f, t]) => f >= 99_500_000 && t <= 131_549_966));
  assert.ok(net.calls.every((h) => h === 'rpc.ankr.com'), 'never falls back to a non-archive node for logs');
  assert.equal(R.status().logs[56].active, 'rpc.ankr.com');
});

test('getLogs: an unreachable archive node fails fast (no range splitting) and does not demote the public reads', async () => {
  const net = fakeNetwork({ 'bsc-dataseed.binance.org': (b) => okJson(reply(b.id, '0x1')) });
  const ctx = loadModules({ solana: false, dex: false, fetch: net.fetchImpl });
  const R = ctx.AnetRpc;
  await assert.rejects(R.getLogs(56, { address: '0xvault' }, 99_500_000, 131_549_966), (e) => e.allFailed === true);
  assert.deepEqual(net.calls, ['rpc.ankr.com'], 'one attempt, no halving against a node that cannot be reached');
  assert.equal(R.status().logs[56].active, null);
  assert.equal(await R.call(56, 'eth_blockNumber'), '0x1', 'plain reads still work through the public node');
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
  assert.deepEqual(net.detail.filter((c) => c.method === 'eth_getBalance').map((c) => c.host), ['rpc.ankr.com', 'ethereum-rpc.publicnode.com'], 'Ankr unreachable → public Ethereum node');
  assert.equal(ctx.AnetRpc.status()[1].active, 'ethereum-rpc.publicnode.com');
});
