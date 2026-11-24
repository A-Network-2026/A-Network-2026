const sdkStatus = document.getElementById('sdkStatus');
const authResult = document.getElementById('authResult');
const payWithPiResult = document.getElementById('payWithPiResult');
const paymentResult = document.getElementById('paymentResult');
const dexAccessResult = document.getElementById('dexAccessResult');
const dexBootstrapResult = document.getElementById('dexBootstrapResult');
const dexQuoteResult = document.getElementById('dexQuoteResult');
const dexExecuteResult = document.getElementById('dexExecuteResult');

const authBtn = document.getElementById('authBtn');
const payWithPiBtn = document.getElementById('payWithPiBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const paymentForm = document.getElementById('paymentForm');
const dexForm = document.getElementById('dexForm');
const backendBaseUrlInput = document.getElementById('backendBaseUrl');
const paymentSubmitBtn = paymentForm.querySelector('button[type="submit"]');
const dexSubmitBtn = dexForm.querySelector('button[type="submit"]');
const bootstrapBtn = document.getElementById('bootstrapBtn');
const quoteBtn = document.getElementById('quoteBtn');

const DEFAULT_BACKEND_BASE_URL = 'https://pi-backend-q2ye.onrender.com';
const NETWORK_TIMEOUT_MS = 15000;

const localPage = ['localhost', '127.0.0.1'].includes(window.location.hostname);
let verifiedSandboxBackend = '';
let configRevision = 0;

let piUser = null;
let paymentScopeGranted = false;
let piInitialized = false;
let requiredAmount = 1;
let lifetimeDexUnlocked = false;
let dexUnlockRecord = null;
let dexMetadataPurpose = 'dex-lifetime-unlock';
let sandboxMetadataPurpose = 'sandbox-test-payment';

function setLog(target, value, isError = false) {
  target.textContent = value;
  target.classList.toggle('error', isError);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function postJson(url, payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timeout after ${NETWORK_TIMEOUT_MS / 1000}s: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const bodyText = await response.text();
  const body = bodyText ? safeJsonParse(bodyText) || bodyText : null;

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }

  return body;
}

async function getJson(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timeout after ${NETWORK_TIMEOUT_MS / 1000}s: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const bodyText = await response.text();
  const body = bodyText ? safeJsonParse(bodyText) || bodyText : null;

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }

  return body;
}

async function handleIncompletePayment(payment) {
  setLog(paymentResult, 'Pi reported an incomplete test payment.');

  const paymentId = payment?.identifier || payment?.paymentId || payment?.id;
  if (!paymentId) {
    return;
  }

  const backendBaseUrl = getBackendBaseUrl();
  if (!sandboxReady(backendBaseUrl)) return;

  try {
    await warmBackend(backendBaseUrl);
    setLog(paymentResult, `Attempting to resolve pending payment ${paymentId} on backend...`);
    const resolved = await postJson(`${backendBaseUrl}/resolve-incomplete`, { paymentId });

    if (resolved?.unlock) {
      setDexUnlocked(resolved.unlock);
    }

    const message = resolved?.requiresUserAction
      ? `Pending payment ${paymentId} is approved. Please retry after Pi blockchain confirmation.`
      : `Pending payment ${paymentId} resolved. You can retry payment now.`;

    setLog(paymentResult, `${message}\n${JSON.stringify(resolved, null, 2)}`);
    if (payWithPiResult) {
      setLog(payWithPiResult, `${message}\n${JSON.stringify(resolved, null, 2)}`);
    }
  } catch (error) {
    setLog(paymentResult, `Could not auto-resolve pending payment ${paymentId}: ${error.message}`, true);
    if (payWithPiResult) {
      setLog(payWithPiResult, `Could not auto-resolve pending payment ${paymentId}: ${error.message}`, true);
    }
  }
}

