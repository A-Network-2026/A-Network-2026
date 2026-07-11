import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
  signBridgeIn, recoverBridgeIn, aggregate, computeMessageId, countValidSigners, domain, message,
} from '../src/attest.js';

const PORTAL = '0x1111111111111111111111111111111111111111';
const SPOKE_CHAIN = 1; // Ethereum
const RECIP = '0x2222222222222222222222222222222222222222';

function att(overrides = {}) {
  return {
    portalAddress: PORTAL,
    spokeChainId: SPOKE_CHAIN,
    messageId: ethers.id('lock-1'),
    srcChainId: 999,
    recipient: RECIP,
    amount: ethers.parseEther('100'),
    deadline: 1893456000n,
    ...overrides,
  };
}

test('signBridgeIn recovers to the signer (matches on-chain domain/typehash)', async () => {
  const w = ethers.Wallet.createRandom();
  const a = att();
  const sig = await signBridgeIn(w, a);
  assert.equal(recoverBridgeIn(sig, a).toLowerCase(), w.address.toLowerCase());
});

test('a signature does not verify against a tampered amount', async () => {
  const w = ethers.Wallet.createRandom();
  const a = att();
  const sig = await signBridgeIn(w, a);
  const recovered = recoverBridgeIn(sig, att({ amount: ethers.parseEther('101') }));
  assert.notEqual(recovered.toLowerCase(), w.address.toLowerCase());
});

test('a signature does not verify on a different spoke chain (no cross-chain replay)', async () => {
  const w = ethers.Wallet.createRandom();
  const a = att();
  const sig = await signBridgeIn(w, a);
  const recovered = recoverBridgeIn(sig, att({ spokeChainId: 56 }));
  assert.notEqual(recovered.toLowerCase(), w.address.toLowerCase());
});

test('computeMessageId is deterministic and unique per (chain, tx, index)', () => {
  const tx = ethers.id('l1-tx-abc');
  const a = computeMessageId(999, tx, 1n);
  const b = computeMessageId(999, tx, 1n);
  const c = computeMessageId(999, tx, 2n);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('aggregate sorts signatures ascending by signer (contract requirement)', () => {
  const signed = [
    { signer: '0xCC00000000000000000000000000000000000000', sig: '0xcc' },
    { signer: '0xAA00000000000000000000000000000000000000', sig: '0xaa' },
    { signer: '0xBB00000000000000000000000000000000000000', sig: '0xbb' },
  ];
  assert.deepEqual(aggregate(signed), ['0xaa', '0xbb', '0xcc']);
});

test('countValidSigners counts unique allowed signers only', async () => {
  const w1 = ethers.Wallet.createRandom();
  const w2 = ethers.Wallet.createRandom();
  const outsider = ethers.Wallet.createRandom();
  const a = att();
  const signed = [
    { signer: w1.address, sig: await signBridgeIn(w1, a) },
    { signer: w2.address, sig: await signBridgeIn(w2, a) },
    { signer: w1.address, sig: await signBridgeIn(w1, a) }, // duplicate → not double-counted
    { signer: outsider.address, sig: await signBridgeIn(outsider, a) }, // not a signer
  ];
  const n = countValidSigners(signed, a, [w1.address, w2.address]);
  assert.equal(n, 2);
});

test('domain + message shape are correct types', () => {
  const d = domain(PORTAL, SPOKE_CHAIN);
  assert.equal(d.name, 'AnetMintBurnPortal');
  assert.equal(d.version, '1');
  assert.equal(d.chainId, 1n);
  const m = message(att());
  assert.equal(typeof m.amount, 'bigint');
  assert.equal(m.recipient, ethers.getAddress(RECIP));
});
