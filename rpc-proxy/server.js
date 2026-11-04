/**
 * A Network read-only JSON-RPC relay
 * rpc-proxy/server.js  |  2026
 *
 * Runs on the project's own domain (rpc.a-network.net) so the website's chain
 * reads keep working for visitors whose network cannot reach the public RPC
 * providers directly (the November 2026 incident: rpc.ankr.com presenting a
 * wrong TLS certificate in some regions). The browser client
 * (assets/js/anet-rpc.js) treats this service as ONE endpoint among several:
 * if it is down the page falls back to the providers directly, so the relay
 * can never become a new single point of failure.
 *
 * What it does
 *   - POST /rpc/:chain   chain = bsc | eth | solana  (aliases: 56, 1, bnb, sol)
 *     Validates the JSON-RPC body (read-only method allowlist, bounded size),
 *     forwards it to the first healthy upstream, fails over on provider errors,
 *     returns genuine call errors (e.g. an eth_call revert) untouched.
 *   - Result cache for immutable queries (eth_getLogs over a closed block range,
 *     eth_getBlockByNumber by number): fresh for CACHE_TTL_MS, and served STALE
 *     for up to CACHE_STALE_MS when every upstream is down, so the proof-of-
 *     reserves history survives a provider outage.
 *   - Per-IP rate limit, global concurrency cap, upstream timeouts, body caps,
 *     gzip, CORS allowlist, graceful shutdown, /health for the platform.
 *
 * Zero dependencies: Node >= 20 built-ins only. No state on disk.
 *
 * Configuration (environment)
 *   PORT                     listen port (Render sets it)
 *   ANKR_KEY                 Ankr project key -> https://rpc.ankr.com/<chain>/<key> is the first upstream
 *   UPSTREAMS_BSC / UPSTREAMS_ETH / UPSTREAMS_SOLANA
 *                            comma-separated extra upstream URLs tried after Ankr (archive-capable
 *                            nodes recommended; keys may be in the URL, they are never logged)
 *   ALLOWED_ORIGINS          comma-separated browser origins (default: https://a-network.net, https://www.a-network.net)
 *   RATE_LIMIT_PER_MIN       per client IP, batch entries count individually (default 240)
 *   MAX_CONCURRENCY          upstream requests in flight (default 24)
 *   UPSTREAM_TIMEOUT_MS      per upstream attempt (default 10000; eth_getLogs uses LOGS_TIMEOUT_MS, default 20000)
 *   PROBE_TIMEOUT_MS         budget for re-trying an upstream that is in cooldown (default 4000)
 *   CACHE_TTL_MS / CACHE_STALE_MS / CACHE_MAX_BYTES   (default 10 min / 24 h / 64 MB)
 *   COOLDOWN_MS              how long a failing upstream is skipped (default 30000)
 *   LOG_REQUESTS=true        one log line per relayed request
 */
'use strict';

const http = require('node:http');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const gzip = promisify(zlib.gzip);

/* ═══════════════════════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════════════════════ */
const csv = (v, dflt = []) => { const s = String(v || '').trim(); return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : dflt; };
const num = (v, dflt) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : dflt; };

const CHAIN_ALIASES = { bsc: 'bsc', 56: 'bsc', bnb: 'bsc', eth: 'eth', 1: 'eth', ethereum: 'eth', solana: 'solana', sol: 'solana' };
const ANKR_PATH = { bsc: 'bsc', eth: 'eth', solana: 'solana' };

/* Read-only methods the website needs. Nothing that broadcasts: wallets send
   their own transactions through their own provider. */
const EVM_METHODS = new Set([
  'eth_blockNumber', 'eth_chainId', 'net_version', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory',
  'eth_call', 'eth_estimateGas', 'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_getTransactionCount',
  'eth_getLogs', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionByHash', 'eth_getTransactionReceipt',
]);
const SOLANA_METHODS = new Set([
  'getBalance', 'getAccountInfo', 'getMultipleAccounts', 'getTokenAccountsByOwner', 'getTokenAccountBalance', 'getTokenSupply',
  'getLatestBlockhash', 'getSignatureStatuses', 'getSignaturesForAddress', 'getTransaction', 'getSlot', 'getBlockHeight',
  'getEpochInfo', 'getVersion', 'getHealth', 'getMinimumBalanceForRentExemption', 'getRecentPrioritizationFees', 'simulateTransaction',
]);
const METHODS = { bsc: EVM_METHODS, eth: EVM_METHODS, solana: SOLANA_METHODS };