function setDexUnlocked(record) {
  lifetimeDexUnlocked = Boolean(record?.unlocked || record?.paymentId);
  dexUnlockRecord = lifetimeDexUnlocked ? record : null;

  renderDexAccessState();
}

function renderDexAccessState() {
  const ready = sandboxReady(getBackendBaseUrl());
  payWithPiBtn.disabled = !ready;
  if (!ready) {
    setLog(dexAccessResult, 'Test payments are unavailable until a Testnet backend is configured.');
    paymentSubmitBtn.disabled = true;
  } else if (lifetimeDexUnlocked) {
    const paymentId = dexUnlockRecord?.paymentId || 'stored';
    const unlockedAt = dexUnlockRecord?.unlockedAt || dexUnlockRecord?.at || 'unknown time';
    setLog(dexAccessResult, `Lifetime DEX access: active. Payment id: ${paymentId}. Unlocked at: ${unlockedAt}`);
    paymentSubmitBtn.disabled = true;
    paymentSubmitBtn.textContent = 'Lifetime DEX Access Already Unlocked';
  } else {
    setLog(dexAccessResult, 'Lifetime DEX access: locked (1 Pi payment required).');
    paymentSubmitBtn.disabled = false;
    paymentSubmitBtn.textContent = 'Pay 1 Pi Once For Lifetime DEX Access';
  }

  const canQuote = ready && Boolean(piUser) && lifetimeDexUnlocked;
  const canExecute = canQuote && localPage && looksLikeLocalhostUrl(verifiedSandboxBackend);
  dexSubmitBtn.disabled = !canExecute;
  bootstrapBtn.disabled = !canExecute;
  quoteBtn.disabled = !canQuote;
}

function updatePaymentMetadataDefaults() {
  const metadataField = document.getElementById('metadata');
  metadataField.value = JSON.stringify({
    app: 'a-network-testnet',
    purpose: dexMetadataPurpose,
    plan: 'lifetime',
    pi_uid: piUser?.uid || '',
    pi_username: piUser?.username || ''
  }, null, 2);
}

function buildSandboxTestMetadata() {
  return {
    app: 'a-network-testnet',
    purpose: sandboxMetadataPurpose,
    environment: 'sandbox',
    sourceUrl: window.location.href,
    pi_uid: piUser?.uid || '',
    pi_username: piUser?.username || ''
  };
}

async function fetchSdkConfig(backendBaseUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  const response = await fetch(`${backendBaseUrl}/api/pi/config`, {
    signal: controller.signal
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`Config fetch failed with status ${response.status}`);
  }
  return response.json();
}

function looksLikeLocalhostUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function getBackendBaseUrl() {
  const value = backendBaseUrlInput.value.trim().replace(/\/$/, '');
  if (!value || value === 'https://a-network.net') return DEFAULT_BACKEND_BASE_URL;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash)
      return '';
    return parsed.protocol === 'https:' || (localPage && looksLikeLocalhostUrl(value) && parsed.protocol === 'http:')
      ? parsed.origin
      : '';
  } catch {
    return '';
  }
}

function sandboxReady(backendBaseUrl) {
  return Boolean(piInitialized && backendBaseUrl && verifiedSandboxBackend === backendBaseUrl);
}

async function warmBackend(backendBaseUrl) {
  if (!sandboxReady(backendBaseUrl)) throw new Error('A verified Testnet backend is required.');
  const [, config] = await Promise.all([
    getJson(`${backendBaseUrl}/health`),
    fetchSdkConfig(backendBaseUrl)
  ]);
  if (config?.sdk?.sandbox !== true || config?.policy?.testPaymentsReady !== true || !sandboxReady(backendBaseUrl)) {
    if (verifiedSandboxBackend === backendBaseUrl) verifiedSandboxBackend = '';
    renderDexAccessState();
    throw new Error('The backend must have Testnet enabled and a Testnet API key and app wallet configured.');
  }
}

