/**
 * index.js — multi-chain bridge relayer orchestrator.
 *
 *   ROLE=signer      independent M-of-N daemon. Watches L1 locks, signs the
 *                    bridgeIn attestation, posts its signature to the L1 hub;
 *                    and (spoke→L1) watches spoke BridgeOut burns and posts its
 *                    own native-ANET mint-credit attestation. Holds ONE signer
 *                    key; can never move funds alone.
 *   ROLE=submitter   aggregates ≥ threshold attestations → portal.bridgeIn on
 *                    the spoke. Pays gas; no signing authority.
 *   ROLE=reconciler  read-only supply-integrity monitor (default).
 *
 * L1→spoke  (bridge-in):  user locks native ANET on L1 → signers attest →
 *                         submitter mints wANET on the spoke.
 * spoke→L1  (bridge-out): user burns wANET on the spoke (BridgeOut event) →
 *                         each signer posts a native-ANET credit attestation →
 *                         the L1 mint-credit endpoint aggregates M-of-N and
 *                         unlocks native ANET (GATED behind ANET_PORTAL_CREDIT_ENABLED).
 */
import { ethers } from 'ethers';
import { config, requireSigner } from './config.js';
import { L1Client, weiToAnts } from './l1.js';
import { makeSpoke, safeHead, scanBridgeOut, portalInfo, submitBridgeIn, isMintConsumed } from './evm.js';
import { signBridgeIn, aggregate, computeMessageId, countValidSigners } from './attest.js';
import { signBridgeInSolana, aggregateSolana, countValidSignersSolana } from './attest-solana.js';
import { anetWalletFromPrivateKey, signPortalMintCredit } from './l1-attest.js';
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

  // spoke→L1 credit attestation is optional: only active when a native-ANET key
  // and the L1 chain_id string are configured.
  const creditEnabled = Boolean(config.creditSignerPrivateKey && config.l1ChainId);
  const creditWallet = creditEnabled ? anetWalletFromPrivateKey(config.creditSignerPrivateKey) : null;
  const creditSpokes = creditEnabled ? config.spokes.map(makeSpoke) : [];
  const creditCursor = new Map(creditSpokes.map((s) => [s.cfg.id, s.cfg.startBlock]));

  log(`signer daemon up as ${wallet.address}${creditEnabled ? ` (credit attester ${creditWallet})` : ''}`);
  for (;;) {
    // ── L1 → spoke: attest pending locks ──────────────────────────────────
    try {
      const locks = await l1.pendingLocks();
      for (const lock of locks) {
        const att = attestationForLock(lock);
        const sig = await signBridgeIn(wallet, att);
        await l1.postLockAttestation(att._lockId, wallet.address, sig);
        log(`signed lock ${att._lockId} -> ${att._spoke.id} (${att.recipient})`);
      }
    } catch (e) { err('signer lock loop:', e.message); }

    // ── spoke → L1: attest BridgeOut burns as native-ANET mint-credits ────
    if (creditEnabled) {
      for (const spoke of creditSpokes) {
        try {
          const head = await safeHead(spoke);
          const from = creditCursor.get(spoke.cfg.id) || spoke.cfg.startBlock;
          if (head < from) continue;
          const events = await scanBridgeOut(spoke, from, head, config.scanChunkBlocks);
          for (const ev of events) {
            const { request } = signPortalMintCredit(config.creditSignerPrivateKey, {
              l1ChainId: config.l1ChainId,
              spokeChainId: Number(ev.spokeChainId),
              spokeTxHash: ev.txHash,
              outId: ev.outId.toString(),
              l1Recipient: ev.l1Recipient,
              amountAnts: weiToAnts(ev.amount), // EVM wANET is 18-dec wei → 8-dec ANTS
            });
            const res = await l1.mintCredit(request);
            log(`credit-attested ${spoke.cfg.id}#${ev.outId} -> L1 ${ev.l1Recipient} [${res.status || 'ok'}]`);
          }
          creditCursor.set(spoke.cfg.id, head + 1);
        } catch (e) { err(`signer credit loop (${spoke.cfg.id}):`, e.message); }
      }
    }

    await sleep(config.pollIntervalMs);
  }
}