const MAX_BATCH = 20;
const MAX_TOPICS = 4;
const MAX_LOG_ADDRESSES = 10;

function loadConfig(env = process.env) {
  const ankrKey = String(env.ANKR_KEY || '').trim();
  const upstreams = {};
  for (const chain of Object.keys(ANKR_PATH)) {
    const list = [];
    if (ankrKey) list.push(`https://rpc.ankr.com/${ANKR_PATH[chain]}/${ankrKey}`);
    list.push(...csv(env[`UPSTREAMS_${chain.toUpperCase()}`]));
    upstreams[chain] = [...new Set(list)];
  }
  return {
    port: num(env.PORT, 8790),
    upstreams,
    allowedOrigins: new Set(csv(env.ALLOWED_ORIGINS, ['https://a-network.net', 'https://www.a-network.net'])),
    ratePerMin: num(env.RATE_LIMIT_PER_MIN, 240),
    maxConcurrency: num(env.MAX_CONCURRENCY, 24),
    upstreamTimeoutMs: num(env.UPSTREAM_TIMEOUT_MS, 10_000),
    logsTimeoutMs: num(env.LOGS_TIMEOUT_MS, 20_000),
    probeTimeoutMs: num(env.PROBE_TIMEOUT_MS, 4_000),
    cacheTtlMs: num(env.CACHE_TTL_MS, 10 * 60_000),
    cacheStaleMs: num(env.CACHE_STALE_MS, 24 * 3_600_000),
    cacheMaxBytes: num(env.CACHE_MAX_BYTES, 64 * 1024 * 1024),
    maxBodyBytes: num(env.MAX_BODY_BYTES, 64 * 1024),
    maxUpstreamBytes: num(env.MAX_UPSTREAM_BYTES, 32 * 1024 * 1024),
    cooldownMs: num(env.COOLDOWN_MS, 30_000),
    queueTimeoutMs: num(env.QUEUE_TIMEOUT_MS, 10_000),
    logRequests: String(env.LOG_REQUESTS || '').toLowerCase() === 'true',
  };
}

/* ═══════════════════════════════════════════════════════════════════
   Small helpers
   ═══════════════════════════════════════════════════════════════════ */
const hostOf = (url) => { try { return new URL(url).host; } catch (_) { return 'invalid-url'; } };
/** `rpc.ankr.com/bsc/***`: enough to recognise an upstream, never enough to use it. */
const redact = (url) => { try { const u = new URL(url); const seg = u.pathname.split('/').filter(Boolean); return u.host + (seg.length ? '/' + seg.map((s, i) => (i === seg.length - 1 && seg.length > 1 && s.length >= 12 ? '***' : s)).join('/') : ''); } catch (_) { return 'invalid-url'; } };
const isHexQuantity = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v);
const isAddress = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

/** Deterministic JSON (sorted object keys) so equal queries from different visitors share a cache entry. */
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

function rpcError(id, code, message, data) {
  const e = { code, message }; if (data !== undefined) e.data = data;
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: e };
}

/* Upstream error classification. "retry" = another node may serve it; "forward" = the request itself is at fault
   (revert, invalid params, range cap) and the caller must see the exact error. */
const RETRY_CODES = new Set([-32005, -32050, -32052, -32603, 429, 15, 35]);
const RETRY_MSG = /rate.?limit|too many|unauthori|api key|forbidden|not allowed|capacity|overload|internal error|timeout|timed out|try again|upgrade|plan|method not found|does not exist|not supported|not available|unsupported|unavailable|archive|personal token/i;
const DEMOTE_MSG = /rate.?limit|too many|unauthori|api key|forbidden|capacity|overload|internal error|timeout|timed out|try again|unavailable/i;
function classifyRpcError(err) {
  const code = err && typeof err.code === 'number' ? err.code : null;
  const msg = String((err && err.message) || '');
  if ((code !== null && RETRY_CODES.has(code)) || RETRY_MSG.test(msg)) return { action: 'retry', demote: DEMOTE_MSG.test(msg) || code === 429 || code === -32005 || code === -32603 };
  return { action: 'forward' };
}

