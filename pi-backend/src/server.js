const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const PI_API_KEY = process.env.PI_API_KEY || '';
const PI_API_BASE_URL = (process.env.PI_API_BASE_URL || 'https://api.minepi.com').replace(/\/$/, '');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const PI_SANDBOX = (process.env.PI_SANDBOX || 'false').toLowerCase() === 'true';
const PI_ENABLE_TEST_ADMIN = (process.env.PI_ENABLE_TEST_ADMIN || (PI_SANDBOX ? 'true' : 'false')).toLowerCase() === 'true';
const PI_ALLOW_TEST_ASSET_MINT = (process.env.PI_ALLOW_TEST_ASSET_MINT || (PI_SANDBOX ? 'true' : 'false')).toLowerCase() === 'true';
const PI_ALLOWED_METADATA_APP = process.env.PI_ALLOWED_METADATA_APP || 'a-network-testnet';
const PI_ALLOWED_METADATA_PURPOSE = process.env.PI_ALLOWED_METADATA_PURPOSE || 'dex-lifetime-unlock';
const PI_ALLOWED_SANDBOX_METADATA_PURPOSE = process.env.PI_ALLOWED_SANDBOX_METADATA_PURPOSE || 'sandbox-test-payment';
const PI_ALLOWED_MEMO_PREFIX = process.env.PI_ALLOWED_MEMO_PREFIX || 'A Network';
const PI_APP_WALLET = process.env.PI_APP_WALLET || '';
const PI_REQUIRED_AMOUNT = Number(process.env.PI_REQUIRED_AMOUNT || 1);
const PI_MIN_AMOUNT = Number(process.env.PI_MIN_AMOUNT || 1);
const PI_MAX_AMOUNT = Number(process.env.PI_MAX_AMOUNT || 1);
const PI_CASHOUT_STATE_PATH = process.env.PI_CASHOUT_STATE_PATH || path.join(__dirname, '..', 'data', 'dex-access-state.json');
const PI_ADMIN_KEY = process.env.PI_ADMIN_KEY || '';
const ANET_CHAIN_API_BASE_URL = (process.env.ANET_CHAIN_API_BASE_URL || '').replace(/\/$/, '');
const ANET_L1_DEX_ADMIN_KEY = process.env.ANET_L1_DEX_ADMIN_KEY || '';
const PI_REQUIRED_SESSIONS = Number(process.env.PI_REQUIRED_SESSIONS || 1000);
const ANET_TESTNET_COIN_LABEL = process.env.ANET_TESTNET_COIN_LABEL || 'ANET_TEST';
const ANET_MAINNET_COIN_LABEL = process.env.ANET_MAINNET_COIN_LABEL || 'ANET';
const PI_ENFORCE_PRIMARY_WALLET_BINDING = (process.env.PI_ENFORCE_PRIMARY_WALLET_BINDING || 'true').toLowerCase() === 'true';

if (!PI_API_KEY) {
  console.warn('[WARN] PI_API_KEY is not set. Pi API calls will fail until configured.');
}

function initialState() {
  return {
    lifetimeUnlocks: {},
    cashoutRequests: [],
    settlementTransactions: [],
    walletBindings: {}
  };
}

function ensureStateDirectory() {
  fs.mkdirSync(path.dirname(PI_CASHOUT_STATE_PATH), { recursive: true });
}

function loadState() {
  try {
    ensureStateDirectory();
    if (!fs.existsSync(PI_CASHOUT_STATE_PATH)) {
      return initialState();
    }

    const parsed = JSON.parse(fs.readFileSync(PI_CASHOUT_STATE_PATH, 'utf8'));
    return {
      lifetimeUnlocks: parsed?.lifetimeUnlocks && typeof parsed.lifetimeUnlocks === 'object' ? parsed.lifetimeUnlocks : {},
      cashoutRequests: Array.isArray(parsed?.cashoutRequests) ? parsed.cashoutRequests : [],
      settlementTransactions: Array.isArray(parsed?.settlementTransactions) ? parsed.settlementTransactions : [],
      walletBindings: parsed?.walletBindings && typeof parsed.walletBindings === 'object' ? parsed.walletBindings : {}
    };
  } catch (error) {
    console.warn(`[WARN] Failed to read DEX state: ${error.message}`);
    return initialState();
  }
}

const cashoutState = loadState();

function persistState() {
  ensureStateDirectory();
  const tempPath = `${PI_CASHOUT_STATE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(cashoutState, null, 2));
  fs.renameSync(tempPath, PI_CASHOUT_STATE_PATH);
}

function normalizePiUid(uid) {
  return String(uid || '').trim();
}

function normalizePositiveInteger(value) {
  const amount = Number(value);
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

function safeIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeDirection(anetToToken) {
  return anetToToken ? 'ANET_TO_TOKEN' : 'TOKEN_TO_ANET';
}

function getPiExplorerTransactionUrl(txid) {
  const value = String(txid || '').trim();
  if (!value) {
    return null;
  }

  const path = PI_SANDBOX ? 'testnet' : 'mainnet';
  return `https://blockexplorer.minepi.com/${path}/transactions/${encodeURIComponent(value)}`;
}

