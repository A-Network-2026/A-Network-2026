/**
 * l1-attest.js — native-ANET signer for the spoke→L1 CREDIT direction.
 *
 * When a spoke `BridgeOut` burns wANET, the L1 hub UNLOCKS (credits) native ANET
 * to the user via POST /bridge/x/mint-credit. That endpoint authenticates each
 * attesting relayer with a NATIVE-ANET signed action (NOT EIP-712) whose scheme
 * MUST match anet-chain/src/transaction.rs exactly:
 *
 *   preimage   = "action-v1|portal_mint_credit|<WALLET>|<nonce>|<ts_millis>|<chain_id>|<canonical_json(payload)>"
 *   action_hash = hex_lower( SHA256(preimage) )
 *   signature   = recoverable secp256k1 over the 32-byte SHA256 digest,
 *                 65 bytes r‖s‖recovery_id (low-s / EIP-2), hex WITHOUT 0x.
 *   wallet      = "ANET" + hex_upper( RIPEMD160(compressed_pubkey) )[..36]   (40 chars)
 *
 * The credit direction is GATED OFF on the node (ANET_PORTAL_CREDIT_ENABLED)
 * until reviewed + audited; this module is the off-chain half so the round-trip
 * can be exercised on staging.
 */
import { ethers } from 'ethers';

export const ANET_ADDRESS_PREFIX = 'ANET';
export const CREDIT_ACTION_TYPE = 'portal_mint_credit';

/** Canonical JSON that byte-matches anet-chain `canonical_json_string`:
 *  objects have keys sorted ascending; numbers are minimal decimal; strings are
 *  JSON-escaped; no insignificant whitespace. */
export function canonicalJson(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'bigint') return value.toString();
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number in payload');
    return String(value);
  }
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (t === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  throw new Error(`unsupported value type in canonical JSON: ${t}`);
}

/** Derive the ANET wallet address controlled by a secp256k1 private key. */
export function anetWalletFromPrivateKey(privHex) {
  const sk = new ethers.SigningKey(privHex);
  return anetWalletFromCompressedPubkey(sk.compressedPublicKey);
}

export function anetWalletFromCompressedPubkey(compressedPubHex) {
  const rip = ethers.ripemd160(compressedPubHex); // 0x + 40 hex
  const upper = rip.slice(2).toUpperCase();
  return ANET_ADDRESS_PREFIX + upper.slice(0, 36);
}

/**
 * Build the exact payload the mint-credit endpoint reconstructs & canonicalizes.
 * Field values must match the node's `expected_payload`.
 */
export function creditPayload({ spokeChainId, spokeTxHash, outId, l1Recipient, amountAnts }) {
  return {
    route: CREDIT_ACTION_TYPE,
    spoke_chain_id: Number(spokeChainId),
    spoke_tx_hash: String(spokeTxHash).trim().toLowerCase(),
    out_id: String(outId).trim(),
    l1_recipient: String(l1Recipient).trim().toUpperCase(),
    amount_ants: typeof amountAnts === 'bigint' ? amountAnts : Number(amountAnts),
  };
}

/**
 * Sign a portal_mint_credit attestation with a native-ANET key.
 * @returns { auth, request } — `request` is the full POST body for L1Client.mintCredit.
 */
export function signPortalMintCredit(privHex, params) {
  const { l1ChainId } = params;
  if (!l1ChainId) throw new Error('l1ChainId (the L1 chain_id string) is required');

  const wallet = anetWalletFromPrivateKey(privHex);
  const nonce = params.nonce ?? Date.now();
  const ts = params.timestamp ? new Date(params.timestamp) : new Date();
  const tsMillis = ts.getTime();

  const payload = creditPayload(params);
  const payloadCanonical = canonicalJson(payload);

  const preimage =
    `action-v1|${CREDIT_ACTION_TYPE}|${wallet}|${nonce}|${tsMillis}|${String(l1ChainId).trim()}|${payloadCanonical}`;
  const actionHash = ethers.sha256(ethers.toUtf8Bytes(preimage)); // 0x + 64 hex

  const sk = new ethers.SigningKey(privHex);
  const sig = sk.sign(actionHash); // signs the 32-byte digest; ethers yields low-s
  const sigBytes = ethers.concat([sig.r, sig.s, new Uint8Array([sig.yParity])]);

  const auth = {
    wallet,
    nonce,
    timestamp: ts.toISOString(),
    chain_id: String(l1ChainId).trim(),
    payload,
    signature: ethers.hexlify(sigBytes).slice(2), // hex WITHOUT 0x
    action_hash: actionHash.slice(2),             // lowercase hex WITHOUT 0x
  };

  const request = {
    spoke_chain_id: payload.spoke_chain_id,
    spoke_tx_hash: payload.spoke_tx_hash,
    out_id: payload.out_id,
    l1_recipient: payload.l1_recipient,
    amount_ants: payload.amount_ants,
    auth,
  };
  return { auth, request };
}

/**
 * Recover the ANET wallet that signed an auth (mirrors the node's recovery), for
 * self-checking a bundle before submission.
 */
export function recoverPortalMintCreditWallet(auth) {
  const digest = '0x' + auth.action_hash;
  const sigHex = auth.signature.startsWith('0x') ? auth.signature : '0x' + auth.signature;
  const bytes = ethers.getBytes(sigHex);
  if (bytes.length !== 65) throw new Error('signature must be 65 bytes');
  const r = ethers.hexlify(bytes.slice(0, 32));
  const s = ethers.hexlify(bytes.slice(32, 64));
  let yParity = bytes[64];
  if (yParity === 27 || yParity === 28) yParity -= 27;
  const signature = ethers.Signature.from({ r, s, yParity });
  const uncompressed = ethers.SigningKey.recoverPublicKey(digest, signature);
  const compressed = ethers.SigningKey.computePublicKey(uncompressed, true);
  return anetWalletFromCompressedPubkey(compressed);
}