async function initializePiFromBackendConfig() {
  const revision = ++configRevision;
  if (!piInitialized && window.Pi) {
    Pi.init({ version: '2.0', sandbox: true });
    piInitialized = true;
  }
  verifiedSandboxBackend = '';
  setDexUnlocked(null);
  if (!piInitialized) {
    sdkStatus.textContent = 'Pi SDK not available. Open the Pi Sandbox to connect.';
    return;
  }

  const backendBaseUrl = getBackendBaseUrl();
  sdkStatus.textContent = 'Checking Testnet backend…';
  try {
    if (!backendBaseUrl) throw new Error('Enter a valid HTTPS backend address.');
    const config = await fetchSdkConfig(backendBaseUrl);
    if (revision !== configRevision) return;
    if (config?.sdk?.sandbox !== true)
      throw new Error('The configured backend is in production mode.');
    if (config?.policy?.testPaymentsReady !== true)
      throw new Error('The backend needs a Testnet API key and app wallet.');
    const amount = Number(config?.policy?.requiredAmount || 1);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid test payment amount.');
    requiredAmount = amount;
    dexMetadataPurpose = String(config?.policy?.metadataPurpose || 'dex-lifetime-unlock');
    sandboxMetadataPurpose = String(config?.policy?.sandboxMetadataPurpose || 'sandbox-test-payment');
    const amountInput = document.getElementById('amount');
    amountInput.value = amountInput.min = amountInput.max = String(requiredAmount);
    verifiedSandboxBackend = backendBaseUrl;
    sdkStatus.textContent = 'Pi Sandbox · Testnet backend verified';
  } catch (error) {
    if (revision !== configRevision) return;
    sdkStatus.textContent = `Pi Sandbox · Test payments disabled. ${error.message}`;
  }
  updatePaymentMetadataDefaults();
  renderDexAccessState();
}

async function refreshDexStatus() {
  const uid = piUser?.uid;
  const backendBaseUrl = getBackendBaseUrl();
  if (!uid || !sandboxReady(backendBaseUrl)) {
    setDexUnlocked(null);
    return;
  }
  const revision = configRevision;
  try {
    const status = await getJson(`${backendBaseUrl}/api/pi/dex/status/${encodeURIComponent(uid)}`);
    if (revision === configRevision && piUser?.uid === uid && sandboxReady(backendBaseUrl))
      setDexUnlocked(status?.unlocked === true ? status : null);
  } catch {
    if (revision === configRevision && piUser?.uid === uid) setDexUnlocked(null);
  }
}

async function authenticatePiUser() {
  if (!piInitialized) {
    setLog(authResult, 'Pi SDK is not initialized yet.', true);
    return;
  }

  if (!window.Pi) {
    setLog(authResult, 'Pi SDK not detected. Open this page in Pi Browser sandbox mode.', true);
    return;
  }

  try {
    const scopes = sandboxReady(getBackendBaseUrl()) ? ['username', 'payments'] : ['username'];
    const auth = await Pi.authenticate(scopes, handleIncompletePayment);
    piUser = auth.user;
    paymentScopeGranted = scopes.includes('payments');
    setLog(authResult, `Signed in as @${piUser.username}.`);
    updatePaymentMetadataDefaults();
    await refreshDexStatus();
  } catch (error) {
    setLog(authResult, `Authentication failed: ${error.message}`, true);
  }
}

async function ensurePiUserAuthenticated() {
  if (piUser) {
    return piUser;
  }

  await authenticatePiUser();

  if (!piUser) {
    throw new Error('Pi user authentication is required before creating a payment.');
  }

  return piUser;
}

async function approvePaymentOnBackend(backendBaseUrl, paymentId) {
  return postJson(`${backendBaseUrl}/approve`, { paymentId });
}

async function completePaymentOnBackend(backendBaseUrl, paymentId, txid) {
  return postJson(`${backendBaseUrl}/complete`, { paymentId, txid });
}

