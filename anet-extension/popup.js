/**
 * ANET Wallet — popup logic
 * Reuses window.AnetWallet (same key derivation + signing the L1 verifies).
 * The private key stays encrypted in this extension's storage and is only
 * decrypted in memory here to sign; it is never sent anywhere.
 */
'use strict';

const API_BASE = 'https://explorer.a-network.net';
const ANET_TOKEN = '0x791055A7d52AA392eaE8De04250497f33807E46A'; // for USD price
const ANTS_PER_ANET = 100000000;
const DEFAULT_ASSET_DECIMALS = 8;
let CHAIN_ID = 'anet-private-mainnet-1';
let backupKeyHex = '';
let tokenMetaCache = null;

const $ = (id) => document.getElementById(id);
const W = () => window.AnetWallet;

/* ── helpers ─────────────────────────────────────────────────────── */
function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast ' + type; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}
function show(viewId) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== viewId; });
  $('lock-btn').hidden = !(W() && W().isUnlocked());
}
function shortAddr(a) { return a ? a.slice(0, 8) + '…' + a.slice(-6) : ''; }
function fmt(n, dp = 4) {
  if (n == null || !isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: dp });
}
async function mirrorAddress(addr) {
  await chrome.storage.local.set({ walletAddress: addr || '' });
  try { await chrome.runtime.sendMessage({ type: 'WALLET_CHANGED' }); } catch (_) {}
}

async function refreshChainId() {
  try {
    const res = await fetch(`${API_BASE}/sync/head`);
    const data = await res.json();
    if (data && data.chain_id) CHAIN_ID = String(data.chain_id);
  } catch (_) {}
}

/* ── routing ─────────────────────────────────────────────────────── */
function route() {
  const w = W();
  if (!w) { toast('Wallet module failed to load', 'err'); return; }
  if (w.isUnlocked()) { openDashboard(); return; }
  if (w.hasVault()) {
    $('unlock-addr').textContent = w.vaultAddress();
    show('view-unlock');
    return;
  }
  show('view-onboarding');
}

/* ── onboarding ──────────────────────────────────────────────────── */
function initOnboarding() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      $('pane-create').hidden = tab.dataset.tab !== 'create';
      $('pane-import').hidden = tab.dataset.tab !== 'import';
    });
  });

  $('create-btn').addEventListener('click', async () => {
    const pw = $('create-pw').value, pw2 = $('create-pw2').value;
    if (pw.length < 8) return toast('Password must be at least 8 characters', 'err');
    if (pw !== pw2) return toast('Passwords do not match', 'err');
    try {
      const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
      const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
      const addr = await W().importSecret({ secret: hex, persist: true, password: pw });
      backupKeyHex = hex;
      await mirrorAddress(addr);
      $('backup-key').textContent = hex;
      show('view-backup');
    } catch (e) { toast(e.message || 'Create failed', 'err'); }
  });

  $('import-btn').addEventListener('click', async () => {
    const secret = $('import-secret').value.trim();
    const pw = $('import-pw').value;
    if (!secret) return toast('Enter your seed phrase or key', 'err');
    if (pw.length < 8) return toast('Password must be at least 8 characters', 'err');
    try {
      const addr = await W().importSecret({ secret, persist: true, password: pw });
      await mirrorAddress(addr);
      $('import-secret').value = '';
      toast('Wallet imported', 'ok');
      openDashboard();
    } catch (e) { toast(e.message || 'Import failed', 'err'); }
  });

  $('backup-ack').addEventListener('change', (e) => { $('backup-done-btn').disabled = !e.target.checked; });
  $('copy-key-btn').addEventListener('click', () => { navigator.clipboard.writeText(backupKeyHex); toast('Key copied', 'ok'); });
  $('backup-done-btn').addEventListener('click', () => { backupKeyHex = ''; $('backup-key').textContent = ''; openDashboard(); });
}

