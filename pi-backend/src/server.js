const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const PI_API_KEY = process.env.PI_API_KEY || '';
const PI_API_BASE_URL = (process.env.PI_API_BASE_URL || 'https://api.minepi.com').replace(/\/$/, '');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const PI_SANDBOX = (process.env.PI_SANDBOX || 'true').toLowerCase() === 'true';
const PI_ALLOWED_METADATA_APP = process.env.PI_ALLOWED_METADATA_APP || 'a-network-testnet';
const PI_ALLOWED_MEMO_PREFIX = process.env.PI_ALLOWED_MEMO_PREFIX || 'A Network';
const PI_APP_WALLET = process.env.PI_APP_WALLET || '';
const PI_REQUIRED_AMOUNT = Number(process.env.PI_REQUIRED_AMOUNT || 1);
const PI_MIN_AMOUNT = Number(process.env.PI_MIN_AMOUNT || 0.01);
const PI_MAX_AMOUNT = Number(process.env.PI_MAX_AMOUNT || 1000);

if (!PI_API_KEY) {
  console.warn('[WARN] PI_API_KEY is not set. Pi API calls will fail until configured.');
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
      appWalletCheckEnabled: Boolean(PI_APP_WALLET)
    }
  });
});

async function piRequest(path, options = {}) {
  const response = await fetch(`${PI_API_BASE_URL}${path}`, {
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
    const err = new Error(`Pi API request failed (${response.status})`);
    err.status = response.status;
    err.body = body;
    throw err;
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

    const statusLevel = payment?.status?.[key];
    if (typeof statusLevel === 'boolean') {
      return statusLevel;
    }
  }
  return false;
}

function getCurrentTxid(payment) {
  return payment?.transaction?.txid || payment?.transaction?.tx_id || payment?.txid || null;
}

function validatePaymentForApp(payment) {
  const amount = Number(payment?.amount);
  const memo = String(payment?.memo || '');
  const metadataApp = String(payment?.metadata?.app || '');
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

  if (PI_APP_WALLET && toAddress && toAddress !== PI_APP_WALLET) {
    return 'Payment destination wallet does not match configured app wallet';
  }

  return null;
}

app.post('/api/pi/payments/approve', async (req, res) => {
  const { paymentId } = req.body || {};

  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }

  try {
    const paymentRaw = await verifyPaymentExists(paymentId);
    const payment = unwrapPayment(paymentRaw);

    const validationError = validatePaymentForApp(payment);
    if (validationError) {
      return res.status(400).json({
        ok: false,
        paymentId,
        error: validationError
      });
    }

    const isApproved = boolCandidate(payment, ['developer_approved', 'developerApproved']);
    if (isApproved) {
      return res.json({ ok: true, paymentId, skipped: true, reason: 'Payment already approved' });
    }

    const approved = await piRequest(`/v2/payments/${encodeURIComponent(paymentId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({})
    });

    return res.json({ ok: true, paymentId, approved });
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
    const paymentRaw = await verifyPaymentExists(paymentId);
    const payment = unwrapPayment(paymentRaw);

    const validationError = validatePaymentForApp(payment);
    if (validationError) {
      return res.status(400).json({
        ok: false,
        paymentId,
        txid,
        error: validationError
      });
    }

    const existingTxid = getCurrentTxid(payment);
    if (existingTxid) {
      return res.json({
        ok: true,
        paymentId,
        txid: existingTxid,
        skipped: true,
        reason: 'Payment already completed'
      });
    }

    const completed = await piRequest(`/v2/payments/${encodeURIComponent(paymentId)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ txid })
    });

    return res.json({ ok: true, paymentId, txid, completed });
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

app.listen(port, () => {
  console.log(`Pi backend listening on http://localhost:${port}`);
});
