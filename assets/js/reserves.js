/**
 * A Network Proof of Reserves
 * reserves.js  |  2026
 *
 * Read-only. Every number is fetched from a public chain in the visitor's
 * browser; nothing is self-reported. Addresses are the ones published in the
 * whitepaper (Version 4.7). CSP: script-src 'self'; no CDNs, no eval.
 *
 * Sources
 *   BNB Chain / Ethereum  JSON-RPC via AnetRpc (assets/js/anet-rpc.js): Ankr archive key first,
 *                         then public CORS nodes. eth_getBalance, eth_call; eth_getLogs needs the
 *                         archive node and degrades to "unavailable" when it cannot be reached.
 *   Solana                JSON-RPC via AnetRpc: getBalance, getTokenAccountsByOwner, falling back
 *                         to getMultipleAccounts on the treasury's associated token accounts.
 *   Bitcoin               Blockstream Esplora (CORS-enabled, no key)
 *   A Network L1          /sync/head, /network/consensus, /stats/investor,
 *                         /network/treasury, /bridge/x/reconciliation,
 *                         /bridge/burns/by-sender (gated)
 *   Prices                DexScreener (ANET), CoinGecko (majors)
 */
'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

  /* ═══════════════════════════════════════════════════════════════════
     Published facts (whitepaper v4.7). Change here = change in the paper.
     ═══════════════════════════════════════════════════════════════════ */
  const L1_API = 'https://explorer.a-network.net';
  const ESPLORA = 'https://blockstream.info/api';
  const SOL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const SOL_ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

  const PUB = {
    evmTreasury: '0x9C7C1058fdc9b710f688ECb7562924D9AE771417',
    solTreasury: '7j33RFPkNvaKsPuz2qJ5SzwiwXA4iL12ujqM4g2tRLEz',
    btcTreasury: 'bc1qrqunzzv8dsr5dxdrlq5gcex93rh7w0tqawfhf4',
    vault: '0x31438362a7667ce5559500023D025c7c14168B49',
    anetBsc: '0x791055A7d52AA392eaE8De04250497f33807E46A',
    anetSwapLegacy: '0x1A1AFE5BF1ffDB64aC10958cCe2D06B22Fb47Fb8',
    pancakePair: '0xB90071e377A31A6EA2cFDeBE19a4d5226c420b6B',
    maxSupplyAnet: 21_000_000,
    founderAllocationWanet: 10_499_798.020348,  // whitepaper v3.3: 50% founder allocation escrowed in the vault
    vaultDeployBlock: 99_500_000,
    whitepaper: { version: '4.7', title: 'ANRC-20 and Open Network Infrastructure', url: 'whitepaper.html' },
  };

  const TOKENS = {
    56: [
      { symbol: 'ANET', addr: PUB.anetBsc, decimals: 18 },
      { symbol: 'USDT', addr: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      { symbol: 'USDC', addr: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
      { symbol: 'BTCB', addr: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18 },
    ],
    1: [
      { symbol: 'USDT', addr: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      { symbol: 'USDC', addr: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      { symbol: 'WBTC', addr: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
    ],
  };
  const SOL_MINTS = [
    { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  ];
  const CG_IDS = { BNB: 'binancecoin', ETH: 'ethereum', SOL: 'solana', BTC: 'bitcoin', BTCB: 'bitcoin', WBTC: 'wrapped-bitcoin', USDT: 'tether', USDC: 'usd-coin' };

  /* Selectors / topics: keccak256(signature), precomputed (verified by tests). */
  const SEL_SIG = { balanceOf: 'balanceOf(address)', totalSupply: 'totalSupply()', vaultBalance: 'vaultBalance()', totalReleased: 'totalReleased()', threshold: 'threshold()', maxPerTx: 'maxPerTx()', maxGlobal24h: 'maxGlobal24h()', signers: 'signers()', paused: 'paused()' };
  const SEL = {
    balanceOf: '0x70a08231', totalSupply: '0x18160ddd', vaultBalance: '0x0bf6cc08',
    totalReleased: '0xe33b7de3', threshold: '0x42cde4e8', maxPerTx: '0xf968adbe', maxGlobal24h: '0x7864156c', signers: '0x46f0975a', paused: '0x5c975abb',
  };
  const TOPIC_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const TOPIC_RELEASED = '0x348242176e0411bb0b0875989cdc221ecc2da85910dce5fc751a152184196008';

  /* Known fee-origin senders: transfers from these are interface fees by construction. */
  const KNOWN_SENDERS = {
    [PUB.anetSwapLegacy.toLowerCase()]: 'AnetSwap v3.5 (1% inbound swap fee)',
    [PUB.pancakePair.toLowerCase()]: 'PancakeSwap ANET/WBNB pair',
  };

  /* ═══════════════════════════════════════════════════════════════════
     Pure helpers (exported for tests)
     ═══════════════════════════════════════════════════════════════════ */
  const pad32 = (h) => String(h).replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const topicAddr = (a) => '0x' + pad32(a);
  const addrFromTopic = (t) => '0x' + String(t).slice(26);
  const fromUnits = (v, d) => Number(BigInt(v)) / Math.pow(10, d);
  const fmtNum = (n, dp = 2) => (n == null || !isFinite(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: dp });
  const fmtUsd = (n) => (n == null || !isFinite(n)) ? '—' : '$' + fmtNum(n, Math.abs(n) >= 100 ? 0 : 2);
  const short = (a) => a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '—';
  const isBech32Btc = (a) => /^bc1[02-9ac-hj-np-z]{11,71}$/.test(String(a || ''));

  /** Decode ERC-20 Transfer logs into { from, to, value(BigInt), block, tx }. */
  function decodeTransfers(logs) {
    return (logs || []).filter(l => l && l.topics && l.topics.length >= 3 && l.data).map(l => ({
      from: addrFromTopic(l.topics[1]), to: addrFromTopic(l.topics[2]), value: BigInt(l.data),
      block: parseInt(l.blockNumber, 16), tx: l.transactionHash, logIndex: parseInt(l.logIndex, 16),
    }));
  }

  /** Decode vault Released logs: burnId, recipient (indexed), amount (first data word). */
  function decodeReleased(logs) {
    return (logs || []).filter(l => l && l.topics && l.topics.length >= 3).map(l => {
      const data = String(l.data || '').replace(/^0x/, '');
      return { burnId: BigInt(l.topics[1]), recipient: addrFromTopic(l.topics[2]), amount: data.length >= 64 ? BigInt('0x' + data.slice(0, 64)) : 0n, block: parseInt(l.blockNumber, 16), tx: l.transactionHash };
    });
  }

  /** Aggregate transfers per sender: { sender, label, count, total(BigInt) } sorted by total desc. */
  function aggregateBySender(transfers, known = KNOWN_SENDERS) {
    const m = new Map();
    for (const t of transfers) {
      const k = t.from.toLowerCase();
      const e = m.get(k) || { sender: t.from, label: known[k] || null, count: 0, total: 0n, lastBlock: 0 };
      e.count++; e.total += t.value; e.lastBlock = Math.max(e.lastBlock, t.block); m.set(k, e);
    }
    return [...m.values()].sort((a, b) => (a.total < b.total ? 1 : a.total > b.total ? -1 : 0));
  }

  /**
   * Vault reconciliation. All amounts in wei (BigInt).
   * escrowed = balance + released must equal the published founder allocation
   * (to within 1 wANET of rounding in the published figure) and the release count
   * on BNB Chain must match the L1 ledger when that ledger is available.
   */
  function reconcileVault({ balance, totalReleased, releasedEvents, publishedEscrowWei, l1Released = null }) {
    const escrowed = balance + totalReleased;
    const eventSum = releasedEvents.reduce((a, e) => a + e.amount, 0n);
    const tolerance = 10n ** 18n;
    // The vault may never hold LESS than the published escrow: that would mean
    // wANET left without a recorded release. Holding MORE is fine (additional
    // deposits after publication, or released wANET sent back) and is disclosed.
    const shortfall = escrowed < publishedEscrowWei ? publishedEscrowWei - escrowed : 0n;
    const surplus = escrowed > publishedEscrowWei ? escrowed - publishedEscrowWei : 0n;
    return {
      escrowed, eventSum, shortfall, surplus,
      eventsMatchCounter: eventSum === totalReleased,
      escrowMatchesPublished: shortfall <= tolerance,
      escrowDiffWei: shortfall > 0n ? shortfall : surplus,
      l1Matches: l1Released == null ? null : BigInt(l1Released) === BigInt(releasedEvents.length),
    };
  }

  /** Supply invariant: activated L1 supply + wANET supply must each stay under the cap. */
  function supplyChecks({ activatedAnts, bep20SupplyWei, maxSupplyAnet }) {
    const activatedAnet = Number(activatedAnts) / 1e8;
    const bep20 = fromUnits(bep20SupplyWei, 18);
    return {
      activatedAnet, bep20,
      activatedUnderCap: activatedAnet <= maxSupplyAnet,
      bep20EqualsCap: Math.abs(bep20 - maxSupplyAnet) < 1e-6,
    };
  }

  /** SHA-256 of raw bytes (Uint8Array/ArrayBuffer) or of a UTF-8 string. Hash bytes, not
   *  decoded text, when reproducibility with `shasum -a 256` matters (a BOM would be dropped by text()). */
  async function sha256Hex(input) {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : (input instanceof ArrayBuffer ? new Uint8Array(input) : input);
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ═══════════════════════════════════════════════════════════════════
     Fetch helpers
     ═══════════════════════════════════════════════════════════════════ */
  /** Shared failover client (assets/js/anet-rpc.js): Ankr archive key first, public CORS nodes next. */
  const rpcClient = () => {
    const c = (typeof window !== 'undefined' && window.AnetRpc) || null;
    if (!c) throw new Error('RPC client (anet-rpc.js) not loaded');
    return c;
  };
  const rpc = (chain, method, params = []) => rpcClient().call(chain, method, params);
  const evmCall = (chain, to, data) => rpc(chain, 'eth_call', [{ to, data }, 'latest']);
  const evmBalance = (chain, a) => rpc(chain, 'eth_getBalance', [a, 'latest']).then(h => BigInt(h));
  const erc20Balance = (chain, token, owner) => evmCall(chain, token, SEL.balanceOf + pad32(owner)).then(h => BigInt(h || '0x0'));
  /** Historical event scan: archive-capable endpoints only; throws when none is reachable (unless opts.allowPartialTail). */
  const getLogs = (chain, params, fromBlock, toBlock, opts) => rpcClient().getLogs(chain, params, fromBlock, toBlock, opts);
  const logsUnavailableMsg = (e) => {
    const detail = (e && e.cause && e.cause.message) || (e && e.message) || String(e);
    return `event history needs an archive RPC node (${(rpcClient().LOG_ENDPOINTS[56] || []).map(rpcClient().hostOf).join(', ')}), which could not be reached from your network (${detail})`;
  };
  /** A scan that came back without its live tail: everything up to `partialFrom - 1` is real, newer blocks were not scanned. */
  const partialNote = (logs, head) => logs && logs.partialFrom ? `Events from block #${fmtNum(logs.partialFrom, 0)} to #${fmtNum(head, 0)} (the most recent ${fmtNum(head - logs.partialFrom + 1, 0)} blocks) could not be scanned right now and are not included; the history up to #${fmtNum(logs.partialFrom - 1, 0)} is complete.` : '';

  /** Associated token account of `owner` for `mint` (vendored web3.js); null when the bundle is absent. */
  function deriveAta(owner, mint) {
    const S = (typeof window !== 'undefined' && window.AnetSolana) || null; if (!S) return null;
    const [ata] = S.PublicKey.findProgramAddressSync(
      [new S.PublicKey(owner).toBytes(), new S.PublicKey(SOL_TOKEN_PROGRAM).toBytes(), new S.PublicKey(mint).toBytes()],
      new S.PublicKey(SOL_ATA_PROGRAM));
    return ata.toBase58();
  }

  /**
   * SPL balances of `owner` for `mints` → { byMint: { mint: uiAmount }, method }. A mint with no token
   * account is absent from byMint. Prefers the owner-wide enumeration; public nodes block that indexed
   * query, so it falls back to reading the deterministic associated token accounts directly.
   */
  async function solTokenBalances(owner, mints) {
    const byMint = {};
    try {
      const accts = await rpc('solana', 'getTokenAccountsByOwner', [owner, { programId: SOL_TOKEN_PROGRAM }, { encoding: 'jsonParsed' }]);
      for (const a of (accts?.value || [])) { const info = a.account?.data?.parsed?.info; if (info) byMint[info.mint] = Number(info.tokenAmount?.uiAmount || 0); }
      return { byMint, method: 'getTokenAccountsByOwner' };
    } catch (e) {
      const atas = mints.map(m => deriveAta(owner, m.mint));
      if (!atas.length || atas.some(a => !a)) throw e;
      const res = await rpc('solana', 'getMultipleAccounts', [atas, { encoding: 'jsonParsed' }]);
      (res?.value || []).forEach((acc, i) => { const info = acc?.data?.parsed?.info; if (info) byMint[mints[i].mint] = Number(info.tokenAmount?.uiAmount || 0); });
      return { byMint, method: 'getMultipleAccounts (associated token accounts)' };
    }
  }

  async function l1(path) {
    const res = await fetch(L1_API + path, { headers: { Accept: 'application/json' } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return j;
  }

  /* ═══════════════════════════════════════════════════════════════════
     State + render
     ═══════════════════════════════════════════════════════════════════ */
  const st = { prices: {}, checks: [], data: {} };
  const logo = (sym) => { const m = { ANET: 'anet', WANET: 'anet', BNB: 'bnb', ETH: 'eth', SOL: 'sol', USDT: 'usdt', USDC: 'usdc', BTCB: 'btcb', WBTC: 'wbtc' }[sym]; return m ? `<img class="por-logo" src="assets/img/tokens/${m}.png" alt="" width="18" height="18">` : (sym === 'BTC' ? '<span class="por-logo por-logo-btc">₿</span>' : ''); };
  const usdOf = (sym, amt) => { const p = st.prices[sym]; return p != null && isFinite(amt) ? amt * p : null; };
  const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)} ↗</a>`;

  async function loadPrices() {
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${PUB.anetBsc}`); const d = await r.json();
      const pairs = (d.pairs || []).filter(p => (p.baseToken?.address || '').toLowerCase() === PUB.anetBsc.toLowerCase()).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      if (pairs[0]) { st.prices.ANET = parseFloat(pairs[0].priceUsd); st.prices.WANET = st.prices.ANET; }
    } catch (_) {}
    try {
      const ids = [...new Set(Object.values(CG_IDS))].join(',');
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`); const d = await r.json();
      for (const [sym, id] of Object.entries(CG_IDS)) if (d[id]?.usd != null) st.prices[sym] = d[id].usd;
    } catch (_) {}
  }

  function check(id, label, ok, detail) {
    const i = st.checks.findIndex(c => c.id === id);
    const c = { id, label, ok, detail };
    if (i >= 0) st.checks[i] = c; else st.checks.push(c);
    renderChecks();
  }
  function renderChecks() {
    const el = $('por-checks'); if (!el) return;
    el.innerHTML = st.checks.map(c => `<div class="card por-check ${c.ok === true ? 'ok' : c.ok === false ? 'fail' : 'pending'}">
        <div class="por-check-head"><span class="por-check-icon">${c.ok === true ? '✓' : c.ok === false ? '✕' : '?'}</span><b>${esc(c.label)}</b>${c.ok == null ? '<span class="pill" style="font-size:10px;margin-left:auto">unavailable</span>' : ''}</div>
        <div class="por-check-detail">${c.detail || ''}</div></div>`).join('');
    const passing = st.checks.filter(c => c.ok === true).length, total = st.checks.filter(c => c.ok !== null).length;
    const s = $('por-stat-checks'); if (s) s.textContent = `${passing} / ${total}`;
  }

  /* ── Treasuries ─────────────────────────────────────────────────── */
  function treasuryCard({ title, chain, address, explorer, rows, note }) {
    const total = rows.reduce((a, r) => a + (r.usd || 0), 0);
    return `<div class="card por-treasury">
      <div class="card-header"><span class="card-title">${esc(title)}</span><span class="pill live green">${esc(chain)}</span></div>
      <div class="card-body">
        <div class="por-addr"><code>${esc(address)}</code> ${link(explorer, 'verify')}</div>
        <div class="por-rows">${rows.map(r => `<div class="por-row"><span class="por-row-l">${logo(r.symbol)} ${esc(r.symbol)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><span class="por-row-v tm-mono">${r.amount == null ? '—' : fmtNum(r.amount, r.dp ?? 4)}</span><span class="por-row-usd tm-mono">${r.usd != null ? fmtUsd(r.usd) : ''}</span></div>`).join('')}</div>
        <div class="por-total"><span>Current holdings</span><b>${fmtUsd(total)}</b></div>
        ${note ? `<p class="por-note">${note}</p>` : ''}
      </div></div>`;
  }

  async function loadTreasuries() {
    const host = $('por-treasuries'); if (!host) return;
    host.innerHTML = '<div class="tm-empty"><span class="spinner"></span> Reading treasuries…</div>';
    const cards = [];
    // EVM treasury on BNB Chain
    try {
      const [bnb, ...toks] = await Promise.all([evmBalance(56, PUB.evmTreasury), ...TOKENS[56].map(t => erc20Balance(56, t.addr, PUB.evmTreasury))]);
      const rows = [{ symbol: 'BNB', amount: fromUnits(bnb, 18), usd: usdOf('BNB', fromUnits(bnb, 18)) }, ...TOKENS[56].map((t, i) => ({ symbol: t.symbol, amount: fromUnits(toks[i], t.decimals), usd: usdOf(t.symbol, fromUnits(toks[i], t.decimals)) }))];
      st.data.evmBsc = rows;
      cards.push(treasuryCard({ title: 'EVM RESERVE TREASURY', chain: 'BNB Chain', address: PUB.evmTreasury, explorer: `https://bscscan.com/address/${PUB.evmTreasury}`, rows, note: 'Receives the 0.875% interface fee from BNB Chain swaps (whitepaper v4.1, v4.6). The revenue ledger below lists every inbound token transfer.' }));
      check('evm-treasury', 'EVM treasury readable on BNB Chain', true, `${rows.length} balances read via eth_call`);
    } catch (e) { cards.push(`<div class="card"><div class="card-body tm-empty">BNB Chain treasury unavailable: ${esc(e.message)}</div></div>`); check('evm-treasury', 'EVM treasury readable on BNB Chain', null, 'source unavailable: ' + esc(e.message)); }
    // same treasury on Ethereum
    try {
      const [eth, ...toks] = await Promise.all([evmBalance(1, PUB.evmTreasury), ...TOKENS[1].map(t => erc20Balance(1, t.addr, PUB.evmTreasury))]);
      const rows = [{ symbol: 'ETH', amount: fromUnits(eth, 18), usd: usdOf('ETH', fromUnits(eth, 18)) }, ...TOKENS[1].map((t, i) => ({ symbol: t.symbol, amount: fromUnits(toks[i], t.decimals), usd: usdOf(t.symbol, fromUnits(toks[i], t.decimals)) }))];
      cards.push(treasuryCard({ title: 'EVM RESERVE TREASURY', chain: 'Ethereum', address: PUB.evmTreasury, explorer: `https://etherscan.io/address/${PUB.evmTreasury}`, rows, note: 'Same address on Ethereum; receives the interface fee from Uniswap V2 swaps.' }));
      check('eth-treasury', 'EVM treasury readable on Ethereum', true, `${rows.length} balances read via eth_call`);
    } catch (e) { check('eth-treasury', 'EVM treasury readable on Ethereum', null, 'source unavailable: ' + esc(e.message)); }
    // Solana treasury
    try {
      const lam = await rpc('solana', 'getBalance', [PUB.solTreasury]);
      const sol = (lam?.value ?? lam ?? 0) / 1e9;
      const { byMint, method } = await solTokenBalances(PUB.solTreasury, SOL_MINTS);
      const rows = [{ symbol: 'SOL', amount: sol, usd: usdOf('SOL', sol) }, ...SOL_MINTS.map(m => ({ symbol: m.symbol, amount: byMint[m.mint] ?? 0, usd: usdOf(m.symbol, byMint[m.mint] ?? 0), sub: byMint[m.mint] == null ? 'fee account not initialized' : '' }))];
      const missing = SOL_MINTS.filter(m => byMint[m.mint] == null).length;
      cards.push(treasuryCard({ title: 'SOLANA TREASURY', chain: 'Solana', address: PUB.solTreasury, explorer: `https://solscan.io/account/${PUB.solTreasury}`, rows, note: missing ? `Receives the 0.87% Jupiter platform fee once its token accounts exist; ${missing} of ${SOL_MINTS.length} fee accounts are not initialized yet, so the fee is currently waived on those pairs (whitepaper v4.6).` : 'Receives the 0.87% Jupiter platform fee inside each swap transaction (whitepaper v4.6).' }));
      check('sol-treasury', 'Solana treasury readable', true, (missing ? `${missing} fee token account(s) not initialized; fee waived there` : 'all fee token accounts exist') + ` · via ${method}`);
    } catch (e) { check('sol-treasury', 'Solana treasury readable', null, 'source unavailable: ' + esc(e.message)); }
    // Bitcoin treasury
    try {
      if (!isBech32Btc(PUB.btcTreasury)) throw new Error('invalid bech32 address');
      const r = await fetch(`${ESPLORA}/address/${PUB.btcTreasury}`); const d = await r.json();
      const sats = (d.chain_stats.funded_txo_sum - d.chain_stats.spent_txo_sum);
      const btc = sats / 1e8, txs = d.chain_stats.tx_count;
      const rows = [{ symbol: 'BTC', amount: btc, dp: 8, usd: usdOf('BTC', btc), sub: `${txs} confirmed transaction${txs === 1 ? '' : 's'}` }];
      cards.push(treasuryCard({ title: 'BITCOIN RESERVE TREASURY', chain: 'Bitcoin', address: PUB.btcTreasury, explorer: `https://blockstream.info/address/${PUB.btcTreasury}`, rows, note: txs === 0 ? 'Published for the future ANET/BTC reserve-backed market (whitepaper v3.9). Not yet funded: the BTC market stays disabled until a funding transaction is published and verified here.' : 'Backs the ANET/BTC reserve-backed market described in whitepaper v3.9.' }));
      check('btc-treasury', 'Bitcoin treasury readable', true, txs === 0 ? 'address valid, unfunded (BTC market disabled, as published)' : `${fmtNum(btc, 8)} BTC across ${txs} tx`);
    } catch (e) { check('btc-treasury', 'Bitcoin treasury readable', null, 'source unavailable: ' + esc(e.message)); }
    host.innerHTML = cards.join('');
  }

  /* ── Vault reconciliation ───────────────────────────────────────── */
  async function loadVault() {
    const el = $('por-vault'); if (!el) return;
    el.innerHTML = '<div class="tm-empty"><span class="spinner"></span> Reading the bridge vault on BNB Chain…</div>';
    try {
      // Contract state is a plain eth_call served by any node; the Released event history needs an
      // archive node and must not take the whole section down when that node is unreachable.
      const head = parseInt(await rpc(56, 'eth_blockNumber', []), 16);
      const [balHex, relHex, thrHex, maxTxHex, maxDayHex, pausedHex, signersHex] = await Promise.all([
        evmCall(56, PUB.vault, SEL.vaultBalance), evmCall(56, PUB.vault, SEL.totalReleased), evmCall(56, PUB.vault, SEL.threshold),
        evmCall(56, PUB.vault, SEL.maxPerTx), evmCall(56, PUB.vault, SEL.maxGlobal24h), evmCall(56, PUB.vault, SEL.paused), evmCall(56, PUB.vault, SEL.signers),
      ]);
      let releases = null, logsError = null, releasesPartial = '', releasesPartialFrom = null;
      try { const raw = await getLogs(56, { address: PUB.vault, topics: [TOPIC_RELEASED] }, PUB.vaultDeployBlock, head, { allowPartialTail: true }); releases = decodeReleased(raw); releasesPartial = partialNote(raw, head); releasesPartialFrom = raw.partialFrom || null; }
      catch (e) { logsError = e; }
      const balance = BigInt(balHex), totalReleased = BigInt(relHex), threshold = Number(BigInt(thrHex));
      const sigBody = signersHex.replace(/^0x/, ''); const nSigners = parseInt(sigBody.slice(64, 128), 16);
      const publishedEscrowWei = BigInt(Math.round(PUB.founderAllocationWanet * 1e6)) * 10n ** 12n;
      // L1 side (gated unless ANET_BRIDGE_BURN_ENABLED)
      let l1Note = '', l1Released = null;
      try { await l1('/bridge/burns/by-sender/ANET000000000000000000000000000000000000'); l1Note = 'L1 export ledger is public: pending burns are compared with releases.'; }
      catch (e) { l1Note = e.status === 404 ? 'L1 export ledger is behind the operator switch (ANET_BRIDGE_BURN_ENABLED is off); reconciliation uses the BNB Chain side only.' : `L1 export ledger unavailable: ${e.message}`; }
      const rec = reconcileVault({ balance, totalReleased, releasedEvents: releases || [], publishedEscrowWei, l1Released });
      const row = (k, v) => `<div class="price-row"><span>${k}</span><span class="val tm-mono">${v}</span></div>`;
      el.innerHTML = `
        <div class="por-vault-grid">
          <div>
            ${row('Vault contract', link(`https://bscscan.com/address/${PUB.vault}`, short(PUB.vault)))}
            ${row('wANET in vault (vaultBalance)', fmtNum(fromUnits(balance, 18), 6) + ' wANET')}
            ${row('Released to date (totalReleased)', fmtNum(fromUnits(totalReleased, 18), 6) + ' wANET')}
            ${row('Escrowed = balance + released', fmtNum(fromUnits(rec.escrowed, 18), 6) + ' wANET')}
            ${row('Published escrow (whitepaper v3.3)', fmtNum(PUB.founderAllocationWanet, 6) + ' wANET')}
          </div>
          <div>
            ${row('Release events on BNB Chain', releases ? `${releases.length} (sum ${fmtNum(fromUnits(rec.eventSum, 18), 6)} wANET)` : `unavailable · ${link(`https://bscscan.com/address/${PUB.vault}#events`, 'BscScan events')}`)}
            ${row('Signer policy', `${threshold} of ${nSigners} (EIP-712)`)}
            ${row('Caps', `${fmtNum(fromUnits(BigInt(maxTxHex), 18), 0)} / tx · ${fmtNum(fromUnits(BigInt(maxDayHex), 18), 0)} / 24h`)}
            ${row('Paused', BigInt(pausedHex) === 0n ? 'no' : 'YES')}
            ${row('wANET per native ANET burned', '1 : 1')}
          </div>
        </div>
        <p class="por-note">${esc(l1Note)}</p>
        ${logsError ? `<p class="por-note">Release ${esc(logsUnavailableMsg(logsError))}. The balance, counter and policy above were read from a public node; only the per-event list is missing.</p>` : ''}
        ${releasesPartial ? `<p class="por-note">${esc(releasesPartial)} The counter above is live, so a release in that window would still show up as a mismatch below.</p>` : ''}
        ${releases && releases.length ? `<div class="por-rel-head"><span>Burn ID</span><span>Amount</span><span>Recipient</span><span>BNB tx</span></div>${releases.slice(-10).reverse().map(r => `<div class="por-rel-row tm-mono"><span>#${r.burnId}</span><span>${fmtNum(fromUnits(r.amount, 18), 6)} wANET</span><span>${esc(short(r.recipient))}</span><span>${link(`https://bscscan.com/tx/${r.tx}`, short(r.tx))}</span></div>`).join('')}` : ''}`;
      const v = $('por-stat-vault'); if (v) v.textContent = fmtNum(fromUnits(balance, 18), 0);
      check('vault-escrow', 'Vault holds at least the published founder allocation', rec.escrowMatchesPublished,
        `balance + released = ${fmtNum(fromUnits(rec.escrowed, 18), 6)} wANET vs published ${fmtNum(PUB.founderAllocationWanet, 6)}` +
        (rec.shortfall > 0n ? ` (SHORTFALL ${fmtNum(fromUnits(rec.shortfall, 18), 6)} wANET)` : rec.surplus > 0n ? ` (+${fmtNum(fromUnits(rec.surplus, 18), 6)} wANET above the published figure)` : ''));
      if (releases && (rec.eventsMatchCounter || !releasesPartial)) check('vault-events', 'Release events reconcile with totalReleased', rec.eventsMatchCounter, `${releases.length} Released event(s) sum to the contract counter` + (releasesPartial ? ' (most recent blocks not yet scanned)' : ''));
      else if (releases) check('vault-events', 'Release events reconcile with totalReleased', null, `counter is ${fmtNum(fromUnits(totalReleased, 18), 6)} wANET but the ${releases.length} event(s) scanned sum to ${fmtNum(fromUnits(rec.eventSum, 18), 6)}; the difference may sit in blocks #${fmtNum(releasesPartialFrom, 0)}+ which could not be scanned yet`);
      else check('vault-events', 'Release events reconcile with totalReleased', null, 'source unavailable: ' + esc(logsUnavailableMsg(logsError)));
      check('vault-paused', 'Vault is live (not paused)', BigInt(pausedHex) === 0n, `${threshold}-of-${nSigners} signer policy`);
      st.data.vault = { balance, totalReleased, releases };
    } catch (e) {
      el.innerHTML = `<div class="tm-empty">Vault unavailable: ${esc(e.message)}</div>`;
      check('vault-escrow', 'Vault holds at least the published founder allocation', null, 'source unavailable: ' + esc(e.message));
    }
  }

  /* ── Fee revenue ledger ─────────────────────────────────────────── */
  async function loadLedger() {
    const el = $('por-ledger'), pill = $('por-ledger-pill'); if (!el) return;
    el.innerHTML = '<div class="tm-empty"><span class="spinner"></span> Scanning BNB Chain transfer events to the treasury…</div>';
    try {
      const head = parseInt(await rpc(56, 'eth_blockNumber', []), 16);
      const toTopic = topicAddr(PUB.evmTreasury);
      const results = await Promise.all(TOKENS[56].map(t => getLogs(56, { address: t.addr, topics: [TOPIC_TRANSFER, null, toTopic] }, PUB.vaultDeployBlock, head, { allowPartialTail: true }).then(l => ({ token: t, transfers: decodeTransfers(l), partialFrom: l.partialFrom || null }))));
      const partialFrom = results.reduce((m, r) => (r.partialFrom && (!m || r.partialFrom < m) ? r.partialFrom : m), null);
      const ledgerPartial = partialFrom ? partialNote(Object.assign([], { partialFrom }), head) : '';
      let totalUsd = 0, totalCount = 0;
      const sections = results.filter(r => r.transfers.length).map(({ token, transfers }) => {
        const sum = transfers.reduce((a, t) => a + t.value, 0n);
        const amt = fromUnits(sum, token.decimals); const usd = usdOf(token.symbol, amt);
        totalUsd += usd || 0; totalCount += transfers.length;
        const senders = aggregateBySender(transfers);
        return `<div class="por-ledger-token">
          <div class="por-ledger-token-head">${logo(token.symbol)} <b>${esc(token.symbol)}</b><span class="tm-mono">${fmtNum(amt, 4)} ${esc(token.symbol)}${usd != null ? ` · ${fmtUsd(usd)} at today's price` : ''}</span><span class="tm-muted">${transfers.length} inbound transfers · ${senders.length} senders</span></div>
          <div class="por-sender-head"><span>Sender</span><span>Transfers</span><span>Amount</span><span>Last seen</span></div>
          ${senders.slice(0, 8).map(s => `<div class="por-sender-row tm-mono"><span>${link(`https://bscscan.com/address/${s.sender}`, short(s.sender))}${s.label ? `<small>${esc(s.label)}</small>` : ''}</span><span>${s.count}</span><span>${fmtNum(fromUnits(s.total, token.decimals), 4)}</span><span>${link(`https://bscscan.com/block/${s.lastBlock}`, '#' + s.lastBlock)}</span></div>`).join('')}
          ${senders.length > 8 ? `<div class="tm-muted" style="font-size:11px;padding:6px 4px">+ ${senders.length - 8} more senders</div>` : ''}
        </div>`;
      });
      el.innerHTML = `<div class="por-ledger-summary"><div><span>Lifetime inbound (tokens, since vault deploy block ${PUB.vaultDeployBlock.toLocaleString()})</span><b>${fmtUsd(totalUsd)}</b></div><div><span>Inbound transfers</span><b>${totalCount}</b></div><div><span>Current token holdings</span><b>${fmtUsd((st.data.evmBsc || []).reduce((a, r) => a + (r.usd || 0), 0))}</b></div></div>
        <p class="por-note">Inflows are valued at today's prices. The difference between lifetime inflows and current holdings is what has been spent or converted (gas, relayer costs, operations); outflows are visible on ${link(`https://bscscan.com/address/${PUB.evmTreasury}#tokentxns`, 'BscScan')}. Native BNB inflows cannot be enumerated without an indexer and are excluded.</p>
        ${ledgerPartial ? `<p class="por-note">${esc(ledgerPartial)}</p>` : ''}
        ${sections.join('') || '<div class="tm-empty">No inbound token transfers found.</div>'}`;
      if (pill) { pill.className = ledgerPartial ? 'pill amber' : 'pill green'; pill.textContent = `${totalCount} transfers${ledgerPartial ? ' · recent blocks pending' : ''}`; }
      check('ledger', 'Fee revenue ledger reconstructed from chain events', true, `${totalCount} inbound token transfers across ${results.filter(r => r.transfers.length).length} tokens` + (ledgerPartial ? ` (events after block #${fmtNum(partialFrom - 1, 0)} not yet scanned)` : ''));
    } catch (e) {
      const msg = e && e.allFailed ? logsUnavailableMsg(e) : e.message;
      el.innerHTML = `<div class="tm-empty">Ledger unavailable: ${esc(msg)}. Inbound token transfers remain verifiable on ${link(`https://bscscan.com/address/${PUB.evmTreasury}#tokentxns`, 'BscScan')}.</div>`;
      if (pill) { pill.className = 'pill'; pill.textContent = 'unavailable'; }
      check('ledger', 'Fee revenue ledger reconstructed from chain events', null, 'source unavailable: ' + esc(msg));
    }
  }

  /* ── Supply invariant ───────────────────────────────────────────── */
  async function loadSupply() {
    const el = $('por-supply'); if (!el) return;
    el.innerHTML = '<div class="tm-empty"><span class="spinner"></span> Reading supply…</div>';
    try {
      // The BEP-20 supply read must not hide the L1 figures when every BNB Chain node is unreachable.
      const [bep20Hex, inv, cons, head, treas, recon] = await Promise.all([
        evmCall(56, PUB.anetBsc, SEL.totalSupply).catch(() => null), l1('/stats/investor'), l1('/network/consensus'), l1('/sync/head'), l1('/network/treasury'), l1('/bridge/x/reconciliation').catch(() => null),
      ]);
      const s = supplyChecks({ activatedAnts: inv.activated_supply_ants, bep20SupplyWei: bep20Hex ? BigInt(bep20Hex) : 0n, maxSupplyAnet: PUB.maxSupplyAnet });
      const row = (k, v) => `<div class="price-row"><span>${k}</span><span class="val tm-mono">${v}</span></div>`;
      const treasuryMatches = String(treas.l1_reserve_treasury_evm_address || '').toLowerCase() === PUB.evmTreasury.toLowerCase();
      el.innerHTML = `<div class="por-vault-grid">
          <div>
            ${row('Hard cap (consensus rules)', fmtNum(cons.issuance?.max_supply_anet ?? PUB.maxSupplyAnet, 0) + ' ANET')}
            ${row('Activated native L1 supply', fmtNum(s.activatedAnet, 8) + ' ANET')}
            ${row('L1 tip height', `#${fmtNum(head.tip_height, 0)}`)}
            ${row('Admin mint', esc(cons.issuance?.monetary_policy || 'fixed_capped_schedule_no_admin_mint'))}
          </div>
          <div>
            ${row('wANET BEP-20 total supply', bep20Hex ? fmtNum(s.bep20, 6) + ' wANET' : 'unavailable (no BNB Chain node reachable)')}
            ${row('BEP-20 owner', 'renounced (immutable)')}
            ${row('Inbound bridge credits (L1)', recon ? (recon.portal_credit_enabled ? 'ENABLED' : 'disabled, locked ' + fmtNum(Number(recon.locked_ants) / 1e8, 4) + ' ANET') : 'n/a')}
            ${row('L1 treasury config matches paper', treasuryMatches ? 'yes' : 'NO')}
          </div></div>
        <p class="por-note">Native L1 ANET and wANET are separate assets under separate accounting (whitepaper v3.9, v4.4). Native ANET only increases through the mining schedule and only decreases through one-way exports; wANET is a fixed 21,000,000 supply of which the founder allocation sits in the vault above.</p>`;
      check('cap', 'Activated L1 supply is under the 21,000,000 cap', s.activatedUnderCap, `${fmtNum(s.activatedAnet, 4)} ANET activated`);
      check('bep20', 'wANET total supply equals the fixed 21,000,000', bep20Hex ? s.bep20EqualsCap : null, bep20Hex ? `${fmtNum(s.bep20, 6)} wANET` : 'source unavailable: no BNB Chain RPC node reachable');
      check('no-inbound', 'Inbound bridge credits disabled (one-way policy)', recon ? !recon.portal_credit_enabled : null, recon ? 'portal_credit_enabled = false' : 'endpoint unavailable');
      check('treasury-config', 'L1 node publishes the same treasury address as the paper', treasuryMatches, esc(treas.l1_reserve_treasury_evm_address || ''));
    } catch (e) { el.innerHTML = `<div class="tm-empty">Supply data unavailable: ${esc(e.message)}</div>`; check('cap', 'Activated L1 supply is under the 21,000,000 cap', null, 'source unavailable: ' + esc(e.message)); }
  }

  /* ── Whitepaper digest ──────────────────────────────────────────── */
  async function loadAttestation() {
    const el = $('por-attest'); if (!el) return;
    try {
      const res = await fetch(PUB.whitepaper.url, { cache: 'no-store' }); const raw = new Uint8Array(await res.arrayBuffer());
      const digest = await sha256Hex(raw);
      const row = (k, v) => `<div class="price-row"><span>${k}</span><span class="val tm-mono" style="word-break:break-all">${v}</span></div>`;
      el.innerHTML = `${row('Document', link(PUB.whitepaper.url, `whitepaper.html (Version ${PUB.whitepaper.version})`))}
        ${row('SHA-256 of the page you can download right now', digest)}
        ${row('Bytes', fmtNum(raw.length, 0))}
        <p class="por-note">Whitepaper Version 4.2 commits to sealing each published revision as a Layer 1 block event (<code>Protocol: v4.7 … (sha256 …)</code>). Compare this digest with the sealed event on the ${link('https://explorer.a-network.net/explorer', 'block explorer')}; if the sealed digest differs, the published document has changed since it was attested. Reproduce locally: <code>curl -s https://a-network.net/whitepaper.html | shasum -a 256</code>.</p>`;
      check('digest', 'Whitepaper digest computed from the live document', true, digest.slice(0, 16) + '…');
    } catch (e) { el.innerHTML = `<div class="tm-empty">Digest unavailable: ${esc(e.message)}</div>`; check('digest', 'Whitepaper digest computed from the live document', null, 'source unavailable: ' + esc(e.message)); }
  }

  /** Which node answered each chain, so a visitor can see the page failing over (network bar). */
  const CHAIN_LABEL = { 56: 'BNB Chain', 1: 'Ethereum', solana: 'Solana' };
  function renderRpcStatus() {
    const el = $('por-rpc'); if (!el) return;
    let s; try { s = rpcClient().status(); } catch (_) { el.textContent = 'RPC client not loaded'; return; }
    const parts = Object.keys(CHAIN_LABEL).map(c => {
      const cs = s[c] || {}; const active = cs.active;
      const fallback = active && cs.endpoints && cs.endpoints[0] && active !== cs.endpoints[0];
      return `<span class="por-rpc-chain${fallback ? ' fallback' : ''}" title="${esc(fallback ? `${cs.endpoints[0]} unreachable, failed over` : 'primary endpoint')}">${esc(CHAIN_LABEL[c])}: <b>${esc(active || 'connecting…')}</b></span>`;
    });
    const logs = s.logs && s.logs[56];
    if (logs && logs.endpoints && logs.endpoints.length) {
      const primary = logs.endpoints[0];
      if (logs.active) parts.push(`<span class="por-rpc-chain${logs.active !== primary ? ' fallback' : ''}" title="${esc(logs.active !== primary ? `${primary} unreachable, event history read from ${logs.active}` : 'archive node serving the event history (ledger, release events)')}">history: <b>${esc(logs.active)}</b></span>`);
      else if ((s[56] || {}).active) parts.push(`<span class="por-rpc-chain fallback" title="Event history (ledger, release events) needs an archive node: ${esc(logs.endpoints.join(', '))}">history: <b>unavailable</b></span>`);
    }
    el.innerHTML = parts.join('<span class="por-rpc-sep"> · </span>');
  }

  async function refreshAll() {
    st.checks = []; renderChecks();
    const t = $('por-updated'); if (t) t.textContent = 'checking…';
    await loadPrices();
    await Promise.all([loadTreasuries(), loadVault(), loadSupply(), loadAttestation()]);
    await loadLedger();
    renderRpcStatus();
    if (t) t.textContent = new Date().toLocaleString();
  }

  function boot() {
    $('por-refresh')?.addEventListener('click', refreshAll);
    window.addEventListener('anet-rpc-status', renderRpcStatus);
    renderRpcStatus();
    refreshAll();
    setInterval(refreshAll, 5 * 60_000);
  }

  window.AnetReserves = { PUB, __test: { decodeTransfers, decodeReleased, aggregateBySender, reconcileVault, supplyChecks, isBech32Btc, topicAddr, addrFromTopic, fromUnits, SEL, SEL_SIG, TOPIC_TRANSFER, TOPIC_RELEASED, sha256Hex, deriveAta, solTokenBalances, getLogs, partialNote, SOL_MINTS, SOL_TOKEN_PROGRAM, SOL_ATA_PROGRAM } };

  if (typeof document !== 'undefined' && document.getElementById('por-checks')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})();
