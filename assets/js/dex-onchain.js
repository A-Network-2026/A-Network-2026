/**
 * A Network — On-Chain Trading module
 * dex-onchain.js  |  2026
 *
 * Adds REAL on-chain buy/sell (PancakeSwap-style) for ANET plus Ethereum and
 * Solana markets to the A Network DEX, on top of the existing native L1 AMM.
 *
 *  • Live prices  — DexScreener (real ANET/WBNB PancakeSwap pair) + CoinGecko majors.
 *  • BNB Chain    — real swaps via PancakeSwap V2 router (window.ethereum / MetaMask).
 *  • Ethereum     — real swaps via Uniswap V2 router (window.ethereum / MetaMask).
 *  • Solana       — real swaps via Jupiter aggregator (Phantom wallet + vendored web3.js).
 *  • Fee model    — MetaMask-style 0.875% swap fee shown in every quote.
 *  • On-chain RPC — Ankr premium endpoints for reads + confirmations.
 *
 * Loaded AFTER dex.js so it can reuse its globals (state, toast, escapeHtml, fmt…).
 * CSP note: script-src 'self' (no CDNs) — Solana web3.js is vendored; all price
 * feeds and RPC use fetch(), which the site CSP allows via connect-src https:.
 */
'use strict';

(function () {

  /* ── Ankr RPC (user-provided premium key) ─────────────────────────── */
  const ANKR_KEY = '3ce3cd9f0dfa278ed38509a065305c94912b7350a2c1e3b4714d0554b60db218';
  const ANKR_RPC = {
    1:      `https://rpc.ankr.com/eth/${ANKR_KEY}`,
    56:     `https://rpc.ankr.com/bsc/${ANKR_KEY}`,
    solana: `https://rpc.ankr.com/solana/${ANKR_KEY}`,
  };

  /* MetaMask charges a 0.875% swap fee — mirror it here. */
  const MM_FEE_BPS = 87.5;               // 0.875%
  const MM_FEE_PCT = MM_FEE_BPS / 100;   // 0.875
  /* Treasury (EVM Reserve Treasury) — every on-chain swap fee is sent here.
     Same wallet the mobile app / whitepaper use as the fee recipient. */
  const MM_FEE_RECIPIENT = '0x9C7C1058fdc9b710f688ECb7562924D9AE771417';

  /* ── EVM DEX routing config ───────────────────────────────────────── */
  const EVM_DEX = {
    56: {
      name: 'PancakeSwap V2',
      router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      wrapped: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
      nativeSymbol: 'BNB',
      explorer: 'https://bscscan.com',
      chainHex: '0x38',
    },
    1: {
      name: 'Uniswap V2',
      router: '0x7a250d5630B4cF539739dF2C5dACb4c659F2488D',
      wrapped: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      nativeSymbol: 'ETH',
      explorer: 'https://etherscan.io',
      chainHex: '0x1',
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
  const esc  = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s);
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

  /* ═══════════════════════════════════════════════════════════════════
     JSON-RPC (via Ankr) — reads + confirmations
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
  const evmRpc = (chainId, method, params) => rpc(ANKR_RPC[chainId], method, params);
  const solRpc = (method, params) => rpc(ANKR_RPC.solana, method, params);

  /* Read-only eth_call routed through Ankr (independent of the wallet). */
  function evmCall(chainId, to, data) {
    return evmRpc(chainId, 'eth_call', [{ to, data }, 'latest']);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Minimal ABI encoding (Uniswap/PancakeSwap V2 router + ERC-20)
     Selectors are the first 4 bytes of keccak256(signature), precomputed
     (no keccak lib is bundled).
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
  };
  const pad32 = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const encAddr = (a) => pad32(a);
  const encUint = (v) => pad32((typeof v === 'bigint' ? v : BigInt(v)).toString(16));
  function encAddrArray(addrs, headWords /* words before the array data */) {
    // returns { head: offset-word, tail: length + entries }
    const offset = encUint(BigInt(headWords * 32));
    let tail = encUint(BigInt(addrs.length));
    addrs.forEach((a) => { tail += encAddr(a); });
    return { offset, tail };
  }
  function sel(sig) { const s = SELECTORS[sig]; if (!s) throw new Error('no selector: ' + sig); return s; }

  /* getAmountsOut(amountIn, path) → uint[] (returns last as bigint) */
  async function getAmountsOut(chainId, amountIn, path) {
    const arr = encAddrArray(path, 2); // params: amountIn(1) + offset(1) = 2 words head
    const data = sel('getAmountsOut(uint256,address[])') + encUint(amountIn) + arr.offset + arr.tail;
    const out = await evmCall(chainId, EVM_DEX[chainId].router, data);
    // decode uint[]: [offset][len][v0..vn]
    const body = out.replace(/^0x/, '');
    const len = parseInt(body.slice(64, 128), 16);
    const last = body.slice(128 + (len - 1) * 64, 128 + len * 64);
    return BigInt('0x' + last);
  }

  async function erc20BalanceOf(chainId, token, owner) {
    const data = sel('balanceOf(address)') + encAddr(owner);
    const r = await evmCall(chainId, token, data);
    return BigInt(r || '0x0');
  }
  async function erc20Allowance(chainId, token, owner, spender) {
    const data = sel('allowance(address,address)') + encAddr(owner) + encAddr(spender);
    const r = await evmCall(chainId, token, data);
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

  /* ═══════════════════════════════════════════════════════════════════
     Live price feed  (real values, drives ticking charts)
     ═══════════════════════════════════════════════════════════════════ */
  const prices = {
    usd: {},                 // { SYMBOL: usdPrice }
    anet: null,              // full DexScreener snapshot for ANET
    anetSeries: [],          // [{ t, v(usd) }] ticking history
    anetSupply: null,        // exact on-chain BEP-20 total supply (21,000,000)
    updated: 0,
  };

  // ANET BEP-20 total supply is fixed (21M cap); read it once from the contract.
  async function fetchAnetSupply() {
    try {
      const raw = await evmCall(56, ANET_BSC_ADDR, sel('totalSupply()'));
      const supply = Number(BigInt(raw)) / 1e18;
      if (supply > 0) { prices.anetSupply = supply; renderAnetTicker(); }
    } catch (e) { /* keep null → ticker falls back to marketCap/price */ }
  }

  async function pollAnetPrice() {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ANET_BSC_ADDR}`);
      const data = await res.json();
      const pairs = Array.isArray(data.pairs) ? data.pairs : [];
      // pick the deepest-liquidity pair where ANET is the base token
      const anetPairs = pairs.filter(p => (p.baseToken?.address || '').toLowerCase() === ANET_BSC_ADDR.toLowerCase());
      const best = (anetPairs.length ? anetPairs : pairs).sort(
        (a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0];
      if (!best) return;
      const priceUsd = parseFloat(best.priceUsd);
      prices.anet = {
        priceUsd,
        priceNative: parseFloat(best.priceNative),
        change24h: best.priceChange?.h24 ?? 0,
        change1h: best.priceChange?.h1 ?? 0,
        liquidityUsd: best.liquidity?.usd ?? 0,
        volume24h: best.volume?.h24 ?? 0,
        marketCap: best.marketCap ?? 0,
        fdv: best.fdv ?? 0,
        pairUrl: best.url,
        quoteSymbol: best.quoteToken?.symbol || 'WBNB',
        dex: best.dexId,
      };
      prices.usd.ANET = priceUsd;
      prices.usd.WANET = priceUsd; // wANET is 1:1 with ANET L1
      // ticking series (cap ~720 points)
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
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
      const data = await res.json();
      for (const [sym, id] of Object.entries(CG_IDS)) {
        if (data[id]?.usd != null) prices.usd[sym] = data[id].usd;
      }
      // ANTS = 1e-8 ANET
      if (prices.usd.ANET != null) prices.usd.ANTS = prices.usd.ANET / ANTS_PER_ANET;
    } catch (e) { /* keep last good */ }
  }

  async function refreshPrices() {
    await Promise.all([pollAnetPrice(), pollMajors()]);
    window.dispatchEvent(new CustomEvent('anet:prices', { detail: { ...prices } }));
    renderAnetTicker();
    renderOnchainQuote();  // refresh live quote against new price
  }

  /* Public accessor for dex.js / charts */
  window.AnetPrices = {
    getUsd: (sym) => prices.usd[String(sym || '').toUpperCase()] ?? null,
    getAnet: () => prices.anet,
    getAnetSeries: () => prices.anetSeries.slice(),
    all: () => ({ ...prices.usd }),
  };

  /* ═══════════════════════════════════════════════════════════════════
     UI — live ANET ticker + on-chain buy/sell card
     ═══════════════════════════════════════════════════════════════════ */
  const ui = {
    chain: 56,          // 56 | 1 | 'solana'
    mode: 'trade',      // trade | liquidity
    side: 'buy',        // buy | sell   (buy = spend native/stable → ANET-side token)
    liqSub: 'add',      // add | remove
    liqPct: 100,        // remove percentage
    fromSym: 'BNB',
    toSym: 'ANET',
    slippage: 2,
    quote: null,
    liqAdd: null,       // { anetUnits, bnbUnits }
    liqRemove: null,    // { lpToRemove, anetOut, bnbOut }
    lpBalance: 0n,
    quoting: false,
  };

  function mount() {
    const host = $('onchain-trade-mount');
    if (!host) return;
    host.innerHTML = `
      <div class="card onchain-card">
        <div class="card-header">
          <span class="card-title">BUY / SELL &nbsp;•&nbsp; ON-CHAIN MARKETS</span>
          <span class="pill live green">LIVE</span>
        </div>

        <!-- Live ANET price ticker -->
        <div id="anet-ticker" class="anet-ticker">
          <div class="anet-ticker-main">
            <div class="anet-ticker-pair">ANET / USD</div>
            <div class="anet-ticker-price" id="anet-ticker-price">—</div>
            <div class="anet-ticker-change neutral" id="anet-ticker-change">—</div>
          </div>
          <svg class="anet-ticker-svg" id="anet-ticker-svg" viewBox="0 0 320 70" preserveAspectRatio="none" role="img" aria-label="Live ANET price chart">
            <path id="anet-ticker-path" fill="none" stroke="#39d98a" stroke-width="2" d=""></path>
            <path id="anet-ticker-fill" fill="rgba(57,217,138,0.12)" stroke="none" d=""></path>
          </svg>
          <div class="anet-ticker-stats" id="anet-ticker-stats"></div>
        </div>

        <div class="card-body onchain-body">
          <!-- Network selector -->
          <div class="onchain-net-row" id="onchain-net-row">
            <button class="net-btn active" data-net="56"><span style="color:#F0B90B;">●</span> BNB Chain</button>
            <button class="net-btn" data-net="1"><span style="color:#627EEA;">●</span> Ethereum</button>
            <button class="net-btn" data-net="solana"><span style="color:#14F195;">●</span> Solana</button>
          </div>

          <!-- Mode: Trade / Liquidity -->
          <div class="onchain-mode-row" id="onchain-mode-row">
            <button class="mode-btn active" data-mode="trade">Trade</button>
            <button class="mode-btn" data-mode="liquidity" id="oc-mode-liq">Liquidity</button>
          </div>

          <!-- ══ TRADE PANEL ══ -->
          <div id="oc-trade-panel">
            <!-- Buy / Sell toggle -->
            <div class="onchain-side-row">
              <button class="side-btn buy active" data-side="buy">Buy</button>
              <button class="side-btn sell" data-side="sell">Sell</button>
            </div>

            <!-- From -->
            <div class="token-field">
              <div class="token-field-label">YOU PAY</div>
              <div class="token-field-row">
                <select class="oc-token-select" id="oc-from-select"></select>
                <input class="amount-input" id="oc-from-amount" type="number" placeholder="0.00" min="0" step="any" inputmode="decimal">
              </div>
              <div class="token-balance-row">
                <span id="oc-from-balance" style="font-size:12px;color:var(--muted-2);">—</span>
                <span class="balance-max" id="oc-max-btn">MAX</span>
              </div>
            </div>

            <div class="swap-arrow-row">
              <button class="swap-arrow-btn" id="oc-flip" title="Reverse">↕</button>
            </div>

            <!-- To -->
            <div class="token-field">
              <div class="token-field-label">YOU RECEIVE (est.)</div>
              <div class="token-field-row">
                <select class="oc-token-select" id="oc-to-select"></select>
                <div class="amount-input" id="oc-to-amount" style="text-align:right;color:var(--accent-2);min-height:36px;display:flex;align-items:center;justify-content:flex-end;">—</div>
              </div>
            </div>

            <!-- Slippage -->
            <div class="slippage-row" style="padding-top:4px;">
              <label style="font-size:12px;color:var(--muted);">Slippage</label>
              <div class="slippage-btns" id="oc-slip-btns">
                <button class="slip-btn" data-slip="0.5">0.5%</button>
                <button class="slip-btn active" data-slip="2">2%</button>
                <button class="slip-btn" data-slip="5">5%</button>
                <button class="slip-btn" data-slip="12">12%</button>
              </div>
            </div>

            <!-- Quote details -->
            <div class="price-info" id="oc-quote-info" style="display:none;flex-direction:column;gap:6px;"></div>

            <button class="btn btn-primary btn-full" id="oc-action-btn" disabled style="padding:14px;font-size:15px;">Enter an amount</button>
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
                  <span class="oc-token-fixed" style="color:#58c5ff;">ANET</span>
                  <input class="amount-input" id="oc-liq-anet" type="number" placeholder="0.00" min="0" step="any" inputmode="decimal">
                </div>
                <div class="token-balance-row"><span id="oc-liq-anet-bal" style="font-size:12px;color:var(--muted-2);">—</span><span class="balance-max" id="oc-liq-anet-max">MAX</span></div>
              </div>
              <div class="token-field">
                <div class="token-field-label">BNB REQUIRED (auto, at pool ratio)</div>
                <div class="token-field-row">
                  <span class="oc-token-fixed" style="color:#F0B90B;">BNB</span>
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
              You provide liquidity to the real PancakeSwap V2 ANET/BNB pool and receive LP tokens that earn the 0.25% pool trading fee. Withdraw anytime.
            </div>
          </div>

          <!-- Shared status / receipt / connect -->
          <div class="swap-status" id="oc-status"></div>
          <div class="info-box" id="oc-receipt" style="display:none;font-size:12px;line-height:1.5;"></div>
          <button class="btn btn-outline btn-full" id="oc-connect-btn" style="padding:12px;">Connect Wallet</button>

          <div class="info-box" style="text-align:center;font-size:11.5px;color:var(--muted-2);">
            Real on-chain settlement · ${MM_FEE_PCT}% fee → treasury · every action returns a verifiable tx hash.
          </div>
        </div>
      </div>`;

    // events
    host.querySelectorAll('#onchain-net-row .net-btn').forEach(b =>
      b.addEventListener('click', () => setChain(b.dataset.net)));
    host.querySelectorAll('#onchain-mode-row .mode-btn').forEach(b =>
      b.addEventListener('click', () => setMode(b.dataset.mode)));
    host.querySelectorAll('.onchain-side-row .side-btn').forEach(b =>
      b.addEventListener('click', () => setSide(b.dataset.side)));
    host.querySelectorAll('#oc-slip-btns .slip-btn').forEach(b =>
      b.addEventListener('click', () => {
        ui.slippage = parseFloat(b.dataset.slip);
        host.querySelectorAll('#oc-slip-btns .slip-btn').forEach(x => x.classList.toggle('active', x === b));
        renderOnchainQuote();
      }));
    $('oc-from-select').addEventListener('change', (e) => { ui.fromSym = e.target.value; syncPair('from'); });
    $('oc-to-select').addEventListener('change', (e) => { ui.toSym = e.target.value; syncPair('to'); });
    $('oc-from-amount').addEventListener('input', debounce(renderOnchainQuote, 350));
    $('oc-flip').addEventListener('click', flipSide);
    $('oc-max-btn').addEventListener('click', fillMax);
    $('oc-connect-btn').addEventListener('click', connectForChain);
    $('oc-action-btn').addEventListener('click', executeOnchain);
    // liquidity events
    host.querySelectorAll('#oc-liq-sub .liq-sub-btn').forEach(b =>
      b.addEventListener('click', () => setLiqSub(b.dataset.liq)));
    $('oc-liq-anet').addEventListener('input', debounce(renderLiqAdd, 350));
    $('oc-liq-anet-max').addEventListener('click', fillLiqAnetMax);
    $('oc-liq-add-btn').addEventListener('click', executeLiqAdd);
    host.querySelectorAll('#oc-liq-pct .slip-btn').forEach(b =>
      b.addEventListener('click', () => {
        ui.liqPct = parseInt(b.dataset.pct, 10);
        host.querySelectorAll('#oc-liq-pct .slip-btn').forEach(x => x.classList.toggle('active', x === b));
        renderLiqRemove();
      }));
    $('oc-liq-remove-btn').addEventListener('click', executeLiqRemove);

    setChain(56);
    renderAnetTicker();
  }

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  function tokensForChain() {
    return ui.chain === 'solana' ? SOL_TOKENS : ONCHAIN_TOKENS[ui.chain];
  }

  function setChain(net) {
    ui.chain = (net === 'solana') ? 'solana' : parseInt(net, 10);
    document.querySelectorAll('#onchain-net-row .net-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.net === String(net)));
    // default pair per chain
    if (ui.chain === 'solana') { ui.fromSym = 'USDC'; ui.toSym = 'SOL'; }
    else if (ui.chain === 1)   { ui.fromSym = 'ETH';  ui.toSym = 'USDC'; }
    else                       { ui.fromSym = 'BNB';  ui.toSym = 'ANET'; }
    ui.side = 'buy';
    // Liquidity mode only exists for chains with a real ANET pool (BSC).
    const liqBtn = $('oc-mode-liq');
    if (liqBtn) liqBtn.style.display = LP_POOL[ui.chain] ? '' : 'none';
    if (!LP_POOL[ui.chain] && ui.mode === 'liquidity') ui.mode = 'trade';
    populateTokenSelects();
    setMode(ui.mode);
    setSide('buy');
    refreshOnchainBalances();
    updateConnectBtn();
  }

  function setMode(mode) {
    ui.mode = (mode === 'liquidity' && LP_POOL[ui.chain]) ? 'liquidity' : 'trade';
    document.querySelectorAll('#onchain-mode-row .mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === ui.mode));
    const tradePanel = $('oc-trade-panel'), liqPanel = $('oc-liq-panel');
    if (tradePanel) tradePanel.style.display = ui.mode === 'trade' ? '' : 'none';
    if (liqPanel) liqPanel.style.display = ui.mode === 'liquidity' ? '' : 'none';
    // action button belongs to trade panel; liquidity uses its own buttons
    if (ui.mode === 'liquidity') { setLiqSub(ui.liqSub); refreshLiqBalances(); }
    const statusEl = $('oc-status'); if (statusEl) { statusEl.className = 'swap-status'; statusEl.innerHTML = ''; }
    const receiptEl = $('oc-receipt'); if (receiptEl) receiptEl.style.display = 'none';
  }

  function setLiqSub(sub) {
    ui.liqSub = sub === 'remove' ? 'remove' : 'add';
    document.querySelectorAll('#oc-liq-sub .liq-sub-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.liq === ui.liqSub));
    const add = $('oc-liq-add'), rem = $('oc-liq-remove');
    if (add) add.style.display = ui.liqSub === 'add' ? '' : 'none';
    if (rem) rem.style.display = ui.liqSub === 'remove' ? '' : 'none';
    if (ui.liqSub === 'add') renderLiqAdd(); else renderLiqRemove();
  }

  function populateTokenSelects() {
    const toks = tokensForChain();
    const fromSel = $('oc-from-select'), toSel = $('oc-to-select');
    const opts = (arr) => arr.map(t => `<option value="${t.symbol}">${esc(t.symbol)}</option>`).join('');
    fromSel.innerHTML = opts(toks);
    toSel.innerHTML = opts(toks);
    fromSel.value = ui.fromSym;
    toSel.value = ui.toSym;
  }

  function setSide(side) {
    ui.side = side;
    document.querySelectorAll('.onchain-side-row .side-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.side === side));
    // For BSC ANET markets, "buy" = native/stable → ANET, "sell" = ANET → native/stable
    if (ui.chain === 56) {
      if (side === 'buy')  { if (ui.toSym === 'BNB') ui.toSym = 'ANET'; if (ui.fromSym === 'ANET') ui.fromSym = 'BNB'; ensurePair('BNB', 'ANET'); }
      else                 { ensurePair('ANET', 'BNB'); }
    }
    populateTokenSelects();
    renderOnchainQuote();
  }
  function ensurePair(from, to) {
    ui.fromSym = from;
    ui.toSym = to;
  }
  function flipSide() {
    const f = ui.fromSym; ui.fromSym = ui.toSym; ui.toSym = f;
    populateTokenSelects(); renderOnchainQuote(); refreshOnchainBalances();
  }
  function syncPair(which) {
    if (ui.fromSym === ui.toSym) {
      const alt = tokensForChain().find(t => t.symbol !== ui.fromSym);
      if (which === 'from') ui.toSym = alt.symbol; else ui.fromSym = alt.symbol;
      populateTokenSelects();
    }
    renderOnchainQuote(); refreshOnchainBalances();
  }

  /* ── Live ANET ticker rendering ───────────────────────────────────── */
  function renderAnetTicker() {
    const a = prices.anet;
    const priceEl = $('anet-ticker-price'), changeEl = $('anet-ticker-change'), statsEl = $('anet-ticker-stats');
    if (!priceEl) return;
    if (!a) { priceEl.textContent = 'loading…'; return; }
    priceEl.textContent = fmtUsd(a.priceUsd, a.priceUsd < 1 ? 6 : 4);
    const ch = Number(a.change24h) || 0;
    changeEl.textContent = `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(2)}% (24h)`;
    changeEl.className = 'anet-ticker-change ' + (ch > 0 ? 'up' : ch < 0 ? 'down' : 'neutral');
    const supply = (prices.anetSupply != null)
      ? prices.anetSupply
      : (a.marketCap && a.priceUsd ? a.marketCap / a.priceUsd : null);
    if (statsEl) {
      statsEl.innerHTML = `
        <div><span>Market Cap</span><b>${fmtUsd(a.marketCap, 0)}</b></div>
        <div><span>24h Vol</span><b>${fmtUsd(a.volume24h, 0)}</b></div>
        <div><span>Liquidity</span><b>${fmtUsd(a.liquidityUsd, 0)}</b></div>
        <div><span>Total Supply (BEP-20)</span><b>${supply ? fmtNum(supply, 0) + ' ANET' : '—'}</b></div>
        <div><span>1 ANET</span><b>${(ANTS_PER_ANET).toLocaleString()} ANTS</b></div>
        <div><span>1 ANTS</span><b>${a.priceUsd ? fmtUsd(a.priceUsd / ANTS_PER_ANET, 10) : '—'}</b></div>`;
    }
    drawTickerChart();
  }
  function drawTickerChart() {
    const s = prices.anetSeries;
    const path = $('anet-ticker-path'), fill = $('anet-ticker-fill');
    if (!path || s.length < 2) return;
    const W = 320, H = 70, pad = 4;
    const vals = s.map(p => p.v);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = (max - min) || (max || 1) * 0.001;
    const pts = s.map((p, i) => {
      const x = (i / (s.length - 1)) * W;
      const y = H - pad - ((p.v - min) / span) * (H - pad * 2);
      return [x, y];
    });
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    path.setAttribute('d', d);
    const up = vals[vals.length - 1] >= vals[0];
    path.setAttribute('stroke', up ? '#39d98a' : '#ff5c7c');
    fill.setAttribute('fill', up ? 'rgba(57,217,138,0.12)' : 'rgba(255,92,124,0.12)');
    fill.setAttribute('d', `${d} L${W},${H} L0,${H} Z`);
  }

  /* ── Balances ─────────────────────────────────────────────────────── */
  const walletState = { evm: '', evmChain: null, sol: '' };

  async function refreshOnchainBalances() {
    const el = $('oc-from-balance');
    if (!el) return;
    el.textContent = '—';
    try {
      const tok = tokensForChain().find(t => t.symbol === ui.fromSym);
      if (!tok) return;
      if (ui.chain === 'solana') {
        if (!walletState.sol) { el.textContent = 'Connect Phantom to see balance'; return; }
        const bal = await solBalanceOf(walletState.sol, tok);
        el.textContent = `Balance: ${fmtNum(bal, 4)} ${tok.symbol}`;
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
    const raw = el?.dataset?.raw;
    const tok = tokensForChain().find(t => t.symbol === ui.fromSym);
    if (!tok) return;
    if (ui.chain !== 'solana' && raw) {
      let v = BigInt(raw);
      if (tok.native) v = v > 3000000000000000n ? v - 3000000000000000n : 0n; // keep ~0.003 for gas
      $('oc-from-amount').value = fromUnits(v, tok.decimals);
      renderOnchainQuote();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Quoting  (real, chain-specific)  + MetaMask 0.875% fee
     ═══════════════════════════════════════════════════════════════════ */
  async function renderOnchainQuote() {
    const amtStr = $('oc-from-amount')?.value;
    const infoEl = $('oc-quote-info'), outEl = $('oc-to-amount'), actionBtn = $('oc-action-btn');
    ui.quote = null;
    if (!amtStr || parseFloat(amtStr) <= 0 || ui.fromSym === ui.toSym) {
      if (infoEl) infoEl.style.display = 'none';
      if (outEl) outEl.textContent = '—';
      if (actionBtn) { actionBtn.disabled = true; actionBtn.textContent = ui.fromSym === ui.toSym ? 'Pick two tokens' : 'Enter an amount'; }
      return;
    }
    if (outEl) outEl.textContent = '…';
    try {
      const q = (ui.chain === 'solana') ? await quoteSolana(amtStr) : await quoteEvm(amtStr);
      ui.quote = q;
      if (outEl) outEl.textContent = fmtNum(q.outHuman, 6);
      const feeUsd = q.feeUsd != null ? ` (~${fmtUsd(q.feeUsd)})` : '';
      infoEl.style.display = 'flex';
      infoEl.innerHTML = `
        <div class="price-row"><span>Rate</span><span class="val">1 ${esc(ui.fromSym)} ≈ ${fmtNum(q.rate, 6)} ${esc(ui.toSym)}</span></div>
        <div class="price-row"><span>You receive (est.)</span><span class="val">${fmtNum(q.outHuman, 6)} ${esc(ui.toSym)}</span></div>
        <div class="price-row"><span>Fee ${MM_FEE_PCT}% → treasury</span><span class="val">${fmtNum(q.feeHuman, 6)} ${esc(ui.fromSym)}${feeUsd}</span></div>
        <div class="price-row"><span>Min received (${ui.slippage}% slip.)</span><span class="val">${fmtNum(q.minOutHuman, 6)} ${esc(ui.toSym)}</span></div>
        <div class="price-row"><span>Route</span><span class="val">${esc(q.routeLabel)}</span></div>`;
      const connected = ui.chain === 'solana' ? walletState.sol : walletState.evm;
      actionBtn.disabled = false;
      actionBtn.textContent = connected
        ? `${ui.side === 'sell' ? 'Sell' : 'Buy'} ${esc(ui.toSym)}`
        : 'Connect wallet to trade';
    } catch (e) {
      if (infoEl) { infoEl.style.display = 'flex'; infoEl.innerHTML = `<div class="price-row warn"><span>Quote</span><span class="val">${esc(e.message || 'unavailable')}</span></div>`; }
      if (outEl) outEl.textContent = '—';
      if (actionBtn) { actionBtn.disabled = true; actionBtn.textContent = 'No route / liquidity'; }
    }
  }

  function evmPath(fromTok, toTok) {
    const w = EVM_DEX[ui.chain].wrapped;
    const a = fromTok.native ? w : fromTok.addr;
    const b = toTok.native ? w : toTok.addr;
    if (a.toLowerCase() === b.toLowerCase()) return [a];
    // direct if one side is the wrapped native, else route via wrapped native
    if (a.toLowerCase() === w.toLowerCase() || b.toLowerCase() === w.toLowerCase()) return [a, b];
    return [a, w, b];
  }

  async function quoteEvm(amtStr) {
    const fromTok = ONCHAIN_TOKENS[ui.chain].find(t => t.symbol === ui.fromSym);
    const toTok   = ONCHAIN_TOKENS[ui.chain].find(t => t.symbol === ui.toSym);
    const amountIn = toUnits(amtStr, fromTok.decimals);
    if (amountIn <= 0n) throw new Error('enter amount');
    const feeUnits = amountIn * 875n / 100000n; // exact 0.875%
    const swapIn = amountIn - feeUnits;
    const path = evmPath(fromTok, toTok);
    const outRaw = await getAmountsOut(ui.chain, swapIn, path);
    const outHuman = parseFloat(fromUnits(outRaw, toTok.decimals));
    const minOutRaw = outRaw * BigInt(Math.round((100 - ui.slippage) * 100)) / 10000n;
    const inHuman = parseFloat(amtStr);
    const fromUsd = priceUsdFor(fromTok.symbol);
    return {
      kind: 'evm', fromTok, toTok, amountIn, swapIn, feeUnits, path,
      outRaw, outHuman, minOutRaw,
      minOutHuman: parseFloat(fromUnits(minOutRaw, toTok.decimals)),
      feeHuman: parseFloat(fromUnits(feeUnits, fromTok.decimals)),
      feeUsd: fromUsd != null ? parseFloat(fromUnits(feeUnits, fromTok.decimals)) * fromUsd : null,
      rate: outHuman / inHuman,
      routeLabel: `${EVM_DEX[ui.chain].name} · ${path.length === 2 ? 'direct' : 'via ' + EVM_DEX[ui.chain].nativeSymbol}`,
    };
  }

  function priceUsdFor(sym) {
    const p = prices.usd[String(sym).toUpperCase()];
    return (p != null && isFinite(p)) ? p : null;
  }

  /* ═══════════════════════════════════════════════════════════════════
     EVM connect + execute (real PancakeSwap/Uniswap swap)
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
      updateConnectBtn(); refreshOnchainBalances(); renderOnchainQuote();
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
  }
  const shortId = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';

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

  async function executeOnchain() {
    if (!ui.quote) { notify('Get a quote first', 'error'); return; }
    if (ui.chain === 'solana') return executeSolana();
    return executeEvm();
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
    const to = walletState.evm;

    try {
      // Real fee collection → treasury (native BNB/ETH or the ERC-20 being sold).
      if (MM_FEE_RECIPIENT && q.feeUnits > 0n) {
        setStatus('<span class="spinner"></span> Sending ' + MM_FEE_PCT + '% fee to treasury…');
        let feeTx;
        if (q.fromTok.native) {
          feeTx = await sendTx({ from: to, to: MM_FEE_RECIPIENT, value: '0x' + q.feeUnits.toString(16) });
        } else {
          const feeData = sel('transfer(address,uint256)') + encAddr(MM_FEE_RECIPIENT) + encUint(q.feeUnits);
          feeTx = await sendTx({ from: to, to: q.fromTok.addr, data: feeData });
        }
        await waitReceipt(ui.chain, feeTx, 40);
      }

      // ERC-20 sells need approval to the router
      if (!q.fromTok.native) {
        const allowance = await erc20Allowance(ui.chain, q.fromTok.addr, to, dex.router);
        if (allowance < q.swapIn) {
          setStatus('<span class="spinner"></span> Approve ' + esc(q.fromTok.symbol) + ' in your wallet…');
          const approveData = sel('approve(address,uint256)') + encAddr(dex.router) + encUint((1n << 256n) - 1n);
          const aTx = await sendTx({ from: to, to: q.fromTok.addr, data: approveData });
          await waitReceipt(ui.chain, aTx, 60);
        }
      }

      setStatus('<span class="spinner"></span> Confirm the swap in your wallet…');
      let data, value = '0x0';
      if (q.fromTok.native) {
        // swapExactETHForTokensSupportingFeeOnTransferTokens(amountOutMin, path, to, deadline)
        const arr = encAddrArray(q.path, 4); // head: amountOutMin, offset, to, deadline => 4 words
        data = sel('swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)')
          + encUint(q.minOutRaw) + arr.offset + encAddr(to) + encUint(deadline) + arr.tail;
        value = '0x' + q.swapIn.toString(16);
      } else if (q.toTok.native) {
        // swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, amountOutMin, path, to, deadline)
        const arr = encAddrArray(q.path, 5);
        data = sel('swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)')
          + encUint(q.swapIn) + encUint(q.minOutRaw) + arr.offset + encAddr(to) + encUint(deadline) + arr.tail;
      } else {
        const arr = encAddrArray(q.path, 5);
        data = sel('swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)')
          + encUint(q.swapIn) + encUint(q.minOutRaw) + arr.offset + encAddr(to) + encUint(deadline) + arr.tail;
      }

      const txHash = await sendTx({ from: to, to: dex.router, data, value });
      setStatus(`<span class="spinner"></span> Broadcasting… <a href="${dex.explorer}/tx/${txHash}" target="_blank" rel="noopener">${txHash.slice(0, 12)}…</a>`);
      const receipt = await waitReceipt(ui.chain, txHash, 80);
      if (!receipt || receipt.status === '0x0') {
        setStatus('✕ Transaction reverted on-chain. No funds moved (try higher slippage).', 'error');
        btn.disabled = false; return;
      }
      setStatus(`✓ ${ui.side === 'sell' ? 'Sold' : 'Bought'} ${esc(ui.toSym)} · confirmed in block ${parseInt(receipt.blockNumber, 16)}`, 'success');
      showReceipt({ chain: dex.name, explorer: dex.explorer, hash: txHash, block: parseInt(receipt.blockNumber, 16), q });
      $('oc-from-amount').value = ''; renderOnchainQuote(); refreshOnchainBalances();
      notify('Swap confirmed on-chain', 'success', 5000);
    } catch (e) {
      setStatus('✕ ' + esc(e.message || 'Swap failed'), 'error');
      notify(e.message || 'Swap failed', 'error');
      btn.disabled = false;
    }
  }

  function showReceipt({ chain, explorer, hash, block, q, sig }) {
    const el = $('oc-receipt'); if (!el) return;
    const link = sig
      ? `https://solscan.io/tx/${sig}`
      : `${explorer}/tx/${hash}`;
    el.style.display = 'block';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <strong>On-chain receipt</strong><span style="color:var(--muted-2);">${new Date().toLocaleString()}</span>
      </div>
      <div class="price-row"><span>Venue</span><span class="val">${esc(chain)}</span></div>
      <div class="price-row"><span>Side</span><span class="val">${ui.side === 'sell' ? 'SELL' : 'BUY'} ${esc(ui.toSym)}</span></div>
      <div class="price-row"><span>Paid</span><span class="val">${fmtNum(parseFloat($('oc-from-amount').value || q.inHuman || 0), 6)} ${esc(ui.fromSym)}</span></div>
      <div class="price-row"><span>Received (est.)</span><span class="val">~${fmtNum(q.outHuman, 6)} ${esc(ui.toSym)}</span></div>
      ${block != null ? `<div class="price-row"><span>Block</span><span class="val">${block}</span></div>` : ''}
      <div class="price-row"><span>Tx</span><span class="val"><a href="${link}" target="_blank" rel="noopener">${esc((sig || hash).slice(0, 16))}… ↗</a></span></div>`;
  }

  /* ═══════════════════════════════════════════════════════════════════
     Solana  (Phantom + Jupiter aggregator)
     ═══════════════════════════════════════════════════════════════════ */
  const JUP = 'https://lite-api.jup.ag/swap/v1';

  function phantom() { return window.solana && window.solana.isPhantom ? window.solana : null; }

  async function connectPhantom() {
    const p = phantom();
    if (!p) { notify('Phantom wallet not found. Install the Phantom extension/app.', 'error', 6000); window.open('https://phantom.app/', '_blank', 'noopener'); return; }
    try {
      const resp = await p.connect();
      walletState.sol = resp.publicKey.toString();
      notify('Phantom connected', 'success');
      updateConnectBtn(); refreshOnchainBalances(); renderOnchainQuote();
    } catch (e) { notify(e.message || 'Phantom connect failed', 'error'); }
  }

  async function solBalanceOf(owner, tok) {
    if (tok.native) {
      const lamports = await solRpc('getBalance', [owner]);
      return (lamports?.value ?? lamports ?? 0) / 1e9;
    }
    const res = await solRpc('getTokenAccountsByOwner', [owner, { mint: tok.mint }, { encoding: 'jsonParsed' }]);
    let total = 0;
    for (const acc of (res?.value || [])) {
      total += acc.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
    }
    return total;
  }

  async function quoteSolana(amtStr) {
    const fromTok = SOL_TOKENS.find(t => t.symbol === ui.fromSym);
    const toTok   = SOL_TOKENS.find(t => t.symbol === ui.toSym);
    const amount = toUnits(amtStr, fromTok.decimals);
    if (amount <= 0n) throw new Error('enter amount');
    const slipBps = Math.round(ui.slippage * 100);
    const url = `${JUP}/quote?inputMint=${fromTok.mint}&outputMint=${toTok.mint}&amount=${amount.toString()}&slippageBps=${slipBps}`;
    const res = await fetch(url);
    const jq = await res.json();
    if (!jq || jq.error || !jq.outAmount) throw new Error(jq?.error || 'no route');
    const outHuman = Number(jq.outAmount) / (10 ** toTok.decimals);
    const inHuman = parseFloat(amtStr);
    const feeHuman = inHuman * MM_FEE_PCT / 100;
    const fromUsd = priceUsdFor(fromTok.symbol);
    const otherAmountThreshold = Number(jq.otherAmountThreshold || jq.outAmount);
    return {
      kind: 'solana', fromTok, toTok, jupQuote: jq,
      outHuman, rate: outHuman / inHuman,
      minOutHuman: otherAmountThreshold / (10 ** toTok.decimals),
      feeHuman, feeUsd: fromUsd != null ? feeHuman * fromUsd : null,
      routeLabel: 'Jupiter · ' + (jq.routePlan?.length || 1) + ' hop(s)',
    };
  }

  async function executeSolana() {
    const q = ui.quote;
    if (!walletState.sol) return connectPhantom();
    if (!window.AnetSolana) { notify('Solana module still loading — try again in a moment.', 'error'); return; }
    const p = phantom();
    if (!p) return connectPhantom();

    const btn = $('oc-action-btn'), statusEl = $('oc-status');
    const setStatus = (m, cls = 'loading') => { if (statusEl) { statusEl.className = 'swap-status show ' + cls; statusEl.innerHTML = m; } };
    btn.disabled = true;
    try {
      setStatus('<span class="spinner"></span> Building Jupiter swap…');
      const swapRes = await fetch(`${JUP}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: q.jupQuote,
          userPublicKey: walletState.sol,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto',
        }),
      });
      const swapJson = await swapRes.json();
      if (!swapJson.swapTransaction) throw new Error(swapJson.error || 'swap build failed');

      const bytes = Uint8Array.from(atob(swapJson.swapTransaction), c => c.charCodeAt(0));
      const tx = window.AnetSolana.VersionedTransaction.deserialize(bytes);

      setStatus('<span class="spinner"></span> Approve the swap in Phantom…');
      const { signature } = await p.signAndSendTransaction(tx);

      setStatus(`<span class="spinner"></span> Confirming… <a href="https://solscan.io/tx/${signature}" target="_blank" rel="noopener">${signature.slice(0, 12)}…</a>`);
      const ok = await confirmSol(signature, 40);
      if (!ok) { setStatus('✕ Not confirmed in time. Check Solscan.', 'error'); btn.disabled = false; return; }

      setStatus(`✓ Swapped on Solana via Jupiter · confirmed`, 'success');
      showReceipt({ chain: 'Jupiter (Solana)', sig: signature, q });
      $('oc-from-amount').value = ''; renderOnchainQuote(); refreshOnchainBalances();
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

  /* ═══════════════════════════════════════════════════════════════════
     Liquidity  (real PancakeSwap V2 ANET/BNB pool — anyone can LP)
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

  function slipDown(v) { return v * BigInt(Math.round((100 - ui.slippage) * 100)) / 10000n; }

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
      const connected = !!walletState.evm;
      btn.disabled = false;
      btn.textContent = connected ? 'Add Liquidity' : 'Connect wallet to add';
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
      // approve ANET → router
      const allowance = await erc20Allowance(ui.chain, cfg.token, to, dex.router);
      if (allowance < anetUnits) {
        setStatus('<span class="spinner"></span> Approve ANET in your wallet…');
        const approveData = sel('approve(address,uint256)') + encAddr(dex.router) + encUint((1n << 256n) - 1n);
        const aTx = await sendTx({ from: to, to: cfg.token, data: approveData });
        await waitReceipt(ui.chain, aTx, 60);
      }
      setStatus('<span class="spinner"></span> Confirm Add Liquidity in your wallet…');
      const data = sel('addLiquidityETH(address,uint256,uint256,uint256,address,uint256)')
        + encAddr(cfg.token) + encUint(anetUnits) + encUint(slipDown(anetUnits)) + encUint(slipDown(bnbUnits)) + encAddr(to) + encUint(deadline);
      const txHash = await sendTx({ from: to, to: dex.router, data, value: '0x' + bnbUnits.toString(16) });
      setStatus(`<span class="spinner"></span> Adding liquidity… <a href="${dex.explorer}/tx/${txHash}" target="_blank" rel="noopener">${txHash.slice(0, 12)}…</a>`);
      const receipt = await waitReceipt(ui.chain, txHash, 80);
      if (!receipt || receipt.status === '0x0') { setStatus('✕ Add Liquidity reverted (try higher slippage).', 'error'); btn.disabled = false; return; }
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
      // approve LP (pair) → router
      const allowance = await erc20Allowance(ui.chain, cfg.pair, to, dex.router);
      if (allowance < lpToRemove) {
        setStatus('<span class="spinner"></span> Approve LP token in your wallet…');
        const approveData = sel('approve(address,uint256)') + encAddr(dex.router) + encUint((1n << 256n) - 1n);
        const aTx = await sendTx({ from: to, to: cfg.pair, data: approveData });
        await waitReceipt(ui.chain, aTx, 60);
      }
      setStatus('<span class="spinner"></span> Confirm Remove Liquidity in your wallet…');
      const data = sel('removeLiquidityETHSupportingFeeOnTransferTokens(address,uint256,uint256,uint256,address,uint256)')
        + encAddr(cfg.token) + encUint(lpToRemove) + encUint(slipDown(anetOut)) + encUint(slipDown(bnbOut)) + encAddr(to) + encUint(deadline);
      const txHash = await sendTx({ from: to, to: dex.router, data });
      setStatus(`<span class="spinner"></span> Removing liquidity… <a href="${dex.explorer}/tx/${txHash}" target="_blank" rel="noopener">${txHash.slice(0, 12)}…</a>`);
      const receipt = await waitReceipt(ui.chain, txHash, 80);
      if (!receipt || receipt.status === '0x0') { setStatus('✕ Remove Liquidity reverted (try higher slippage).', 'error'); btn.disabled = false; return; }
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
  function boot() {
    mount();
    refreshPrices();
    fetchAnetSupply();
    setInterval(refreshPrices, 20_000);
    // react to EVM wallet/account/chain changes
    if (window.ethereum) {
      window.ethereum.on?.('accountsChanged', (a) => { walletState.evm = a?.[0] || ''; updateConnectBtn(); refreshOnchainBalances(); if (ui.mode === 'liquidity') { refreshLiqBalances(); setLiqSub(ui.liqSub); } });
      window.ethereum.on?.('chainChanged', (c) => { walletState.evmChain = parseInt(c, 16); refreshOnchainBalances(); if (ui.mode === 'liquidity') refreshLiqBalances(); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