/* ═══════════════════════════════════════════════════════════════════
   Request validation
   ═══════════════════════════════════════════════════════════════════ */
function validateCall(chain, call) {
  if (!call || typeof call !== 'object' || Array.isArray(call)) return rpcError(null, -32600, 'invalid request');
  const { id, method, params } = call;
  if (id !== undefined && id !== null && typeof id !== 'string' && typeof id !== 'number') return rpcError(null, -32600, 'invalid id');
  if (typeof method !== 'string' || !METHODS[chain].has(method)) return rpcError(id, -32601, `method not allowed on this relay: ${String(method).slice(0, 64)}`);
  if (params !== undefined && !Array.isArray(params)) return rpcError(id, -32602, 'params must be an array');
  const p = params || [];
  if (method === 'eth_getLogs') {
    const f = p[0];
    if (!f || typeof f !== 'object' || Array.isArray(f)) return rpcError(id, -32602, 'eth_getLogs needs a filter object');
    const addrs = Array.isArray(f.address) ? f.address : f.address != null ? [f.address] : [];
    if (!addrs.length || addrs.length > MAX_LOG_ADDRESSES || !addrs.every(isAddress)) return rpcError(id, -32602, `eth_getLogs needs 1-${MAX_LOG_ADDRESSES} contract addresses (whole-chain scans are not relayed)`);
    if (f.topics !== undefined && (!Array.isArray(f.topics) || f.topics.length > MAX_TOPICS)) return rpcError(id, -32602, 'eth_getLogs topics must be an array of at most 4 entries');
    for (const k of ['fromBlock', 'toBlock']) if (f[k] !== undefined && !isHexQuantity(f[k]) && !['latest', 'earliest', 'safe', 'finalized', 'pending'].includes(f[k])) return rpcError(id, -32602, `eth_getLogs ${k} must be a hex quantity or block tag`);
  }
  if ((method === 'eth_getBlockByNumber' || method === 'eth_getBlockByHash') && p[1] === true) return rpcError(id, -32602, 'full transaction objects are not relayed; pass false');
  if (method === 'getSignaturesForAddress' && p[1] && typeof p[1] === 'object' && Number(p[1].limit) > 100) return rpcError(id, -32602, 'limit must be at most 100');
  return null;
}

