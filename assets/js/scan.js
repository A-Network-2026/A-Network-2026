/* AnetScan — shared explorer JS (mainnet + nft) */
(function () {
  "use strict";

  const API_BASES = ["https://api.a-network.net", "https://rmp-site.onrender.com"];
  const API_TIMEOUT_MS = 6000;

  async function fetchWithFallback(path) {
    let lastErr = null;
    for (const base of API_BASES) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), API_TIMEOUT_MS);
      try {
        const r = await fetch(base + path, { cache: "no-store", signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        if (j && j.error) throw new Error(j.error);
        return j;
      } catch (e) { clearTimeout(t); lastErr = e; }
    }
    throw lastErr || new Error("api unavailable");
  }

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  function fmt(n, decimals = 0) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    const num = Number(n);
    if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(2) + " B";
    if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(2) + " M";
    if (Math.abs(num) >= 1e3) return num.toLocaleString(undefined, { maximumFractionDigits: decimals });
    return num.toLocaleString(undefined, { maximumFractionDigits: decimals });
  }

  function fmtUsd(n, decimals = 4) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: decimals });
  }

  function timeAgo(ts) {
    if (!ts) return "—";
    const s = Math.max(0, Math.floor((Date.now() - Number(ts) * 1000) / 1000));
    if (s < 60) return s + " secs ago";
    if (s < 3600) return Math.floor(s / 60) + " mins ago";
    if (s < 86400) return Math.floor(s / 3600) + " hrs ago";
    return Math.floor(s / 86400) + " days ago";
  }

  function shortHash(h, head = 6, tail = 4) {
    if (!h) return "—";
    const s = String(h);
    if (s.length <= head + tail + 3) return s;
    return s.slice(0, head) + "…" + s.slice(-tail);
  }

  /* ── Demo / fallback data ─────────────────────────── */
  function demoStats() {
    // Used until live api wires up. Conservative honest placeholders.
    return {
      price: { value: null, change24h: null },
      gasGwei: 0.001,
      transactions24h: null,
      tps: null,
      latestBlock: { height: 0, timeSec: 0.5 },
      marketCapAnts: null,
      circulatingAnts: null,
      votingPowerAnet: null,
      txChart14d: Array.from({ length: 14 }, (_, i) => 0)
    };
  }

  function drawChart(svg, points) {
    if (!svg || !points || !points.length) return;
    const w = svg.clientWidth || 320;
    const h = svg.clientHeight || 110;
    const max = Math.max(...points, 1);
    const min = Math.min(...points, 0);
    const range = max - min || 1;
    const step = w / Math.max(points.length - 1, 1);
    const path = points.map((p, i) => {
      const x = i * step;
      const y = h - 10 - ((p - min) / range) * (h - 20);
      return (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    svg.innerHTML =
      `<path d="${path}" fill="none" stroke="#6ae7b1" stroke-width="1.6"/>` +
      `<path d="${path} L ${w},${h} L 0,${h} Z" fill="rgba(106,231,177,0.10)" stroke="none"/>`;
  }

  /* ── Mainnet renderer (scan.html) ──────────────────── */
  async function renderMainnet() {
    if (!document.body.classList.contains("page-scan")) return;
    let stats = demoStats();
    let blocks = [];
    let txs = [];
    // Parallel fetch — the three endpoints don't depend on each other.
    const [statsRes, blocksRes, txsRes] = await Promise.allSettled([
      fetchWithFallback("/api/chain/stats"),
      fetchWithFallback("/api/chain/latest-blocks?limit=6"),
      fetchWithFallback("/api/chain/latest-transactions?limit=6")
    ]);
    if (statsRes.status === "fulfilled" && statsRes.value) stats = Object.assign(stats, statsRes.value);
    if (blocksRes.status === "fulfilled" && Array.isArray(blocksRes.value)) blocks = blocksRes.value;
    if (txsRes.status === "fulfilled" && Array.isArray(txsRes.value)) txs = txsRes.value;

    const priceEl = $("#anetPrice");
    if (priceEl) priceEl.innerHTML = stats.price && stats.price.value != null
      ? `<strong>${fmtUsd(stats.price.value)}</strong>` +
        (stats.price.change24h != null
          ? ` <span class="${stats.price.change24h >= 0 ? "up" : "down"}">(${stats.price.change24h >= 0 ? "+" : ""}${Number(stats.price.change24h).toFixed(2)}%)</span>`
          : "")
      : "<strong>Unavailable</strong>";

    const gasEl = $("#anetGas");
    if (gasEl) gasEl.innerHTML = `<strong>${stats.gasGwei != null ? stats.gasGwei + " Gwei" : "—"}</strong>`;

    const setText = (sel, val) => { const el = $(sel); if (el) el.innerHTML = val; };
    setText("#statPrice", stats.price && stats.price.value != null
      ? fmtUsd(stats.price.value) + (stats.price.change24h != null
          ? ` <span class="${stats.price.change24h >= 0 ? "up" : "down"}">(${stats.price.change24h >= 0 ? "+" : ""}${Number(stats.price.change24h).toFixed(2)}%)</span>`
          : "")
      : "—");
    setText("#statTxs", stats.transactions24h != null
      ? fmt(stats.transactions24h) + (stats.tps ? ` <span class="sub">(${Number(stats.tps).toFixed(1)} TPS)</span>` : "")
      : "—");
    setText("#statGas", stats.gasGwei != null ? `${stats.gasGwei} Gwei <span class="sub">(&lt; $0.00001)</span>` : "—");
    setText("#statMcap", stats.marketCapAnts != null
      ? fmt(stats.marketCapAnts) + ' <span class="sub">ANTS</span>'
      : "—");
    setText("#statBlock", stats.latestBlock && stats.latestBlock.height
      ? fmt(stats.latestBlock.height) + ` <span class="sub">(${stats.latestBlock.timeSec || 0.5}s)</span>`
      : "—");
    setText("#statVoting", stats.votingPowerAnet != null
      ? fmt(stats.votingPowerAnet) + ' <span class="sub">ANET</span>'
      : "—");

    drawChart($("#txChart"), stats.txChart14d);

    const blocksEl = $("#latestBlocks");
    if (blocksEl) {
      blocksEl.innerHTML = blocks.length
        ? blocks.map((b) => `
          <div class="row">
            <div class="ico-sm">▣</div>
            <div class="meta">
              <div class="top"><a class="num" href="#/block/${b.height}">${fmt(b.height)}</a><span class="ago">${timeAgo(b.timestamp)}</span></div>
              <div class="bot">Validated By <a href="#/validator/${encodeURIComponent(b.validator || "")}">${b.validator || "—"}</a> · ${b.txCount || 0} txns</div>
            </div>
            <span class="val-pill">${b.reward != null ? fmt(b.reward) + " ANTS" : "—"}</span>
          </div>`).join("")
        : emptyRows("No live blocks yet. Validators booting.", 6);
    }

    const txsEl = $("#latestTxs");
    if (txsEl) {
      txsEl.innerHTML = txs.length
        ? txs.map((t) => `
          <div class="row">
            <div class="ico-sm">≡</div>
            <div class="meta">
              <div class="top"><a class="num" href="#/tx/${t.hash}">${shortHash(t.hash)}</a><span class="ago">${timeAgo(t.timestamp)}</span></div>
              <div class="bot">From <a href="#/addr/${t.from}">${shortHash(t.from)}</a> · To <a href="#/addr/${t.to}">${shortHash(t.to)}</a></div>
            </div>
            <span class="val-pill">${t.valueAnts != null ? fmt(t.valueAnts) + " ANTS" : "—"}</span>
          </div>`).join("")
        : emptyRows("No live transactions yet.", 6);
    }
  }

  /* ── NFT renderer (nft.html) ──────────────────────── */
  async function renderNftScan() {
    if (!document.body.classList.contains("page-nft-scan")) return;
    let stats = {
      floorAnts: null,
      volume24hAnts: null,
      collections: null,
      totalNfts: null,
      activeListings: null,
      totalHolders: null,
      mintChart14d: Array.from({ length: 14 }, (_, i) => 0)
    };
    let mints = [];
    let sales = [];
    const [statsRes, mintsRes, salesRes] = await Promise.allSettled([
      fetchWithFallback("/api/nft/stats"),
      fetchWithFallback("/api/nft/latest-mints?limit=6"),
      fetchWithFallback("/api/nft/latest-sales?limit=6")
    ]);
    if (statsRes.status === "fulfilled" && statsRes.value) stats = Object.assign(stats, statsRes.value);
    if (mintsRes.status === "fulfilled" && Array.isArray(mintsRes.value)) mints = mintsRes.value;
    if (salesRes.status === "fulfilled" && Array.isArray(salesRes.value)) sales = salesRes.value;

    const setText = (sel, val) => { const el = $(sel); if (el) el.innerHTML = val; };
    setText("#nftStatFloor", stats.floorAnts != null ? fmt(stats.floorAnts) + ' <span class="sub">ANTS</span>' : "—");
    setText("#nftStatVolume", stats.volume24hAnts != null ? fmt(stats.volume24hAnts) + ' <span class="sub">ANTS / 24h</span>' : "—");
    setText("#nftStatCollections", stats.collections != null ? fmt(stats.collections) : "—");
    setText("#nftStatSupply", stats.totalNfts != null ? fmt(stats.totalNfts) + ' <span class="sub">NFTs</span>' : "—");
    setText("#nftStatListings", stats.activeListings != null ? fmt(stats.activeListings) + ' <span class="sub">live</span>' : "—");
    setText("#nftStatHolders", stats.totalHolders != null ? fmt(stats.totalHolders) + ' <span class="sub">wallets</span>' : "—");

    drawChart($("#nftChart"), stats.mintChart14d);

    const mintsEl = $("#latestMints");
    if (mintsEl) {
      mintsEl.innerHTML = mints.length
        ? mints.map((m) => `
          <div class="row">
            <div class="ico-sm">◈</div>
            <div class="meta">
              <div class="top"><a class="num" href="#/nft/${m.tokenId}">#${m.tokenId}</a><span class="ago">${timeAgo(m.timestamp)}</span></div>
              <div class="bot">${m.collection || "Public Proof"} · minted by <a href="#/addr/${m.minter}">${shortHash(m.minter)}</a></div>
            </div>
            <span class="val-pill">${m.priceAnts != null ? fmt(m.priceAnts) + " ANTS" : "Free"}</span>
          </div>`).join("")
        : emptyRows("No mints yet. First cashouts mint Profile NFTs.", 6);
    }

    const salesEl = $("#latestSales");
    if (salesEl) {
      salesEl.innerHTML = sales.length
        ? sales.map((s) => `
          <div class="row">
            <div class="ico-sm">⇄</div>
            <div class="meta">
              <div class="top"><a class="num" href="#/nft/${s.tokenId}">#${s.tokenId}</a><span class="ago">${timeAgo(s.timestamp)}</span></div>
              <div class="bot">${shortHash(s.seller)} → ${shortHash(s.buyer)}</div>
            </div>
            <span class="val-pill">${s.priceAnts != null ? fmt(s.priceAnts) + " ANTS" : "—"}</span>
          </div>`).join("")
        : emptyRows("No marketplace sales yet.", 6);
    }
  }

  function emptyRows(msg, count) {
    let out = "";
    for (let i = 0; i < count; i++) {
      out += `<div class="row">
        <div class="ico-sm">·</div>
        <div class="meta"><div class="top"><span class="skeleton" style="width:80px;">···</span></div><div class="bot">${i === 0 ? msg : '<span class="skeleton" style="width:60%;">···</span>'}</div></div>
        <span class="val-pill skeleton">···</span>
      </div>`;
    }
    return out;
  }

  /* ── Search handler ────────────────────────────────── */
  function bindSearch() {
    const form = $("#scanSearch");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = String($("#scanQuery").value || "").trim();
      const kind = String($("#scanFilter").value || "all");
      if (!q) return;
      // Route by best guess; backend resolver TBD.
      let target = "#/search?q=" + encodeURIComponent(q) + "&kind=" + kind;
      if (/^[0-9]+$/.test(q)) target = "#/block/" + q;
      else if (/^0x[0-9a-f]{64}$/i.test(q) || /^[0-9a-f]{64}$/i.test(q)) target = "#/tx/" + q;
      else if (/^anet1[a-z0-9]{20,}$/i.test(q)) target = "#/addr/" + q;
      location.hash = target;
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindSearch();
    renderMainnet();
    renderNftScan();
    // Auto-refresh every 15s so the explorer feels live without burning CPU.
    setInterval(() => { renderMainnet(); renderNftScan(); }, 15000);
  });
})();
