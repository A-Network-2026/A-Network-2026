/**
 * domains.js — ANET Names (.ant) on the A Network Layer 1 (anet-chain docs/ANT_DOMAINS_SPEC.md).
 * Reads use the public node RPC. Changes are signed `action-v1` envelopes exactly like the DEX: the
 * ANET Wallet extension when connected, otherwise the encrypted in-browser keystore (anet-wallet.js,
 * shared with dex.html). Keys never leave the browser or extension, and name actions carry no fee.
 */
(function (global) {
  'use strict';

  const API = 'https://explorer.a-network.net';
  const EXPLORER = API + '/explorer';
  const ANTS_PER_ANET = 100000000n;
  const U64_MAX = 18446744073709551615n;
  const ADDRESS_RE = /^ANET[0-9A-F]{36}$/;
  const ROUTES = {
    ant_register: '/domains/register', ant_transfer: '/domains/transfer', ant_set_resolver: '/domains/resolver',
    ant_set_primary: '/domains/primary', ant_list: '/domains/market/list', ant_cancel: '/domains/market/cancel',
    ant_buy: '/domains/market/buy', ant_bid: '/domains/market/bid', ant_settle: '/domains/market/settle'
  };
  const LABELS = {
    ant_register: 'Register', ant_transfer: 'Transfer', ant_set_resolver: 'Set resolver of', ant_set_primary: 'Set primary name to',
    ant_list: 'List', ant_cancel: 'Cancel listing of', ant_buy: 'Buy', ant_bid: 'Bid on', ant_settle: 'Settle auction of'
  };
  const KINDS = { fixed: 'Fixed price', auction: 'Auction', 'domain-auction': 'Domain auction' };
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  // ── Pure helpers (window.AnetDomains, tested in tests/frontend/domains.test.mjs) ──

  // Same rules as the node's domain::normalize_name. Only A–Z is lowercased (no Unicode case
  // folding), so look-alike and non-ASCII names are rejected instead of silently converted.
  function normalizeName(input) {
    const lower = String(input ?? '').trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
    const label = lower.endsWith('.ant') ? lower.slice(0, -4) : lower;
    if (!/^[a-z0-9-]{1,62}$/.test(label) || label.startsWith('-') || label.endsWith('-') || label.includes('--')) {
      throw new Error('A .ant name needs 1–62 characters from a–z, 0–9 and single inner hyphens.');
    }
    return label + '.ant';
  }

  function walletAddress(value, field) {
    const address = String(value ?? '').trim().toUpperCase();
    if (!ADDRESS_RE.test(address)) throw new Error(`${field}: enter a valid ANET address (ANET + 36 hex characters).`);
    return address;
  }

  // Exact decimal string of a u64: amounts and listing ids are signed as strings.
  function whole(value, field) {
    const text = typeof value === 'bigint' ? value.toString() : String(value ?? '').trim();
    if (!/^\d+$/.test(text) || (typeof value === 'number' && !Number.isSafeInteger(value)) || BigInt(text) > U64_MAX) {
      throw new Error(`${field} must be a whole number.`);
    }
    return BigInt(text).toString();
  }

  // The exact payload the node rebuilds from the request body; it must equal auth.payload.
  function buildPayload(action, name, fields) {
    if (!has(ROUTES, action)) throw new Error('Unknown .ant action: ' + action);
    const f = fields || {};
    const clear = action === 'ant_set_primary' && String(name ?? '').trim() === '';
    const p = { route: action, name: clear ? '' : normalizeName(name) };
    if (action === 'ant_transfer') p.to = walletAddress(f.to, 'Recipient');
    if (action === 'ant_set_resolver') p.address = walletAddress(f.address, 'Resolver');
    if (action === 'ant_list') {
      if (!has(KINDS, f.kind)) throw new Error('Listing type must be fixed, auction or domain-auction.');
      const timed = f.kind !== 'fixed';
      const floor = f.kind === 'domain-auction' ? 10000n : 1n;
      p.kind = f.kind;
      p.price_ants = whole(f.priceAnts, 'Price');
      p.duration_hours = timed ? Number(whole(f.durationHours, 'Duration')) : 0;
      if (BigInt(p.price_ants) < floor) throw new Error(`A ${KINDS[f.kind].toLowerCase()} listing needs at least ${antsToAnet(floor)} ANET (${floor} ANTS).`);
      if (timed && !(p.duration_hours >= 1 && p.duration_hours <= 168)) throw new Error('An auction lasts 1–168 hours.');
    }
    if (['ant_cancel', 'ant_buy', 'ant_bid', 'ant_settle'].includes(action)) p.listing_id = whole(f.listingId, 'Listing id');
    if (action === 'ant_buy') p.price_ants = whole(f.priceAnts, 'Price');
    if (action === 'ant_bid') p.amount_ants = whole(f.amountAnts, 'Bid');
    return p;
  }

  // "1.5" ANET → "150000000" ANTS with BigInt string math (never floating point).
  function anetToAnts(text) {
    const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(String(text ?? '').trim());
    if (!m) throw new Error('Enter an ANET amount with at most 8 decimals, for example 1.5');
    const ants = BigInt(m[1]) * ANTS_PER_ANET + BigInt((m[2] || '').padEnd(8, '0'));
    if (ants > U64_MAX) throw new Error('Amount is too large.');
    return ants.toString();
  }

  function antsToAnet(ants) {
    const v = BigInt(ants ?? 0);
    return `${v / ANTS_PER_ANET}.${(v % ANTS_PER_ANET).toString().padStart(8, '0')}`;
  }

  global.AnetDomains = { normalizeName, buildPayload, anetToAnts, antsToAnet };

  // ── Page ──
  const document = global.document;
  if (!document || !document.getElementById('dn-search-form')) return;

  const state = { chainId: 'anet-private-mainnet-1', address: '', viaExtension: false, selected: null, searched: '', details: '', marketSeq: 0 };
  const $ = (id) => document.getElementById(id);
  const keystore = () => global.AnetWallet;
  const extension = () => (global.anet && global.anet.isAnet ? global.anet : null);
  const fmtAnet = (ants) => antsToAnet(ants) + ' ANET';
  const fmtTime = (s) => (s && !isNaN(new Date(s)) ? new Date(s).toLocaleString() : '—');

  // DOM builder: text only ever goes through textContent / text nodes, never innerHTML.
  function el(tag, props, kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else node.setAttribute(key, value);
    }
    for (const kid of kids || []) if (kid) node.append(kid);
    return node;
  }
  const fill = (node, kids) => node.replaceChildren(...kids.filter(Boolean));
  const note = (text, cls) => el('li', { class: cls || 'muted', text });
  const kv = (name, value) => el('div', { class: 'kv' }, [el('b', { text: name + ': ' }), String(value ?? '—')]);

  function setStatus(text, kind) {
    $('dn-status').className = 'status ' + (kind || 'info');
    $('dn-status').textContent = text;
  }

  async function api(path, body) {
    const init = { cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body) Object.assign(init, { method: 'POST', body: JSON.stringify(body), headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
    const res = await fetch(API + path, init).catch(() => { throw new Error('Cannot reach the A Network node. Check your connection and try again.'); });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
    return data;
  }

  // Loading state: the button is disabled while the task runs; errors go to the status bar.
  async function busy(btn, task) {
    const text = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Working…';
    try { await task(); } catch (e) { setStatus(e.message || String(e), 'bad'); }
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = text;
  }

  // ── Wallet: the same two signers as dex.js ──
  function needKeystore() {
    if (!keystore()) throw new Error('Wallet module failed to load. Refresh the page.');
    return keystore();
  }

  async function sign(action, payload) {
    if (!state.viaExtension) {
      if (!needKeystore().isUnlocked()) throw new Error('Unlock your ANET wallet to sign.');
      return keystore().signAction(action, payload, state.chainId);
    }
    if (!extension()) throw new Error('ANET Wallet extension not found. Reload the page.');
    return extension().signAction(action, payload);
  }

  function setWallet(address, viaExtension) {
    const a = String(address || '').trim().toUpperCase();
    state.address = ADDRESS_RE.test(a) ? a : '';
    state.viaExtension = !!(state.address && viaExtension);
    renderWallet();
    loadMine();
    loadMarket();
  }

  function renderWallet() {
    const address = state.address;
    const vault = !!(keystore() && keystore().hasVault());
    $('dn-wallet-on').hidden = !address;
    $('dn-wallet-off').hidden = !!address;
    $('dn-ext-btn').hidden = !extension();
    $('dn-unlock-form').hidden = !vault;
    $('dn-vault-addr').textContent = vault ? keystore().vaultAddress() : '';
    $('dn-import').open = !vault;
    if (!address) return;
    $('dn-addr').textContent = address;
    $('dn-via').textContent = state.viaExtension ? 'ANET Wallet extension' : 'Browser wallet (encrypted on this device)';
    $('dn-lock-btn').textContent = state.viaExtension ? 'Disconnect' : 'Lock';
    $('dn-sessions').textContent = $('dn-balance').textContent = '…';
    api('/accounts/' + address).then((account) => {
      if (address !== state.address) return;
      const sessions = Number(account.sessions) || 0;
      $('dn-sessions').textContent = sessions >= 1000 ? String(sessions) : `${sessions} (1,000 needed to register, buy, bid or receive a name)`;
      $('dn-balance').textContent = fmtAnet(account.ants_balance);
    }, (e) => { if (address === state.address) $('dn-sessions').textContent = $('dn-balance').textContent = `— (${e.message})`; });
  }

  // Unlock, import and extension connect each resolve the address the page then signs with.
  function connectWith(btn, viaExtension, message, getAddress) {
    busy(btn, async () => {
      const address = await getAddress();
      if (!address) return;
      setWallet(address, viaExtension);
      setStatus(message, 'good');
    });
  }

  async function unlockKeystore() {
    const address = await needKeystore().unlock($('dn-unlock-pw').value);
    $('dn-unlock-pw').value = '';
    return address;
  }

  async function importKeystore() {
    const ks = needKeystore();
    const secret = $('dn-secret').value.trim();
    const password = $('dn-import-pw').value;
    if (!secret) throw new Error('Enter your seed phrase or private key.');
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');
    if (password !== $('dn-import-pw2').value) throw new Error('Passwords do not match.');
    if (ks.hasVault() && !global.confirm('Replace the wallet saved in this browser? The DEX uses the same saved wallet.')) return '';
    const address = await ks.importSecret({ secret, password, persist: true });
    $('dn-import-form').reset();
    return address;
  }

  async function connectExtension() {
    if (!extension()) throw new Error('ANET Wallet extension not detected. Install it, then reload.');
    const res = await extension().connect();
    const address = (res && res.address) || (await extension().getAddress());
    if (!address) throw new Error('No account returned by the extension.');
    return address;
  }

  function watchExtension() {
    const wire = () => {
      if (!extension()) return;
      renderWallet();
      extension().getAddress().then((a) => { if (a && !state.address) setWallet(a, true); }, () => {});
      extension().on('accountsChanged', (accounts) => { if (state.viaExtension) setWallet(accounts && accounts[0], true); });
    };
    if (extension()) wire();
    else global.addEventListener('anet#initialized', wire, { once: true });
  }

  function lockWallet() {
    const viaExtension = state.viaExtension;
    setWallet('', false);
    if (viaExtension && extension()) extension().disconnect().catch(() => {});
    else if (keystore()) keystore().lock();
    setStatus(viaExtension ? 'Extension disconnected from this page.' : 'Wallet locked.', 'info');
  }

  // ── Search and details ──
  function listingText(l) {
    if (l.kind === 'fixed') return `${KINDS.fixed} ${fmtAnet(l.price_ants)} (listing #${l.listing_id})`;
    const bid = l.highest_bid_ants ? fmtAnet(l.highest_bid_ants) : 'none';
    return `${KINDS[l.kind] || l.kind}, ${l.ended ? 'ended' : 'ends ' + fmtTime(l.ends_at)}, highest bid ${bid} (listing #${l.listing_id})`;
  }

  function onSearch() {
    try {
      lookup(normalizeName($('dn-search-input').value));
    } catch (e) {
      state.searched = '';
      fill($('dn-search-result'), [el('p', { class: 'bad', text: 'Invalid name: ' + e.message })]);
    }
  }

  async function lookup(name) {
    const show = (...kids) => { if (name === state.searched) fill($('dn-search-result'), kids); };
    state.searched = name;
    show(el('p', { class: 'muted', text: `Looking up ${name}…` }));
    let v;
    try { v = await api('/domains/name/' + name); } catch (e) { return show(el('p', { class: 'bad', text: e.message })); }
    if (name !== state.searched) return;
    if (v.reserved) show(el('p', { class: 'bad', text: `${v.name} is reserved and cannot be registered.` }));
    else if (v.available) {
      show(el('p', { class: 'good', text: `${v.name} is available.` }),
        el('button', { type: 'button', class: 'btn', text: `Register ${v.name}`, onclick: (e) => runAction(e.currentTarget, 'ant_register', v.name) }),
        el('p', { class: 'hint', text: 'Free: no registration fee and no network fee. Ownership is permanent.' }));
    } else {
      show(el('p', { text: `${v.name} is registered${v.pending ? ' (pending confirmation)' : ''}.` }),
        kv('Owner', v.owner), kv('Resolves to', v.resolver), v.listing && kv('For sale', listingText(v.listing)));
    }
    showDetails(name, v);
  }

  function eventText(ev) {
    const a = ev.attributes || {};
    switch (ev.op) {
      case 'register': return `Registered by ${a.owner}`;
      case 'transfer': return `Transferred ${a.from} → ${a.to}`;
      case 'resolver': return `Now resolves to ${a.address}`;
      case 'primary': return `Primary name of ${a.address}`;
      case 'list': return `Listed (${KINDS[a.kind] || a.kind}) at ${fmtAnet(a.price_ants)}`;
      case 'cancel': return 'Listing cancelled';
      case 'buy': return `Sold for ${fmtAnet(a.price_ants)}: ${a.from} → ${a.to}`;
      case 'bid': return `Bid ${fmtAnet(a.amount_ants)} by ${ev.actor}`;
      case 'settle': return a.to ? `Auction settled for ${fmtAnet(a.price_ants)}: ${a.from} → ${a.to}` : 'Auction closed without bids';
      default: return '';
    }
  }

  function historyItem(ev) {
    const height = Number(ev.block_height);
    const count = Number(ev.confirmations) || 0;
    const where = ev.block_height == null
      ? el('span', { class: 'badge warn', text: 'Pending' })
      : el('a', { href: `${EXPLORER}/blocks/${height}`, target: '_blank', rel: 'noopener noreferrer', text: `Block #${height} · ${count} confirmation${count === 1 ? '' : 's'}` });
    return el('li', { class: 'item' }, [
      el('strong', { text: ev.op }), el('span', { class: 'grow', text: eventText(ev) }), where, el('span', { class: 'muted', text: fmtTime(ev.timestamp) })
    ]);
  }

  async function showDetails(name, view, focus) {
    const path = '/domains/name/' + encodeURIComponent(name);
    state.details = name;
    $('dn-details').hidden = false;
    $('dn-details-name').textContent = name;
    $('dn-verify').href = `${EXPLORER}/domains/${encodeURIComponent(name)}`;
    if (focus) $('dn-details-title').focus();
    fill($('dn-history'), [note('Loading history…')]);
    try {
      const [v, h] = await Promise.all([view || api(path), api(path + '/history')]);
      if (name !== state.details) return;
      const status = v.reserved ? 'Reserved' : v.registered ? (v.pending ? 'Registered · pending' : 'Registered · confirmed') : 'Available';
      fill($('dn-record'), [
        ['Name', v.name], ['Status', status], ['Owner', v.owner], ['Resolves to', v.resolver],
        ['Primary name of its resolver', v.registered ? (v.is_primary ? 'Yes' : 'No') : null],
        ['Registered', fmtTime(v.registered_at)], ['Updated', fmtTime(v.updated_at)], ['Listing', v.listing ? listingText(v.listing) : 'Not listed']
      ].flatMap(([k, value]) => [el('dt', { text: k }), el('dd', { text: value ?? '—' })]));
      const events = h.events || [];
      fill($('dn-history'), events.length ? events.map(historyItem) : [note('No operations yet.')]);
    } catch (e) {
      if (name === state.details) fill($('dn-history'), [note(e.message, 'bad')]);
    }
  }

  // ── My names and manage ──
  async function loadMine() {
    const list = $('dn-my-list');
    const address = state.address;
    if (!address) {
      selectName(null);
      return fill(list, [note('Connect or unlock a wallet to see your names.')]);
    }
    fill(list, [note('Loading your names…')]);
    try {
      const domains = (await api('/domains/owner/' + address)).domains || [];
      if (address !== state.address) return;
      fill(list, domains.length ? domains.map((v) => el('li', { class: 'item' }, [
        el('strong', { class: 'grow', text: v.name }),
        v.is_primary && el('span', { class: 'badge', text: 'Primary' }),
        el('span', { class: v.pending ? 'badge warn' : 'badge ok', text: v.pending ? 'Pending' : 'Confirmed' }),
        v.listing && el('span', { class: 'badge', text: 'Listed' }),
        el('button', { type: 'button', class: 'btn btn-alt', 'aria-label': `Manage ${v.name}`, text: 'Manage', onclick: () => selectName(v, true) })
      ])) : [note('You do not own any .ant names yet.')]);
      selectName(state.selected && domains.find((v) => v.name === state.selected.name));
    } catch (e) {
      if (address === state.address) fill(list, [note(e.message, 'bad')]);
    }
  }

  // Show the manage panel for an owned name (or hide it when `v` is empty).
  function selectName(v, focus) {
    state.selected = v || null;
    $('dn-manage').hidden = !v;
    if (!v) return;
    $('dn-manage-name').textContent = v.name;
    $('dn-resolver-input').placeholder = v.resolver || 'ANET…';
    $('dn-primary-btn').hidden = !!v.is_primary;
    $('dn-clear-primary-btn').hidden = !v.is_primary;
    $('dn-list-form').hidden = !!v.listing;
    $('dn-cancel-box').hidden = !v.listing;
    $('dn-listing-info').textContent = v.listing ? listingText(v.listing) : '';
    if (!focus) return;
    for (const id of ['dn-resolver-form', 'dn-transfer-form', 'dn-list-form']) $(id).reset();
    syncKind();
    showDetails(v.name, v);
    $('dn-manage-title').focus();
  }

  function syncKind() {
    const fixed = $('dn-list-kind').value === 'fixed';
    $('dn-list-hours').disabled = fixed;
    $('dn-list-price-label').textContent = fixed ? 'Price (ANET)' : 'Minimum bid (ANET)';
  }

  // ── Market ──
  async function loadMarket() {
    const list = $('dn-market-list');
    const kind = $('dn-market-kind').value;
    const seq = ++state.marketSeq;
    fill(list, [note('Loading listings…')]);
    try {
      const listings = (await api('/domains/market' + (kind ? '?kind=' + encodeURIComponent(kind) : ''))).listings || [];
      if (seq === state.marketSeq) fill(list, listings.length ? listings.map(listingItem) : [note('No open listings.')]);
    } catch (e) {
      if (seq === state.marketSeq) fill(list, [note('Could not load the market: ' + e.message, 'bad')]);
    }
  }

  function listingItem(l) {
    const me = state.address;
    const auction = l.kind !== 'fixed';
    const mine = !!me && me === l.seller;
    const button = (text, onclick) => el('button', { type: 'button', class: 'btn', text, onclick: (e) => onclick(e.currentTarget) });
    const actions = [];
    if (!auction && !mine) actions.push(button(`Buy for ${fmtAnet(l.price_ants)}`, (b) => runAction(b, 'ant_buy', l.name, { listingId: l.listing_id, priceAnts: l.price_ants })));
    if (auction && !l.ended && !mine) {
      const id = 'dn-bid-' + Number(l.listing_id);
      const input = el('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: antsToAnet(l.min_next_bid_ants ?? l.price_ants) });
      actions.push(el('label', { for: id, class: 'inline', text: 'Your bid (ANET)' }), input,
        button('Bid', (b) => runAction(b, 'ant_bid', l.name, () => ({ listingId: l.listing_id, amountAnts: anetToAnts(input.value) }))));
    }
    if (auction && l.ended && me && (mine || me === l.highest_bidder)) actions.push(button('Settle', (b) => runAction(b, 'ant_settle', l.name, { listingId: l.listing_id })));
    return el('li', { class: 'item' }, [
      el('button', { type: 'button', class: 'link grow', text: l.name, onclick: () => showDetails(l.name, null, true) }),
      el('span', { class: 'badge', text: KINDS[l.kind] || l.kind }),
      l.ended && el('span', { class: 'badge warn', text: 'Ended' }),
      kv('Seller', l.seller),
      kv(auction ? (l.ended ? 'Minimum bid' : 'Minimum next bid') : 'Price', fmtAnet(auction ? (l.min_next_bid_ants ?? l.price_ants) : l.price_ants)),
      auction && kv('Highest bid', l.highest_bid_ants ? `${fmtAnet(l.highest_bid_ants)} by ${l.highest_bidder}` : 'none'),
      auction && kv(l.ended ? 'Ended' : 'Ends', fmtTime(l.ends_at)),
      actions.length && el('div', { class: 'row actions' }, actions)
    ]);
  }

  // ── Signed actions ──
  const label = (action, p) => (action === 'ant_set_primary' && !p.name ? 'Clear primary name' : `${LABELS[action]} ${p.name}`);

  function summary(action, p) {
    const lines = [label(action, p), `Wallet: ${state.address}`];
    if (p.to) lines.push(`Recipient: ${p.to}`);
    if (p.address) lines.push(`Resolves to: ${p.address}`);
    if (p.kind) lines.push(`Type: ${KINDS[p.kind]}${p.duration_hours ? `, ${p.duration_hours} hours` : ''}`);
    if (p.listing_id) lines.push(`Listing: #${p.listing_id}`);
    const amount = p.amount_ants || p.price_ants;
    if (amount) lines.push(`${p.amount_ants ? 'Bid' : p.kind && p.kind !== 'fixed' ? 'Minimum bid' : 'Price'}: ${antsToAnet(amount)} ANET (${amount} ANTS)`);
    lines.push(`Network: A Network Layer 1 (${state.chainId})`, 'Fee: none');
    return lines.join('\n');
  }

  // Pending until sealed. Clearing a primary name has no name to poll, so wait for the next block instead.
  async function waitSealed(name, tip) {
    for (let i = 0; i < 24; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      try {
        if (name ? !(await api('/domains/name/' + name)).pending : (await api('/sync/head')).tip_height > tip) return true;
      } catch (_) { /* transient: keep polling */ }
    }
    return false;
  }

  async function runAction(btn, action, name, fields) {
    let payload;
    try {
      payload = buildPayload(action, name, typeof fields === 'function' ? fields() : fields);
    } catch (e) {
      return setStatus(e.message, 'bad');
    }
    if (!state.address) return setStatus('Connect or unlock your ANET wallet first.', 'bad');
    if (!global.confirm(summary(action, payload))) return;
    await busy(btn, async () => {
      const tip = payload.name ? 0 : (await api('/sync/head')).tip_height;
      const body = Object.assign({ auth: await sign(action, payload) }, payload);
      delete body.route;
      await api(ROUTES[action], body);
      setStatus('Pending — waiting for the next block…', 'info');
      const sealed = await waitSealed(payload.name, tip);
      setStatus(sealed ? `Confirmed in a block: ${label(action, payload)}.` : 'Still pending after 60 seconds. It will be sealed in a coming block; check again shortly.', sealed ? 'good' : 'info');
      renderWallet();
      loadMine();
      loadMarket();
      if (payload.name && payload.name === state.searched) lookup(payload.name);
      else if (state.details) showDetails(state.details);
    });
  }

  // ── Wiring ──
  const selected = () => (state.selected ? state.selected.name : '');
  const onSubmit = (id, handler) => $(id).addEventListener('submit', (e) => { e.preventDefault(); handler(e.target.querySelector('button[type="submit"]')); });
  const onClick = (id, handler) => $(id).addEventListener('click', (e) => handler(e.currentTarget));

  onSubmit('dn-search-form', onSearch);
  onSubmit('dn-unlock-form', (btn) => connectWith(btn, false, 'Wallet unlocked.', unlockKeystore));
  onSubmit('dn-import-form', (btn) => connectWith(btn, false, 'Wallet imported, encrypted on this device and unlocked.', importKeystore));
  onClick('dn-ext-btn', (btn) => connectWith(btn, true, 'ANET Wallet extension connected.', connectExtension));
  onClick('dn-lock-btn', lockWallet);
  onSubmit('dn-resolver-form', (btn) => runAction(btn, 'ant_set_resolver', selected(), () => ({ address: $('dn-resolver-input').value })));
  onSubmit('dn-transfer-form', (btn) => runAction(btn, 'ant_transfer', selected(), () => ({ to: $('dn-transfer-input').value })));
  onSubmit('dn-list-form', (btn) => runAction(btn, 'ant_list', selected(), () => ({
    kind: $('dn-list-kind').value, priceAnts: anetToAnts($('dn-list-price').value), durationHours: $('dn-list-hours').value
  })));
  onClick('dn-primary-btn', (btn) => runAction(btn, 'ant_set_primary', selected()));
  onClick('dn-clear-primary-btn', (btn) => runAction(btn, 'ant_set_primary', ''));
  onClick('dn-cancel-btn', (btn) => runAction(btn, 'ant_cancel', selected(), () => ({ listingId: state.selected.listing.listing_id })));
  onClick('dn-market-refresh', loadMarket);
  $('dn-market-kind').addEventListener('change', loadMarket);
  $('dn-list-kind').addEventListener('change', syncKind);
  if (keystore()) keystore().onLock(() => { if (state.address && !state.viaExtension) { setWallet('', false); setStatus('Wallet locked.', 'info'); } });

  syncKind();
  renderWallet();
  loadMine();
  loadMarket();
  watchExtension();
  api('/sync/head').then((head) => { if (head && head.chain_id) state.chainId = String(head.chain_id); }, (e) => setStatus(e.message, 'bad'));
})(typeof window !== 'undefined' ? window : globalThis);
