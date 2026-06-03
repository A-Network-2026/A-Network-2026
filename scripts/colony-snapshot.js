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
 * Requires Node 18+ (global fetch).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ENDPOINT = process.env.ANET_STATS_ENDPOINT
  || 'https://api.a-network.net/colony-rewards/leaderboard?limit=200';
const DATA_DIR = path.join(__dirname, '..', 'data');

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

  // Fetch upstream
  console.log(`Fetching ${ENDPOINT}`);
  const res = await fetch(ENDPOINT, { headers: { 'User-Agent': 'anet-colony-snapshot/1.0' } });
  if (!res.ok) {
    throw new Error(`Upstream HTTP ${res.status}`);
  }
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

  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Wrote ${outFile}  (owners=${ownerCount}, days=${Object.keys(snapshot.days).length})`);
}

main().catch((err) => {
  console.error(`Snapshot failed: ${err.message}`);
  process.exit(1);
});
