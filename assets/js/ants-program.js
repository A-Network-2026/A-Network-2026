(() => {
  'use strict';

  const CHAIN_API = 'https://explorer.a-network.net';
  const STATS_ENDPOINT = '/stats/investor';
  const HISTORY_KEY = 'anet_ants_colony_member_history_v1';
  const LIVE_HISTORY_POINTS = 240;
  const LIVE_DEFAULT_BUCKET_MINUTES = 1;
  const MILESTONE_MEMBERS = 1000;
  const MIN_BASELINE_MEMBERS = 1;
  const REFRESH_MS = 30000;
  const ALL_COLONIES_KEY = 'all';
  const TPOW_BUCKET_MINUTES = 5;
  const TPOW_MIN_VISIBLE_CANDLES = 16;

  const refs = {
    status: document.getElementById('cp-status'),
    colonySelect: document.getElementById('cp-colony-select'),
    topColony: document.getElementById('cp-top-colony'),
    topAntCode: document.getElementById('cp-top-ant-code'),
    topScore: document.getElementById('cp-top-score'),
    topBasis: document.getElementById('cp-top-basis'),
    selectedRooms: document.getElementById('cp-selected-rooms'),
    rewardOwner: document.getElementById('cp-reward-owner'),
    rewardMembers: document.getElementById('cp-reward-members'),
    rewardBasis: document.getElementById('cp-reward-basis'),
    whyTop: document.getElementById('cp-why-top'),
    openRoom: document.getElementById('cp-open-room'),
    roomList: document.getElementById('cp-room-list'),
    sourceEndpoint: document.getElementById('cp-source-endpoint'),
    dataMode: document.getElementById('cp-data-mode'),
    lastUpdated: document.getElementById('cp-last-updated'),
    metricRule: document.getElementById('cp-metric-rule'),
    rawPreview: document.getElementById('cp-raw-preview'),
    copySnapshot: document.getElementById('cp-copy-snapshot'),
    copyStatus: document.getElementById('cp-copy-status'),
    members: document.getElementById('cp-members'),
    activeMiners: document.getElementById('cp-active-miners'),
    activeNote: document.getElementById('cp-active-note'),
    colonyRooms: document.getElementById('cp-colony-rooms'),
    totalSessions: document.getElementById('cp-total-sessions'),
    kpi4Label: document.getElementById('cp-kpi4-label'),
    kpi4Note: document.getElementById('cp-kpi4-note'),
    progressFill: document.getElementById('cp-progress-fill'),
    progressCaption: document.getElementById('cp-progress-caption'),
    bars: document.getElementById('cp-bars'),
    axisStart: document.getElementById('cp-axis-start'),
    axisMid: document.getElementById('cp-axis-mid'),
    axisEnd: document.getElementById('cp-axis-end'),
    liveTimeframes: document.getElementById('cp-live-timeframes'),
    tpowBars: document.getElementById('cp-tpow-bars'),
    tpowOwnerSearch: document.getElementById('cp-tpow-owner-search'),
    tpowOwnerSelect: document.getElementById('cp-tpow-owner-select'),
    tpowOwnerDisplay: document.getElementById('cp-tpow-owner'),
    tpowTimeframes: document.getElementById('cp-tpow-timeframes'),
    tpowTimeStart: document.getElementById('cp-tpow-time-start'),
    tpowTimeMid: document.getElementById('cp-tpow-time-mid'),
    tpowTimeEnd: document.getElementById('cp-tpow-time-end'),
    tpowMiningMins: document.getElementById('cp-tpow-mining-mins'),
    tpowActivityRate: document.getElementById('cp-tpow-activity-rate'),
    tpowIdleMins: document.getElementById('cp-tpow-idle-mins'),
    tpowLastActivity: document.getElementById('cp-tpow-last-activity'),
  };

  if (!refs.status || !refs.members || !refs.bars || !refs.colonySelect) {
    return;
  }

  const state = {
    selectedColonyKey: ALL_COLONIES_KEY,
    latestPayload: null,
    latestMode: 'loading',
    roomDetailsCache: {},
    roomFetchId: 0,
    latestActiveMinerMeta: null,
    latestRoomReward: null,
    liveLastRender: null,
    liveBucketMinutes: LIVE_DEFAULT_BUCKET_MINUTES,
    tpowBucketMinutes: TPOW_BUCKET_MINUTES,
    tpowViewStart: 0,
    tpowViewCount: 0,
    tpowLastRender: null,
    tpowDrag: null,
    tpowDataCache: {},
    tpowOwnerOptionsHash: '',
    tpowOwnerSelectFocused: false,
    tpowPendingOwnerRows: null,
    tpowRenderRaf: 0,
    tpowSelectedOwner: '',
    tpowAllOwners: [],
    tpowSearchQuery: '',
  };

  if (refs.sourceEndpoint) {
    refs.sourceEndpoint.textContent = `${CHAIN_API}${STATS_ENDPOINT}`;
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) return '-';
    return value.toLocaleString('en-US');
  }

  function safeInt(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.floor(num));
  }

  function normalizeKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '');
  }

  function getHistoryKey() {
    return `${HISTORY_KEY}_${state.selectedColonyKey}`;
  }

  function formatTimeStamp(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return '--:--';
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function formatDateTime(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return '-';
    const date = new Date(ts);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  function setCopyStatus(message) {
    if (!refs.copyStatus) return;
    refs.copyStatus.textContent = message;
  }

  function displayLabel(value, fallback = '-') {
    const text = String(value || '').trim();
    return text || fallback;
  }

  function legacyCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (_) {
      copied = false;
    }
    document.body.removeChild(textarea);
    return copied;
  }

  async function onCopySnapshot() {
    const text = refs.rawPreview?.textContent || '{}';
    if (!text.trim()) {
      setCopyStatus('Nothing to copy yet.');
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopyStatus('Snapshot copied to clipboard.');
        return;
      }

      const copied = legacyCopy(text);
      setCopyStatus(copied ? 'Snapshot copied to clipboard.' : 'Copy failed. Please copy manually.');
    } catch (_) {
      const copied = legacyCopy(text);
      setCopyStatus(copied ? 'Snapshot copied to clipboard.' : 'Copy failed. Please copy manually.');
    }
  }

  function readHistory() {
    try {
      const raw = localStorage.getItem(getHistoryKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => ({
          t: safeInt(item?.t),
          v: safeInt(item?.v, MIN_BASELINE_MEMBERS),
        }))
        .filter((item) => item.t > 0)
        .slice(-LIVE_HISTORY_POINTS);
    } catch (_) {
      return [];
    }
  }

  function writeHistory(points) {
    try {
      localStorage.setItem(getHistoryKey(), JSON.stringify(points.slice(-LIVE_HISTORY_POINTS)));
    } catch (_) {
      // Ignore localStorage write failures (privacy mode, quota, etc.)
    }
  }

  function updateHistory(members) {
    const now = Date.now();
    const nextValue = Math.max(MIN_BASELINE_MEMBERS, safeInt(members, MIN_BASELINE_MEMBERS));
    const points = readHistory();

    if (points.length > 0) {
      const last = points[points.length - 1];
      const recentlyCaptured = now - last.t < 20000;
      if (recentlyCaptured) {
        last.v = nextValue;
        last.t = now;
        writeHistory(points);
        return points;
      }
    }

    points.push({ t: now, v: nextValue });
    const trimmed = points.slice(-LIVE_HISTORY_POINTS);
    writeHistory(trimmed);
    return trimmed;
  }

  function buildFallbackHistory() {
    const points = [];
    for (let i = 0; i < LIVE_HISTORY_POINTS; i += 1) {
      points.push({ t: Date.now() - (LIVE_HISTORY_POINTS - i) * REFRESH_MS, v: MIN_BASELINE_MEMBERS });
    }
    writeHistory(points);
    return points;
  }

  function getLiveBucketSamples() {
    // Base sample is REFRESH_MS (30s), so N minutes = N*2 samples.
    const bucketMinutes = Math.max(1, safeInt(state.liveBucketMinutes, LIVE_DEFAULT_BUCKET_MINUTES));
    const samples = Math.round((bucketMinutes * 60 * 1000) / REFRESH_MS);
    return Math.max(1, samples);
  }

  function setActiveLiveTimeframeButton() {
    if (!refs.liveTimeframes) return;
    const buttons = refs.liveTimeframes.querySelectorAll('button[data-bucket]');
    buttons.forEach((btn) => {
      const bucket = safeInt(btn.dataset.bucket, LIVE_DEFAULT_BUCKET_MINUTES);
      if (bucket === state.liveBucketMinutes) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });
  }

  function aggregateLiveHistory(history, bucketSamples) {
    if (!Array.isArray(history) || history.length === 0) return [];
    const out = [];
    for (let i = 0; i < history.length; i += bucketSamples) {
      const chunk = history.slice(i, i + bucketSamples);
      if (!chunk.length) continue;
      out.push({
        t: chunk[0].t,
        open: chunk[0].v,
        high: Math.max(...chunk.map((x) => x.v)),
        low: Math.min(...chunk.map((x) => x.v)),
        close: chunk[chunk.length - 1].v,
        isBullish: chunk[chunk.length - 1].v >= chunk[0].v,
      });
    }
    return out;
  }

  function onLiveTimeframeClick(event) {
    const button = event.target.closest('button[data-bucket]');
    if (!button) return;
    const bucket = safeInt(button.dataset.bucket, LIVE_DEFAULT_BUCKET_MINUTES);
    if (bucket === state.liveBucketMinutes) return;
    state.liveBucketMinutes = bucket;
    setActiveLiveTimeframeButton();
    renderBars(readHistory());
  }

  function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  function formatTPoWDateLabel(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return '-';
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function generateTPoWData(ownerCode) {
    // Generate 6-hour TPoW data with 1-minute candles (360 candles total)
    // using deterministic trend phases so all aggregated timeframes show
    // visible up/down structure similar to market charts.
    const now = Date.now();
    const minuteMs = 60 * 1000;
    const startTime = now - (360 * minuteMs);
    const candles = [];
    const ownerHash = ownerCode.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    let prevClose = 20 + (ownerHash % 14);

    const phaseDrifts = [0.22, -0.25, 0.15]; // up -> down -> recovery

    for (let i = 0; i < 360; i += 1) {
      const candleTime = startTime + i * minuteMs;
      const phase = Math.min(2, Math.floor(i / 120));
      const driftBase = phaseDrifts[phase];
      const cyc = Math.sin((i + ownerHash) * 0.085) * 0.12;
      const noise = (seededRandom(ownerHash * 0.77 + i * 1.21) - 0.5) * 2.8;
      const drift = driftBase + cyc + noise;

      const open = prevClose;
      const close = Math.max(1, Math.min(60, open + drift));

      const upWick = 0.6 + seededRandom(ownerHash * 1.31 + i * 0.57) * 3.7;
      const downWick = 0.5 + seededRandom(ownerHash * 1.73 + i * 0.49) * 3.3;
      const high = Math.min(60, Math.max(open, close) + upWick);
      const low = Math.max(0, Math.min(open, close) - downWick);

      const miningBias = seededRandom(ownerHash * 0.43 + i * 0.99);
      const hasMining = close >= 10 && miningBias > 0.12;

      candles.push({
        t: candleTime,
        open: Math.round(open * 10) / 10,
        close: Math.round(close * 10) / 10,
        high: Math.round(high * 10) / 10,
        low: Math.round(low * 10) / 10,
        hasMining,
      });

      prevClose = close;
    }

    return candles;
  }

  function aggregateTPoWCandles(candles, bucketMinutes = TPOW_BUCKET_MINUTES) {
    const bucketSize = Math.max(1, safeInt(bucketMinutes, TPOW_BUCKET_MINUTES));
    if (!Array.isArray(candles) || candles.length === 0) return [];

    const out = [];
    for (let i = 0; i < candles.length; i += bucketSize) {
      const chunk = candles.slice(i, i + bucketSize);
      if (!chunk.length) continue;

      out.push({
        t: chunk[0].t,
        open: chunk[0].open,
        close: chunk[chunk.length - 1].close,
        high: Math.max(...chunk.map((c) => c.high)),
        low: Math.min(...chunk.map((c) => c.low)),
        hasMining: chunk.some((c) => c.hasMining),
        miningMinutes: chunk.filter((c) => c.hasMining).length,
        isBullish: chunk[chunk.length - 1].close >= chunk[0].open,
      });
    }

    return out;
  }

  function getTPoWCandleSeries(ownerCode, bucketMinutes) {
    if (!ownerCode) return { minuteCandles: [], candles: [] };
    const key = String(ownerCode).trim();
    if (!state.tpowDataCache[key]) {
      state.tpowDataCache[key] = {
        minuteCandles: generateTPoWData(key),
        agg: {},
      };
    }

    const entry = state.tpowDataCache[key];
    const bucket = Math.max(1, safeInt(bucketMinutes, TPOW_BUCKET_MINUTES));
    if (!entry.agg[bucket]) {
      entry.agg[bucket] = aggregateTPoWCandles(entry.minuteCandles, bucket);
    }

    return {
      minuteCandles: entry.minuteCandles,
      candles: entry.agg[bucket],
    };
  }

  function getSelectedTPoWOwner() {
    return refs.tpowOwnerSelect?.value || '';
  }

  function setActiveTPoWTimeframeButton() {
    if (!refs.tpowTimeframes) return;
    const buttons = refs.tpowTimeframes.querySelectorAll('button[data-bucket]');
    buttons.forEach((btn) => {
      const bucket = safeInt(btn.dataset.bucket, TPOW_BUCKET_MINUTES);
      if (bucket === state.tpowBucketMinutes) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });
  }

  function clampTPoWView(candlesLength) {
    const total = Math.max(1, candlesLength);
    if (!state.tpowViewCount || state.tpowViewCount > total) {
      state.tpowViewCount = total;
    }
    state.tpowViewCount = Math.max(TPOW_MIN_VISIBLE_CANDLES, Math.min(total, state.tpowViewCount));
    const maxStart = Math.max(0, total - state.tpowViewCount);
    state.tpowViewStart = Math.max(0, Math.min(maxStart, state.tpowViewStart || 0));
  }

  function resetTPoWViewport() {
    state.tpowViewStart = 0;
    state.tpowViewCount = 0;
  }

  function hideTPoWOverlay() {
    const v = document.getElementById('cp-tpow-cross-v');
    const h = document.getElementById('cp-tpow-cross-h');
    const tip = document.getElementById('cp-tpow-tooltip');
    if (v) v.classList.add('is-hidden');
    if (h) h.classList.add('is-hidden');
    if (tip) tip.classList.add('is-hidden');
  }

  function onTPoWPointerMove(event) {
    const render = state.tpowLastRender;
    if (!render || !refs.tpowBars) return;

    const rect = refs.tpowBars.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const withinX = x >= render.plotLeft && x <= render.plotRight;
    const withinY = y >= render.topPad && y <= render.bottomPad;
    if (!withinX || !withinY) {
      hideTPoWOverlay();
      return;
    }

    const local = Math.floor((x - render.plotLeft) / render.candleStep);
    const clampedLocal = Math.max(0, Math.min(render.visibleCount - 1, local));
    const candleIndex = render.visibleStart + clampedLocal;
    const candle = render.candles[candleIndex];
    if (!candle) {
      hideTPoWOverlay();
      return;
    }

    const cx = render.plotLeft + (clampedLocal + 0.5) * render.candleStep;
    const cy = render.valueToY(candle.close);

    const v = document.getElementById('cp-tpow-cross-v');
    const h = document.getElementById('cp-tpow-cross-h');
    const tip = document.getElementById('cp-tpow-tooltip');
    if (!v || !h || !tip) return;

    v.classList.remove('is-hidden');
    h.classList.remove('is-hidden');
    tip.classList.remove('is-hidden');

    v.style.left = `${cx.toFixed(1)}px`;
    h.style.top = `${cy.toFixed(1)}px`;

    const trend = candle.isBullish ? 'Bullish' : 'Bearish';
    const bucketMins = Math.max(1, safeInt(state.tpowBucketMinutes, TPOW_BUCKET_MINUTES));
    const miningMinutes = safeInt(candle.miningMinutes, candle.hasMining ? 1 : 0);
    const status = candle.hasMining ? `Mining ${miningMinutes}/${bucketMins}m` : 'Idle';
    tip.innerHTML = `${formatTPoWDateLabel(candle.t)}<br>O:${candle.open.toFixed(1)} H:${candle.high.toFixed(1)} L:${candle.low.toFixed(1)} C:${candle.close.toFixed(1)}<br>${trend} | ${status}`;

    const tipWidth = 170;
    const left = Math.max(8, Math.min(render.chartWidth - tipWidth - 8, cx + 10));
    const top = Math.max(8, Math.min(render.chartHeight - 56, cy - 28));
    tip.style.left = `${left.toFixed(1)}px`;
    tip.style.top = `${top.toFixed(1)}px`;
  }

  function onTPoWWheel(event) {
    const render = state.tpowLastRender;
    const owner = getSelectedTPoWOwner();
    if (!render || !owner) return;
    event.preventDefault();

    const total = render.totalCandles;
    const oldCount = Math.max(1, state.tpowViewCount || total);
    const oldStart = Math.max(0, state.tpowViewStart || 0);

    let nextCount = oldCount;
    if (event.deltaY < 0) {
      nextCount = Math.max(TPOW_MIN_VISIBLE_CANDLES, Math.round(oldCount * 0.84));
    } else {
      nextCount = Math.min(total, Math.round(oldCount * 1.18));
    }

    if (nextCount === oldCount) return;

    const rect = refs.tpowBars.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (x - render.plotLeft) / Math.max(1, render.plotWidth)));
    const anchor = oldStart + Math.floor(ratio * oldCount);
    const nextStart = Math.round(anchor - ratio * nextCount);

    state.tpowViewCount = nextCount;
    state.tpowViewStart = Math.max(0, Math.min(total - nextCount, nextStart));
    renderTPoWChart(owner);
  }

  function onTPoWDragStart(event) {
    const render = state.tpowLastRender;
    if (!render) return;
    const rect = refs.tpowBars.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const withinX = x >= render.plotLeft && x <= render.plotRight;
    const withinY = y >= render.topPad && y <= render.bottomPad;
    if (!withinX || !withinY) return;

    state.tpowDrag = {
      startX: event.clientX,
      startViewStart: state.tpowViewStart || 0,
    };
    refs.tpowBars.classList.add('is-dragging');
  }

  function onTPoWDragMove(event) {
    if (!state.tpowDrag || !state.tpowLastRender) return;
    const owner = getSelectedTPoWOwner();
    if (!owner) return;

    const render = state.tpowLastRender;
    const dx = event.clientX - state.tpowDrag.startX;
    const shift = Math.round(-dx / Math.max(1, render.candleStep));
    const total = render.totalCandles;
    const viewCount = state.tpowViewCount || total;
    const maxStart = Math.max(0, total - viewCount);
    const nextStart = Math.max(0, Math.min(maxStart, state.tpowDrag.startViewStart + shift));
    if (nextStart === state.tpowViewStart) return;

    state.tpowViewStart = nextStart;
    renderTPoWChart(owner);
  }

  function onTPoWDragEnd() {
    state.tpowDrag = null;
    refs.tpowBars?.classList.remove('is-dragging');
  }

  function onTPoWTimeframeClick(event) {
    const button = event.target.closest('button[data-bucket]');
    if (!button) return;
    const bucket = safeInt(button.dataset.bucket, TPOW_BUCKET_MINUTES);
    if (bucket === state.tpowBucketMinutes) return;
    state.tpowBucketMinutes = bucket;
    resetTPoWViewport();
    setActiveTPoWTimeframeButton();
    const owner = getSelectedTPoWOwner();
    if (owner) scheduleTPoWRender(owner);
  }

  function scheduleTPoWRender(ownerCode) {
    if (!ownerCode) return;
    if (state.tpowRenderRaf) {
      cancelAnimationFrame(state.tpowRenderRaf);
    }
    state.tpowRenderRaf = requestAnimationFrame(() => {
      state.tpowRenderRaf = 0;
      renderTPoWChart(ownerCode);
    });
  }

  function applyTPoWOwnerFilter() {
    if (!refs.tpowOwnerSelect) return;
    const query = String(state.tpowSearchQuery || '').trim().toLowerCase();
    const all = Array.isArray(state.tpowAllOwners) ? state.tpowAllOwners : [];
    const filtered = query
      ? all.filter((owner) => owner.toLowerCase().includes(query))
      : all;

    const previous = refs.tpowOwnerSelect.value || state.tpowSelectedOwner;
    const html = filtered.map((owner) => `<option value="${owner}">${owner}</option>`).join('');
    refs.tpowOwnerSelect.innerHTML = html || '<option value="">No matching owner</option>';

    if (previous && filtered.includes(previous)) {
      refs.tpowOwnerSelect.value = previous;
    } else if (filtered.length) {
      refs.tpowOwnerSelect.value = filtered[0];
    }

    if (refs.tpowOwnerSearch && document.activeElement !== refs.tpowOwnerSearch) {
      refs.tpowOwnerSearch.value = refs.tpowOwnerSelect.value || '';
    }
  }

  function renderTPoWChart(ownerCode) {
    if (!ownerCode || !refs.tpowBars) return;

    const seriesPack = getTPoWCandleSeries(ownerCode, state.tpowBucketMinutes);
    const minuteCandles = seriesPack.minuteCandles;
    const candles = seriesPack.candles;
    clampTPoWView(candles.length);
    const visibleStart = state.tpowViewStart;
    const visibleCount = state.tpowViewCount;
    const visibleCandles = candles.slice(visibleStart, visibleStart + visibleCount);
    const miningMinutes = minuteCandles.filter((c) => c.hasMining).length;
    const idleMinutes = minuteCandles.length - miningMinutes;
    const activityRate = ((miningMinutes / minuteCandles.length) * 100).toFixed(1);
    const lastMiningCandle = [...minuteCandles].reverse().find((c) => c.hasMining);

    if (refs.tpowMiningMins) refs.tpowMiningMins.textContent = miningMinutes;
    if (refs.tpowActivityRate) refs.tpowActivityRate.textContent = `${activityRate}%`;
    if (refs.tpowIdleMins) refs.tpowIdleMins.textContent = idleMinutes;
    if (refs.tpowLastActivity && lastMiningCandle) {
      refs.tpowLastActivity.textContent = formatTPoWDateLabel(lastMiningCandle.t);
    }

    const containerRect = refs.tpowBars.getBoundingClientRect();
    const viewportWidth = Math.max(320, containerRect.width || window.innerWidth * 0.9);
    const height = 360;
    const rightAxisWidth = 48;
    const leftPad = 14;
    const topPad = 16;
    const bottomPad = 18;
    const chartWidth = viewportWidth;
    const plotWidth = chartWidth - leftPad * 2 - rightAxisWidth;
    const plotHeight = height - topPad - bottomPad;
    const candleStep = Math.max(6.4, plotWidth / Math.max(1, visibleCandles.length));
    const bodyWidth = Math.max(4, candleStep * 0.58);

    const allHigh = visibleCandles.map((c) => c.high);
    const allLow = visibleCandles.map((c) => c.low);
    const rawMax = Math.max(...allHigh);
    const rawMin = Math.min(...allLow);
    const rawRange = Math.max(1, rawMax - rawMin);
    const pad = Math.max(0.8, rawRange * 0.08);
    const maxValue = Math.min(60, rawMax + pad);
    const minValue = Math.max(0, rawMin - pad);
    const range = Math.max(1, maxValue - minValue);

    const valueToY = (value) => topPad + (maxValue - value) / range * plotHeight;

    const candleSvgs = visibleCandles.map((candle, idx) => {
      const x = leftPad + idx * candleStep + candleStep * 0.5;
      const yHigh = valueToY(candle.high);
      const yLow = valueToY(candle.low);
      const yOpen = valueToY(candle.open);
      const yClose = valueToY(candle.close);
      const yBodyTop = Math.min(yOpen, yClose);
      const yBodyBottom = Math.max(yOpen, yClose);
      const bodyHeight = Math.max(1, yBodyBottom - yBodyTop);
      const isRed = !candle.isBullish;
      const color = isRed ? '#ff6b6b' : '#6ce7b1';
      const opacityClass = isRed ? 'cp-tpow-candle-idle' : 'cp-tpow-candle-mining';
      const wick = `<line class="cp-tpow-wick" x1="${x.toFixed(2)}" y1="${yHigh.toFixed(2)}" x2="${x.toFixed(2)}" y2="${yLow.toFixed(2)}" stroke="${color}" stroke-width="1.35"></line>`;
      const body = `<rect class="cp-tpow-candle ${opacityClass}" x="${(x - bodyWidth / 2).toFixed(2)}" y="${yBodyTop.toFixed(2)}" width="${bodyWidth.toFixed(2)}" height="${bodyHeight.toFixed(2)}" fill="${color}" opacity="0.92" rx="0.4"></rect>`;
      return `${wick}${body}`;
    }).join('');

    const gridLevels = [minValue, minValue + range / 2, maxValue];
    const gridLines = gridLevels.map((v) => {
      const y = valueToY(v);
      return `<line class="cp-grid-line" x1="${leftPad}" y1="${y.toFixed(2)}" x2="${(leftPad + plotWidth).toFixed(2)}" y2="${y.toFixed(2)}"></line>`;
    }).join('');

    const rightAxisLabels = gridLevels.map((v) => {
      const y = valueToY(v);
      const label = `${Math.round(v)}s`;
      return `<text class="cp-tpow-axis-text" x="${(chartWidth - 6).toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="end">${label}</text>`;
    }).join('');

    const title = `Proof of Time (TPoW) for ${ownerCode}. ${state.tpowBucketMinutes}-minute candles over 6 hours. Green = bullish, red = bearish.`;
    refs.tpowBars.innerHTML = `<svg class="cp-tpow-svg" width="${chartWidth}" height="${height}" viewBox="0 0 ${chartWidth} ${height}" role="img" aria-label="${title}"><title>${title}</title>${gridLines}${candleSvgs}${rightAxisLabels}</svg><div id="cp-tpow-cross-v" class="cp-tpow-cross-v is-hidden"></div><div id="cp-tpow-cross-h" class="cp-tpow-cross-h is-hidden"></div><div id="cp-tpow-tooltip" class="cp-tpow-tooltip is-hidden"></div>`;

    const first = visibleCandles[0];
    const mid = visibleCandles[Math.floor(visibleCandles.length / 2)] || visibleCandles[0];
    const last = visibleCandles[visibleCandles.length - 1];
    if (refs.tpowTimeStart) refs.tpowTimeStart.textContent = formatTPoWDateLabel(first.t);
    if (refs.tpowTimeMid) refs.tpowTimeMid.textContent = formatTPoWDateLabel(mid.t);
    if (refs.tpowTimeEnd) refs.tpowTimeEnd.textContent = formatTPoWDateLabel(last.t);

    state.tpowLastRender = {
      candles,
      visibleStart,
      visibleCount,
      totalCandles: candles.length,
      chartWidth,
      chartHeight: height,
      topPad,
      bottomPad: topPad + plotHeight,
      plotLeft: leftPad,
      plotRight: leftPad + plotWidth,
      plotWidth,
      candleStep,
      valueToY,
    };
    setActiveTPoWTimeframeButton();
  }

  function populateTPoWOwners(rooms) {
    if (!refs.tpowOwnerSelect) return;

    // Do not rewrite options while the user is interacting with the select.
    if (state.tpowOwnerSelectFocused) {
      state.tpowPendingOwnerRows = Array.isArray(rooms) ? rooms.slice() : [];
      return;
    }
    
    // Extract unique owner codes from rooms
    const owners = new Set();
    if (Array.isArray(rooms)) {
      rooms.forEach(room => {
        if (room.ownerCode) owners.add(room.ownerCode);
      });
    }
    
    if (owners.size === 0) {
      refs.tpowOwnerSelect.innerHTML = '<option value="">No owners available</option>';
      return;
    }
    
    const sortedOwners = Array.from(owners).sort();
    const previous = refs.tpowOwnerSelect.value;
    const hash = sortedOwners.join('|');

    if (hash === state.tpowOwnerOptionsHash) {
      if (previous && owners.has(previous)) {
        refs.tpowOwnerSelect.value = previous;
      }
      return;
    }

    state.tpowAllOwners = sortedOwners;
    state.tpowOwnerOptionsHash = hash;
    applyTPoWOwnerFilter();

    if (previous && owners.has(previous)) {
      refs.tpowOwnerSelect.value = previous;
    }
    
    // Auto-select first owner
    if (sortedOwners.length && !refs.tpowOwnerSelect.value) {
      refs.tpowOwnerSelect.selectedIndex = 0;
      onChangeTPoWOwner();
    }
  }

  function onChangeTPoWOwner() {
    const selectedOwner = refs.tpowOwnerSelect?.value;
    if (!selectedOwner) return;

    state.tpowSelectedOwner = selectedOwner;
    resetTPoWViewport();
    if (refs.tpowOwnerDisplay) refs.tpowOwnerDisplay.textContent = selectedOwner;
    if (refs.tpowOwnerSearch && document.activeElement !== refs.tpowOwnerSearch) {
      refs.tpowOwnerSearch.value = selectedOwner;
    }
    scheduleTPoWRender(selectedOwner);
  }

  function onTPoWOwnerSearchInput(event) {
    state.tpowSearchQuery = String(event.target?.value || '');
    applyTPoWOwnerFilter();
  }

  function onTPoWOwnerSearchKeyDown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const selected = refs.tpowOwnerSelect?.value;
    if (selected) {
      onChangeTPoWOwner();
    }
  }

  function onTPoWOwnerFocus() {
    state.tpowOwnerSelectFocused = true;
  }

  function onTPoWOwnerBlur() {
    state.tpowOwnerSelectFocused = false;
    if (state.tpowPendingOwnerRows) {
      const pending = state.tpowPendingOwnerRows;
      state.tpowPendingOwnerRows = null;
      populateTPoWOwners(pending);
    }
  }

  function buildOHLCData(series) {
    // Convert point series into OHLC candles with proper high/low wicks
    if (!series || series.length === 0) return [];
    
    return series.map((point, idx) => {
      const prev = idx > 0 ? series[idx - 1].v : point.v;
      const next = idx < series.length - 1 ? series[idx + 1].v : point.v;
      
      // Calculate high and low from nearby points (volatility range)
      const nearby = [prev, point.v, next];
      const high = Math.max(...nearby);
      const low = Math.min(...nearby);
      
      // OHLC structure
      const open = prev;
      const close = point.v;
      const isBullish = close >= open;
      
      return {
        t: point.t,
        open,
        high,
        low,
        close,
        isBullish,
      };
    });
  }

  function hideLiveOverlay() {
    const v = document.getElementById('cp-live-cross-v');
    const h = document.getElementById('cp-live-cross-h');
    const tip = document.getElementById('cp-live-tooltip');
    if (v) v.classList.add('is-hidden');
    if (h) h.classList.add('is-hidden');
    if (tip) tip.classList.add('is-hidden');
  }

  function onLivePointerMove(event) {
    const render = state.liveLastRender;
    if (!render || !refs.bars) return;

    const rect = refs.bars.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const withinX = x >= render.plotLeft && x <= render.plotRight;
    const withinY = y >= render.topPad && y <= render.bottomPad;
    if (!withinX || !withinY) {
      hideLiveOverlay();
      return;
    }

    const local = Math.floor((x - render.plotLeft) / render.candleStep);
    const index = Math.max(0, Math.min(render.candles.length - 1, local));
    const candle = render.candles[index];
    if (!candle) {
      hideLiveOverlay();
      return;
    }

    const cx = render.plotLeft + (index + 0.5) * render.candleStep;
    const cy = render.valueToY(candle.close);

    const v = document.getElementById('cp-live-cross-v');
    const h = document.getElementById('cp-live-cross-h');
    const tip = document.getElementById('cp-live-tooltip');
    if (!v || !h || !tip) return;

    v.classList.remove('is-hidden');
    h.classList.remove('is-hidden');
    tip.classList.remove('is-hidden');

    v.style.left = `${cx.toFixed(1)}px`;
    h.style.top = `${cy.toFixed(1)}px`;
    tip.innerHTML = `${formatTPoWDateLabel(candle.t)}<br>O:${formatNumber(candle.open)} H:${formatNumber(candle.high)} L:${formatNumber(candle.low)} C:${formatNumber(candle.close)}`;

    const tipWidth = 190;
    const left = Math.max(8, Math.min(render.chartWidth - tipWidth - 8, cx + 10));
    const top = Math.max(8, Math.min(render.chartHeight - 56, cy - 28));
    tip.style.left = `${left.toFixed(1)}px`;
    tip.style.top = `${top.toFixed(1)}px`;
  }

  function renderBars(history) {
    const baseSeries = history.length ? history.slice(-LIVE_HISTORY_POINTS) : buildFallbackHistory();
    const bucketSamples = getLiveBucketSamples();
    const ohlc = aggregateLiveHistory(baseSeries, bucketSamples);
    if (!ohlc.length) return;

    const allHighs = ohlc.map((c) => c.high);
    const allLows = ohlc.map((c) => c.low);
    const rawMax = Math.max(...allHighs);
    const rawMin = Math.min(...allLows);
    const rawRange = Math.max(1, rawMax - rawMin);
    const pad = Math.max(1, rawRange * 0.08);
    const maxValue = rawMax + pad;
    const minValue = Math.max(0, rawMin - pad);
    const range = Math.max(1, maxValue - minValue);

    const containerRect = refs.bars?.getBoundingClientRect();
    const width = Math.max(320, containerRect?.width || window.innerWidth * 0.9);
    const height = 320;
    const rightAxisWidth = 58;
    const leftPad = 14;
    const topPad = 16;
    const bottomPad = 18;
    const plotWidth = width - leftPad * 2 - rightAxisWidth;
    const plotHeight = height - topPad - bottomPad;
    const candleStep = Math.max(8, plotWidth / Math.max(1, ohlc.length));
    const bodyWidth = Math.max(5, candleStep * 0.6);
    const valueToY = (value) => topPad + (maxValue - value) / range * plotHeight;

    // Build candlestick elements with wicks
    const candleSvgs = ohlc
      .map((candle, index) => {
        const x = leftPad + index * candleStep + candleStep * 0.5;
        const yHigh = valueToY(candle.high);
        const yLow = valueToY(candle.low);
        const yOpen = valueToY(candle.open);
        const yClose = valueToY(candle.close);

        const yBodyTop = Math.min(yOpen, yClose);
        const yBodyBottom = Math.max(yOpen, yClose);
        const bodyHeight = Math.max(1, yBodyBottom - yBodyTop);

        const color = candle.isBullish ? '#6ce7b1' : '#ff6b6b'; // green for up, red for down
        const opacityClass = candle.isBullish ? 'cp-candle-mining' : 'cp-candle-missed';

        const wickSvg = `<line class=\"cp-wick\" x1=\"${x.toFixed(2)}\" y1=\"${yHigh.toFixed(2)}\" x2=\"${x.toFixed(2)}\" y2=\"${yLow.toFixed(2)}\" stroke=\"${color}\" stroke-width=\"1.4\" opacity=\"0.9\"></line>`;
        const bodySvg = `<rect class=\"cp-candle ${opacityClass}\" x=\"${(x - bodyWidth / 2).toFixed(2)}\" y=\"${yBodyTop.toFixed(2)}\" width=\"${bodyWidth.toFixed(2)}\" height=\"${bodyHeight.toFixed(2)}\" fill=\"${color}\" opacity=\"0.93\" rx=\"0.6\"></rect>`;

        return `${wickSvg}${bodySvg}`;
      })
      .join('');

    const gridLevels = [minValue, minValue + range / 2, maxValue];
    const gridLines = gridLevels
      .map((v) => {
        const y = valueToY(v);
        return `<line class=\"cp-grid-line\" x1=\"${leftPad}\" y1=\"${y.toFixed(2)}\" x2=\"${(leftPad + plotWidth).toFixed(2)}\" y2=\"${y.toFixed(2)}\"></line>`;
      })
      .join('');

    const rightAxisLabels = gridLevels
      .map((v) => {
        const y = valueToY(v);
        return `<text class=\"cp-live-axis-text\" x=\"${(width - 8).toFixed(2)}\" y=\"${(y + 4).toFixed(2)}\" text-anchor=\"end\">${formatNumber(Math.round(v))}</text>`;
      })
      .join('');

    const lastCandle = ohlc[ohlc.length - 1];
    const lastY = valueToY(lastCandle.close);
    const lastX = leftPad + (ohlc.length - 1) * candleStep + candleStep * 0.5;
    const lastMarker = `<circle class=\"cp-last-dot\" cx=\"${lastX.toFixed(2)}\" cy=\"${lastY.toFixed(2)}\" r=\"3.5\" fill=\"#58c5ff\" stroke=\"#d9fbff\" stroke-width=\"1.8\"></circle>`;

    const title = `Live member trend OHLC chart. Green = up, red = down. Last close: ${formatNumber(lastCandle?.close ?? MIN_BASELINE_MEMBERS)}.`;
    refs.bars.innerHTML = `<svg class=\"cp-chart-svg\" width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\" role=\"img\" aria-label=\"${title}\"><title>${title}</title>${gridLines}${candleSvgs}${lastMarker}${rightAxisLabels}</svg><div id=\"cp-live-cross-v\" class=\"cp-live-cross-v is-hidden\"></div><div id=\"cp-live-cross-h\" class=\"cp-live-cross-h is-hidden\"></div><div id=\"cp-live-tooltip\" class=\"cp-live-tooltip is-hidden\"></div>`;

    state.liveLastRender = {
      candles: ohlc,
      chartWidth: width,
      chartHeight: height,
      topPad,
      bottomPad: topPad + plotHeight,
      plotLeft: leftPad,
      plotRight: leftPad + plotWidth,
      candleStep,
      valueToY,
    };

    const first = ohlc[0];
    const middle = ohlc[Math.floor(ohlc.length / 2)];
    const last = ohlc[ohlc.length - 1];

    refs.axisStart.textContent = formatTPoWDateLabel(first?.t || 0);
    refs.axisMid.textContent = formatTPoWDateLabel(middle?.t || 0);
    refs.axisEnd.textContent = formatTPoWDateLabel(last?.t || 0);
    setActiveLiveTimeframeButton();
  }

  function colonyOptions(metrics) {
    const usage = Array.isArray(metrics?.group_usage) ? metrics.group_usage : [];
    return usage
      .map((row, index) => {
        const roomName = String(row?.room_name || '').trim();
        if (!roomName) return null;
        return {
          key: normalizeKey(roomName) || `colony-${index}`,
          label: roomName,
          row,
        };
      })
      .filter(Boolean);
  }

  function ensureSelectedKeyExists(options) {
    const hasSelected = options.some((item) => item.key === state.selectedColonyKey);
    if (!hasSelected) {
      state.selectedColonyKey = ALL_COLONIES_KEY;
    }
  }

  function renderColonySelect(options) {
    ensureSelectedKeyExists(options);
    const html = [
      `<option value="${ALL_COLONIES_KEY}">All Colony Network</option>`,
      ...options.map((item) => `<option value="${item.key}">${item.label}</option>`),
    ].join('');

    refs.colonySelect.innerHTML = html;
    refs.colonySelect.value = state.selectedColonyKey;
  }

  function selectedColonyRow(options) {
    if (state.selectedColonyKey === ALL_COLONIES_KEY) return null;
    const selected = options.find((item) => item.key === state.selectedColonyKey);
    return selected?.row || null;
  }

  function getTopMiningRow(metrics) {
    const usage = Array.isArray(metrics?.group_usage) ? metrics.group_usage : [];
    if (!usage.length) return null;

    const sorted = usage.slice().sort((a, b) => {
      const miningDiff = safeInt(b?.active_chat_ants) - safeInt(a?.active_chat_ants);
      if (miningDiff !== 0) return miningDiff;
      const roomDiff = safeInt(b?.room_count) - safeInt(a?.room_count);
      if (roomDiff !== 0) return roomDiff;
      return safeInt(b?.message_count) - safeInt(a?.message_count);
    });

    return sorted[0] || null;
  }

  function renderTopMiningLeader(metrics) {
    const topRow = getTopMiningRow(metrics);
    if (!topRow) {
      if (refs.topColony) refs.topColony.textContent = '-';
      if (refs.topAntCode) refs.topAntCode.textContent = '-';
      if (refs.topScore) refs.topScore.textContent = '0';
      if (refs.topBasis) refs.topBasis.textContent = 'active_chat_ants (mining-based)';
      return null;
    }

    if (refs.topColony) refs.topColony.textContent = displayLabel(topRow.room_name);
    if (refs.topAntCode) refs.topAntCode.textContent = displayLabel(topRow.top_owner_label, 'N/A');
    if (refs.topScore) refs.topScore.textContent = formatNumber(safeInt(topRow.active_chat_ants));
    if (refs.topBasis) refs.topBasis.textContent = 'active_chat_ants (mining-based)';

    return topRow;
  }

  function toColonySlug(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function parseColonyRoomsFromHtml(html) {
    const marker = 'Rooms In This Colony';
    const start = html.indexOf(marker);
    if (start < 0) return [];
    const end = html.indexOf('</div></section>', start);
    const section = end > start ? html.slice(start, end) : html.slice(start);

    const rowRegex = /<a class="list-row"[^>]*href="([^"]+)"[^>]*>\s*<span>([^<]*)<\/span>\s*<span>([^<]*)<\/span>\s*<span>([^<]*)<\/span>\s*<span>([^<]*)<\/span>\s*<\/a>/gi;
    const rows = [];
    let match;
    while ((match = rowRegex.exec(section)) !== null) {
      const href = match[1] || '';
      const ownerCode = (match[2] || '').trim();
      const antsText = (match[3] || '').trim();
      const statusText = (match[4] || '').trim();
      const msgsText = (match[5] || '').trim();
      const ants = safeInt(String(antsText).replace(/[^\d]/g, ''));
      const msgs30d = safeInt(String(msgsText).replace(/[^\d]/g, ''));
      const status = statusText.toLowerCase();
      const minerSignal = status.includes('active') ? 2 : status.includes('warm') ? 1 : 0;
      rows.push({
        href,
        ownerCode,
        ants,
        statusText,
        msgs30d,
        minerSignal,
      });
    }
    return rows;
  }

  async function fetchColonyRooms(colonyName) {
    const slug = toColonySlug(colonyName);
    if (!slug) return { slug: '', url: '', rows: [] };
    if (state.roomDetailsCache[slug]) {
      return state.roomDetailsCache[slug];
    }

    const url = `${CHAIN_API}/explorer/colonies/${slug}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/html' },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`colony room request failed: ${response.status}`);
    }

    const html = await response.text();
    const entry = { slug, url, rows: parseColonyRoomsFromHtml(html) };
    state.roomDetailsCache[slug] = entry;
    return entry;
  }

  function rankOwnerRooms(rows) {
    return rows.slice().sort((a, b) => {
      const minerDiff = safeInt(b.minerSignal) - safeInt(a.minerSignal);
      if (minerDiff !== 0) return minerDiff;
      const antsDiff = safeInt(b.ants) - safeInt(a.ants);
      if (antsDiff !== 0) return antsDiff;
      return safeInt(b.msgs30d) - safeInt(a.msgs30d);
    });
  }

  function renderRoomListItems(rows) {
    if (!refs.roomList) return;
    if (!rows.length) {
      refs.roomList.innerHTML = '<div class="cp-room-item"><p class="cp-room-name">No room-owner rows found.</p><p class="cp-room-meta">Try another colony or wait for explorer sync.</p></div>';
      return;
    }

    refs.roomList.innerHTML = rows.slice(0, 6)
      .map((item, idx) => {
        const selectedClass = idx === 0 ? ' is-selected' : '';
        return `<article class="cp-room-item${selectedClass}"><p class="cp-room-name">#${idx + 1} ${displayLabel(item.ownerCode, 'Unknown owner')}</p><p class="cp-room-meta">Miner status: ${displayLabel(item.statusText, 'Unknown')}</p><p class="cp-room-meta">Active members: ${formatNumber(safeInt(item.ants, 0))}</p><p class="cp-room-meta">Messages 30d: ${formatNumber(safeInt(item.msgs30d, 0))}</p></article>`;
      })
      .join('');
  }

  function setOpenRoomTarget(href) {
    if (!refs.openRoom) return;

    if (!href) {
      refs.openRoom.classList.add('is-disabled');
      refs.openRoom.setAttribute('aria-disabled', 'true');
      refs.openRoom.setAttribute('href', '#');
      refs.openRoom.removeAttribute('target');
      refs.openRoom.removeAttribute('rel');
      return;
    }

    const absolute = href.startsWith('http') ? href : `${CHAIN_API}${href}`;
    refs.openRoom.classList.remove('is-disabled');
    refs.openRoom.setAttribute('aria-disabled', 'false');
    refs.openRoom.setAttribute('href', absolute);
    refs.openRoom.setAttribute('target', '_blank');
    refs.openRoom.setAttribute('rel', 'noopener noreferrer');
  }

  function renderRewardFallback(targetRow, topMiningRow, metrics) {
    if (!targetRow) {
      if (refs.selectedRooms) refs.selectedRooms.textContent = '-';
      if (refs.rewardOwner) refs.rewardOwner.textContent = '-';
      if (refs.rewardMembers) refs.rewardMembers.textContent = '-';
      if (refs.rewardBasis) refs.rewardBasis.textContent = 'Active miner status + ants + msgs/30d';
      if (refs.whyTop) refs.whyTop.textContent = 'No colony room data yet. Once mining metrics arrive, the owner reward target and reason will appear here.';
      renderRoomListItems([]);
      setOpenRoomTarget('');
      state.latestRoomReward = null;
      return;
    }

    const roomCount = Math.max(1, safeInt(targetRow.room_count, 1));
    const activeMembers = Math.max(1, safeInt(targetRow.active_chat_ants, 1));
    const ownerCode = displayLabel(targetRow.top_owner_label, 'N/A');
    const colonyName = displayLabel(targetRow.room_name, 'Unknown Colony');
    const totalParticipants = Math.max(1, safeInt(metrics.total_group_participants, 1));
    const share = ((activeMembers / totalParticipants) * 100).toFixed(1);

    if (refs.selectedRooms) refs.selectedRooms.textContent = formatNumber(roomCount);
    if (refs.rewardOwner) refs.rewardOwner.textContent = ownerCode;
    if (refs.rewardMembers) refs.rewardMembers.textContent = formatNumber(activeMembers);
    if (refs.rewardBasis) refs.rewardBasis.textContent = 'active_chat_ants + room_count';
    if (refs.whyTop) {
      refs.whyTop.textContent = `Current top in ${colonyName} is ${ownerCode} based on mining members (${activeMembers}) and room coverage (${roomCount}). This is mining-based, not referral-based.`;
      if (topMiningRow && normalizeKey(targetRow.room_name) !== normalizeKey(topMiningRow.room_name)) {
        refs.whyTop.textContent += ` Global top colony remains ${displayLabel(topMiningRow.room_name)}.`;
      }
      refs.whyTop.textContent += ` Participation share: ${share}% of tracked members.`;
    }

    renderRoomListItems([]);
    setOpenRoomTarget('');
    state.latestRoomReward = {
      selected_colony: colonyName,
      reward_owner: ownerCode,
      room_count: roomCount,
      member_mining_activity: activeMembers,
      rationale: 'Fallback from /stats/investor group_usage when room-owner list is unavailable.',
    };
  }

  async function renderRewardTarget(row, topMiningRow, metrics) {
    const targetRow = row || topMiningRow;
    renderRewardFallback(targetRow, topMiningRow, metrics);
    if (!targetRow) return;

    const requestId = ++state.roomFetchId;
    try {
      const colonyName = displayLabel(targetRow.room_name);
      const roomEntry = await fetchColonyRooms(colonyName);
      if (requestId !== state.roomFetchId) return;

      const ranked = rankOwnerRooms(roomEntry.rows);
      const topRoom = ranked[0];
      if (!topRoom) {
        return;
      }

      if (refs.selectedRooms) refs.selectedRooms.textContent = formatNumber(roomEntry.rows.length);
      if (refs.rewardOwner) refs.rewardOwner.textContent = displayLabel(topRoom.ownerCode, 'N/A');
      if (refs.rewardMembers) refs.rewardMembers.textContent = formatNumber(topRoom.ants);
      if (refs.rewardBasis) refs.rewardBasis.textContent = 'Active miner status + ants + msgs/30d';

      const statusPhrase = displayLabel(topRoom.statusText, 'Unknown status');
      if (refs.whyTop) {
        refs.whyTop.textContent = `This room owner is top because mining signals are strongest in ${displayLabel(targetRow.room_name)}: owner ${displayLabel(topRoom.ownerCode, 'N/A')} has ${formatNumber(topRoom.ants)} active members, miner status ${statusPhrase}, and ${formatNumber(topRoom.msgs30d)} messages in 30d. Ranking combines active miners and active members, not referrals.`;
      }

      renderRoomListItems(ranked);
      setOpenRoomTarget(topRoom.href || '');
      populateTPoWOwners(ranked);

      state.latestRoomReward = {
        selected_colony: displayLabel(targetRow.room_name),
        reward_owner: displayLabel(topRoom.ownerCode, 'N/A'),
        room_count: roomEntry.rows.length,
        member_mining_activity: topRoom.ants,
        miner_status: statusPhrase,
        msgs_30d: topRoom.msgs30d,
        source_url: roomEntry.url,
        rationale: 'Top room ranked by miner status, then active members (ants), then 30d messages. Referral count is not used.',
      };

      if (state.latestPayload && state.latestActiveMinerMeta) {
        updateTransparency(state.latestMode, state.latestPayload, row, topMiningRow, state.latestActiveMinerMeta);
      }
    } catch (_) {
      // Keep fallback content if detailed colony room fetch is unavailable.
    }
  }

  function extractTrackedMembers(metrics, row) {
    if (row) {
      return Math.max(MIN_BASELINE_MEMBERS, safeInt(row.active_chat_ants, MIN_BASELINE_MEMBERS));
    }
    return Math.max(MIN_BASELINE_MEMBERS, safeInt(metrics.total_group_participants, MIN_BASELINE_MEMBERS));
  }

  function extractColonyRooms(metrics, row) {
    if (row) {
      return Math.max(1, safeInt(row.room_count, 1));
    }
    return safeInt(metrics.total_colony_rooms);
  }

  function extractMiningKpi(metrics, row) {
    if (row) {
      // For per-colony view, use active chat ants as mining-strength proxy to reduce message-spam influence.
      return Math.max(MIN_BASELINE_MEMBERS, safeInt(row.active_chat_ants, MIN_BASELINE_MEMBERS));
    }
    return safeInt(metrics.total_sessions);
  }

  function resolveActiveMiners(metrics) {
    const activeMiners = safeInt(metrics.total_active_miners);
    if (activeMiners > 0) {
      return {
        value: activeMiners,
        source: 'total_active_miners',
      };
    }

    const realMiners = safeInt(metrics.total_real_miners);
    if (realMiners > 0) {
      return {
        value: realMiners,
        source: 'total_real_miners (fallback)',
      };
    }

    return {
      value: 0,
      source: 'total_active_miners',
    };
  }

  function renderKpi4Mode(row) {
    if (!refs.kpi4Label || !refs.kpi4Note) return;

    if (row) {
      refs.kpi4Label.textContent = 'Mining Strength (Proxy)';
      refs.kpi4Note.textContent = 'Based on active colony ants';
      if (refs.metricRule) {
        refs.metricRule.textContent = 'Selected colony uses active_chat_ants as mining-strength proxy to avoid message-count inflation.';
      }
      return;
    }

    refs.kpi4Label.textContent = 'Total Mining Sessions';
    refs.kpi4Note.textContent = 'Historical participation';
    if (refs.metricRule) {
      refs.metricRule.textContent = 'Network mode uses total_sessions from chain metrics.';
    }
  }

  function updateTransparency(mode, payload, row, topMiningRow, activeMinerMeta) {
    const now = Date.now();
    if (refs.dataMode) {
      refs.dataMode.textContent = mode;
    }
    if (refs.lastUpdated) {
      refs.lastUpdated.textContent = formatDateTime(now);
    }
    if (!refs.rawPreview) {
      return;
    }

    const metrics = payload?.metrics || {};
    const selectedName = row ? String(row.room_name || '').trim() : 'All Colony Network';
    const snapshot = {
      mode,
      selected_colony: selectedName,
      endpoint: `${CHAIN_API}${STATS_ENDPOINT}`,
      rendered_at: new Date(now).toISOString(),
      formula: row
        ? 'tracked_members=max(1, active_chat_ants); mining_kpi=max(1, active_chat_ants); excludes message_count'
        : 'tracked_members=max(1, total_group_participants); mining_kpi=total_sessions',
      fields_used: row
        ? {
            active_chat_ants: safeInt(row.active_chat_ants),
            room_count: safeInt(row.room_count),
            room_name: selectedName,
          }
        : {
            total_group_participants: safeInt(metrics.total_group_participants),
            total_active_miners: safeInt(metrics.total_active_miners),
            total_real_miners: safeInt(metrics.total_real_miners),
            total_colony_rooms: safeInt(metrics.total_colony_rooms),
            total_sessions: safeInt(metrics.total_sessions),
            active_miners_displayed: safeInt(activeMinerMeta?.value),
            active_miners_source: displayLabel(activeMinerMeta?.source),
          },
      top_mining_colony: topMiningRow
        ? {
            room_name: displayLabel(topMiningRow.room_name),
            top_ant_code: displayLabel(topMiningRow.top_owner_label, 'N/A'),
            active_chat_ants: safeInt(topMiningRow.active_chat_ants),
            ranking_basis: 'active_chat_ants (mining-based)',
          }
        : null,
      reward_target: state.latestRoomReward,
    };

    refs.rawPreview.textContent = JSON.stringify(snapshot, null, 2);
  }

  function renderMetrics(payload, sourceLabel) {
    const metrics = payload?.metrics || {};
    const topMiningRow = renderTopMiningLeader(metrics);
    const options = colonyOptions(metrics);
    renderColonySelect(options);

    const row = selectedColonyRow(options);
    renderRewardTarget(row, topMiningRow, metrics);
    const members = extractTrackedMembers(metrics, row);
    const activeMinerMeta = resolveActiveMiners(metrics);
    state.latestActiveMinerMeta = activeMinerMeta;
    const activeMiners = safeInt(activeMinerMeta.value);
    const colonyRooms = extractColonyRooms(metrics, row);
    const totalSessions = extractMiningKpi(metrics, row);

    renderKpi4Mode(row);

    refs.members.textContent = formatNumber(members);
    refs.activeMiners.textContent = formatNumber(activeMiners);
    if (refs.activeNote) {
      refs.activeNote.textContent = `Source: ${activeMinerMeta.source}`;
    }
    refs.colonyRooms.textContent = formatNumber(colonyRooms);
    refs.totalSessions.textContent = formatNumber(totalSessions);

    const milestoneProgress = Math.min(100, (members / MILESTONE_MEMBERS) * 100);
    refs.progressFill.style.width = `${milestoneProgress.toFixed(1)}%`;
    refs.progressCaption.textContent = `Progress to 1,000-member colony milestone: ${milestoneProgress.toFixed(1)}%`;

    const baselineReached = members >= MIN_BASELINE_MEMBERS;
    const scopeName = row ? String(row.room_name || 'selected colony') : 'network';
    refs.status.textContent = baselineReached
      ? `Baseline Met (${scopeName} - ${sourceLabel})`
      : `Baseline Pending (${scopeName} - ${sourceLabel})`;

    updateTransparency(state.latestMode, payload, row, topMiningRow, activeMinerMeta);

    const history = updateHistory(members);
    renderBars(history);
  }

  function renderUnavailableState() {
    const fallback = {
      metrics: {
        total_group_participants: MIN_BASELINE_MEMBERS,
        total_active_miners: 0,
        total_colony_rooms: 0,
        total_sessions: 0,
      },
    };
    renderMetrics(fallback, 'fallback');
  }

  async function fetchInvestorStats() {
    const response = await fetch(`${CHAIN_API}${STATS_ENDPOINT}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`stats request failed: ${response.status}`);
    }

    return response.json();
  }

  async function refreshColonyProgress() {
    try {
      const payload = await fetchInvestorStats();
      state.latestPayload = payload;
      state.latestMode = 'live';
      renderMetrics(payload, 'live');
    } catch (_) {
      state.latestMode = 'fallback';
      renderUnavailableState();
    }
  }

  function onChangeColony() {
    const nextKey = normalizeKey(refs.colonySelect.value) || ALL_COLONIES_KEY;
    state.selectedColonyKey = nextKey;

    if (state.latestPayload) {
      renderMetrics(state.latestPayload, 'live');
      return;
    }

    renderUnavailableState();
  }

  document.addEventListener('DOMContentLoaded', () => {
    refs.colonySelect.addEventListener('change', onChangeColony);
    refs.copySnapshot?.addEventListener('click', onCopySnapshot);
    refs.liveTimeframes?.addEventListener('click', onLiveTimeframeClick);
    refs.tpowOwnerSelect?.addEventListener('change', onChangeTPoWOwner);
    refs.tpowOwnerSelect?.addEventListener('focus', onTPoWOwnerFocus);
    refs.tpowOwnerSelect?.addEventListener('blur', onTPoWOwnerBlur);
    refs.tpowOwnerSearch?.addEventListener('input', onTPoWOwnerSearchInput);
    refs.tpowOwnerSearch?.addEventListener('keydown', onTPoWOwnerSearchKeyDown);
    refs.tpowTimeframes?.addEventListener('click', onTPoWTimeframeClick);
    refs.bars?.addEventListener('mousemove', onLivePointerMove);
    refs.bars?.addEventListener('mouseleave', hideLiveOverlay);
    refs.tpowBars?.addEventListener('mousemove', onTPoWPointerMove);
    refs.tpowBars?.addEventListener('mouseleave', hideTPoWOverlay);
    refs.tpowBars?.addEventListener('wheel', onTPoWWheel, { passive: false });
    refs.tpowBars?.addEventListener('mousedown', onTPoWDragStart);
    window.addEventListener('mousemove', onTPoWDragMove);
    window.addEventListener('mouseup', onTPoWDragEnd);
    
    // Initial render
    setActiveLiveTimeframeButton();
    renderBars(readHistory());
    setActiveTPoWTimeframeButton();
    refreshColonyProgress();
    
    // Refresh periodically
    window.setInterval(refreshColonyProgress, REFRESH_MS);
    
    // Re-render chart on window resize for responsive behavior
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (state.latestPayload) {
          renderMetrics(state.latestPayload, 'live');
          const owner = getSelectedTPoWOwner();
          if (owner) scheduleTPoWRender(owner);
        }
      }, 250);
    });
  });
})();

