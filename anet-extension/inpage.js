/**
 * ANET Wallet — injected provider (runs in the page context as window.anet)
 *
 * Gives any website an EIP-1193-style provider for the A Network Layer 1:
 *   await window.anet.connect()                 → { address }
 *   await window.anet.getAddress()              → 'ANET…' | null
 *   await window.anet.getBalance()              → { ants, anet }
 *   await window.anet.signAction(type, payload) → signed auth object
 *   await window.anet.signTransfer({ to, amountAnts }) → signed tx object
 *   await window.anet.request({ method, params })
 *   window.anet.on('accountsChanged'|'connect'|'disconnect', cb)
 *
 * All signing happens inside the extension (the private key never reaches the
 * page). Requests are relayed to the extension via window.postMessage.
 */
(function () {
  'use strict';
  if (window.anet) return;

  var CH = 'ANET_WALLET';
  var callbacks = {};   // id → { resolve, reject }
  var listeners = {};   // event → [fn]
  var reqId = 0;

  function send(method, params) {
    return new Promise(function (resolve, reject) {
      var id = CH + ':' + (++reqId) + ':' + Date.now();
      callbacks[id] = { resolve: resolve, reject: reject };
      window.postMessage({ channel: CH, direction: 'to-extension', id: id, method: method, params: params || {} }, '*');
    });
  }

  window.addEventListener('message', function (evt) {
    if (evt.source !== window) return;
    var d = evt.data;
    if (!d || d.channel !== CH) return;

    if (d.direction === 'from-extension' && d.id && callbacks[d.id]) {
      var cb = callbacks[d.id];
      delete callbacks[d.id];
      if (d.error) cb.reject(new Error(d.error));
      else cb.resolve(d.result);
    }
    if (d.direction === 'event' && d.event) {
      (listeners[d.event] || []).forEach(function (fn) { try { fn(d.payload); } catch (_) {} });
    }
  });

  var provider = {
    isAnet: true,
    chain: 'anet-l1',

    connect: function () { return send('connect'); },
    disconnect: function () { return send('disconnect'); },
    getAddress: function () { return send('getAddress'); },
    accounts: function () { return send('getAddress').then(function (a) { return a ? [a] : []; }); },
    getBalance: function () { return send('getBalance'); },
    signAction: function (actionType, payload) { return send('signAction', { actionType: actionType, payload: payload }); },
    signTransfer: function (opts) { return send('signTransfer', opts || {}); },
    request: function (args) {
      args = args || {};
      return send(String(args.method || ''), args.params || {});
    },
    on: function (event, fn) {
      if (typeof fn !== 'function') return;
      (listeners[event] = listeners[event] || []).push(fn);
    },
    removeListener: function (event, fn) {
      listeners[event] = (listeners[event] || []).filter(function (x) { return x !== fn; });
    }
  };

  Object.defineProperty(window, 'anet', { value: provider, writable: false, configurable: false });
  window.dispatchEvent(new Event('anet#initialized'));
})();