/** Immutable results worth caching; the key stays identical across visitors because the website sends canonical params. */
function cacheKeyFor(chain, call) {
  const p = call.params || [];
  if (call.method === 'eth_getLogs' && p[0] && isHexQuantity(p[0].fromBlock) && isHexQuantity(p[0].toBlock)) return `${chain}|eth_getLogs|${canonical(p[0])}`;
  if (call.method === 'eth_getBlockByNumber' && isHexQuantity(p[0])) return `${chain}|eth_getBlockByNumber|${canonical(p)}`;
  if (call.method === 'eth_chainId') return `${chain}|eth_chainId`;
  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   Relay state: upstream health, cache, rate limit, concurrency
   ═══════════════════════════════════════════════════════════════════ */
class Relay {
  constructor(cfg, deps = {}) {
    this.cfg = cfg;
    this.fetch = deps.fetch || globalThis.fetch;
    this.now = deps.now || (() => Date.now());
    this.log = deps.log || ((line) => console.log(line));
    this.down = new Map();          // upstream url -> timestamp until which it is skipped
    this.lastError = new Map();     // upstream url -> last failure reason (redacted)
    this.cache = new Map();         // key -> { at, bytes, body(Buffer of the result JSON) }
    this.cacheBytes = 0;
    this.stats = { requests: 0, upstreamCalls: 0, cacheHits: 0, cacheMisses: 0, staleServed: 0, rateLimited: 0, rejected: 0, upstreamFailures: 0 };
    this.buckets = new Map();       // ip -> { start, count }
    this.inflight = 0;
    this.queue = [];
    this.draining = false;
  }

  configured(chain) { return (this.cfg.upstreams[chain] || []).length > 0; }

  isCooling(url) { return (this.down.get(url) || 0) > this.now(); }
  orderedUpstreams(chain) {
    const healthy = [], cooling = [];
    for (const u of this.cfg.upstreams[chain] || []) (this.isCooling(u) ? cooling : healthy).push(u);
    return healthy.concat(cooling);
  }
  markDown(url, reason) { this.down.set(url, this.now() + this.cfg.cooldownMs); this.lastError.set(url, reason); this.stats.upstreamFailures++; this.log(`[upstream] ${redact(url)} unavailable for ${this.cfg.cooldownMs / 1000}s: ${reason}`); }
  markUp(url) { if (this.down.has(url)) this.down.delete(url); }

  /* ── rate limit: fixed one-minute window per client ── */
  allow(ip, units) {
    const now = this.now();
    let b = this.buckets.get(ip);
    if (!b || now - b.start >= 60_000) { b = { start: now, count: 0 }; this.buckets.set(ip, b); }
    b.count += units;
    if (this.buckets.size > 5000) for (const [k, v] of this.buckets) if (now - v.start >= 60_000) this.buckets.delete(k);
    return b.count <= this.cfg.ratePerMin;
  }

  /* ── concurrency: FIFO queue with a wait cap so overload answers quickly instead of piling up ── */
  acquire() {
    if (this.inflight < this.cfg.maxConcurrency) { this.inflight++; return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      entry.timer = setTimeout(() => { const i = this.queue.indexOf(entry); if (i >= 0) this.queue.splice(i, 1); reject(new Error('busy')); }, this.cfg.queueTimeoutMs);
      this.queue.push(entry);
    });
  }
  release() {
    const next = this.queue.shift();
    if (next) { clearTimeout(next.timer); next.resolve(); } else this.inflight = Math.max(0, this.inflight - 1);
  }

  /* ── cache ── */
  cacheGet(key, allowStale) {
    const e = this.cache.get(key); if (!e) return null;
    const age = this.now() - e.at;
    if (age <= this.cfg.cacheTtlMs) return { body: e.body, state: 'hit', age };
    if (allowStale && age <= this.cfg.cacheStaleMs) return { body: e.body, state: 'stale', age };
    if (age > this.cfg.cacheStaleMs) { this.cache.delete(key); this.cacheBytes -= e.bytes; }
    return null;
  }
  cacheSet(key, body) {
    if (body.length > this.cfg.cacheMaxBytes / 2) return;
    const old = this.cache.get(key); if (old) { this.cacheBytes -= old.bytes; this.cache.delete(key); }
    this.cache.set(key, { at: this.now(), bytes: body.length, body });
    this.cacheBytes += body.length;
    while (this.cacheBytes > this.cfg.cacheMaxBytes && this.cache.size) {   // Map keeps insertion order: oldest first
      const [k, v] = this.cache.entries().next().value; this.cache.delete(k); this.cacheBytes -= v.bytes;
    }
  }

  status() {
    const now = this.now();
    const chains = {};
    for (const chain of Object.keys(ANKR_PATH)) {
      const ups = this.cfg.upstreams[chain] || [];
      chains[chain] = {
        configured: ups.length > 0,
        upstreams: ups.map((u) => ({ upstream: redact(u), down: (this.down.get(u) || 0) > now, lastError: this.lastError.get(u) || null })),
        methods: [...METHODS[chain]],
      };
    }
    return { service: 'anet-rpc-proxy', ok: !this.draining, draining: this.draining, chains, cache: { entries: this.cache.size, bytes: this.cacheBytes, ttlMs: this.cfg.cacheTtlMs, staleMs: this.cfg.cacheStaleMs }, inflight: this.inflight, queued: this.queue.length, stats: this.stats, limits: { ratePerMin: this.cfg.ratePerMin, maxConcurrency: this.cfg.maxConcurrency, maxBatch: MAX_BATCH } };
  }

  /* ── one upstream attempt; resolves { ok, status, json } or throws a redacted transport error ── */
  async attempt(url, payload, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      this.stats.upstreamCalls++;
      let res;
      try {
        res = await this.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'anet-rpc-proxy/1.0 (+https://a-network.net)' }, body: payload, signal: ctl.signal });
      } catch (e) {
        const code = (e && e.cause && e.cause.code) || (e && e.name === 'AbortError' ? 'TIMEOUT' : (e && e.name) || 'FETCH_FAILED');
        throw new Error(`transport ${code}`);
      }
      const buf = await readCapped(res, this.cfg.maxUpstreamBytes);
      let json; try { json = JSON.parse(buf.toString('utf8')); } catch (_) { json = undefined; }
      return { status: res.status, json, raw: buf };
    } finally { clearTimeout(timer); }
  }

  /**
   * Relay one validated single call or batch. Returns { status, body(Buffer|string), headers }.
   * `calls` is the array of JSON-RPC objects; `single` tells whether the client sent a bare object.
   */
  async relay(chain, calls, single) {
    const payloadObj = single ? calls[0] : calls;
    const cacheKey = single ? cacheKeyFor(chain, calls[0]) : null;
    const id = single ? (calls[0].id === undefined ? null : calls[0].id) : null;
    if (cacheKey) {
      const c = this.cacheGet(cacheKey, false);
      if (c) { this.stats.cacheHits++; return { status: 200, body: envelope(id, c.body), headers: { 'x-anet-rpc-cache': 'hit', 'x-anet-rpc-upstream': 'cache', age: String(Math.floor(c.age / 1000)) } }; }
      this.stats.cacheMisses++;
    }
    const isLogs = calls.some((c) => c.method === 'eth_getLogs');
    const timeoutMs = isLogs ? this.cfg.logsTimeoutMs : this.cfg.upstreamTimeoutMs;
    const payload = JSON.stringify(payloadObj);
    const failures = [];

    try { await this.acquire(); } catch (_) { this.stats.rejected++; return { status: 503, body: JSON.stringify(rpcError(id, -32603, 'relay busy, try another endpoint')), headers: { 'retry-after': '2' } }; }
    try {
      for (const url of this.orderedUpstreams(chain)) {
        let r;
        // A node in cooldown is probed with a short budget: during an outage the stale cache must be served in seconds.
        try { r = await this.attempt(url, payload, this.isCooling(url) ? Math.min(timeoutMs, this.cfg.probeTimeoutMs) : timeoutMs); }
        catch (e) {
          failures.push(`${hostOf(url)}: ${e.message}`);
          // A response above our size cap says nothing about the node's health.
          if (/RESPONSE_TOO_LARGE/.test(e.message)) this.lastError.set(url, e.message); else this.markDown(url, e.message);
          continue;
        }
        if (r.status === 401 || r.status === 403 || r.status === 429 || r.status >= 500) {
          const reason = `HTTP ${r.status}${r.json && r.json.error && r.json.error.message ? ' ' + String(r.json.error.message).slice(0, 120) : ''}`;
          failures.push(`${hostOf(url)}: ${reason}`); this.markDown(url, reason); continue;
        }
        if (r.json === undefined) { failures.push(`${hostOf(url)}: non-JSON response (HTTP ${r.status})`); this.markDown(url, 'non-JSON response'); continue; }
        if (!single) {
          if (!Array.isArray(r.json)) { failures.push(`${hostOf(url)}: batch unsupported`); continue; }
          this.markUp(url);
          return { status: 200, body: r.raw, headers: { 'x-anet-rpc-cache': 'bypass', 'x-anet-rpc-upstream': hostOf(url) } };
        }
        const j = Array.isArray(r.json) ? r.json[0] : r.json;
        if (!j || typeof j !== 'object') { failures.push(`${hostOf(url)}: malformed response`); continue; }
        if (j.error) {
          const cls = classifyRpcError(j.error);
          if (cls.action === 'retry') {
            const reason = `rpc error ${j.error.code}: ${String(j.error.message || '').slice(0, 120)}`;
            failures.push(`${hostOf(url)}: ${reason}`); if (cls.demote) this.markDown(url, reason); continue;
          }
          this.markUp(url);
          return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id, error: j.error }), headers: { 'x-anet-rpc-cache': 'bypass', 'x-anet-rpc-upstream': hostOf(url) } };
        }
        this.markUp(url);
        const resultBuf = Buffer.from(JSON.stringify(j.result === undefined ? null : j.result), 'utf8');
        if (cacheKey && j.result != null) this.cacheSet(cacheKey, resultBuf);
        return { status: 200, body: envelope(id, resultBuf), headers: { 'x-anet-rpc-cache': cacheKey ? 'miss' : 'bypass', 'x-anet-rpc-upstream': hostOf(url) } };
      }
    } finally { this.release(); }

    if (cacheKey) {
      const c = this.cacheGet(cacheKey, true);
      if (c) { this.stats.staleServed++; return { status: 200, body: envelope(id, c.body), headers: { 'x-anet-rpc-cache': 'stale', 'x-anet-rpc-upstream': 'cache', age: String(Math.floor(c.age / 1000)), warning: '110 anet-rpc-proxy "Response is stale: every upstream failed"' } }; }
    }
    const tried = this.cfg.upstreams[chain].length;
    return { status: 502, body: JSON.stringify(rpcError(id, -32603, `all ${tried} upstream${tried === 1 ? '' : 's'} failed: ${failures.join('; ') || 'no upstream configured'}`)), headers: {} };
  }
}