function clearSession() {
  piUser = null;
  paymentScopeGranted = false;
  lifetimeDexUnlocked = false;
  dexUnlockRecord = null;
  setLog(authResult, 'Session cleared.');
  setLog(paymentResult, 'Payment not started.');
  setLog(dexBootstrapResult, 'DEX pool bootstrap not requested.');
  setLog(dexQuoteResult, 'Swap quote not requested.');
  setLog(dexExecuteResult, 'Swap not executed.');
  updatePaymentMetadataDefaults();
  renderDexAccessState();
}

async function startPayment(event) {
  event.preventDefault();

  if (!piInitialized) {
    setLog(paymentResult, 'Pi SDK is not initialized yet.', true);
    return;
  }

  if (!window.Pi) {
    setLog(paymentResult, 'Pi SDK not detected. Open this page in Pi Browser sandbox mode.', true);
    return;
  }

  if (!piUser) {
    setLog(paymentResult, 'Authenticate Pi user first.', true);
    return;
  }

  if (lifetimeDexUnlocked) {
    setLog(paymentResult, 'Lifetime DEX access is already active for this Pi user.');
    return;
  }

  const amount = Number(document.getElementById('amount').value);
  const memo = document.getElementById('memo').value.trim();
  const metadataText = document.getElementById('metadata').value.trim();
  const backendBaseUrl = getBackendBaseUrl();

  const metadata = safeJsonParse(metadataText);
  if (!metadata) {
    setLog(paymentResult, 'Metadata must be valid JSON.', true);
    return;
  }

  if (!Number.isFinite(amount) || Math.abs(amount - requiredAmount) > 0.000001) {
    setLog(paymentResult, `Amount must be exactly ${requiredAmount} Pi for lifetime DEX access.`, true);
    return;
  }

  metadata.pi_uid = piUser.uid || metadata.pi_uid || '';
  metadata.pi_username = piUser.username || metadata.pi_username || '';

  setLog(paymentResult, 'Preparing for payment: checking backend health and config...');

  try {
    await warmBackend(backendBaseUrl);

    setLog(paymentResult, 'Opening Pi payment sheet...');

    let completionResponse = null;
    await Pi.createPayment({ amount, memo, metadata }, {
      onReadyForServerApproval: async (paymentId) => {
        setLog(paymentResult, `Payment created. Awaiting server approval for paymentId ${paymentId}...`);
        try {
          return await approvePaymentOnBackend(backendBaseUrl, paymentId);
        } catch (error) {
          setLog(paymentResult, `Approval failed for ${paymentId}: ${error.message}`, true);
          throw error;
        }
      },
      onReadyForServerCompletion: async (paymentId, txid) => {
        setLog(paymentResult, `Approved. Completing paymentId ${paymentId} with txid ${txid}...`);
        try {
          return await completePaymentOnBackend(backendBaseUrl, paymentId, txid);
        } catch (error) {
          setLog(paymentResult, `Completion failed for ${paymentId}: ${error.message}`, true);
          throw error;
        }
      },
      onCancel: (paymentId) => {
        setLog(paymentResult, `User canceled payment: ${paymentId || 'unknown payment id'}`);
      },
      onError: (error, payment) => {
        setLog(paymentResult, `Payment error: ${JSON.stringify({ error: error?.message || String(error), payment: payment || null }, null, 2)}`, true);
      }
    });

    await refreshDexStatus();
    setLog(paymentResult, lifetimeDexUnlocked
      ? 'Test payment confirmed. DEX access is active.'
      : 'Waiting for the backend to confirm this test payment.');
  } catch (error) {
    setLog(paymentResult, `Failed to create payment: ${error.message}`, true);
  }
}

