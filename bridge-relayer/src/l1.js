/**
 * l1.js — client for the A-Network L1 bridge coordination endpoints.
 *
 * These routes are the L1-hub side of the mint/burn gateway. They are
 * implemented by the anet-chain node in the L1 phase (P3-L1). Documented here
 * as the contract this relayer depends on:
 *
 *   GET  /bridge/x/pending-locks
 *        → [{ lock_id, dst_chain_id, dst_recipient, amount_wei, l1_tx_id, deadline }]
 *        Native ANET LOCKED on L1, awaiting a mint on the destination spoke.
 *
 *   GET  /bridge/x/locks/:id/attestations  → { signatures: [{ signer, sig }] }
 *   POST /bridge/x/locks/:id/attestations  { signer, sig }
 *        M-of-N signature aggregation for a lock's bridgeIn.
 *
 *   POST /bridge/x/locks/:id/minted        { spoke_tx_hash, message_id }
 *        Marks a lock as minted on the spoke (dedup / bookkeeping).
 *
 *   POST /bridge/x/mint-credit             { spoke_chain_id, spoke_tx_hash,
 *        out_id, l1_recipient, amount_ants, attestations: [{signer,sig}] }
 *        A spoke BridgeOut burned wANET → L1 UNLOCKS (credits) native ANET to
 *        l1_recipient after verifying M-of-N + per-message dedup.
 *
 *   GET  /bridge/x/reconciliation
 *        → { locked_ants, per_chain: { <chainId>: minted_ants } }
 */
const ANTS_PER_ANET = 100_000_000n;
const WEI_PER_ANET = 10n ** 18n;

/** wANET is 18-dec wei; native ANET is 8-dec ANTS. Convert 1:1 by value. */
export function weiToAnts(amountWei) {
  return (BigInt(amountWei) * ANTS_PER_ANET) / WEI_PER_ANET;
}
export function antsToWei(amountAnts) {
  return (BigInt(amountAnts) * WEI_PER_ANET) / ANTS_PER_ANET;
}

export class L1Client {
  constructor(baseUrl) {
    this.base = String(baseUrl).replace(/\/+$/, '');
  }

  async _json(path, options = {}) {
    const res = await fetch(this.base + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `L1 ${path} failed (${res.status})`);
    return data;
  }

  pendingLocks() {
    return this._json('/bridge/x/pending-locks');
  }
  lockAttestations(lockId) {
    return this._json(`/bridge/x/locks/${encodeURIComponent(lockId)}/attestations`);
  }
  postLockAttestation(lockId, signer, sig) {
    return this._json(`/bridge/x/locks/${encodeURIComponent(lockId)}/attestations`, {
      method: 'POST',
      body: JSON.stringify({ signer, sig }),
    });
  }
  markMinted(lockId, spokeTxHash, messageId) {
    return this._json(`/bridge/x/locks/${encodeURIComponent(lockId)}/minted`, {
      method: 'POST',
      body: JSON.stringify({ spoke_tx_hash: spokeTxHash, message_id: messageId }),
    });
  }
  mintCredit(payload) {
    return this._json('/bridge/x/mint-credit', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
  reconciliation() {
    return this._json('/bridge/x/reconciliation');
  }
}
