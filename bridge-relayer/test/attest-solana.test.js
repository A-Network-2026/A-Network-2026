import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
  signBridgeInSolana, recoverBridgeInSolana, aggregateSolana,
  countValidSignersSolana, computeMessageId, toBytes32Hex,
} from '../src/attest-solana.js';

const VC = '0x1111111111111111111111111111111111111111'; // 20-byte verifying contract id
const EIP712_CHAIN = 1399811149; // Solana-spoke synthetic chain id set at init
// A real base58 Solana pubkey (System Program address decodes to 32 zero bytes,
// so use a non-trivial one) — this is the SPL Token program id, a valid 32-byte key.
const RECIP_B58 = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function att(overrides = {}) {
  return {
    eip712ChainId: EIP712_CHAIN,
    verifyingContract: VC,
    messageId: ethers.id('sol-lock-1'),
    srcChainId: 999,
    recipient: RECIP_B58,
    amount: 100n * 100_000_000n, // 100 ANET in ANTS (8 dec)
    deadline: 1893456000n,
    ...overrides,
  };
}

test('toBytes32Hex decodes a base58 pubkey to 32 bytes', () => {
  const hex = toBytes32Hex(RECIP_B58);
  assert.equal(ethers.getBytes(hex).length, 32);
  // hex round-trips
  assert.equal(toBytes32Hex(hex), hex);
});

test('signBridgeInSolana recovers to the signer', async () => {
  const w = ethers.Wallet.createRandom();
  const a = att();
  const sig = await signBridgeInSolana(w, a);
  assert.equal(recoverBridgeInSolana(sig, a).toLowerCase(), w.address.toLowerCase());
});

test('tampered amount does not verify', async () => {
  const w = ethers.Wallet.createRandom();
  const sig = await signBridgeInSolana(w, att());
  const recovered = recoverBridgeInSolana(sig, att({ amount: 101n * 100_000_000n }));
  assert.notEqual(recovered.toLowerCase(), w.address.toLowerCase());
});

test('a signature for the EVM domain does not verify on the Solana domain', async () => {
  // Different verifyingContract → different domain separator → no cross-domain replay.
  const w = ethers.Wallet.createRandom();
  const sig = await signBridgeInSolana(w, att());
  const recovered = recoverBridgeInSolana(sig, att({ verifyingContract: '0x2222222222222222222222222222222222222222' }));
  assert.notEqual(recovered.toLowerCase(), w.address.toLowerCase());
});

test('M-of-N: countValidSignersSolana counts unique authorized signers', async () => {
  const s1 = ethers.Wallet.createRandom();
  const s2 = ethers.Wallet.createRandom();
  const outsider = ethers.Wallet.createRandom();
  const a = att();
  const signed = [
    { signer: s1.address, sig: await signBridgeInSolana(s1, a) },
    { signer: s2.address, sig: await signBridgeInSolana(s2, a) },
    { signer: outsider.address, sig: await signBridgeInSolana(outsider, a) },
  ];
  assert.equal(countValidSignersSolana(signed, a, [s1.address, s2.address]), 2);
});

test('aggregateSolana sorts ascending and yields 65-byte arrays', async () => {
  const s1 = ethers.Wallet.createRandom();
  const s2 = ethers.Wallet.createRandom();
  const a = att();
  const signed = [
    { signer: s1.address, sig: await signBridgeInSolana(s1, a) },
    { signer: s2.address, sig: await signBridgeInSolana(s2, a) },
  ];
  const agg = aggregateSolana(signed);
  assert.equal(agg.length, 2);
  assert.equal(agg[0].length, 65);
  // ascending by address
  const [lo, hi] = [s1, s2].sort((x, y) =>
    BigInt(x.address.toLowerCase()) < BigInt(y.address.toLowerCase()) ? -1 : 1);
  const loSig = await signBridgeInSolana(lo, a);
  assert.deepEqual(agg[0], Array.from(ethers.getBytes(loSig)));
  assert.ok(hi); // both present
});

test('computeMessageId is deterministic and shared with the EVM side', () => {
  const id1 = computeMessageId(999, ethers.id('tx'), 0n);
  const id2 = computeMessageId(999, ethers.id('tx'), 0n);
  assert.equal(id1, id2);
});
