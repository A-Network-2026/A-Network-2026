// dex-terminal.js — candle building, AMM math, Swap-log decoding, market matching.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deepEqual as looseDeepEqual } from 'node:assert'; // cross-realm (vm) structures
import { loadModules, loadEthers } from './harness.mjs';

const ethers = await loadEthers();
const ctx = loadModules({ solana: false });
const Tm = ctx.AnetTerminal;
const T = Tm.__test;

test('markets reference only tokens the order ticket can trade', () => {
  const oc = ctx.AnetDexOnchain;
  for (const m of Tm.MARKETS) {
    const list = m.chain === 'solana' ? oc.SOL_TOKENS : oc.ONCHAIN_TOKENS[m.chain];
    assert.ok(list, `unknown chain ${m.chain} for ${m.id}`);
    assert.ok(list.some(t => t.symbol === m.base), `${m.id}: base ${m.base} not tradeable`);
    assert.ok(list.some(t => t.symbol === m.quote), `${m.id}: quote ${m.quote} not tradeable`);
    assert.equal(m.id, `${m.chain}:${m.base}/${m.quote}`);
  }
  assert.equal(Tm.MARKETS[0].id, '56:ANET/BNB', 'native token market is the default');
});

test('buildCandles aggregates OHLC per bucket and forward-fills gaps', () => {
  const tf = 60_000;
  const base = 1_700_000_040_000; // bucket-aligned (divisible by 60_000)
  const pts = [
    { t: base + 1_000, p: 10 }, { t: base + 20_000, p: 12 }, { t: base + 50_000, p: 9 }, { t: base + 59_000, p: 11 }, // candle 0
    // candle 1: gap
    { t: base + 2 * tf + 5_000, p: 13, v: 5 }, { t: base + 2 * tf + 6_000, p: 14, v: 7 },                             // candle 2
  ];
  const c = T.buildCandles(pts, tf, { now: base + 2 * tf + 10_000 });
  assert.equal(c.length, 3);
  looseDeepEqual([c[0].o, c[0].h, c[0].l, c[0].c, c[0].n], [10, 12, 9, 11, 4]);
  assert.equal(c[1].filled, true);
  looseDeepEqual([c[1].o, c[1].h, c[1].l, c[1].c], [11, 11, 11, 11], 'gap carries the previous close');
  looseDeepEqual([c[2].o, c[2].h, c[2].l, c[2].c, c[2].v], [13, 14, 13, 14, 12]);
  assert.equal(c[2].t, base + 2 * tf);
});

test('buildCandles extends to "now" and honours maxCandles', () => {
  const tf = 60_000, base = 1_700_000_040_000;
  const pts = [{ t: base, p: 1 }];
  const c = T.buildCandles(pts, tf, { now: base + 5 * tf + 10, maxCandles: 240 });
  assert.equal(c.length, 6, 'one real candle + five carried candles up to now');
  assert.ok(c.slice(1).every(x => x.filled && x.c === 1));
  const capped = T.buildCandles(pts, tf, { now: base + 500 * tf, maxCandles: 50 });
  assert.equal(capped.length, 50);
  assert.equal(capped[0].c, 1, 'seeded from the last point before the visible window');
  looseDeepEqual(T.buildCandles([], tf), []);
  looseDeepEqual(T.buildCandles([{ t: 1, p: 0 }, { t: 2, p: -1 }], tf), [], 'non-positive prices are ignored');
});

test('klinesToCandles maps Binance kline rows', () => {
  const c = T.klinesToCandles([[1700000000000, '1.5', '2', '1', '1.8', '100', 1700000059999, '170', 42]]);
  looseDeepEqual(c, [{ t: 1700000000000, o: 1.5, h: 2, l: 1, c: 1.8, v: 100, n: 42 }]);
});

test('cpmmOut implements x*y=k with the PancakeSwap 0.25% fee', () => {
  // out = in*9975*Rout / (Rin*10000 + in*9975)
  assert.equal(T.cpmmOut(100n, 1000n, 1000n), 90n);
  assert.equal(T.cpmmOut(0n, 1000n, 1000n), 0n);
  assert.equal(T.cpmmOut(100n, 0n, 1000n), 0n);
  // with 0 fee it is the pure constant-product formula
  assert.equal(T.cpmmOut(1000n, 10_000n, 10_000n, 0n), 909n);
  // never more than the reserve
  assert.ok(T.cpmmOut(10n ** 30n, 1000n, 1000n) < 1000n);
});

