const sdkStatus = document.getElementById('sdkStatus');
const authResult = document.getElementById('authResult');
const payWithPiResult = document.getElementById('payWithPiResult');
const paymentResult = document.getElementById('paymentResult');
const dexAccessResult = document.getElementById('dexAccessResult');
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
const quoteBtn = document.getElementById('quoteBtn');

const DEFAULT_BACKEND_BASE_URL = 'https://pi-backend-q2ye.onrender.com';

const urlParams = new URLSearchParams(window.location.search);
const modeParam = String(urlParams.get('mode') || '').toLowerCase();
const initialSandboxMode = modeParam !== 'prod';

let piUser = null;
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
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const bodyText = await response.text();
  const body = bodyText ? safeJsonParse(bodyText) || bodyText : null;

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }

  return body;
}

async function getJson(url) {
  const response = await fetch(url);
  const bodyText = await response.text();
  const body = bodyText ? safeJsonParse(bodyText) || bodyText : null;

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }

  return body;
}

function handleIncompletePayment(payment) {
  setLog(paymentResult, `Incomplete payment found: ${JSON.stringify(payment, null, 2)}`);
  if (payWithPiResult) {
    setLog(payWithPiResult, `Incomplete payment found: ${JSON.stringify(payment, null, 2)}`);
  }
}

function dexStorageKey(uid) {
  return `anet_dex_unlock:${String(uid || 'guest').trim() || 'guest'}`;
}

function persistLocalUnlock(record) {
  const uid = record?.uid || piUser?.uid || 'guest';
  try {
    localStorage.setItem(dexStorageKey(uid), JSON.stringify(record));
  } catch {
    // Ignore storage errors.
  }
}

