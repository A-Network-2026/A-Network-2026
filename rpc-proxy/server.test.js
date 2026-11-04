// rpc-proxy/server.js: relay behaviour against mock upstreams (no real network).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { createProxy, loadConfig, validateCall, canonical, classifyRpcError, redact } = require('./server.js');

const ORIGIN = 'https://a-network.net';

/** Mock JSON-RPC upstream: `behave(body, req)` returns { status, body } or throws to simulate a dead socket. */
function mockUpstream(behave) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw); calls.push(body);
      let out;
      try { out = behave(body, req); } catch (_) { req.socket.destroy(); return; }
      res.writeHead(out.status || 200, { 'content-type': 'application/json' });
      res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}/v1/${'k'.repeat(24)}` })));
}
const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function startProxy(env) {
  const cfg = loadConfig({ PORT: '0', ALLOWED_ORIGINS: ORIGIN, COOLDOWN_MS: '2000', ...env });
  const { server, relay } = createProxy(cfg);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, headers = {}) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch (_) { json = undefined; }
    return { status: res.status, headers: res.headers, json, text };
  };
  const get = async (path, headers = {}) => { const res = await fetch(base + path, { headers }); return { status: res.status, headers: res.headers, json: await res.json().catch(() => undefined) }; };
  const close = () => new Promise((r) => server.close(r));
  return { base, post, get, close, relay, cfg };
}
const closeAll = (...servers) => Promise.all(servers.map((s) => new Promise((r) => s.server.close(r))));

test('fails over to the next upstream on 5xx / dead sockets, remembers the failure, and reports the node that answered', async () => {
  const bad = await mockUpstream(() => ({ status: 502, body: 'bad gateway' }));
  const dead = await mockUpstream(() => { throw new Error('socket'); });
  const good = await mockUpstream((b) => ({ body: reply(b.id, '0x7d74a8a') }));
  const p = await startProxy({ UPSTREAMS_BSC: `${bad.url},${dead.url},${good.url}` });
  try {
    const r = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 7, method: 'eth_blockNumber', params: [] });
    assert.equal(r.status, 200); assert.deepEqual(r.json, reply(7, '0x7d74a8a'));
    assert.equal(r.headers.get('x-anet-rpc-upstream'), new URL(good.url).host);
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(bad.calls.length, 1); assert.equal(dead.calls.length, 1); assert.equal(good.calls.length, 1);
    // the two failing nodes are skipped on the next call (cooldown)
    const r2 = await p.post('/rpc/56', { jsonrpc: '2.0', id: 8, method: 'eth_blockNumber' });
    assert.equal(r2.status, 200); assert.equal(bad.calls.length, 1); assert.equal(dead.calls.length, 1); assert.equal(good.calls.length, 2);
    const st = await p.get('/rpc/bsc');
    assert.deepEqual(st.json.upstreams.map((u) => u.down), [true, true, false]);
    assert.match(st.json.upstreams[0].lastError, /HTTP 502/); assert.match(st.json.upstreams[1].lastError, /transport/);
  } finally { await p.close(); await closeAll(bad, dead, good); }
});

test('only read-only allow-listed methods are relayed; eth_getLogs must name a contract', async () => {
  const up = await mockUpstream((b) => ({ body: reply(b.id, 'ok') }));
  const p = await startProxy({ UPSTREAMS_BSC: up.url, UPSTREAMS_SOLANA: up.url });
  try {
    for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'debug_traceTransaction', 'admin_peers', 'sendTransaction', 'requestAirdrop']) {
      const r = await p.post(method.startsWith('eth_') || method.includes('_') ? '/rpc/bsc' : '/rpc/solana', { jsonrpc: '2.0', id: 1, method, params: [] });
      assert.equal(r.status, 400, method); assert.equal(r.json.error.code, -32601, method);
    }
    const noAddr = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 2, method: 'eth_getLogs', params: [{ topics: ['0xaa'], fromBlock: '0x1', toBlock: '0x2' }] });
    assert.equal(noAddr.status, 400); assert.equal(noAddr.json.error.code, -32602); assert.match(noAddr.json.error.message, /contract addresses/);
    const fullBlocks = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 3, method: 'eth_getBlockByNumber', params: ['0x10', true] });
    assert.equal(fullBlocks.status, 400);
    const badParams = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 4, method: 'eth_call', params: { to: '0x1' } });
    assert.equal(badParams.status, 400); assert.equal(badParams.json.error.code, -32602);
    assert.equal(up.calls.length, 0, 'nothing invalid reached the upstream');
    const ok = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 5, method: 'eth_getLogs', params: [{ address: '0x31438362a7667ce5559500023D025c7c14168B49', topics: ['0xaa'], fromBlock: '0x1', toBlock: '0x2' }] });
    assert.equal(ok.status, 200); assert.equal(up.calls.length, 1);
    const sol = await p.post('/rpc/solana', { jsonrpc: '2.0', id: 6, method: 'getTokenAccountsByOwner', params: ['7j33RFPkNvaKsPuz2qJ5SzwiwXA4iL12ujqM4g2tRLEz', { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }] });
    assert.equal(sol.status, 200);
  } finally { await p.close(); await closeAll(up); }
});

test('eth_getLogs over a closed range is cached: the second visitor gets the same result with their own id and no upstream call', async () => {
  const logs = [{ address: '0xvault', topics: ['0xaa'], data: '0x', blockNumber: '0x5f5e100' }];
  const up = await mockUpstream((b) => ({ body: reply(b.id, logs) }));
  const p = await startProxy({ UPSTREAMS_BSC: up.url });
  try {
    const filter = { address: '0x31438362a7667ce5559500023D025c7c14168B49', topics: ['0xaa'], fromBlock: '0x5ee4a60', toBlock: '0x7d7a0cf' };
    const a = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 11, method: 'eth_getLogs', params: [filter] });
    assert.equal(a.headers.get('x-anet-rpc-cache'), 'miss'); assert.deepEqual(a.json, reply(11, logs));
    // same query, different key order and id -> hit
    const b = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 'second', method: 'eth_getLogs', params: [{ toBlock: filter.toBlock, fromBlock: filter.fromBlock, topics: filter.topics, address: filter.address }] });
    assert.equal(b.headers.get('x-anet-rpc-cache'), 'hit'); assert.deepEqual(b.json, reply('second', logs));
    assert.equal(up.calls.length, 1, 'upstream asked once');
    // open-ended ranges are never cached
    const c = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 12, method: 'eth_getLogs', params: [{ ...filter, toBlock: 'latest' }] });
    assert.equal(c.headers.get('x-anet-rpc-cache'), 'bypass'); assert.equal(up.calls.length, 2);
    const st = await p.get('/rpc'); assert.equal(st.json.cache.entries, 1); assert.equal(st.json.stats.cacheHits, 1);
  } finally { await p.close(); await closeAll(up); }
});

test('stale-while-error: when every upstream is down a cached history is still served, flagged as stale', async () => {
  let healthy = true;
  const up = await mockUpstream((b) => { if (!healthy) throw new Error('down'); return { body: reply(b.id, [{ blockNumber: '0x1' }]) }; });
  const p = await startProxy({ UPSTREAMS_BSC: up.url, CACHE_TTL_MS: '50', CACHE_STALE_MS: '60000' });
  try {
    const call = { jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: '0x31438362a7667ce5559500023D025c7c14168B49', fromBlock: '0x1', toBlock: '0x2' }] };
    assert.equal((await p.post('/rpc/bsc', call)).headers.get('x-anet-rpc-cache'), 'miss');
    await new Promise((r) => setTimeout(r, 80));
    healthy = false;
    const stale = await p.post('/rpc/bsc', { ...call, id: 2 });
    assert.equal(stale.status, 200); assert.equal(stale.headers.get('x-anet-rpc-cache'), 'stale');
    assert.match(stale.headers.get('warning'), /stale/); assert.deepEqual(stale.json, reply(2, [{ blockNumber: '0x1' }]));
    // a query that was never cached fails honestly with 502 so the browser moves on to its next endpoint
    const fresh = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 3, method: 'eth_blockNumber' });
    assert.equal(fresh.status, 502); assert.equal(fresh.json.error.code, -32603); assert.match(fresh.json.error.message, /all 1 upstream failed/);
    assert.doesNotMatch(fresh.json.error.message, /kkkkkkkk/, 'upstream paths/keys never leak');
  } finally { await p.close(); await closeAll(up); }
});

test('a genuine call error (revert) is forwarded untouched and not retried; provider errors fail over', async () => {
  const revert = { code: 3, message: 'execution reverted: PancakeRouter: INSUFFICIENT_OUTPUT_AMOUNT', data: '0x08c379a0' };
  const a = await mockUpstream((b) => ({ body: b.method === 'eth_call' ? rpcErr(b.id, revert.code, revert.message) : rpcErr(b.id, -32005, 'rate limit exceeded') }));
  const b = await mockUpstream((req) => ({ body: reply(req.id, '0x01') }));
  const p = await startProxy({ UPSTREAMS_BSC: `${a.url},${b.url}` });
  try {
    const r = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0x1', data: '0xdead' }, 'latest'] });
    assert.equal(r.status, 200); assert.equal(r.json.error.code, 3); assert.match(r.json.error.message, /execution reverted/);
    assert.equal(b.calls.length, 0, 'revert is final: second upstream not consulted');
    const r2 = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 2, method: 'eth_getBalance', params: ['0x9C7C1058fdc9b710f688ECb7562924D9AE771417', 'latest'] });
    assert.equal(r2.status, 200); assert.equal(r2.json.result, '0x01'); assert.equal(b.calls.length, 1);
    const st = await p.get('/rpc/bsc'); assert.equal(st.json.upstreams[0].down, true, 'rate-limited node is demoted');
  } finally { await p.close(); await closeAll(a, b); }
});

test('per-client rate limit counts batch entries and answers 429 with a JSON-RPC error', async () => {
  const up = await mockUpstream((b) => ({ body: Array.isArray(b) ? b.map((c) => reply(c.id, '0x1')) : reply(b.id, '0x1') }));
  const p = await startProxy({ UPSTREAMS_ETH: up.url, RATE_LIMIT_PER_MIN: '5' });
  try {
    const batch = await p.post('/rpc/eth', [1, 2, 3].map((id) => ({ jsonrpc: '2.0', id, method: 'eth_getBlockByNumber', params: ['0x' + id.toString(16), false] })), { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
    assert.equal(batch.status, 200); assert.equal(batch.headers.get('x-anet-rpc-cache'), 'bypass'); assert.deepEqual(batch.json.map((r) => r.id), [1, 2, 3]);
    assert.equal((await p.post('/rpc/eth', { jsonrpc: '2.0', id: 4, method: 'eth_chainId' }, { 'x-forwarded-for': '203.0.113.9' })).status, 200);
    assert.equal((await p.post('/rpc/eth', { jsonrpc: '2.0', id: 5, method: 'eth_chainId' }, { 'x-forwarded-for': '203.0.113.9' })).status, 200);
    const limited = await p.post('/rpc/eth', { jsonrpc: '2.0', id: 6, method: 'eth_chainId' }, { 'x-forwarded-for': '203.0.113.9' });
    assert.equal(limited.status, 429); assert.equal(limited.json.error.code, -32005); assert.equal(limited.headers.get('retry-after'), '30');
    const other = await p.post('/rpc/eth', { jsonrpc: '2.0', id: 7, method: 'eth_chainId' }, { 'cf-connecting-ip': '198.51.100.2' });
    assert.equal(other.status, 200, 'another client is unaffected');
    const tooBig = await p.post('/rpc/eth', Array.from({ length: 21 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_chainId' })), { 'x-forwarded-for': '198.51.100.3' });
    assert.equal(tooBig.status, 400);
  } finally { await p.close(); await closeAll(up); }
});

test('routing, CORS allowlist, health, unconfigured chains, body cap, gzip and key redaction', async () => {
  const up = await mockUpstream((b) => ({ body: reply(b.id, 'x'.repeat(4000)) }));
  const key = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
  // Status/redaction checks use a keyed instance that is never POSTed to (tests must not reach rpc.ankr.com).
  const keyed = await startProxy({ ANKR_KEY: key });
  const p = await startProxy({ UPSTREAMS_BSC: up.url, MAX_BODY_BYTES: '512' });
  try {
    const health = await keyed.get('/health'); assert.equal(health.status, 200); assert.equal(health.json.ok, true); assert.deepEqual(health.json.configured, ['bsc', 'eth', 'solana']);
    const status = await keyed.get('/');
    assert.equal(status.json.chains.bsc.upstreams[0].upstream, 'rpc.ankr.com/bsc/***');
    assert.doesNotMatch(JSON.stringify(status.json), new RegExp(key), 'status never shows the key');
    assert.deepEqual((await p.get('/health')).json.configured, ['bsc']);
    assert.equal((await p.get('/rpc/dogecoin')).status, 404);
    assert.equal((await p.get('/rpc/bsc/extra')).status, 404);
    assert.equal((await p.post('/rpc/bsc', '{not json')).status, 400);
    const r = await p.post('/rpc/eth', { jsonrpc: '2.0', id: 1, method: 'eth_chainId' }); // no upstream for eth on this instance
    assert.equal(r.status, 503); assert.match(r.json.error.message, /no upstream configured/);
    const big = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0x1', data: '0x' + 'ff'.repeat(600) }, 'latest'] });
    assert.equal(big.status, 413);
    // CORS: allowed origin echoes, unknown origin gets nothing (the browser then blocks it), preflight is 204
    const pre = await fetch(p.base + '/rpc/bsc', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN); assert.match(pre.headers.get('access-control-allow-headers'), /content-type/);
    const foreign = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 1, method: 'eth_chainId' }, { origin: 'https://evil.example' });
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    // gzip for compressible bodies when the client accepts it (raw socket: fetch would transparently inflate)
    const gz = await rawPost(p.base + '/rpc/bsc', JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'eth_getBalance', params: ['0x9C7C1058fdc9b710f688ECb7562924D9AE771417', 'latest'] }), { 'accept-encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip'); assert.ok(gz.body.length < 1000, 'compressed');
    const inflated = JSON.parse(zlib.gunzipSync(gz.body).toString('utf8'));
    assert.equal(inflated.id, 9); assert.equal(inflated.result.length, 4000);
    const plain = await rawPost(p.base + '/rpc/bsc', JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'eth_getBalance', params: ['0x9C7C1058fdc9b710f688ECb7562924D9AE771417', 'latest'] }), {});
    assert.equal(plain.headers['content-encoding'], undefined); assert.equal(JSON.parse(plain.body.toString('utf8')).id, 10);
  } finally { await p.close(); await keyed.close(); await closeAll(up); }
});

function rawPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('upstream timeout is enforced and the slow node is skipped afterwards', async () => {
  const slow = await mockUpstream(() => new Promise(() => {})); // never answers
  // mockUpstream expects a sync return; emulate "hang" by never ending the response
  slow.server.removeAllListeners('request'); slow.server.on('request', (req) => { req.on('data', () => {}); slow.calls.push(1); });
  const fast = await mockUpstream((b) => ({ body: reply(b.id, '0x2') }));
  const p = await startProxy({ UPSTREAMS_BSC: `${slow.url},${fast.url}`, UPSTREAM_TIMEOUT_MS: '300' });
  try {
    const t0 = Date.now();
    const r = await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 1, method: 'eth_chainId' });
    assert.equal(r.status, 200); assert.equal(r.json.result, '0x2'); assert.ok(Date.now() - t0 < 2000);
    const st = await p.get('/rpc/bsc'); assert.equal(st.json.upstreams[0].down, true); assert.match(st.json.upstreams[0].lastError, /TIMEOUT/);
    await p.post('/rpc/bsc', { jsonrpc: '2.0', id: 2, method: 'eth_chainId' });
    assert.equal(slow.calls.length, 1, 'slow node skipped during cooldown');
  } finally { await p.close(); slow.server.closeAllConnections?.(); await closeAll(slow, fast); }
});

test('pure helpers: validation, canonical form, error classification, redaction', () => {
  assert.equal(validateCall('bsc', { id: 1, method: 'eth_chainId' }), null);
  assert.equal(validateCall('bsc', { id: 1, method: 'eth_getLogs', params: [{ address: ['0x31438362a7667ce5559500023D025c7c14168B49', '0x791055A7d52AA392eaE8De04250497f33807E46A'], fromBlock: 'earliest', toBlock: 'latest' }] }), null);
  assert.equal(validateCall('bsc', { id: 1, method: 'eth_getLogs', params: [{ address: 'nope' }] }).error.code, -32602);
  assert.equal(validateCall('bsc', { id: 1, method: 'eth_getLogs', params: [{ address: '0x31438362a7667ce5559500023D025c7c14168B49', topics: [1, 2, 3, 4, 5] }] }).error.code, -32602);
  assert.equal(validateCall('bsc', { id: 1, method: 'eth_getLogs', params: [{ address: '0x31438362a7667ce5559500023D025c7c14168B49', fromBlock: '12' }] }).error.code, -32602);
  assert.equal(validateCall('bsc', { id: {}, method: 'eth_chainId' }).error.code, -32600);
  assert.equal(validateCall('solana', { id: 1, method: 'eth_chainId' }).error.code, -32601);
  assert.equal(canonical({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}');
  assert.deepEqual(classifyRpcError({ code: -32005, message: 'limit exceeded' }), { action: 'retry', demote: true });
  assert.deepEqual(classifyRpcError({ code: -32000, message: 'Unauthorized: You must authenticate your request with an API key' }), { action: 'retry', demote: true });
  assert.equal(classifyRpcError({ code: -32601, message: 'the method eth_getLogs does not exist/is not available' }).action, 'retry');
  assert.equal(classifyRpcError({ code: -32601, message: 'the method eth_getLogs does not exist/is not available' }).demote, false);
  assert.equal(classifyRpcError({ code: 3, message: 'execution reverted' }).action, 'forward');
  assert.equal(classifyRpcError({ code: -32000, message: 'exceed maximum block range: 50000' }).action, 'forward');
  assert.equal(redact('https://rpc.ankr.com/bsc/3ce3cd9f0dfa278ed38509a065305c94912b7350a2c1e3b4714d0554b60db218'), 'rpc.ankr.com/bsc/***');
  assert.equal(redact('https://bsc-dataseed.binance.org'), 'bsc-dataseed.binance.org');
  assert.equal(redact('https://1rpc.io/bnb'), '1rpc.io/bnb');
  assert.equal(redact('https://eth-mainnet.g.alchemy.com/v2/abcdefghijkl'), 'eth-mainnet.g.alchemy.com/v2/***');
});
