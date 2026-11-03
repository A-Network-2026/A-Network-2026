// assets/js/reserves.js: proof-of-reserves decoding and reconciliation logic (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, loadEthers } from './harness.mjs';

const ethers = await loadEthers();
const ctx = loadModules({ solana: false, bridge: false, reserves: true });
const R = ctx.AnetReserves; const T = R.__test;
const WEI = 10n ** 18n;

test('published facts match the whitepaper and every selector/topic equals keccak256', () => {
  assert.equal(R.PUB.evmTreasury, '0x9C7C1058fdc9b710f688ECb7562924D9AE771417');
  assert.equal(R.PUB.solTreasury, '7j33RFPkNvaKsPuz2qJ5SzwiwXA4iL12ujqM4g2tRLEz');
  assert.equal(R.PUB.btcTreasury, 'bc1qrqunzzv8dsr5dxdrlq5gcex93rh7w0tqawfhf4');
  assert.equal(R.PUB.vault, '0x31438362a7667ce5559500023D025c7c14168B49');
  assert.equal(R.PUB.maxSupplyAnet, 21_000_000);
  for (const [k, sig] of Object.entries(T.SEL_SIG)) assert.equal(T.SEL[k], ethers.id(sig).slice(0, 10), `selector ${k}`);
  assert.equal(T.TOPIC_TRANSFER, ethers.id('Transfer(address,address,uint256)'));
  assert.equal(T.TOPIC_RELEASED, ethers.id('Released(uint256,address,uint256,string,uint256)'));
});

test('decodeTransfers / decodeReleased decode real ABI-encoded logs', () => {
  const erc20 = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
  const from = '0x1A1AFE5BF1ffDB64aC10958cCe2D06B22Fb47Fb8', to = R.PUB.evmTreasury;
  const enc = erc20.encodeEventLog('Transfer', [from, to, 5n * WEI]);
  const [t] = T.decodeTransfers([{ topics: enc.topics, data: enc.data, blockNumber: '0x5f5e100', transactionHash: '0xabc', logIndex: '0x3' }]);
  assert.equal(t.from.toLowerCase(), from.toLowerCase()); assert.equal(t.to.toLowerCase(), to.toLowerCase());
  assert.equal(t.value, 5n * WEI); assert.equal(t.block, 100_000_000); assert.equal(t.logIndex, 3);
  const vault = new ethers.Interface(['event Released(uint256 indexed burnId, address indexed recipient, uint256 amount, string l1Sender, uint256 signaturesUsed)']);
  const rel = vault.encodeEventLog('Released', [7n, to, 100n * WEI, 'ANETABC', 2n]);
  const [r] = T.decodeReleased([{ topics: rel.topics, data: rel.data, blockNumber: '0x10', transactionHash: '0xdef' }]);
  assert.equal(r.burnId, 7n); assert.equal(r.recipient.toLowerCase(), to.toLowerCase()); assert.equal(r.amount, 100n * WEI);
  assert.deepEqual(T.decodeTransfers([{ topics: ['0x1'], data: '0x' }]), [], 'malformed logs are skipped');
});