async function runSimplePiPayment() {
  if (!piInitialized) {
    setLog(payWithPiResult, 'Pi SDK is not initialized yet.', true);
    return;
  }

  if (!window.Pi) {
    setLog(payWithPiResult, 'Pi SDK not detected. Open this page in Pi Browser sandbox mode.', true);
    return;
  }

  const backendBaseUrl = getBackendBaseUrl();
  if (!backendBaseUrl) {
    setLog(payWithPiResult, 'Backend Base URL is required before starting a payment.', true);
    return;
  }

  try {
    setLog(payWithPiResult, 'Preparing for payment: checking backend health and config...');
    await warmBackend(backendBaseUrl);

    await ensurePiUserAuthenticated();

    const amount = requiredAmount;
    const memo = 'A Network Sandbox Test Payment';
    const metadata = buildSandboxTestMetadata();
    let completionResponse = null;

    setLog(payWithPiResult, 'Opening Pi payment sheet...');

    const payment = await Pi.createPayment({ amount, memo, metadata }, {
      onReadyForServerApproval: async (paymentId) => {
        setLog(payWithPiResult, `Payment created. Sending ${paymentId} to /approve...`);
        try {
          return await approvePaymentOnBackend(backendBaseUrl, paymentId);
        } catch (error) {
          setLog(payWithPiResult, `Approval failed for ${paymentId}: ${error.message}`, true);
          throw error;
        }
      },
      onReadyForServerCompletion: async (paymentId, txid) => {
        setLog(payWithPiResult, `Payment approved. Sending ${paymentId} and ${txid} to /complete...`);
        try {
          completionResponse = await completePaymentOnBackend(backendBaseUrl, paymentId, txid);
          return completionResponse;
        } catch (error) {
          setLog(payWithPiResult, `Completion failed for ${paymentId}: ${error.message}`, true);
          throw error;
        }
      },
      onCancel: (paymentId) => {
        setLog(payWithPiResult, `Payment canceled by user. Payment id: ${paymentId || 'unknown'}`);
      },
      onError: (error, paymentContext) => {
        setLog(payWithPiResult, JSON.stringify({
          error: error?.message || String(error),
          payment: paymentContext || null
        }, null, 2), true);
      }
    });

    setLog(payWithPiResult, JSON.stringify({
      ok: true,
      user: piUser,
      payment,
      backend: completionResponse
    }, null, 2));
  } catch (error) {
    setLog(payWithPiResult, `Pay with Pi failed: ${error.message}`, true);
  }
}

function getDexPayload() {
  const direction = document.getElementById('swapDirection').value;
  return {
    uid: piUser?.uid || '',
    username: piUser?.username || '',
    trader: document.getElementById('traderWallet').value.trim().toUpperCase(),
    token_symbol: document.getElementById('tokenSymbol').value.trim().toUpperCase(),
    amount_in: Number(document.getElementById('amountIn').value),
    anet_to_token: direction === 'anet-to-token'
  };
}

async function requestDexQuote() {
  if (!piUser) {
    setLog(dexQuoteResult, 'Authenticate Pi user first.', true);
    return;
  }

  if (!lifetimeDexUnlocked) {
    setLog(dexQuoteResult, 'Pay the 1 Pi lifetime DEX access fee first.', true);
    return;
  }

  const backendBaseUrl = getBackendBaseUrl();
  const payload = getDexPayload();
  if (!payload.token_symbol || !Number.isInteger(payload.amount_in) || payload.amount_in <= 0) {
    setLog(dexQuoteResult, 'Token symbol and a positive whole amount are required for a quote.', true);
    return;
  }

  try {
    await warmBackend(backendBaseUrl);
    setLog(dexQuoteResult, 'Requesting DEX quote...');
    const response = await postJson(`${backendBaseUrl}/api/pi/dex/quote`, payload);
    setLog(dexQuoteResult, JSON.stringify(response, null, 2));
  } catch (error) {
    setLog(dexQuoteResult, `Quote request failed: ${error.message}`, true);
  }
}

