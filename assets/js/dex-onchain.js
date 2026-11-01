/**
 * A Network On-Chain Trading module
 * dex-onchain.js  |  v2  |  2026
 *
 * Non-custodial buy/sell + liquidity for ANET and major assets, executed from
 * the user's own wallet on public venues:
 *
 *  • BNB Chain:    PancakeSwap V2 router (window.ethereum / MetaMask).
 *  • Ethereum:     Uniswap V2 router (window.ethereum / MetaMask).
 *  • Solana:       Jupiter aggregator (Phantom + vendored web3.js).
 *
 * Revenue model (the only one): an interface fee on the swap INPUT, paid to
 * the A Network treasury. A Network never holds user funds.
 *
 *  • EVM, atomic:   when `FEE_ROUTER[chainId]` is set, the swap goes through
 *                    the immutable AnetFeeRouter contract (contracts/src/
 *                    AnetFeeRouter.sol): fee → treasury and DEX swap → user in
 *                    ONE transaction; a failed swap takes no fee.
 *  • EVM, fallback: until the router is deployed on a chain, the fee is a
 *                    separate transfer that is only sent AFTER the swap has been
 *                    simulated successfully (eth_call), and the swap is only
 *                    sent once the fee transfer is confirmed.
 *  • Solana:        Jupiter `platformFeeBps` + `feeAccount` (the treasury's
 *                    token account for the output mint): the fee is settled
 *                    inside the swap transaction itself. Jupiter only accepts
 *                    whole basis points, so Solana charges 0.87 %.
 *
 * Loaded AFTER dex.js and dex-terminal.js. Mounts the order ticket into the
 * terminal's `#oc-ticket-slot` (or straight into `#onchain-trade-mount`).
 * CSP: script-src 'self' (no CDNs, no eval, no inline handlers).
 */
'use strict';

