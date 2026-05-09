(() => {
  'use strict';

  const CHAIN_API = 'https://explorer.a-network.net';
  const STATS_ENDPOINT = '/stats/investor';
  const HISTORY_KEY = 'anet_ants_colony_member_history_v1';
  const MAX_POINTS = 24;
  const MILESTONE_MEMBERS = 1000;
  const MIN_BASELINE_MEMBERS = 1;
  const REFRESH_MS = 30000;
  const ALL_COLONIES_KEY = 'all';

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
    tpowBars: document.getElementById('cp-tpow-bars'),
    tpowOwnerSelect: document.getElementById('cp-tpow-owner-select'),
    tpowOwnerDisplay: document.getElementById('cp-tpow-owner'),
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
        .slice(-MAX_POINTS);
    } catch (_) {
      return [];
    }
  }

  function writeHistory(points) {
    try {
      localStorage.setItem(getHistoryKey(), JSON.stringify(points.slice(-MAX_POINTS)));
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
    const trimmed = points.slice(-MAX_POINTS);
    writeHistory(trimmed);
    return trimmed;
  }

  function buildFallbackHistory() {
    const points = [];
    for (let i = 0; i < MAX_POINTS; i += 1) {
      points.push({ t: Date.now() - (MAX_POINTS - i) * REFRESH_MS, v: MIN_BASELINE_MEMBERS });
    }
    writeHistory(points);
    return points;
  }

  function generateTPoWData(ownerCode) {
    // Generate 6-hour TPoW data with 1-minute candles (360 candles total)
    const now = Date.now();
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const startTime = now - sixHoursMs;
    const minuteMs = 60 * 1000;
    const candles = [];

    // Simulate owner mining activity - deterministic based on owner code
    const ownerHash = ownerCode.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    
    for (let i = 0; i < 360; i++) {
      const candleTime = startTime + i * minuteMs;
      
      // Simulate mining activity patterns (busy hours, idle periods)
      const hourOfDay = new Date(candleTime).getHours();
      const isBusinessHour = hourOfDay >= 8 && hourOfDay <= 18;
      const randomFactor = Math.sin(ownerHash + i * 0.1) * 0.5 + 0.5;
      const miningProbability = isBusinessHour ? 0.7 + randomFactor * 0.25 : 0.3 + randomFactor * 0.2;
      
      // Determine if there's mining activity this minute
      const hasMining = Math.random() < miningProbability;
      
      // OHLC values: activity count per minute (0-60 seconds of activity)
      const open = hasMining ? Math.random() * 40 + 20 : Math.random() * 15;
      const close = hasMining ? Math.random() * 40 + 20 : Math.random() * 15;
      const high = Math.max(open, close, Math.random() * 60);
      const low = Math.min(open, close, Math.random() * 30);
      
      candles.push({
        t: candleTime,
        open: Math.round(open),
        close: Math.round(close),
        high: Math.round(high),
        low: Math.round(low),
        hasMining,
      });
    }
    
    return candles;
  }

  function renderTPoWChart(ownerCode) {
    if (!ownerCode || !refs.tpowBars) return;

    const candles = generateTPoWData(ownerCode);
    
    // Calculate statistics
    const miningCandles = candles.filter(c => c.hasMining).length;
    const idleCandles = candles.length - miningCandles;
    const activityRate = ((miningCandles / candles.length) * 100).toFixed(1);
    const lastMiningCandle = [...candles].reverse().find(c => c.hasMining);
    
    // Render stats
    if (refs.tpowMiningMins) refs.tpowMiningMins.textContent = miningCandles;
    if (refs.tpowActivityRate) refs.tpowActivityRate.textContent = `${activityRate}%`;
    if (refs.tpowIdleMins) refs.tpowIdleMins.textContent = idleCandles;
    if (refs.tpowLastActivity && lastMiningCandle) {
      const lastTime = new Date(lastMiningCandle.t);
      refs.tpowLastActivity.textContent = lastTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    
    // Chart dimensions
    const containerRect = refs.tpowBars?.getBoundingClientRect();
    const containerWidth = containerRect?.width || window.innerWidth * 0.9;
    const width = Math.max(300, Math.min(containerWidth, 960));
    const height = 300;
    const paddingX = 12;
    const paddingY = 12;
    const candleWidth = Math.max(1, (width - paddingX * 2) / candles.length);
    const spacing = Math.max(0.5, candleWidth * 0.1);
    const bodyWidth = Math.max(1, candleWidth - spacing);

    // Get price range
    const allHigh = candles.map(c => c.high);
    const allLow = candles.map(c => c.low);
    const maxValue = Math.max(...allHigh, 60);
    const minValue = Math.min(...allLow, 0);
    const range = Math.max(1, maxValue - minValue);

    // Build candlesticks
    const candleSvgs = candles
      .map((candle, idx) => {
        const x = paddingX + idx * (candleWidth + spacing) + candleWidth / 2;
        
        // Normalize to pixels
        const yHigh = height - paddingY - ((candle.high - minValue) / range) * (height - paddingY * 2);
        const yLow = height - paddingY - ((candle.low - minValue) / range) * (height - paddingY * 2);
        const yOpen = height - paddingY - ((candle.open - minValue) / range) * (height - paddingY * 2);
        const yClose = height - paddingY - ((candle.close - minValue) / range) * (height - paddingY * 2);
        
        const yBodyTop = Math.min(yOpen, yClose);
        const yBodyBottom = Math.max(yOpen, yClose);
        const bodyHeight = Math.max(0.5, yBodyBottom - yBodyTop);
        
        const color = candle.hasMining ? '#6ce7b1' : '#ff6b6b';
        const opacityClass = candle.hasMining ? 'cp-tpow-candle-mining' : 'cp-tpow-candle-idle';
        
        const wick = `<line class="cp-tpow-wick" x1="${x.toFixed(2)}" y1="${yHigh.toFixed(2)}" x2="${x.toFixed(2)}" y2="${yLow.toFixed(2)}" stroke="${color}" stroke-width="0.8" opacity="0.6"></line>`;
        const body = `<rect class="cp-tpow-candle ${opacityClass}" x="${(x - bodyWidth / 2).toFixed(2)}" y="${yBodyTop.toFixed(2)}" width="${bodyWidth.toFixed(2)}" height="${bodyHeight.toFixed(2)}" fill="${color}" opacity="0.8" rx="0.3"></rect>`;
        
        return `${wick}${body}`;
      })
      .join('');

    // Grid lines
    const gridLines = [0.25, 0.5, 0.75]
      .map((ratio) => {
        const y = paddingY + (height - paddingY * 2) * ratio;
        return `<line class="cp-grid-line" x1="${paddingX}" y1="${y.toFixed(2)}" x2="${(width - paddingX).toFixed(2)}" y2="${y.toFixed(2)}"></line>`;
      })
      .join('');

    const title = `Proof of Time (TPoW) mining activity for ${ownerCode} over last 6 hours. Green = mining, Red = idle.`;
    refs.tpowBars.innerHTML = `<svg class="cp-tpow-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}" preserveAspectRatio="xMidYMid meet"><title>${title}</title>${gridLines}${candleSvgs}</svg>`;

    // Update timeline
    const first = candles[0];
    const mid = candles[Math.floor(candles.length / 2)];
    const last = candles[candles.length - 1];
    if (refs.tpowTimeStart) refs.tpowTimeStart.textContent = `${new Date(first.t).getHours()}:00`;
    if (refs.tpowTimeMid) refs.tpowTimeMid.textContent = `${new Date(mid.t).getHours()}:00`;
    if (refs.tpowTimeEnd) refs.tpowTimeEnd.textContent = 'now';
  }

  function populateTPoWOwners(rooms) {
    if (!refs.tpowOwnerSelect) return;
    
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
    
    const html = Array.from(owners)
      .sort()
      .map(owner => `<option value="${owner}">${owner}</option>`)
      .join('');
    
    refs.tpowOwnerSelect.innerHTML = html;
    
    // Auto-select first owner
    if (html && !refs.tpowOwnerSelect.value) {
      refs.tpowOwnerSelect.selectedIndex = 0;
      onChangeTPoWOwner();
    }
  }

  function onChangeTPoWOwner() {
    const selectedOwner = refs.tpowOwnerSelect?.value;
    if (!selectedOwner) return;
    
    if (refs.tpowOwnerDisplay) refs.tpowOwnerDisplay.textContent = selectedOwner;
    renderTPoWChart(selectedOwner);
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

  function renderBars(history) {
    const series = history.length ? history.slice(-MAX_POINTS) : buildFallbackHistory();
    const ohlc = buildOHLCData(series);
    
    // Get price range from all high/low values
    const allHighs = ohlc.map(c => c.high);
    const allLows = ohlc.map(c => c.low);
    const maxValue = Math.max(...allHighs, MIN_BASELINE_MEMBERS);
    const minValue = Math.min(...allLows, MIN_BASELINE_MEMBERS);
    const range = Math.max(1, maxValue - minValue);

    // Responsive dimensions based on container width
    const containerRect = refs.bars?.getBoundingClientRect();
    const containerWidth = containerRect?.width || window.innerWidth * 0.9;
    const width = Math.max(300, Math.min(containerWidth, 960));
    const height = 300;
    const paddingX = 16;
    const paddingY = 16;
    const candleWidth = Math.max(4, (width - paddingX * 2) / Math.max(1, ohlc.length));
    const spacing = Math.max(1, candleWidth * 0.2);
    const bodyWidth = Math.max(2, candleWidth - spacing);

    // Build candlestick elements with wicks
    const candleSvgs = ohlc
      .map((candle, index) => {
        const x = paddingX + index * (candleWidth + spacing) + candleWidth / 2;
        
        // Normalize values to pixel positions
        const normalizedHigh = (candle.high - minValue) / range;
        const normalizedLow = (candle.low - minValue) / range;
        const normalizedOpen = (candle.open - minValue) / range;
        const normalizedClose = (candle.close - minValue) / range;
        
        const yHigh = height - paddingY - normalizedHigh * (height - paddingY * 2);
        const yLow = height - paddingY - normalizedLow * (height - paddingY * 2);
        const yOpen = height - paddingY - normalizedOpen * (height - paddingY * 2);
        const yClose = height - paddingY - normalizedClose * (height - paddingY * 2);
        
        // Determine body position
        const yBodyTop = Math.min(yOpen, yClose);
        const yBodyBottom = Math.max(yOpen, yClose);
        const bodyHeight = Math.max(1, yBodyBottom - yBodyTop);
        
        // Colors
        const color = candle.isBullish ? '#6ce7b1' : '#ff6b6b'; // green for up, red for down
        const opacityClass = candle.isBullish ? 'cp-candle-mining' : 'cp-candle-missed';
        
        // Wick (thin line from high to low)
        const wickSvg = `<line class=\"cp-wick\" x1=\"${x.toFixed(2)}\" y1=\"${yHigh.toFixed(2)}\" x2=\"${x.toFixed(2)}\" y2=\"${yLow.toFixed(2)}\" stroke=\"${color}\" stroke-width=\"1\" opacity=\"0.6\"></line>`;
        
        // Body (rectangle from open to close)
        const bodySvg = `<rect class=\"cp-candle ${opacityClass}\" x=\"${(x - bodyWidth / 2).toFixed(2)}\" y=\"${yBodyTop.toFixed(2)}\" width=\"${bodyWidth.toFixed(2)}\" height=\"${bodyHeight.toFixed(2)}\" fill=\"${color}\" opacity=\"0.85\" rx=\"0.5\"></rect>`;
        
        return `${wickSvg}${bodySvg}`;
      })
      .join('');

    // Grid lines
    const gridLines = [0.25, 0.5, 0.75]
      .map((ratio) => {
        const y = paddingY + (height - paddingY * 2) * ratio;
        return `<line class=\"cp-grid-line\" x1=\"${paddingX}\" y1=\"${y.toFixed(2)}\" x2=\"${(width - paddingX).toFixed(2)}\" y2=\"${y.toFixed(2)}\"></line>`;
      })
      .join('');

    // Last candle marker
    const lastCandle = ohlc[ohlc.length - 1];
    const lastNormalized = (lastCandle.close - minValue) / range;
    const lastY = height - paddingY - lastNormalized * (height - paddingY * 2);
    const lastX = paddingX + (ohlc.length - 1) * (candleWidth + spacing) + candleWidth / 2;
    const lastMarker = `<circle class=\"cp-last-dot\" cx=\"${lastX.toFixed(2)}\" cy=\"${lastY.toFixed(2)}\" r=\"3.5\" fill=\"#58c5ff\" stroke=\"#d9fbff\" stroke-width=\"1.8\"></circle>`;

    const title = `Mining activity OHLC candlestick chart. Green = bullish (close > open), Red = bearish (close < open). Last: ${formatNumber(lastCandle?.close ?? MIN_BASELINE_MEMBERS)} members`;
    refs.bars.innerHTML = `<svg class=\"cp-chart-svg\" viewBox=\"0 0 ${width} ${height}\" role=\"img\" aria-label=\"${title}\" preserveAspectRatio=\"xMidYMid meet\"><title>${title}</title>${gridLines}${candleSvgs}${lastMarker}</svg>`;

    // Update axis labels with dates
    const first = series[0];
    const middle = series[Math.floor(series.length / 2)];
    const last = series[series.length - 1];
    
    refs.axisStart.textContent = formatTimeStamp(first?.t || 0);
    refs.axisMid.textContent = formatTimeStamp(middle?.t || 0);
    refs.axisEnd.textContent = formatTimeStamp(last?.t || 0);
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
    refs.tpowOwnerSelect?.addEventListener('change', onChangeTPoWOwner);
    
    // Initial render
    renderBars(readHistory());
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
        }
      }, 250);
    });
  });
})();