function readLocalUnlock(uid) {
  try {
    const raw = localStorage.getItem(dexStorageKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setDexUnlocked(record) {
  lifetimeDexUnlocked = Boolean(record?.unlocked || record?.paymentId);
  dexUnlockRecord = lifetimeDexUnlocked ? record : null;

  if (lifetimeDexUnlocked) {
    persistLocalUnlock({
      uid: record?.uid || piUser?.uid || '',
      username: record?.username || piUser?.username || '',
      paymentId: record?.paymentId || 'unknown',
      unlocked: true,
      unlockedAt: record?.unlockedAt || new Date().toISOString()
    });
  }

  renderDexAccessState();
}

function renderDexAccessState() {
  if (lifetimeDexUnlocked) {
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

  dexSubmitBtn.disabled = !piUser || !lifetimeDexUnlocked;
  quoteBtn.disabled = !piUser || !lifetimeDexUnlocked;
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
  if (value === 'https://a-network.net') {
    backendBaseUrlInput.value = DEFAULT_BACKEND_BASE_URL;
    return DEFAULT_BACKEND_BASE_URL;
  }
  return value;
}

function initPiSdk(sandboxMode) {
  if (!window.Pi) {
    sdkStatus.textContent = 'SDK: Pi SDK not available. Open this page in Pi Browser.';
    sdkStatus.style.color = '#ff8a8a';
    return false;
  }

  Pi.init({ version: '2.0', sandbox: sandboxMode });
  sdkStatus.textContent = `SDK: Ready in ${sandboxMode ? 'sandbox' : 'production'} mode`;
  return true;
}

async function initializePiFromBackendConfig() {
  if (!piInitialized) {
    piInitialized = initPiSdk(initialSandboxMode);
    if (!piInitialized) {
      return;
    }
  }

  const backendBaseUrl = getBackendBaseUrl();

  if (!backendBaseUrl) {
    sdkStatus.textContent = `SDK: Ready in ${initialSandboxMode ? 'sandbox' : 'production'} mode (backend URL missing).`;
    sdkStatus.style.color = '#ff8a8a';
    return;
  }

  if (looksLikeLocalhostUrl(backendBaseUrl) && window.location.hostname !== 'localhost') {
    sdkStatus.textContent = 'SDK: Localhost backend not reachable from Pi Browser. Using sandbox mode.';
    sdkStatus.style.color = '#ff8a8a';
    renderDexAccessState();
    return;
  }

  try {
    const config = await fetchSdkConfig(backendBaseUrl);
    const backendSandboxMode = Boolean(config?.sdk?.sandbox);
    requiredAmount = Number(config?.policy?.requiredAmount || 1);
    dexMetadataPurpose = String(config?.policy?.metadataPurpose || dexMetadataPurpose);
    sandboxMetadataPurpose = String(config?.policy?.sandboxMetadataPurpose || sandboxMetadataPurpose);

    const amountInput = document.getElementById('amount');
    amountInput.value = String(requiredAmount);
    amountInput.min = String(requiredAmount);
    amountInput.max = String(requiredAmount);

    if (backendSandboxMode !== initialSandboxMode) {
      sdkStatus.textContent = `SDK: Running in ${initialSandboxMode ? 'sandbox' : 'production'} mode (backend config suggests ${backendSandboxMode ? 'sandbox' : 'production'}).`;
      sdkStatus.style.color = '#ffbf73';
    }
  } catch (error) {
    sdkStatus.textContent = `SDK: Config fetch failed (${error.message}). Running in ${initialSandboxMode ? 'sandbox' : 'production'} mode.`;
    sdkStatus.style.color = '#ff8a8a';
  }

  updatePaymentMetadataDefaults();
  renderDexAccessState();
}

async function refreshDexStatus() {
  if (!piUser?.uid) {
    setDexUnlocked(readLocalUnlock('guest'));
    return;
  }

  const backendBaseUrl = getBackendBaseUrl();
  if (!backendBaseUrl || (looksLikeLocalhostUrl(backendBaseUrl) && window.location.hostname !== 'localhost')) {
    setDexUnlocked(readLocalUnlock(piUser.uid));
    return;
  }

  try {
    const status = await getJson(`${backendBaseUrl}/api/pi/dex/status/${encodeURIComponent(piUser.uid)}`);
    if (status?.unlocked) {
      setDexUnlocked(status);
      return;
    }
    setDexUnlocked(readLocalUnlock(piUser.uid));
  } catch {
    setDexUnlocked(readLocalUnlock(piUser.uid));
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
    const scopes = ['username', 'payments'];
    const auth = await Pi.authenticate(scopes, handleIncompletePayment);
    piUser = auth.user;
    setLog(authResult, JSON.stringify(auth, null, 2));
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
  lifetimeDexUnlocked = false;
  dexUnlockRecord = null;
  setLog(authResult, 'Session cleared.');
  setLog(paymentResult, 'Payment not started.');
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

  if (Math.abs(amount - requiredAmount) > 0.000001) {
    setLog(paymentResult, `Amount must be exactly ${requiredAmount} Pi for lifetime DEX access.`, true);
    return;
  }

  metadata.pi_uid = piUser.uid || metadata.pi_uid || '';
  metadata.pi_username = piUser.username || metadata.pi_username || '';

  setLog(paymentResult, 'Opening Pi payment sheet...');

  try {
    let completionResponse = null;
    const createdPayment = await Pi.createPayment({ amount, memo, metadata }, {
      onReadyForServerApproval: async (paymentId) => {
        setLog(paymentResult, `Payment created. Awaiting server approval for paymentId ${paymentId}...`);
        return approvePaymentOnBackend(backendBaseUrl, paymentId);
      },
      onReadyForServerCompletion: async (paymentId, txid) => {
        setLog(paymentResult, `Approved. Completing paymentId ${paymentId} with txid ${txid}...`);
        completionResponse = await completePaymentOnBackend(backendBaseUrl, paymentId, txid);
        return completionResponse;
      },
      onCancel: (paymentId) => {
        setLog(paymentResult, `User canceled payment: ${paymentId || 'unknown payment id'}`);
      },
      onError: (error, payment) => {
        setLog(paymentResult, `Payment error: ${JSON.stringify({ error: error?.message || String(error), payment: payment || null }, null, 2)}`, true);
      }
    });

    const paymentId = createdPayment?.identifier || createdPayment?.paymentId || createdPayment?.id || completionResponse?.paymentId || 'unknown';
    setDexUnlocked(completionResponse?.unlock || {
      uid: piUser.uid,
      username: piUser.username,
      paymentId,
      unlocked: true,
      unlockedAt: new Date().toISOString()
    });
    setLog(paymentResult, '1 Pi payment completed. Lifetime DEX access is now unlocked for this Pi user.');
    await refreshDexStatus();
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
    await ensurePiUserAuthenticated();

    const amount = requiredAmount;
    const memo = 'A Network Sandbox Test Payment';
    const metadata = buildSandboxTestMetadata();
    let completionResponse = null;

    setLog(payWithPiResult, 'Opening Pi payment sheet...');

    const payment = await Pi.createPayment({ amount, memo, metadata }, {
      onReadyForServerApproval: async (paymentId) => {
        setLog(payWithPiResult, `Payment created. Sending ${paymentId} to /approve...`);
        return approvePaymentOnBackend(backendBaseUrl, paymentId);
      },
      onReadyForServerCompletion: async (paymentId, txid) => {
        setLog(payWithPiResult, `Payment approved. Sending ${paymentId} and ${txid} to /complete...`);
        completionResponse = await completePaymentOnBackend(backendBaseUrl, paymentId, txid);
        return completionResponse;
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
    sender_seed: document.getElementById('senderSeed').value.trim(),
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
    setLog(dexQuoteResult, 'Requesting DEX quote...');
    const response = await postJson(`${backendBaseUrl}/api/pi/dex/quote`, payload);
    setLog(dexQuoteResult, JSON.stringify(response, null, 2));
  } catch (error) {
    setLog(dexQuoteResult, `Quote request failed: ${error.message}`, true);
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

  if (!payload.trader || !payload.sender_seed) {
    setLog(dexExecuteResult, 'ANET wallet and seed phrase are required to execute a swap.', true);
    return;
  }

  if (!payload.token_symbol || !Number.isInteger(payload.amount_in) || payload.amount_in <= 0) {
    setLog(dexExecuteResult, 'Token symbol and a positive whole amount are required.', true);
    return;
  }

  try {
    setLog(dexExecuteResult, 'Submitting DEX swap to backend...');
    const response = await postJson(`${backendBaseUrl}/api/pi/dex/execute`, payload);
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
quoteBtn.addEventListener('click', requestDexQuote);
backendBaseUrlInput.addEventListener('change', async () => {
  await initializePiFromBackendConfig();
  await refreshDexStatus();
});

updatePaymentMetadataDefaults();
if (!backendBaseUrlInput.value.trim() || backendBaseUrlInput.value.trim() === 'https://a-network.net') {
  backendBaseUrlInput.value = DEFAULT_BACKEND_BASE_URL;
}
initializePiFromBackendConfig();
renderDexAccessState();
