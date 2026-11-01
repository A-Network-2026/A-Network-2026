/**
 * A Network — Bridge (export) tab
 * dex-bridge.js  |  2026
 *
 * ANET L1 → wANET (BEP-20) on BNB Chain, the only bridge direction allowed by
 * the one-way policy (whitepaper v4.4). Wired to the production L1 API:
 *
 *   POST /bridge/burn                      signed `bridge_burn` action → burns ANET on L1
 *   GET  /bridge/burns/:id                 release status (pending → released | failed)
 *   GET  /bridge/burns/by-sender/:address  the wallet's export history
 *
 * Releases on BNB Chain are executed by the M-of-N EIP-712 signer set of the
 * live AnetBridgeVault (0x3143…8B49). The L1 endpoint is behind the operator
 * switch ANET_BRIDGE_BURN_ENABLED; this module probes it and shows the real
 * state (live / gated / unreachable) instead of pretending.
 *
 * Loaded after dex.js (uses its globals: state, apiFetch, anetSignAction,
 * getAccount, toast, escapeHtml, fmt, connectEvmWallet, …) and after
 * dex-terminal.js (logos). CSP: script-src 'self'.
 */
'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s);
  const notify = (m, t, d) => { if (typeof toast === 'function') toast(m, t, d); };

  /* ── Constants (mirror anet-chain) ────────────────────────────────── */
  const ANTS = 100_000_000;                 // ants per ANET
  const MIN_SESSIONS = 1_000;               // activation::MIN_SESSIONS_FOR_ANET
  const FEE_ANTS = 1_000;                   // transaction::MIN_FEE_ANTS (validator fee)
  const PER_TX_CAP_ANET = 10_000;           // ANET_BRIDGE_MAX_BURN_PER_TX_ANET default
  const RELEASE_DEADLINE_H = 24;            // BRIDGE_DEADLINE_SECS default
  const VAULT = '0x31438362a7667ce5559500023D025c7c14168B49';
  const WANET = '0x791055A7d52AA392eaE8De04250497f33807E46A';
  const BSC_RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://rpc.ankr.com/bsc'];
  const PROBE_WALLET = 'ANET000000000000000000000000000000000000';
  const POLL_MS = 10_000, POLL_MAX = 6 * 60; // 60 min

  const br = {
    gate: 'checking',          // checking | live | gated | unreachable
    gateDetail: '',
    account: null,
    burns: [],
    active: null,              // burn being tracked
    pollTimer: null,
    vault: { balance: null, t: 0 },
    mounted: false,
  };

  const S = () => (typeof state !== 'undefined' && state) ? state : null; // dex.js top-level const (not on window)
  const logo = (sym, opts) => (window.AnetTerminal && typeof window.AnetTerminal.logoHtml === 'function') ? window.AnetTerminal.logoHtml(sym, opts) : '';
  const api = () => (typeof CHAIN_API === 'string' ? CHAIN_API : 'https://explorer.a-network.net');
  const fmtAnet = (ants, dp = 4) => {
    const n = Number(ants) / ANTS;
    if (!isFinite(n)) return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: 0 });
  };
  const plainAnet = (ants) => (Number(ants) / ANTS).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  const isBsc = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || '').trim());
  const short = (a) => a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '—';

  /* ═══════════════════════════════════════════════════════════════════
     Pure helpers (exposed for tests)
     ═══════════════════════════════════════════════════════════════════ */
  /** Human ANET string → ants (integer Number ≤ 2^53). */
  function anetToAnts(str) {
    const s = String(str).trim();
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return 0;
    const [w, f = ''] = s.split('.');
    const frac = (f + '00000000').slice(0, 8);
    const n = Number(BigInt(w || '0') * BigInt(ANTS) + BigInt(frac || '0'));
    return Number.isSafeInteger(n) ? n : 0;
  }

  /**
   * Eligibility + limits from the L1 account view.
   * Returns { eligible, reasons[], maxAnts, lockedAnts, sessions, vestedBps }.
   */
  function exportLimits(acct) {
    const balance = Number(acct?.ants_balance || 0);
    const sessions = Number(acct?.sessions || 0);
    const locked = Number(acct?.swap_locked_ants || 0);
    const vestedBps = acct?.swap_vested_bps == null ? null : Number(acct.swap_vested_bps);
    const reasons = [];
    if (sessions < MIN_SESSIONS) reasons.push(`Eligible miner wallet required: ${MIN_SESSIONS.toLocaleString()} on-chain sessions (wallet has ${sessions.toLocaleString()}).`);
    const spendable = Math.max(0, balance - FEE_ANTS - locked);
    const maxAnts = Math.min(spendable, PER_TX_CAP_ANET * ANTS);
    if (balance <= FEE_ANTS) reasons.push('No exportable balance.');
    return { eligible: reasons.length === 0 && maxAnts > 0, reasons, maxAnts, lockedAnts: locked, sessions, vestedBps, balance };
  }

  /** Validate a burn request before signing. Returns an error string or null. */
  function validateBurn({ amountAnts, recipient, limits }) {
    if (!(amountAnts > 0)) return 'Enter an amount to export.';
    if (!isBsc(recipient)) return 'Enter a valid BNB Chain address (0x + 40 hex characters).';
    if (amountAnts > PER_TX_CAP_ANET * ANTS) return `Per-transaction cap is ${PER_TX_CAP_ANET.toLocaleString()} ANET.`;
    if (limits && amountAnts > limits.maxAnts) return `Amount exceeds what this wallet can export right now (max ${fmtAnet(limits.maxAnts, 8)} ANET after the validator fee and vesting lock).`;
    return null;
  }

  /** Signed payload — must canonicalize identically to the L1's json!() in post_bridge_burn. */
  function burnPayload(sender, recipient, amountAnts) {
    return { route: 'bridge_burn', sender: String(sender).trim().toUpperCase(), bsc_recipient: String(recipient).trim().toLowerCase(), amount_ants: amountAnts, token_symbol: 'ANET' };
  }

  function statusMeta(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'released') return { label: 'Released on BNB Chain', cls: 'green' };
    if (s === 'failed') return { label: 'Failed', cls: 'red' };
    if (s === 'pending' || s === 'signing' || s === 'submitted') return { label: s === 'pending' ? 'Pending release' : s.charAt(0).toUpperCase() + s.slice(1), cls: 'amber' };
    return { label: s || 'Unknown', cls: '' };
  }

  /* ═══════════════════════════════════════════════════════════════════
     Data
     ═══════════════════════════════════════════════════════════════════ */
  async function probeGate() {
    br.gate = 'checking';
    try {
      const res = await fetch(`${api()}/bridge/burns/by-sender/${PROBE_WALLET}`, { headers: { Accept: 'application/json' } });
      if (res.ok) { br.gate = 'live'; br.gateDetail = ''; }
      else {
        const data = await res.json().catch(() => ({}));
        const msg = String(data.error || '');
        if (res.status === 404 && /disabled/i.test(msg)) { br.gate = 'gated'; br.gateDetail = msg; }
        else { br.gate = 'unreachable'; br.gateDetail = msg || `HTTP ${res.status}`; }
      }
    } catch (e) { br.gate = 'unreachable'; br.gateDetail = e.message || 'network error'; }
    renderGate();
    renderBadge();
  }

  async function refreshAccount() {
    const addr = S()?.anetWallet?.address;
    if (!addr) { br.account = null; renderForm(); return; }
    try { br.account = await getAccount(addr); } catch (_) { br.account = null; }
    renderForm();
  }

  async function refreshHistory() {
    const addr = S()?.anetWallet?.address;
    const el = $('br-history'); if (!el) return;
    if (!addr) { el.innerHTML = '<div class="tm-empty">Connect your ANET wallet to see export history.</div>'; return; }
    if (br.gate !== 'live') { el.innerHTML = `<div class="tm-empty">History is available once the L1 export endpoint is enabled.</div>`; return; }
    try {
      const rows = await apiFetch(`/bridge/burns/by-sender/${encodeURIComponent(addr)}`);
      br.burns = Array.isArray(rows) ? rows : [];
    } catch (e) { el.innerHTML = `<div class="tm-empty">Could not load history: ${esc(e.message)}</div>`; return; }
    renderHistory();
  }

  async function refreshVault() {
    if (Date.now() - br.vault.t < 60_000 && br.vault.balance != null) return renderVault();
    for (const rpc of BSC_RPCS) {
      try {
        const res = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: VAULT, data: '0x0bf6cc08' }, 'latest'] }) });
        const j = await res.json();
        if (j && j.result && j.result !== '0x') { br.vault = { balance: Number(BigInt(j.result)) / 1e18, t: Date.now() }; break; }
      } catch (_) { /* try next */ }
    }
    renderVault();
  }

  async function submitExport() {
    const btn = $('br-submit'), statusEl = $('br-status');
    const setStatus = (m, cls = 'loading') => { if (statusEl) { statusEl.className = 'swap-status show ' + cls; statusEl.innerHTML = m; } };
    if (br.gate !== 'live') { notify('The L1 export endpoint is not enabled yet.', 'error'); return; }
    if (typeof ensureAnetSigner === 'function' && !ensureAnetSigner()) return;
    const sender = S()?.anetWallet?.address;
    if (!sender) { notify('Connect your ANET wallet first.', 'error'); return; }
    const amountAnts = anetToAnts($('br-amount')?.value || '');
    const recipient = ($('br-recipient')?.value || '').trim();
    const limits = br.account ? exportLimits(br.account) : null;
    const err = validateBurn({ amountAnts, recipient, limits });
    if (err) { notify(err, 'error', 5000); return; }

    btn.disabled = true;
    try {
      setStatus('<span class="spinner"></span> Sign the export in your ANET wallet…');
      const payload = burnPayload(sender, recipient, amountAnts);
      const auth = await anetSignAction('bridge_burn', payload);
      setStatus('<span class="spinner"></span> Burning on A Network L1…');
      const resp = await apiFetch('/bridge/burn', { method: 'POST', body: JSON.stringify({ ...payload, auth }) });
      br.active = { burn_id: resp.burn_id, status: resp.status || 'pending', ants: resp.ants_burned ?? amountAnts, bsc_recipient: resp.bsc_recipient || payload.bsc_recipient, created_at: resp.created_at };
      setStatus(`✓ Burned ${esc(resp.anet_burned || fmtAnet(amountAnts, 8))} ANET on L1 · export #${esc(String(resp.burn_id))} · waiting for the vault signers to release wANET on BNB Chain…`, 'loading');
      $('br-amount').value = '';
      notify(`Export #${resp.burn_id} submitted — release usually lands within minutes.`, 'success', 7000);
      if (typeof refreshAnetBalance === 'function') refreshAnetBalance();
      refreshAccount(); refreshHistory();
      startPolling(resp.burn_id);
    } catch (e) {
      setStatus('✕ ' + esc(e.message || 'Export failed'), 'error');
      notify(e.message || 'Export failed', 'error', 6000);
    } finally { btn.disabled = false; }
  }

  function startPolling(burnId) {
    clearInterval(br.pollTimer);
    let n = 0;
    br.pollTimer = setInterval(async () => {
      n++;
      try {
        const row = await apiFetch(`/bridge/burns/${encodeURIComponent(burnId)}`);
        if (row && row.burn_id != null) {
          br.active = row;
          const st = String(row.status || '').toLowerCase();
          const statusEl = $('br-status');
          if (st === 'released') {
            clearInterval(br.pollTimer);
            if (statusEl) { statusEl.className = 'swap-status show success'; statusEl.innerHTML = `✓ Export #${esc(String(row.burn_id))} released on BNB Chain · <a href="https://bscscan.com/tx/${esc(row.bsc_tx_hash || '')}" target="_blank" rel="noopener">${esc(short(row.bsc_tx_hash || ''))} ↗</a>`; }
            notify('wANET released on BNB Chain', 'success', 8000);
            refreshHistory(); refreshVault();
          } else if (st === 'failed') {
            clearInterval(br.pollTimer);
            if (statusEl) { statusEl.className = 'swap-status show error'; statusEl.innerHTML = `✕ Export #${esc(String(row.burn_id))} failed: ${esc(row.error || 'see history')}. Contact support with this ID.`; }
            refreshHistory();
          }
        }
      } catch (_) { /* keep polling */ }
      if (n >= POLL_MAX) clearInterval(br.pollTimer);
    }, POLL_MS);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Rendering
     ═══════════════════════════════════════════════════════════════════ */
  function mount() {
    const host = $('bridge-mount'); if (!host) return;
    host.innerHTML = `
      <div class="bridge-grid">
        <div class="card">
          <div class="card-header">
            <span class="card-title">EXPORT ANET → BNB CHAIN</span>
            <span class="pill" id="br-gate-pill">Checking…</span>
          </div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:14px">
            <div class="br-route">
              <div class="br-route-side">${logo('ANET', { size: 34 })}<div><b>ANET</b><small>A Network L1 · native</small></div></div>
              <div class="br-route-arrow">→</div>
              <div class="br-route-side">${logo('ANET', { size: 34, chain: 56 })}<div><b>wANET</b><small>BNB Chain · BEP-20 <a href="https://bscscan.com/token/${WANET}" target="_blank" rel="noopener">${short(WANET)} ↗</a></small></div></div>
            </div>

            <div id="br-gate-note" class="info-box" style="display:none"></div>

            <div class="br-wallet-row">
              <div class="br-wallet-box">
                <div class="form-label">FROM · ANET L1 WALLET</div>
                <div id="br-from-wallet">Not connected</div>
                <div id="br-eligibility" class="br-elig"></div>
              </div>
              <div class="br-wallet-box">
                <div class="form-label">TO · BNB CHAIN WALLET</div>
                <input class="form-input" id="br-recipient" type="text" placeholder="0x… (auto-filled from your EVM wallet)" autocomplete="off" spellcheck="false" style="font-family:'Roboto Mono',monospace;font-size:12px">
                <button class="btn btn-ghost btn-sm" id="br-use-evm" type="button" style="margin-top:6px;font-size:11px">Use connected EVM wallet</button>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="br-amount">AMOUNT (ANET)</label>
              <div class="token-field-row">
                <span class="oc-token-fixed">${logo('ANET', { size: 18 })} ANET</span>
                <input class="amount-input" id="br-amount" type="number" placeholder="0.00" min="0" step="any" inputmode="decimal" aria-label="Amount to export">
              </div>
              <div class="token-balance-row"><span id="br-max-note" style="font-size:12px;color:var(--muted-2)">—</span><span class="balance-max" id="br-max">MAX</span></div>
            </div>

            <div class="price-info" id="br-summary" style="display:none;flex-direction:column;gap:6px"></div>

            <button class="btn btn-primary btn-full" id="br-submit" style="padding:14px;font-size:15px" disabled>Export to BNB Chain</button>
            <div class="swap-status" id="br-status"></div>

            <div class="info-box" style="font-size:11.5px;color:var(--muted-2)">
              One-way bridge: native ANET leaves L1 and the same amount of wANET is released from the BNB Chain vault by its M-of-N signer set (relayer fee, if any, is deducted on the BNB side). wANET can never be redeemed back into native L1 ANET. Validator fee ${fmtAnet(FEE_ANTS, 5)} ANET · per-tx cap ${PER_TX_CAP_ANET.toLocaleString()} ANET · release deadline ${RELEASE_DEADLINE_H}h.
            </div>

            <div>
              <div class="tm-panel-head" style="padding:0 0 8px;border:0"><span>YOUR EXPORTS</span><button class="btn btn-ghost btn-sm" id="br-history-refresh" type="button" style="font-size:11px">Refresh</button></div>
              <div id="br-history"><div class="tm-empty">Connect your ANET wallet to see export history.</div></div>
            </div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <div class="card-header"><span class="card-title">BNB CHAIN VAULT · LIVE</span><span class="pill live green">On-chain</span></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:8px" id="br-vault">
              <div class="tm-empty">Reading vault…</div>
            </div>
          </div>

          <div class="card">
            <div class="card-header"><span class="card-title">HOW EXPORT WORKS</span></div>
            <div class="card-body" style="display:grid;gap:12px">
              ${step(1, 'Mine on L1', 'Native ANET only originates from mining. Nothing external can mint it.')}
              ${step(2, 'Become eligible', `${MIN_SESSIONS.toLocaleString()} on-chain sessions and the mined-coin vesting schedule (6-month cliff, then 25% every 3 months) apply to exports.`)}
              ${step(3, 'Burn on L1', 'You sign a <code>bridge_burn</code> action in your ANET wallet; the L1 destroys the amount and records the export.')}
              ${step(4, 'Release on BNB Chain', 'Independent vault signers verify the burn and release the same amount of wANET to your address (EIP-712, M-of-N).')}
              ${step(5, 'Trade', 'wANET trades on PancakeSwap — use the <a href="#" id="br-goto-trade">Trade tab</a>.')}
            </div>
          </div>

          <div class="card">
            <div class="card-header"><span class="card-title">SUPPORTED ROUTES</span></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
              <div class="br-route-row"><span class="br-route-row-l">${logo('ANET', { size: 18 })} ANET L1 → ${logo('ANET', { size: 18, chain: 56 })} wANET · BNB Chain</span><span class="pill green" id="br-route-pill">—</span></div>
              <div class="br-route-row muted"><span class="br-route-row-l">${logo('BNB', { size: 18 })} ${logo('ETH', { size: 18 })} ${logo('SOL', { size: 18 })} Any chain → ANET L1</span><span class="pill">Disabled · one-way policy</span></div>
              <div class="br-route-row muted"><span class="br-route-row-l">${logo('ETH', { size: 18 })} ${logo('SOL', { size: 18 })} ANET L1 → Ethereum / Solana</span><span class="pill">Not deployed</span></div>
              <p style="margin:4px 0 0;font-size:11.5px;color:var(--muted)">Other spokes require the audited mint-burn portal (see contracts/PRODUCTION_LAUNCH.md) and are not offered here.</p>
            </div>
          </div>
        </div>
      </div>`;

    $('br-amount').addEventListener('input', renderSummary);
    $('br-recipient').addEventListener('input', renderSummary);
    $('br-max').addEventListener('click', () => { const l = br.account ? exportLimits(br.account) : null; if (l && l.maxAnts > 0) { $('br-amount').value = plainAnet(l.maxAnts); renderSummary(); } });
    $('br-use-evm').addEventListener('click', () => {
      const a = S()?.evmWallet?.address;
      if (a) { $('br-recipient').value = a; renderSummary(); }
      else if (typeof connectEvmWallet === 'function') connectEvmWallet().then(() => { const b = S()?.evmWallet?.address; if (b) { $('br-recipient').value = b; renderSummary(); } }).catch(() => {});
    });
    $('br-submit').addEventListener('click', submitExport);
    $('br-history-refresh').addEventListener('click', refreshHistory);
    $('br-goto-trade').addEventListener('click', (e) => { e.preventDefault(); if (typeof setTab === 'function') setTab('trade'); });
    br.mounted = true;
    const coLogos = $('co-route-logos');
    if (coLogos) coLogos.innerHTML = logo('ANET', { size: 20 }) + ' → ' + logo('ANET', { size: 20, chain: 56 });
    renderForm(); renderGate(); renderVault();
  }

  const step = (n, title, body) => `<div style="display:flex;gap:12px;align-items:flex-start"><div class="br-step">${n}</div><div><div style="font-size:13px;font-weight:700;margin-bottom:2px">${title}</div><div style="font-size:12px;color:var(--muted)">${body}</div></div></div>`;

  function renderBadge() {
    const label = br.gate === 'live' ? 'Live' : br.gate === 'gated' ? 'Gated' : br.gate === 'checking' ? 'Export' : 'Offline';
    const b = $('bridge-tab-badge');
    if (b) { b.textContent = label; b.classList.toggle('is-live', br.gate === 'live'); }
    const co = $('co-bridge-pill');
    if (co) { co.textContent = br.gate === 'checking' ? 'Bridge tab' : `Bridge · ${label}`; co.className = 'pill ' + (br.gate === 'live' ? 'green' : br.gate === 'gated' ? 'amber' : ''); }
  }

  function renderGate() {
    const pill = $('br-gate-pill'), note = $('br-gate-note'), routePill = $('br-route-pill');
    if (!pill) return;
    if (br.gate === 'live') {
      pill.className = 'pill live green'; pill.textContent = 'Live';
      note.style.display = 'none';
      if (routePill) { routePill.className = 'pill green'; routePill.textContent = 'Live'; }
    } else if (br.gate === 'gated') {
      pill.className = 'pill amber'; pill.textContent = 'Gated';
      note.style.display = '';
      note.innerHTML = `<strong>Export is switched off on the L1 node.</strong> The node operator enables <code>ANET_BRIDGE_BURN_ENABLED</code> after the vault canary release succeeds (see contracts/AUDIT_BRIDGE_2026-05-24.md §3.3). Everything else — the BNB Chain vault, the signer flow and this page — is ready; the form unlocks automatically once the switch is on. <button class="btn btn-ghost btn-sm" id="br-recheck" type="button" style="font-size:11px;margin-left:6px">Check again</button>`;
      $('br-recheck')?.addEventListener('click', probeGate);
      if (routePill) { routePill.className = 'pill amber'; routePill.textContent = 'Gated'; }
    } else if (br.gate === 'unreachable') {
      pill.className = 'pill'; pill.textContent = 'Offline';
      note.style.display = '';
      note.innerHTML = `<strong>Cannot reach the A Network L1 API</strong> (${esc(br.gateDetail)}). <button class="btn btn-ghost btn-sm" id="br-recheck" type="button" style="font-size:11px;margin-left:6px">Retry</button>`;
      $('br-recheck')?.addEventListener('click', probeGate);
      if (routePill) { routePill.className = 'pill'; routePill.textContent = 'Offline'; }
    } else { pill.className = 'pill'; pill.textContent = 'Checking…'; }
    renderSummary();
  }

  function renderForm() {
    const fromEl = $('br-from-wallet'), eligEl = $('br-eligibility'), maxNote = $('br-max-note');
    if (!fromEl) return;
    const addr = S()?.anetWallet?.address;
    if (!addr) {
      fromEl.innerHTML = `<button class="btn btn-outline btn-sm" id="br-connect-anet" type="button">Connect ANET wallet</button>`;
      $('br-connect-anet')?.addEventListener('click', () => { if (typeof ensureAnetSigner === 'function') ensureAnetSigner(); else if (typeof openAnetWalletModal === 'function') openAnetWalletModal(); });
      eligEl.innerHTML = ''; maxNote.textContent = '—';
      const r = $('br-recipient'); if (r && !r.value && S()?.evmWallet?.address) r.value = S().evmWallet.address;
      renderSummary(); return;
    }
    fromEl.innerHTML = `<span class="tm-mono">${esc(short(addr))}</span>`;
    const r = $('br-recipient'); if (r && !r.value && S()?.evmWallet?.address) r.value = S().evmWallet.address;
    if (!br.account) { eligEl.innerHTML = '<span class="tm-muted">Loading account…</span>'; maxNote.textContent = '—'; renderSummary(); return; }
    const l = exportLimits(br.account);
    eligEl.innerHTML = `
      <div class="br-elig-row ${l.sessions >= MIN_SESSIONS ? 'ok' : 'no'}">${l.sessions >= MIN_SESSIONS ? '✓' : '✕'} Sessions ${l.sessions.toLocaleString()} / ${MIN_SESSIONS.toLocaleString()}</div>
      <div class="br-elig-row ${l.lockedAnts > 0 ? 'warn' : 'ok'}">${l.lockedAnts > 0 ? '◔' : '✓'} Vesting${l.vestedBps != null ? ` ${(l.vestedBps / 100).toFixed(0)}% unlocked` : ''}${l.lockedAnts > 0 ? ` · ${fmtAnet(l.lockedAnts, 4)} ANET locked` : ''}</div>
      <div class="br-elig-row">Balance ${fmtAnet(l.balance, 4)} ANET</div>`;
    maxNote.textContent = l.maxAnts > 0 ? `Exportable now: ${fmtAnet(l.maxAnts, 4)} ANET (cap ${PER_TX_CAP_ANET.toLocaleString()} / tx)` : (l.reasons[0] || 'Nothing exportable right now');
    renderSummary();
  }

  function renderSummary() {
    const box = $('br-summary'), btn = $('br-submit'); if (!box || !btn) return;
    const addr = S()?.anetWallet?.address;
    const amountAnts = anetToAnts($('br-amount')?.value || '');
    const recipient = ($('br-recipient')?.value || '').trim();
    const limits = br.account ? exportLimits(br.account) : null;
    const err = amountAnts > 0 ? validateBurn({ amountAnts, recipient, limits }) : null;
    if (amountAnts > 0) {
      box.style.display = 'flex';
      box.innerHTML = `
        <div class="price-row"><span>You burn on L1</span><span class="val">${fmtAnet(amountAnts, 8)} ANET + ${fmtAnet(FEE_ANTS, 5)} fee</span></div>
        <div class="price-row"><span>Released on BNB Chain</span><span class="val">${fmtAnet(amountAnts, 8)} wANET${'<span class="tm-muted"> (less any relayer fee)</span>'}</span></div>
        <div class="price-row"><span>Recipient</span><span class="val tm-mono">${isBsc(recipient) ? esc(short(recipient)) : '—'}</span></div>
        <div class="price-row"><span>Release deadline</span><span class="val">${RELEASE_DEADLINE_H} hours</span></div>
        ${err ? `<div class="price-row warn"><span>Check</span><span class="val">${esc(err)}</span></div>` : ''}`;
    } else box.style.display = 'none';
    const live = br.gate === 'live';
    btn.disabled = !(live && addr && amountAnts > 0 && !err && limits && limits.eligible);
    btn.textContent = !live ? (br.gate === 'gated' ? 'Export gated — L1 switch off' : br.gate === 'unreachable' ? 'L1 API unreachable' : 'Checking…')
      : !addr ? 'Connect ANET wallet' : amountAnts <= 0 ? 'Enter an amount' : err ? 'Fix the highlighted issue' : (limits && !limits.eligible) ? 'Wallet not eligible yet' : `Export ${fmtAnet(amountAnts, 4)} ANET to BNB Chain`;
  }

  function renderHistory() {
    const el = $('br-history'); if (!el) return;
    if (!br.burns.length) { el.innerHTML = '<div class="tm-empty">No exports from this wallet yet.</div>'; return; }
    const rows = br.burns.slice().sort((a, b) => Number(b.burn_id) - Number(a.burn_id)).slice(0, 25);
    el.innerHTML = `<div class="br-hist-head"><span>ID</span><span>Amount</span><span>To</span><span>Status</span><span>BNB tx</span></div>` + rows.map(r => {
      const m = statusMeta(r.status);
      return `<div class="br-hist-row">
        <span class="tm-mono">#${esc(String(r.burn_id))}</span>
        <span class="tm-mono">${fmtAnet(r.ants, 4)} ANET</span>
        <span class="tm-mono">${esc(short(r.bsc_recipient || ''))}</span>
        <span><span class="pill ${m.cls}" style="font-size:10px">${esc(m.label)}</span></span>
        <span>${r.bsc_tx_hash ? `<a href="https://bscscan.com/tx/${esc(r.bsc_tx_hash)}" target="_blank" rel="noopener">${esc(short(r.bsc_tx_hash))} ↗</a>` : '<span class="tm-muted">—</span>'}</span>
      </div>`;
    }).join('');
  }

  function renderVault() {
    const el = $('br-vault'); if (!el) return;
    const row = (k, v) => `<div class="price-row"><span>${k}</span><span class="val">${v}</span></div>`;
    el.innerHTML =
      row('Vault balance', br.vault.balance != null ? `${Number(br.vault.balance).toLocaleString('en-US', { maximumFractionDigits: 2 })} wANET` : 'reading…') +
      row('Vault contract', `<a href="https://bscscan.com/address/${VAULT}" target="_blank" rel="noopener">${short(VAULT)} ↗</a>`) +
      row('wANET (BEP-20)', `<a href="https://bscscan.com/token/${WANET}" target="_blank" rel="noopener">${short(WANET)} ↗</a>`) +
      row('Release control', 'M-of-N EIP-712 signers') +
      row('Custody of your funds', 'None — burn on L1, receive on BNB Chain');
  }

  function onWalletsChanged() {
    if (!br.mounted) return;
    renderForm();
    refreshAccount();
    if (br.gate === 'live') refreshHistory();
  }

  function onTabShown() {
    probeGate().then(() => refreshHistory());
    refreshAccount(); refreshVault();
  }

  function boot() {
    mount();
    probeGate().then(() => refreshHistory());
    refreshVault();
    // hook wallet UI updates from dex.js (global function declarations are rebindable)
    const prev = window.updateBridgeWalletDisplay;
    window.updateBridgeWalletDisplay = function () { try { if (typeof prev === 'function') prev.apply(this, arguments); } catch (_) {} onWalletsChanged(); };
    document.querySelector('.dex-tabs [data-tab="bridge"]')?.addEventListener('click', onTabShown);
    setInterval(() => { if ($('tab-bridge')?.classList.contains('active')) { refreshVault(); if (br.gate !== 'live') probeGate(); } }, 60_000);
  }

  window.AnetBridge = {
    VAULT, WANET, MIN_SESSIONS, FEE_ANTS, PER_TX_CAP_ANET,
    probeGate, state: br,
    __test: { anetToAnts, exportLimits, validateBurn, burnPayload, statusMeta, isBsc },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
