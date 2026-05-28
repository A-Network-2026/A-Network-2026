/* A Network Member Portal — sign-in tabs + dashboard loader.
 *
 * Three sign-in paths, all funnel into the same dashboard view:
 *   1. ANET Profile (email + PIN)  -> POST {API}/auth/login
 *   2. MetaMask SIWE               -> POST {API}/auth/portal/siwe/nonce
 *                                     window.ethereum.personal_sign
 *                                     POST {API}/auth/portal/siwe/verify
 *   3. Pi Network                  -> Pi.authenticate -> POST {API}/auth/pi/exchange
 *
 * After auth the session token is stored under SESSION_KEY and the
 * dashboard loads via GET {API}/auth/portal/me.
 *
 * Backend endpoints under /auth/portal/* are scaffolded by Task C —
 * until they exist this script falls back to a friendly "coming soon"
 * status without breaking the page.
 */
(function () {
  "use strict";

  const API_BASES = [
    "https://api.a-network.net",
    "https://rmp-site.onrender.com"
  ];
  const SESSION_KEY = "anet:portal:session";
  const SIWE_DOMAIN = location.host || "a-network.net";
  const SIWE_STATEMENT = "Sign in to A Network Member Portal. This signs a message only — no transaction, no gas.";

  /* ── tiny helpers ─────────────────────────────── */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function setStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || "";
    el.classList.remove("error", "success");
    if (kind === "error") el.classList.add("error");
    if (kind === "success") el.classList.add("success");
  }

  function shortAddr(a, head = 6, tail = 4) {
    if (!a) return "—";
    const s = String(a);
    if (s.length <= head + tail + 3) return s;
    return s.slice(0, head) + "…" + s.slice(-tail);
  }

  function fmtTs(ts) {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return String(ts);
      return d.toLocaleString();
    } catch (_) { return String(ts); }
  }

  async function apiFetch(path, init) {
    const opts = Object.assign({
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" }
    }, init || {});
    if (opts.body && typeof opts.body !== "string") {
      opts.body = JSON.stringify(opts.body);
      opts.headers["content-type"] = "application/json";
    }
    let lastErr;
    for (const base of API_BASES) {
      try {
        const res = await fetch(base + path, opts);
        const text = await res.text();
        let data = null;
        if (text) { try { data = JSON.parse(text); } catch (_) { data = { raw: text }; } }
        if (!res.ok) {
          const err = new Error((data && (data.message || data.error)) || ("HTTP " + res.status));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      } catch (e) {
        lastErr = e;
        // network-level failure -> try next base; HTTP error -> stop.
        if (e && typeof e.status === "number") throw e;
      }
    }
    throw lastErr || new Error("API unreachable");
  }

  /* ── session storage ──────────────────────────── */
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (!j || !j.token) return null;
      return j;
    } catch (_) { return null; }
  }
  function saveSession(s) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (_) {}
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  /* ── tab switcher ─────────────────────────────── */
  function bindTabs() {
    $$(".portal-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        $$(".portal-tab").forEach((b) => {
          const active = b === btn;
          b.classList.toggle("active", active);
          b.setAttribute("aria-selected", active ? "true" : "false");
        });
        $$(".portal-pane").forEach((p) => {
          const active = p.dataset.pane === target;
          p.classList.toggle("active", active);
          p.hidden = !active;
        });
      });
    });
  }

  /* ── tab A: ANET Profile (email + PIN) ────────── */
  function bindProfileLogin() {
    const form = $("#profileLoginForm");
    if (!form) return;
    const status = $("#profileStatus");
    const btn = $("#profileLoginBtn");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#profileEmail").value.trim().toLowerCase();
      const pin = $("#profilePin").value.trim();
      const otp = $("#profileOtp").value.trim();
      if (!email || !pin) {
        setStatus(status, "Enter your email and PIN.", "error");
        return;
      }
      btn.disabled = true;
      setStatus(status, "Signing in…");
      try {
        const body = { email, pin };
        if (otp) body.otp = otp;
        const res = await apiFetch("/auth/login", { method: "POST", body });
        if (!res || !res.token) throw new Error("Login response missing token.");
        saveSession({
          token: res.token,
          method: "profile",
          email,
          userId: res.userId || res.user_id || null,
          createdAt: Date.now()
        });
        setStatus(status, "Signed in. Loading dashboard…", "success");
        renderDashboard();
      } catch (err) {
        const msg = (err && err.message) || "Sign-in failed.";
        setStatus(status, msg, "error");
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ── tab B: MetaMask SIWE ─────────────────────── */
  function bindEvmLogin() {
    const btn = $("#evmConnectBtn");
    const label = $("#evmConnectLabel");
    const status = $("#evmStatus");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      if (!window.ethereum) {
        setStatus(status, "Install MetaMask or another EVM wallet to use this option.", "error");
        return;
      }
      btn.disabled = true;
      try {
        setStatus(status, "Requesting wallet connection…");
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const address = String((accounts && accounts[0]) || "").toLowerCase();
        if (!address) throw new Error("No EVM account selected.");
        if (label) label.textContent = "Connected " + shortAddr(address);

        setStatus(status, "Fetching sign-in nonce…");
        // Task C will provide /auth/portal/siwe/nonce. Until then we
        // generate a local nonce so the signature flow still works
        // end-to-end client-side and the user sees the MetaMask prompt.
        let nonce;
        try {
          const nonceRes = await apiFetch("/auth/portal/siwe/nonce", {
            method: "POST",
            body: { address }
          });
          nonce = (nonceRes && nonceRes.nonce) || null;
        } catch (_) { nonce = null; }
        if (!nonce) nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);

        const issuedAt = new Date().toISOString();
        const message = [
          SIWE_DOMAIN + " wants you to sign in with your Ethereum account:",
          address,
          "",
          SIWE_STATEMENT,
          "",
          "URI: https://" + SIWE_DOMAIN + "/portal.html",
          "Version: 1",
          "Chain ID: 56",
          "Nonce: " + nonce,
          "Issued At: " + issuedAt
        ].join("\n");

        setStatus(status, "Open MetaMask and approve the sign-in message…");
        const signature = await window.ethereum.request({
          method: "personal_sign",
          params: [message, address]
        });
        if (!signature) throw new Error("Signature rejected.");

        setStatus(status, "Verifying signature…");
        let verify;
        try {
          verify = await apiFetch("/auth/portal/siwe/verify", {
            method: "POST",
            body: { address, message, signature }
          });
        } catch (err) {
          if (err && err.status === 404) {
            // Backend endpoint not deployed yet (Task C). Surface a
            // clear stub state — the signature is still valid; we just
            // can't exchange it for a session until /auth/portal/* ships.
            setStatus(status, "Signature captured. Server-side SIWE verification ships with the next backend release — your wallet is ready to link.", "success");
            return;
          }
          throw err;
        }
        if (!verify || !verify.token) throw new Error("Verify response missing token.");
        saveSession({
          token: verify.token,
          method: "evm",
          evmAddress: address,
          createdAt: Date.now()
        });
        setStatus(status, "Signed in. Loading dashboard…", "success");
        renderDashboard();
      } catch (err) {
        const msg = (err && err.message) || "EVM sign-in failed.";
        setStatus(status, msg, "error");
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ── tab C: Pi Network ────────────────────────── */
  function bindPiLogin() {
    const btn = $("#piConnectBtn");
    const status = $("#piStatus");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        if (!window.Pi || typeof window.Pi.authenticate !== "function") {
          setStatus(status, "Open this page inside the Pi Browser to sign in with Pi.", "error");
          return;
        }
        setStatus(status, "Requesting Pi authentication…");
        const auth = await window.Pi.authenticate(["username", "payments"], () => {});
        if (!auth || !auth.accessToken) throw new Error("Pi did not return an access token.");
        let res;
        try {
          res = await apiFetch("/auth/pi/exchange", {
            method: "POST",
            body: { accessToken: auth.accessToken }
          });
        } catch (err) {
          if (err && err.status === 404) {
            setStatus(status, "Pi sign-in endpoint ships with the next backend release.", "success");
            return;
          }
          throw err;
        }
        if (!res || !res.token) throw new Error("Exchange response missing token.");
        saveSession({
          token: res.token,
          method: "pi",
          piUid: (auth.user && auth.user.uid) || null,
          piUsername: (auth.user && auth.user.username) || null,
          createdAt: Date.now()
        });
        setStatus(status, "Signed in. Loading dashboard…", "success");
        renderDashboard();
      } catch (err) {
        const msg = (err && err.message) || "Pi sign-in failed.";
        setStatus(status, msg, "error");
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ── sign out ─────────────────────────────────── */
  function bindSignOut() {
    const a = $("#portalSignOut");
    if (!a) return;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      clearSession();
      showSignIn();
    });
  }

  function showSignIn() {
    $("#signInView").hidden = false;
    $("#dashboardView").hidden = true;
    const out = $("#portalSignOut");
    if (out) out.hidden = true;
  }
  function showDashboard() {
    $("#signInView").hidden = true;
    $("#dashboardView").hidden = false;
    const out = $("#portalSignOut");
    if (out) out.hidden = false;
  }

  /* ── dashboard ────────────────────────────────── */
  async function renderDashboard() {
    const session = loadSession();
    if (!session) { showSignIn(); return; }
    showDashboard();

    // Greeting
    const greet = $("#dashGreeting");
    if (greet) {
      const name = session.email || session.piUsername || (session.evmAddress && shortAddr(session.evmAddress)) || "miner";
      greet.textContent = "Welcome back, " + name;
    }

    let me = null;
    try {
      me = await apiFetch("/auth/portal/me", {
        headers: { authorization: "Bearer " + session.token }
      });
    } catch (err) {
      // If the consolidated endpoint isn't live yet (Task C), build a
      // minimal "what we already know" view from the session itself so
      // the page is useful instead of error-only.
      me = stubMeFromSession(session, err);
    }
    paintProfile(me);
    paintWallets(me);
    paintDevices(me);
    paintActivity(me);
  }

  function stubMeFromSession(session, err) {
    const wallets = [];
    if (session.evmAddress) {
      wallets.push({
        type: "evm",
        chain: "BSC",
        address: session.evmAddress,
        linkedAt: new Date(session.createdAt || Date.now()).toISOString(),
        verified: true
      });
    }
    if (session.email) {
      wallets.push({ type: "email", address: session.email, linkedAt: new Date(session.createdAt || Date.now()).toISOString() });
    }
    if (session.piUsername) {
      wallets.push({ type: "pi", address: "@" + session.piUsername, piUid: session.piUid, linkedAt: new Date(session.createdAt || Date.now()).toISOString() });
    }
    return {
      _stub: true,
      _stubReason: (err && err.message) || "Portal API not yet deployed.",
      profile: { status: "pending-backend" },
      wallets,
      devices: [],
      activity: []
    };
  }

  function paintProfile(me) {
    const statusEl = $("#dashProfileStatus");
    const profile = (me && me.profile) || {};
    if (me && me._stub) {
      statusEl.textContent = "Pending backend";
      statusEl.classList.add("warn");
    } else if (profile.status === "ACTIVATED" || profile.activated) {
      statusEl.textContent = "Activated";
      statusEl.classList.remove("warn", "bad");
    } else {
      statusEl.textContent = profile.status || "—";
    }
    $("#dashProfileId").textContent = profile.profileId || profile.id || "—";
    $("#dashHolder").textContent = profile.holder || profile.walletAddress || "—";
    $("#dashMintedAt").textContent = fmtTs(profile.mintedAt || profile.activatedAt);
    const tx = $("#dashMintTx");
    if (profile.mintTx) {
      tx.textContent = profile.mintTx.slice(0, 18) + "…";
      tx.href = "scan.html#/tx/" + profile.mintTx;
    } else {
      tx.textContent = "—";
      tx.removeAttribute("href");
    }
  }

  function paintWallets(me) {
    const host = $("#dashWallets");
    const wallets = (me && me.wallets) || [];
    if (!wallets.length) {
      host.innerHTML = '<div class="dash-empty">No linked wallets yet. Use “+ Link an EVM wallet” to attach your BSC address.</div>';
      return;
    }
    host.innerHTML = wallets.map((w) => {
      const ico = w.type === "evm" ? "Ξ"
                : w.type === "anet-secp" ? "A"
                : w.type === "anet-legacy" ? "L"
                : w.type === "pi" ? "π"
                : w.type === "email" ? "@"
                : "•";
      const title = w.type === "evm" ? "BSC / EVM wallet"
                  : w.type === "anet-secp" ? "ANET L1 (secp256k1)"
                  : w.type === "anet-legacy" ? "ANET L1 (legacy)"
                  : w.type === "pi" ? "Pi Network identity"
                  : w.type === "email" ? "Email account"
                  : (w.type || "Linked identity");
      const sub = (w.address || "—") + (w.linkedAt ? " · linked " + fmtTs(w.linkedAt) : "");
      return '<div class="dash-row">' +
        '<div class="ico">' + ico + '</div>' +
        '<div class="body"><p class="title">' + title + '</p><p class="sub">' + sub + '</p></div>' +
      '</div>';
    }).join("");
  }

  function paintDevices(me) {
    const host = $("#dashDevices");
    const count = $("#dashDeviceCount");
    const devices = (me && me.devices) || [];
    count.textContent = devices.length ? String(devices.length) + " bound" : (me && me._stub ? "—" : "0");
    if (!devices.length) {
      host.innerHTML = me && me._stub
        ? '<div class="dash-empty">Device list will appear here once the portal backend ships.</div>'
        : '<div class="dash-empty">No devices bound yet. Open the A Network mobile app on a phone to bind your first device.</div>';
      return;
    }
    host.innerHTML = devices.map((d) => {
      const title = (d.platform || "Device") + (d.model ? " · " + d.model : "");
      const sub = "last seen " + fmtTs(d.lastSeen || d.last_seen) + (d.ipCountry ? " · " + d.ipCountry : "");
      return '<div class="dash-row">' +
        '<div class="ico">▣</div>' +
        '<div class="body"><p class="title">' + title + '</p><p class="sub">' + sub + '</p></div>' +
        '<div class="actions"><button type="button" class="btn-ghost" data-revoke="' + encodeURIComponent(d.id || "") + '">Revoke</button></div>' +
      '</div>';
    }).join("");
  }

  function paintActivity(me) {
    const host = $("#dashActivity");
    const acts = (me && me.activity) || [];
    if (!acts.length) {
      host.innerHTML = me && me._stub
        ? '<div class="dash-empty">Activity feed will appear here once the portal backend ships.</div>'
        : '<div class="dash-empty">No recent activity for this profile.</div>';
      return;
    }
    host.innerHTML = acts.slice(0, 12).map((a) => {
      const title = a.title || a.type || "Activity";
      const sub = (a.detail || "") + (a.timestamp ? " · " + fmtTs(a.timestamp) : "");
      return '<div class="dash-row">' +
        '<div class="ico">≡</div>' +
        '<div class="body"><p class="title">' + title + '</p><p class="sub">' + sub + '</p></div>' +
      '</div>';
    }).join("");
  }

  /* ── boot ─────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    bindTabs();
    bindProfileLogin();
    bindEvmLogin();
    bindPiLogin();
    bindSignOut();
    if (loadSession()) renderDashboard();
  });
})();
