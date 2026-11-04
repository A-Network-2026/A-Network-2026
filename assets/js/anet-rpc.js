/**
 * A Network shared JSON-RPC client with provider failover
 * anet-rpc.js  |  2026
 *
 * Every public page that reads a chain in the visitor's browser (reserves.html,
 * dex.html) goes through this module instead of one hard-coded provider.
 * There is an ordered endpoint list per chain: the project's Ankr key first
 * (archive node, unbounded eth_getLogs ranges), then public CORS-enabled nodes.
 * When a provider cannot be reached from the visitor's network (TLS or DNS
 * interception, regional outage, rate limit) the call fails over to the next
 * endpoint and the failing endpoint is demoted for a cooldown so later calls
 * skip it. Genuine call errors (an eth_call revert) surface immediately.
 *
 * CSP: script-src 'self'; no CDNs, no eval, no dependencies.
 *
 *   AnetRpc.call(chain, method, params, { timeoutMs })
 *   AnetRpc.batch(chain, calls, { timeoutMs })           results in call order, null for failed entries
 *   AnetRpc.getLogs(chain, filter, fromBlock, toBlock)   archive-capable endpoints only, splits the range on node errors
 *   AnetRpc.status()                                     { [chain]: { active, endpoints, down } }
 *   window event 'anet-rpc-status' whenever the active endpoint of a chain changes
 */
'use strict';