/* ── unlock ──────────────────────────────────────────────────────── */
function initUnlock() {
  const doUnlock = async () => {
    try {
      const addr = await W().unlock($('unlock-pw').value);
      await mirrorAddress(addr);
      $('unlock-pw').value = '';
      openDashboard();
    } catch (e) { toast('Wrong password', 'err'); }
  };
  $('unlock-btn').addEventListener('click', doUnlock);
  $('unlock-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doUnlock(); });
  $('forget-btn').addEventListener('click', async () => {
    if (!confirm('Remove this wallet from this browser? Make sure you have your key backed up.')) return;
    W().forget(); await mirrorAddress(''); route();
  });
}

/* ── dashboard ───────────────────────────────────────────────────── */
async function openDashboard() {
  const addr = W().currentAddress();
  $('dash-addr').textContent = addr;
  show('view-dashboard');
  loadBalance(addr);
}

async function loadBalance(addr) {
  $('bal-anet').textContent = '…';
  try {
    const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(addr)}`);
    const data = await res.json().catch(() => ({}));
    const ants = Number(data.ants_balance || 0);
    const anet = ants / ANTS_PER_ANET;
    $('bal-anet').textContent = fmt(anet, 4);
    $('bal-ants').textContent = fmt(ants, 0) + ' ANTS';
    loadUsd(anet);
    $('send-avail').textContent = `Available: ${fmt(anet, 4)} ANET`;
    $('send-avail').dataset.anet = String(anet);
    await renderAssets(data.asset_balances || {});
  } catch (e) {
    $('bal-anet').textContent = '—';
    $('bal-ants').textContent = 'balance unavailable';
    await renderAssets({});
  }
}

async function loadTokenMetadata() {
  if (tokenMetaCache) return tokenMetaCache;
  try {
    const res = await fetch(`${API_BASE}/tokens/anrc20`);
    const rows = await res.json().catch(() => []);
    tokenMetaCache = Array.isArray(rows)
      ? rows.reduce((acc, token) => {
          const symbol = String(token.symbol || '').toUpperCase();
          if (symbol) acc[symbol] = token;
          return acc;
        }, {})
      : {};
  } catch (_) {
    tokenMetaCache = {};
  }
  return tokenMetaCache;
}

function formatAssetUnits(units, decimals) {
  const amount = Number(units || 0) / Math.pow(10, decimals);
  return fmt(amount, amount >= 1 ? 6 : 8);
}

async function renderAssets(rawBalances) {
  const list = $('asset-list');
  if (!list) return;
  const meta = await loadTokenMetadata();
  const entries = Object.entries(rawBalances || {})
    .map(([symbolRaw, unitsRaw]) => {
      const symbol = String(symbolRaw || '').toUpperCase();
      const units = Number(unitsRaw || 0);
      const decimals = Number(meta[symbol]?.decimals ?? (symbol === 'WANET' ? 8 : DEFAULT_ASSET_DECIMALS));
      return { symbol, units, decimals };
    })
    .filter((asset) => asset.symbol && Number.isFinite(asset.units) && asset.units > 0)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  list.hidden = entries.length === 0;
  list.textContent = '';
  entries.forEach((asset) => {
    const row = document.createElement('div');
    row.className = 'asset-row';
    const sym = document.createElement('b');
    sym.textContent = asset.symbol;
    const amt = document.createElement('span');
    amt.textContent = formatAssetUnits(asset.units, asset.decimals);
    row.append(sym, amt);
    list.appendChild(row);
  });
}

async function loadUsd(anet) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ANET_TOKEN}`);
    const data = await res.json();
    const pair = (data.pairs || []).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    const price = pair ? parseFloat(pair.priceUsd) : null;
    if (price) $('bal-usd').textContent = '≈ $' + fmt(anet * price, 2) + ' USD';
  } catch (_) {}
}