async function runSubmitter() {
  const wallet = new ethers.Wallet(requireSigner());
  const l1 = new L1Client(config.l1BaseUrl);
  const spokes = config.spokes.map(makeSpoke);
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

    // spoke → L1 credits are attested by the signer daemons (M-of-N), which the
    // L1 mint-credit endpoint aggregates — the submitter does not post them.

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

/**
 * ROLE=solana — combined signer+submitter for the Solana spoke. Attests
 * L1→Solana locks (and submits when it holds a payer keypair), and posts native
 * -ANET credits for Solana BridgeOut burns. UNTESTED in CI (needs @solana/web3.js,
 * @coral-xyz/anchor, a built IDL and a deployed program) — validate on devnet.
 */
async function runSolana() {
  if (!config.solana) throw new Error('SOLANA_ENABLED is not set (no [solana] config)');
  const sol = config.solana;
  const { makeSolanaContext, portalConfigSolana, isMintedSolana, submitBridgeInSolana, scanBridgeOutSolana } =
    await import('./solana.js');

  const evmWallet = new ethers.Wallet(requireSigner()); // signer identity (EVM addr in the set)
  const l1 = new L1Client(config.l1BaseUrl);
  const ctx = await makeSolanaContext(sol);
  ctx.wanetMint = (await portalConfigSolana(ctx)).wanetMint; // cache mint for ATA derivation
  const creditEnabled = Boolean(config.creditSignerPrivateKey && config.l1ChainId);
  let creditCursor = sol.startSignature;

  log(`solana daemon up (attester ${evmWallet.address}, submit=${ctx.canSubmit}, credit=${creditEnabled})`);

  for (;;) {
    let info;
    try {
      info = await portalConfigSolana(ctx);
      ctx.wanetMint = info.wanetMint;
    } catch (e) { err('solana: read config:', e.message); await sleep(config.pollIntervalMs); continue; }

    // ── L1 → Solana: attest (and maybe submit) locks bound for the SPL wANET ──
    try {
      const locks = await l1.pendingLocks();
      for (const lock of locks) {
        if (Number(lock.dst_chain_id) !== sol.eip712ChainId) continue; // Solana-bound only
        const messageId = computeMessageId(
          config.l1HubChainId, ethers.id(String(lock.l1_tx_id)), BigInt(lock.lock_id));
        const amountAnts = weiToAnts(lock.amount_wei);
        const deadline = BigInt(lock.deadline || Math.floor(Date.now() / 1000) + config.attestationTtlSecs);
        const att = {
          eip712ChainId: info.eip712ChainId,
          verifyingContract: info.verifyingContract,
          messageId,
          srcChainId: config.l1HubChainId,
          recipient: lock.dst_recipient, // base58 Solana pubkey
          amount: amountAnts,
          deadline,
        };
        const sig = await signBridgeInSolana(evmWallet, att);
        await l1.postLockAttestation(lock.lock_id, evmWallet.address, sig);
        log(`solana: attested lock ${lock.lock_id} -> ${lock.dst_recipient}`);

        if (ctx.canSubmit && !info.paused && !(await isMintedSolana(ctx, messageId))) {
          const { signatures } = await l1.lockAttestations(lock.lock_id);
          if (countValidSignersSolana(signatures, att, info.signers) < info.threshold) continue;
          const req = { messageId, srcChainId: att.srcChainId, amount: amountAnts, deadline };
          const txSig = await submitBridgeInSolana(ctx, req, aggregateSolana(signatures), lock.dst_recipient);
          await l1.markMinted(lock.lock_id, txSig, messageId);
          log(`solana: minted lock ${lock.lock_id} tx=${txSig}`);
        }
      }
    } catch (e) { err('solana L1->spoke:', e.message); }

    // ── Solana → L1: attest BridgeOut burns as native-ANET credits ───────────
    if (creditEnabled) {
      try {
        const { events, newestSignature } = await scanBridgeOutSolana(ctx, creditCursor);
        for (const ev of events) {
          const { request } = signPortalMintCredit(config.creditSignerPrivateKey, {
            l1ChainId: config.l1ChainId,
            spokeChainId: sol.eip712ChainId,
            spokeTxHash: ev.signature,
            outId: ev.outId,
            l1Recipient: ev.l1Recipient,
            amountAnts: ev.amountAnts, // Solana wANET is already 8-dec ANTS
          });
          const res = await l1.mintCredit(request);
          log(`solana: credit-attested #${ev.outId} -> L1 ${ev.l1Recipient} [${res.status || 'ok'}]`);
        }
        creditCursor = newestSignature || creditCursor;
      } catch (e) { err('solana spoke->L1:', e.message); }
    }

    await sleep(config.pollIntervalMs);
  }
}

async function main() {
  const solanaOn = config.solana ? ' +solana' : '';
  log(`starting bridge-relayer role=${config.role} spokes=${config.spokes.map((s) => s.id).join(',')}${solanaOn}`);
  switch (config.role) {
    case 'signer': return runSigner();
    case 'submitter': return runSubmitter();
    case 'solana': return runSolana();
    case 'reconciler': return runReconciler();
    default: throw new Error(`unknown ROLE: ${config.role}`);
  }
}

main().catch((e) => { err(e); process.exit(1); });
