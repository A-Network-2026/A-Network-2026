/**
 * A Network Trading Terminal
 * dex-terminal.js  |  2026
 *
 * Exchange-style terminal (markets list · candlestick chart · on-chain trade
 * tape · liquidity depth · order ticket) for the on-chain markets. Pure UI and
 * market data; it never touches wallets or funds. The order ticket is mounted
 * into `#oc-ticket-slot` by dex-onchain.js, which owns every signature.
 *
 *  • ANET markets:  real PancakeSwap V2 `Swap` events (trade tape + candles),
 *                    live DexScreener ticks, pool reserves for exact AMM depth.
 *  • Majors:        Binance public klines/trades as reference market data,
 *                    CoinGecko fallback; depth measured with real router quotes.
 *
 * Loaded BEFORE dex-onchain.js. dex-onchain.js registers a data provider
 * (RPC helpers, prices, quotes) via window.AnetTerminal.registerProvider().
 * CSP: script-src 'self' (no CDNs, no eval, no inline handlers).
 */
'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

  /* ═══════════════════════════════════════════════════════════════════
     Markets
     ═══════════════════════════════════════════════════════════════════ */
  const ANET_BSC_ADDR = '0x791055A7d52AA392eaE8De04250497f33807E46A';
  const ANET_WBNB_PAIR = '0xB90071e377A31A6EA2cFDeBE19a4d5226c420b6B';
  const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
  const PANCAKE_FEE_BPS = 25n; // 0.25% pool fee → 9975/10000

  const MARKETS = [
    { id: '56:ANET/BNB',     chain: 56, base: 'ANET', quote: 'BNB',  featured: true, pool: 'anet-wbnb' },
    { id: '56:ANET/USDT',    chain: 56, base: 'ANET', quote: 'USDT', pool: 'anet-wbnb' },
    { id: '56:ANET/USDC',    chain: 56, base: 'ANET', quote: 'USDC', pool: 'anet-wbnb' },
    { id: '56:ANET/BTCB',    chain: 56, base: 'ANET', quote: 'BTCB', pool: 'anet-wbnb' },
    { id: '56:BNB/USDT',     chain: 56, base: 'BNB',  quote: 'USDT', klines: 'BNBUSDT', cg: 'binancecoin' },
    { id: '56:BTCB/USDT',    chain: 56, base: 'BTCB', quote: 'USDT', klines: 'BTCUSDT', cg: 'bitcoin' },
    { id: '1:ETH/USDT',      chain: 1,  base: 'ETH',  quote: 'USDT', klines: 'ETHUSDT', cg: 'ethereum' },
    { id: '1:ETH/USDC',      chain: 1,  base: 'ETH',  quote: 'USDC', klines: 'ETHUSDT', cg: 'ethereum' },
    { id: '1:WBTC/USDC',     chain: 1,  base: 'WBTC', quote: 'USDC', klines: 'BTCUSDT', cg: 'bitcoin' },
    { id: 'solana:SOL/USDC', chain: 'solana', base: 'SOL', quote: 'USDC', klines: 'SOLUSDT', cg: 'solana' },
    { id: 'solana:SOL/USDT', chain: 'solana', base: 'SOL', quote: 'USDT', klines: 'SOLUSDT', cg: 'solana' },
  ];
  const CHAIN_LABEL = { 56: 'BNB Chain', 1: 'Ethereum', solana: 'Solana' };

  /* Official logos, self-hosted (see assets/img/tokens, assets/img/chains). */
  const TOKEN_LOGOS = { ANET: 'anet', WANET: 'anet', BNB: 'bnb', WBNB: 'bnb', ETH: 'eth', WETH: 'eth', SOL: 'sol', USDT: 'usdt', USDC: 'usdc', BTCB: 'btcb', WBTC: 'wbtc' };
  const CHAIN_LOGOS = { 56: 'bnb', 1: 'eth', solana: 'sol' };
  const tokenLogo = (sym) => { const k = TOKEN_LOGOS[String(sym || '').toUpperCase()]; return k ? `assets/img/tokens/${k}.png` : null; };
  const chainLogo = (chain) => { const k = CHAIN_LOGOS[chain]; return k ? `assets/img/chains/${k}.png` : null; };
  /** Round token logo (with optional network badge); falls back to initials. */
  function logoHtml(sym, { size = 20, chain = null, cls = '' } = {}) {
    const src = tokenLogo(sym);
    const badgeSrc = chain != null ? chainLogo(chain) : null;
    const badge = badgeSrc ? `<img class="tm-chain-badge" src="${badgeSrc}" alt="${esc(CHAIN_LABEL[chain] || '')}" width="${Math.round(size * 0.5)}" height="${Math.round(size * 0.5)}">` : '';
    const style = `width:${size}px;height:${size}px;font-size:${Math.max(8, Math.round(size * 0.42))}px`;
    if (!src) return `<span class="tm-logo tm-logo-fallback ${cls}" style="${style}">${esc(String(sym || '?').slice(0, 2))}${badge}</span>`;
    return `<span class="tm-logo ${cls}" style="${style}"><img src="${src}" alt="${esc(sym)} logo" width="${size}" height="${size}" decoding="sync">${badge}</span>`;
  }

  const TIMEFRAMES = [
    { id: '1m',  ms: 60_000,         binance: '1m',  limit: 240 },
    { id: '5m',  ms: 300_000,        binance: '5m',  limit: 240 },
    { id: '15m', ms: 900_000,        binance: '15m', limit: 240 },
    { id: '1h',  ms: 3_600_000,      binance: '1h',  limit: 240 },
    { id: '4h',  ms: 14_400_000,     binance: '4h',  limit: 240 },
    { id: '1d',  ms: 86_400_000,     binance: '1d',  limit: 180 },
  ];

  const LS_TICKS = 'anet:terminal:ticks:v1';
  const LS_SWAPS = 'anet:terminal:swaps:v1';
  const LS_TF = 'anet:terminal:tf:v1';

  /* ═══════════════════════════════════════════════════════════════════
     Pure helpers (exposed for unit tests)
     ═══════════════════════════════════════════════════════════════════ */
  function fmtNum(n, dp = 4) {
    if (n == null || !isFinite(n)) return '—';
    n = Number(n);
    if (n === 0) return '0';
    if (Math.abs(n) < 0.0001) return n.toExponential(2);
    return n.toLocaleString('en-US', { maximumFractionDigits: dp });
  }
  function fmtUsd(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    if (dp == null) dp = Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 1 ? 2 : Math.abs(n) >= 0.01 ? 4 : 8;
    return '$' + fmtNum(n, dp);
  }
  function fmtPrice(n) {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a > 0 && a < 0.0001) return n.toFixed(10).replace(/0+$/, '');
    const dp = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 10;
    return fmtNum(n, dp);
  }
  function fmtCompactUsd(n) {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return fmtUsd(n);
  }
  function timeHHMMSS(t) {
    const d = new Date(t);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':');
  }
  function bucketStart(t, tfMs) { return Math.floor(t / tfMs) * tfMs; }

  /**
   * Build OHLC candles from irregular points [{t, p, v?}] (sorted or not).
   * Gaps between the first point and `now` are forward-filled with flat
   * candles so illiquid markets still render a continuous chart.
   */
  function buildCandles(points, tfMs, opts = {}) {
    const now = opts.now ?? Date.now();
    const maxCandles = opts.maxCandles ?? 240;
    const pts = (points || []).filter(p => p && isFinite(p.t) && isFinite(p.p) && p.p > 0).sort((a, b) => a.t - b.t);
    if (!pts.length) return [];
    const byBucket = new Map();
    for (const p of pts) {
      const b = bucketStart(p.t, tfMs);
      let c = byBucket.get(b);
      if (!c) { c = { t: b, o: p.p, h: p.p, l: p.p, c: p.p, v: 0, n: 0 }; byBucket.set(b, c); }
      c.h = Math.max(c.h, p.p); c.l = Math.min(c.l, p.p); c.c = p.p;
      c.v += Number(p.v) || 0; c.n += 1;
    }
    const lastBucket = Math.max(bucketStart(now, tfMs), bucketStart(pts[pts.length - 1].t, tfMs));
    const firstBucket = Math.max(bucketStart(pts[0].t, tfMs), lastBucket - (maxCandles - 1) * tfMs);
    const out = [];
    let prevClose = null;
    // seed prevClose from the last point before firstBucket (if truncated)
    for (const p of pts) { if (p.t < firstBucket) prevClose = p.p; else break; }
    for (let b = firstBucket; b <= lastBucket; b += tfMs) {
      const c = byBucket.get(b);
      if (c) { out.push(c); prevClose = c.c; }
      else if (prevClose != null) out.push({ t: b, o: prevClose, h: prevClose, l: prevClose, c: prevClose, v: 0, n: 0, filled: true });
    }
    return out;
  }

  /** Merge Binance klines [[openTime, o,h,l,c,v, ...], ...] into candle objects. */
  function klinesToCandles(klines) {
    return (klines || []).map(k => ({
      t: Number(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], n: Number(k[8]) || 0,
    })).filter(c => isFinite(c.o) && isFinite(c.c));
  }

  /** Constant-product output with a pool fee (PancakeSwap V2: 25 bps). */
  function cpmmOut(amountIn, reserveIn, reserveOut, feeBps = PANCAKE_FEE_BPS) {
    amountIn = BigInt(amountIn); reserveIn = BigInt(reserveIn); reserveOut = BigInt(reserveOut);
    if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
    const inWithFee = amountIn * (10_000n - BigInt(feeBps));
    return (inWithFee * reserveOut) / (reserveIn * 10_000n + inWithFee);
  }

  /**
   * Decode a UniswapV2 `Swap(sender, amount0In, amount1In, amount0Out, amount1Out, to)` log.
   * Returns amounts as BigInt plus the side relative to `baseIsToken0`.
   */
  function decodeSwapLog(log, baseIsToken0) {
    const d = String(log.data || '').replace(/^0x/, '');
    if (d.length < 256) return null;
    const w = (i) => BigInt('0x' + d.slice(i * 64, (i + 1) * 64));
    const a0In = w(0), a1In = w(1), a0Out = w(2), a1Out = w(3);
    const baseIn  = baseIsToken0 ? a0In  : a1In;
    const baseOut = baseIsToken0 ? a0Out : a1Out;
    const quoteIn  = baseIsToken0 ? a1In  : a0In;
    const quoteOut = baseIsToken0 ? a1Out : a0Out;
    const side = baseOut > 0n ? 'buy' : 'sell';           // buy = base leaves the pool
    const baseAmt  = side === 'buy' ? baseOut : baseIn;
    const quoteAmt = side === 'buy' ? quoteIn : quoteOut;
    if (baseAmt === 0n) return null;
    return {
      side, baseAmt, quoteAmt,
      sender: log.topics && log.topics[1] ? '0x' + log.topics[1].slice(26) : null,
      to:     log.topics && log.topics[2] ? '0x' + log.topics[2].slice(26) : null,
      tx: log.transactionHash, block: parseInt(log.blockNumber, 16), logIndex: parseInt(log.logIndex, 16),
    };
  }

  /** Linear interpolation of a USD price series [{t, p}] at time t. */
  function interpolate(series, t) {
    if (!series || !series.length) return null;
    if (t <= series[0].t) return series[0].p;
    if (t >= series[series.length - 1].t) return series[series.length - 1].p;
    let lo = 0, hi = series.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (series[mid].t <= t) lo = mid; else hi = mid; }
    const a = series[lo], b = series[hi];
    const f = (t - a.t) / Math.max(1, b.t - a.t);
    return a.p + (b.p - a.p) * f;
  }

  /** Human amount → bigint units (string-safe). */
  function toUnits(amountStr, decimals) {
    const s = String(amountStr).trim();
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return 0n;
    const [whole, frac = ''] = s.split('.');
    return BigInt(whole || '0') * (10n ** BigInt(decimals)) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
  }
  function fromUnits(v, decimals) {
    v = BigInt(v); const base = 10n ** BigInt(decimals);
    const whole = v / base;
    const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
  }
  const unitsToNumber = (v, d) => parseFloat(fromUnits(v, d));

  /* ═══════════════════════════════════════════════════════════════════
     State
     ═══════════════════════════════════════════════════════════════════ */
  let provider = null;                 // registered by dex-onchain.js
  const listeners = [];
  const st = {
    market: MARKETS[0],
    tf: (() => { try { return localStorage.getItem(LS_TF) || '15m'; } catch (_) { return '15m'; } })(),
    anetTicks: [],                     // [{t, p}] USD
    anetSwaps: [],                     // decoded swaps with USD price
    anetSwapsLastBlock: 0,
    anetReserves: null,                // { anet, bnb, token0IsAnet, t }
    bnbUsdSeries: [],                  // [{t,p}] for historical USD conversion
    majorCandles: {},                  // key `${klines}:${tf}` → { candles, t }
    majorTrades: {},                   // key klines → { trades, t }
    depth: {},                         // key marketId → { rows, t }
    hover: null,
    tapeFilter: 'all',
    mounted: false,
    fetchingSwaps: false,
    chart: null,
  };

  function loadPersisted() {
    try {
      const ticks = JSON.parse(localStorage.getItem(LS_TICKS) || '[]');
      if (Array.isArray(ticks)) st.anetTicks = ticks.filter(p => p && isFinite(p.t) && isFinite(p.p));
    } catch (_) {}
    try {
      const sw = JSON.parse(localStorage.getItem(LS_SWAPS) || 'null');
      if (sw && Array.isArray(sw.swaps)) {
        st.anetSwaps = sw.swaps.filter(s => s && s.tx && isFinite(s.t));
        st.anetSwapsLastBlock = Number(sw.lastBlock) || 0;
      }
    } catch (_) {}
  }
  function persistTicks() {
    try { localStorage.setItem(LS_TICKS, JSON.stringify(st.anetTicks.slice(-6000))); } catch (_) {}
  }
  function persistSwaps() {
    try { localStorage.setItem(LS_SWAPS, JSON.stringify({ swaps: st.anetSwaps.slice(-2500), lastBlock: st.anetSwapsLastBlock })); } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════════════════════
     Layout
     ═══════════════════════════════════════════════════════════════════ */
  function mount(host) {
    if (!host) return null;
    host.innerHTML = `
      <div class="terminal" id="terminal">
        <div class="terminal-header card" id="tm-header">
          <div class="tm-pair-block">
            <button class="tm-pair-btn" id="tm-pair-btn" aria-haspopup="listbox" aria-expanded="false" title="Change market">
              <span class="tm-pair-logo" id="tm-pair-logo"></span>
              <span class="tm-pair-name" id="tm-pair-name">ANET / BNB</span>
              <span class="tm-pair-chain" id="tm-pair-chain">BNB Chain</span>
              <span class="tm-caret">▾</span>
            </button>
            <div class="tm-price-block">
              <div class="tm-price" id="tm-price">—</div>
              <div class="tm-price-sub" id="tm-price-sub">—</div>
            </div>
          </div>
          <div class="tm-stats" id="tm-stats"></div>
        </div>

        <aside class="terminal-markets card" id="tm-markets">
          <div class="tm-panel-head">
            <span>MARKETS</span>
            <input class="tm-search" id="tm-market-search" type="search" placeholder="Search" aria-label="Search markets">
          </div>
          <div class="tm-markets-list" id="tm-markets-list" role="listbox" aria-label="Markets"></div>
        </aside>

        <section class="terminal-center">
          <div class="card tm-chart-card">
            <div class="tm-panel-head">
              <div class="tm-tf-row" id="tm-tf-row" role="tablist" aria-label="Chart timeframe"></div>
              <div class="tm-chart-meta" id="tm-chart-meta"></div>
            </div>
            <div class="tm-chart-wrap" id="tm-chart-wrap">
              <canvas id="tm-chart" aria-label="Price chart" role="img"></canvas>
              <div class="tm-legend" id="tm-legend"></div>
              <div class="tm-chart-tooltip is-hidden" id="tm-chart-tooltip"></div>
              <div class="tm-chart-empty" id="tm-chart-empty">Loading chart…</div>
            </div>
            <div class="tm-chart-credit">Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts™</a></div>
          </div>
          <div class="tm-lower">
            <div class="card tm-tape-card">
              <div class="tm-panel-head">
                <span id="tm-tape-title">RECENT TRADES · ON-CHAIN</span>
                <div class="tm-tape-filters" id="tm-tape-filters">
                  <button class="tm-chip active" data-f="all">All</button>
                  <button class="tm-chip" data-f="buy">Buys</button>
                  <button class="tm-chip" data-f="sell">Sells</button>
                </div>
              </div>
              <div class="tm-tape-head"><span>Time</span><span>Side</span><span>Price</span><span>Amount</span><span>Value</span><span>Tx</span></div>
              <div class="tm-tape" id="tm-tape"><div class="tm-empty">Loading trades…</div></div>
            </div>
            <div class="card tm-depth-card">
              <div class="tm-panel-head"><span id="tm-depth-title">LIQUIDITY DEPTH</span><span class="tm-muted" id="tm-depth-note"></span></div>
              <div id="tm-depth"><div class="tm-empty">Measuring depth…</div></div>
            </div>
          </div>
        </section>

        <aside class="terminal-ticket" id="tm-ticket">
          <div id="oc-ticket-slot"></div>
        </aside>

        <section class="terminal-bottom card" id="tm-bottom">
          <div id="oc-bottom-slot"></div>
        </section>
      </div>`;

    // timeframes
    const tfRow = $('tm-tf-row');
    tfRow.innerHTML = TIMEFRAMES.map(tf =>
      `<button class="tm-chip${tf.id === st.tf ? ' active' : ''}" role="tab" data-tf="${tf.id}" aria-selected="${tf.id === st.tf}">${tf.id}</button>`).join('');
    tfRow.querySelectorAll('.tm-chip').forEach(b => b.addEventListener('click', () => setTimeframe(b.dataset.tf)));
    $('tm-tape-filters').querySelectorAll('.tm-chip').forEach(b => b.addEventListener('click', () => {
      st.tapeFilter = b.dataset.f;
      $('tm-tape-filters').querySelectorAll('.tm-chip').forEach(x => x.classList.toggle('active', x === b));
      renderTape();
    }));
    $('tm-market-search').addEventListener('input', renderMarketsList);
    $('tm-pair-btn').addEventListener('click', () => {
      const m = $('tm-markets');
      const open = m.classList.toggle('open');
      $('tm-pair-btn').setAttribute('aria-expanded', String(open));
      if (open) setTimeout(() => $('tm-market-search')?.focus(), 0);
    });
    document.addEventListener('click', (e) => {
      const m = $('tm-markets'); if (!m || !m.classList.contains('open')) return;
      if (!m.contains(e.target) && !$('tm-pair-btn').contains(e.target)) { m.classList.remove('open'); $('tm-pair-btn').setAttribute('aria-expanded', 'false'); }
    });

    initChart();
    st.mounted = true;
    renderMarketsList();
    renderHeader();
    return { ticketSlot: $('oc-ticket-slot'), bottomSlot: $('oc-bottom-slot') };
  }

  /* ═══════════════════════════════════════════════════════════════════
     Market selection
     ═══════════════════════════════════════════════════════════════════ */
  function marketPriceUsd(m) {
    if (!provider) return null;
    if (m.base === 'ANET') return provider.getUsd('ANET');
    return provider.getUsd(m.base);
  }
  function marketQuoteUsd(m) { return provider ? provider.getUsd(m.quote) : null; }
  function marketChange24h(m) {
    if (!provider) return null;
    if (m.base === 'ANET') { const a = provider.getAnet(); return a ? Number(a.change24h) : null; }
    return provider.getChange24h ? provider.getChange24h(m.base) : null;
  }

  function selectMarket(id, opts = {}) {
    const m = MARKETS.find(x => x.id === id);
    if (!m) return;
    const changed = st.market.id !== m.id;
    st.market = m;
    st.hover = null;
    $('tm-markets')?.classList.remove('open');
    renderMarketsList(); renderHeader(); renderTape(); renderDepth(); drawChart();
    if (changed || opts.force) {
      refreshMarketData(true);
      if (!opts.silent) listeners.forEach(cb => { try { cb(m); } catch (_) {} });
    }
  }

  /** Called by the order ticket when the user picks chain/pair manually. */
  function matchMarket(chain, fromSym, toSym) {
    const cands = MARKETS.filter(m => String(m.chain) === String(chain));
    const direct = cands.find(m => (m.base === toSym && m.quote === fromSym) || (m.base === fromSym && m.quote === toSym));
    if (direct) return direct;
    // same chain, keep an ANET market if either side is ANET
    return cands.find(m => m.base === toSym || m.base === fromSym) || cands[0] || null;
  }

  function setTimeframe(tf) {
    if (!TIMEFRAMES.some(t => t.id === tf)) return;
    st.tf = tf;
    try { localStorage.setItem(LS_TF, tf); } catch (_) {}
    $('tm-tf-row')?.querySelectorAll('.tm-chip').forEach(b => { const on = b.dataset.tf === tf; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    st.hover = null;
    drawChart();
    if (!isAnetMarket(st.market)) fetchMajorCandles(st.market);
  }

  const isAnetMarket = (m) => m && m.base === 'ANET';

  /* ═══════════════════════════════════════════════════════════════════
     Rendering: markets list + header
     ═══════════════════════════════════════════════════════════════════ */
  function renderMarketsList() {
    const el = $('tm-markets-list'); if (!el) return;
    const q = ($('tm-market-search')?.value || '').trim().toUpperCase();
    const rows = MARKETS.filter(m => !q || `${m.base}/${m.quote} ${CHAIN_LABEL[m.chain]}`.toUpperCase().includes(q));
    el.innerHTML = rows.map(m => {
      const px = marketPriceUsd(m), ch = marketChange24h(m);
      const chCls = ch == null ? 'neutral' : ch > 0 ? 'up' : ch < 0 ? 'down' : 'neutral';
      return `<button class="tm-market-row${m.id === st.market.id ? ' active' : ''}" role="option" aria-selected="${m.id === st.market.id}" data-id="${esc(m.id)}">
        <span class="tm-mr-pair">${logoHtml(m.base, { size: 18, chain: m.chain })}<span class="tm-mr-sym">${esc(m.base)}<small>/${esc(m.quote)}</small>${m.featured ? '<em class="tm-star" title="Native token">★</em>' : ''}</span></span>
        <span class="tm-mr-price">${px != null ? fmtUsd(px) : '—'}</span>
        <span class="tm-mr-change ${chCls}">${ch == null ? '—' : (ch > 0 ? '+' : '') + ch.toFixed(2) + '%'}</span>
      </button>`;
    }).join('') || '<div class="tm-empty">No markets match.</div>';
    el.querySelectorAll('.tm-market-row').forEach(b => b.addEventListener('click', () => selectMarket(b.dataset.id)));
  }

  function candlesForCurrent() {
    const tf = TIMEFRAMES.find(t => t.id === st.tf) || TIMEFRAMES[2];
    if (isAnetMarket(st.market)) {
      const pts = [];
      for (const s of st.anetSwaps) if (s.usd > 0) pts.push({ t: s.t, p: s.usd, v: s.usdValue || 0 });
      for (const p of st.anetTicks) pts.push({ t: p.t, p: p.p });
      return buildCandles(pts, tf.ms, { maxCandles: tf.limit });
    }
    const key = `${st.market.klines}:${st.tf}`;
    return (st.majorCandles[key]?.candles) || [];
  }

  function renderHeader() {
    const m = st.market; if (!$('tm-pair-name')) return;
    $('tm-pair-name').textContent = `${m.base} / ${m.quote}`;
    $('tm-pair-chain').textContent = CHAIN_LABEL[m.chain];
    const logoEl = $('tm-pair-logo');
    if (logoEl) logoEl.innerHTML = logoHtml(m.base, { size: 26, chain: m.chain }) + logoHtml(m.quote, { size: 26, cls: 'tm-logo-quote' });
    const px = marketPriceUsd(m), qUsd = marketQuoteUsd(m);
    const priceEl = $('tm-price');
    priceEl.textContent = px != null ? fmtUsd(px) : '—';
    const ch = marketChange24h(m);
    priceEl.className = 'tm-price ' + (ch == null ? '' : ch > 0 ? 'up' : ch < 0 ? 'down' : '');
    const inQuote = (px != null && qUsd) ? px / qUsd : null;
    $('tm-price-sub').innerHTML = `${inQuote != null ? `1 ${esc(m.base)} = <b>${fmtPrice(inQuote)} ${esc(m.quote)}</b>` : ''}` +
      `${ch != null ? ` <span class="tm-chg ${ch > 0 ? 'up' : ch < 0 ? 'down' : ''}">${ch > 0 ? '▲' : ch < 0 ? '▼' : ''} ${Math.abs(ch).toFixed(2)}% 24h</span>` : ''}`;

    const candles = candlesForCurrent();
    const dayAgo = Date.now() - 86_400_000;
    let hi = null, lo = null;
    for (const c of candles) { if (c.t + 1 < dayAgo - 3_600_000) continue; hi = hi == null ? c.h : Math.max(hi, c.h); lo = lo == null ? c.l : Math.min(lo, c.l); }
    const stats = [];
    stats.push(['24h High', hi != null ? fmtUsd(hi) : '—'], ['24h Low', lo != null ? fmtUsd(lo) : '—']);
    if (isAnetMarket(m)) {
      const a = provider?.getAnet();
      stats.push(['24h Volume', a ? fmtCompactUsd(a.volume24h) : '—']);
      stats.push(['Pool Liquidity', a ? fmtCompactUsd(a.liquidityUsd) : '—']);
      stats.push(['Market Cap', a ? fmtCompactUsd(a.marketCap) : '—']);
      stats.push(['24h Trades', String(st.anetSwaps.filter(s => s.t >= dayAgo).length)]);
    } else {
      const vol = provider?.getVolume24h ? provider.getVolume24h(m.base) : null;
      stats.push(['24h Volume', vol != null ? fmtCompactUsd(vol) : '—']);
      stats.push(['Venue', m.chain === 'solana' ? 'Jupiter' : m.chain === 1 ? 'Uniswap V2' : 'PancakeSwap V2']);
    }
    const fee = provider?.feeInfo ? provider.feeInfo(m.chain) : null;
    if (fee) stats.push(['Interface Fee', fee.label]);
    stats.push(['Custody', 'Self-custody']);
    $('tm-stats').innerHTML = stats.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    $('tm-chart-meta').textContent = isAnetMarket(m)
      ? 'On-chain swaps + live ticks · USD'
      : 'Reference market data (Binance) · USD';
  }

  /* ═══════════════════════════════════════════════════════════════════
     Trade tape
     ═══════════════════════════════════════════════════════════════════ */
  function renderTape() {
    const el = $('tm-tape'); if (!el) return;
    const m = st.market;
    let rows;
    if (isAnetMarket(m)) {
      $('tm-tape-title').textContent = 'RECENT TRADES · ON-CHAIN (ANET/WBNB POOL)';
      rows = st.anetSwaps.slice().sort((a, b) => b.t - a.t).map(s => ({
        t: s.t, side: s.side, price: s.usd, amount: s.anet, value: s.usdValue, link: `https://bscscan.com/tx/${s.tx}`, label: 'BscScan',
      }));
    } else {
      $('tm-tape-title').textContent = `RECENT TRADES · REFERENCE MARKET (${m.klines})`;
      const tr = st.majorTrades[m.klines]?.trades || [];
      rows = tr.map(t => ({ t: t.time, side: t.isBuyerMaker ? 'sell' : 'buy', price: +t.price, amount: +t.qty, value: +t.price * +t.qty, link: null }));
    }
    if (st.tapeFilter !== 'all') rows = rows.filter(r => r.side === st.tapeFilter);
    rows = rows.slice(0, 60);
    if (!rows.length) { el.innerHTML = `<div class="tm-empty">${isAnetMarket(m) ? 'No on-chain swaps found yet in the scanned window.' : 'No reference trades loaded.'}</div>`; return; }
    el.innerHTML = rows.map(r => `
      <div class="tm-tape-row ${r.side}">
        <span class="tm-mono">${timeHHMMSS(r.t)}</span>
        <span class="tm-side">${r.side === 'buy' ? 'BUY' : 'SELL'}</span>
        <span class="tm-mono">${fmtUsd(r.price)}</span>
        <span class="tm-mono">${fmtNum(r.amount, r.amount >= 1000 ? 0 : 4)} ${esc(m.base)}</span>
        <span class="tm-mono">${fmtUsd(r.value, 2)}</span>
        <span>${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">${esc(r.label)} ↗</a>` : '<span class="tm-muted">CEX</span>'}</span>
      </div>`).join('');
  }

  /* ═══════════════════════════════════════════════════════════════════
     Depth
     ═══════════════════════════════════════════════════════════════════ */
  const DEPTH_USD_ANET = [50, 250, 1000, 5000];
  const DEPTH_USD_MAJOR = [1000, 10000, 50000, 250000];

  function renderDepth() {
    const el = $('tm-depth'); if (!el) return;
    const m = st.market;
    const d = st.depth[m.id];
    $('tm-depth-title').textContent = isAnetMarket(m) ? 'LIQUIDITY DEPTH · ANET/WBNB POOL' : 'LIQUIDITY DEPTH · ROUTER QUOTES';
    if (!d || !d.rows?.length) { el.innerHTML = '<div class="tm-empty">Measuring depth…</div>'; return; }
    $('tm-depth-note').textContent = d.note || '';
    const row = (r) => `<div class="tm-depth-row ${r.side}">
        <span class="tm-side">${r.side === 'buy' ? 'BUY' : 'SELL'}</span>
        <span class="tm-mono">${fmtCompactUsd(r.usd)}</span>
        <span class="tm-mono">${r.impact == null ? '—' : (r.impact * 100).toFixed(2) + '%'}</span>
        <span class="tm-mono">${r.avgPrice != null ? fmtUsd(r.avgPrice) : '—'}</span>
        <span class="tm-depth-bar"><i style="width:${Math.min(100, Math.max(2, (r.impact || 0) * 400)).toFixed(0)}%"></i></span>
      </div>`;
    el.innerHTML = `<div class="tm-depth-head"><span>Side</span><span>Size</span><span>Impact</span><span>Avg price</span><span></span></div>` +
      d.rows.map(row).join('');
  }

  const depthInFlight = new Set();
  async function refreshDepth(m) {
    if (!provider || depthInFlight.has(m.id)) return;
    depthInFlight.add(m.id);
    try { await measureDepth(m); } finally { depthInFlight.delete(m.id); }
  }
  async function measureDepth(m) {
    const spot = marketPriceUsd(m), qUsd = marketQuoteUsd(m);
    if (!spot || !qUsd) return;
    const rows = [];
    const sizes = isAnetMarket(m) ? DEPTH_USD_ANET : DEPTH_USD_MAJOR;
    let note = '';
    try {
      if (isAnetMarket(m) && m.chain === 56) {
        const r = await getAnetReserves();
        if (!r) return;
        const bnbUsd = provider.getUsd('BNB');
        if (!bnbUsd) return;
        note = `Exact constant-product math · pool reserves ${fmtNum(unitsToNumber(r.anet, 18), 0)} ANET / ${fmtNum(unitsToNumber(r.bnb, 18), 2)} BNB`;
        for (const usd of sizes) {
          // buy: spend `usd` worth of BNB → ANET
          const bnbIn = toUnits((usd / bnbUsd).toFixed(18), 18);
          const anetOut = cpmmOut(bnbIn, r.bnb, r.anet);
          const avgBuy = anetOut > 0n ? usd / unitsToNumber(anetOut, 18) : null;
          rows.push({ side: 'buy', usd, avgPrice: avgBuy, impact: avgBuy ? Math.max(0, avgBuy / spot - 1) : null });
        }
        for (const usd of sizes) {
          const anetIn = toUnits((usd / spot).toFixed(18), 18);
          const bnbOut = cpmmOut(anetIn, r.anet, r.bnb);
          const avgSell = bnbOut > 0n ? unitsToNumber(bnbOut, 18) * bnbUsd / (usd / spot) : null;
          rows.push({ side: 'sell', usd, avgPrice: avgSell, impact: avgSell ? Math.max(0, 1 - avgSell / spot) : null });
        }
      } else if (provider.quoteOut) {
        note = m.chain === 'solana' ? 'Measured with live Jupiter quotes' : 'Measured with live router quotes';
        const sizesUsed = m.chain === 'solana' ? [sizes[0], sizes[2]] : sizes;
        const jobs = [];
        for (const usd of sizesUsed) jobs.push({ side: 'buy', usd, run: () => provider.quoteOut(m.chain, m.quote, m.base, usd / qUsd) });
        for (const usd of sizesUsed) jobs.push({ side: 'sell', usd, run: () => provider.quoteOut(m.chain, m.base, m.quote, usd / spot) });
        let res;
        if (m.chain === 'solana') {
          // Jupiter's public endpoint allows ~1 req/s: defer so the user's own quote
          // goes first, then probe sequentially with a full-second gap.
          await new Promise(r => setTimeout(r, 2500));
          res = [];
          for (const j of jobs) {
            res.push({ side: j.side, usd: j.usd, out: await j.run().catch(() => null) });
            await new Promise(r => setTimeout(r, 1200));
          }
        } else {
          res = await Promise.all(jobs.map(j => j.run().then(out => ({ side: j.side, usd: j.usd, out })).catch(() => ({ side: j.side, usd: j.usd, out: null }))));
        }
        for (const r of res) {
          if (r.side === 'buy') {
            const avg = r.out ? r.usd / r.out : null;
            rows.push({ side: 'buy', usd: r.usd, avgPrice: avg, impact: avg ? Math.max(0, avg / spot - 1) : null });
          } else {
            const avg = r.out ? (r.out * qUsd) / (r.usd / spot) : null;
            rows.push({ side: 'sell', usd: r.usd, avgPrice: avg, impact: avg ? Math.max(0, 1 - avg / spot) : null });
          }
        }
      }
    } catch (_) { /* keep previous */ }
    if (rows.length) { st.depth[m.id] = { rows, note, t: Date.now() }; if (st.market.id === m.id) renderDepth(); }
  }

  /* ═══════════════════════════════════════════════════════════════════
     Data: ANET on-chain swaps, reserves, ticks
     ═══════════════════════════════════════════════════════════════════ */
  const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
  const BLOCKS_PER_DAY_BSC = 192_000;   // ~0.45 s blocks (measured)
  const HISTORY_DAYS = 7;

  async function getAnetReserves(force = false) {
    if (!provider) return null;
    if (!force && st.anetReserves && Date.now() - st.anetReserves.t < 30_000) return st.anetReserves;
    try {
      const [resHex, t0Hex] = await Promise.all([
        provider.evmCall(56, ANET_WBNB_PAIR, '0x0902f1ac'),
        provider.evmCall(56, ANET_WBNB_PAIR, '0x0dfe1681'),
      ]);
      const body = resHex.replace(/^0x/, '');
      const r0 = BigInt('0x' + body.slice(0, 64)), r1 = BigInt('0x' + body.slice(64, 128));
      const token0IsAnet = ('0x' + t0Hex.replace(/^0x/, '').slice(24)).toLowerCase() === ANET_BSC_ADDR.toLowerCase();
      st.anetReserves = { anet: token0IsAnet ? r0 : r1, bnb: token0IsAnet ? r1 : r0, token0IsAnet, t: Date.now() };
      return st.anetReserves;
    } catch (_) { return st.anetReserves; }
  }

  async function fetchLogsChunked(fromBlock, toBlock, depth = 0) {
    const params = [{ address: ANET_WBNB_PAIR, topics: [SWAP_TOPIC], fromBlock: '0x' + fromBlock.toString(16), toBlock: '0x' + toBlock.toString(16) }];
    try {
      const logs = await provider.evmRpc(56, 'eth_getLogs', params);
      return Array.isArray(logs) ? logs : [];
    } catch (e) {
      if (depth >= 4 || toBlock - fromBlock < 2000) throw e;
      const mid = Math.floor((fromBlock + toBlock) / 2);
      const [a, b] = await Promise.all([fetchLogsChunked(fromBlock, mid, depth + 1), fetchLogsChunked(mid + 1, toBlock, depth + 1)]);
      return a.concat(b);
    }
  }

  async function blockTimestamps(blocks) {
    const out = new Map();
    const uniq = [...new Set(blocks)];
    for (let i = 0; i < uniq.length; i += 25) {
      const slice = uniq.slice(i, i + 25);
      const calls = slice.map(b => ({ method: 'eth_getBlockByNumber', params: ['0x' + b.toString(16), false] }));
      let results = null;
      try { results = await provider.rpcBatch(56, calls); } catch (_) { results = null; }
      if (!Array.isArray(results)) {
        results = await Promise.all(calls.map(c => provider.evmRpc(56, c.method, c.params).catch(() => null)));
      }
      results.forEach((r, j) => { if (r && r.timestamp) out.set(slice[j], parseInt(r.timestamp, 16) * 1000); });
    }
    return out;
  }

  async function fetchBnbUsdHistory() {
    if (st.bnbUsdSeries.length && Date.now() - (st.bnbUsdSeries._t || 0) < 600_000) return;
    // Binance 1h klines for the last ~8 days → accurate historical BNB/USD for swap valuation.
    try {
      const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BNBUSDT&interval=1h&limit=200');
      const kl = await res.json();
      if (Array.isArray(kl) && kl.length) {
        st.bnbUsdSeries = kl.map(k => ({ t: Number(k[0]) + 1_800_000, p: +k[4] }));
        st.bnbUsdSeries._t = Date.now();
        return;
      }
    } catch (_) {}
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/coins/binancecoin/market_chart?vs_currency=usd&days=8');
      const j = await res.json();
      if (Array.isArray(j.prices)) { st.bnbUsdSeries = j.prices.map(([t, p]) => ({ t, p })); st.bnbUsdSeries._t = Date.now(); }
    } catch (_) {}
  }

  function valueSwaps(swaps, reservesInfo) {
    const nowBnb = provider?.getUsd('BNB');
    for (const s of swaps) {
      const bnbUsd = interpolate(st.bnbUsdSeries, s.t) ?? nowBnb;
      if (!bnbUsd) continue;
      s.usd = s.priceBnb * bnbUsd;
      s.usdValue = s.bnb * bnbUsd;
    }
    return swaps;
  }

  async function fetchAnetSwaps(initial) {
    if (!provider || st.fetchingSwaps) return;
    st.fetchingSwaps = true;
    try {
      const head = parseInt(await provider.evmRpc(56, 'eth_blockNumber', []), 16);
      const r = await getAnetReserves();
      const token0IsAnet = r ? r.token0IsAnet : true;
      await fetchBnbUsdHistory();

      // incremental window
      let from = st.anetSwapsLastBlock ? st.anetSwapsLastBlock + 1 : head - 2 * BLOCKS_PER_DAY_BSC;
      if (head - from > 2 * BLOCKS_PER_DAY_BSC && !initial) from = head - 2 * BLOCKS_PER_DAY_BSC;
      if (from < head) await ingestSwapLogs(from, head, token0IsAnet);
      st.anetSwapsLastBlock = head;
      persistSwaps();
      renderTape(); renderHeader(); drawChart();

      // background back-fill to HISTORY_DAYS (one chunk per call; sequential)
      const oldest = st.anetSwaps.length ? Math.min(...st.anetSwaps.map(s => s.block)) : head;
      const target = head - HISTORY_DAYS * BLOCKS_PER_DAY_BSC;
      const backfilled = Number(st._backfillTo || 0);
      if (!backfilled && oldest > target + 1000) {
        let to = Math.min(oldest - 1, head - 2 * BLOCKS_PER_DAY_BSC);
        while (to > target) {
          const f = Math.max(target, to - BLOCKS_PER_DAY_BSC);
          await ingestSwapLogs(f, to, token0IsAnet);
          to = f - 1;
        }
        st._backfillTo = target;
        persistSwaps(); renderTape(); renderHeader(); drawChart();
      }
    } catch (e) {
      /* keep what we have */
    } finally { st.fetchingSwaps = false; }
  }

  async function ingestSwapLogs(fromBlock, toBlock, token0IsAnet) {
    const logs = await fetchLogsChunked(fromBlock, toBlock);
    if (!logs.length) return;
    const decoded = logs.map(l => decodeSwapLog(l, token0IsAnet)).filter(Boolean);
    const ts = await blockTimestamps(decoded.map(d => d.block));
    const known = new Set(st.anetSwaps.map(s => `${s.tx}:${s.logIndex}`));
    const fresh = [];
    for (const d of decoded) {
      const key = `${d.tx}:${d.logIndex}`;
      if (known.has(key)) continue;
      const anet = unitsToNumber(d.baseAmt, 18), bnb = unitsToNumber(d.quoteAmt, 18);
      if (!(anet > 0) || !(bnb > 0)) continue;
      fresh.push({
        tx: d.tx, logIndex: d.logIndex, block: d.block, t: ts.get(d.block) || Date.now(),
        side: d.side, anet, bnb, priceBnb: bnb / anet, to: d.to,
      });
    }
    valueSwaps(fresh);
    st.anetSwaps = st.anetSwaps.concat(fresh).sort((a, b) => a.t - b.t).slice(-2500);
  }

  function recordTick(priceUsd) {
    if (!(priceUsd > 0)) return;
    const now = Date.now();
    const last = st.anetTicks[st.anetTicks.length - 1];
    if (last && Math.abs(last.p - priceUsd) < 1e-12 && now - last.t < 60_000) return;
    st.anetTicks.push({ t: now, p: priceUsd });
    if (st.anetTicks.length > 6000) st.anetTicks.splice(0, st.anetTicks.length - 6000);
    persistTicks();
  }

  /* ═══════════════════════════════════════════════════════════════════
     Data: majors (Binance public market data, CoinGecko fallback)
     ═══════════════════════════════════════════════════════════════════ */
  async function fetchMajorCandles(m) {
    if (!m || isAnetMarket(m)) return;
    const tf = TIMEFRAMES.find(t => t.id === st.tf) || TIMEFRAMES[2];
    const key = `${m.klines}:${tf.id}`;
    const cached = st.majorCandles[key];
    if (cached && Date.now() - cached.t < 30_000) { drawChart(); return; }
    try {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${m.klines}&interval=${tf.binance}&limit=${tf.limit}`);
      const kl = await res.json();
      if (Array.isArray(kl) && kl.length) {
        st.majorCandles[key] = { candles: klinesToCandles(kl), t: Date.now(), source: 'binance' };
        if (st.market.id === m.id) { drawChart(); renderHeader(); }
        return;
      }
      throw new Error('binance unavailable');
    } catch (_) {
      // CoinGecko fallback: market_chart points → candles
      try {
        const days = tf.ms >= 3_600_000 ? 30 : 1;
        const res = await fetch(`https://api.coingecko.com/api/v3/coins/${m.cg}/market_chart?vs_currency=usd&days=${days}`);
        const j = await res.json();
        if (Array.isArray(j.prices)) {
          st.majorCandles[key] = { candles: buildCandles(j.prices.map(([t, p]) => ({ t, p })), tf.ms, { maxCandles: tf.limit }), t: Date.now(), source: 'coingecko' };
          if (st.market.id === m.id) { drawChart(); renderHeader(); }
        }
      } catch (_) {}
    }
  }

  async function fetchMajorTrades(m) {
    if (!m || isAnetMarket(m)) return;
    const cached = st.majorTrades[m.klines];
    if (cached && Date.now() - cached.t < 15_000) return;
    try {
      const res = await fetch(`https://api.binance.com/api/v3/trades?symbol=${m.klines}&limit=40`);
      const tr = await res.json();
      if (Array.isArray(tr)) {
        st.majorTrades[m.klines] = { trades: tr.slice().reverse(), t: Date.now() };
        if (st.market.id === m.id) renderTape();
      }
    } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════════════════════
     Chart: TradingView Lightweight Charts™ (self-hosted), canvas fallback
     ═══════════════════════════════════════════════════════════════════ */
  const lwc = { chart: null, candles: null, volume: null, host: null, key: '', byTime: new Map(), minMove: null };
  const tzShift = () => -new Date().getTimezoneOffset() * 60; // LWC renders UTC; shift so labels read local time

  function themeColors() {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
    return { up: v('--success', '#137333'), down: v('--danger', '#c5221f'), line: v('--line', '#dadce0'), muted: v('--muted', '#5f6368'), text: v('--text', '#202124'), accent: v('--accent', '#1967d2') };
  }

  function initChart() {
    const wrap = $('tm-chart-wrap'); if (!wrap) return;
    const L = window.LightweightCharts;
    if (L && typeof L.createChart === 'function') { try { initLwc(wrap, L); return; } catch (e) { console.warn('[terminal] Lightweight Charts init failed, using canvas fallback', e); } }
    initCanvasChart();
  }

  function initLwc(wrap, L) {
    const c = themeColors();
    const host = document.createElement('div');
    host.className = 'tm-lwc'; host.id = 'tm-lwc';
    wrap.insertBefore(host, wrap.firstChild);
    $('tm-chart')?.remove();
    $('tm-chart-tooltip')?.remove();
    const chart = L.createChart(host, {
      autoSize: true,
      layout: { background: { type: 'solid', color: '#ffffff' }, textColor: c.muted, fontFamily: "'Roboto Mono', monospace", fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: '#f1f3f4' }, horzLines: { color: '#f1f3f4' } },
      rightPriceScale: { borderColor: c.line, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: c.line, timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 8, minBarSpacing: 2 },
      crosshair: { mode: L.CrosshairMode ? L.CrosshairMode.Normal : 0, vertLine: { labelBackgroundColor: c.accent }, horzLine: { labelBackgroundColor: c.accent } },
      localization: { priceFormatter: (p) => fmtPrice(p) },
      handleScroll: true, handleScale: true,
    });
    const candleOpts = {
      upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down,
      priceLineVisible: true, lastValueVisible: true, priceLineColor: c.accent, priceLineStyle: 2,
      priceFormat: { type: 'custom', formatter: (p) => fmtPrice(p), minMove: 0.0001 },
    };
    const volOpts = { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false, color: 'rgba(25,103,210,0.25)' };
    const candles = chart.addSeries ? chart.addSeries(L.CandlestickSeries, candleOpts) : chart.addCandlestickSeries(candleOpts);
    const volume  = chart.addSeries ? chart.addSeries(L.HistogramSeries, volOpts)  : chart.addHistogramSeries(volOpts);
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.subscribeCrosshairMove((param) => {
      const bar = param && param.time != null ? lwc.byTime.get(param.time) : null;
      renderLegend(bar || null);
    });
    Object.assign(lwc, { chart, candles, volume, host, L });
    st.chart = null; // canvas renderer disabled
  }

  function minMoveFor(price) {
    const a = Math.abs(price || 0);
    return a >= 1000 ? 0.01 : a >= 1 ? 0.0001 : a >= 0.01 ? 0.000001 : 0.00000001;
  }

  function renderLegend(bar) {
    const el = $('tm-legend'); if (!el) return;
    const candles = candlesForCurrent();
    const c = bar || candles[candles.length - 1];
    if (!c) { el.innerHTML = ''; return; }
    const up = c.c >= c.o;
    const cls = up ? 'up' : 'down';
    const chg = c.o ? ((c.c - c.o) / c.o) * 100 : 0;
    el.innerHTML = `<b>${esc(st.market.base)}/${esc(st.market.quote)}</b> · ${esc(st.tf)}` +
      ` <span>O <i class="${cls}">${fmtPrice(c.o)}</i></span><span>H <i class="${cls}">${fmtPrice(c.h)}</i></span>` +
      `<span>L <i class="${cls}">${fmtPrice(c.l)}</i></span><span>C <i class="${cls}">${fmtPrice(c.c)}</i></span>` +
      `<span><i class="${cls}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</i></span>` +
      (c.v ? `<span>Vol <i>${isAnetMarket(st.market) ? fmtCompactUsd(c.v) : fmtNum(c.v, 2)}</i></span>` : '') +
      (c.n ? `<span>Trades <i>${c.n}</i></span>` : '') +
      (c.filled ? `<span class="tm-muted">no trades · carried</span>` : '');
  }

  function drawChart() {
    if (lwc.chart) return drawLwc();
    return drawCanvasChart();
  }

  function drawLwc() {
    const candles = candlesForCurrent();
    const empty = $('tm-chart-empty');
    if (!candles.length) {
      if (empty) { empty.style.display = 'flex'; empty.textContent = provider ? 'Waiting for market data…' : 'Loading chart…'; }
      lwc.candles.setData([]); lwc.volume.setData([]); lwc.byTime.clear(); renderLegend(null);
      return;
    }
    if (empty) empty.style.display = 'none';
    const c = themeColors();
    const shift = tzShift();
    const carried = { color: '#c7d7ee', border: '#c7d7ee', wick: '#c7d7ee' };
    lwc.byTime.clear();
    const data = [], vol = [];
    for (const k of candles) {
      const time = Math.floor(k.t / 1000) + shift;
      lwc.byTime.set(time, k);
      const bar = { time, open: k.o, high: k.h, low: k.l, close: k.c };
      if (k.filled) { bar.color = carried.color; bar.borderColor = carried.border; bar.wickColor = carried.wick; }
      data.push(bar);
      if (k.v > 0) vol.push({ time, value: k.v, color: k.c >= k.o ? 'rgba(19,115,51,0.32)' : 'rgba(197,34,31,0.32)' });
    }
    const last = candles[candles.length - 1];
    const mm = minMoveFor(last.c);
    if (mm !== lwc.minMove) { lwc.minMove = mm; lwc.candles.applyOptions({ priceFormat: { type: 'custom', formatter: (p) => fmtPrice(p), minMove: mm } }); }
    lwc.candles.setData(data);
    lwc.volume.setData(vol);
    const key = `${st.market.id}:${st.tf}`;
    if (key !== lwc.key) {
      lwc.key = key;
      const n = data.length;
      lwc.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 110), to: n + 4 });
    }
    renderLegend(null);
    void c;
  }

  /* ── Canvas fallback (used only if the vendored library fails to load) ── */
  function initCanvasChart() {
    const canvas = $('tm-chart'), wrap = $('tm-chart-wrap');
    if (!canvas || !wrap) return;
    st.chart = { canvas, ctx: canvas.getContext('2d'), wrap, layout: null };
    const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => drawChart()) : null;
    if (ro) ro.observe(wrap); else window.addEventListener('resize', drawChart);
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      st.hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      drawChart();
    });
    canvas.addEventListener('mouseleave', () => { st.hover = null; drawChart(); });
  }

  function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const n = raw / pow;
    const step = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
    return step * pow;
  }

  function drawCanvasChart() {
    const ch = st.chart; if (!ch) return;
    const { canvas, ctx, wrap } = ch;
    const W = Math.max(200, wrap.clientWidth), H = Math.max(180, wrap.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const candles = candlesForCurrent();
    const empty = $('tm-chart-empty');
    if (!candles.length) {
      if (empty) { empty.style.display = 'flex'; empty.textContent = provider ? 'Waiting for market data…' : 'Loading chart…'; }
      return;
    }
    if (empty) empty.style.display = 'none';

    const padL = 8, padR = 74, padT = 14, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = candles.length;
    const slot = plotW / n;
    const bodyW = Math.max(1, Math.min(14, slot * 0.68));
    let min = Infinity, max = -Infinity;
    for (const c of candles) { if (c.l < min) min = c.l; if (c.h > max) max = c.h; }
    if (!(max > min)) { max = min * 1.001 + 1e-12; min = min * 0.999; }
    const span = max - min; min -= span * 0.06; max += span * 0.06;
    const y = (p) => padT + (max - p) / (max - min) * plotH;
    const x = (i) => padL + i * slot + slot / 2;

    const css = getComputedStyle(document.documentElement);
    const colUp = css.getPropertyValue('--success').trim() || '#137333';
    const colDown = css.getPropertyValue('--danger').trim() || '#c5221f';
    const colLine = css.getPropertyValue('--line').trim() || '#dadce0';
    const colMuted = css.getPropertyValue('--muted').trim() || '#5f6368';
    const colText = css.getPropertyValue('--text').trim() || '#202124';
    const colAccent = css.getPropertyValue('--accent').trim() || '#1967d2';

    // grid + y labels
    ctx.font = '10.5px Roboto Mono, monospace';
    ctx.textBaseline = 'middle';
    const step = niceStep(max - min, Math.max(3, Math.floor(plotH / 44)));
    ctx.strokeStyle = colLine; ctx.lineWidth = 1; ctx.fillStyle = colMuted; ctx.textAlign = 'left';
    for (let p = Math.ceil(min / step) * step; p <= max; p += step) {
      const yy = Math.round(y(p)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
      ctx.fillText(fmtPrice(p), padL + plotW + 6, yy);
    }
    // x labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const tf = TIMEFRAMES.find(t => t.id === st.tf) || TIMEFRAMES[2];
    const every = Math.max(1, Math.ceil(70 / slot));
    for (let i = 0; i < n; i += every) {
      const d = new Date(candles[i].t);
      const label = tf.ms >= 86_400_000 ? `${d.getMonth() + 1}/${d.getDate()}` : tf.ms >= 3_600_000 ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h` : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      ctx.fillText(label, x(i), padT + plotH + 8);
    }

    // candles
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const up = c.c >= c.o;
      const col = up ? colUp : colDown;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.globalAlpha = c.filled ? 0.45 : 1;
      const cx = Math.round(x(i)) + 0.5;
      ctx.beginPath(); ctx.moveTo(cx, y(c.h)); ctx.lineTo(cx, y(c.l)); ctx.stroke();
      const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
      const h = Math.max(1, bot - top);
      if (up && !c.filled) { ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - bodyW / 2, top, bodyW, h); ctx.strokeRect(cx - bodyW / 2 + 0.5, top + 0.5, bodyW - 1, Math.max(0, h - 1)); }
      else ctx.fillRect(cx - bodyW / 2, top, bodyW, h);
    }
    ctx.globalAlpha = 1;

    // Close-price overlay keeps sparse (mostly carried) candle series readable.
    const filledShare = candles.filter(c => c.filled).length / n;
    if (filledShare > 0.5 && n > 1) {
      ctx.strokeStyle = colAccent; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.25;
      ctx.beginPath();
      candles.forEach((c, i) => { const px = x(i), py = y(c.c); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 1;
    }
    // last price line + tag
    const last = candles[n - 1];
    const ly = Math.round(y(last.c)) + 0.5;
    ctx.setLineDash([3, 3]); ctx.strokeStyle = colAccent; ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(padL + plotW, ly); ctx.stroke(); ctx.setLineDash([]);
    const tag = fmtPrice(last.c);
    ctx.font = 'bold 10.5px Roboto Mono, monospace';
    const tw = ctx.measureText(tag).width + 10;
    ctx.fillStyle = colAccent; ctx.fillRect(padL + plotW + 2, ly - 9, tw, 18);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(tag, padL + plotW + 7, ly);

    // hover crosshair + tooltip
    const tip = $('tm-chart-tooltip');
    if (st.hover && st.hover.x >= padL && st.hover.x <= padL + plotW) {
      const i = Math.min(n - 1, Math.max(0, Math.floor((st.hover.x - padL) / slot)));
      const c = candles[i];
      const cx = Math.round(x(i)) + 0.5;
      ctx.setLineDash([2, 3]); ctx.strokeStyle = colMuted;
      ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + plotH); ctx.stroke();
      const hy = Math.round(st.hover.y) + 0.5;
      if (hy >= padT && hy <= padT + plotH) { ctx.beginPath(); ctx.moveTo(padL, hy); ctx.lineTo(padL + plotW, hy); ctx.stroke(); }
      ctx.setLineDash([]);
      if (tip) {
        const d = new Date(c.t);
        tip.classList.remove('is-hidden');
        tip.innerHTML = `<b>${esc(d.toLocaleString())}</b>` +
          `<span>O <i>${fmtPrice(c.o)}</i></span><span>H <i>${fmtPrice(c.h)}</i></span><span>L <i>${fmtPrice(c.l)}</i></span><span>C <i>${fmtPrice(c.c)}</i></span>` +
          (c.n ? `<span>Trades <i>${c.n}</i></span>` : '') + (c.v ? `<span>Vol <i>${fmtCompactUsd(c.v)}</i></span>` : '') +
          (c.filled ? `<span class="tm-muted">no trades · carried</span>` : '');
        const left = Math.min(W - 190, Math.max(4, st.hover.x + 12));
        tip.style.left = left + 'px'; tip.style.top = Math.max(4, Math.min(H - 110, st.hover.y + 12)) + 'px';
      }
    } else if (tip) tip.classList.add('is-hidden');
    void colText;
  }

  /* ═══════════════════════════════════════════════════════════════════
     Refresh orchestration
     ═══════════════════════════════════════════════════════════════════ */
  function refreshMarketData(initial) {
    const m = st.market;
    if (!provider) return;
    if (isAnetMarket(m)) { fetchAnetSwaps(initial); }
    else { fetchMajorCandles(m); fetchMajorTrades(m); }
    const d = st.depth[m.id];
    const maxAge = m.chain === 'solana' ? 120_000 : 45_000;
    if (!d || Date.now() - d.t > maxAge) refreshDepth(m);
  }

  function onPricesUpdated() {
    const a = provider?.getAnet();
    if (a && a.priceUsd > 0) recordTick(a.priceUsd);
    renderMarketsList(); renderHeader();
    if (isAnetMarket(st.market)) drawChart();
    // First prices unlock the USD-sized depth ladder; don't wait for the next tick.
    if (!st.depth[st.market.id]) refreshDepth(st.market);
  }

  function registerProvider(p) {
    provider = p;
    loadPersisted();
    if (typeof p.onPrices === 'function') p.onPrices(onPricesUpdated);
    renderMarketsList(); renderHeader(); renderTape(); renderDepth(); drawChart();
    refreshMarketData(true);
    setInterval(() => refreshMarketData(false), 20_000);
    setInterval(() => { if (!isAnetMarket(st.market)) { fetchMajorCandles(st.market); fetchMajorTrades(st.market); } }, 15_000);
  }

  window.AnetTerminal = {
    MARKETS, TIMEFRAMES, CHAIN_LABEL,
    mount, registerProvider, selectMarket, matchMarket, setTimeframe,
    tokenLogo, chainLogo, logoHtml,
    onMarketChange: (cb) => { if (typeof cb === 'function') listeners.push(cb); },
    currentMarket: () => st.market,
    __test: { buildCandles, klinesToCandles, cpmmOut, decodeSwapLog, interpolate, bucketStart, toUnits, fromUnits, fmtUsd, fmtPrice, fmtCompactUsd, niceStep, matchMarket, MARKETS, tokenLogo, chainLogo, logoHtml, TOKEN_LOGOS, CHAIN_LOGOS, minMoveFor },
  };
})();