(function () {

  /* ═══════════════════════════════════════════════════════════════════
     Configuration
     ═══════════════════════════════════════════════════════════════════ */

  /* ── Ankr RPC (project key) ───────────────────────────────────────── */
  const ANKR_KEY = '3ce3cd9f0dfa278ed38509a065305c94912b7350a2c1e3b4714d0554b60db218';
  const ANKR_RPC = {
    1:      `https://rpc.ankr.com/eth/${ANKR_KEY}`,
    56:     `https://rpc.ankr.com/bsc/${ANKR_KEY}`,
    solana: `https://rpc.ankr.com/solana/${ANKR_KEY}`,
  };

  /* ── Interface fee → treasury ─────────────────────────────────────── */
  const FEE = {
    numerator: 875n,            // over FEE.denominator → 0.875 %
    denominator: 100_000n,
    pct: 0.875,
    solanaBps: 87,              // Jupiter accepts integer bps only → 0.87 %
    evmTreasury: '0x9C7C1058fdc9b710f688ECb7562924D9AE771417',   // EVM Reserve Treasury (BSC + ETH)
    solTreasury: '7j33RFPkNvaKsPuz2qJ5SzwiwXA4iL12ujqM4g2tRLEz',  // Solana treasury (fee token accounts owner)
  };
  const FEE_PCT_LABEL = (chain) => chain === 'solana' ? (FEE.solanaBps / 100).toFixed(2) + '%' : FEE.pct + '%';

  /**
   * AnetFeeRouter deployments (atomic fee + swap). Deploy with
   *   cd contracts && npm run deploy:feerouter:bsc   (and :eth)
   * then paste the printed address here. Leave '' to use the fallback flow.
   * On boot the module verifies treasury()/feeNumerator() on-chain and refuses
   * to use a router whose parameters differ from FEE above.
   */
  const FEE_ROUTER = {
    56: '',
    1:  '',
  };

  /* ── EVM DEX routing config ───────────────────────────────────────── */
  const EVM_DEX = {
    56: {
      name: 'PancakeSwap V2',
      router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      wrapped: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
      nativeSymbol: 'BNB',
      explorer: 'https://bscscan.com',
      chainHex: '0x38',
      poolFeePct: 0.25,
    },
    1: {
      name: 'Uniswap V2',
      router: '0x7a250d5630B4cF539739dF2C5dACb4c659F2488D',
      wrapped: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      nativeSymbol: 'ETH',
      explorer: 'https://etherscan.io',
      chainHex: '0x1',
      poolFeePct: 0.30,
    },
  };

  /* Tradeable tokens per EVM chain (real mainnet addresses). */
  const ONCHAIN_TOKENS = {
    56: [
      { symbol: 'ANET', name: 'A Network',   addr: '0x791055A7d52AA392eaE8De04250497f33807E46A', decimals: 18, featured: true },
      { symbol: 'BNB',  name: 'BNB',         native: true, decimals: 18 },
      { symbol: 'USDT', name: 'Tether USD',  addr: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      { symbol: 'USDC', name: 'USD Coin',    addr: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
      { symbol: 'BTCB', name: 'Bitcoin',     addr: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18 },
    ],
    1: [
      { symbol: 'ETH',  name: 'Ether',       native: true, decimals: 18 },
      { symbol: 'USDT', name: 'Tether USD',  addr: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      { symbol: 'USDC', name: 'USD Coin',    addr: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      { symbol: 'WBTC', name: 'Wrapped BTC', addr: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
    ],
  };

  /* Solana SPL mints. */
  const SOL_TOKENS = [
    { symbol: 'SOL',  name: 'Solana',    mint: 'So11111111111111111111111111111111111111112', decimals: 9, native: true },
    { symbol: 'USDC', name: 'USD Coin',  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD',mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  ];
  const SOL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const SOL_ATA_PROGRAM   = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const SOL_SYSTEM_PROGRAM = '11111111111111111111111111111111';

  /* Real PancakeSwap V2 liquidity pool for ANET (anyone can add/remove LP). */
  const LP_POOL = {
    56: {
      pair: '0xB90071e377A31A6EA2cFDeBE19a4d5226c420b6B', // ANET/WBNB LP token
      token: '0x791055A7d52AA392eaE8De04250497f33807E46A',
      tokenSym: 'ANET', tokenDec: 18, nativeSym: 'BNB',
    },
  };

  /* ── ANET (BEP-20) token identity for the live price feed ─────────── */
  const ANET_BSC_ADDR = '0x791055A7d52AA392eaE8De04250497f33807E46A';
  const ANTS_PER_ANET = 100_000_000;

  /* CoinGecko ids for USD price of majors. */
  const CG_IDS = {
    ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana', BTC: 'bitcoin',
    WBTC: 'wrapped-bitcoin', BTCB: 'bitcoin', USDT: 'tether', USDC: 'usd-coin',
    MATIC: 'matic-network', AVAX: 'avalanche-2',
  };

  /* ── Small helpers (reuse dex.js globals when available) ──────────── */
  const esc  = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  const notify = (m, t, d) => { if (typeof toast === 'function') toast(m, t, d); else console.log(`[${t}] ${m}`); };
  function fmtNum(n, dp = 4) {
    if (n == null || !isFinite(n)) return '—';
    n = Number(n);
    if (n === 0) return '0';
    if (Math.abs(n) < 0.0001) return n.toExponential(2);
    return n.toLocaleString('en-US', { maximumFractionDigits: dp });
  }
  function fmtUsd(n, dp = 2) { return (n == null || !isFinite(n)) ? '—' : '$' + fmtNum(n, dp); }
  const $ = (id) => document.getElementById(id);
  const shortId = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
  /* Official logos come from dex-terminal.js (self-hosted PNGs); plain text if it is absent. */
  const tokenLogoHtml = (sym, size = 20) => (window.AnetTerminal && typeof window.AnetTerminal.logoHtml === 'function') ? window.AnetTerminal.logoHtml(sym, { size }) : '';
  const netLogo = (chain) => {
    const src = window.AnetTerminal && typeof window.AnetTerminal.chainLogo === 'function' ? window.AnetTerminal.chainLogo(chain) : null;
    return src ? `<img class="oc-net-logo" src="${src}" alt="" width="16" height="16">` : '<span class="oc-net-dot">●</span>';
  };

  /* ═══════════════════════════════════════════════════════════════════
     JSON-RPC (via Ankr): reads + confirmations
     ═══════════════════════════════════════════════════════════════════ */
  let _rpcId = 1;
  async function rpc(url, method, params = []) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: _rpcId++, method, params }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) throw new Error(data.error.message || 'RPC error');
    return data.result;
  }
  /** Batch JSON-RPC: returns results in call order (null for failed entries). */
  async function rpcBatchUrl(url, calls) {
    const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params || [] }));
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data)) throw new Error('batch unsupported');
    const byId = new Map(data.map(d => [d.id, d]));
    return calls.map((_, i) => { const d = byId.get(i + 1); return d && !d.error ? d.result : null; });
  }
  const evmRpc   = (chainId, method, params) => rpc(ANKR_RPC[chainId], method, params);
  const rpcBatch = (chainId, calls) => rpcBatchUrl(ANKR_RPC[chainId], calls);
  const solRpc   = (method, params) => rpc(ANKR_RPC.solana, method, params);

  /* Read-only eth_call routed through Ankr (independent of the wallet). */
  function evmCall(chainId, to, data) {
    return evmRpc(chainId, 'eth_call', [{ to, data }, 'latest']);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Minimal ABI encoding (V2 router + ERC-20 + AnetFeeRouter)
     Selectors = first 4 bytes of keccak256(signature), precomputed with
     ethers (no keccak lib is bundled).
     ═══════════════════════════════════════════════════════════════════ */
  const SELECTORS = {
    'getAmountsOut(uint256,address[])':                                          '0xd06ca61f',
    'swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)':          '0xb6f9de95',
    'swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)':  '0x791ac947',
    'swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)':'0x5c11d795',
    'approve(address,uint256)':   '0x095ea7b3',
    'allowance(address,address)': '0xdd62ed3e',
    'balanceOf(address)':         '0x70a08231',
    'decimals()':                 '0x313ce567',
    'transfer(address,uint256)':  '0xa9059cbb',
    'totalSupply()':              '0x18160ddd',
    'getReserves()':              '0x0902f1ac',
    'token0()':                   '0x0dfe1681',
    'addLiquidityETH(address,uint256,uint256,uint256,address,uint256)':                          '0xf305d719',
    'removeLiquidityETHSupportingFeeOnTransferTokens(address,uint256,uint256,uint256,address,uint256)': '0xaf2979eb',
    // AnetFeeRouter
    'swapExactETHForTokens(uint256,address[],uint256)':             '0xde56a8ff',
    'swapExactTokensForETH(uint256,uint256,address[],uint256)':     '0x06c738dc',
    'swapExactTokensForTokens(uint256,uint256,address[],uint256)':  '0x1f263f59',
    'feeNumerator()':                                                '0xe86dea4a',
    'treasury()':                                                    '0x61d027b3',
  };
  const pad32 = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const encAddr = (a) => pad32(a);
  const encUint = (v) => pad32((typeof v === 'bigint' ? v : BigInt(v)).toString(16));
  function encAddrArray(addrs, headWords /* words before the array data */) {
    const offset = encUint(BigInt(headWords * 32));
    let tail = encUint(BigInt(addrs.length));
    addrs.forEach((a) => { tail += encAddr(a); });
    return { offset, tail };
  }
  function sel(sig) { const s = SELECTORS[sig]; if (!s) throw new Error('no selector: ' + sig); return s; }

  /** Calldata for the public V2 router (fallback path). Output always to `to`. */
  function buildDexRouterCalldata({ fromNative, toNative, swapIn, minOut, path, to, deadline }) {
    if (fromNative) {
      const arr = encAddrArray(path, 4);
      return { data: sel('swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)')
        + encUint(minOut) + arr.offset + encAddr(to) + encUint(deadline) + arr.tail, value: swapIn };
    }
    const arr = encAddrArray(path, 5);
    const sig = toNative
      ? 'swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)'
      : 'swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)';
    return { data: sel(sig) + encUint(swapIn) + encUint(minOut) + arr.offset + encAddr(to) + encUint(deadline) + arr.tail, value: 0n };
  }

  /** Calldata for AnetFeeRouter (atomic path). The contract splits the fee itself. */
  function buildFeeRouterCalldata({ fromNative, toNative, amountIn, minOut, path, deadline }) {
    if (fromNative) {
      const arr = encAddrArray(path, 3); // amountOutMin, offset, deadline
      return { data: sel('swapExactETHForTokens(uint256,address[],uint256)') + encUint(minOut) + arr.offset + encUint(deadline) + arr.tail, value: amountIn };
    }
    const arr = encAddrArray(path, 4);   // amountIn, amountOutMin, offset, deadline
    const sig = toNative ? 'swapExactTokensForETH(uint256,uint256,address[],uint256)' : 'swapExactTokensForTokens(uint256,uint256,address[],uint256)';
    return { data: sel(sig) + encUint(amountIn) + encUint(minOut) + arr.offset + encUint(deadline) + arr.tail, value: 0n };
  }

  /** Exact fee split: fee = amountIn * 875 / 100000 (matches the contract). */
  function splitFee(amountIn) {
    amountIn = BigInt(amountIn);
    const feeUnits = amountIn * FEE.numerator / FEE.denominator;
    return { feeUnits, swapIn: amountIn - feeUnits };
  }

  /* getAmountsOut(amountIn, path) → uint[] (returns last as bigint) */
  async function getAmountsOut(chainId, amountIn, path) {
    const arr = encAddrArray(path, 2);
    const data = sel('getAmountsOut(uint256,address[])') + encUint(amountIn) + arr.offset + arr.tail;
    const out = await evmCall(chainId, EVM_DEX[chainId].router, data);
    const body = out.replace(/^0x/, '');
    const len = parseInt(body.slice(64, 128), 16);
    const last = body.slice(128 + (len - 1) * 64, 128 + len * 64);
    return BigInt('0x' + last);
  }

  async function erc20BalanceOf(chainId, token, owner) {
    const r = await evmCall(chainId, token, sel('balanceOf(address)') + encAddr(owner));
    return BigInt(r || '0x0');
  }
  async function erc20Allowance(chainId, token, owner, spender) {
    const r = await evmCall(chainId, token, sel('allowance(address,address)') + encAddr(owner) + encAddr(spender));
    return BigInt(r || '0x0');
  }

  /* human decimal string → base-unit BigInt */
  function toUnits(amountStr, decimals) {
    const s = String(amountStr).trim();
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return 0n;
    const [whole, frac = ''] = s.split('.');
    const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
    return BigInt(whole || '0') * (10n ** BigInt(decimals)) + BigInt(fracPadded || '0');
  }
  function fromUnits(v, decimals) {
    v = BigInt(v);
    const base = 10n ** BigInt(decimals);
    const whole = v / base;
    const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
  }
  const slipFloor = (v, slipPct) => BigInt(v) * BigInt(Math.round((100 - slipPct) * 100)) / 10000n;

  /* ═══════════════════════════════════════════════════════════════════
     Live price feed  (real values, drives the terminal)
     ═══════════════════════════════════════════════════════════════════ */
  const prices = {
    usd: {},                 // { SYMBOL: usdPrice }
    change24h: {},           // { SYMBOL: pct }
    vol24h: {},              // { SYMBOL: usd }
    anet: null,              // full DexScreener snapshot for ANET
    anetSeries: [],          // [{ t, v(usd) }] ticking history (legacy accessor)
    anetSupply: null,        // exact on-chain BEP-20 total supply (21,000,000)
    updated: 0,
  };
  const priceListeners = [];

  async function fetchAnetSupply() {
    try {
      const raw = await evmCall(56, ANET_BSC_ADDR, sel('totalSupply()'));
      const supply = Number(BigInt(raw)) / 1e18;
      if (supply > 0) prices.anetSupply = supply;
    } catch (e) { /* keep null */ }
  }

  async function pollAnetPrice() {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ANET_BSC_ADDR}`);
      const data = await res.json();
      const pairs = Array.isArray(data.pairs) ? data.pairs : [];
      const anetPairs = pairs.filter(p => (p.baseToken?.address || '').toLowerCase() === ANET_BSC_ADDR.toLowerCase());
      const best = (anetPairs.length ? anetPairs : pairs).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      if (!best) return;
      const priceUsd = parseFloat(best.priceUsd);
      prices.anet = {
        priceUsd,
        priceNative: parseFloat(best.priceNative),
        change24h: best.priceChange?.h24 ?? 0,
        change1h: best.priceChange?.h1 ?? 0,
        liquidityUsd: best.liquidity?.usd ?? 0,
        volume24h: best.volume?.h24 ?? 0,
        txns24h: (best.txns?.h24?.buys || 0) + (best.txns?.h24?.sells || 0),
        marketCap: best.marketCap ?? 0,
        fdv: best.fdv ?? 0,
        pairUrl: best.url,
        quoteSymbol: best.quoteToken?.symbol || 'WBNB',
        dex: best.dexId,
      };
      prices.usd.ANET = priceUsd;
      prices.usd.WANET = priceUsd;
      prices.change24h.ANET = Number(prices.anet.change24h) || 0;
      prices.vol24h.ANET = prices.anet.volume24h;
      const now = Date.now();
      const s = prices.anetSeries;
      if (!s.length || Math.abs(s[s.length - 1].v - priceUsd) > 1e-9 || now - s[s.length - 1].t > 10000) {
        s.push({ t: now, v: priceUsd });
        if (s.length > 720) s.splice(0, s.length - 720);
      }
      prices.updated = now;
    } catch (e) { /* keep last good price */ }
  }

  async function pollMajors() {
    try {
      const ids = [...new Set(Object.values(CG_IDS))].join(',');
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);
      const data = await res.json();
      for (const [sym, id] of Object.entries(CG_IDS)) {
        if (data[id]?.usd != null) prices.usd[sym] = data[id].usd;
        if (data[id]?.usd_24h_change != null) prices.change24h[sym] = data[id].usd_24h_change;
        if (data[id]?.usd_24h_vol != null) prices.vol24h[sym] = data[id].usd_24h_vol;
      }
      if (prices.usd.ANET != null) prices.usd.ANTS = prices.usd.ANET / ANTS_PER_ANET;
    } catch (e) { /* keep last good */ }
  }

  async function refreshPrices() {
    await Promise.all([pollAnetPrice(), pollMajors()]);
    window.dispatchEvent(new CustomEvent('anet:prices', { detail: { ...prices } }));
    priceListeners.forEach(cb => { try { cb(prices); } catch (_) {} });
    renderOnchainQuote();
  }

  /* Public accessor for dex.js / charts (kept for compatibility) */
  window.AnetPrices = {
    getUsd: (sym) => prices.usd[String(sym || '').toUpperCase()] ?? null,
    getAnet: () => prices.anet,
    getAnetSeries: () => prices.anetSeries.slice(),
    all: () => ({ ...prices.usd }),
  };

  /* ═══════════════════════════════════════════════════════════════════
     Fee router status (atomic path), verified on-chain at boot
     ═══════════════════════════════════════════════════════════════════ */
  const feeRouterState = { 56: { verified: false, address: '' }, 1: { verified: false, address: '' } };

  async function verifyFeeRouter(chainId) {
    const addr = FEE_ROUTER[chainId];
    const s = feeRouterState[chainId];
    s.verified = false; s.address = '';
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return false;
    try {
      const [numHex, treasHex] = await Promise.all([
        evmCall(chainId, addr, sel('feeNumerator()')),
        evmCall(chainId, addr, sel('treasury()')),
      ]);
      const num = BigInt(numHex);
      const treasury = '0x' + treasHex.replace(/^0x/, '').slice(24);
      if (num !== FEE.numerator) throw new Error(`feeNumerator ${num} ≠ ${FEE.numerator}`);
      if (treasury.toLowerCase() !== FEE.evmTreasury.toLowerCase()) throw new Error(`treasury ${treasury} ≠ ${FEE.evmTreasury}`);
      s.verified = true; s.address = addr;
      return true;
    } catch (e) {
      console.error(`[fee-router] chain ${chainId}: refusing to use ${addr}: ${e.message}. Falling back to two-step fee flow.`);
      return false;
    }
  }
  const atomicRouter = (chainId) => feeRouterState[chainId]?.verified ? feeRouterState[chainId].address : '';

  function feeInfo(chain) {
    if (chain === 'solana') {
      return { pct: FEE.solanaBps / 100, label: `${FEE_PCT_LABEL('solana')} · in-swap`, atomic: true, treasury: FEE.solTreasury };
    }
    const atomic = !!atomicRouter(chain);
    return { pct: FEE.pct, label: `${FEE.pct}% · ${atomic ? 'atomic' : 'separate tx'}`, atomic, treasury: FEE.evmTreasury, router: atomicRouter(chain) };
  }

  /* ═══════════════════════════════════════════════════════════════════
     UI state + order ticket
     ═══════════════════════════════════════════════════════════════════ */
  const ui = {
    chain: 56,          // 56 | 1 | 'solana'
    mode: 'trade',      // trade | liquidity
    side: 'buy',        // buy | sell
    liqSub: 'add',      // add | remove
    liqPct: 100,
    fromSym: 'BNB',
    toSym: 'ANET',
    slippage: 2,
    quote: null,
    liqAdd: null,
    liqRemove: null,
    lpBalance: 0n,
    bottomTab: 'balances',
    syncingFromMarket: false,
  };
  const ONCHAIN_HISTORY_KEY = 'anet:dex:onchain-trades:v1';
  const walletState = { evm: '', evmChain: null, sol: '' };

  function mount() {
    const host = $('onchain-trade-mount');
    if (!host) return;
    const slots = window.AnetTerminal ? window.AnetTerminal.mount(host) : null;
    const ticketHost = slots?.ticketSlot || host;
    const bottomHost = slots?.bottomSlot || null;

    ticketHost.innerHTML = `
      <div class="card onchain-card">
        <div class="card-header">
          <span class="card-title">ORDER TICKET</span>
          <span class="pill live green">LIVE</span>
        </div>
        <div class="card-body onchain-body">
          <div class="onchain-net-row" id="onchain-net-row">
            <button class="net-btn active" data-net="56">${netLogo(56)} BNB Chain</button>
            <button class="net-btn" data-net="1">${netLogo(1)} Ethereum</button>
            <button class="net-btn" data-net="solana">${netLogo('solana')} Solana</button>
          </div>

          <div class="onchain-mode-row" id="onchain-mode-row">
            <button class="mode-btn active" data-mode="trade">Trade</button>
            <button class="mode-btn" data-mode="liquidity" id="oc-mode-liq">Liquidity</button>
          </div>

          <!-- ══ TRADE PANEL ══ -->
          <div id="oc-trade-panel">
            <div class="onchain-side-row">
              <button class="side-btn buy active" data-side="buy">Buy</button>
              <button class="side-btn sell" data-side="sell">Sell</button>
            </div>

            <div class="token-field">
              <div class="token-field-label">YOU PAY</div>
              <div class="token-field-row">
                <span class="oc-select-wrap"><span class="oc-select-logo" id="oc-from-logo"></span><select class="oc-token-select has-logo" id="oc-from-select" aria-label="Token to pay"></select></span>
                <input class="amount-input" id="oc-from-amount" type="number" placeholder="0.00" min="0" step="any" inputmode="decimal" aria-label="Amount to pay">
              </div>
              <div class="token-balance-row">
                <span id="oc-from-balance" style="font-size:12px;color:var(--muted-2);">—</span>
                <span class="balance-max" id="oc-max-btn">MAX</span>
              </div>
            </div>

            <div class="swap-arrow-row">
              <button class="swap-arrow-btn" id="oc-flip" title="Reverse" aria-label="Reverse direction">↕</button>
            </div>

            <div class="token-field">
              <div class="token-field-label">YOU RECEIVE (est.)</div>
              <div class="token-field-row">
                <span class="oc-select-wrap"><span class="oc-select-logo" id="oc-to-logo"></span><select class="oc-token-select has-logo" id="oc-to-select" aria-label="Token to receive"></select></span>
                <div class="amount-input" id="oc-to-amount" style="text-align:right;color:var(--accent-2);min-height:36px;display:flex;align-items:center;justify-content:flex-end;">—</div>
              </div>
            </div>

            <div class="slippage-row" style="padding-top:4px;">
              <label style="font-size:12px;color:var(--muted);">Slippage</label>
              <div class="slippage-btns" id="oc-slip-btns">
                <button class="slip-btn" data-slip="0.5">0.5%</button>
                <button class="slip-btn active" data-slip="2">2%</button>
                <button class="slip-btn" data-slip="5">5%</button>
                <button class="slip-btn" data-slip="12">12%</button>
              </div>
            </div>

            <div class="price-info" id="oc-quote-info" style="display:none;flex-direction:column;gap:6px;"></div>

            <button class="btn btn-primary btn-full" id="oc-action-btn" disabled style="padding:14px;font-size:15px;">Enter an amount</button>
            <div id="oc-fee-mode" class="oc-fee-mode"></div>
          </div>

          <!-- ══ LIQUIDITY PANEL (PancakeSwap ANET/BNB pool) ══ -->
          <div id="oc-liq-panel" style="display:none;">
            <div class="liq-sub-row" id="oc-liq-sub">
              <button class="liq-sub-btn active" data-liq="add">Add</button>
              <button class="liq-sub-btn" data-liq="remove">Remove</button>
            </div>

            <div id="oc-liq-add">
              <div class="token-field">
                <div class="token-field-label">ANET AMOUNT</div>
                <div class="token-field-row">
                  <span class="oc-token-fixed">${tokenLogoHtml('ANET', 18)} ANET</span>
                  <input class="amount-input" id="oc-liq-anet" type="number" placeholder="0.00" min="0" step="any" inputmode="decimal" aria-label="ANET amount">
                </div>
                <div class="token-balance-row"><span id="oc-liq-anet-bal" style="font-size:12px;color:var(--muted-2);">—</span><span class="balance-max" id="oc-liq-anet-max">MAX</span></div>
              </div>
              <div class="token-field">
                <div class="token-field-label">BNB REQUIRED (auto, at pool ratio)</div>
                <div class="token-field-row">
                  <span class="oc-token-fixed">${tokenLogoHtml('BNB', 18)} BNB</span>
                  <div class="amount-input" id="oc-liq-bnb" style="text-align:right;color:var(--accent-2);min-height:36px;display:flex;align-items:center;justify-content:flex-end;">—</div>
                </div>
                <div class="token-balance-row"><span id="oc-liq-bnb-bal" style="font-size:12px;color:var(--muted-2);">—</span></div>
              </div>
              <div class="price-info" id="oc-liq-info" style="display:none;flex-direction:column;gap:6px;"></div>
              <button class="btn btn-primary btn-full" id="oc-liq-add-btn" disabled style="padding:14px;font-size:15px;">Enter ANET amount</button>
            </div>

            <div id="oc-liq-remove" style="display:none;">
              <div class="info-box" id="oc-liq-lp" style="font-size:12.5px;">Your LP balance: <b>—</b></div>
              <div class="slippage-row" style="padding-top:4px;">
                <label style="font-size:12px;color:var(--muted);">Amount to remove</label>
                <div class="slippage-btns" id="oc-liq-pct">
                  <button class="slip-btn" data-pct="25">25%</button>
                  <button class="slip-btn" data-pct="50">50%</button>
                  <button class="slip-btn" data-pct="75">75%</button>
                  <button class="slip-btn active" data-pct="100">100%</button>
                </div>
              </div>
              <div class="price-info" id="oc-liq-remove-info" style="display:none;flex-direction:column;gap:6px;"></div>
              <button class="btn btn-outline btn-full" id="oc-liq-remove-btn" disabled style="padding:14px;font-size:15px;">Remove Liquidity</button>
            </div>

            <div class="info-box" style="font-size:11.5px;color:var(--muted-2);">
              You provide liquidity to the real PancakeSwap V2 ANET/BNB pool and receive LP tokens that earn the 0.25% pool trading fee. Withdraw anytime. No interface fee on liquidity.
            </div>
          </div>

          <div class="swap-status" id="oc-status"></div>
          <div class="info-box" id="oc-receipt" style="display:none;font-size:12px;line-height:1.5;"></div>
          <button class="btn btn-outline btn-full" id="oc-connect-btn" style="padding:12px;">Connect Wallet</button>
          <div id="oc-sol-setup" style="display:none;"></div>

          <div class="info-box" style="text-align:center;font-size:11.5px;color:var(--muted-2);">
            Self-custody · swaps settle on PancakeSwap / Uniswap / Jupiter from your wallet · <span id="oc-fee-footer">${FEE.pct}%</span> interface fee → treasury.<br>
            Not investment advice · trade at your own risk · DYOR. Restricted where required by law.
          </div>
        </div>
      </div>`;

    if (bottomHost) {
      bottomHost.innerHTML = `
        <div class="tm-bottom-tabs" id="oc-bottom-tabs" role="tablist">
          <button class="tm-chip active" data-bt="balances" role="tab">Balances</button>
          <button class="tm-chip" data-bt="trades" role="tab">My trades</button>
          <button class="tm-chip" data-bt="policy" role="tab">Fees &amp; custody</button>
        </div>
        <div id="oc-bottom-balances" class="tm-bottom-panel"><div class="tm-empty">Connect a wallet to see balances.</div></div>
        <div id="oc-bottom-trades" class="tm-bottom-panel" style="display:none;">
          <div class="onchain-history-head"><span>RECENT WALLET TRADES</span><span>Saved on this device</span></div>
          <div id="oc-history-list" class="onchain-history-list">Connect a wallet to view its saved trades.</div>
        </div>
        <div id="oc-bottom-policy" class="tm-bottom-panel" style="display:none;"></div>`;
      bottomHost.querySelectorAll('#oc-bottom-tabs .tm-chip').forEach(b => b.addEventListener('click', () => setBottomTab(b.dataset.bt)));
      renderPolicyPanel();
    } else {
      // no terminal → keep the trade history inside the ticket
      const hist = document.createElement('section');
      hist.className = 'onchain-history';
      hist.innerHTML = `<div class="onchain-history-head"><span>RECENT WALLET TRADES</span><span>Saved on this device</span></div><div id="oc-history-list" class="onchain-history-list">Connect a wallet to view its saved trades.</div>`;
      ticketHost.querySelector('.onchain-body')?.appendChild(hist);
    }

    // events
    ticketHost.querySelectorAll('#onchain-net-row .net-btn').forEach(b => b.addEventListener('click', () => setChain(b.dataset.net)));
    ticketHost.querySelectorAll('#onchain-mode-row .mode-btn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    ticketHost.querySelectorAll('.onchain-side-row .side-btn').forEach(b => b.addEventListener('click', () => setSide(b.dataset.side)));
    ticketHost.querySelectorAll('#oc-slip-btns .slip-btn').forEach(b => b.addEventListener('click', () => {
      ui.slippage = parseFloat(b.dataset.slip);
      ticketHost.querySelectorAll('#oc-slip-btns .slip-btn').forEach(x => x.classList.toggle('active', x === b));
      renderOnchainQuote();
    }));
    $('oc-from-select').addEventListener('change', (e) => { ui.fromSym = e.target.value; syncPair('from'); });
    $('oc-to-select').addEventListener('change', (e) => { ui.toSym = e.target.value; syncPair('to'); });
    $('oc-from-amount').addEventListener('input', debounce(renderOnchainQuote, 350));
    $('oc-flip').addEventListener('click', flipSide);
    $('oc-max-btn').addEventListener('click', fillMax);
    $('oc-connect-btn').addEventListener('click', connectForChain);
    $('oc-action-btn').addEventListener('click', executeOnchain);
    ticketHost.querySelectorAll('#oc-liq-sub .liq-sub-btn').forEach(b => b.addEventListener('click', () => setLiqSub(b.dataset.liq)));
    $('oc-liq-anet').addEventListener('input', debounce(renderLiqAdd, 350));
    $('oc-liq-anet-max').addEventListener('click', fillLiqAnetMax);
    $('oc-liq-add-btn').addEventListener('click', executeLiqAdd);
    ticketHost.querySelectorAll('#oc-liq-pct .slip-btn').forEach(b => b.addEventListener('click', () => {
      ui.liqPct = parseInt(b.dataset.pct, 10);
      ticketHost.querySelectorAll('#oc-liq-pct .slip-btn').forEach(x => x.classList.toggle('active', x === b));
      renderLiqRemove();
    }));
    $('oc-liq-remove-btn').addEventListener('click', executeLiqRemove);

    setChain(56);

    // terminal ↔ ticket sync
    if (window.AnetTerminal) {
      window.AnetTerminal.onMarketChange((m) => {
        ui.syncingFromMarket = true;
        try {
          if (String(m.chain) !== String(ui.chain)) setChain(m.chain, { keepPair: true });
          ui.side = 'buy';
          ensurePair(m.quote, m.base);
          document.querySelectorAll('.onchain-side-row .side-btn').forEach(b => b.classList.toggle('active', b.dataset.side === 'buy'));
          populateTokenSelects(); renderOnchainQuote(); refreshOnchainBalances();
        } finally { ui.syncingFromMarket = false; }
      });
    }
  }

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function tokensForChain() { return ui.chain === 'solana' ? SOL_TOKENS : ONCHAIN_TOKENS[ui.chain]; }

  function syncTerminalMarket() {
    if (!window.AnetTerminal || ui.syncingFromMarket) return;
    const m = window.AnetTerminal.matchMarket(ui.chain, ui.fromSym, ui.toSym);
    if (m && m.id !== window.AnetTerminal.currentMarket()?.id) window.AnetTerminal.selectMarket(m.id, { silent: true });
  }

  function setChain(net, opts = {}) {
    ui.chain = (net === 'solana') ? 'solana' : parseInt(net, 10);
    document.querySelectorAll('#onchain-net-row .net-btn').forEach(b => b.classList.toggle('active', b.dataset.net === String(net)));
    if (!opts.keepPair) {
      if (ui.chain === 'solana') { ui.fromSym = 'USDC'; ui.toSym = 'SOL'; }
      else if (ui.chain === 1)   { ui.fromSym = 'ETH';  ui.toSym = 'USDC'; }
      else                       { ui.fromSym = 'BNB';  ui.toSym = 'ANET'; }
      ui.side = 'buy';
    }
    const liqBtn = $('oc-mode-liq');
    if (liqBtn) liqBtn.style.display = LP_POOL[ui.chain] ? '' : 'none';
    if (!LP_POOL[ui.chain] && ui.mode === 'liquidity') ui.mode = 'trade';
    populateTokenSelects();
    setMode(ui.mode);
    if (!opts.keepPair) setSide('buy');
    refreshOnchainBalances();
    updateConnectBtn();
    renderFeeMode();
    renderBalancesPanel();
    if (!opts.keepPair) syncTerminalMarket();
  }

  function setMode(mode) {
    ui.mode = (mode === 'liquidity' && LP_POOL[ui.chain]) ? 'liquidity' : 'trade';
    document.querySelectorAll('#onchain-mode-row .mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === ui.mode));
    const tradePanel = $('oc-trade-panel'), liqPanel = $('oc-liq-panel');
    if (tradePanel) tradePanel.style.display = ui.mode === 'trade' ? '' : 'none';
    if (liqPanel) liqPanel.style.display = ui.mode === 'liquidity' ? '' : 'none';
    if (ui.mode === 'liquidity') { setLiqSub(ui.liqSub); refreshLiqBalances(); }
    const statusEl = $('oc-status'); if (statusEl) { statusEl.className = 'swap-status'; statusEl.innerHTML = ''; }
    const receiptEl = $('oc-receipt'); if (receiptEl) receiptEl.style.display = 'none';
  }

  function setLiqSub(sub) {
    ui.liqSub = sub === 'remove' ? 'remove' : 'add';
    document.querySelectorAll('#oc-liq-sub .liq-sub-btn').forEach(b => b.classList.toggle('active', b.dataset.liq === ui.liqSub));
    const add = $('oc-liq-add'), rem = $('oc-liq-remove');
    if (add) add.style.display = ui.liqSub === 'add' ? '' : 'none';
    if (rem) rem.style.display = ui.liqSub === 'remove' ? '' : 'none';
    if (ui.liqSub === 'add') renderLiqAdd(); else renderLiqRemove();
  }

  function populateTokenSelects() {
    const toks = tokensForChain();
    const fromSel = $('oc-from-select'), toSel = $('oc-to-select');
    if (!fromSel || !toSel) return;
    const opts = (arr) => arr.map(t => `<option value="${t.symbol}">${esc(t.symbol)}</option>`).join('');
    fromSel.innerHTML = opts(toks);
    toSel.innerHTML = opts(toks);
    fromSel.value = ui.fromSym;
    toSel.value = ui.toSym;
    const fl = $('oc-from-logo'), tl = $('oc-to-logo');
    if (fl) fl.innerHTML = tokenLogoHtml(ui.fromSym, 20);
    if (tl) tl.innerHTML = tokenLogoHtml(ui.toSym, 20);
  }

  function setSide(side) {
    ui.side = side;
    document.querySelectorAll('.onchain-side-row .side-btn').forEach(b => b.classList.toggle('active', b.dataset.side === side));
    // Flip the pair so that "buy" receives the market's base asset and "sell" spends it.
    const m = window.AnetTerminal?.currentMarket();
    if (m && String(m.chain) === String(ui.chain)) {
      if (side === 'buy') ensurePair(m.quote, m.base); else ensurePair(m.base, m.quote);
    } else if (ui.chain === 56) {
      if (side === 'buy') ensurePair('BNB', 'ANET'); else ensurePair('ANET', 'BNB');
    }
    populateTokenSelects();
    renderOnchainQuote();
    refreshOnchainBalances();
  }
  function ensurePair(from, to) { ui.fromSym = from; ui.toSym = to; }
  function flipSide() {
    const f = ui.fromSym; ui.fromSym = ui.toSym; ui.toSym = f;
    ui.side = ui.side === 'buy' ? 'sell' : 'buy';
    document.querySelectorAll('.onchain-side-row .side-btn').forEach(b => b.classList.toggle('active', b.dataset.side === ui.side));
    populateTokenSelects(); renderOnchainQuote(); refreshOnchainBalances();
  }
  function syncPair(which) {
    if (ui.fromSym === ui.toSym) {
      const alt = tokensForChain().find(t => t.symbol !== ui.fromSym);
      if (which === 'from') ui.toSym = alt.symbol; else ui.fromSym = alt.symbol;
      populateTokenSelects();
    }
    renderOnchainQuote(); refreshOnchainBalances(); syncTerminalMarket();
  }

  function setBottomTab(tab) {
    ui.bottomTab = tab;
    document.querySelectorAll('#oc-bottom-tabs .tm-chip').forEach(b => b.classList.toggle('active', b.dataset.bt === tab));
    for (const t of ['balances', 'trades', 'policy']) { const el = $('oc-bottom-' + t); if (el) el.style.display = t === tab ? '' : 'none'; }
    if (tab === 'balances') renderBalancesPanel();
  }

  function renderFeeMode() {
    const el = $('oc-fee-mode'); if (!el) return;
    const f = feeInfo(ui.chain);
    const footer = $('oc-fee-footer'); if (footer) footer.textContent = FEE_PCT_LABEL(ui.chain);
    if (ui.chain === 'solana') {
      el.innerHTML = `<span class="pill green">in-swap fee</span> ${FEE_PCT_LABEL('solana')} settled inside the Jupiter transaction to the treasury token account.`;
    } else if (f.atomic) {
      el.innerHTML = `<span class="pill green">atomic fee</span> ${FEE.pct}% collected by the <a href="${EVM_DEX[ui.chain].explorer}/address/${f.router}" target="_blank" rel="noopener">AnetFeeRouter ↗</a> in the same transaction as your swap; a failed swap pays no fee.`;
    } else {
      el.innerHTML = `<span class="pill amber">two-step fee</span> ${FEE.pct}% is sent to the treasury as a separate transfer right before the swap (the swap is simulated first; the atomic fee router is not deployed on this network yet).`;
    }
  }

  function renderPolicyPanel() {
    const el = $('oc-bottom-policy'); if (!el) return;
    const row = (k, v) => `<div class="price-row"><span>${k}</span><span class="val">${v}</span></div>`;
    const r56 = atomicRouter(56), r1 = atomicRouter(1);
    el.innerHTML = `
      <div class="tm-policy-grid">
        <div>
          <h4>Self-custody</h4>
          <p>Every trade is signed in your own wallet and settled directly on PancakeSwap V2, Uniswap V2 or Jupiter. A Network never receives, holds or forwards your funds and cannot pause, freeze or reverse a trade.</p>
        </div>
        <div>
          <h4>Interface fee (our only revenue)</h4>
          ${row('BNB Chain / Ethereum', `${FEE.pct}% of the input amount`)}
          ${row('Solana', `${FEE_PCT_LABEL('solana')} of the output (Jupiter integer bps)`)}
          ${row('EVM treasury', `<a href="https://bscscan.com/address/${FEE.evmTreasury}" target="_blank" rel="noopener">${shortId(FEE.evmTreasury)} ↗</a>`)}
          ${row('Solana treasury', `<a href="https://solscan.io/account/${FEE.solTreasury}" target="_blank" rel="noopener">${shortId(FEE.solTreasury)} ↗</a>`)}
          ${row('Fee router · BSC', r56 ? `<a href="https://bscscan.com/address/${r56}" target="_blank" rel="noopener">${shortId(r56)} ↗</a>` : 'not deployed → two-step fee')}
          ${row('Fee router · ETH', r1 ? `<a href="https://etherscan.io/address/${r1}" target="_blank" rel="noopener">${shortId(r1)} ↗</a>` : 'not deployed → two-step fee')}
        </div>
        <div>
          <h4>Pool fees (not ours)</h4>
          ${row('PancakeSwap V2', '0.25% → liquidity providers')}
          ${row('Uniswap V2', '0.30% → liquidity providers')}
          ${row('Jupiter routes', 'per-pool fees → liquidity providers')}
          ${row('Liquidity add/remove', 'no interface fee')}
        </div>
      </div>`;
  }

  /* ═══════════════════════════════════════════════════════════════════
     Balances
     ═══════════════════════════════════════════════════════════════════ */
  async function refreshOnchainBalances() {
    const el = $('oc-from-balance');
    if (!el) return;
    el.textContent = '—'; delete el.dataset.raw;
    try {
      const tok = tokensForChain().find(t => t.symbol === ui.fromSym);
      if (!tok) return;
      if (ui.chain === 'solana') {
        if (!walletState.sol) { el.textContent = 'Connect Phantom to see balance'; return; }
        const bal = await solBalanceOf(walletState.sol, tok);
        el.textContent = `Balance: ${fmtNum(bal, 4)} ${tok.symbol}`;
        el.dataset.human = String(bal);
      } else {
        if (!walletState.evm) { el.textContent = 'Connect wallet to see balance'; return; }
        let raw;
        if (tok.native) raw = BigInt(await evmRpc(ui.chain, 'eth_getBalance', [walletState.evm, 'latest']));
        else raw = await erc20BalanceOf(ui.chain, tok.addr, walletState.evm);
        el.textContent = `Balance: ${fmtNum(parseFloat(fromUnits(raw, tok.decimals)), 6)} ${tok.symbol}`;
        el.dataset.raw = raw.toString();
      }
    } catch (e) { el.textContent = '—'; }
  }

  async function fillMax() {
    const el = $('oc-from-balance');
    const tok = tokensForChain().find(t => t.symbol === ui.fromSym);
    if (!tok) return;
    if (ui.chain === 'solana') {
      const h = parseFloat(el?.dataset?.human || '0');
      if (!(h > 0)) return;
      const v = tok.native ? Math.max(0, h - 0.01) : h; // keep ~0.01 SOL for fees/rent
      $('oc-from-amount').value = String(v);
      renderOnchainQuote();
      return;
    }
    const raw = el?.dataset?.raw;
    if (!raw) return;
    let v = BigInt(raw);
    if (tok.native) { const reserve = await gasReserve(ui.chain, 3); v = v > reserve ? v - reserve : 0n; } // keep gas for fee + approve/swap
    $('oc-from-amount').value = fromUnits(v, tok.decimals);
    renderOnchainQuote();
  }

  async function renderBalancesPanel() {
    const el = $('oc-bottom-balances'); if (!el || ui.bottomTab !== 'balances') return;
    const toks = tokensForChain();
    const acct = ui.chain === 'solana' ? walletState.sol : walletState.evm;
    if (!acct) { el.innerHTML = '<div class="tm-empty">Connect a wallet to see balances on this network.</div>'; return; }
    el.innerHTML = '<div class="tm-empty"><span class="spinner"></span> Loading balances…</div>';
    const rows = [];
    try {
      if (ui.chain === 'solana') {
        for (const t of toks) {
          const bal = await solBalanceOf(acct, t).catch(() => 0);
          rows.push({ sym: t.symbol, bal, usd: prices.usd[t.symbol] != null ? bal * prices.usd[t.symbol] : null });
        }
      } else {
        const calls = toks.map(t => t.native
          ? { method: 'eth_getBalance', params: [acct, 'latest'] }
          : { method: 'eth_call', params: [{ to: t.addr, data: sel('balanceOf(address)') + encAddr(acct) }, 'latest'] });
        let res;
        try { res = await rpcBatch(ui.chain, calls); } catch (_) { res = await Promise.all(calls.map(c => evmRpc(ui.chain, c.method, c.params).catch(() => null))); }
        toks.forEach((t, i) => {
          const raw = res[i] ? BigInt(res[i]) : 0n;
          const bal = parseFloat(fromUnits(raw, t.decimals));
          rows.push({ sym: t.symbol, bal, usd: prices.usd[t.symbol] != null ? bal * prices.usd[t.symbol] : null });
        });
      }
    } catch (_) {}
    if (ui.bottomTab !== 'balances') return;
    const total = rows.reduce((a, r) => a + (r.usd || 0), 0);
    el.innerHTML = `
      <div class="tm-bal-head"><span>Asset</span><span>Balance</span><span>Value</span><span></span></div>
      ${rows.map(r => `<div class="tm-bal-row">
          <span class="tm-bal-asset">${tokenLogoHtml(r.sym, 20)}<b>${esc(r.sym)}</b></span>
          <span class="tm-mono">${fmtNum(r.bal, 6)}</span>
          <span class="tm-mono">${r.usd != null ? fmtUsd(r.usd) : '—'}</span>
          <span><button class="btn btn-ghost btn-sm" data-trade="${esc(r.sym)}">Trade</button></span>
        </div>`).join('')}
      <div class="tm-bal-total"><span>Total (${esc(String(ui.chain === 'solana' ? 'Solana' : EVM_DEX[ui.chain].name.split(' ')[0]))})</span><b>${fmtUsd(total)}</b></div>`;
    el.querySelectorAll('[data-trade]').forEach(b => b.addEventListener('click', () => {
      const sym = b.dataset.trade;
      const other = toks.find(t => t.symbol !== sym);
      ensurePair(sym, other.symbol); ui.side = 'sell';
      document.querySelectorAll('.onchain-side-row .side-btn').forEach(x => x.classList.toggle('active', x.dataset.side === 'sell'));
      setMode('trade'); populateTokenSelects(); renderOnchainQuote(); refreshOnchainBalances(); syncTerminalMarket();
      $('oc-from-amount')?.focus();
    }));
  }

  /* ═══════════════════════════════════════════════════════════════════
     Quoting  (real, chain-specific) + interface fee
     ═══════════════════════════════════════════════════════════════════ */
  async function renderOnchainQuote() {
    const amtStr = $('oc-from-amount')?.value;
    const infoEl = $('oc-quote-info'), outEl = $('oc-to-amount'), actionBtn = $('oc-action-btn');
    if (!infoEl || !outEl || !actionBtn) return;
    ui.quote = null;
    if (!amtStr || parseFloat(amtStr) <= 0 || ui.fromSym === ui.toSym) {
      infoEl.style.display = 'none';
      outEl.textContent = '—';
      actionBtn.disabled = true; actionBtn.textContent = ui.fromSym === ui.toSym ? 'Pick two tokens' : 'Enter an amount';
      return;
    }
    outEl.textContent = '…';
    const seq = (renderOnchainQuote._seq = (renderOnchainQuote._seq || 0) + 1);
    try {
      const q = (ui.chain === 'solana') ? await quoteSolana(amtStr) : await quoteEvm(amtStr);
      if (seq !== renderOnchainQuote._seq) return; // stale
      ui.quote = q;
      outEl.textContent = fmtNum(q.outHuman, 6);
      const feeUsd = q.feeUsd != null ? ` (~${fmtUsd(q.feeUsd)})` : '';
      const f = feeInfo(ui.chain);
      let feeLine;
      if (q.feeWaived) {
        feeLine = `<div class="price-row warn"><span>Interface fee</span><span class="val">waived · treasury fee account not initialized</span></div>`;
      } else {
        feeLine = `<div class="price-row"><span>Fee ${FEE_PCT_LABEL(ui.chain)} → treasury${ui.chain === 'solana' ? '' : (f.atomic ? ' (atomic)' : ' (separate tx)')}</span><span class="val">${fmtNum(q.feeHuman, 6)} ${esc(q.feeSym)}${feeUsd}</span></div>`;
      }
      infoEl.style.display = 'flex';
      infoEl.innerHTML = `
        <div class="price-row"><span>Rate</span><span class="val">1 ${esc(ui.fromSym)} ≈ ${fmtNum(q.rate, 6)} ${esc(ui.toSym)}</span></div>
        <div class="price-row"><span>You receive (est.)</span><span class="val">${fmtNum(q.outHuman, 6)} ${esc(ui.toSym)}</span></div>
        ${feeLine}
        <div class="price-row"><span>Min received (${ui.slippage}% slip.)</span><span class="val">${fmtNum(q.minOutHuman, 6)} ${esc(ui.toSym)}</span></div>
        ${q.priceImpactPct != null ? `<div class="price-row${q.priceImpactPct > 3 ? ' warn' : ''}"><span>Price impact</span><span class="val">${q.priceImpactPct.toFixed(2)}%</span></div>` : ''}
        <div class="price-row"><span>Route</span><span class="val">${esc(q.routeLabel)}</span></div>`;
      const connected = ui.chain === 'solana' ? walletState.sol : walletState.evm;
      actionBtn.disabled = false;
      actionBtn.textContent = connected ? `${ui.side === 'sell' ? 'Sell' : 'Buy'} ${esc(ui.side === 'sell' ? ui.fromSym : ui.toSym)}` : 'Connect wallet to trade';
    } catch (e) {
      if (seq !== renderOnchainQuote._seq) return;
      infoEl.style.display = 'flex'; infoEl.innerHTML = `<div class="price-row warn"><span>Quote</span><span class="val">${esc(e.message || 'unavailable')}</span></div>`;
      outEl.textContent = '—';
      actionBtn.disabled = true; actionBtn.textContent = 'No route / liquidity';
    }
  }

  function evmPath(chainId, fromTok, toTok) {
    const w = EVM_DEX[chainId].wrapped;
    const a = fromTok.native ? w : fromTok.addr;
    const b = toTok.native ? w : toTok.addr;
    if (a.toLowerCase() === b.toLowerCase()) return [a];
    if (a.toLowerCase() === w.toLowerCase() || b.toLowerCase() === w.toLowerCase()) return [a, b];
    return [a, w, b];
  }

  async function quoteEvm(amtStr) {
    const fromTok = ONCHAIN_TOKENS[ui.chain].find(t => t.symbol === ui.fromSym);
    const toTok   = ONCHAIN_TOKENS[ui.chain].find(t => t.symbol === ui.toSym);
    const amountIn = toUnits(amtStr, fromTok.decimals);
    if (amountIn <= 0n) throw new Error('enter amount');
    const { feeUnits, swapIn } = splitFee(amountIn);
    if (swapIn <= 0n) throw new Error('amount too small');
    const path = evmPath(ui.chain, fromTok, toTok);
    const outRaw = await getAmountsOut(ui.chain, swapIn, path);
    const outHuman = parseFloat(fromUnits(outRaw, toTok.decimals));
    const minOutRaw = slipFloor(outRaw, ui.slippage);
    const inHuman = parseFloat(amtStr);
    const fromUsd = priceUsdFor(fromTok.symbol), toUsd = priceUsdFor(toTok.symbol);
    const feeHuman = parseFloat(fromUnits(feeUnits, fromTok.decimals));
    let priceImpactPct = null;
    if (fromUsd && toUsd) {
      const spotOut = (parseFloat(fromUnits(swapIn, fromTok.decimals)) * fromUsd) / toUsd;
      if (spotOut > 0) priceImpactPct = Math.max(0, (1 - outHuman / spotOut) * 100 - EVM_DEX[ui.chain].poolFeePct * (path.length - 1));
    }
    return {
      kind: 'evm', fromTok, toTok, amountIn, swapIn, feeUnits, path, outRaw, outHuman, minOutRaw,
      minOutHuman: parseFloat(fromUnits(minOutRaw, toTok.decimals)),
      inHuman, feeHuman, feeSym: fromTok.symbol,
      feeUsd: fromUsd != null ? feeHuman * fromUsd : null,
      rate: outHuman / inHuman, priceImpactPct,
      routeLabel: `${EVM_DEX[ui.chain].name} · ${path.length === 2 ? 'direct' : 'via ' + EVM_DEX[ui.chain].nativeSymbol}${atomicRouter(ui.chain) ? ' · AnetFeeRouter' : ''}`,
    };
  }

  function priceUsdFor(sym) {
    const p = prices.usd[String(sym).toUpperCase()];
    return (p != null && isFinite(p)) ? p : null;
  }

  /** Raw market quote (no interface fee) used by the terminal's depth ladder. Returns human output. */
  async function quoteOut(chain, fromSym, toSym, amountHuman) {
    if (chain === 'solana') {
      const f = SOL_TOKENS.find(t => t.symbol === fromSym), t = SOL_TOKENS.find(x => x.symbol === toSym);
      const amount = toUnits(Number(amountHuman).toFixed(f.decimals), f.decimals);
      const j = await jupGet(`${JUP}/quote?inputMint=${f.mint}&outputMint=${t.mint}&amount=${amount}&slippageBps=50&restrictIntermediateTokens=true`, 0);
      if (!j || !j.outAmount) throw new Error('no route');
      return Number(j.outAmount) / 10 ** t.decimals;
    }
    const f = ONCHAIN_TOKENS[chain].find(x => x.symbol === fromSym), t = ONCHAIN_TOKENS[chain].find(x => x.symbol === toSym);
    const amountIn = toUnits(Number(amountHuman).toFixed(f.decimals), f.decimals);
    const out = await getAmountsOut(chain, amountIn, evmPath(chain, f, t));
    return parseFloat(fromUnits(out, t.decimals));
  }

  /* ═══════════════════════════════════════════════════════════════════
     EVM connect
     ═══════════════════════════════════════════════════════════════════ */
  async function connectForChain() {
    if (ui.chain === 'solana') return connectPhantom();
    return connectEvm();
  }

  async function connectEvm() {
    if (!window.ethereum) { notify('No EVM wallet found. Install MetaMask.', 'error', 5000); return; }
    try {
      const accts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      walletState.evm = accts[0];
      const cid = parseInt(await window.ethereum.request({ method: 'eth_chainId' }), 16);
      walletState.evmChain = cid;
      if (cid !== ui.chain) await switchChain(ui.chain);
      notify('EVM wallet connected', 'success');
      updateConnectBtn(); refreshOnchainBalances(); renderOnchainQuote(); renderBalancesPanel();
      if (ui.mode === 'liquidity') { refreshLiqBalances(); setLiqSub(ui.liqSub); }
    } catch (e) { notify(e.message || 'Connect failed', 'error'); }
  }

  async function switchChain(chainId) {
    const hex = EVM_DEX[chainId].chainHex;
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
      walletState.evmChain = chainId;
    } catch (e) {
      notify('Switch your wallet to ' + EVM_DEX[chainId].name.split(' ')[0], 'info', 4000);
      throw e;
    }
  }

  function updateConnectBtn() {
    const btn = $('oc-connect-btn'); if (!btn) return;
    if (ui.chain === 'solana') {
      btn.textContent = walletState.sol ? `Phantom: ${shortId(walletState.sol)}` : 'Connect Phantom';
      btn.className = 'btn btn-full ' + (walletState.sol ? 'btn-outline connected' : 'btn-outline');
    } else {
      btn.textContent = walletState.evm ? `Wallet: ${shortId(walletState.evm)}` : 'Connect Wallet (MetaMask)';
      btn.className = 'btn btn-full ' + (walletState.evm ? 'btn-outline connected' : 'btn-outline');
    }
    renderOnchainTradeHistory();
    renderSolanaSetupHint();
  }

  async function sendTx(tx) {
    return window.ethereum.request({ method: 'eth_sendTransaction', params: [tx] });
  }
  async function waitReceipt(chainId, hash, tries = 60) {
    for (let i = 0; i < tries; i++) {
      const r = await evmRpc(chainId, 'eth_getTransactionReceipt', [hash]).catch(() => null);
      if (r) return r;
      await new Promise(res => setTimeout(res, 3000));
    }
    return null;
  }
  /** Simulate a call from the user's address; throws with the revert reason. */
  async function simulate(chainId, tx) {
    const call = { from: tx.from, to: tx.to, data: tx.data };
    if (tx.value && tx.value !== '0x0') call.value = tx.value;
    await evmRpc(chainId, 'eth_call', [call, 'latest']);
  }
  const hexVal = (v) => '0x' + BigInt(v).toString(16);

  /* ═══════════════════════════════════════════════════════════════════
     EVM execute: atomic (AnetFeeRouter) or hardened two-step fallback
     ═══════════════════════════════════════════════════════════════════ */
  async function executeOnchain() {
    if (!ui.quote) { notify('Get a quote first', 'error'); return; }
    if (ui.chain === 'solana') return executeSolana();
    return executeEvm();
  }

  async function ensureAllowance(chainId, token, owner, spender, amount, label, setStatus) {
    const allowance = await erc20Allowance(chainId, token, owner, spender);
    if (allowance >= amount) return;
    const approve = async (value, step) => {
      setStatus(`<span class="spinner"></span> ${step} ${esc(label)} in your wallet…`);
      const aTx = await sendTx({ from: owner, to: token, data: sel('approve(address,uint256)') + encAddr(spender) + encUint(value) });
      const r = await waitReceipt(chainId, aTx, 60);
      if (!r || r.status === '0x0') throw new Error('Approval was not confirmed. Nothing else was sent.');
    };
    // Tokens like Ethereum USDT reject a non-zero → non-zero approve; reset first.
    if (allowance > 0n) await approve(0n, 'Reset the previous approval for');
    await approve(amount, 'Approve');
  }

  /** Gas headroom for `txCount` transactions on this chain, from the live gas price (with a floor). */
  async function gasReserve(chainId, txCount = 2) {
    const floor = chainId === 1 ? 4_000_000_000_000_000n : 1_000_000_000_000_000n; // 0.004 ETH / 0.001 BNB
    try {
      const gasPrice = BigInt(await evmRpc(chainId, 'eth_gasPrice', []));
      const est = gasPrice * 350_000n * BigInt(txCount) * 3n / 2n; // 350k gas per tx, 1.5× safety
      return est > floor ? est : floor;
    } catch (_) { return floor * BigInt(txCount); }
  }

  /**
   * Refuse to start a trade the wallet cannot finish. Critical for the two-step
   * fallback: the fee leaves the wallet first, so the swap (+ its gas) must be
   * affordable from what remains. Throws with "nothing was sent" wording.
   */
  async function assertFunds(chainId, owner, fromTok, amountIn, txCount) {
    const native = BigInt(await evmRpc(chainId, 'eth_getBalance', [owner, 'latest']));
    const reserve = await gasReserve(chainId, txCount);
    const sym = EVM_DEX[chainId].nativeSymbol;
    if (fromTok.native) {
      if (native < amountIn + reserve) {
        const max = native > reserve ? fromUnits(native - reserve, 18) : '0';
        throw new Error(`Insufficient ${sym}: ${fmtNum(parseFloat(fromUnits(amountIn, 18)), 6)} + gas for ${txCount} transaction(s) exceeds your balance. Max ≈ ${fmtNum(parseFloat(max), 6)} ${sym}. Nothing was sent.`);
      }
    } else {
      const bal = await erc20BalanceOf(chainId, fromTok.addr, owner);
      if (bal < amountIn) throw new Error(`Insufficient ${fromTok.symbol} balance (${fmtNum(parseFloat(fromUnits(bal, fromTok.decimals)), 6)} available). Nothing was sent.`);
      if (native < reserve) throw new Error(`Not enough ${sym} for gas (${txCount} transaction(s) needed). Nothing was sent.`);
    }
  }

  async function executeEvm() {
    const q = ui.quote;
    if (!walletState.evm) return connectEvm();
    if (walletState.evmChain !== ui.chain) { try { await switchChain(ui.chain); } catch { return; } }

    const btn = $('oc-action-btn'), statusEl = $('oc-status');
    const setStatus = (m, cls = 'loading') => { if (statusEl) { statusEl.className = 'swap-status show ' + cls; statusEl.innerHTML = m; } };
    btn.disabled = true;
    const dex = EVM_DEX[ui.chain];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    const from = walletState.evm;
    const feeRouter = atomicRouter(ui.chain);
    let feeTx = null, swapSent = false;

    try {
      // Re-quote right before sending so minOut reflects the current pool state.
      const fresh = await quoteEvm($('oc-from-amount').value).catch(() => null);
      if (fresh) ui.quote = Object.assign(q, fresh);

      let tx;
      if (feeRouter) {
        /* ── Atomic: fee + swap in one tx via AnetFeeRouter ──────────── */
        await assertFunds(ui.chain, from, q.fromTok, q.amountIn, q.fromTok.native ? 1 : 2);
        if (!q.fromTok.native) {
          await ensureAllowance(ui.chain, q.fromTok.addr, from, feeRouter, q.amountIn, q.fromTok.symbol, setStatus);
        }
        const call = buildFeeRouterCalldata({ fromNative: !!q.fromTok.native, toNative: !!q.toTok.native, amountIn: q.amountIn, minOut: q.minOutRaw, path: q.path, deadline });
        tx = { from, to: feeRouter, data: call.data, value: hexVal(call.value) };
        setStatus('<span class="spinner"></span> Simulating swap…');
        try { await simulate(ui.chain, tx); }
        catch (e) { throw new Error('Swap would fail: ' + cleanRevert(e.message) + '. Nothing was sent and no fee was charged.'); }
        setStatus(`<span class="spinner"></span> Confirm the swap in your wallet (fee ${FEE.pct}% + swap in one transaction)…`);
      } else {
        /* ── Fallback: funds check → simulate swap → fee transfer → swap ── */
        await assertFunds(ui.chain, from, q.fromTok, q.amountIn, q.fromTok.native ? 2 : 3);
        if (!q.fromTok.native) {
          await ensureAllowance(ui.chain, q.fromTok.addr, from, dex.router, q.swapIn, q.fromTok.symbol, setStatus);
        }
        const call = buildDexRouterCalldata({ fromNative: !!q.fromTok.native, toNative: !!q.toTok.native, swapIn: q.swapIn, minOut: q.minOutRaw, path: q.path, to: from, deadline });
        tx = { from, to: dex.router, data: call.data, value: hexVal(call.value) };
        setStatus('<span class="spinner"></span> Simulating swap before collecting the fee…');
        try { await simulate(ui.chain, tx); }
        catch (e) { throw new Error('Swap would fail: ' + cleanRevert(e.message) + '. Nothing was sent and no fee was charged.'); }

        if (q.feeUnits > 0n) {
          setStatus(`<span class="spinner"></span> Confirm the ${FEE.pct}% interface fee transfer (1 of 2)…`);
          if (q.fromTok.native) {
            feeTx = await sendTx({ from, to: FEE.evmTreasury, value: hexVal(q.feeUnits) });
          } else {
            feeTx = await sendTx({ from, to: q.fromTok.addr, data: sel('transfer(address,uint256)') + encAddr(FEE.evmTreasury) + encUint(q.feeUnits) });
          }
          setStatus(`<span class="spinner"></span> Waiting for the fee transfer… <a href="${dex.explorer}/tx/${feeTx}" target="_blank" rel="noopener">${feeTx.slice(0, 12)}…</a>`);
          const fr = await waitReceipt(ui.chain, feeTx, 40);
          if (!fr) throw new Error('Fee transfer not confirmed in time; the swap was NOT sent. Check the explorer before retrying.');
          if (fr.status === '0x0') throw new Error('Fee transfer reverted; the swap was NOT sent.');
        }
        setStatus('<span class="spinner"></span> Confirm the swap in your wallet (2 of 2)…');
      }

      const txHash = await sendTx(tx);
      swapSent = true;
      setStatus(`<span class="spinner"></span> Broadcasting… <a href="${dex.explorer}/tx/${txHash}" target="_blank" rel="noopener">${txHash.slice(0, 12)}…</a>`);
      const receipt = await waitReceipt(ui.chain, txHash, 80);
      if (!receipt) { setStatus(`⏳ Not confirmed yet. Track it on the <a href="${dex.explorer}/tx/${txHash}" target="_blank" rel="noopener">explorer ↗</a>.`, 'loading'); btn.disabled = false; return; }
      if (receipt.status === '0x0') {
        setStatus(feeRouter
          ? '✕ Transaction reverted on-chain. No funds moved and no fee was charged (try higher slippage).'
          : `✕ Swap reverted on-chain (try higher slippage).${feeTx ? ` The ${FEE.pct}% fee transfer <a href="${dex.explorer}/tx/${feeTx}" target="_blank" rel="noopener">${feeTx.slice(0, 10)}… ↗</a> had already confirmed.` : ''}`, 'error');
        btn.disabled = false; return;
      }
      setStatus(`✓ ${ui.side === 'sell' ? 'Sold' : 'Bought'} ${esc(ui.side === 'sell' ? ui.fromSym : ui.toSym)} · confirmed in block ${parseInt(receipt.blockNumber, 16)}${feeRouter ? ' · fee settled atomically' : ''}`, 'success');
      showReceipt({ chain: dex.name, explorer: dex.explorer, hash: txHash, block: parseInt(receipt.blockNumber, 16), q, feeTx, atomic: !!feeRouter });
      $('oc-from-amount').value = ''; renderOnchainQuote(); refreshOnchainBalances(); renderBalancesPanel();
      notify('Swap confirmed on-chain', 'success', 5000);
    } catch (e) {
      const rejectedAfterFee = feeTx && !swapSent;
      const feeNote = rejectedAfterFee
        ? ` The ${FEE.pct}% fee transfer <a href="${dex.explorer}/tx/${feeTx}" target="_blank" rel="noopener">${feeTx.slice(0, 10)}… ↗</a> had already confirmed; the swap was not sent.`
        : '';
      setStatus('✕ ' + esc(e.message || 'Swap failed') + feeNote, 'error');
      notify(e.message || 'Swap failed', 'error');
      btn.disabled = false;
    }
  }

  function cleanRevert(msg) {
    const m = String(msg || '');
    const i = m.indexOf('execution reverted');
    let s = i >= 0 ? m.slice(i) : m;
    s = s.replace(/^execution reverted:?\s*/i, '').trim();
    return s || 'execution reverted';
  }

  function showReceipt({ chain, explorer, hash, block, q, sig, feeTx, atomic }) {
    const el = $('oc-receipt'); if (!el) return;
    rememberOnchainTrade({ chain, explorer, hash, block, q, sig });
    const link = sig ? `https://solscan.io/tx/${sig}` : `${explorer}/tx/${hash}`;
    const feeRow = sig
      ? `<div class="price-row"><span>Interface fee</span><span class="val">${q.feeWaived ? 'waived' : `${fmtNum(q.feeHuman, 6)} ${esc(q.feeSym)} · in-swap`}</span></div>`
      : `<div class="price-row"><span>Interface fee</span><span class="val">${fmtNum(q.feeHuman, 6)} ${esc(q.feeSym)} · ${atomic ? 'atomic' : feeTx ? `<a href="${explorer}/tx/${feeTx}" target="_blank" rel="noopener">separate tx ↗</a>` : 'none'}</span></div>`;
    el.style.display = 'block';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <strong>On-chain receipt</strong><span style="color:var(--muted-2);">${new Date().toLocaleString()}</span>
      </div>
      <div class="price-row"><span>Venue</span><span class="val">${esc(chain)}</span></div>
      <div class="price-row"><span>Side</span><span class="val">${ui.side === 'sell' ? 'SELL' : 'BUY'} ${esc(ui.side === 'sell' ? q.fromTok.symbol : q.toTok.symbol)}</span></div>
      <div class="price-row"><span>Paid</span><span class="val">${fmtNum(q.inHuman || 0, 6)} ${esc(q.fromTok.symbol)}</span></div>
      <div class="price-row"><span>Received (est.)</span><span class="val">~${fmtNum(q.outHuman, 6)} ${esc(q.toTok.symbol)}</span></div>
      ${feeRow}
      ${block != null ? `<div class="price-row"><span>Block</span><span class="val">${block}</span></div>` : ''}
      <div class="price-row"><span>Tx</span><span class="val"><a href="${link}" target="_blank" rel="noopener">${esc((sig || hash).slice(0, 16))}… ↗</a></span></div>`;
  }

  function readOnchainTradeHistory() {
    try {
      const data = JSON.parse(localStorage.getItem(ONCHAIN_HISTORY_KEY) || '[]');
      return Array.isArray(data) ? data.filter(item => item && typeof item === 'object') : [];
    } catch (_) { return []; }
  }

  function rememberOnchainTrade({ chain, explorer, hash, block, q, sig }) {
    const account = String(ui.chain === 'solana' ? walletState.sol : walletState.evm || '').trim();
    const txId = String(sig || hash || '').trim();
    if (!account || !txId || !q) return;
    const entry = {
      id: `${ui.chain}:${txId}`, account, chain: String(chain || ''), chainId: ui.chain,
      side: ui.side === 'sell' ? 'SELL' : 'BUY',
      fromSymbol: String(q.fromTok?.symbol || ui.fromSym), toSymbol: String(q.toTok?.symbol || ui.toSym),
      amountIn: Number(q.inHuman ?? (q.amountIn != null ? fromUnits(q.amountIn, q.fromTok?.decimals || 18) : 0)),
      amountOut: Number(q.outHuman || 0),
      fee: Number(q.feeHuman || 0), feeSymbol: String(q.feeSym || ''),
      hash: txId, explorer: String(explorer || (sig ? 'https://solscan.io' : EVM_DEX[ui.chain]?.explorer || '')),
      block: block == null ? null : Number(block), timestamp: Date.now(),
    };
    try {
      const history = readOnchainTradeHistory().filter(item => item.id !== entry.id);
      history.unshift(entry);
      localStorage.setItem(ONCHAIN_HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
    } catch (_) {}
    renderOnchainTradeHistory();
  }

  function renderOnchainTradeHistory() {
    const list = $('oc-history-list');
    if (!list) return;
    const account = String(ui.chain === 'solana' ? walletState.sol : walletState.evm || '').trim();
    if (!account) { list.textContent = 'Connect a wallet to view its saved trades.'; return; }
    const history = readOnchainTradeHistory().filter(item => String(item.account || '').toLowerCase() === account.toLowerCase()).slice(0, 10);
    if (!history.length) { list.textContent = 'No confirmed swaps saved on this device.'; return; }
    list.innerHTML = history.map(item => {
      const txUrl = `${item.explorer}/tx/${encodeURIComponent(item.hash)}`;
      const date = new Date(item.timestamp).toLocaleString();
      return `<div class="onchain-history-row">
        <div class="onchain-history-summary"><strong>${esc(item.side)} ${esc(item.side === 'SELL' ? item.fromSymbol : item.toSymbol)}</strong><small>${esc(item.chain)} · ${esc(date)}</small></div>
        <div class="onchain-history-amounts">${fmtNum(item.amountIn, 6)} ${esc(item.fromSymbol)} <span>→</span> ~${fmtNum(item.amountOut, 6)} ${esc(item.toSymbol)}${item.fee ? ` <span>·</span> fee ${fmtNum(item.fee, 6)} ${esc(item.feeSymbol)}` : ''}</div>
        <a href="${esc(txUrl)}" target="_blank" rel="noopener noreferrer">${item.block == null ? 'View tx' : `Block ${item.block}`} ↗</a>
      </div>`;
    }).join('');
  }

  /* ═══════════════════════════════════════════════════════════════════
     Solana  (Phantom + Jupiter aggregator, in-swap interface fee)
     ═══════════════════════════════════════════════════════════════════ */
  const JUP = 'https://lite-api.jup.ag/swap/v1';

  /** GET a Jupiter endpoint; retries once on the public endpoint's rate limit. */
  async function jupGet(url, retries = 2) {
    const res = await fetch(url);
    if (res.status === 429 && retries > 0) {
      await new Promise(r => setTimeout(r, retries === 2 ? 1200 : 2500));
      return jupGet(url, retries - 1);
    }
    if (res.status === 429) throw new Error('Jupiter rate limit; please retry in a moment');
    const j = await res.json().catch(() => null);
    if (!j) throw new Error('Jupiter: bad response');
    return j;
  }

  function phantom() { return window.solana && window.solana.isPhantom ? window.solana : null; }

  async function connectPhantom() {
    const p = phantom();
    if (!p) { notify('Phantom wallet not found. Install the Phantom extension/app.', 'error', 6000); window.open('https://phantom.app/', '_blank', 'noopener'); return; }
    try {
      const resp = await p.connect();
      walletState.sol = resp.publicKey.toString();
      notify('Phantom connected', 'success');
      updateConnectBtn(); refreshOnchainBalances(); renderOnchainQuote(); renderBalancesPanel();
    } catch (e) { notify(e.message || 'Phantom connect failed', 'error'); }
  }

  async function solBalanceOf(owner, tok) {
    if (tok.native) {
      const lamports = await solRpc('getBalance', [owner]);
      return (lamports?.value ?? lamports ?? 0) / 1e9;
    }
    const res = await solRpc('getTokenAccountsByOwner', [owner, { mint: tok.mint }, { encoding: 'jsonParsed' }]);
    let total = 0;
    for (const acc of (res?.value || [])) total += acc.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
    return total;
  }

  /** Associated token account (ATA) of `owner` for `mint`; requires the vendored web3.js. */
  function deriveAta(owner, mint) {
    const S = window.AnetSolana; if (!S) return null;
    const [ata] = S.PublicKey.findProgramAddressSync(
      [new S.PublicKey(owner).toBytes(), new S.PublicKey(SOL_TOKEN_PROGRAM).toBytes(), new S.PublicKey(mint).toBytes()],
      new S.PublicKey(SOL_ATA_PROGRAM));
    return ata.toBase58();
  }

  /** Existence cache for the treasury's fee token accounts: mint → { ata, exists, t }. */
  const solFeeAccounts = {};
  async function treasuryFeeAccount(mint) {
    const c = solFeeAccounts[mint];
    if (c && Date.now() - c.t < 600_000) return c;
    const ata = deriveAta(FEE.solTreasury, mint);
    if (!ata) return null;
    let exists = false;
    try { const info = await solRpc('getAccountInfo', [ata, { encoding: 'base64' }]); exists = !!(info && info.value); } catch (_) { exists = c ? c.exists : false; }
    solFeeAccounts[mint] = { ata, exists, t: Date.now() };
    return solFeeAccounts[mint];
  }

  /**
   * Pick the fee account for a swap: Jupiter takes the fee on the OUTPUT mint
   * for ExactIn swaps when the fee account's mint is the output mint, which is
   * also how its quote reports `platformFee`. Falls back to the input mint.
   */
  async function pickSolFeeAccount(fromTok, toTok) {
    const out = await treasuryFeeAccount(toTok.mint);
    if (out?.exists) return { ata: out.ata, mint: toTok.mint, tok: toTok, onOutput: true };
    const inp = await treasuryFeeAccount(fromTok.mint);
    if (inp?.exists) return { ata: inp.ata, mint: fromTok.mint, tok: fromTok, onOutput: false };
    return null;
  }

  async function quoteSolana(amtStr) {
    const fromTok = SOL_TOKENS.find(t => t.symbol === ui.fromSym);
    const toTok   = SOL_TOKENS.find(t => t.symbol === ui.toSym);
    const amount = toUnits(amtStr, fromTok.decimals);
    if (amount <= 0n) throw new Error('enter amount');
    const slipBps = Math.round(ui.slippage * 100);
    const feeAcct = await pickSolFeeAccount(fromTok, toTok);
    const url = `${JUP}/quote?inputMint=${fromTok.mint}&outputMint=${toTok.mint}&amount=${amount.toString()}&slippageBps=${slipBps}&restrictIntermediateTokens=true`
      + (feeAcct ? `&platformFeeBps=${FEE.solanaBps}` : '');
    const jq = await jupGet(url);
    if (!jq || jq.error || !jq.outAmount) throw new Error(jq?.error || 'no route');
    const outHuman = Number(jq.outAmount) / (10 ** toTok.decimals);
    const inHuman = parseFloat(amtStr);
    const otherAmountThreshold = Number(jq.otherAmountThreshold || jq.outAmount);
    let feeHuman = 0, feeSym = toTok.symbol, feeUsd = null;
    if (feeAcct) {
      const pf = jq.platformFee && jq.platformFee.amount != null ? Number(jq.platformFee.amount) : null;
      if (pf != null) { feeHuman = pf / 10 ** feeAcct.tok.decimals; feeSym = feeAcct.tok.symbol; }
      else { feeHuman = (feeAcct.onOutput ? outHuman : inHuman) * FEE.solanaBps / 10_000; feeSym = feeAcct.tok.symbol; }
      const usd = priceUsdFor(feeSym); feeUsd = usd != null ? feeHuman * usd : null;
    }
    return {
      kind: 'solana', fromTok, toTok, jupQuote: jq, feeAccount: feeAcct ? feeAcct.ata : null, feeWaived: !feeAcct,
      inHuman, outHuman, rate: outHuman / inHuman,
      minOutHuman: otherAmountThreshold / (10 ** toTok.decimals),
      feeHuman, feeSym, feeUsd,
      priceImpactPct: jq.priceImpactPct != null ? Math.abs(parseFloat(jq.priceImpactPct)) * 100 : null,
      routeLabel: 'Jupiter · ' + (jq.routePlan?.length || 1) + ' hop(s)',
    };
  }

  async function executeSolana() {
    const q = ui.quote;
    if (!walletState.sol) return connectPhantom();
    if (!window.AnetSolana) { notify('Solana module still loading; try again in a moment.', 'error'); return; }
    const p = phantom();
    if (!p) return connectPhantom();

    const btn = $('oc-action-btn'), statusEl = $('oc-status');
    const setStatus = (m, cls = 'loading') => { if (statusEl) { statusEl.className = 'swap-status show ' + cls; statusEl.innerHTML = m; } };
    btn.disabled = true;
    try {
      setStatus('<span class="spinner"></span> Building Jupiter swap…');
      const body = {
        quoteResponse: q.jupQuote,
        userPublicKey: walletState.sol,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      };
      if (q.feeAccount) body.feeAccount = q.feeAccount;
      const swapRes = await fetch(`${JUP}/swap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const swapJson = await swapRes.json();
      if (!swapJson.swapTransaction) throw new Error(swapJson.error || 'swap build failed');

      const bytes = Uint8Array.from(atob(swapJson.swapTransaction), c => c.charCodeAt(0));
      const tx = window.AnetSolana.VersionedTransaction.deserialize(bytes);

      setStatus(`<span class="spinner"></span> Approve the swap in Phantom${q.feeAccount ? ` (includes the ${FEE_PCT_LABEL('solana')} fee)` : ''}…`);
      const { signature } = await p.signAndSendTransaction(tx);

      setStatus(`<span class="spinner"></span> Confirming… <a href="https://solscan.io/tx/${signature}" target="_blank" rel="noopener">${signature.slice(0, 12)}…</a>`);
      const ok = await confirmSol(signature, 40);
      if (!ok) { setStatus(`✕ Not confirmed in time. Check <a href="https://solscan.io/tx/${signature}" target="_blank" rel="noopener">Solscan ↗</a>.`, 'error'); btn.disabled = false; return; }

      setStatus(`✓ Swapped on Solana via Jupiter · confirmed${q.feeAccount ? ' · fee settled in-swap' : ''}`, 'success');
      showReceipt({ chain: 'Jupiter (Solana)', sig: signature, q });
      $('oc-from-amount').value = ''; renderOnchainQuote(); refreshOnchainBalances(); renderBalancesPanel();
      notify('Solana swap confirmed', 'success', 5000);
    } catch (e) {
      setStatus('✕ ' + esc(e.message || 'Swap failed'), 'error');
      notify(e.message || 'Solana swap failed', 'error');
      btn.disabled = false;
    }
  }

  async function confirmSol(sig, tries = 40) {
    for (let i = 0; i < tries; i++) {
      const r = await solRpc('getSignatureStatuses', [[sig], { searchTransactionHistory: true }]).catch(() => null);
      const st = r?.value?.[0];
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') && !st.err) return true;
      if (st && st.err) return false;
      await new Promise(res => setTimeout(res, 2000));
    }
    return false;
  }

  /* ── Operator helper: initialize the treasury's fee token accounts ──
     Creating an ATA owned by the treasury is permissionless (the payer only
     funds rent, ~0.002 SOL each). Jupiter requires these accounts to exist
     before it can deposit fees. Exposed as AnetDexOnchain.setupSolanaFeeAccounts();
     a button also appears in the ticket when the connected Phantom wallet IS the treasury. */
  function ataCreateIdempotentIx(payer, owner, mint) {
    const S = window.AnetSolana;
    const ata = deriveAta(owner, mint);
    return {
      programId: new S.PublicKey(SOL_ATA_PROGRAM),
      keys: [
        { pubkey: new S.PublicKey(payer), isSigner: true,  isWritable: true },
        { pubkey: new S.PublicKey(ata),   isSigner: false, isWritable: true },
        { pubkey: new S.PublicKey(owner), isSigner: false, isWritable: false },
        { pubkey: new S.PublicKey(mint),  isSigner: false, isWritable: false },
        { pubkey: new S.PublicKey(SOL_SYSTEM_PROGRAM), isSigner: false, isWritable: false },
        { pubkey: new S.PublicKey(SOL_TOKEN_PROGRAM),  isSigner: false, isWritable: false },
      ],
      data: Uint8Array.from([1]), // CreateIdempotent
    };
  }

  async function setupSolanaFeeAccounts() {
    const S = window.AnetSolana, p = phantom();
    if (!S || !p) throw new Error('Phantom + Solana module required');
    if (!walletState.sol) await connectPhantom();
    if (!walletState.sol) throw new Error('Connect Phantom first');
    const missing = [];
    for (const t of SOL_TOKENS) { const a = await treasuryFeeAccount(t.mint); if (!a?.exists) missing.push(t); }
    if (!missing.length) { notify('All treasury fee accounts already exist.', 'success'); return []; }
    const tx = new S.Transaction();
    tx.feePayer = new S.PublicKey(walletState.sol);
    const bh = await solRpc('getLatestBlockhash', [{ commitment: 'finalized' }]);
    tx.recentBlockhash = bh?.value?.blockhash || bh?.blockhash;
    for (const t of missing) tx.add(ataCreateIdempotentIx(walletState.sol, FEE.solTreasury, t.mint));
    const { signature } = await p.signAndSendTransaction(tx);
    const ok = await confirmSol(signature, 40);
    if (!ok) throw new Error('Fee account creation not confirmed: ' + signature);
    for (const t of missing) delete solFeeAccounts[t.mint];
    notify(`Created ${missing.length} treasury fee account(s)`, 'success', 6000);
    renderSolanaSetupHint(); renderOnchainQuote();
    return missing.map(t => ({ symbol: t.symbol, ata: deriveAta(FEE.solTreasury, t.mint), signature }));
  }

  async function renderSolanaSetupHint() {
    const el = $('oc-sol-setup'); if (!el) return;
    el.style.display = 'none'; el.innerHTML = '';
    if (ui.chain !== 'solana' || !walletState.sol || walletState.sol !== FEE.solTreasury || !window.AnetSolana) return;
    const missing = [];
    for (const t of SOL_TOKENS) { const a = await treasuryFeeAccount(t.mint); if (!a?.exists) missing.push(t.symbol); }
    if (!missing.length) return;
    el.style.display = '';
    el.innerHTML = `<div class="info-box" style="font-size:12px;">Treasury wallet detected. Fee accounts missing for <b>${esc(missing.join(', '))}</b>. Jupiter cannot deposit fees until they exist.
      <button class="btn btn-outline btn-sm" id="oc-sol-setup-btn" style="margin-left:8px;">Initialize fee accounts</button></div>`;
    $('oc-sol-setup-btn').addEventListener('click', async () => {
      const b = $('oc-sol-setup-btn'); b.disabled = true;
      try { await setupSolanaFeeAccounts(); } catch (e) { notify(e.message || 'setup failed', 'error'); b.disabled = false; }
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     Liquidity  (real PancakeSwap V2 ANET/BNB pool; anyone can LP)
     ═══════════════════════════════════════════════════════════════════ */
  async function getPoolReserves(chainId) {
    const cfg = LP_POOL[chainId];
    const [reservesHex, token0Hex] = await Promise.all([
      evmCall(chainId, cfg.pair, sel('getReserves()')),
      evmCall(chainId, cfg.pair, sel('token0()')),
    ]);
    const body = reservesHex.replace(/^0x/, '');
    const r0 = BigInt('0x' + body.slice(0, 64));
    const r1 = BigInt('0x' + body.slice(64, 128));
    const token0 = '0x' + token0Hex.replace(/^0x/, '').slice(24);
    const anetIsToken0 = token0.toLowerCase() === cfg.token.toLowerCase();
    return { anetReserve: anetIsToken0 ? r0 : r1, bnbReserve: anetIsToken0 ? r1 : r0 };
  }

  function slipDown(v) { return slipFloor(v, ui.slippage); }

  async function renderLiqAdd() {
    const cfg = LP_POOL[ui.chain]; if (!cfg) return;
    const infoEl = $('oc-liq-info'), bnbEl = $('oc-liq-bnb'), btn = $('oc-liq-add-btn');
    ui.liqAdd = null;
    const anetStr = $('oc-liq-anet')?.value;
    if (!anetStr || parseFloat(anetStr) <= 0) {
      if (bnbEl) bnbEl.textContent = '—';
      if (infoEl) infoEl.style.display = 'none';
      if (btn) { btn.disabled = true; btn.textContent = 'Enter ANET amount'; }
      return;
    }
    if (bnbEl) bnbEl.textContent = '…';
    try {
      const anetUnits = toUnits(anetStr, cfg.tokenDec);
      const { anetReserve, bnbReserve } = await getPoolReserves(ui.chain);
      if (anetReserve <= 0n) throw new Error('pool empty');
      const bnbUnits = anetUnits * bnbReserve / anetReserve;
      ui.liqAdd = { anetUnits, bnbUnits };
      const bnbHuman = parseFloat(fromUnits(bnbUnits, 18));
      if (bnbEl) bnbEl.textContent = fmtNum(bnbHuman, 6);
      const sharePct = Number(anetUnits * 1000000n / (anetReserve + anetUnits)) / 10000;
      const anetUsd = priceUsdFor('ANET'), bnbUsd = priceUsdFor('BNB');
      const totalUsd = (anetUsd ? parseFloat(anetStr) * anetUsd : 0) + (bnbUsd ? bnbHuman * bnbUsd : 0);
      infoEl.style.display = 'flex';
      infoEl.innerHTML = `
        <div class="price-row"><span>Deposit</span><span class="val">${fmtNum(parseFloat(anetStr), 4)} ANET + ${fmtNum(bnbHuman, 6)} BNB</span></div>
        ${totalUsd ? `<div class="price-row"><span>Value</span><span class="val">${fmtUsd(totalUsd)}</span></div>` : ''}
        <div class="price-row"><span>Pool share (after)</span><span class="val">~${sharePct < 0.01 ? '<0.01' : fmtNum(sharePct, 3)}%</span></div>
        <div class="price-row"><span>Pool</span><span class="val">PancakeSwap V2 · earns 0.25%</span></div>`;
      btn.disabled = false;
      btn.textContent = walletState.evm ? 'Add Liquidity' : 'Connect wallet to add';
    } catch (e) {
      if (bnbEl) bnbEl.textContent = '—';
      if (infoEl) { infoEl.style.display = 'flex'; infoEl.innerHTML = `<div class="price-row warn"><span>Pool</span><span class="val">${esc(e.message || 'unavailable')}</span></div>`; }
      if (btn) { btn.disabled = true; btn.textContent = 'Unavailable'; }
    }
  }

  async function fillLiqAnetMax() {
    const cfg = LP_POOL[ui.chain]; if (!cfg || !walletState.evm) { notify('Connect your wallet first', 'info'); return; }
    try {
      const raw = await erc20BalanceOf(ui.chain, cfg.token, walletState.evm);
      $('oc-liq-anet').value = fromUnits(raw, cfg.tokenDec);
      renderLiqAdd();
    } catch (_) {}
  }

  async function refreshLiqBalances() {
    const cfg = LP_POOL[ui.chain]; if (!cfg) return;
    const anetBalEl = $('oc-liq-anet-bal'), bnbBalEl = $('oc-liq-bnb-bal');
    if (!walletState.evm) {
      if (anetBalEl) anetBalEl.textContent = 'Connect wallet to see balance';
      if (bnbBalEl) bnbBalEl.textContent = '';
      return;
    }
    try {
      const [anetRaw, bnbRaw] = await Promise.all([
        erc20BalanceOf(ui.chain, cfg.token, walletState.evm),
        evmRpc(ui.chain, 'eth_getBalance', [walletState.evm, 'latest']).then(h => BigInt(h)),
      ]);
      if (anetBalEl) anetBalEl.textContent = `Balance: ${fmtNum(parseFloat(fromUnits(anetRaw, cfg.tokenDec)), 4)} ANET`;
      if (bnbBalEl) bnbBalEl.textContent = `Balance: ${fmtNum(parseFloat(fromUnits(bnbRaw, 18)), 6)} BNB`;
    } catch (_) {}
  }

  async function renderLiqRemove() {
    const cfg = LP_POOL[ui.chain]; if (!cfg) return;
    const lpEl = $('oc-liq-lp'), infoEl = $('oc-liq-remove-info'), btn = $('oc-liq-remove-btn');
    ui.liqRemove = null;
    if (!walletState.evm) {
      if (lpEl) lpEl.innerHTML = 'Connect your wallet to see LP balance.';
      if (infoEl) infoEl.style.display = 'none';
      if (btn) { btn.disabled = true; btn.textContent = 'Connect wallet'; }
      return;
    }
    try {
      const [lpBal, totalSupplyHex, reserves] = await Promise.all([
        erc20BalanceOf(ui.chain, cfg.pair, walletState.evm),
        evmCall(ui.chain, cfg.pair, sel('totalSupply()')),
        getPoolReserves(ui.chain),
      ]);
      ui.lpBalance = lpBal;
      if (lpEl) lpEl.innerHTML = `Your LP balance: <b>${fmtNum(parseFloat(fromUnits(lpBal, 18)), 8)} ANET-BNB LP</b>`;
      if (lpBal <= 0n) {
        if (infoEl) infoEl.style.display = 'none';
        if (btn) { btn.disabled = true; btn.textContent = 'No LP to remove'; }
        return;
      }
      const totalSupply = BigInt(totalSupplyHex);
      const lpToRemove = lpBal * BigInt(ui.liqPct) / 100n;
      const anetOut = lpToRemove * reserves.anetReserve / totalSupply;
      const bnbOut = lpToRemove * reserves.bnbReserve / totalSupply;
      ui.liqRemove = { lpToRemove, anetOut, bnbOut };
      infoEl.style.display = 'flex';
      infoEl.innerHTML = `
        <div class="price-row"><span>Removing</span><span class="val">${ui.liqPct}% of your LP</span></div>
        <div class="price-row"><span>You receive (est.)</span><span class="val">${fmtNum(parseFloat(fromUnits(anetOut, cfg.tokenDec)), 4)} ANET + ${fmtNum(parseFloat(fromUnits(bnbOut, 18)), 6)} BNB</span></div>`;
      btn.disabled = false;
      btn.textContent = `Remove ${ui.liqPct}% Liquidity`;
    } catch (e) {
      if (infoEl) { infoEl.style.display = 'flex'; infoEl.innerHTML = `<div class="price-row warn"><span>Pool</span><span class="val">${esc(e.message || 'unavailable')}</span></div>`; }
      if (btn) { btn.disabled = true; btn.textContent = 'Unavailable'; }
    }
  }

  function liqReceipt(title, rows, hash) {
    const el = $('oc-receipt'); if (!el) return;
    const dex = EVM_DEX[ui.chain];
    el.style.display = 'block';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <strong>${esc(title)}</strong><span style="color:var(--muted-2);">${new Date().toLocaleString()}</span>
      </div>
      ${rows}
      <div class="price-row"><span>Tx</span><span class="val"><a href="${dex.explorer}/tx/${hash}" target="_blank" rel="noopener">${esc(hash.slice(0, 16))}… ↗</a></span></div>`;
  }

  async function executeLiqAdd() {
    const cfg = LP_POOL[ui.chain]; if (!cfg) return;
    if (!ui.liqAdd) { notify('Enter an ANET amount', 'error'); return; }
    if (!walletState.evm) return connectEvm();
    if (walletState.evmChain !== ui.chain) { try { await switchChain(ui.chain); } catch { return; } }

    const btn = $('oc-liq-add-btn'), statusEl = $('oc-status');
    const setStatus = (m, cls = 'loading') => { if (statusEl) { statusEl.className = 'swap-status show ' + cls; statusEl.innerHTML = m; } };
    btn.disabled = true;
    const dex = EVM_DEX[ui.chain];
    const to = walletState.evm;
    const { anetUnits, bnbUnits } = ui.liqAdd;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    try {
      await ensureAllowance(ui.chain, cfg.token, to, dex.router, anetUnits, 'ANET', setStatus);
      setStatus('<span class="spinner"></span> Confirm Add Liquidity in your wallet…');
      const data = sel('addLiquidityETH(address,uint256,uint256,uint256,address,uint256)')
        + encAddr(cfg.token) + encUint(anetUnits) + encUint(slipDown(anetUnits)) + encUint(slipDown(bnbUnits)) + encAddr(to) + encUint(deadline);
      const txHash = await sendTx({ from: to, to: dex.router, data, value: hexVal(bnbUnits) });
      setStatus(`<span class="spinner"></span> Adding liquidity… <a href="${dex.explorer}/tx/${txHash}" target="_blank" rel="noopener">${txHash.slice(0, 12)}…</a>`);
      const receipt = await waitReceipt(ui.chain, txHash, 80);
      if (!receipt || receipt.status === '0x0') { setStatus('✕ Add Liquidity reverted or not confirmed (try higher slippage).', 'error'); btn.disabled = false; return; }
      setStatus(`✓ Liquidity added · confirmed in block ${parseInt(receipt.blockNumber, 16)}`, 'success');
      liqReceipt('Liquidity added', `
        <div class="price-row"><span>Deposited</span><span class="val">${fmtNum(parseFloat(fromUnits(anetUnits, cfg.tokenDec)), 4)} ANET + ${fmtNum(parseFloat(fromUnits(bnbUnits, 18)), 6)} BNB</span></div>
        <div class="price-row"><span>Pool</span><span class="val">PancakeSwap V2 ANET/BNB</span></div>`, txHash);
      $('oc-liq-anet').value = ''; renderLiqAdd(); refreshLiqBalances();
      notify('Liquidity added on-chain', 'success', 5000);
    } catch (e) {
      setStatus('✕ ' + esc(e.message || 'Add liquidity failed'), 'error');
      notify(e.message || 'Add liquidity failed', 'error');
      btn.disabled = false;
    }
  }

  async function executeLiqRemove() {
    const cfg = LP_POOL[ui.chain]; if (!cfg) return;
    if (!ui.liqRemove || ui.liqRemove.lpToRemove <= 0n) { notify('Nothing to remove', 'error'); return; }
    if (!walletState.evm) return connectEvm();
    if (walletState.evmChain !== ui.chain) { try { await switchChain(ui.chain); } catch { return; } }

    const btn = $('oc-liq-remove-btn'), statusEl = $('oc-status');
    const setStatus = (m, cls = 'loading') => { if (statusEl) { statusEl.className = 'swap-status show ' + cls; statusEl.innerHTML = m; } };
    btn.disabled = true;
    const dex = EVM_DEX[ui.chain];
    const to = walletState.evm;
    const { lpToRemove, anetOut, bnbOut } = ui.liqRemove;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    try {
      await ensureAllowance(ui.chain, cfg.pair, to, dex.router, lpToRemove, 'LP token', setStatus);
      setStatus('<span class="spinner"></span> Confirm Remove Liquidity in your wallet…');
      const data = sel('removeLiquidityETHSupportingFeeOnTransferTokens(address,uint256,uint256,uint256,address,uint256)')
        + encAddr(cfg.token) + encUint(lpToRemove) + encUint(slipDown(anetOut)) + encUint(slipDown(bnbOut)) + encAddr(to) + encUint(deadline);
      const txHash = await sendTx({ from: to, to: dex.router, data });
      setStatus(`<span class="spinner"></span> Removing liquidity… <a href="${dex.explorer}/tx/${txHash}" target="_blank" rel="noopener">${txHash.slice(0, 12)}…</a>`);
      const receipt = await waitReceipt(ui.chain, txHash, 80);
      if (!receipt || receipt.status === '0x0') { setStatus('✕ Remove Liquidity reverted or not confirmed (try higher slippage).', 'error'); btn.disabled = false; return; }
      setStatus(`✓ Liquidity removed · confirmed in block ${parseInt(receipt.blockNumber, 16)}`, 'success');
      liqReceipt('Liquidity removed', `
        <div class="price-row"><span>Received (est.)</span><span class="val">${fmtNum(parseFloat(fromUnits(anetOut, cfg.tokenDec)), 4)} ANET + ${fmtNum(parseFloat(fromUnits(bnbOut, 18)), 6)} BNB</span></div>
        <div class="price-row"><span>Pool</span><span class="val">PancakeSwap V2 ANET/BNB</span></div>`, txHash);
      renderLiqRemove(); refreshLiqBalances();
      notify('Liquidity removed on-chain', 'success', 5000);
    } catch (e) {
      setStatus('✕ ' + esc(e.message || 'Remove liquidity failed'), 'error');
      notify(e.message || 'Remove liquidity failed', 'error');
      btn.disabled = false;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Boot
     ═══════════════════════════════════════════════════════════════════ */
  async function boot() {
    mount();
    // Verify atomic fee routers (if configured) before the first quote renders a fee mode.
    await Promise.all(Object.keys(FEE_ROUTER).map(c => verifyFeeRouter(parseInt(c, 10))));
    renderFeeMode(); renderPolicyPanel();

    if (window.AnetTerminal) {
      window.AnetTerminal.registerProvider({
        evmCall, evmRpc, rpcBatch,
        getUsd: (sym) => prices.usd[String(sym || '').toUpperCase()] ?? null,
        getAnet: () => prices.anet,
        getChange24h: (sym) => prices.change24h[String(sym || '').toUpperCase()] ?? null,
        getVolume24h: (sym) => prices.vol24h[String(sym || '').toUpperCase()] ?? null,
        onPrices: (cb) => priceListeners.push(cb),
        feeInfo, quoteOut,
      });
    }

    refreshPrices();
    fetchAnetSupply();
    setInterval(refreshPrices, 20_000);

    if (window.ethereum) {
      window.ethereum.on?.('accountsChanged', (a) => { walletState.evm = a?.[0] || ''; updateConnectBtn(); refreshOnchainBalances(); renderBalancesPanel(); if (ui.mode === 'liquidity') { refreshLiqBalances(); setLiqSub(ui.liqSub); } });
      window.ethereum.on?.('chainChanged', (c) => { walletState.evmChain = parseInt(c, 16); refreshOnchainBalances(); if (ui.mode === 'liquidity') refreshLiqBalances(); });
    }
  }

  /* Public surface: operator helper + pure functions for the Node test harness. */
  window.AnetDexOnchain = {
    FEE, FEE_ROUTER, EVM_DEX, ONCHAIN_TOKENS, SOL_TOKENS,
    setupSolanaFeeAccounts,
    feeInfo,
    __test: {
      toUnits, fromUnits, splitFee, slipFloor, encAddrArray, encAddr, encUint,
      buildDexRouterCalldata, buildFeeRouterCalldata, evmPath, cleanRevert, deriveAta, ataCreateIdempotentIx,
      SELECTORS, SOL_TOKEN_PROGRAM, SOL_ATA_PROGRAM,
      verifyFeeRouter, feeRouterState,
      ensureAllowance, assertFunds, gasReserve,
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
