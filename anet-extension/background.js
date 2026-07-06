/**
 * ANET Wallet — background service worker
 *
 * Coordinates dapp requests coming from content-script ports and opens
 * approval windows for anything sensitive (connect / sign). The private key
 * NEVER touches this worker: signing happens inside the approval window (an
 * extension document that owns the encrypted vault). Only the public address
 * is mirrored into chrome.storage.local so the worker can answer reads.
 */
'use strict';

const API_BASE = 'https://explorer.a-network.net';
const ANTS_PER_ANET = 100000000;

const ports = new Set();               // active content-script ports
const pending = new Map();             // reqId → { port, pageId, method, params, origin }

/* ── storage helpers ─────────────────────────────────────────────── */
function getLocal(keys) { return chrome.storage.local.get(keys); }
function setLocal(obj) { return chrome.storage.local.set(obj); }

async function connectedSites() { return (await getLocal('connectedSites')).connectedSites || {}; }
async function isConnected(origin) { return !!(await connectedSites())[origin]; }
async function addSite(origin) {
  const sites = await connectedSites(); sites[origin] = true; await setLocal({ connectedSites: sites });
}
async function removeSite(origin) {
  const sites = await connectedSites(); delete sites[origin]; await setLocal({ connectedSites: sites });
}
async function walletAddress() { return (await getLocal('walletAddress')).walletAddress || ''; }

/* ── dapp request handling ───────────────────────────────────────── */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'anet-page') return;
  ports.add(port);
  port.onMessage.addListener((msg) => handlePageRequest(port, msg));
  port.onDisconnect.addListener(() => ports.delete(port));
});

async function handlePageRequest(port, msg) {
  const { id, method, params, origin } = msg || {};
  port._origin = origin;
  const reply = (result, error) => { try { port.postMessage({ type: 'response', id, result, error }); } catch (_) {} };

  try {
    switch (method) {
      case 'getAddress': {
        const addr = await walletAddress();
        return reply((await isConnected(origin)) && addr ? addr : null);
      }
      case 'getBalance': {
        if (!(await isConnected(origin))) throw new Error('Not connected. Call anet.connect() first.');
        const addr = await walletAddress();
        if (!addr) throw new Error('No wallet available.');
        const bal = await fetchBalance(addr);
        return reply(bal);
      }
      case 'disconnect': {
        await removeSite(origin);
        broadcast(origin, 'disconnect', null);
        return reply({ ok: true });
      }
      case 'connect': {
        const addr = await walletAddress();
        if (!addr) throw new Error('No ANET wallet set up. Open the ANET Wallet extension to create one.');
        if (await isConnected(origin)) return reply({ address: addr });
        return openApproval(port, id, 'connect', { origin }, origin);
      }
      case 'signAction':
      case 'signTransfer': {
        if (!(await isConnected(origin))) throw new Error('Not connected. Call anet.connect() first.');
        return openApproval(port, id, method, params || {}, origin);
      }
      default:
        throw new Error('Unsupported method: ' + method);
    }
  } catch (e) {
    reply(undefined, e.message || String(e));
  }
}

async function fetchBalance(address) {
  const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(address)}`);
  const data = await res.json().catch(() => ({}));
  const ants = Number(data.ants_balance || 0);
  return { address, ants, anet: ants / ANTS_PER_ANET };
}

/* ── approval windows ────────────────────────────────────────────── */
async function openApproval(port, pageId, method, params, origin) {
  const reqId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  pending.set(reqId, { port, pageId, method, params, origin });
  // persist so the approval document can read it even if the worker sleeps
  await chrome.storage.session.set({ ['pending_' + reqId]: { method, params, origin } });
  chrome.windows.create({
    url: chrome.runtime.getURL(`approve.html?req=${encodeURIComponent(reqId)}`),
    type: 'popup', width: 400, height: 620, focused: true,
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.type) return;
    if (msg.type === 'GET_PENDING') {
      const stored = (await chrome.storage.session.get('pending_' + msg.reqId))['pending_' + msg.reqId];
      const p = pending.get(msg.reqId);
      return sendResponse(stored || (p ? { method: p.method, params: p.params, origin: p.origin } : null));
    }
    if (msg.type === 'APPROVE') {
      const p = pending.get(msg.reqId);
      if (p) {
        if (p.method === 'connect') {
          await addSite(p.origin);
          const addr = await walletAddress();
          try { p.port.postMessage({ type: 'response', id: p.pageId, result: { address: addr } }); } catch (_) {}
          broadcast(p.origin, 'connect', { address: addr });
        } else {
          try { p.port.postMessage({ type: 'response', id: p.pageId, result: msg.result }); } catch (_) {}
        }
        cleanup(msg.reqId);
      }
      return sendResponse({ ok: true });
    }
    if (msg.type === 'REJECT') {
      const p = pending.get(msg.reqId);
      if (p) {
        try { p.port.postMessage({ type: 'response', id: p.pageId, error: 'User rejected the request' }); } catch (_) {}
        cleanup(msg.reqId);
      }
      return sendResponse({ ok: true });
    }
    if (msg.type === 'WALLET_CHANGED') {
      // popup unlocked/created/imported/forgot — refresh connected pages
      const addr = await walletAddress();
      ports.forEach((pt) => { if (pt._origin) broadcastPort(pt, 'accountsChanged', addr ? [addr] : []); });
      return sendResponse({ ok: true });
    }
  })();
  return true; // async sendResponse
});

function cleanup(reqId) {
  pending.delete(reqId);
  chrome.storage.session.remove('pending_' + reqId);
}

function broadcast(origin, event, payload) {
  ports.forEach((pt) => { if (pt._origin === origin) broadcastPort(pt, event, payload); });
}
function broadcastPort(pt, event, payload) {
  try { pt.postMessage({ type: 'event', event, payload }); } catch (_) {}
}