test('decodeSwapLog decodes real UniswapV2 Swap event data for both token orderings', () => {
  const iface = new ethers.Interface(['event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)']);
  const sender = '0x1111111111111111111111111111111111111111', to = '0x2222222222222222222222222222222222222222';
  const mk = (a0In, a1In, a0Out, a1Out) => {
    const enc = iface.encodeEventLog('Swap', [sender, a0In, a1In, a0Out, a1Out, to]);
    return { data: enc.data, topics: enc.topics, transactionHash: '0xabc', blockNumber: '0x10', logIndex: '0x2' };
  };
  // ANET is token0: user sends 1 WBNB (token1 in) and receives 1000 ANET (token0 out) → BUY
  let d = T.decodeSwapLog(mk(0n, 10n ** 18n, 1000n * 10n ** 18n, 0n), true);
  assert.equal(d.side, 'buy'); assert.equal(d.baseAmt, 1000n * 10n ** 18n); assert.equal(d.quoteAmt, 10n ** 18n);
  assert.equal(d.sender, sender); assert.equal(d.to, to); assert.equal(d.block, 16); assert.equal(d.logIndex, 2);
  // ANET is token0: user sends 500 ANET (token0 in) and receives 0.4 WBNB (token1 out) → SELL
  d = T.decodeSwapLog(mk(500n * 10n ** 18n, 0n, 0n, 4n * 10n ** 17n), true);
  assert.equal(d.side, 'sell'); assert.equal(d.baseAmt, 500n * 10n ** 18n); assert.equal(d.quoteAmt, 4n * 10n ** 17n);
  // ANET is token1: receives ANET as token1 out → BUY
  d = T.decodeSwapLog(mk(10n ** 18n, 0n, 0n, 1000n * 10n ** 18n), false);
  assert.equal(d.side, 'buy'); assert.equal(d.baseAmt, 1000n * 10n ** 18n); assert.equal(d.quoteAmt, 10n ** 18n);
  assert.equal(T.decodeSwapLog({ data: '0x' }, true), null);
});

test('interpolate performs linear interpolation with edge clamping', () => {
  const s = [{ t: 0, p: 10 }, { t: 100, p: 20 }, { t: 200, p: 40 }];
  assert.equal(T.interpolate(s, -5), 10);
  assert.equal(T.interpolate(s, 50), 15);
  assert.equal(T.interpolate(s, 150), 30);
  assert.equal(T.interpolate(s, 999), 40);
  assert.equal(T.interpolate([], 5), null);
});

test('matchMarket maps ticket pairs to a market on the same chain', () => {
  assert.equal(T.matchMarket(56, 'BNB', 'ANET').id, '56:ANET/BNB');
  assert.equal(T.matchMarket(56, 'ANET', 'USDT').id, '56:ANET/USDT');
  assert.equal(T.matchMarket('solana', 'USDC', 'SOL').id, 'solana:SOL/USDC');
  assert.equal(T.matchMarket(1, 'USDT', 'WBTC').chain, 1, 'falls back to a same-chain market');
  assert.equal(T.matchMarket(999, 'A', 'B'), null);
});

test('formatters are stable', () => {
  assert.equal(T.fmtUsd(1234.5), '$1,235');
  assert.equal(T.fmtUsd(12.345), '$12.35');
  assert.equal(T.fmtUsd(0.012345), '$0.0123');
  assert.equal(T.fmtCompactUsd(1_250_000), '$1.25M');
  assert.equal(T.fmtCompactUsd(3_400), '$3.4K');
  assert.equal(T.fmtPrice(0.000012345), '0.000012345');
  assert.equal(T.bucketStart(1_700_000_059_999, 60_000), 1_700_000_040_000);
  assert.ok(T.niceStep(100, 5) === 20);
});

/* ── Official logos + TradingView chart helpers ─────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './harness.mjs';

test('every market asset and network has a self-hosted official logo file', () => {
  const seen = new Set();
  for (const m of Tm.MARKETS) {
    for (const sym of [m.base, m.quote]) {
      const src = T.tokenLogo(sym);
      assert.ok(src, `no logo mapped for ${sym}`);
      assert.ok(fs.existsSync(path.join(ROOT, src)), `missing file ${src}`);
      seen.add(src);
    }
    const c = T.chainLogo(m.chain);
    assert.ok(c && fs.existsSync(path.join(ROOT, c)), `missing network logo for chain ${m.chain}`);
  }
  assert.ok(seen.size >= 8, 'expected at least 8 distinct token logos');
  // files are real PNGs
  for (const src of seen) {
    const head = fs.readFileSync(path.join(ROOT, src)).subarray(0, 8);
    assert.equal(head.toString('hex'), '89504e470d0a1a0a', `${src} is not a PNG`);
  }
  assert.equal(T.tokenLogo('NOPE'), null);
  assert.equal(T.chainLogo(999), null);
});

test('logoHtml renders an <img> with an optional network badge, or initials when unknown', () => {
  const html = T.logoHtml('ANET', { size: 24, chain: 56 });
  assert.match(html, /<img src="assets\/img\/tokens\/anet\.png" alt="ANET logo" width="24" height="24"/);
  assert.match(html, /tm-chain-badge" src="assets\/img\/chains\/bnb\.png" alt="BNB Chain"/);
  const plain = T.logoHtml('USDC', { size: 20 });
  assert.ok(!plain.includes('tm-chain-badge'));
  const fb = T.logoHtml('<xyz>', { size: 20 });
  assert.match(fb, /tm-logo-fallback/);
  assert.ok(!fb.includes('<xyz>'), 'symbol must be escaped in the fallback');
  assert.ok(fb.includes('&lt;x'));
});

test('minMoveFor picks a sensible tick size per price magnitude', () => {
  assert.equal(T.minMoveFor(78000), 0.01);
  assert.equal(T.minMoveFor(7.7), 0.0001);
  assert.equal(T.minMoveFor(0.05), 0.000001);
  assert.equal(T.minMoveFor(0.00002), 0.00000001);
});
