import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
  canonicalJson, anetWalletFromPrivateKey, signPortalMintCredit,
  recoverPortalMintCreditWallet, creditPayload,
} from '../src/l1-attest.js';

const L1_CHAIN = 'anet-private-mainnet-1';
const PRIV = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

function params(overrides = {}) {
  return {
    l1ChainId: L1_CHAIN,
    spokeChainId: 56,
    spokeTxHash: '0xABCDEF0000000000000000000000000000000000000000000000000000000001',
    outId: 'bsc:56:42',
    l1Recipient: 'anet' + 'A'.repeat(36),
    amountAnts: 100n * 100_000_000n,
    nonce: 1_726_000_000_000,
    timestamp: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

test('canonicalJson sorts keys and matches the node format exactly', () => {
  const p = creditPayload(params());
  // keys sorted: amount_ants, l1_recipient, out_id, route, spoke_chain_id, spoke_tx_hash
  const expected =
    '{"amount_ants":10000000000,' +
    `"l1_recipient":"ANET${'A'.repeat(36)}",` +
    '"out_id":"bsc:56:42",' +
    '"route":"portal_mint_credit",' +
    '"spoke_chain_id":56,' +
    '"spoke_tx_hash":"0xabcdef0000000000000000000000000000000000000000000000000000000001"}';
  assert.equal(canonicalJson(p), expected);
});

test('anetWalletFromPrivateKey yields a valid 40-char ANET wallet', () => {
  const w = anetWalletFromPrivateKey(PRIV);
  assert.equal(w.length, 40);
  assert.ok(w.startsWith('ANET'));
  assert.match(w.slice(4), /^[0-9A-F]{36}$/); // uppercase hex only
});

test('signPortalMintCredit round-trips: recovered wallet == signer wallet', () => {
  const { auth } = signPortalMintCredit(PRIV, params());
  const expected = anetWalletFromPrivateKey(PRIV);
  assert.equal(auth.wallet, expected);
  assert.equal(recoverPortalMintCreditWallet(auth), expected);
});

test('action_hash equals SHA256 of the canonical preimage', () => {
  const p = params();
  const { auth } = signPortalMintCredit(PRIV, p);
  const wallet = auth.wallet;
  const payloadCanonical = canonicalJson(creditPayload(p));
  const preimage =
    `action-v1|portal_mint_credit|${wallet}|${p.nonce}|${new Date(p.timestamp).getTime()}|${L1_CHAIN}|${payloadCanonical}`;
  const expected = ethers.sha256(ethers.toUtf8Bytes(preimage)).slice(2);
  assert.equal(auth.action_hash, expected);
});

test('signature is 65 bytes hex without 0x, low-s', () => {
  const { auth } = signPortalMintCredit(PRIV, params());
  assert.match(auth.signature, /^[0-9a-f]{130}$/);
  // low-s: s (bytes 32..64) numeric value <= half order
  const s = BigInt('0x' + auth.signature.slice(64, 128));
  const HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
  assert.ok(s <= HALF_N);
});

test('tampering the amount changes the action_hash (and thus the attestation)', () => {
  const a = signPortalMintCredit(PRIV, params());
  const b = signPortalMintCredit(PRIV, params({ amountAnts: 101n * 100_000_000n }));
  assert.notEqual(a.auth.action_hash, b.auth.action_hash);
});

test('request body carries the exact fields the endpoint expects', () => {
  const { request } = signPortalMintCredit(PRIV, params());
  assert.deepEqual(Object.keys(request).sort(), [
    'amount_ants', 'auth', 'l1_recipient', 'out_id', 'spoke_chain_id', 'spoke_tx_hash',
  ]);
  assert.equal(request.spoke_tx_hash, request.spoke_tx_hash.toLowerCase());
  assert.equal(request.l1_recipient, request.l1_recipient.toUpperCase());
});
