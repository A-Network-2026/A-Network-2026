// dex-bridge.js — export bridge (ANET L1 → wANET on BNB Chain) pure logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deepEqual as looseDeepEqual } from 'node:assert';
import { loadModules } from './harness.mjs';

const ctx = loadModules({ solana: false, wallet: true });
const B = ctx.AnetBridge;
const T = B.__test;
const ANTS = 100_000_000;

test('module boots headless and exposes constants that mirror anet-chain', () => {
  assert.ok(B);
  assert.equal(B.MIN_SESSIONS, 1000);          // activation::MIN_SESSIONS_FOR_ANET
  assert.equal(B.FEE_ANTS, 1000);              // transaction::MIN_FEE_ANTS
  assert.equal(B.PER_TX_CAP_ANET, 10_000);     // ANET_BRIDGE_MAX_BURN_PER_TX_ANET default
  assert.equal(B.VAULT, '0x31438362a7667ce5559500023D025c7c14168B49');
  assert.equal(B.WANET, '0x791055A7d52AA392eaE8De04250497f33807E46A');
  assert.equal(B.state.gate, 'unreachable', 'network is disabled in tests → gate must report unreachable, never "live"');
});

test('anetToAnts converts human ANET to integer ants safely', () => {
  assert.equal(T.anetToAnts('1.5'), 150_000_000);
  assert.equal(T.anetToAnts('0.00000001'), 1);
  assert.equal(T.anetToAnts('10000'), 10_000 * ANTS);
  assert.equal(T.anetToAnts('1.123456789'), 112_345_678, 'extra precision is truncated, never rounded up');
  assert.equal(T.anetToAnts('abc'), 0);
  assert.equal(T.anetToAnts('1e3'), 0);
  assert.equal(T.anetToAnts('99999999999'), 0, 'beyond 2^53 ants is rejected');
});

test('exportLimits enforces sessions, vesting lock, validator fee and the per-tx cap', () => {
  const base = { ants_balance: 50 * ANTS, sessions: 1200, swap_locked_ants: 0, swap_vested_bps: 10_000 };
  let l = T.exportLimits(base);
  assert.equal(l.eligible, true);
  assert.equal(l.maxAnts, 50 * ANTS - 1000, 'validator fee reserved');
  l = T.exportLimits({ ...base, sessions: 999 });
  assert.equal(l.eligible, false);
  assert.match(l.reasons[0], /1,000 on-chain sessions/);
  l = T.exportLimits({ ...base, swap_locked_ants: 20 * ANTS });
  assert.equal(l.maxAnts, 30 * ANTS - 1000, 'locked (vesting) ants cannot be exported');
  l = T.exportLimits({ ...base, ants_balance: 50_000 * ANTS });
  assert.equal(l.maxAnts, 10_000 * ANTS, 'capped per transaction');
  l = T.exportLimits({ ...base, ants_balance: 500 });
  assert.equal(l.eligible, false);
  assert.equal(l.maxAnts, 0);
  l = T.exportLimits(null);
  assert.equal(l.eligible, false);
});

test('validateBurn rejects bad input before anything is signed', () => {
  const limits = T.exportLimits({ ants_balance: 100 * ANTS, sessions: 5000, swap_locked_ants: 0 });
  const to = '0x9C7C1058fdc9b710f688ECb7562924D9AE771417';
  assert.equal(T.validateBurn({ amountAnts: 0, recipient: to, limits }), 'Enter an amount to export.');
  assert.match(T.validateBurn({ amountAnts: ANTS, recipient: 'ANET123', limits }), /valid BNB Chain address/);
  assert.match(T.validateBurn({ amountAnts: 10_001 * ANTS, recipient: to, limits: null }), /cap is 10,000 ANET/);
  assert.match(T.validateBurn({ amountAnts: 100 * ANTS, recipient: to, limits }), /exceeds what this wallet can export/);
  assert.equal(T.validateBurn({ amountAnts: 10 * ANTS, recipient: to, limits }), null);
  assert.equal(T.isBsc('0x9c7c1058fdc9b710f688ecb7562924d9ae771417'), true);
  assert.equal(T.isBsc('0x123'), false);
});

test('bridge_burn payload canonicalizes byte-for-byte like anet-chain canonical_json_string', () => {
  const payload = T.burnPayload(' anet1abc ', '0x9C7C1058fdc9b710f688ECb7562924D9AE771417', 150_000_000);
  looseDeepEqual(payload, { route: 'bridge_burn', sender: 'ANET1ABC', bsc_recipient: '0x9c7c1058fdc9b710f688ecb7562924d9ae771417', amount_ants: 150_000_000, token_symbol: 'ANET' });
  // The wallet's canonicalJson is what gets signed; the L1 rebuilds the same object with
  // serde_json::json!() and compares canonical strings (sorted keys, verbatim integers).
  const canon = ctx.AnetWallet.canonicalJson(payload);
  assert.equal(canon, '{"amount_ants":150000000,"bsc_recipient":"0x9c7c1058fdc9b710f688ecb7562924d9ae771417","route":"bridge_burn","sender":"ANET1ABC","token_symbol":"ANET"}');
  assert.equal(typeof payload.amount_ants, 'number', 'amount_ants must be a JSON number (u64 on the L1), not a string');
});

test('statusMeta maps L1 burn statuses to UI labels', () => {
  assert.equal(T.statusMeta('released').cls, 'green');
  assert.equal(T.statusMeta('failed').cls, 'red');
  assert.equal(T.statusMeta('pending').label, 'Pending release');
  assert.equal(T.statusMeta('').label, 'Unknown');
});
