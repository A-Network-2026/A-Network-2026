const sdkStatus = document.getElementById('sdkStatus');
const authResult = document.getElementById('authResult');
const paymentResult = document.getElementById('paymentResult');
const miningAccessResult = document.getElementById('miningAccessResult');

const authBtn = document.getElementById('authBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const paymentForm = document.getElementById('paymentForm');
const backendBaseUrlInput = document.getElementById('backendBaseUrl');

const urlParams = new URLSearchParams(window.location.search);
const modeParam = String(urlParams.get('mode') || '').toLowerCase();
const initialSandboxMode = modeParam !== 'prod';

let piUser = null;
let piInitialized = false;
let requiredAmount = 1;

function setLog(target, value, isError = false) {
  target.textContent = value;
  target.classList.toggle('error', isError);
}

function markMiningAccessUnlocked(paymentId) {
  const payload = {
    unlocked: true,
    paymentId,
    at: new Date().toISOString()
  };
  try {
    localStorage.setItem('anet_mining_access', JSON.stringify(payload));
  } catch {
    // Ignore storage errors and still reflect UI state for current session.
  }
  setLog(miningAccessResult, `Mining access: unlocked. Payment id: ${paymentId}`);
}

function renderMiningAccessState() {
  try {
    const raw = localStorage.getItem('anet_mining_access');
    if (!raw) {
      setLog(miningAccessResult, 'Mining access: locked (payment required).');
      return;
    }
    const parsed = JSON.parse(raw);
    if (parsed?.unlocked) {
      setLog(miningAccessResult, `Mining access: unlocked. Payment id: ${parsed.paymentId || 'stored'}`);
      return;
    }
  } catch {
    // Fall through to locked state when parsing fails.
  }
  setLog(miningAccessResult, 'Mining access: locked (payment required).');
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

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}): ${body || 'unknown server error'}`);
  }

  return response.json();
}

function handleIncompletePayment(payment) {
  setLog(paymentResult, `Incomplete payment found: ${JSON.stringify(payment, null, 2)}`);
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

  const backendBaseUrl = backendBaseUrlInput.value.trim().replace(/\/$/, '');

  if (!backendBaseUrl) {
    sdkStatus.textContent = `SDK: Ready in ${initialSandboxMode ? 'sandbox' : 'production'} mode (backend URL missing).`;
    sdkStatus.style.color = '#ff8a8a';
    return;
  }

  if (looksLikeLocalhostUrl(backendBaseUrl) && window.location.hostname !== 'localhost') {
    sdkStatus.textContent = 'SDK: Localhost backend not reachable from Pi Browser. Using sandbox mode.';
    sdkStatus.style.color = '#ff8a8a';
    return;
  }

  try {
    const config = await fetchSdkConfig(backendBaseUrl);
    const backendSandboxMode = Boolean(config?.sdk?.sandbox);
    requiredAmount = Number(config?.policy?.requiredAmount || 1);

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
  } catch (error) {
    setLog(authResult, `Authentication failed: ${error.message}`, true);
  }
}

function clearSession() {
  piUser = null;
  setLog(authResult, 'Session cleared.');
  setLog(paymentResult, 'Payment not started.');
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

  const amount = Number(document.getElementById('amount').value);
  const memo = document.getElementById('memo').value.trim();
  const metadataText = document.getElementById('metadata').value.trim();
  const backendBaseUrl = document.getElementById('backendBaseUrl').value.trim().replace(/\/$/, '');

  const metadata = safeJsonParse(metadataText);
  if (!metadata) {
    setLog(paymentResult, 'Metadata must be valid JSON.', true);
    return;
  }

  if (Math.abs(amount - requiredAmount) > 0.000001) {
    setLog(paymentResult, `Amount must be exactly ${requiredAmount} Pi for mining access.`, true);
    return;
  }

  const paymentData = {
    amount,
    memo,
    metadata
  };

  setLog(paymentResult, 'Opening Pi payment sheet...');

  try {
    const createdPayment = await Pi.createPayment(paymentData, {
      onReadyForServerApproval: async (paymentId) => {
        setLog(paymentResult, `Payment created. Awaiting server approval for paymentId ${paymentId}...`);
        return postJson(`${backendBaseUrl}/api/pi/payments/approve`, { paymentId });
      },
      onReadyForServerCompletion: async (paymentId, txid) => {
        setLog(paymentResult, `Approved. Completing paymentId ${paymentId} with txid ${txid}...`);
        return postJson(`${backendBaseUrl}/api/pi/payments/complete`, { paymentId, txid });
      },
      onCancel: (paymentId) => {
        setLog(paymentResult, `User canceled payment: ${paymentId || 'unknown payment id'}`);
      },
      onError: (error, payment) => {
        const details = {
          error: error?.message || String(error),
          payment: payment || null
        };
        setLog(paymentResult, `Payment error: ${JSON.stringify(details, null, 2)}`, true);
      }
    });

    const paymentId = createdPayment?.identifier || createdPayment?.paymentId || createdPayment?.id || 'unknown';
    markMiningAccessUnlocked(paymentId);
    setLog(paymentResult, 'Payment completed and mining access unlocked.');
  } catch (error) {
    setLog(paymentResult, `Failed to create payment: ${error.message}`, true);
  }
}

authBtn.addEventListener('click', authenticatePiUser);
disconnectBtn.addEventListener('click', clearSession);
paymentForm.addEventListener('submit', startPayment);
backendBaseUrlInput.addEventListener('change', initializePiFromBackendConfig);
initializePiFromBackendConfig();
renderMiningAccessState();
