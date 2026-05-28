/* AnetScan — shared explorer JS (mainnet + nft) */
(function () {
  "use strict";

  // ── Data sources ────────────────────────────────────────────────────
  // Mainnet explorer reads the anet-chain JSON RPC DIRECTLY at
  // explorer.a-network.net. This is the actual chain node, so there is
  // no proxy hop and the data is real and live.
  // NFT explorer reads the pi-backend NFT routes when reachable.
  const CHAIN_NODE = "https://explorer.a-network.net";
  const NFT_API_BASES = ["https://api.a-network.net", "https://rmp-site.onrender.com", "https://pi-backend.onrender.com"];
  const API_TIMEOUT_MS = 6000;

  async function fetchJson(url, timeoutMs = API_TIMEOUT_MS) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        cache: "no-store",
        signal: ctl.signal,
        headers: { "accept": "application/json" }
      });
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (j && j.error) throw new Error(j.error);
      return j;
    } catch (e) { clearTimeout(t); throw e; }
  }

  async function fetchNftWithFallback(path) {
    let lastErr = null;
    for (const base of NFT_API_BASES) {
      try { return await fetchJson(base + path); }
      catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("nft api unavailable");
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

  /* ── Derive chain stats from a Block[] window ─────── */
  function deriveChainStats(blocks) {
    const stats = {
      price: { value: null, change24h: null },
      gasGwei: 0.001,
      transactions24h: 0,
      tps: null,
      latestBlock: { height: 0, timeSec: 0.5 },
      marketCapAnts: null,
      circulatingAnts: null,
      votingPowerAnet: null,
      txChart14d: Array(14).fill(0)
    };
    if (!Array.isArray(blocks) || !blocks.length) return stats;

    const dayMs = 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const startMs = nowMs - 14 * dayMs;

    let txs24h = 0;
    let activatedAnts = 0;
    for (const b of blocks) {
      const ts = b && b.epoch_end ? Date.parse(b.epoch_end) : NaN;
      const txCount = Array.isArray(b.transactions) ? b.transactions.length : 0;
      if (Number.isFinite(ts)) {
        if (nowMs - ts <= dayMs) txs24h += txCount;
        if (ts >= startMs) {
          const idx = Math.min(13, Math.max(0, Math.floor((ts - startMs) / dayMs)));
          stats.txChart14d[idx] += txCount;
        }
      }
      if (Number(b.activated_supply_ants) > activatedAnts) activatedAnts = Number(b.activated_supply_ants);
    }
    stats.transactions24h = txs24h;
    if (activatedAnts > 0) {
      stats.marketCapAnts = activatedAnts;
      stats.circulatingAnts = activatedAnts;
    }

    const latest = blocks[blocks.length - 1];
    stats.latestBlock.height = Number(latest.block_height || 0);

    if (blocks.length >= 2) {
      const tail = blocks.slice(-16);
      const gaps = [];
      let tailTxs = 0;
      for (let i = 0; i < tail.length; i++) {
        tailTxs += Array.isArray(tail[i].transactions) ? tail[i].transactions.length : 0;
        if (i === 0) continue;
        const a = Date.parse(tail[i - 1].epoch_end || tail[i - 1].epoch_start);
        const c = Date.parse(tail[i].epoch_end || tail[i].epoch_start);
        if (Number.isFinite(a) && Number.isFinite(c) && c > a) gaps.push((c - a) / 1000);
      }
      if (gaps.length) {
        const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        stats.latestBlock.timeSec = Number(avgGap.toFixed(2));
        if (avgGap > 0 && tail.length > 0) {
          const spanSec = avgGap * tail.length;
          stats.tps = Number((tailTxs / Math.max(spanSec, 1)).toFixed(2));
        }
      }
    }

    // Voting power proxy: count of distinct validators across the window.
    const validators = new Set();
    for (const b of blocks) {
      if (Array.isArray(b.miners)) for (const m of b.miners) validators.add(String(m));
    }
    if (validators.size > 0) stats.votingPowerAnet = validators.size;

    return stats;
  }

  /* ── Map raw Block[] -> Latest Blocks rows ────────── */
  function mapBlocks(blocks, limit) {
    if (!Array.isArray(blocks)) return [];
    const reversed = blocks.slice().reverse();
    const out = [];
    for (const b of reversed) {
      out.push({
        height: Number(b.block_height || 0),
        timestamp: b.epoch_end ? Math.floor(Date.parse(b.epoch_end) / 1000) : 0,
        validator: Array.isArray(b.miners) && b.miners.length ? String(b.miners[0]) : "",
        txCount: Array.isArray(b.transactions) ? b.transactions.length : 0,
        reward: b.total_fees_ants != null ? Number(b.total_fees_ants) : null,
        event: typeof b.block_event === "string" ? b.block_event : null
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /* ── Flatten Block[] -> Latest Transactions rows ──── */
  function mapTransactions(blocks, limit) {
    if (!Array.isArray(blocks)) return [];
    const reversed = blocks.slice().reverse();
    const out = [];
    for (const b of reversed) {
      const ts = b.epoch_end ? Math.floor(Date.parse(b.epoch_end) / 1000) : 0;
      const txs = Array.isArray(b.transactions) ? b.transactions : [];
      for (let i = txs.length - 1; i >= 0; i--) {
        const t = txs[i] || {};
        out.push({
          hash: String(t.hash || t.id || (`blk${b.block_height || 0}-${i}`)),
          timestamp: ts,
          from: String(t.from || t.sender || t.source || ""),
          to: String(t.to || t.recipient || t.destination || ""),
          valueAnts: t.amount_ants != null ? Number(t.amount_ants)
                    : (t.value_ants != null ? Number(t.value_ants)
                    : (t.amount != null ? Number(t.amount) : null))
        });
        if (out.length >= limit) break;
      }
      // Synthesize a row from block_event so the user sees real activity
      // even on blocks whose transactions[] is empty (the chain folds many
      // events into block_event today).
      if (txs.length === 0 && typeof b.block_event === "string" && b.block_event.length > 0) {
        out.push({
          hash: `blk${b.block_height || 0}`,
          timestamp: ts,
          from: "block event",
          to: b.block_event,
          valueAnts: null,
          isEvent: true
        });
      }
      if (out.length >= limit) break;
    }
    return out.slice(0, limit);
  }

  /* ── Mainnet renderer (scan.html) ──────────────────── */
  async function renderMainnet() {
    if (!document.body.classList.contains("page-scan")) return;
    let stats = demoStats();
    let blocksRaw = [];
    try {
      // ONE call to the chain node covers all three tiles. The chain returns
      // the latest window of blocks oldest-first.
      blocksRaw = await fetchJson(CHAIN_NODE + "/blocks?limit=64");
      if (!Array.isArray(blocksRaw)) blocksRaw = [];
    } catch (_) { blocksRaw = []; }

    if (blocksRaw.length) stats = Object.assign(stats, deriveChainStats(blocksRaw));
    const blocks = mapBlocks(blocksRaw, 6);
    const txs = mapTransactions(blocksRaw, 6);

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
      ? fmt(stats.votingPowerAnet) + ' <span class="sub">validators</span>'
      : "—");

    drawChart($("#txChart"), stats.txChart14d);

    const blocksEl = $("#latestBlocks");
    if (blocksEl) {
      blocksEl.innerHTML = blocks.length
        ? blocks.map((b) => `
          <div class="row">
            <div class="ico-sm">▣</div>
            <div class="meta">
              <div class="top"><a class="num" href="${CHAIN_NODE}/explorer/blocks/${b.height}" target="_blank" rel="noopener">${fmt(b.height)}</a><span class="ago">${timeAgo(b.timestamp)}</span></div>
              <div class="bot">Validated By <span title="${b.validator || ''}">${shortHash(b.validator, 10, 6) || "—"}</span> · ${b.txCount || 0} txns${b.event ? ` · <span style="color:var(--accent-3)">${b.event}</span>` : ""}</div>
            </div>
            <span class="val-pill">${b.reward != null ? fmt(b.reward) + " ANTS" : "0 ANTS"}</span>
          </div>`).join("")
        : emptyRows("Chain reachable but no blocks yet. Validators booting.", 6);
    }

    const txsEl = $("#latestTxs");
    if (txsEl) {
      txsEl.innerHTML = txs.length
        ? txs.map((t) => `
          <div class="row">
            <div class="ico-sm">${t.isEvent ? "★" : "≡"}</div>
            <div class="meta">
              <div class="top"><span class="num">${shortHash(t.hash)}</span><span class="ago">${timeAgo(t.timestamp)}</span></div>
              <div class="bot">${t.isEvent
                ? `<span style="color:var(--accent-3)">${t.to}</span>`
                : `From <span title="${t.from || ''}">${shortHash(t.from)}</span> · To <span title="${t.to || ''}">${shortHash(t.to)}</span>`}</div>
            </div>
            <span class="val-pill">${t.valueAnts != null ? fmt(t.valueAnts) + " ANTS" : (t.isEvent ? "event" : "0 ANTS")}</span>
          </div>`).join("")
        : emptyRows("No transactions in the recent block window.", 6);
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
      fetchNftWithFallback("/api/nft/stats"),
      fetchNftWithFallback("/api/nft/latest-mints?limit=6"),
      fetchNftWithFallback("/api/nft/latest-sales?limit=6")
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
