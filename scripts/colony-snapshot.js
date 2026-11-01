#!/usr/bin/env node
/**
 * Daily colony snapshot writer.
 * ─────────────────────────────────────────────────────────────────────────
 * Fetches https://explorer.a-network.net/stats/investor and appends today's
 * per-owner peak into data/colony-monthly-<YYYY-MM>.json.
 *
 * Shape matches the localStorage shape used by assets/js/colony-monthly.js,
 * so the same renderer works for both sources.
 *
 *   {
 *     "month": "2026-05",
 *     "days": {
 *       "2026-05-24": {
 *         "owners": {
 *           "<ownerCode>": { "mining": N, "members": N, "rooms": N, "colonyName": "..." }
 *         },
 *         "sampleCount": 1,
 *         "lastSampleAt": "2026-05-24T00:30:11.000Z"
 *       }
 *     }
 *   }
 *
 * Requires Node 18+ (global fetch). Env: ANET_STATS_ENDPOINT, ANET_SNAPSHOT_RETRIES (6),
 * ANET_SNAPSHOT_TIMEOUT_MS (90000), ANET_SNAPSHOT_RETRY_BASE_MS (5000), ANET_SNAPSHOT_DRY_RUN (0).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ENDPOINT = process.env.ANET_STATS_ENDPOINT
  || 'https://api.a-network.net/colony-rewards/leaderboard?limit=200';
const DATA_DIR = path.join(__dirname, '..', 'data');

// The upstream API runs on a cold-starting host behind a proxy and has answered
// 502 for a single request at 00:30 UTC on most days. Retry with exponential
// backoff instead of failing the whole run on one gateway error.
const RETRY_ATTEMPTS = envInt('ANET_SNAPSHOT_RETRIES', 6);
const REQUEST_TIMEOUT_MS = envInt('ANET_SNAPSHOT_TIMEOUT_MS', 90_000);
const RETRY_BASE_DELAY_MS = envInt('ANET_SNAPSHOT_RETRY_BASE_MS', 5_000);
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.ANET_SNAPSHOT_DRY_RUN || '');

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

/** 5xx, rate limits and request timeouts are transient; 4xx (other than 408/425/429) are not. */
function isRetryableStatus(status) {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

class NonRetryableError extends Error {}

/**
 * fetch() with timeout + exponential backoff (5s, 10s, 20s, 40s, 60s, ...).
 * Resolves with the first OK response; throws after `attempts` failures or on a
 * non-retryable HTTP status. Injectable fetch/sleep/log for tests.
 */
async function fetchWithRetry(url, opts = {}) {
  const {
    attempts = RETRY_ATTEMPTS,
    timeoutMs = REQUEST_TIMEOUT_MS,
    baseDelayMs = RETRY_BASE_DELAY_MS,
    maxDelayMs = 60_000,
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console,
  } = opts;
  let lastError = new Error('no attempts made');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': 'anet-colony-snapshot/1.1', Accept: 'application/json' },
        signal: controller.signal,
      });
      if (res.ok) return res;
      if (!isRetryableStatus(res.status)) throw new NonRetryableError(`Upstream HTTP ${res.status}`);
      lastError = new Error(`Upstream HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      lastError = (err && err.name === 'AbortError')
        ? new Error(`Upstream timeout after ${timeoutMs} ms`)
        : (err instanceof Error ? err : new Error(String(err)));
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) {
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      log.warn(`Attempt ${attempt}/${attempts} failed (${lastError.message}); retrying in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }
  throw new Error(`${lastError.message} (after ${attempts} attempts)`);
}

function utcMonthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function utcDayKey(d) {
  return `${utcMonthKey(d)}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function safeInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function extractOwnerCode(row) {
  return String(
    row?.inviteCode
      || row?.colonyLabel
      || row?.ownerLabel
      || row?.owner_code
      || row?.ownerCode
      || row?.ant_code
      || row?.antCode
      || row?.referral_code
      || row?.referralCode
      || row?.owner
      || ''
  ).trim();
}

async function main() {
  const now = new Date();
  const month = utcMonthKey(now);
  const today = utcDayKey(now);
  const outFile = path.join(DATA_DIR, `colony-monthly-${month}.json`);

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Load existing month file (if any)
  let snapshot = { month, days: {} };
  if (fs.existsSync(outFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (parsed && parsed.month === month && parsed.days) snapshot = parsed;
    } catch (err) {
      console.warn(`Existing file unreadable, starting fresh: ${err.message}`);
    }
  }

  // Fetch upstream (retrying through cold starts and gateway errors)
  console.log(`Fetching ${ENDPOINT} (up to ${RETRY_ATTEMPTS} attempts, ${REQUEST_TIMEOUT_MS} ms each)`);
  const res = await fetchWithRetry(ENDPOINT);
  const payload = await res.json();
  const rows = Array.isArray(payload?.leaderboard) ? payload.leaderboard
    : Array.isArray(payload?.rooms) ? payload.rooms
    : Array.isArray(payload?.colonies) ? payload.colonies
    : Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload) ? payload
    : [];

  if (!rows.length) {
    console.warn('Upstream returned 0 rows; nothing to record.');
    process.exit(0);
  }

  // Build today's owner peaks
  const byOwner = {};
  rows.forEach((row) => {
    const code = extractOwnerCode(row);
    if (!code) return;
    const mining = safeInt(row?.activeMembers ?? row?.active_chat_ants);
    const members = safeInt(row?.totalMembers ?? row?.member_count ?? row?.members ?? row?.tracked_members ?? row?.active_chat_ants);
    const rooms = safeInt(row?.verifiedMembers ?? row?.room_count ?? row?.rooms ?? 0, 0);
    const colonyName = String(row?.colonyLabel || row?.room_name || row?.colony || code).trim();
    const prev = byOwner[code];
    if (!prev || mining > prev.mining) {
      byOwner[code] = { mining, members, rooms, colonyName };
    } else {
      prev.rooms = Math.max(prev.rooms, rooms);
    }
  });

  const ownerCount = Object.keys(byOwner).length;
  if (!ownerCount) {
    console.warn('No usable owner codes in upstream payload; nothing to record.');
    process.exit(0);
  }

  // Merge into today's bucket — keep daily max per owner
  const todayBucket = snapshot.days[today] || { owners: {}, sampleCount: 0 };
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
  snapshot.days[today] = todayBucket;

  if (DRY_RUN) {
    console.log(`[dry-run] would write ${outFile}  (owners=${ownerCount}, days=${Object.keys(snapshot.days).length}, today=${today})`);
    return;
  }
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Wrote ${outFile}  (owners=${ownerCount}, days=${Object.keys(snapshot.days).length})`);
}

module.exports = { fetchWithRetry, isRetryableStatus, extractOwnerCode, utcMonthKey, utcDayKey };

if (require.main === module) {
  main().catch((err) => {
    console.error(`Snapshot failed: ${err.message}`);
    process.exit(1);
  });
}
