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
    sourceEndpoint: document.getElementById('cp-source-endpoint'),
    dataMode: document.getElementById('cp-data-mode'),
    lastUpdated: document.getElementById('cp-last-updated'),
    metricRule: document.getElementById('cp-metric-rule'),
    rawPreview: document.getElementById('cp-raw-preview'),
    copySnapshot: document.getElementById('cp-copy-snapshot'),
    copyStatus: document.getElementById('cp-copy-status'),
    members: document.getElementById('cp-members'),
    activeMiners: document.getElementById('cp-active-miners'),
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
  };

  if (!refs.status || !refs.members || !refs.bars || !refs.colonySelect) {
    return;
  }

  const state = {
    selectedColonyKey: ALL_COLONIES_KEY,
    latestPayload: null,
    latestMode: 'loading',
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

  function renderBars(history) {
    const series = history.length ? history.slice(-MAX_POINTS) : buildFallbackHistory();
    const maxValue = Math.max(...series.map((p) => p.v), MIN_BASELINE_MEMBERS);

    refs.bars.innerHTML = series
      .map((point) => {
        const heightPercent = Math.max(8, Math.round((point.v / maxValue) * 100));
        const title = `Members: ${formatNumber(point.v)}`;
        return `<div class=\"cp-bar\" style=\"height:${heightPercent}%\" title=\"${title}\" aria-label=\"${title}\"></div>`;
      })
      .join('');

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

  function updateTransparency(mode, payload, row, topMiningRow) {
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
            total_colony_rooms: safeInt(metrics.total_colony_rooms),
            total_sessions: safeInt(metrics.total_sessions),
          },
      top_mining_colony: topMiningRow
        ? {
            room_name: displayLabel(topMiningRow.room_name),
            top_ant_code: displayLabel(topMiningRow.top_owner_label, 'N/A'),
            active_chat_ants: safeInt(topMiningRow.active_chat_ants),
            ranking_basis: 'active_chat_ants (mining-based)',
          }
        : null,
    };

    refs.rawPreview.textContent = JSON.stringify(snapshot, null, 2);
  }

  function renderMetrics(payload, sourceLabel) {
    const metrics = payload?.metrics || {};
    const topMiningRow = renderTopMiningLeader(metrics);
    const options = colonyOptions(metrics);
    renderColonySelect(options);

    const row = selectedColonyRow(options);
    const members = extractTrackedMembers(metrics, row);
    const activeMiners = safeInt(metrics.total_active_miners);
    const colonyRooms = extractColonyRooms(metrics, row);
    const totalSessions = extractMiningKpi(metrics, row);

    renderKpi4Mode(row);

    refs.members.textContent = formatNumber(members);
    refs.activeMiners.textContent = formatNumber(activeMiners);
    refs.colonyRooms.textContent = formatNumber(colonyRooms);
    refs.totalSessions.textContent = formatNumber(totalSessions);

    const milestoneProgress = Math.min(100, (members / MILESTONE_MEMBERS) * 100);
    refs.progressFill.style.width = `${milestoneProgress.toFixed(1)}%`;
    refs.progressCaption.textContent = `Progress to 1,000-member colony milestone: ${milestoneProgress.toFixed(1)}%`;

    const baselineReached = members >= MIN_BASELINE_MEMBERS;
    const scopeName = row ? String(row.room_name || 'selected colony') : 'network';
    refs.status.textContent = baselineReached
      ? `Baseline Met (${scopeName} • ${sourceLabel})`
      : `Baseline Pending (${scopeName} • ${sourceLabel})`;

    updateTransparency(state.latestMode, payload, row, topMiningRow);

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
    renderBars(readHistory());
    refreshColonyProgress();
    window.setInterval(refreshColonyProgress, REFRESH_MS);
  });
})();