function recentUnlockProof(limit = 20) {
  return Object.values(cashoutState.lifetimeUnlocks || {})
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      uid: normalizePiUid(entry.uid),
      username: String(entry.username || '').trim(),
      unlocked: Boolean(entry.unlocked),
      unlockedAt: safeIsoDate(entry.unlockedAt),
      paymentId: String(entry.paymentId || '').trim() || null,
      txid: String(entry.txid || '').trim() || null,
      piExplorerTransactionUrl: getPiExplorerTransactionUrl(entry.txid)
    }))
    .sort((left, right) => {
      const leftTs = left.unlockedAt ? Date.parse(left.unlockedAt) : 0;
      const rightTs = right.unlockedAt ? Date.parse(right.unlockedAt) : 0;
      return rightTs - leftTs;
    })
    .slice(0, limit);
}

function recentDexProof(limit = 30) {
  return (cashoutState.cashoutRequests || [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      id: String(entry.id || '').trim() || null,
      uid: normalizePiUid(entry.uid),
      username: String(entry.username || '').trim(),
      trader: String(entry.trader || '').trim().toUpperCase(),
      tokenSymbol: String(entry.token_symbol || '').trim().toUpperCase(),
      amountIn: normalizePositiveInteger(entry.amount_in),
      direction: normalizeDirection(Boolean(entry.anet_to_token)),
      requestedAt: safeIsoDate(entry.requestedAt),
      chainResponse: entry.chainResponse && typeof entry.chainResponse === 'object'
        ? {
          pairId: String(entry.chainResponse.pair_id || '').trim() || null,
          amountOut: String(entry.chainResponse.amount_out || '').trim() || null,
          feePaid: String(entry.chainResponse.fee_paid || '').trim() || null
        }
        : null
    }))
    .sort((left, right) => {
      const leftTs = left.requestedAt ? Date.parse(left.requestedAt) : 0;
      const rightTs = right.requestedAt ? Date.parse(right.requestedAt) : 0;
      return rightTs - leftTs;
    })
    .slice(0, limit);
}

function extractPaymentIdentity(payment) {
  const metadata = payment?.metadata && typeof payment.metadata === 'object' ? payment.metadata : {};
  return {
    uid: normalizePiUid(metadata.pi_uid || metadata.uid || payment?.user_uid || payment?.uid),
    username: String(metadata.pi_username || metadata.username || payment?.user_username || payment?.username || '').trim()
  };
}

function getLifetimeUnlock(uid) {
  return cashoutState.lifetimeUnlocks[normalizePiUid(uid)] || null;
}

function upsertLifetimeUnlock(payment, paymentId, txid) {
  const identity = extractPaymentIdentity(payment);
  if (!identity.uid) {
    throw new Error('Payment metadata must include pi_uid for lifetime DEX unlock tracking');
  }

  const existing = getLifetimeUnlock(identity.uid) || {};
  const record = {
    uid: identity.uid,
    username: identity.username || existing.username || '',
    unlocked: true,
    paymentId,
    txid: txid || existing.txid || null,
    amount: Number(payment?.amount || 0),
    memo: String(payment?.memo || ''),
    unlockedAt: existing.unlockedAt || new Date().toISOString()
  };

  cashoutState.lifetimeUnlocks[identity.uid] = record;
  persistState();
  return record;
}

app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'a-network-pi-backend' });
});

// Admin-only: force-persist a lifetime unlock without a live Pi payment.
// Requires PI_ADMIN_KEY env var to be set. Use only for test/bootstrap purposes.
app.post('/api/pi/admin/force-unlock', (req, res) => {
  if (!PI_ENABLE_TEST_ADMIN) {
    return res.status(403).json({ ok: false, error: 'Admin force-unlock is disabled in this environment' });
  }

  if (!PI_ADMIN_KEY) {
    return res.status(503).json({ ok: false, error: 'PI_ADMIN_KEY is not configured on this deployment' });
  }

  const providedKey = String(req.body?.admin_key || '').trim();
  if (providedKey !== PI_ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: 'Invalid admin key' });
  }

  const uid = normalizePiUid(req.body?.uid);
  const username = String(req.body?.username || '').trim();
  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }

  const syntheticPayment = {
    uid,
    user_uid: uid,
    username,
    user_username: username,
    metadata: { pi_uid: uid, pi_username: username },
    amount: 1,
    memo: 'admin-force-unlock'
  };

  const record = upsertLifetimeUnlock(syntheticPayment, 'admin-force-unlock', null);
  return res.status(200).json({ ok: true, unlock: record });
});


app.get('/api/pi/config', (_req, res) => {
  res.json({
    ok: true,
    sdk: {
      version: '2.0',
      sandbox: PI_SANDBOX
    },
    policy: {
      requiredAmount: PI_REQUIRED_AMOUNT,
      minAmount: PI_MIN_AMOUNT,
      maxAmount: PI_MAX_AMOUNT,
      memoPrefix: PI_ALLOWED_MEMO_PREFIX,
      metadataApp: PI_ALLOWED_METADATA_APP,
      metadataPurpose: PI_ALLOWED_METADATA_PURPOSE,
      requiredSessionsForPrivateMainnet: PI_REQUIRED_SESSIONS,
      sandboxMetadataPurpose: PI_ALLOWED_SANDBOX_METADATA_PURPOSE,
      lifetimeDexUnlockEnabled: true,
      appWalletCheckEnabled: Boolean(PI_APP_WALLET),
      testAdminEnabled: PI_ENABLE_TEST_ADMIN,
      testAssetMintEnabled: PI_ALLOW_TEST_ASSET_MINT,
      coinAccess: {
        testnetLabel: ANET_TESTNET_COIN_LABEL,
        mainnetLabel: ANET_MAINNET_COIN_LABEL,
        model: 'testnet-always-mainnet-after-session-threshold'
      },
      enforcePrimaryWalletBinding: PI_ENFORCE_PRIMARY_WALLET_BINDING
    }
  });
});

