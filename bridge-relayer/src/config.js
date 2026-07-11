/**
 * config.js — modular multi-chain relayer configuration.
 *
 * Spokes are declared by SPOKES=bsc,eth,... and each gets its own env block, so
 * adding a chain never touches code:
 *   SPOKE_<ID>_RPC_URL, SPOKE_<ID>_CHAIN_ID, SPOKE_<ID>_PORTAL,
 *   SPOKE_<ID>_WANET, SPOKE_<ID>_START_BLOCK
 *
 * ROLE selects the daemon:
 *   signer     — watches L1 locks, signs bridgeIn attestations, posts them to L1.
 *   submitter  — aggregates M-of-N sigs → portal.bridgeIn; watches spoke
 *                BridgeOut → posts mint-credit (unlock) to L1.
 *   reconciler — periodically checks Σ wANET(spokes) == ANET locked on L1.
 */
import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}
function optional(name, fallback) {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}
function intEnv(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer env var ${name}=${v}`);
  return n;
}

function loadSpokes() {
  const ids = required('SPOKES').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.map((id) => {
    const P = (suffix) => `SPOKE_${id.toUpperCase()}_${suffix}`;
    return {
      id,
      rpcUrl: required(P('RPC_URL')),
      rpcUrlFallback: optional(P('RPC_URL_FALLBACK'), null),
      chainId: intEnv(P('CHAIN_ID'), 0) || Number(required(P('CHAIN_ID'))),
      portal: required(P('PORTAL')),
      wanet: optional(P('WANET'), null),
      startBlock: intEnv(P('START_BLOCK'), 0),
      minConfirmations: intEnv(P('MIN_CONFIRMATIONS'), 12),
    };
  });
}

export const config = {
  role: optional('ROLE', 'reconciler'),

  // L1 hub
  l1BaseUrl: required('ANET_L1_BASE_URL'),
  l1HubChainId: intEnv('L1_HUB_CHAIN_ID', 0) || Number(required('L1_HUB_CHAIN_ID')),

  // Signer identity (M-of-N). Only required for signer/submitter roles.
  signerPrivateKey: optional('SIGNER_PRIVATE_KEY', null),

  // Scan / poll tuning
  scanChunkBlocks: intEnv('SCAN_CHUNK_BLOCKS', 2000),
  pollIntervalMs: intEnv('POLL_INTERVAL_MS', 5000),
  reconcileIntervalMs: intEnv('RECONCILE_INTERVAL_MS', 60000),
  attestationTtlSecs: intEnv('ATTESTATION_TTL_SECS', 3600),

  spokes: loadSpokes(),
};

export function requireSigner() {
  if (!config.signerPrivateKey) {
    throw new Error('SIGNER_PRIVATE_KEY is required for signer/submitter roles');
  }
  return config.signerPrivateKey;
}
