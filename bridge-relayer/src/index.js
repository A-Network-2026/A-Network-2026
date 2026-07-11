/**
 * index.js — multi-chain bridge relayer orchestrator.
 *
 *   ROLE=signer      independent M-of-N daemon. Watches L1 locks, signs the
 *                    bridgeIn attestation, posts its signature to the L1 hub.
 *                    Holds ONE signer key; can never move funds alone.
 *   ROLE=submitter   aggregates ≥ threshold attestations → portal.bridgeIn on
 *                    the spoke; and relays spoke BridgeOut → L1 mint-credit
 *                    (unlock native ANET). Pays gas; no signing authority.
 *   ROLE=reconciler  read-only supply-integrity monitor (default).
 *
 * L1→spoke  (bridge-in):  user locks native ANET on L1 → signers attest →
 *                         submitter mints wANET on the spoke.
 * spoke→L1  (bridge-out): user burns wANET on the spoke (BridgeOut event) →
 *                         submitter posts it → L1 unlocks native ANET.
 */
import { ethers } from 'ethers';
import { config, requireSigner } from './config.js';
import { L1Client } from './l1.js';
import { makeSpoke, safeHead, scanBridgeOut, portalInfo, submitBridgeIn, isMintConsumed } from './evm.js';
import { signBridgeIn, aggregate, computeMessageId, countValidSigners } from './attest.js';
import { reconcile } from './reconcile.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const err = (...a) => console.error(new Date().toISOString(), 'ERROR', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function spokeByChainId(chainId) {
  return config.spokes.find((s) => Number(s.chainId) === Number(chainId));
}

/** Build the on-chain attestation object for an L1 lock destined to a spoke. */
function attestationForLock(lock) {
  const spoke = spokeByChainId(lock.dst_chain_id);
  if (!spoke) throw new Error(`no spoke configured for chainId ${lock.dst_chain_id}`);
  const messageId = computeMessageId(
    config.l1HubChainId,
    ethers.id(String(lock.l1_tx_id)),
    BigInt(lock.lock_id)
  );
  const deadline = BigInt(lock.deadline || Math.floor(Date.now() / 1000) + config.attestationTtlSecs);
  return {
    portalAddress: spoke.portal,
    spokeChainId: spoke.chainId,
    messageId,
    srcChainId: config.l1HubChainId,
    recipient: lock.dst_recipient,
    amount: BigInt(lock.amount_wei),
    deadline,
    memo: `L1 lock ${lock.l1_tx_id}`,
    _spoke: spoke,
    _lockId: lock.lock_id,
  };
}

async function runSigner() {
  const wallet = new ethers.Wallet(requireSigner());
  const l1 = new L1Client(config.l1BaseUrl);
  log(`signer daemon up as ${wallet.address}`);
  for (;;) {
    try {
      const locks = await l1.pendingLocks();
      for (const lock of locks) {
        const att = attestationForLock(lock);
        const sig = await signBridgeIn(wallet, att);
        await l1.postLockAttestation(att._lockId, wallet.address, sig);
        log(`signed lock ${att._lockId} -> ${att._spoke.id} (${att.recipient})`);
      }
    } catch (e) { err('signer loop:', e.message); }
    await sleep(config.pollIntervalMs);
  }
}

async function runSubmitter() {
  const wallet = new ethers.Wallet(requireSigner());
  const l1 = new L1Client(config.l1BaseUrl);
  const spokes = config.spokes.map(makeSpoke);
  const cursor = new Map(spokes.map((s) => [s.cfg.id, s.cfg.startBlock]));
  log(`submitter up as ${wallet.address}`);

  for (;;) {
    // ── L1 → spoke: aggregate attested locks and mint ──────────────────────
    try {
      const locks = await l1.pendingLocks();
      for (const lock of locks) {
        const att = attestationForLock(lock);
        if (await isMintConsumed(att._spoke, att.messageId)) continue;
        const info = await portalInfo(att._spoke);
        if (info.paused) continue;
        const { signatures } = await l1.lockAttestations(att._lockId);
        const valid = countValidSigners(signatures, att, info.signers);
        if (BigInt(valid) < info.threshold) continue;
        const req = {
          messageId: att.messageId,
          srcChainId: att.srcChainId,
          recipient: att.recipient,
          amount: att.amount,
          deadline: att.deadline,
          memo: att.memo,
        };
        const rcpt = await submitBridgeIn(att._spoke, wallet, req, aggregate(signatures));
        await l1.markMinted(att._lockId, rcpt.hash, att.messageId);
        log(`minted lock ${att._lockId} on ${att._spoke.id} tx=${rcpt.hash}`);
      }
    } catch (e) { err('submitter L1->spoke:', e.message); }

    // ── spoke → L1: relay BridgeOut burns to the L1 unlock endpoint ─────────
    for (const spoke of spokes) {
      try {
        const head = await safeHead(spoke);
        const from = cursor.get(spoke.cfg.id) || spoke.cfg.startBlock;
        if (head < from) continue;
        const events = await scanBridgeOut(spoke, from, head, config.scanChunkBlocks);
        for (const ev of events) {
          await l1.mintCredit({
            spoke_chain_id: Number(ev.spokeChainId),
            spoke_tx_hash: ev.txHash,
            out_id: ev.outId.toString(),
            l1_recipient: ev.l1Recipient,
            amount_wei: ev.amount.toString(),
            memo: ev.memo,
          });
          log(`relayed BridgeOut ${spoke.cfg.id}#${ev.outId} -> L1 ${ev.l1Recipient}`);
        }
        cursor.set(spoke.cfg.id, head + 1);
      } catch (e) { err(`submitter spoke->L1 (${spoke.cfg.id}):`, e.message); }
    }

    await sleep(config.pollIntervalMs);
  }
}

async function runReconciler() {
  const l1 = new L1Client(config.l1BaseUrl);
  log('reconciler up');
  for (;;) {
    try {
      const report = await reconcile(config, l1);
      log('reconcile', JSON.stringify(report));
      if (!report.ok) err('SUPPLY INVARIANT VIOLATED', report.alerts.join(' | '));
    } catch (e) { err('reconcile loop:', e.message); }
    await sleep(config.reconcileIntervalMs);
  }
}

async function main() {
  log(`starting bridge-relayer role=${config.role} spokes=${config.spokes.map((s) => s.id).join(',')}`);
  switch (config.role) {
    case 'signer': return runSigner();
    case 'submitter': return runSubmitter();
    case 'reconciler': return runReconciler();
    default: throw new Error(`unknown ROLE: ${config.role}`);
  }
}

main().catch((e) => { err(e); process.exit(1); });