async function bootstrapDexPool() {
  if (!piUser) {
    setLog(dexBootstrapResult, 'Authenticate Pi user first.', true);
    return;
  }

  if (!lifetimeDexUnlocked) {
    setLog(dexBootstrapResult, 'Pay the 1 Pi lifetime DEX access fee first.', true);
    return;
  }

  const payload = getDexPayload();
  const senderSeed = document.getElementById('senderSeed').value.trim();
  if (!localPage || !looksLikeLocalhostUrl(getBackendBaseUrl())) {
    setLog(dexBootstrapResult, 'Signing is available only in a local test environment.', true);
    return;
  }
  if (!payload.trader || !senderSeed) {
    setLog(dexBootstrapResult, 'ANET wallet and seed phrase are required to bootstrap pool.', true);
    return;
  }

  const backendBaseUrl = getBackendBaseUrl();

  try {
    await warmBackend(backendBaseUrl);
    setLog(dexBootstrapResult, 'Bootstrapping a local test pool…');
    const response = await postJson(`${backendBaseUrl}/api/pi/dex/bootstrap`, {
      uid: piUser.uid,
      username: piUser.username,
      provider: payload.trader,
      sender_seed: senderSeed,
      token_symbol: payload.token_symbol,
      anet_amount_ants: payload.amount_in,
      token_amount_units: payload.amount_in,
      fee_bps: 30,
      mint_test_assets: true
    });

    setLog(dexBootstrapResult, JSON.stringify(response, null, 2));
  } catch (error) {
    setLog(dexBootstrapResult, `DEX pool bootstrap failed: ${error.message}`, true);
  }
}

async function submitDexSwap(event) {
  event.preventDefault();

  if (!piUser) {
    setLog(dexExecuteResult, 'Authenticate Pi user first.', true);
    return;
  }

  if (!lifetimeDexUnlocked) {
    setLog(dexExecuteResult, 'Pay the 1 Pi lifetime DEX access fee first.', true);
    return;
  }

  const backendBaseUrl = getBackendBaseUrl();
  const payload = getDexPayload();

  const senderSeed = document.getElementById('senderSeed').value.trim();
  if (!localPage || !looksLikeLocalhostUrl(backendBaseUrl)) {
    setLog(dexExecuteResult, 'Signing is available only in a local test environment.', true);
    return;
  }
  if (!payload.trader || !senderSeed) {
    setLog(dexExecuteResult, 'ANET wallet and seed phrase are required to execute a swap.', true);
    return;
  }

  if (!payload.token_symbol || !Number.isInteger(payload.amount_in) || payload.amount_in <= 0) {
    setLog(dexExecuteResult, 'Token symbol and a positive whole amount are required.', true);
    return;
  }

  try {
    await warmBackend(backendBaseUrl);
    setLog(dexExecuteResult, 'Submitting a local test swap…');
    const response = await postJson(`${backendBaseUrl}/api/pi/dex/execute`, { ...payload, sender_seed: senderSeed });
    setLog(dexExecuteResult, JSON.stringify(response, null, 2));
  } catch (error) {
    setLog(dexExecuteResult, `Swap execution failed: ${error.message}`, true);
  }
}

authBtn.addEventListener('click', authenticatePiUser);
payWithPiBtn.addEventListener('click', runSimplePiPayment);
disconnectBtn.addEventListener('click', clearSession);
paymentForm.addEventListener('submit', startPayment);
dexForm.addEventListener('submit', submitDexSwap);
bootstrapBtn.addEventListener('click', bootstrapDexPool);
quoteBtn.addEventListener('click', requestDexQuote);
backendBaseUrlInput.addEventListener('change', async () => {
  await initializePiFromBackendConfig();
  await refreshDexStatus();
});

document.getElementById('signingSecretField').hidden = !localPage;
updatePaymentMetadataDefaults();
if (!backendBaseUrlInput.value.trim() || backendBaseUrlInput.value.trim() === 'https://a-network.net') {
  backendBaseUrlInput.value = DEFAULT_BACKEND_BASE_URL;
}
initializePiFromBackendConfig();
renderDexAccessState();