function initDashboard() {
  $('copy-addr-btn').addEventListener('click', () => { navigator.clipboard.writeText(W().currentAddress()); toast('Address copied', 'ok'); });
  $('refresh-btn').addEventListener('click', () => loadBalance(W().currentAddress()));
  $('lock-btn').addEventListener('click', () => { W().lock(); route(); });
  $('nav-receive').addEventListener('click', () => { $('receive-addr').textContent = W().currentAddress(); show('view-receive'); });
  $('receive-back').addEventListener('click', openDashboard);
  $('receive-copy').addEventListener('click', () => { navigator.clipboard.writeText(W().currentAddress()); toast('Address copied', 'ok'); });
  $('nav-send').addEventListener('click', () => { $('send-info').innerHTML = ''; show('view-send'); loadBalance(W().currentAddress()); });
  $('send-back').addEventListener('click', openDashboard);
  $('send-max').addEventListener('click', () => {
    const avail = parseFloat($('send-avail').dataset.anet || '0');
    const fee = (W().MIN_FEE_ANTS || 1000) / ANTS_PER_ANET;
    $('send-amount').value = Math.max(0, avail - fee).toFixed(8);
  });
  $('send-btn').addEventListener('click', doSend);
  $('reveal-btn').addEventListener('click', doReveal);
  $('sites-btn').addEventListener('click', openSites);
  $('sites-back').addEventListener('click', openDashboard);
}

async function doSend() {
  const to = $('send-to').value.trim().toUpperCase();
  const amt = parseFloat($('send-amount').value);
  if (!W().isValidAddress(to)) return toast('Enter a valid ANET address', 'err');
  if (!(amt > 0)) return toast('Enter an amount', 'err');
  const amountAnts = Math.round(amt * ANTS_PER_ANET);
  const btn = $('send-btn'); btn.disabled = true; btn.textContent = 'Signing…';
  $('send-info').textContent = 'Signing transfer locally…';
  try {
    const signed = W().signTransfer({ to, amountAnts, nonce: Date.now(), chainId: CHAIN_ID });
    $('send-info').textContent = 'Broadcasting to A Network L1…';
    const res = await fetch(`${API_BASE}/transactions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signed),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || 'Transaction rejected');
    const id = data.transaction_id || signed.tx_hash;
    $('send-info').innerHTML = `✓ Submitted. Tx <a href="${API_BASE}/explorer/search?q=${encodeURIComponent(id)}" target="_blank" rel="noopener">${String(id).slice(0, 16)}…</a>`;
    toast('Transfer submitted', 'ok');
    $('send-to').value = ''; $('send-amount').value = '';
    setTimeout(() => loadBalance(W().currentAddress()), 1500);
  } catch (e) {
    $('send-info').textContent = '';
    toast(e.message || 'Send failed', 'err');
  } finally { btn.disabled = false; btn.textContent = 'Review & Send'; }
}

async function doReveal() {
  const pw = prompt('Enter your password to reveal your private key:');
  if (!pw) return;
  try {
    const hex = await W().revealPrivateKey(pw);
    $('backup-key').textContent = hex;
    backupKeyHex = hex;
    $('backup-ack').checked = true; $('backup-done-btn').disabled = false;
    show('view-backup');
  } catch (e) { toast('Wrong password', 'err'); }
}

async function openSites() {
  show('view-sites');
  const list = $('sites-list');
  const sites = (await chrome.storage.local.get('connectedSites')).connectedSites || {};
  const origins = Object.keys(sites);
  if (!origins.length) { list.innerHTML = '<p class="muted">No connected sites yet.</p>'; return; }
  list.innerHTML = '';
  origins.forEach(origin => {
    const row = document.createElement('div');
    row.className = 'site-item';
    const span = document.createElement('span'); span.textContent = origin;
    const btn = document.createElement('button'); btn.textContent = 'Disconnect';
    btn.addEventListener('click', async () => {
      delete sites[origin]; await chrome.storage.local.set({ connectedSites: sites }); openSites();
    });
    row.append(span, btn); list.appendChild(row);
  });
}

/* ── boot ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initOnboarding(); initUnlock(); initDashboard();
  refreshChainId();
  // keep the mirrored address in sync if a vault already exists
  if (W() && W().hasVault()) chrome.storage.local.set({ walletAddress: W().vaultAddress() });
  route();
});