function envelope(id, resultBuf) {
  return Buffer.concat([Buffer.from(`{"jsonrpc":"2.0","id":${JSON.stringify(id === undefined ? null : id)},"result":`), resultBuf, Buffer.from('}')]);
}

async function readCapped(res, max) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { try { await reader.cancel(); } catch (_) {} throw new Error('transport RESPONSE_TOO_LARGE'); }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, total);
}

/* ═══════════════════════════════════════════════════════════════════
   HTTP layer
   ═══════════════════════════════════════════════════════════════════ */
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip']; if (cf) return String(cf).trim();
  const xff = req.headers['x-forwarded-for']; if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on('data', (c) => {
      if (total > max) return;
      total += c.length;
      if (total > max) { req.pause(); reject(Object.assign(new Error('payload too large'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks, total)));
    req.on('error', reject);
  });
}

function createHandler(relay) {
  const cfg = relay.cfg;
  const corsHeaders = (req) => {
    const origin = req.headers.origin;
    if (!origin || !cfg.allowedOrigins.has(origin)) return {};
    return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept', 'access-control-max-age': '86400', vary: 'origin' };
  };

  async function send(req, res, status, body, extra = {}) {
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...corsHeaders(req), ...extra };
    let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    if (buf.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      try { buf = await gzip(buf); headers['content-encoding'] = 'gzip'; headers.vary = headers.vary ? headers.vary + ', accept-encoding' : 'accept-encoding'; } catch (_) { /* send uncompressed */ }
    }
    headers['content-length'] = String(buf.length);
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  return async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url || '/', 'http://relay');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...corsHeaders(req), 'content-length': '0' }); res.end(); return; }
      if (parts[0] === 'health' && parts.length === 1) { return send(req, res, relay.draining ? 503 : 200, { ok: !relay.draining, service: 'anet-rpc-proxy', configured: Object.keys(ANKR_PATH).filter((c) => relay.configured(c)), uptimeSec: Math.floor(process.uptime()) }); }
      const chainKey = parts[0] === 'rpc' ? parts[1] : parts[0];
      if ((req.method === 'GET' || req.method === 'HEAD') && (parts.length === 0 || (parts[0] === 'rpc' && parts.length === 1))) return send(req, res, 200, relay.status());
      const chain = chainKey != null ? CHAIN_ALIASES[String(chainKey).toLowerCase()] : undefined;
      if (!chain || parts.length > 2 || (parts.length === 2 && parts[0] !== 'rpc')) return send(req, res, 404, rpcError(null, -32601, 'unknown route; use POST /rpc/{bsc|eth|solana}'));
      if (req.method === 'GET' || req.method === 'HEAD') return send(req, res, 200, relay.status().chains[chain]);
      if (req.method !== 'POST') return send(req, res, 405, rpcError(null, -32600, 'POST a JSON-RPC body'), { allow: 'GET, POST, OPTIONS' });
      if (!relay.configured(chain)) return send(req, res, 503, rpcError(null, -32603, `relay has no upstream configured for ${chain}`));

      relay.stats.requests++;
      let raw;
      try { raw = await readBody(req, cfg.maxBodyBytes); }
      catch (e) {
        if (e.status === 413) { res.once('finish', () => req.destroy()); return send(req, res, 413, rpcError(null, -32600, `body exceeds ${cfg.maxBodyBytes} bytes`), { connection: 'close' }); }
        return send(req, res, 400, rpcError(null, -32600, 'unreadable body'));
      }
      let parsed; try { parsed = JSON.parse(raw.toString('utf8')); } catch (_) { return send(req, res, 400, rpcError(null, -32700, 'parse error')); }
      const single = !Array.isArray(parsed);
      const calls = single ? [parsed] : parsed;
      if (!calls.length || calls.length > MAX_BATCH) return send(req, res, 400, rpcError(null, -32600, `batch must contain 1-${MAX_BATCH} calls`));
      for (const c of calls) { const err = validateCall(chain, c); if (err) { relay.stats.rejected++; return send(req, res, 400, err); } }
      const ip = clientIp(req);
      if (!relay.allow(ip, calls.length)) { relay.stats.rateLimited++; return send(req, res, 429, rpcError(single ? calls[0].id : null, -32005, `rate limit: ${cfg.ratePerMin} calls per minute per client`), { 'retry-after': '30' }); }

      const out = await relay.relay(chain, calls, single);
      if (cfg.logRequests) relay.log(`[rpc] ${chain} ${calls.map((c) => c.method).join(',')} -> ${out.status} ${out.headers['x-anet-rpc-upstream'] || ''} ${out.headers['x-anet-rpc-cache'] || ''} ${Date.now() - started}ms ${ip}`);
      return send(req, res, out.status, out.body, out.headers);
    } catch (e) {
      relay.log(`[error] ${req.method} ${url.pathname}: ${e && e.message}`);
      if (!res.headersSent) return send(req, res, 500, rpcError(null, -32603, 'relay internal error'));
      res.destroy();
    }
  };
}