(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  const ANKR_KEY = '3ce3cd9f0dfa278ed38509a065305c94912b7350a2c1e3b4714d0554b60db218';
  const ankr = (chain) => `https://rpc.ankr.com/${chain}/${ANKR_KEY}`;

  /* Public fallbacks were each verified to answer a browser CORS preflight for a-network.net. */
  const ENDPOINTS = {
    56: [ankr('bsc'), 'https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.defibit.io', 'https://bsc-dataseed1.ninicoin.io', 'https://1rpc.io/bnb', 'https://bsc.meowrpc.com'],
    1: [ankr('eth'), 'https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth', 'https://eth.meowrpc.com', 'https://eth-mainnet.public.blastapi.io'],
    solana: [ankr('solana'), 'https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'],
  };
  /* Only archive nodes without a block-range cap can scan millions of blocks of history. Public nodes
     cap eth_getLogs at 25 to 10,000 blocks or refuse archive data, so they are deliberately absent here. */
  const LOG_ENDPOINTS = { 56: [ankr('bsc')], 1: [ankr('eth')] };

  const DEFAULT_TIMEOUT_MS = 15_000;
  const LOGS_TIMEOUT_MS = 60_000;
  const COOLDOWN_MS = 60_000;
  const MIN_LOG_SPLIT_BLOCKS = 10_000;
  const MAX_LOG_SPLIT_DEPTH = 5;

  /* Messages that mean "this provider will not serve the request", as opposed to "the call itself failed". */
  const PROVIDER_ERR = /rate.?limit|too many|limit exceeded|exceed|range|archive|unauthori|api key|forbidden|blocked|not supported|not available|unsupported|upgrade|plan|timeout|timed out|capacity|overload|unavailable|internal error|gateway|try again|cu limit|batch/i;
  const PROVIDER_CODES = new Set([429, 403, -32005, -32603, -32601, -32050, -32052, 15, 35]);

  const hostOf = (url) => { try { return new URL(url).host; } catch (_) { return String(url); } };
  const toHex = (n) => '0x' + BigInt(n).toString(16);

  const state = { down: new Map(), active: {}, id: 1 };

  function providerError(message, extra) {
    const e = new Error(message); e.provider = true;
    if (extra) Object.assign(e, extra);
    return e;
  }
  function isProviderError(e) {
    if (!e) return false;
    if (e.provider === true) return true;
    if (e.rpc) return PROVIDER_CODES.has(e.code) || (e.httpStatus >= 400) || PROVIDER_ERR.test(e.message || '');
    return true; // transport failure: TypeError "Failed to fetch", AbortError, DNS/TLS
  }
  /** Demote only nodes that are unreachable or refusing us outright; a request-specific rejection
   *  (method or batch unsupported, range cap, archive gate) says nothing about the node's other answers. */
  function shouldDemote(e) {
    if (!e || e.noDemote) return false;
    if (!e.rpc) return true;
    if (e.httpStatus === 429 || e.httpStatus === 403 || e.httpStatus >= 500) return true;
    if (e.code === 429 || e.code === -32005) return true;
    return /rate.?limit|too many|capacity|overload|unavailable|timeout|timed out|try again/i.test(e.message || '');
  }

  function ordered(list) {
    const now = Date.now();
    const healthy = [], cooling = [];
    for (const url of list) ((state.down.get(url) || 0) > now ? cooling : healthy).push(url);
    return healthy.concat(cooling);
  }
  function demote(url) { state.down.set(url, Date.now() + COOLDOWN_MS); }
  function markActive(chain, url) {
    state.down.delete(url);
    if (chain == null || state.active[chain] === url) return;
    state.active[chain] = url;
    try {
      if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('anet-rpc-status', { detail: status() }));
    } catch (_) { /* diagnostics only */ }
  }

  async function post(url, body, timeoutMs) {
    const hasAbort = typeof AbortController === 'function';
    const ctl = hasAbort ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
    } catch (e) {
      throw providerError(`${hostOf(url)}: ${e && e.name === 'AbortError' ? 'timed out' : (e && e.message) || 'network error'}`, { cause: e });
    } finally { if (timer) clearTimeout(timer); }
    const data = await res.json().catch(() => undefined);
    if (data === undefined) throw providerError(`${hostOf(url)}: HTTP ${res.status || '?'} (no JSON-RPC body)`, { httpStatus: res.status });
    return { res, data };
  }

  function rpcError(url, err, httpStatus) {
    const e = new Error((err && err.message) || 'RPC error');
    e.rpc = true; e.code = err && err.code; e.data = err && err.data; e.httpStatus = httpStatus; e.endpoint = hostOf(url);
    return e;
  }

  async function callUrl(url, method, params, timeoutMs) {
    const { res, data } = await post(url, { jsonrpc: '2.0', id: state.id++, method, params: params || [] }, timeoutMs);
    if (data && data.error) throw rpcError(url, data.error, res.ok === false ? res.status : undefined);
    if (res.ok === false) throw providerError(`${hostOf(url)}: HTTP ${res.status}`, { httpStatus: res.status });
    if (!data || typeof data !== 'object') throw providerError(`${hostOf(url)}: malformed response`);
    return data.result;
  }

  /** Try each endpoint in health order; fail over on provider errors, surface call errors at once. */
  async function withFailover(chain, endpoints, fn) {
    const list = ordered(endpoints);
    if (!list.length) throw providerError(`no RPC endpoint configured for ${chain}`);
    let last = null;
    for (const url of list) {
      try {
        const out = await fn(url);
        markActive(chain, url);
        return out;
      } catch (e) {
        if (!isProviderError(e)) throw e;
        if (shouldDemote(e)) demote(url);
        last = e;
      }
    }
    const err = providerError(`all ${list.length} RPC endpoints for ${chain} failed (last: ${last && last.message})`, { cause: last });
    err.allFailed = true;
    throw err;
  }

  function call(chain, method, params = [], opts = {}) {
    const endpoints = opts.endpoints || ENDPOINTS[chain] || [];
    return withFailover(chain, endpoints, (url) => callUrl(url, method, params, opts.timeoutMs || DEFAULT_TIMEOUT_MS));
  }

  function batch(chain, calls, opts = {}) {
    const endpoints = opts.endpoints || ENDPOINTS[chain] || [];
    const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params || [] }));
    return withFailover(chain, endpoints, async (url) => {
      const { res, data } = await post(url, body, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
      if (!Array.isArray(data)) {
        if (data && data.error) throw rpcError(url, data.error, res.ok === false ? res.status : undefined);
        throw providerError(`${hostOf(url)}: batch unsupported`, { noDemote: true });
      }
      // A provider that rejects every entry (rate limit, auth) has not served the batch.
      if (data.length && data.every(d => d && d.error)) throw rpcError(url, data[0].error, res.ok === false ? res.status : undefined);
      const byId = new Map(data.map(d => [d.id, d]));
      return calls.map((_, i) => { const d = byId.get(i + 1); return d && !d.error ? d.result : null; });
    });
  }

  /** eth_getLogs on one node; a node that answers but refuses the range (too many blocks or results)
   *  gets the range halved to a bounded depth. Transport failures propagate so the caller fails over. */
  async function logsOn(url, filter, fromBlock, toBlock, timeoutMs, depth) {
    try {
      const r = await callUrl(url, 'eth_getLogs', [{ ...filter, fromBlock: toHex(fromBlock), toBlock: toHex(toBlock) }], timeoutMs);
      return Array.isArray(r) ? r : [];
    } catch (e) {
      if (!(e && e.rpc === true) || depth >= MAX_LOG_SPLIT_DEPTH || toBlock - fromBlock < MIN_LOG_SPLIT_BLOCKS) throw e;
      const mid = Math.floor((fromBlock + toBlock) / 2);
      const [a, b] = await Promise.all([logsOn(url, filter, fromBlock, mid, timeoutMs, depth + 1), logsOn(url, filter, mid + 1, toBlock, timeoutMs, depth + 1)]);
      return a.concat(b);
    }
  }

  /** eth_getLogs over [fromBlock, toBlock] with failover across the archive-capable endpoints of `chain`. */
  function getLogs(chain, filter, fromBlock, toBlock, opts = {}) {
    const endpoints = opts.endpoints || LOG_ENDPOINTS[chain] || [];
    return withFailover(`${chain}:logs`, endpoints, (url) => logsOn(url, filter, fromBlock, toBlock, opts.timeoutMs || LOGS_TIMEOUT_MS, 0));
  }

  function status() {
    const now = Date.now();
    const out = {};
    for (const chain of Object.keys(ENDPOINTS)) {
      out[chain] = {
        active: state.active[chain] ? hostOf(state.active[chain]) : null,
        endpoints: ENDPOINTS[chain].map(hostOf),
        down: ENDPOINTS[chain].filter(u => (state.down.get(u) || 0) > now).map(hostOf),
      };
    }
    out.logs = {};
    for (const chain of Object.keys(LOG_ENDPOINTS)) {
      out.logs[chain] = { active: state.active[`${chain}:logs`] ? hostOf(state.active[`${chain}:logs`]) : null, endpoints: LOG_ENDPOINTS[chain].map(hostOf) };
    }
    return out;
  }

  function reset() { state.down.clear(); state.active = {}; }

  root.AnetRpc = { ENDPOINTS, LOG_ENDPOINTS, call, batch, getLogs, status, reset, hostOf, isProviderError, COOLDOWN_MS };
})();
