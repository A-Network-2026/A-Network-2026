/**
 * A Network app download links
 * app-download.js  |  2026
 *
 * Single source of truth for the mobile app store listings, loaded on every
 * public page. Markup hooks (all optional, plain anchors keep working without JS):
 *
 *   <a data-app-download="auto" href="…">Download App</a>
 *       iPhone/iPad → App Store, Android → Google Play. On other devices the
 *       link becomes "App Store" and a sibling "Google Play" link is added, so
 *       every visitor reaches a store in one click.
 *   <a data-app-download="ios">… / <a data-app-download="android">…
 *       pinned to one store (href is normalised from the constants below).
 *   <a data-app-open="anetwork://…">Open in App</a>
 *       tries the installed app first and falls back to the right store when
 *       nothing opens; other devices are sent to the store directly.
 *   <div data-app-badges></div>
 *       filled with the two store badges when empty.
 *
 * CSP: script-src 'self'; no inline handlers, no eval. The stylesheet
 * (assets/css/app-download.css) is linked from here so pages only add one tag.
 */
'use strict';

(function () {
  const APP_STORE = 'https://apps.apple.com/us/app/a-network/id6770665448';
  const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.anetwork.app';
  const ANDROID_PACKAGE = 'com.anetwork.app';
  const SCHEME = 'anetwork';
  const OPEN_FALLBACK_MS = 1600;
  // currentScript is only defined while this file executes, not later inside DOMContentLoaded.
  const SCRIPT_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';

  function platform(ua, nav) {
    const u = String(ua != null ? ua : (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '');
    const n = nav || (typeof navigator !== 'undefined' ? navigator : {});
    if (/android/i.test(u)) return 'android';
    if (/iphone|ipad|ipod/i.test(u)) return 'ios';
    if (/macintosh/i.test(u) && Number(n.maxTouchPoints) > 1) return 'ios'; // iPadOS reports as a Mac
    return 'other';
  }
  const storeUrl = (p) => (p === 'android' ? PLAY_STORE : p === 'ios' ? APP_STORE : null);

  /** Android: an intent URL opens the app when installed and Play when it is not; iOS uses the scheme. */
  function intentUrl(schemeUrl) {
    const rest = String(schemeUrl).replace(new RegExp(`^${SCHEME}:\\/\\/`), '');
    return `intent://${rest}#Intent;scheme=${SCHEME};package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(PLAY_STORE)};end`;
  }

  function badge(store) {
    const a = document.createElement('a');
    a.className = 'app-badge';
    a.href = store === 'ios' ? APP_STORE : PLAY_STORE;
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.setAttribute('data-app-download', store);
    a.setAttribute('aria-label', store === 'ios' ? 'Download A Network on the App Store' : 'Get A Network on Google Play');
    const small = document.createElement('small'); small.textContent = store === 'ios' ? 'Download on the' : 'Get it on';
    const b = document.createElement('b'); b.textContent = store === 'ios' ? 'App Store' : 'Google Play';
    a.append(small, b);
    return a;
  }

  function linkStylesheet() {
    if (document.querySelector('link[data-app-download-css]')) return;
    const href = SCRIPT_SRC ? new URL('../css/app-download.css', SCRIPT_SRC).href : 'assets/css/app-download.css';
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href + (href.indexOf('?') < 0 ? '?v=20261104-app' : '');
    link.setAttribute('data-app-download-css', '');
    document.head.appendChild(link);
  }

  function openApp(schemeUrl, ev) {
    const p = platform();
    const store = storeUrl(p);
    if (!store) return; // nothing to open on a desktop: let the href (store page) navigate
    ev.preventDefault();
    const timer = setTimeout(() => { if (!document.hidden) window.location.href = store; }, OPEN_FALLBACK_MS);
    const cancel = () => clearTimeout(timer);
    window.addEventListener('pagehide', cancel, { once: true });
    window.addEventListener('blur', cancel, { once: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, { once: true });
    window.location.href = p === 'android' ? intentUrl(schemeUrl) : schemeUrl;
  }

  function wire(root) {
    const p = platform();
    const scope = root || document;
    scope.querySelectorAll('a[data-app-download]').forEach((a) => {
      const mode = (a.getAttribute('data-app-download') || 'auto').toLowerCase();
      if (mode === 'ios' || mode === 'android') { a.href = storeUrl(mode); return; }
      if (a.hasAttribute('data-app-wired')) return;
      a.setAttribute('data-app-wired', '');
      const store = storeUrl(p);
      if (store) { a.href = store; return; }
      // Desktop: no way to know the visitor's phone, so offer both stores side by side.
      const play = a.cloneNode(false);
      play.textContent = 'Google Play'; play.href = PLAY_STORE; play.setAttribute('data-app-download', 'android');
      play.removeAttribute('id'); play.classList.remove('active');
      a.textContent = 'App Store'; a.href = APP_STORE; a.setAttribute('data-app-download', 'ios');
      for (const el of [a, play]) { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
      a.insertAdjacentElement('afterend', play);
    });
    scope.querySelectorAll('a[data-app-open]').forEach((a) => {
      if (a.hasAttribute('data-app-wired')) return;
      a.setAttribute('data-app-wired', '');
      const scheme = a.getAttribute('data-app-open') || `${SCHEME}://`;
      const store = storeUrl(p);
      if (!store) { a.href = APP_STORE; a.target = '_blank'; a.rel = 'noopener noreferrer'; return; }
      a.href = store; // long-press / open-in-new-tab lands on the right store too
      a.addEventListener('click', (ev) => openApp(scheme, ev));
    });
    scope.querySelectorAll('[data-app-badges]').forEach((box) => {
      box.classList.add('app-badges');
      if (!box.children.length) box.append(badge('ios'), badge('android'));
    });
  }

  function boot() { linkStylesheet(); wire(document); }

  const api = { APP_STORE, PLAY_STORE, ANDROID_PACKAGE, SCHEME, platform, storeUrl, intentUrl, openApp, wire };
  if (typeof window !== 'undefined') window.AnetApp = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})();