function createProxy(cfg = loadConfig(), deps = {}) {
  const relay = new Relay(cfg, deps);
  const server = http.createServer(createHandler(relay));
  server.keepAliveTimeout = 65_000;   // above typical load-balancer idle timeouts to avoid racing closes
  server.headersTimeout = 70_000;
  server.requestTimeout = 120_000;
  return { server, relay, cfg };
}

/* ═══════════════════════════════════════════════════════════════════
   Entrypoint
   ═══════════════════════════════════════════════════════════════════ */
if (require.main === module) {
  const { server, relay, cfg } = createProxy();
  server.listen(cfg.port, '0.0.0.0', () => {
    const summary = Object.keys(ANKR_PATH).map((c) => `${c}=[${(cfg.upstreams[c] || []).map(redact).join(', ') || 'NOT CONFIGURED'}]`).join(' ');
    console.log(`anet-rpc-proxy listening on :${cfg.port} ${summary} origins=[${[...cfg.allowedOrigins].join(', ')}]`);
    if (!Object.keys(ANKR_PATH).some((c) => relay.configured(c))) console.warn('WARNING: set ANKR_KEY (or UPSTREAMS_*) — every POST answers 503 until an upstream is configured');
  });
  // Zero-downtime deploys: stop taking new connections, let in-flight requests finish, then exit.
  const shutdown = (sig) => {
    relay.draining = true;
    console.log(`${sig} received: draining (${relay.inflight} in flight)`);
    server.close(() => { console.log('closed'); process.exit(0); });
    setTimeout(() => process.exit(0), 25_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { createProxy, createHandler, loadConfig, Relay, validateCall, cacheKeyFor, canonical, classifyRpcError, redact, hostOf, METHODS, CHAIN_ALIASES, MAX_BATCH };