app.get('/api/public/verification', async (req, res) => {
  const uid = normalizePiUid(req.query?.uid);
  let chainHealth = null;
  let chainLatestHeight = null;
  let chainId = null;
  let poolsCount = null;

  if (ANET_CHAIN_API_BASE_URL) {
    try {
      chainHealth = await getFromLayer1('/health');
      chainId = String(chainHealth?.chain_id || '').trim() || null;
      chainLatestHeight = Number.isFinite(Number(chainHealth?.latest_block_height))
        ? Number(chainHealth.latest_block_height)
        : null;
    } catch {
      chainHealth = null;
    }

    try {
      const pools = await getFromLayer1('/dex/pools');
      poolsCount = Array.isArray(pools) ? pools.length : null;
    } catch {
      poolsCount = null;
    }
  }

  const unlockProof = recentUnlockProof();
  const dexProof = recentDexProof();
  const uidUnlock = uid ? getLifetimeUnlock(uid) : null;

  return res.json({
    ok: true,
    network: {
      anet: {
        label: 'A Network Private Mainnet',
        chainId: chainId || 'anet-private-mainnet-1',
        explorerBaseUrl: ANET_CHAIN_API_BASE_URL || null,
        latestBlockHeight: chainLatestHeight
      },
      pi: {
        mode: PI_SANDBOX ? 'sandbox' : 'mainnet',
        sdkVersion: '2.0',
        apiBaseUrl: PI_API_BASE_URL,
        metadataApp: PI_ALLOWED_METADATA_APP,
        metadataPurpose: PI_ALLOWED_METADATA_PURPOSE
      }
    },
    publicVerification: {
      summary: 'This service bridges Pi payments to A Network Private Mainnet native L1 DEX access records.',
      howToVerify: [
        `${req.protocol}://${req.get('host')}/api/pi/config`,
        `${req.protocol}://${req.get('host')}/api/public/verification`,
        ANET_CHAIN_API_BASE_URL ? `${ANET_CHAIN_API_BASE_URL}/health` : null,
        ANET_CHAIN_API_BASE_URL ? `${ANET_CHAIN_API_BASE_URL}/blocks` : null,
        ANET_CHAIN_API_BASE_URL ? `${ANET_CHAIN_API_BASE_URL}/dex/pools` : null
      ].filter(Boolean)
    },
    metrics: {
      lifetimeUnlockRecords: Object.keys(cashoutState.lifetimeUnlocks || {}).length,
      dexExecutionRecords: (cashoutState.cashoutRequests || []).length,
      recentPoolCount: poolsCount
    },
    recentProof: {
      unlocks: unlockProof,
      dexExecutions: dexProof
    },
    uidStatus: uid
      ? {
        uid,
        unlocked: Boolean(uidUnlock),
        unlock: uidUnlock
          ? {
            uid: normalizePiUid(uidUnlock.uid),
            username: String(uidUnlock.username || '').trim(),
            unlockedAt: safeIsoDate(uidUnlock.unlockedAt),
            paymentId: String(uidUnlock.paymentId || '').trim() || null,
            txid: String(uidUnlock.txid || '').trim() || null,
            piExplorerTransactionUrl: getPiExplorerTransactionUrl(uidUnlock.txid)
          }
          : null
      }
      : null
  });
});

async function sendUnlockStatus(res, uid, walletAddress) {
  const unlock = getLifetimeUnlock(uid);
  const walletBinding = getPublicWalletBinding(uid);
  const providedWallet = normalizeWalletAddress(walletAddress);
  const boundWalletMismatch = Boolean(
    PI_ENFORCE_PRIMARY_WALLET_BINDING &&
    walletBinding &&
    providedWallet &&
    normalizeWalletAddress(walletBinding.primaryWallet) !== providedWallet
  );
  const response = {
    ok: true,
    uid,
    unlocked: Boolean(unlock),
    requiredSessionsForPrivateMainnet: PI_REQUIRED_SESSIONS,
    coinAccess: buildCoinAccess(false),
    walletBindingPolicy: {
      enforcePrimaryWalletBinding: PI_ENFORCE_PRIMARY_WALLET_BINDING
    },
    walletBinding,
    boundWalletMismatch,
    ...(unlock || {})
  };

  if (walletAddress) {
    const eligibility = await getSessionEligibility(walletAddress);
    if (!eligibility.error) {
      response.eligibility = eligibility;
      response.coinAccess = buildCoinAccess(eligibility.eligible);
    } else {
      response.eligibilityError = eligibility.error;
    }
  }

  return res.json({
    ...response
  });
}

app.get('/api/pi/dex/status/:uid', async (req, res) => {
  const uid = normalizePiUid(req.params?.uid);
  const walletAddress = String(req.query?.wallet || '').trim().toUpperCase();
  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  return sendUnlockStatus(res, uid, walletAddress);
});

app.get('/api/pi/cashout/status/:uid', async (req, res) => {
  const uid = normalizePiUid(req.params?.uid);
  const walletAddress = String(req.query?.wallet || '').trim().toUpperCase();
  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  return sendUnlockStatus(res, uid, walletAddress);
});

