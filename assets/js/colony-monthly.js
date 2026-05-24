/**
 * Monthly Active Colony Snapshot
 * ─────────────────────────────────────────────────────────────────────────
 * Standalone module for ants-program.html → #monthly-snapshot section.
 *
 * Behavior:
 *  - Polls https://explorer.a-network.net/stats/investor (same as the live
 *    Colony Progress Tracker) every 60s while the page is open.
 *  - Buckets samples into per-UTC-day rows: { day: 'YYYY-MM-DD',
 *    owners: { [ownerCode]: { mining, members, rooms, colonyName } } }.
 *  - Persists to localStorage under key  anet_colony_monthly_v1_<YYYY-MM>.
 *  - On every load + every poll, checks UTC month; if current month differs
 *    from the latest stored month, the old month is renamed to
 *    anet_colony_monthly_v1_archive_<YYYY-MM> (oldest 6 archives kept).
 *  - Renders an SVG line graph: one line per owner / referral code,
 *    x = days of month, y = chosen metric (mining / members / rooms).
 *  - Renders a leaderboard table ranked by peak mining strength.
 *
 * Storage is per-browser. This is a presentation-layer snapshot, not the
 * canonical source of truth; the canonical source remains the L1 chain.
 */
(function () {
  'use strict';

  const CHAIN_API = 'https://explorer.a-network.net';
  const STATS_ENDPOINT = '/stats/investor';
  const STORAGE_PREFIX = 'anet_colony_monthly_v1_';
  const ARCHIVE_PREFIX = 'anet_colony_monthly_v1_archive_';
  const STATIC_PREFIX = 'data/colony-monthly-';   // canonical: written daily by GitHub Action
  const STATIC_LOOKBACK_MONTHS = 6;
  const MAX_ARCHIVES = 6;
  const POLL_MS = 60_000;
  // Tracks which canonical month files we found, so the View dropdown can
  // surface them as selectable archives.
  const staticArchives = new Set();
  const COLORS = [
    '#6ce7b1', '#58c5ff', '#ffca6e', '#ff8aa3', '#c79bff',
    '#7fd1ff', '#9be07f', '#ffb56b', '#ff7a99', '#a288ff',
    '#5ed4d4', '#e8c66b', '#ff9a6b', '#8de8c8', '#7c9eff',
    '#ffa8e0', '#b5e870', '#ffd486', '#74dca8', '#9ec5ff',
  ];

  const $ = (id) => document.getElementById(id);

  const els = {
    status: $('cm-status'),
    period: $('cm-period-label'),
    countdown: $('cm-reset-countdown'),
    ownerCount: $('cm-owner-count'),
    colonyCount: $('cm-colony-count'),
    sampleCount: $('cm-sample-count'),
    peakMining: $('cm-peak-mining'),
    viewSelect: $('cm-view-select'),
    metricSelect: $('cm-metric-select'),
    topnSelect: $('cm-topn-select'),
    refreshBtn: $('cm-refresh-btn'),
    chart: $('cm-chart'),
    chartWrap: $('cm-chart-wrap'),
    legend: $('cm-legend'),
    empty: $('cm-empty'),
    tooltip: $('cm-tooltip'),
    boardBody: $('cm-board-body'),
  };

  if (!els.chart || !els.boardBody) return; // section not on this page

  const state = {
    selectedPeriod: 'current',         // 'current' | 'static_YYYY-MM' | 'archive_YYYY-MM'
    metric: 'mining',                  // 'mining' | 'members' | 'rooms'
    topN: 10,
    snapshots: { month: monthKey(new Date()), days: {} },
    staticMonths: {},                  // YYYY-MM -> snapshot loaded from /data
    canonicalLoaded: false,            // true once we've successfully merged the static JSON
  };

  /* ── time helpers ───────────────────────────────────────────────────── */

  function monthKey(d) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  function dayKey(d) {
    return `${monthKey(d)}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  function nextMonthStartUTC(now) {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0);
  }
  function daysInMonth(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function formatCountdown(ms) {
    if (ms <= 0) return '0d 0h 0m';
    const total = Math.floor(ms / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  }
  function formatMonthLabel(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, 1));
    return dt.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) + ' (UTC)';
  }
  function formatNumber(n) {
    if (!Number.isFinite(n)) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }
  function safeInt(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }

  /* ── storage ────────────────────────────────────────────────────────── */

  function loadSnapshot(monthStr, isArchive = false) {
    try {
      const key = (isArchive ? ARCHIVE_PREFIX : STORAGE_PREFIX) + monthStr;
      const raw = localStorage.getItem(key);
      if (!raw) return { month: monthStr, days: {} };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.days) {
        return { month: monthStr, days: {} };
      }
      return { month: monthStr, days: parsed.days };
    } catch (_) {
      return { month: monthStr, days: {} };
    }
  }

  function saveCurrent() {
    try {
      const key = STORAGE_PREFIX + state.snapshots.month;
      localStorage.setItem(key, JSON.stringify(state.snapshots));
    } catch (_) { /* quota / private mode */ }
  }

  function archiveAndReset(now) {
    const oldMonth = state.snapshots.month;
    const currentMonth = monthKey(now);
    if (oldMonth === currentMonth) return false;

    // Move current → archive
    try {
      const oldKey = STORAGE_PREFIX + oldMonth;
      const oldRaw = localStorage.getItem(oldKey);
      if (oldRaw) {
        localStorage.setItem(ARCHIVE_PREFIX + oldMonth, oldRaw);
        localStorage.removeItem(oldKey);
      }
    } catch (_) { /* ignore */ }

    // Trim archives down to MAX_ARCHIVES (keep newest)
    try {
      const archives = listArchiveMonths();
      const excess = archives.length - MAX_ARCHIVES;
      if (excess > 0) {
        archives.slice(0, excess).forEach((m) => {
          try { localStorage.removeItem(ARCHIVE_PREFIX + m); } catch (_) {}
        });
      }
    } catch (_) {}

    state.snapshots = { month: currentMonth, days: {} };
    saveCurrent();
    return true;
  }

  function listArchiveMonths() {
    const out = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ARCHIVE_PREFIX)) {
        out.push(k.substring(ARCHIVE_PREFIX.length));
      }
    }
    return out.sort(); // ascending YYYY-MM
  }

  /* ── fetch + ingest ─────────────────────────────────────────────────── */

  async function fetchStats() {
    const url = `${CHAIN_API}${STATS_ENDPOINT}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Try multiple field-shape candidates for the owner code / referral code.
   * The backend may serve it under different keys depending on version.
   */
  function extractOwnerCode(row) {
    return String(
      row?.owner_code
        || row?.ownerCode
        || row?.ant_code
        || row?.antCode
        || row?.referral_code
        || row?.referralCode
        || row?.owner
        || ''
    ).trim();
  }

  function ingest(payload) {
    const rows = Array.isArray(payload?.rooms) ? payload.rooms
      : Array.isArray(payload?.colonies) ? payload.colonies
      : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload) ? payload
      : [];

    if (!rows.length) return false;

    const now = new Date();
    if (archiveAndReset(now)) {
      // freshly reset → state.snapshots is now empty for new month
    }

    const today = dayKey(now);
    const byOwner = {};

    rows.forEach((row) => {
      const ownerCode = extractOwnerCode(row);
      if (!ownerCode) return;
      const mining = safeInt(row?.active_chat_ants);
      const members = safeInt(row?.member_count || row?.members || row?.tracked_members || row?.active_chat_ants);
      const rooms = safeInt(row?.room_count || row?.rooms || 1, 1);
      const colonyName = String(row?.room_name || row?.colony || ownerCode).trim();

      // If same owner has multiple rooms in the payload, take their max mining row
      const prev = byOwner[ownerCode];
      if (!prev || mining > prev.mining) {
        byOwner[ownerCode] = { mining, members, rooms, colonyName };
      } else {
        prev.rooms = Math.max(prev.rooms, rooms);
      }
    });

    if (!Object.keys(byOwner).length) return false;

    // Merge today's bucket: keep the daily MAX per owner (peak of that day)
    const todayBucket = state.snapshots.days[today] || { owners: {}, sampleCount: 0 };
    Object.entries(byOwner).forEach(([code, snap]) => {
      const prev = todayBucket.owners[code];
      if (!prev) {
        todayBucket.owners[code] = { ...snap };
      } else {
        todayBucket.owners[code] = {
          mining: Math.max(prev.mining, snap.mining),
          members: Math.max(prev.members, snap.members),
          rooms: Math.max(prev.rooms, snap.rooms),
          colonyName: snap.colonyName || prev.colonyName,
        };
      }
    });
    todayBucket.sampleCount = (todayBucket.sampleCount || 0) + 1;
    todayBucket.lastSampleAt = now.toISOString();
    state.snapshots.days[today] = todayBucket;

    saveCurrent();
    return true;
  }

  /* ── aggregation for rendering ──────────────────────────────────────── */

  function activeSnapshotForView() {
    if (state.selectedPeriod === 'current') return state.snapshots;
    if (state.selectedPeriod.startsWith('static_')) {
      const m = state.selectedPeriod.substring('static_'.length);
      return state.staticMonths[m] || { month: m, days: {} };
    }
    if (state.selectedPeriod.startsWith('archive_')) {
      const m = state.selectedPeriod.substring('archive_'.length);
      return loadSnapshot(m, true);
    }
    return state.snapshots;
  }

  function computeOwnerAggregates(snapshot) {
    const totalDaysInMonth = daysInMonth(snapshot.month);
    const owners = {};
    Object.entries(snapshot.days).forEach(([day, bucket]) => {
      const dayNum = Number(day.split('-')[2]);
      Object.entries(bucket.owners || {}).forEach(([code, snap]) => {
        if (!owners[code]) {
          owners[code] = {
            code,
            colonyName: snap.colonyName,
            series: new Array(totalDaysInMonth).fill(null),
            peak: 0,
            sum: 0,
            daysActive: 0,
          };
        }
        const o = owners[code];
        const val = state.metric === 'members' ? snap.members
                  : state.metric === 'rooms' ? snap.rooms
                  : snap.mining;
        o.series[dayNum - 1] = val;
        if (snap.mining > o.peak) o.peak = snap.mining;
        o.sum += snap.mining;
        o.daysActive += 1;
        if (snap.colonyName && !o.colonyName) o.colonyName = snap.colonyName;
      });
    });
    return Object.values(owners);
  }

  function totalSamples(snapshot) {
    return Object.values(snapshot.days).reduce(
      (acc, b) => acc + (b.sampleCount || 0), 0,
    );
  }
  function totalColonies(owners) {
    const set = new Set();
    owners.forEach((o) => { if (o.colonyName) set.add(o.colonyName); });
    return set.size;
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  function renderMeta(snapshot, owners) {
    if (els.period) els.period.textContent = formatMonthLabel(snapshot.month);
    if (els.ownerCount) els.ownerCount.textContent = formatNumber(owners.length);
    if (els.colonyCount) els.colonyCount.textContent = formatNumber(totalColonies(owners));
    if (els.sampleCount) els.sampleCount.textContent = formatNumber(totalSamples(snapshot));
    const peak = owners.reduce((m, o) => Math.max(m, o.peak), 0);
    if (els.peakMining) els.peakMining.textContent = formatNumber(peak);

    if (els.countdown && state.selectedPeriod === 'current') {
      const now = new Date();
      els.countdown.textContent = formatCountdown(nextMonthStartUTC(now) - now.getTime());
    } else if (els.countdown) {
      els.countdown.textContent = 'archived';
    }
  }

  function renderViewSelect() {
    if (!els.viewSelect) return;
    const currentMonth = monthKey(new Date());
    const localArchives = listArchiveMonths().slice().reverse(); // newest first
    const staticMonths = Array.from(staticArchives)
      .filter((m) => m !== currentMonth) // current month is already shown as "live"
      .sort().reverse();
    const current = state.selectedPeriod;
    const opts = ['<option value="current">Current Month (live)</option>']
      .concat(staticMonths.map((m) => `<option value="static_${m}">${formatMonthLabel(m)} · official</option>`))
      .concat(localArchives
        .filter((m) => !staticArchives.has(m))
        .map((m) => `<option value="archive_${m}">${formatMonthLabel(m)} · local archive</option>`));
    els.viewSelect.innerHTML = opts.join('');
    // Restore selection if still present, else fall back to current.
    if ([...els.viewSelect.options].some((o) => o.value === current)) {
      els.viewSelect.value = current;
    } else {
      els.viewSelect.value = 'current';
      state.selectedPeriod = 'current';
    }
  }

  function renderLeaderboard(owners) {
    if (!els.boardBody) return;
    if (!owners.length) {
      els.boardBody.innerHTML = '<tr><td colspan="6" class="cm-empty">No owner activity recorded yet for this month.</td></tr>';
      return;
    }
    const ranked = owners.slice().sort((a, b) => b.peak - a.peak).slice(0, 50);
    els.boardBody.innerHTML = ranked.map((o, i) => {
      const avg = o.daysActive ? Math.round(o.sum / o.daysActive) : 0;
      const rankClass = i < 3 ? ` class="cm-rank-${i + 1}"` : '';
      return `<tr${rankClass}>
        <td>${i + 1}</td>
        <td>${escapeHtml(o.code)}</td>
        <td>${escapeHtml(o.colonyName || '—')}</td>
        <td class="cm-num">${formatNumber(o.peak)}</td>
        <td class="cm-num">${formatNumber(avg)}</td>
        <td class="cm-num">${o.daysActive}</td>
      </tr>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderChart(snapshot, ownersAll) {
    if (!els.chart) return;
    const totalDays = daysInMonth(snapshot.month);
    const owners = ownersAll.slice().sort((a, b) => b.peak - a.peak).slice(0, state.topN);

    // Clear
    while (els.chart.firstChild) els.chart.removeChild(els.chart.firstChild);
    if (els.legend) els.legend.innerHTML = '';

    const hasData = owners.some((o) => o.series.some((v) => v != null));
    if (els.empty) els.empty.hidden = hasData;
    if (!hasData) return;

    const W = 800, H = 360;
    const PAD_L = 44, PAD_R = 14, PAD_T = 14, PAD_B = 28;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;

    // Y-axis max across the chosen metric
    let maxY = 1;
    owners.forEach((o) => o.series.forEach((v) => { if (v != null && v > maxY) maxY = v; }));
    const yMax = niceCeil(maxY);

    // Background grid
    const NS = 'http://www.w3.org/2000/svg';
    const grid = document.createElementNS(NS, 'g');
    for (let i = 0; i <= 4; i += 1) {
      const y = PAD_T + (innerH * i) / 4;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', PAD_L); line.setAttribute('x2', W - PAD_R);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      line.setAttribute('stroke', 'rgba(255,255,255,0.06)');
      line.setAttribute('stroke-width', '1');
      grid.appendChild(line);
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', 6); label.setAttribute('y', y + 4);
      label.setAttribute('fill', '#6b7686');
      label.setAttribute('font-size', '10');
      label.setAttribute('font-family', 'Space Grotesk, sans-serif');
      label.textContent = formatNumber(yMax - (yMax * i) / 4);
      grid.appendChild(label);
    }
    // X-axis day ticks
    const tickEvery = totalDays > 20 ? 5 : 2;
    for (let d = 1; d <= totalDays; d += 1) {
      if (d !== 1 && d !== totalDays && d % tickEvery !== 0) continue;
      const x = PAD_L + ((d - 1) / Math.max(1, totalDays - 1)) * innerW;
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', H - 8);
      t.setAttribute('fill', '#6b7686');
      t.setAttribute('font-size', '10');
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-family', 'Space Grotesk, sans-serif');
      t.textContent = String(d);
      grid.appendChild(t);
    }
    els.chart.appendChild(grid);

    // Lines
    owners.forEach((owner, idx) => {
      const color = COLORS[idx % COLORS.length];
      const pts = [];
      owner.series.forEach((v, i) => {
        if (v == null) return;
        const x = PAD_L + (i / Math.max(1, totalDays - 1)) * innerW;
        const y = PAD_T + innerH - (v / yMax) * innerH;
        pts.push([x, y, i + 1, v]);
      });
      if (!pts.length) return;
      // Path
      const path = document.createElementNS(NS, 'path');
      const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '1.8');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('stroke-linecap', 'round');
      els.chart.appendChild(path);
      // Dots with tooltip
      pts.forEach(([x, y, day, val]) => {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', '3');
        c.setAttribute('fill', color);
        c.setAttribute('data-owner', owner.code);
        c.setAttribute('data-day', day);
        c.setAttribute('data-val', val);
        c.style.cursor = 'pointer';
        c.addEventListener('mouseenter', onDotEnter);
        c.addEventListener('mouseleave', onDotLeave);
        els.chart.appendChild(c);
      });
      // Legend entry
      if (els.legend) {
        const span = document.createElement('span');
        span.innerHTML = `<span class="cm-swatch" style="background:${color}"></span>${escapeHtml(owner.code)} · ${escapeHtml(owner.colonyName || '—')}`;
        els.legend.appendChild(span);
      }
    });
  }

  function onDotEnter(ev) {
    const t = els.tooltip;
    if (!t) return;
    const owner = ev.target.getAttribute('data-owner');
    const day = ev.target.getAttribute('data-day');
    const val = ev.target.getAttribute('data-val');
    t.innerHTML = `<strong>${escapeHtml(owner)}</strong><br/>Day ${day} · ${formatNumber(Number(val))}`;
    const wrapRect = els.chartWrap.getBoundingClientRect();
    const dotRect = ev.target.getBoundingClientRect();
    t.style.left = `${dotRect.left - wrapRect.left + dotRect.width / 2}px`;
    t.style.top = `${dotRect.top - wrapRect.top}px`;
    t.classList.add('is-on');
  }
  function onDotLeave() {
    if (els.tooltip) els.tooltip.classList.remove('is-on');
  }

  function niceCeil(n) {
    if (n <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(n)));
    const norm = n / mag;
    const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return nice * mag;
  }

  /* ── orchestration ──────────────────────────────────────────────────── */

  function renderAll() {
    const snap = activeSnapshotForView();
    const owners = computeOwnerAggregates(snap);
    renderViewSelect();
    renderMeta(snap, owners);
    renderChart(snap, owners);
    renderLeaderboard(owners);
  }

  function setStatus(text, tone) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.style.color = tone === 'err' ? '#ff7a99' : tone === 'ok' ? 'var(--accent)' : '#cbd5e1';
  }

  /**
   * Loads the canonical static snapshot file for a given month, if present.
   * Returns the parsed snapshot or null on miss.
   */
  async function loadStaticMonth(monthStr) {
    try {
      const res = await fetch(`${STATIC_PREFIX}${monthStr}.json`, { cache: 'no-cache' });
      if (!res.ok) return null;
      const parsed = await res.json();
      if (!parsed || !parsed.days) return null;
      return { month: monthStr, days: parsed.days };
    } catch (_) {
      return null;
    }
  }

  /**
   * Discovers up to STATIC_LOOKBACK_MONTHS of canonical snapshots and merges
   * the current month into state.snapshots so the chart shows the same
   * numbers everyone else sees.
   */
  async function loadCanonical() {
    const now = new Date();
    const current = monthKey(now);
    const months = [];
    for (let i = 0; i < STATIC_LOOKBACK_MONTHS; i += 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push(monthKey(d));
    }
    const results = await Promise.all(months.map((m) => loadStaticMonth(m).then((s) => [m, s])));
    let merged = false;
    results.forEach(([m, snap]) => {
      if (!snap) return;
      staticArchives.add(m);
      state.staticMonths[m] = snap;
      if (m === current) {
        // Overlay canonical days onto our in-memory current snapshot.
        // Canonical wins; localStorage adds nothing new on top.
        state.snapshots = { month: current, days: { ...snap.days } };
        merged = true;
      }
    });
    state.canonicalLoaded = merged;
  }

  async function tick() {
    try {
      setStatus('Fetching…');
      // 1. Always try to refresh the canonical static JSON (cheap, cached).
      await loadCanonical();
      // 2. Then fetch live upstream and merge into local cache. If canonical
      //    is present, it already holds today's row; the live fetch just
      //    keeps the in-browser bucket warm between Action runs.
      const data = await fetchStats();
      const got = ingest(data);
      const tone = state.canonicalLoaded ? 'ok' : (got ? 'ok' : 'err');
      const label = state.canonicalLoaded
        ? `Canonical · updated ${new Date().toLocaleTimeString()}`
        : got ? `Local-only · ${new Date().toLocaleTimeString()}` : 'No rows in payload';
      setStatus(label, tone);
      renderAll();
    } catch (err) {
      setStatus(`Offline · ${err.message}`, 'err');
      renderAll();
    }
  }

  function bindControls() {
    if (els.viewSelect) {
      els.viewSelect.addEventListener('change', (e) => {
        state.selectedPeriod = e.target.value;
        renderAll();
      });
    }
    if (els.metricSelect) {
      els.metricSelect.addEventListener('change', (e) => {
        state.metric = e.target.value;
        renderAll();
      });
    }
    if (els.topnSelect) {
      els.topnSelect.addEventListener('change', (e) => {
        state.topN = Math.max(1, Math.min(50, Number(e.target.value) || 10));
        renderAll();
      });
    }
    if (els.refreshBtn) {
      els.refreshBtn.addEventListener('click', () => tick());
    }
  }

  function init() {
    // Boot: load current month from storage, then archive-check
    state.snapshots = loadSnapshot(monthKey(new Date()), false);
    archiveAndReset(new Date());
    bindControls();
    renderAll();
    tick();
    setInterval(tick, POLL_MS);
    // Countdown refresh
    setInterval(() => {
      if (state.selectedPeriod === 'current' && els.countdown) {
        const now = new Date();
        els.countdown.textContent = formatCountdown(nextMonthStartUTC(now) - now.getTime());
      }
    }, 30_000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
