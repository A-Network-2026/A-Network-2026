/**
 * solana.js — Solana spoke poller for the ANET bridge (ROLE=solana).
 *
 * ⚠️  UNTESTED IN CI. This module talks to a DEPLOYED `anet_portal` program and
 * requires optional deps + a built IDL that are NOT part of the relayer's tested
 * core. It is loaded ONLY via dynamic import when ROLE=solana, so `npm test`
 * (the EVM + attestation unit tests) never touches it. Validate it on devnet
 * against a real program before trusting it.
 *
 * Prereqs:
 *   npm i @solana/web3.js @coral-xyz/anchor
 *   SOLANA_ENABLED=1 plus the SOLANA_* env block (see config.js), where
 *   SOLANA_IDL_PATH points at target/idl/anet_portal.json from `anchor build`.
 *
 * Direction mapping (same invariant as the EVM spokes):
 *   L1 → Solana  : attest an L1 lock (EVM-key EIP-712 over BridgeInSol) → the
 *                  program mints SPL wANET 1:1.
 *   Solana → L1  : a BridgeOut burn → post a native-ANET mint-credit to L1.
 */
import { readFileSync } from 'node:fs';

let _mod = null;
async function deps() {
  if (_mod) return _mod;
  const anchor = await import('@coral-xyz/anchor');
  const web3 = await import('@solana/web3.js');
  _mod = { anchor: anchor.default ?? anchor, web3: web3.default ?? web3 };
  return _mod;
}

const CONFIG_SEED = Buffer.from('config');
const MINT_AUTH_SEED = Buffer.from('mint_authority');
const RECEIPT_SEED = Buffer.from('receipt');

function hexToBytes(hex) {
  return Buffer.from(String(hex).replace(/^0x/, ''), 'hex');
}

/** Build the Solana context (connection, program, PDAs). */
export async function makeSolanaContext(solCfg) {
  const { anchor, web3 } = await deps();
  const connection = new web3.Connection(solCfg.rpcUrl, 'confirmed');

  // Payer/signer wallet: only needed to SUBMIT (mint) txs. For pure attestation
  // or scanning a random keypair works (never used to sign a real tx).
  let keypair;
  if (solCfg.walletKeypairPath) {
    const secret = JSON.parse(readFileSync(solCfg.walletKeypairPath, 'utf8'));
    keypair = web3.Keypair.fromSecretKey(Uint8Array.from(secret));
  } else {
    keypair = web3.Keypair.generate();
  }
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  const idl = JSON.parse(readFileSync(solCfg.idlPath, 'utf8'));
  const programId = new web3.PublicKey(solCfg.programId);
  idl.address = programId.toBase58();
  const program = new anchor.Program(idl, provider);

  const [configPda] = web3.PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  const [mintAuthPda] = web3.PublicKey.findProgramAddressSync([MINT_AUTH_SEED], programId);

  return { anchor, web3, connection, program, programId, wallet, configPda, mintAuthPda, canSubmit: Boolean(solCfg.walletKeypairPath) };
}

/** Read the on-chain portal config: signer set, threshold, pause, domain. */
export async function portalConfigSolana(ctx) {
  const cfg = await ctx.program.account.portalConfig.fetch(ctx.configPda);
  const signers = cfg.signers
    .slice(0, cfg.signerCount)
    .map((s) => '0x' + Buffer.from(s).toString('hex'));
  return {
    paused: cfg.paused,
    threshold: Number(cfg.threshold),
    signers,
    wanetMint: cfg.wanetMint,
    eip712ChainId: Number(cfg.eip712ChainId),
    verifyingContract: '0x' + Buffer.from(cfg.eip712VerifyingContract).toString('hex'),
  };
}

/** True if a message_id has already minted (its receipt PDA exists). */
export async function isMintedSolana(ctx, messageIdHex) {
  const { web3 } = ctx;
  const [receiptPda] = web3.PublicKey.findProgramAddressSync(
    [RECEIPT_SEED, hexToBytes(messageIdHex)],
    ctx.programId,
  );
  const info = await ctx.connection.getAccountInfo(receiptPda);
  return info !== null;
}

/** Submit bridge_in: mint SPL wANET against an attested L1 lock. */
export async function submitBridgeInSolana(ctx, req, sigs, recipientBase58) {
  const { anchor, web3, program, programId } = ctx;
  const recipient = new web3.PublicKey(recipientBase58);
  const messageId = hexToBytes(req.messageId);
  const [receiptPda] = web3.PublicKey.findProgramAddressSync([RECEIPT_SEED, messageId], programId);
  const recipientAta = anchor.utils.token.associatedAddress({
    mint: ctx.wanetMint,
    owner: recipient,
  });

  const anchorReq = {
    messageId: Array.from(messageId),
    srcChainId: new anchor.BN(req.srcChainId.toString()),
    recipient: Array.from(recipient.toBuffer()),
    amount: new anchor.BN(req.amount.toString()),
    deadline: new anchor.BN(req.deadline.toString()),
  };
  const anchorSigs = sigs.map((s) => Array.from(s));

  return program.methods
    .bridgeIn(anchorReq, anchorSigs)
    .accounts({
      config: ctx.configPda,
      mintReceipt: receiptPda,
      wanetMint: ctx.wanetMint,
      mintAuthority: ctx.mintAuthPda,
      recipient,
      recipientTokenAccount: recipientAta,
      payer: ctx.wallet.publicKey,
    })
    .rpc();
}

/**
 * Scan program logs for BridgeOut events since `untilSignature` (exclusive).
 * Returns { events, newestSignature }.
 */
export async function scanBridgeOutSolana(ctx, untilSignature, limit = 200) {
  const { anchor, connection, program, programId } = ctx;
  const sigInfos = await connection.getSignaturesForAddress(
    programId,
    { until: untilSignature || undefined, limit },
    'confirmed',
  );
  if (sigInfos.length === 0) return { events: [], newestSignature: untilSignature || null };

  // getSignaturesForAddress returns newest-first; process oldest-first.
  const ordered = [...sigInfos].reverse();
  const parser = new anchor.EventParser(programId, program.coder);
  const events = [];
  for (const si of ordered) {
    if (si.err) continue;
    const tx = await connection.getTransaction(si.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx?.meta?.logMessages || [];
    for (const ev of parser.parseLogs(logs)) {
      if (ev.name !== 'bridgeOut' && ev.name !== 'BridgeOut') continue;
      events.push({
        signature: si.signature,
        outId: ev.data.nonce.toString(),
        from: ev.data.from.toBase58(),
        l1Recipient: ev.data.l1Recipient,
        amountAnts: BigInt(ev.data.amount.toString()), // already 8-dec ANTS
        memo: ev.data.memo,
      });
    }
  }
  return { events, newestSignature: sigInfos[0].signature };
}