test('aggregateBySender sums per sender, labels known fee origins and sorts by total', () => {
  const swap = '0x1a1afe5bf1ffdb64ac10958cce2d06b22fb47fb8', other = '0x2222222222222222222222222222222222222222';
  const rows = T.aggregateBySender([
    { from: swap, value: 1n * WEI, block: 10 }, { from: other, value: 5n * WEI, block: 12 }, { from: swap, value: 2n * WEI, block: 11 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sender, other); assert.equal(rows[0].total, 5n * WEI); assert.equal(rows[0].label, null);
  assert.equal(rows[1].total, 3n * WEI); assert.equal(rows[1].count, 2); assert.equal(rows[1].lastBlock, 11);
  assert.match(rows[1].label, /AnetSwap/);
});

test('reconcileVault: the vault may never hold less than the published escrow; a surplus passes and is disclosed', () => {
  const published = 10_499_798n * WEI + 20348n * 10n ** 12n; // 10,499,798.020348
  const ok = T.reconcileVault({ balance: published - 100n * WEI, totalReleased: 100n * WEI, releasedEvents: [{ amount: 100n * WEI }], publishedEscrowWei: published });
  assert.equal(ok.escrowMatchesPublished, true); assert.equal(ok.eventsMatchCounter, true); assert.equal(ok.l1Matches, null);
  // live mainnet case: the 100 wANET released once was returned to the vault → surplus of exactly totalReleased
  const returned = T.reconcileVault({ balance: published, totalReleased: 100n * WEI, releasedEvents: [{ amount: 100n * WEI }], publishedEscrowWei: published });
  assert.equal(returned.escrowMatchesPublished, true); assert.equal(returned.surplus, 100n * WEI); assert.equal(returned.shortfall, 0n);
  // live mainnet (Nov 2026): 100 wANET deposited after publication, 10 gwei canary released → surplus passes and is disclosed
  const live = T.reconcileVault({ balance: 10499898020348679198304077n, totalReleased: 10000000000n, releasedEvents: [{ amount: 10000000000n }], publishedEscrowWei: published });
  assert.equal(live.escrowMatchesPublished, true); assert.ok(live.surplus > 99n * WEI && live.surplus < 101n * WEI); assert.equal(live.eventsMatchCounter, true);
  // any shortfall beyond 1 wANET of rounding fails
  const shortfall = T.reconcileVault({ balance: published - 2n * WEI, totalReleased: 0n, releasedEvents: [], publishedEscrowWei: published });
  assert.equal(shortfall.escrowMatchesPublished, false); assert.equal(shortfall.shortfall, 2n * WEI);
  const drained = T.reconcileVault({ balance: published - 1000n * WEI, totalReleased: 100n * WEI, releasedEvents: [{ amount: 100n * WEI }], publishedEscrowWei: published });
  assert.equal(drained.escrowMatchesPublished, false, '900 wANET missing must fail');
  const hidden = T.reconcileVault({ balance: published - 100n * WEI, totalReleased: 100n * WEI, releasedEvents: [], publishedEscrowWei: published });
  assert.equal(hidden.eventsMatchCounter, false, 'counter moved without events must fail');
  const l1 = T.reconcileVault({ balance: published - 100n * WEI, totalReleased: 100n * WEI, releasedEvents: [{ amount: 100n * WEI }], publishedEscrowWei: published, l1Released: 1 });
  assert.equal(l1.l1Matches, true);
  // tolerance: the published figure is rounded to 6 decimals; sub-1-wANET drift is fine
  const dust = T.reconcileVault({ balance: published + 10n ** 17n, totalReleased: 0n, releasedEvents: [], publishedEscrowWei: published });
  assert.equal(dust.escrowMatchesPublished, true);
});

test('supplyChecks enforces the 21,000,000 cap on both assets', () => {
  const s = T.supplyChecks({ activatedAnts: 23_959_021_715, bep20SupplyWei: 21_000_000n * WEI, maxSupplyAnet: 21_000_000 });
  assert.equal(s.activatedAnet, 239.59021715); assert.equal(s.activatedUnderCap, true); assert.equal(s.bep20EqualsCap, true);
  assert.equal(T.supplyChecks({ activatedAnts: 2_200_000_000_000_000, bep20SupplyWei: 21_000_000n * WEI, maxSupplyAnet: 21_000_000 }).activatedUnderCap, false);
  assert.equal(T.supplyChecks({ activatedAnts: 0, bep20SupplyWei: 21_000_001n * WEI, maxSupplyAnet: 21_000_000 }).bep20EqualsCap, false);
});

test('helpers: bech32 validation, topic padding, sha256', async () => {
  assert.equal(T.isBech32Btc('bc1qrqunzzv8dsr5dxdrlq5gcex93rh7w0tqawfhf4'), true);
  assert.equal(T.isBech32Btc('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'), false);
  assert.equal(T.isBech32Btc('bc1qINVALID'), false);
  assert.equal(T.topicAddr(R.PUB.evmTreasury), '0x0000000000000000000000009c7c1058fdc9b710f688ecb7562924d9ae771417');
  assert.equal(T.addrFromTopic(T.topicAddr(R.PUB.evmTreasury)).toLowerCase(), R.PUB.evmTreasury.toLowerCase());
  assert.equal(T.fromUnits(1_500_000n, 6), 1.5);
  assert.equal(await T.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
