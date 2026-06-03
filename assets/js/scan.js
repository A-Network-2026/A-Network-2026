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

  // Real gas label for the closed-loop economy. Gas is paid in ANET, settled in
  // ANTS. Shows the recent average network fee per transaction (ANTS) when the
  // block window carried fee-bearing txs; otherwise the near-zero baseline.
  function gasLabel(stats) {
    if (stats && Number(stats.gasAnts) > 0) {
      return fmt(stats.gasAnts, 2) + " ANTS";
    }
    return "~0 ANTS";
  }

  /* ── Demo / fallback data ─────────────────────────── */
  function demoStats() {
    // Used until live api wires up. Conservative honest placeholders.
    return {
      price: { value: null, change24h: null },
      gasGwei: 0.001,
      gasAnts: 0,
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
      gasAnts: 0,
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
    let windowFeesAnts = 0;
    let windowTxs = 0;
    for (const b of blocks) {
      const ts = b && b.epoch_end ? Date.parse(b.epoch_end) : NaN;
      const txCount = Array.isArray(b.transactions) ? b.transactions.length : 0;
      windowFeesAnts += Number(b.total_fees_ants || 0);
      windowTxs += txCount;
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
    // Real gas tracker: average network fee per transaction (in ANTS) across
    // the recent block window. Falls back to the closed-loop minimum when the
    // window carried no fee-bearing transactions.
    if (windowTxs > 0 && windowFeesAnts > 0) {
      stats.gasAnts = windowFeesAnts / windowTxs;
    } else {
      stats.gasAnts = 0;
    }
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
          hash: String(t.tx_hash || t.hash || t.id || (`blk${b.block_height || 0}-${i}`)),
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

    // Rich, read-only validator directory (sessions, voting power, online
    // status, bootstrap-vs-organic). Optional — falls back to block-derived
    // signer list if the endpoint is unavailable.
    let validatorDir = null;
    try {
      const vd = await fetchJson(CHAIN_NODE + "/validators");
      if (vd && Array.isArray(vd.validators)) validatorDir = vd;
    } catch (_) { validatorDir = null; }

    if (blocksRaw.length) stats = Object.assign(stats, deriveChainStats(blocksRaw));
    const blocks = mapBlocks(blocksRaw, 6);
    const txs = mapTransactions(blocksRaw, 6);

    const priceEl = $("#anetPrice");
    if (priceEl) priceEl.innerHTML = stats.price && stats.price.value != null
      ? `<strong>${fmtUsd(stats.price.value)}</strong>` +
        (stats.price.change24h != null
          ? ` <span class="${stats.price.change24h >= 0 ? "up" : "down"}">(${stats.price.change24h >= 0 ? "+" : ""}${Number(stats.price.change24h).toFixed(2)}%)</span>`
          : "")
      : "<strong>—</strong>";

    const gasEl = $("#anetGas");
    if (gasEl) gasEl.innerHTML = `<strong>${gasLabel(stats)}</strong>`;

    const setText = (sel, val) => { const el = $(sel); if (el) el.innerHTML = val; };
    setText("#statPrice", stats.price && stats.price.value != null
      ? fmtUsd(stats.price.value) + (stats.price.change24h != null
          ? ` <span class="${stats.price.change24h >= 0 ? "up" : "down"}">(${stats.price.change24h >= 0 ? "+" : ""}${Number(stats.price.change24h).toFixed(2)}%)</span>`
          : "")
      : "—");
    setText("#statTxs", stats.transactions24h != null
      ? fmt(stats.transactions24h) + (stats.tps ? ` <span class="sub">(${Number(stats.tps).toFixed(1)} TPS)</span>` : "")
      : "—");
    setText("#statGas", gasLabel(stats) + ' <span class="sub">(&lt; $0.00001)</span>');
    setText("#statMcap", stats.marketCapAnts != null
      ? fmt(stats.marketCapAnts) + ' <span class="sub">ANTS</span>'
      : "—");
    setText("#statBlock", stats.latestBlock && stats.latestBlock.height
      ? fmt(stats.latestBlock.height) + ` <span class="sub">(${stats.latestBlock.timeSec || 0.5}s)</span>`
      : "—");
    setText("#statVoting", validatorDir
      ? fmt(validatorDir.total_eligible) + ` <span class="sub">validators${validatorDir.online_count ? ` · ${fmt(validatorDir.online_count)} online` : ""}</span>`
      : (stats.votingPowerAnet != null
          ? fmt(stats.votingPowerAnet) + ' <span class="sub">validators</span>'
          : "—"));

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

    // ── Validators panel (id="validators" anchor) ──
    const valsEl = $("#latestValidators");
    if (valsEl) {
      if (validatorDir && validatorDir.validators.length) {
        // Real, on-chain eligible validator set with live status.
        const retired = validatorDir.bootstrap_retired === true;
        const sunsetPill = retired
          ? `<span class="val-pill" style="color:var(--accent-2,#6ae7b1)">bootstrap retired · fully organic</span>`
          : `<span class="val-pill">${fmt(validatorDir.bootstrap_count)} bootstrap</span>`;
        const summary = `
          <div class="val-summary" style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px;">
            <span class="val-pill">${fmt(validatorDir.total_eligible)} eligible</span>
            <span class="val-pill">${fmt(validatorDir.online_count)} online</span>
            ${sunsetPill}
            <span class="val-pill">${fmt(validatorDir.organic_count)} organic</span>
            <span class="val-pill">cap ${fmt(validatorDir.max_validators)}</span>
          </div>`;
        const rows = validatorDir.validators.slice(0, 12).map((v) => {
          const power = (Number(v.voting_power_bps || 0) / 100).toFixed(2);
          const tag = v.is_bootstrap
            ? `<span style="color:var(--accent-3)">bootstrap</span>`
            : `<span style="color:var(--muted)">organic</span>`;
          const dot = v.online ? "#6ae7b1" : "#e76a6a";
          const statusLabel = v.online
            ? "online"
            : (v.last_seen_at ? "offline" : "no heartbeat");
          const seen = v.last_seen_at
            ? timeAgo(Math.floor(Date.parse(v.last_seen_at) / 1000))
            : "—";
          return `
          <div class="row">
            <div class="ico-sm">#${v.rank}</div>
            <div class="meta">
              <div class="top">
                <span class="num" title="${v.address}">${shortHash(v.address, 12, 8)}</span>
                <span class="ago"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dot};margin-right:5px;"></span>${statusLabel} · ${seen}</span>
              </div>
              <div class="bot">${tag} · ${fmt(v.sessions)} sessions · ${power}% voting power</div>
            </div>
            <span class="val-pill">${v.eligible ? "eligible" : "—"}</span>
          </div>`;
        }).join("");
        valsEl.innerHTML = summary + rows;
      } else {
        // Fallback: derive a best-effort signer list from the block window.
        const validators = new Map();
        for (const b of blocksRaw) {
          const ts = b && b.epoch_end ? Math.floor(Date.parse(b.epoch_end) / 1000) : 0;
          if (Array.isArray(b.miners)) {
            for (const m of b.miners) {
              const key = String(m);
              const prev = validators.get(key) || { blocks: 0, lastSeen: 0 };
              prev.blocks += 1;
              if (ts > prev.lastSeen) prev.lastSeen = ts;
              validators.set(key, prev);
            }
          }
        }
        const sorted = Array.from(validators.entries())
          .sort((a, b) => b[1].blocks - a[1].blocks)
          .slice(0, 8);
        valsEl.innerHTML = sorted.length
          ? sorted.map(([addr, v], i) => `
            <div class="row">
              <div class="ico-sm">#${i + 1}</div>
              <div class="meta">
                <div class="top"><span class="num" title="${addr}">${shortHash(addr, 12, 8)}</span><span class="ago">${timeAgo(v.lastSeen)}</span></div>
                <div class="bot">${v.blocks} block${v.blocks === 1 ? "" : "s"} signed in last window</div>
              </div>
              <span class="val-pill">active</span>
            </div>`).join("")
          : emptyRows("Validator set warming up.", 4);
      }
    }

    // ── Tokens panel: ANTS circulating supply ──
    const antsSupplyEl = $("#tokenAnetSupply");
    if (antsSupplyEl) {
      antsSupplyEl.textContent = stats.circulatingAnts != null
        ? fmt(stats.circulatingAnts) + " ANTS"
        : "—";
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

  // Escape user-controlled text before putting it in innerHTML.
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function isoToUnix(iso) {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }

  function showSearchPanel(title, html) {
    const panel = $("#scanResults");
    const body = $("#scanResultsBody");
    const titleEl = $("#scanResultsTitle");
    if (!panel || !body) return;
    if (titleEl) titleEl.textContent = title;
    body.innerHTML = html;
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function searchError(msg) {
    return `<p class="lbl" style="color:var(--muted);padding:8px 0;">${esc(msg)}</p>`;
  }

  function renderAccountResult(acc) {
    const addr = esc(acc.address);
    const validator = acc.is_validator
      ? `<span class="val-pill" style="color:var(--accent-2,#6ae7b1)">validator</span>`
      : `<span class="val-pill">not a validator</span>`;
    return `
      <div class="row">
        <div class="ico-sm">A</div>
        <div class="meta">
          <div class="top"><span class="num" title="${addr}">${addr}</span></div>
          <div class="bot">Account · ${esc(acc.sessions)} sessions</div>
        </div>
        ${validator}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">
        <span class="val-pill">${esc(acc.anet_balance)} ANET</span>
        <span class="val-pill">${fmt(acc.ants_balance)} ANTS</span>
      </div>`;
  }

  function renderBlockResult(b) {
    const height = Number(b.block_height || 0);
    const ts = isoToUnix(b.epoch_end || b.epoch_start);
    const txs = Array.isArray(b.transactions) ? b.transactions : [];
    const miners = Array.isArray(b.miners) ? b.miners.length : 0;
    const rows = txs.slice(0, 12).map((t) => {
      const hash = String(t.tx_hash || t.hash || "—");
      return `
        <div class="row">
          <div class="meta">
            <div class="top"><span class="num" title="${esc(hash)}">${esc(shortHash(hash, 14, 8))}</span></div>
            <div class="bot">${esc(shortHash(t.from, 10, 6))} → ${esc(shortHash(t.to, 10, 6))}</div>
          </div>
          <span class="val-pill">${t.amount_ants != null ? fmt(t.amount_ants) + " ANTS" : "—"}</span>
        </div>`;
    }).join("");
    return `
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
        <span class="val-pill">block #${fmt(height)}</span>
        <span class="val-pill">${timeAgo(ts)}</span>
        <span class="val-pill">${txs.length} txns</span>
        <span class="val-pill">${miners} validators</span>
        <span class="val-pill">${fmt(b.total_fees_ants || 0)} ANTS fees</span>
      </div>
      <div class="bot" style="word-break:break-all;margin-bottom:10px;">hash: ${esc(b.hash || "—")}</div>
      ${rows || searchError("This block carried no individual transactions.")}`;
  }

  function renderTxResult(t, blockHeight) {
    const hash = String(t.tx_hash || t.hash || "—");
    return `
      <div class="bot" style="word-break:break-all;margin-bottom:10px;">hash: ${esc(hash)}</div>
      <div class="row">
        <div class="meta">
          <div class="top"><span class="num">${esc(shortHash(t.from, 14, 8))} → ${esc(shortHash(t.to, 14, 8))}</span></div>
          <div class="bot">in block #${fmt(blockHeight)} · ${esc(t.tx_type || "transfer")}</div>
        </div>
        <span class="val-pill">${t.amount_ants != null ? fmt(t.amount_ants) + " ANTS" : "—"}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">
        <span class="val-pill">fee ${fmt(t.fee_ants || 0)} ANTS</span>
        <span class="val-pill">nonce ${esc(t.nonce != null ? t.nonce : "—")}</span>
        ${t.memo ? `<span class="val-pill">memo: ${esc(t.memo)}</span>` : ""}
      </div>`;
  }

  async function lookupAccount(addr) {
    try { return await fetchJson(CHAIN_NODE + "/accounts/" + encodeURIComponent(addr)); }
    catch (_) { return null; }
  }
  async function lookupBlockByHeight(h) {
    try { return await fetchJson(CHAIN_NODE + "/blocks/height/" + encodeURIComponent(h)); }
    catch (_) { return null; }
  }
  async function lookupBlockByHash(h) {
    try { return await fetchJson(CHAIN_NODE + "/blocks/" + encodeURIComponent(h)); }
    catch (_) { return null; }
  }
  // No direct tx-by-hash endpoint on the chain node yet, so scan the recent
  // block window for a matching transaction hash.
  async function lookupTxByHash(h) {
    let blocks = [];
    try { blocks = await fetchJson(CHAIN_NODE + "/blocks?limit=256"); }
    catch (_) { return null; }
    if (!Array.isArray(blocks)) return null;
    const needle = String(h).toLowerCase();
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      const txs = Array.isArray(b.transactions) ? b.transactions : [];
      for (const t of txs) {
        const th = String(t.tx_hash || t.hash || "").toLowerCase();
        if (th && th === needle) return { tx: t, height: Number(b.block_height || 0) };
      }
    }
    return null;
  }

  async function runSearch(q, kind) {
    showSearchPanel("Searching…", searchError(`Looking up “${q}” …`));

    const raw = q.trim();
    const upper = raw.toUpperCase();
    const isNumber = /^[0-9]+$/.test(raw);
    const hashCandidate = raw.replace(/^0x/i, "");
    const isHash = /^[0-9a-f]{64}$/i.test(hashCandidate);
    const isAddress = /^ANET[0-9A-F]{20,60}$/i.test(raw);

    // Explicit filter selections.
    if (kind === "address" || kind === "validator") {
      const acc = await lookupAccount(upper);
      return acc
        ? showSearchPanel("Account " + shortHash(upper, 10, 6), renderAccountResult(acc))
        : showSearchPanel("Not found", searchError(`No account found for “${raw}”.`));
    }
    if (kind === "block") {
      const b = isNumber ? await lookupBlockByHeight(raw) : await lookupBlockByHash(hashCandidate);
      return b
        ? showSearchPanel("Block #" + fmt(Number(b.block_height || 0)), renderBlockResult(b))
        : showSearchPanel("Not found", searchError(`No block found for “${raw}”.`));
    }
    if (kind === "tx") {
      const hit = await lookupTxByHash(hashCandidate);
      return hit
        ? showSearchPanel("Transaction", renderTxResult(hit.tx, hit.height))
        : showSearchPanel("Not found", searchError(`No transaction found for “${raw}” in the recent block window.`));
    }
    if (kind === "token" || kind === "nft") {
      return showSearchPanel("Not yet on-chain", searchError(
        "Token & NFT lookup ships with the Token Factory (Phase 4). For NFTs, use the NFT explorer."));
    }

    // "All filters" — auto-detect by shape.
    if (isNumber) {
      const b = await lookupBlockByHeight(raw);
      if (b) return showSearchPanel("Block #" + fmt(Number(b.block_height || 0)), renderBlockResult(b));
      return showSearchPanel("Not found", searchError(`No block at height ${raw}.`));
    }
    if (isAddress) {
      const acc = await lookupAccount(upper);
      if (acc) return showSearchPanel("Account " + shortHash(upper, 10, 6), renderAccountResult(acc));
      return showSearchPanel("Not found", searchError(`No account found for “${raw}”.`));
    }
    if (isHash) {
      // Could be a block hash or a transaction hash — try block first.
      const b = await lookupBlockByHash(hashCandidate);
      if (b) return showSearchPanel("Block #" + fmt(Number(b.block_height || 0)), renderBlockResult(b));
      const hit = await lookupTxByHash(hashCandidate);
      if (hit) return showSearchPanel("Transaction", renderTxResult(hit.tx, hit.height));
      return showSearchPanel("Not found", searchError(`No block or transaction matches “${raw}”.`));
    }

    // Last resort: try it as an account address.
    const acc = await lookupAccount(upper);
    if (acc) return showSearchPanel("Account " + shortHash(upper, 10, 6), renderAccountResult(acc));
    return showSearchPanel("Not found", searchError(
      `“${raw}” doesn't look like a block height, address, or transaction hash.`));
  }

  function bindSearch() {
    const form = $("#scanSearch");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = String($("#scanQuery").value || "").trim();
      const kind = String($("#scanFilter") && $("#scanFilter").value || "all");
      if (!q) return;
      runSearch(q, kind).catch((err) => {
        showSearchPanel("Search error", searchError(
          "Something went wrong reaching the chain node. Please try again."));
        if (window.console) console.warn("search failed", err);
      });
    });
    const closeBtn = $("#scanResultsClose");
    if (closeBtn) closeBtn.addEventListener("click", () => {
      const panel = $("#scanResults");
      if (panel) panel.hidden = true;
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
