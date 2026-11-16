// assets/js/domains.js — .ant name rules, signed payloads and exact ANET/ANTS conversion (no DOM, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read } from './harness.mjs';

const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(read('assets/js/domains.js'), ctx, { filename: 'domains.js' });
const D = ctx.AnetDomains;
// Objects built in the sandbox have its own prototypes; compare plain copies (types are preserved).
const plain = (value) => JSON.parse(JSON.stringify(value));
const ADDRESS = 'ANET' + 'AB12'.repeat(9);

test('normalizeName trims, lowercases A-Z and adds .ant', () => {
  assert.equal(D.normalizeName(' DigitalGold '), 'digitalgold.ant');
  assert.equal(D.normalizeName('a-1.ANT'), 'a-1.ant');
  assert.equal(D.normalizeName('x'.repeat(62)), 'x'.repeat(62) + '.ant');
});

test('normalizeName rejects invalid, punycode and look-alike names', () => {
  // 'd\u0456gitalgold' uses a Cyrillic і; '\uff41net' starts with a full-width ａ.
  for (const name of ['', '.ant', 'a.b.ant', '-a', 'a-', 'xn--80ak6aa92e', 'a b', 'd\u0456gitalgold', '\uff41net', 'a_b', 'x'.repeat(63)]) {
    assert.throws(() => D.normalizeName(name), /\.ant name/, `should reject ${JSON.stringify(name)}`);
  }
});

test('buildPayload returns exactly the payload the node rebuilds', () => {
  assert.deepEqual(plain(D.buildPayload('ant_list', 'Gold', { kind: 'domain-auction', priceAnts: 10000, durationHours: 24 })),
    { route: 'ant_list', name: 'gold.ant', kind: 'domain-auction', price_ants: '10000', duration_hours: 24 });
  assert.deepEqual(plain(D.buildPayload('ant_bid', 'gold.ant', { listingId: 3, amountAnts: 12000 })),
    { route: 'ant_bid', name: 'gold.ant', listing_id: '3', amount_ants: '12000' });
  assert.deepEqual(plain(D.buildPayload('ant_set_primary', '', {})), { route: 'ant_set_primary', name: '' });
  assert.deepEqual(plain(D.buildPayload('ant_transfer', 'gold', { to: ` ${ADDRESS.toLowerCase()} ` })),
    { route: 'ant_transfer', name: 'gold.ant', to: ADDRESS });
  assert.deepEqual(plain(D.buildPayload('ant_list', 'gold', { kind: 'fixed', priceAnts: '5', durationHours: 24 })),
    { route: 'ant_list', name: 'gold.ant', kind: 'fixed', price_ants: '5', duration_hours: 0 }, 'fixed listings never carry a duration');
});

test('buildPayload rejects bad addresses and listing terms before signing', () => {
  assert.throws(() => D.buildPayload('ant_set_resolver', 'gold', { address: 'ANET123' }), /valid ANET address/);
  assert.throws(() => D.buildPayload('ant_list', 'gold', { kind: 'domain-auction', priceAnts: 9999, durationHours: 24 }), /10000 ANTS/);
  assert.throws(() => D.buildPayload('ant_list', 'gold', { kind: 'auction', priceAnts: 1, durationHours: 169 }), /1–168 hours/);
  assert.throws(() => D.buildPayload('ant_bid', 'gold', { listingId: 1, amountAnts: 1.5 }), /whole number/);
});

test('anetToAnts / antsToAnet convert exactly with up to 8 decimals', () => {
  assert.equal(D.anetToAnts('1.5'), '150000000');
  assert.equal(D.anetToAnts('0.00000001'), '1');
  assert.equal(D.anetToAnts('184467440737.09551615'), '18446744073709551615', 'u64 max is exact (no floating point)');
  for (const bad of ['1.123456789', '', '-1', '1e3', '.5', '184467440737.09551616']) assert.throws(() => D.anetToAnts(bad), undefined, bad);
  assert.equal(D.antsToAnet(150000000), '1.50000000');
  assert.equal(D.antsToAnet('1'), '0.00000001');
});