async function piRequest(pathname, options = {}) {
  const response = await fetch(`${PI_API_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Key ${PI_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`Pi API request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function verifyPaymentExists(paymentId) {
  return piRequest(`/v2/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
}

function unwrapPayment(paymentResponse) {
  if (!paymentResponse || typeof paymentResponse !== 'object') {
    return {};
  }

  return paymentResponse.payment && typeof paymentResponse.payment === 'object'
    ? paymentResponse.payment
    : paymentResponse;
}

function boolCandidate(payment, keys) {
  for (const key of keys) {
    const direct = payment?.[key];
    if (typeof direct === 'boolean') {
      return direct;
    }

    const nested = payment?.status?.[key];
    if (typeof nested === 'boolean') {
      return nested;
    }
  }

  return false;
}

function getCurrentTxid(payment) {
  return payment?.transaction?.txid || payment?.transaction?.tx_id || payment?.txid || null;
}

function isDeveloperCompleted(payment) {
  return boolCandidate(payment, ['developer_completed', 'developerCompleted']);
}

function isAllowedMetadataPurpose(metadataPurpose) {
  const allowedPurposes = new Set([PI_ALLOWED_METADATA_PURPOSE]);

  if (PI_SANDBOX && PI_ALLOWED_SANDBOX_METADATA_PURPOSE) {
    allowedPurposes.add(PI_ALLOWED_SANDBOX_METADATA_PURPOSE);
  }

  return allowedPurposes.has(metadataPurpose);
}

function isDexUnlockPayment(payment) {
  return String(payment?.metadata?.purpose || '') === PI_ALLOWED_METADATA_PURPOSE;
}

function canUnlockDexForSandbox(payment) {
  if (!PI_SANDBOX) {
    return false;
  }

  const purpose = String(payment?.metadata?.purpose || '');
  return isAllowedMetadataPurpose(purpose);
}

function validatePaymentForApp(payment) {
  const amount = Number(payment?.amount);
  const memo = String(payment?.memo || '');
  const metadataApp = String(payment?.metadata?.app || '');
  const metadataPurpose = String(payment?.metadata?.purpose || '');
  const toAddress = String(payment?.to_address || payment?.toAddress || '');

  if (!Number.isFinite(amount)) {
    return 'Invalid payment amount';
  }

  if (amount < PI_MIN_AMOUNT || amount > PI_MAX_AMOUNT) {
    return `Payment amount ${amount} is outside allowed range ${PI_MIN_AMOUNT} - ${PI_MAX_AMOUNT}`;
  }

  if (Math.abs(amount - PI_REQUIRED_AMOUNT) > 0.000001) {
    return `Payment amount must be exactly ${PI_REQUIRED_AMOUNT} Pi`;
  }

  if (PI_ALLOWED_MEMO_PREFIX && !memo.startsWith(PI_ALLOWED_MEMO_PREFIX)) {
    return `Payment memo must start with '${PI_ALLOWED_MEMO_PREFIX}'`;
  }

  if (PI_ALLOWED_METADATA_APP && metadataApp !== PI_ALLOWED_METADATA_APP) {
    return `Payment metadata.app must be '${PI_ALLOWED_METADATA_APP}'`;
  }

  if (PI_ALLOWED_METADATA_PURPOSE && !isAllowedMetadataPurpose(metadataPurpose)) {
    return `Payment metadata.purpose must be '${PI_ALLOWED_METADATA_PURPOSE}'${PI_SANDBOX ? ` or '${PI_ALLOWED_SANDBOX_METADATA_PURPOSE}'` : ''}`;
  }

  if (PI_APP_WALLET && toAddress && toAddress !== PI_APP_WALLET) {
    return 'Payment destination wallet does not match configured app wallet';
  }

  return null;
}

function requireUnlock(uid, username) {
  const unlock = getLifetimeUnlock(uid);
  if (!unlock) {
    return { error: 'Lifetime DEX access has not been paid for this Pi user yet' };
  }

  if (unlock.username && username && unlock.username !== username) {
    return { error: 'Pi username does not match stored lifetime unlock record' };
  }

  return { unlock };
}

function normalizeWalletAddress(address) {
  return String(address || '').trim().toUpperCase();
}

function getWalletBinding(uid) {
  return cashoutState.walletBindings?.[normalizePiUid(uid)] || null;
}

function getPublicWalletBinding(uid) {
  const binding = getWalletBinding(uid);
  if (!binding) {
    return null;
  }
  return {
    primaryWallet: normalizeWalletAddress(binding.primaryWallet),
    wallets: Array.isArray(binding.wallets)
      ? binding.wallets.map((wallet) => normalizeWalletAddress(wallet)).filter(Boolean)
      : [normalizeWalletAddress(binding.primaryWallet)].filter(Boolean),
    createdAt: safeIsoDate(binding.createdAt),
    updatedAt: safeIsoDate(binding.updatedAt)
  };
}

function enforceWalletBinding(uid, username, walletAddress) {
  if (!PI_ENFORCE_PRIMARY_WALLET_BINDING) {
    return {
      ok: true,
      binding: getPublicWalletBinding(uid),
      walletBoundNow: false
    };
  }

  const normalizedUid = normalizePiUid(uid);
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  if (!normalizedUid) {
    return { error: 'uid is required for wallet binding checks', status: 400 };
  }
  if (!normalizedWallet) {
    return { error: 'wallet_address is required for wallet binding checks', status: 400 };
  }

  const existing = getWalletBinding(normalizedUid);
  if (!existing) {
    const now = new Date().toISOString();
    const record = {
      uid: normalizedUid,
      username: String(username || '').trim(),
      primaryWallet: normalizedWallet,
      wallets: [normalizedWallet],
      createdAt: now,
      updatedAt: now
    };
    cashoutState.walletBindings[normalizedUid] = record;
    persistState();
    return {
      ok: true,
      walletBoundNow: true,
      binding: getPublicWalletBinding(normalizedUid)
    };
  }

  const primaryWallet = normalizeWalletAddress(existing.primaryWallet);
  if (primaryWallet !== normalizedWallet) {
    return {
      error: `This Pi user is bound to wallet ${primaryWallet}. Use the primary wallet for private mainnet swap/bridge requests.`,
      status: 403,
      binding: getPublicWalletBinding(normalizedUid)
    };
  }

  const mergedWallets = new Set(Array.isArray(existing.wallets) ? existing.wallets.map((wallet) => normalizeWalletAddress(wallet)) : []);
  mergedWallets.add(primaryWallet);
  const nextRecord = {
    ...existing,
    username: String(existing.username || '').trim() || String(username || '').trim(),
    primaryWallet,
    wallets: [...mergedWallets],
    updatedAt: new Date().toISOString()
  };
  cashoutState.walletBindings[normalizedUid] = nextRecord;
  persistState();

  return {
    ok: true,
    walletBoundNow: false,
    binding: getPublicWalletBinding(normalizedUid)
  };
}

function buildCoinAccess(eligibleForMainnet) {
  return {
    testnet: {
      enabled: true,
      label: ANET_TESTNET_COIN_LABEL
    },
    mainnet: {
      enabled: Boolean(eligibleForMainnet),
      label: ANET_MAINNET_COIN_LABEL
    }
  };
}

async function getSessionEligibility(walletAddress) {
  const normalizedWallet = String(walletAddress || '').trim().toUpperCase();
  if (!normalizedWallet) {
    return { error: 'wallet address is required for eligibility checks', status: 400 };
  }

  if (!ANET_CHAIN_API_BASE_URL) {
    return { error: 'Layer 1 DEX bridge is not configured', status: 503 };
  }

  try {
    const account = await getFromLayer1(`/accounts/${encodeURIComponent(normalizedWallet)}`);
    const sessions = Number.isFinite(Number(account?.sessions)) ? Number(account.sessions) : 0;
    const requiredSessions = Number.isFinite(PI_REQUIRED_SESSIONS) && PI_REQUIRED_SESSIONS > 0
      ? PI_REQUIRED_SESSIONS
      : 1000;
    const eligible = sessions >= requiredSessions;

    return {
      wallet: normalizedWallet,
      sessions,
      requiredSessions,
      eligible,
      remainingSessions: Math.max(0, requiredSessions - sessions)
    };
  } catch (error) {
    return {
      error: error?.message || 'Unable to verify session eligibility',
      status: error?.status || 502
    };
  }
}

async function requireUnlockAndEligibility(uid, username, walletAddress) {
  const unlockResult = requireUnlock(uid, username);
  if (unlockResult.error) {
    return {
      error: unlockResult.error,
      status: 403
    };
  }

  const bindingResult = enforceWalletBinding(uid, username, walletAddress);
  if (bindingResult.error) {
    return {
      error: bindingResult.error,
      status: bindingResult.status || 403,
      unlock: unlockResult.unlock,
      walletBinding: bindingResult.binding || getPublicWalletBinding(uid) || null
    };
  }

  const eligibility = await getSessionEligibility(walletAddress);
  if (eligibility.error) {
    return {
      error: eligibility.error,
      status: eligibility.status || 502,
      unlock: unlockResult.unlock,
      walletBinding: bindingResult.binding || null
    };
  }

  if (!eligibility.eligible) {
    return {
      error: `You need to complete at least ${eligibility.requiredSessions} sessions before using swap/bridge on private mainnet`,
      status: 403,
      unlock: unlockResult.unlock,
      eligibility,
      coinAccess: buildCoinAccess(false),
      walletBinding: bindingResult.binding || null
    };
  }

  return {
    unlock: unlockResult.unlock,
    eligibility,
    coinAccess: buildCoinAccess(true),
    walletBinding: bindingResult.binding || null,
    walletBoundNow: Boolean(bindingResult.walletBoundNow)
  };
}

async function approvePayment(paymentId) {
  const payment = unwrapPayment(await verifyPaymentExists(paymentId));
  const validationError = validatePaymentForApp(payment);
  if (validationError) {
    const error = new Error(validationError);
    error.status = 400;
    throw error;
  }

  if (boolCandidate(payment, ['developer_approved', 'developerApproved'])) {
    return { ok: true, paymentId, skipped: true, reason: 'Payment already approved' };
  }

  const approved = await piRequest(`/v2/payments/${encodeURIComponent(paymentId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  return { ok: true, paymentId, approved };
}

async function completePayment(paymentId, txid) {
  const payment = unwrapPayment(await verifyPaymentExists(paymentId));
  const validationError = validatePaymentForApp(payment);
  if (validationError) {
    const error = new Error(validationError);
    error.status = 400;
    throw error;
  }

  const existingTxid = getCurrentTxid(payment);
  if (isDeveloperCompleted(payment)) {
    let unlock = null;
    if (isDexUnlockPayment(payment) || canUnlockDexForSandbox(payment)) {
      unlock = upsertLifetimeUnlock(payment, paymentId, existingTxid || txid || null);
    }
    return {
      ok: true,
      paymentId,
      txid: existingTxid || txid || null,
      ...(unlock ? { unlock } : {}),
      skipped: true,
      reason: 'Payment already completed'
    };
  }

  const finalTxid = txid || existingTxid;
  if (!finalTxid) {
    const error = new Error('txid is required to complete payment');
    error.status = 400;
    throw error;
  }

  const completed = await piRequest(`/v2/payments/${encodeURIComponent(paymentId)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ txid: finalTxid })
  });

  let unlock = null;
  if (isDexUnlockPayment(payment) || canUnlockDexForSandbox(payment)) {
    unlock = upsertLifetimeUnlock(payment, paymentId, finalTxid);
  }
  return {
    ok: true,
    paymentId,
    txid: finalTxid,
    completed,
    ...(unlock ? { unlock } : {})
  };
}

async function resolveIncompletePayment(paymentId) {
  const initialPayment = unwrapPayment(await verifyPaymentExists(paymentId));
  const response = {
    ok: true,
    paymentId,
    approved: false,
    completed: false,
    txid: getCurrentTxid(initialPayment) || null,
    requiresUserAction: false,
    unlock: null
  };

  if (!boolCandidate(initialPayment, ['developer_approved', 'developerApproved'])) {
    await piRequest(`/v2/payments/${encodeURIComponent(paymentId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    response.approved = true;
  }

  const refreshedPayment = unwrapPayment(await verifyPaymentExists(paymentId));
  const txid = getCurrentTxid(refreshedPayment);
  response.txid = txid || null;

  if (!txid) {
    response.requiresUserAction = true;
    response.reason = 'Payment is approved but still waiting for user-side blockchain confirmation';
    return response;
  }

  const completion = await completePayment(paymentId, txid);
  response.completed = true;
  response.unlock = completion.unlock || null;
  response.reason = completion.reason || 'Payment resolved';
  return response;
}

app.post('/approve', async (req, res) => {
  const { paymentId } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }

  try {
    return res.json(await approvePayment(paymentId));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      paymentId,
      error: error.message,
      details: error.body || null
    });
  }
});

app.post('/complete', async (req, res) => {
  const { paymentId, txid } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }
  if (!txid) {
    return res.status(400).json({ ok: false, error: 'txid is required' });
  }

  try {
    return res.json(await completePayment(paymentId, txid));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      paymentId,
      txid,
      error: error.message,
      details: error.body || null
    });
  }
});

app.post('/resolve-incomplete', async (req, res) => {
  const { paymentId } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }

  try {
    return res.json(await resolveIncompletePayment(paymentId));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      paymentId,
      error: error.message,
      details: error.body || null
    });
  }
});

