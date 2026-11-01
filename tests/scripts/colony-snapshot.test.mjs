// scripts/colony-snapshot.js — retry/backoff behaviour and payload helpers (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { fetchWithRetry, isRetryableStatus, extractOwnerCode, utcDayKey } = require(path.join(ROOT, 'scripts', 'colony-snapshot.js'));

const quiet = { warn: () => {}, log: () => {} };
const okRes = { ok: true, status: 200, json: async () => ({ leaderboard: [] }) };
const res = (status) => ({ ok: status >= 200 && status < 300, status });

test('isRetryableStatus treats gateway/rate-limit statuses as transient and other 4xx as final', () => {
  for (const s of [500, 502, 503, 504, 522, 524, 408, 425, 429]) assert.equal(isRetryableStatus(s), true, String(s));
  for (const s of [400, 401, 403, 404, 410, 422]) assert.equal(isRetryableStatus(s), false, String(s));
});

test('fetchWithRetry survives 502s with exponential backoff and returns the first OK response', async () => {
  const calls = []; const delays = [];
  const fetchImpl = async () => { calls.push(1); return calls.length < 3 ? res(502) : okRes; };
  const out = await fetchWithRetry('https://example.test/lb', { attempts: 6, baseDelayMs: 5000, fetchImpl, sleep: async (ms) => { delays.push(ms); }, log: quiet });
  assert.equal(out, okRes);
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [5000, 10000]);
});

test('fetchWithRetry gives up after the configured attempts with a descriptive error', async () => {
  let n = 0;
  await assert.rejects(
    fetchWithRetry('https://example.test/lb', { attempts: 4, baseDelayMs: 1, fetchImpl: async () => { n++; return res(503); }, sleep: async () => {}, log: quiet }),
    /Upstream HTTP 503 \(after 4 attempts\)/,
  );
  assert.equal(n, 4);
});

test('fetchWithRetry does not retry a non-transient status', async () => {
  let n = 0;
  await assert.rejects(
    fetchWithRetry('https://example.test/lb', { attempts: 6, fetchImpl: async () => { n++; return res(404); }, sleep: async () => { throw new Error('must not sleep'); }, log: quiet }),
    /Upstream HTTP 404/,
  );
  assert.equal(n, 1);
});

test('fetchWithRetry retries network errors and request timeouts', async () => {
  let n = 0;
  const fetchImpl = async (_url, { signal }) => {
    n++;
    if (n === 1) throw new TypeError('fetch failed');
    if (n === 2) return new Promise((_, reject) => signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }));
    return okRes;
  };
  const out = await fetchWithRetry('https://example.test/lb', { attempts: 5, timeoutMs: 20, baseDelayMs: 1, fetchImpl, sleep: async () => {}, log: quiet });
  assert.equal(out, okRes);
  assert.equal(n, 3);
});

test('backoff is capped at maxDelayMs', async () => {
  const delays = []; let n = 0;
  await fetchWithRetry('https://example.test/lb', { attempts: 7, baseDelayMs: 5000, maxDelayMs: 60000, fetchImpl: async () => (++n < 7 ? res(502) : okRes), sleep: async (ms) => { delays.push(ms); }, log: quiet });
  assert.deepEqual(delays, [5000, 10000, 20000, 40000, 60000, 60000]);
});

test('payload helpers: owner code precedence and UTC day key', () => {
  assert.equal(extractOwnerCode({ inviteCode: ' ABC12 ', ownerLabel: 'x' }), 'ABC12');
  assert.equal(extractOwnerCode({ ownerLabel: 'Owner' }), 'Owner');
  assert.equal(extractOwnerCode({}), '');
  assert.equal(utcDayKey(new Date(Date.UTC(2026, 10, 1, 0, 50))), '2026-11-01');
});
