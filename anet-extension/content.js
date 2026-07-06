/**
 * ANET Wallet — content script (isolated world)
 * Injects the in-page provider and relays messages between the page and the
 * extension service worker via a long-lived port.
 */
(function () {
  'use strict';

  // Inject the provider into the page's own JS context.
  try {
    var s = document.createElement('script');
    s.src = chrome.runtime.getURL('inpage.js');
    s.onload = function () { s.remove(); };
    (document.head || document.documentElement).appendChild(s);
  } catch (_) {}

  var CH = 'ANET_WALLET';
  var port = null;

  function ensurePort() {
    if (port) return port;
    port = chrome.runtime.connect({ name: 'anet-page' });
    port.onMessage.addListener(function (msg) {
      if (!msg) return;
      if (msg.type === 'response') {
        window.postMessage({ channel: CH, direction: 'from-extension', id: msg.id, result: msg.result, error: msg.error }, '*');
      } else if (msg.type === 'event') {
        window.postMessage({ channel: CH, direction: 'event', event: msg.event, payload: msg.payload }, '*');
      }
    });
    port.onDisconnect.addListener(function () { port = null; });
    return port;
  }

  // Page → extension
  window.addEventListener('message', function (evt) {
    if (evt.source !== window) return;
    var d = evt.data;
    if (!d || d.channel !== CH || d.direction !== 'to-extension') return;
    try {
      ensurePort().postMessage({ id: d.id, method: d.method, params: d.params, origin: location.origin });
    } catch (_) {
      window.postMessage({ channel: CH, direction: 'from-extension', id: d.id, error: 'Wallet unavailable' }, '*');
    }
  });
})();