app.post('/api/pi/payments/approve', async (req, res) => {
  const { paymentId } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }

  try {
    return res.json(await approvePayment(paymentId));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      paymentId,
      error: error.message,
      details: error.body || null
    });
  }
});

app.post('/api/pi/payments/complete', async (req, res) => {
  const { paymentId, txid } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }
  if (!txid) {
    return res.status(400).json({ ok: false, error: 'txid is required' });
  }

  try {
    return res.json(await completePayment(paymentId, txid));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      paymentId,
      txid,
      error: error.message,
      details: error.body || null
    });
  }
});

app.post('/api/pi/payments/resolve-incomplete', async (req, res) => {
  const { paymentId } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }

  try {
    return res.json(await resolveIncompletePayment(paymentId));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      paymentId,
      error: error.message,
      details: error.body || null
    });
  }
});

async function postToLayer1(pathname, payload) {
  if (!ANET_CHAIN_API_BASE_URL) {
    throw new Error('Layer 1 DEX bridge is not configured');
  }

  const response = await fetch(`${ANET_CHAIN_API_BASE_URL}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`Layer 1 request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function getFromLayer1(pathname) {
  if (!ANET_CHAIN_API_BASE_URL) {
    throw new Error('Layer 1 DEX bridge is not configured');
  }

  const response = await fetch(`${ANET_CHAIN_API_BASE_URL}${pathname}`, {
    method: 'GET'
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`Layer 1 request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function getLatestLayer1BlockHeight() {
  try {
    const blocks = await getFromLayer1('/blocks');
    if (Array.isArray(blocks) && blocks.length > 0) {
      const heights = blocks
        .map((b) => Number(b?.block_height))
        .filter((value) => Number.isFinite(value));
      if (heights.length > 0) {
        return Math.max(...heights);
      }
    }
  } catch {
    // Ignore read errors and return null when chain height cannot be read.
  }
  return null;
}

app.post('/api/pi/dex/quote', async (req, res) => {
  const uid = normalizePiUid(req.body?.uid);
  const username = String(req.body?.username || '').trim();
  const walletAddress = String(req.body?.wallet_address || req.body?.trader || req.body?.provider || '').trim().toUpperCase();
  const tokenSymbol = String(req.body?.token_symbol || '').trim().toUpperCase();
  const amountIn = normalizePositiveInteger(req.body?.amount_in);
  const anetToToken = Boolean(req.body?.anet_to_token);

  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  if (!tokenSymbol) {
    return res.status(400).json({ ok: false, error: 'token_symbol is required' });
  }
  if (!amountIn) {
    return res.status(400).json({ ok: false, error: 'amount_in must be a positive integer' });
  }
  if (!walletAddress) {
    return res.status(400).json({ ok: false, error: 'wallet_address is required for eligibility checks' });
  }

  const access = await requireUnlockAndEligibility(uid, username, walletAddress);
  if (access.error) {
    return res.status(access.status || 403).json({
      ok: false,
      error: access.error,
      unlock: access.unlock || null,
      eligibility: access.eligibility || null,
      coinAccess: access.coinAccess || buildCoinAccess(false),
      walletBinding: access.walletBinding || getPublicWalletBinding(uid) || null
    });
  }

  try {
    const quote = await postToLayer1('/dex/swap/quote', {
      token_symbol: tokenSymbol,
      amount_in: amountIn,
      anet_to_token: anetToToken
    });

    return res.status(200).json({
      ok: true,
      unlock: access.unlock,
      eligibility: access.eligibility,
      coinAccess: access.coinAccess,
      walletBinding: access.walletBinding || null,
      walletBoundNow: Boolean(access.walletBoundNow),
      quote
    });
  } catch (requestError) {
    return res.status(requestError.status || 500).json({
      ok: false,
      error: requestError.message,
      details: requestError.body || null
    });
  }
});

app.post('/api/pi/dex/bootstrap', async (req, res) => {
  const uid = normalizePiUid(req.body?.uid);
  const username = String(req.body?.username || '').trim();
  const provider = String(req.body?.provider || '').trim().toUpperCase();
  const senderSeed = String(req.body?.sender_seed || '').trim();
  const tokenSymbol = String(req.body?.token_symbol || 'USDA').trim().toUpperCase();
  const anetAmountAnts = normalizePositiveInteger(req.body?.anet_amount_ants ?? 2000);
  const tokenAmountUnits = normalizePositiveInteger(req.body?.token_amount_units ?? 2000);
  const feeBps = Number.isInteger(Number(req.body?.fee_bps)) ? Number(req.body?.fee_bps) : 30;
  const mintTestAssets = Boolean(req.body?.mint_test_assets);

  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  if (!provider) {
    return res.status(400).json({ ok: false, error: 'provider is required' });
  }
  if (!senderSeed) {
    return res.status(400).json({ ok: false, error: 'sender_seed is required' });
  }
  if (!tokenSymbol) {
    return res.status(400).json({ ok: false, error: 'token_symbol is required' });
  }
  if (!anetAmountAnts || !tokenAmountUnits) {
    return res.status(400).json({ ok: false, error: 'anet_amount_ants and token_amount_units must be positive integers' });
  }

  const access = await requireUnlockAndEligibility(uid, username, provider);
  if (access.error) {
    return res.status(access.status || 403).json({
      ok: false,
      error: access.error,
      unlock: access.unlock || null,
      eligibility: access.eligibility || null,
      coinAccess: access.coinAccess || buildCoinAccess(false),
      walletBinding: access.walletBinding || getPublicWalletBinding(uid) || null
    });
  }

  try {
    const beforeHeight = await getLatestLayer1BlockHeight();

    const actions = [];
    if (mintTestAssets) {
      if (!PI_ALLOW_TEST_ASSET_MINT) {
        return res.status(403).json({ ok: false, error: 'mint_test_assets is disabled in this environment' });
      }
      if (!ANET_L1_DEX_ADMIN_KEY) {
        return res.status(400).json({ ok: false, error: 'ANET_L1_DEX_ADMIN_KEY is required when mint_test_assets=true' });
      }

      const mintedAnet = await postToLayer1('/admin/anet/mint', {
        address: provider,
        amount_ants: anetAmountAnts,
        admin_key: ANET_L1_DEX_ADMIN_KEY
      });
      actions.push({ type: 'admin_mint_anet', result: mintedAnet });

      const mintedAsset = await postToLayer1('/dex/assets/mint', {
        address: provider,
        token_symbol: tokenSymbol,
        amount: tokenAmountUnits,
        admin_key: ANET_L1_DEX_ADMIN_KEY
      });
      actions.push({ type: 'dex_mint_asset', result: mintedAsset });
    }

    let poolExists = false;
    try {
      const pool = await getFromLayer1(`/dex/pools/${encodeURIComponent(tokenSymbol)}`);
      poolExists = Boolean(pool);
    } catch (readError) {
      if (readError?.status !== 404) {
        throw readError;
      }
    }

    if (!poolExists) {
      const created = await postToLayer1('/dex/pools/create', {
        provider,
        sender_seed: senderSeed,
        token_symbol: tokenSymbol,
        anet_amount_ants: anetAmountAnts,
        token_amount_units: tokenAmountUnits,
        fee_bps: feeBps
      });
      actions.push({ type: 'create_pool', result: created });
    } else {
      const added = await postToLayer1('/dex/pools/add-liquidity', {
        provider,
        sender_seed: senderSeed,
        token_symbol: tokenSymbol,
        anet_amount_ants: anetAmountAnts,
        token_amount_units: tokenAmountUnits
      });
      actions.push({ type: 'add_liquidity', result: added });
    }

    const afterHeight = await getLatestLayer1BlockHeight();
    return res.status(200).json({
      ok: true,
      unlock: access.unlock,
      eligibility: access.eligibility,
      coinAccess: access.coinAccess,
      walletBinding: access.walletBinding || null,
      walletBoundNow: Boolean(access.walletBoundNow),
      token_symbol: tokenSymbol,
      anet_amount_ants: anetAmountAnts,
      token_amount_units: tokenAmountUnits,
      block_height_before: beforeHeight,
      block_height_after: afterHeight,
      block_advanced: Number.isFinite(beforeHeight) && Number.isFinite(afterHeight)
        ? afterHeight > beforeHeight
        : null,
      actions
    });
  } catch (requestError) {
    return res.status(requestError.status || 500).json({
      ok: false,
      error: requestError.message,
      details: requestError.body || null
    });
  }
});

app.post('/api/pi/dex/execute', async (req, res) => {
  const uid = normalizePiUid(req.body?.uid);
  const username = String(req.body?.username || '').trim();
  const trader = String(req.body?.trader || '').trim().toUpperCase();
  const senderSeed = String(req.body?.sender_seed || '').trim();
  const tokenSymbol = String(req.body?.token_symbol || '').trim().toUpperCase();
  const amountIn = normalizePositiveInteger(req.body?.amount_in);
  const anetToToken = Boolean(req.body?.anet_to_token);

  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  if (!trader) {
    return res.status(400).json({ ok: false, error: 'trader is required' });
  }
  if (!senderSeed) {
    return res.status(400).json({ ok: false, error: 'sender_seed is required' });
  }
  if (!tokenSymbol) {
    return res.status(400).json({ ok: false, error: 'token_symbol is required' });
  }
  if (!amountIn) {
    return res.status(400).json({ ok: false, error: 'amount_in must be a positive integer' });
  }

  const access = await requireUnlockAndEligibility(uid, username, trader);
  if (access.error) {
    return res.status(access.status || 403).json({
      ok: false,
      error: access.error,
      unlock: access.unlock || null,
      eligibility: access.eligibility || null,
      coinAccess: access.coinAccess || buildCoinAccess(false),
      walletBinding: access.walletBinding || getPublicWalletBinding(uid) || null
    });
  }

  try {
    const swap = await postToLayer1('/dex/swap/execute', {
      trader,
      sender_seed: senderSeed,
      token_symbol: tokenSymbol,
      amount_in: amountIn,
      anet_to_token: anetToToken
    });

    const requestRecord = {
      id: `dex_${Date.now()}`,
      uid,
      username: access.unlock.username || username,
      trader,
      token_symbol: tokenSymbol,
      amount_in: amountIn,
      anet_to_token: anetToToken,
      requestedAt: new Date().toISOString(),
      chainResponse: swap
    };

    cashoutState.cashoutRequests.push(requestRecord);
    persistState();

    return res.status(200).json({
      ok: true,
      unlock: access.unlock,
      eligibility: access.eligibility,
      coinAccess: access.coinAccess,
      walletBinding: access.walletBinding || null,
      walletBoundNow: Boolean(access.walletBoundNow),
      request: requestRecord,
      swap
    });
  } catch (requestError) {
    return res.status(requestError.status || 500).json({
      ok: false,
      error: requestError.message,
      details: requestError.body || null
    });
  }
});

app.post('/api/pi/settlement/record', (req, res) => {
  try {
    const piPaymentId = String(req.body?.pi_payment_id || '').trim();
    const piTxid = String(req.body?.pi_txid || '').trim();
    const piAmount = String(req.body?.pi_amount || '').trim();
    const fromAddress = String(req.body?.from_address || '').trim();
    const toAddress = String(req.body?.to_address || '').trim();
    const l1BlockHeight = Number.isInteger(Number(req.body?.l1_block_height)) ? Number(req.body?.l1_block_height) : null;
    const l1BlockEvent = String(req.body?.l1_block_event || 'Pi: Payment Settlement').trim();

    if (!piPaymentId || !piTxid || !piAmount || !fromAddress || !toAddress) {
      return res.status(400).json({
        ok: false,
        error: 'pi_payment_id, pi_txid, pi_amount, from_address, and to_address are required'
      });
    }

    // Initialize settlement transactions array if not present
    if (!cashoutState.settlementTransactions) {
      cashoutState.settlementTransactions = [];
    }

    const settlementRecord = {
      id: `settlement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      piPaymentId,
      piTxid,
      piAmount,
      fromAddress,
      toAddress,
      l1BlockHeight,
      l1BlockEvent,
      recordedAt: new Date().toISOString(),
      piExplorerUrl: getPiExplorerTransactionUrl(piTxid)
    };

    cashoutState.settlementTransactions.push(settlementRecord);
    persistState();

    console.log(`[SETTLEMENT] Recorded Pi→L1 settlement: ${piPaymentId} (${piTxid})`);

    return res.status(200).json({
      ok: true,
      settlement: settlementRecord,
      message: `Settlement recorded: Pi payment ${piPaymentId} settled on L1 at block ${l1BlockHeight}`
    });
  } catch (error) {
    console.error(`[ERROR] Settlement recording failed: ${error.message}`);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get('/api/pi/settlement/recent', (_req, res) => {
  try {
    const settlements = (cashoutState.settlementTransactions || [])
      .slice(-50)
      .reverse();
    return res.status(200).json({
      ok: true,
      settlements,
      count: settlements.length
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/api/pi/cashout/request', (_req, res) => {
  return res.status(410).json({
    ok: false,
    error: 'Cashout flow has been replaced by the DEX flow. Use /api/pi/dex/quote and /api/pi/dex/execute instead.'
  });
});

app.listen(port, () => {
  console.log(`Pi backend listening on http://localhost:${port}`);
});
