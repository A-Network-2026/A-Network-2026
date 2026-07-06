/**
 * ANET Wallet — approval window
 * Renders a connect / sign request and, on approval, performs the signing here
 * (this extension document owns the encrypted vault). The signed result is sent
 * back to the service worker, which relays it to the requesting page. The
 * private key never leaves this context.
 */
'use strict';

const API_BASE = 'https://explorer.a-network.net';
const ANTS_PER_ANET = 100000000;
let CHAIN_ID = 'anet-private-mainnet-1';

const $ = (id) => document.getElementById(id);
const W = () => window.AnetWallet;
const reqId = new URLSearchParams(location.search).get('req');
let pending = null;

function toast(msg, type = '') {
  const t = $('toast'); t.textContent = msg; t.className = 'toast ' + type; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3000);
}

async function refreshChainId() {
  try { const r = await fetch(`${API_BASE}/sync/head`); const d = await r.json(); if (d && d.chain_id) CHAIN_ID = String(d.chain_id); } catch (_) {}
}

function needsUnlock() {
  return pending && pending.method !== 'connect' && !(W() && W().isUnlocked());
}

function render() {
  const { method, params, origin } = pending;
  $('ap-origin').textContent = origin || '';
  const addr = (W() && (W().isUnlocked() ? W().currentAddress() : W().vaultAddress())) || '';

  if (method === 'connect') {
    $('ap-title').textContent = 'Connect to ANET Wallet';
    $('ap-desc').textContent = `${origin} wants to view your ANET address and balance.`;
    $('ap-details').textContent = `Account:\n${addr}`;
    $('ap-approve').textContent = 'Connect';
  } else if (method === 'signTransfer') {
    const anet = (Number(params.amountAnts || 0) / ANTS_PER_ANET);
    $('ap-title').textContent = 'Approve transfer';
    $('ap-desc').textContent = `${origin} is requesting a Layer-1 transfer from your wallet.`;
    $('ap-details').textContent =
      `From:   ${addr}\nTo:     ${params.to}\nAmount: ${anet} ANET\nFee:    ${(Number(params.feeAnts || W().MIN_FEE_ANTS || 1000) / ANTS_PER_ANET)} ANET`;
    $('ap-approve').textContent = 'Sign & Send';
  } else if (method === 'signAction') {
    $('ap-title').textContent = 'Approve signature';
    $('ap-desc').textContent = `${origin} is requesting a signed L1 action (${params.actionType}).`;
    $('ap-details').textContent = `Action: ${params.actionType}\nAccount: ${addr}\n\nPayload:\n${JSON.stringify(params.payload, null, 2)}`;
    $('ap-approve').textContent = 'Sign';
  } else {
    $('ap-title').textContent = 'Unknown request';
    $('ap-desc').textContent = method;
  }
  $('ap-unlock').hidden = !needsUnlock();
}

async function approve() {
  const btn = $('ap-approve'); btn.disabled = true;
  try {
    if (needsUnlock()) {
      const pw = $('ap-pw').value;
      if (!pw) { toast('Enter your password', 'err'); btn.disabled = false; return; }
      try { await W().unlock(pw); } catch (_) { toast('Wrong password', 'err'); btn.disabled = false; return; }
      render();
    }

    let result = null;
    const { method, params } = pending;

    if (method === 'signAction') {
      result = W().signAction(params.actionType, params.payload, CHAIN_ID);
    } else if (method === 'signTransfer') {
      const signed = W().signTransfer({
        to: String(params.to || '').toUpperCase(),
        amountAnts: Math.round(Number(params.amountAnts || 0)),
        feeAnts: params.feeAnts != null ? Math.round(Number(params.feeAnts)) : undefined,
        nonce: params.nonce || Date.now(),
        chainId: CHAIN_ID,
        payload: params.payload || {},
      });
      // Optionally broadcast the transfer to the L1 mempool.
      if (params.broadcast !== false) {
        const res = await fetch(`${API_BASE}/transactions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signed),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || data.message || 'Transaction rejected');
        signed.transaction_id = data.transaction_id || signed.tx_hash;
      }
      result = signed;
    }

    await chrome.runtime.sendMessage({ type: 'APPROVE', reqId, result });
    window.close();
  } catch (e) {
    toast(e.message || 'Failed', 'err');
    btn.disabled = false;
  }
}

async function reject() {
  try { await chrome.runtime.sendMessage({ type: 'REJECT', reqId }); } catch (_) {}
  window.close();
}

document.addEventListener('DOMContentLoaded', async () => {
  await refreshChainId();
  pending = await chrome.runtime.sendMessage({ type: 'GET_PENDING', reqId });
  if (!pending) { $('ap-title').textContent = 'Request expired'; $('ap-desc').textContent = 'Please try again from the site.'; $('ap-approve').hidden = true; return; }
  render();
  $('ap-approve').addEventListener('click', approve);
  $('ap-reject').addEventListener('click', reject);
  window.addEventListener('beforeunload', () => { chrome.runtime.sendMessage({ type: 'REJECT', reqId }).catch(() => {}); });
});
