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
const PI_SANDBOX = (process.env.PI_SANDBOX || 'true').toLowerCase() === 'true';
const PI_ALLOWED_METADATA_APP = process.env.PI_ALLOWED_METADATA_APP || 'a-network-testnet';
const PI_ALLOWED_METADATA_PURPOSE = process.env.PI_ALLOWED_METADATA_PURPOSE || 'dex-lifetime-unlock';
const PI_ALLOWED_SANDBOX_METADATA_PURPOSE = process.env.PI_ALLOWED_SANDBOX_METADATA_PURPOSE || 'sandbox-test-payment';
const PI_ALLOWED_MEMO_PREFIX = process.env.PI_ALLOWED_MEMO_PREFIX || 'A Network';
const PI_APP_WALLET = process.env.PI_APP_WALLET || '';
const PI_REQUIRED_AMOUNT = Number(process.env.PI_REQUIRED_AMOUNT || 1);
const PI_MIN_AMOUNT = Number(process.env.PI_MIN_AMOUNT || 1);
const PI_MAX_AMOUNT = Number(process.env.PI_MAX_AMOUNT || 1);
const PI_CASHOUT_STATE_PATH = process.env.PI_CASHOUT_STATE_PATH || path.join(__dirname, '..', 'data', 'dex-access-state.json');
const ANET_CHAIN_API_BASE_URL = (process.env.ANET_CHAIN_API_BASE_URL || '').replace(/\/$/, '');

if (!PI_API_KEY) {
  console.warn('[WARN] PI_API_KEY is not set. Pi API calls will fail until configured.');
}

function initialState() {
  return {
    lifetimeUnlocks: {},
    cashoutRequests: []
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
      cashoutRequests: Array.isArray(parsed?.cashoutRequests) ? parsed.cashoutRequests : []
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
      sandboxMetadataPurpose: PI_ALLOWED_SANDBOX_METADATA_PURPOSE,
      lifetimeDexUnlockEnabled: true,
      appWalletCheckEnabled: Boolean(PI_APP_WALLET)
    }
  });
});

function sendUnlockStatus(res, uid) {
  const unlock = getLifetimeUnlock(uid);
  return res.json({
    ok: true,
    uid,
    unlocked: Boolean(unlock),
    ...(unlock || {})
  });
}

app.get('/api/pi/dex/status/:uid', (req, res) => {
  const uid = normalizePiUid(req.params?.uid);
  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  return sendUnlockStatus(res, uid);
});

app.get('/api/pi/cashout/status/:uid', (req, res) => {
  const uid = normalizePiUid(req.params?.uid);
  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  return sendUnlockStatus(res, uid);
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
    const unlock = isDexUnlockPayment(payment) ? upsertLifetimeUnlock(payment, paymentId, existingTxid || txid || null) : null;
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

  const unlock = isDexUnlockPayment(payment) ? upsertLifetimeUnlock(payment, paymentId, finalTxid) : null;
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
  response.completed = !completion.skipped;
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

app.post('/api/pi/dex/quote', async (req, res) => {
  const uid = normalizePiUid(req.body?.uid);
  const username = String(req.body?.username || '').trim();
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

  const { unlock, error } = requireUnlock(uid, username);
  if (error) {
    return res.status(403).json({ ok: false, error });
  }

  try {
    const quote = await postToLayer1('/dex/swap/quote', {
      token_symbol: tokenSymbol,
      amount_in: amountIn,
      anet_to_token: anetToToken
    });

    return res.status(200).json({ ok: true, unlock, quote });
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

  const { unlock, error } = requireUnlock(uid, username);
  if (error) {
    return res.status(403).json({ ok: false, error });
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
      username: unlock.username || username,
      trader,
      token_symbol: tokenSymbol,
      amount_in: amountIn,
      anet_to_token: anetToToken,
      requestedAt: new Date().toISOString(),
      chainResponse: swap
    };

    cashoutState.cashoutRequests.push(requestRecord);
    persistState();

    return res.status(200).json({ ok: true, unlock, request: requestRecord, swap });
  } catch (requestError) {
    return res.status(requestError.status || 500).json({
      ok: false,
      error: requestError.message,
      details: requestError.body || null
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
