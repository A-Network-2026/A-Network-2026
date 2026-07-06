/**
 * anet-wallet.js — A Network native L1 wallet for the web DEX.
 *
 * Fully client-side, non-custodial. Derives the ANET secp256k1 address, signs
 * Layer-1 actions (swaps, liquidity, transfers, activity) in the browser, and
 * stores the private key the way MetaMask does: encrypted at rest with a
 * password-derived key (PBKDF2-SHA256 + AES-256-GCM via WebCrypto). The raw
 * private key only ever exists in memory while the wallet is unlocked, and is
 * wiped on lock / auto-lock. Nothing is sent to any server except the public
 * signature + address.
 *
 * Byte-for-byte compatible with anet-chain/src/transaction.rs and the mobile
 * app's main.dart (_buildSignedActionAuthFromKey / _buildSignedAnetTransferTx).
 *
 * Exposes window.AnetWallet.
 */
(function (global) {
  'use strict';

  var N = global.AnetNoble;
  if (!N || !N.secp256k1 || !N.sha256 || !N.ripemd160) {
    console.error('[AnetWallet] anet-crypto.bundle.js must load before anet-wallet.js');
    return;
  }
  var secp256k1 = N.secp256k1;
  var sha256 = N.sha256;
  var ripemd160 = N.ripemd160;
  var bytesToHex = N.bytesToHex;
  var hexToBytes = N.hexToBytes;
  var utf8ToBytes = N.utf8ToBytes;

  var ANTS_PER_ANET = 100000000;        // 1 ANET = 1e8 ANTS
  var MIN_FEE_ANTS = 1000;              // chain MIN_FEE_ANTS
  var MAX_SAFE_ANTS = Number.MAX_SAFE_INTEGER; // 2^53-1
  var KEYSTORE_KEY = 'anet:web:keystore:v1';
  var PBKDF2_ITERATIONS = 310000;
  var DEFAULT_AUTOLOCK_MS = 15 * 60 * 1000; // 15 minutes inactivity

  // ── in-memory unlocked state (module-private, never on window) ────────────
  var unlockedKey = null;     // Uint8Array(32) | null
  var unlockedAddress = '';   // ANET... | ''
  var autoLockMs = DEFAULT_AUTOLOCK_MS;
  var autoLockTimer = null;
  var lockListeners = [];
  var unlockListeners = [];

  // ── helpers ───────────────────────────────────────────────────────────────
  function notify(list) {
    for (var i = 0; i < list.length; i++) {
      try { list[i](unlockedAddress); } catch (_) {}
    }
  }

  function wipeBytes(arr) {
    if (arr && arr.fill) {
      try { arr.fill(0); } catch (_) {}
    }
  }

  function isHexKey(text) {
    return /^(0x)?[0-9a-fA-F]{64}$/.test(String(text || '').trim());
  }

  function normalizePrivHex(hex) {
    var h = String(hex).trim().toLowerCase().replace(/^0x/, '').replace(/\s+/g, '');
    if (!/^[0-9a-f]{64}$/.test(h)) {
      throw new Error('Private key must be 64 hexadecimal characters.');
    }
    return h;
  }

  /**
   * Resolve a user-supplied secret to a 32-byte private key.
   *   - 64-hex (optionally 0x-prefixed)  → raw secp256k1 private key bytes
   *   - anything else (a seed phrase)    → SHA256(utf8(trim(seed)))
   * Matches the mobile app's _resolveAnetPrivateKey.
   */
  function secretToPrivateKey(secret) {
    var trimmed = String(secret == null ? '' : secret).trim();
    if (!trimmed) throw new Error('Enter your ANET seed phrase or private key.');
    var priv;
    if (isHexKey(trimmed)) {
      priv = hexToBytes(normalizePrivHex(trimmed));
    } else {
      priv = sha256(utf8ToBytes(trimmed));
    }
    // Validate the scalar is on-curve usable (noble throws if not).
    secp256k1.getPublicKey(priv, true);
    return priv;
  }

  function addressFromPrivateKey(priv) {
    var compressed = secp256k1.getPublicKey(priv, true); // 33 bytes
    return 'ANET' + bytesToHex(ripemd160(compressed)).toUpperCase().slice(0, 36);
  }

  /**
   * Canonical JSON identical to anet-chain canonical_json_string():
   * object keys sorted ascending, no whitespace, numbers verbatim,
   * null/true/false literals, strings JSON-escaped.
   */
  function canonicalJson(value) {
    if (value === null || value === undefined) return 'null';
    var t = typeof value;
    if (t === 'boolean') return value ? 'true' : 'false';
    if (t === 'bigint') return value.toString();
    if (t === 'number') {
      if (!Number.isFinite(value)) throw new Error('Non-finite number in payload.');
      if (Number.isInteger(value) && Math.abs(value) > MAX_SAFE_ANTS) {
        throw new Error('Integer exceeds safe range; pass it as a BigInt.');
      }
      return String(value);
    }
    if (t === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) {
      var parts = [];
      for (var i = 0; i < value.length; i++) parts.push(canonicalJson(value[i]));
      return '[' + parts.join(',') + ']';
    }
    if (t === 'object') {
      var keys = Object.keys(value).sort();
      var out = [];
      for (var k = 0; k < keys.length; k++) {
        out.push(JSON.stringify(keys[k]) + ':' + canonicalJson(value[keys[k]]));
      }
      return '{' + out.join(',') + '}';
    }
    throw new Error('Unsupported value in payload: ' + t);
  }

  function sigToHex(sig) {
    var compact = sig.toCompactRawBytes(); // 64 bytes r||s, low-s enforced by noble
    var out = new Uint8Array(65);
    out.set(compact, 0);
    out[64] = sig.recovery; // 0 | 1
    return bytesToHex(out);
  }

  // ── signing (low level; requires an explicit key) ─────────────────────────
  function buildSignedActionWithKey(priv, wallet, actionType, payload, chainId) {
    var ts = Date.now();
    var nonce = ts; // app uses millis as the monotonic nonce
    var walletUc = String(wallet).trim().toUpperCase();
    var safePayload = payload || { route: actionType };
    var payloadCanonical = canonicalJson(safePayload);
    var preimage =
      'action-v1|' + actionType + '|' + walletUc + '|' + nonce + '|' + ts +
      '|' + chainId + '|' + payloadCanonical;
    var hashBytes = sha256(utf8ToBytes(preimage));
    var actionHash = bytesToHex(hashBytes);
    var sig = secp256k1.sign(hashBytes, priv); // RFC6979 deterministic, low-s
    return {
      wallet: walletUc,
      nonce: nonce,
      timestamp: new Date(ts).toISOString(),
      chain_id: chainId,
      payload: safePayload,
      signature: sigToHex(sig),
      action_hash: actionHash
    };
  }

  function buildSignedTransferWithKey(priv, from, to, amountAnts, nonce, feeAnts, chainId, payload) {
    var ts = Date.now();
    var fromUc = String(from).trim().toUpperCase();
    var toUc = String(to).trim().toUpperCase();
    var safePayload = payload || {};
    var payloadCanonical = canonicalJson(safePayload);
    var preimage =
      'v1|transfer|' + fromUc + '|' + toUc + '|' + amountAnts + '|' + feeAnts +
      '|' + nonce + '|' + ts + '|' + chainId + '|' + payloadCanonical;
    var hashBytes = sha256(utf8ToBytes(preimage));
    var txHash = bytesToHex(hashBytes);
    var sig = secp256k1.sign(hashBytes, priv);
    return {
      tx_type: 'transfer',
      from: fromUc,
      to: toUc,
      amount_ants: amountAnts,
      fee_ants: feeAnts,
      nonce: nonce,
      timestamp: new Date(ts).toISOString(),
      chain_id: chainId,
      payload: safePayload,
      signature: sigToHex(sig),
      tx_hash: txHash
    };
  }

  // ── encrypted keystore (WebCrypto) ────────────────────────────────────────
  function getSubtle() {
    var c = global.crypto || (global.msCrypto);
    if (!c || !c.subtle) {
      throw new Error('WebCrypto is unavailable (requires a secure https context).');
    }
    return c.subtle;
  }

  async function deriveAesKey(password, salt, iterations, usages) {
    var subtle = getSubtle();
    var baseKey = await subtle.importKey(
      'raw', utf8ToBytes(String(password)), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      usages
    );
  }

  async function encryptKeystore(priv, password) {
    if (!password || String(password).length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    var subtle = getSubtle();
    var salt = global.crypto.getRandomValues(new Uint8Array(16));
    var iv = global.crypto.getRandomValues(new Uint8Array(12));
    var aesKey = await deriveAesKey(password, salt, PBKDF2_ITERATIONS, ['encrypt']);
    var ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv }, aesKey, priv));
    return {
      v: 1,
      type: 'anet-web-keystore',
      address: addressFromPrivateKey(priv),
      kdf: 'PBKDF2',
      kdfparams: { iterations: PBKDF2_ITERATIONS, hash: 'SHA-256', salt: bytesToHex(salt), dklen: 32 },
      cipher: 'AES-GCM',
      cipherparams: { iv: bytesToHex(iv) },
      ciphertext: bytesToHex(ct),
      createdAt: Date.now()
    };
  }

  async function decryptKeystore(ks, password) {
    if (!ks || ks.cipher !== 'AES-GCM' || !ks.ciphertext) {
      throw new Error('Corrupt or unsupported keystore.');
    }
    var subtle = getSubtle();
    var salt = hexToBytes(ks.kdfparams.salt);
    var iv = hexToBytes(ks.cipherparams.iv);
    var iterations = ks.kdfparams.iterations || PBKDF2_ITERATIONS;
    var aesKey = await deriveAesKey(password, salt, iterations, ['decrypt']);
    var pt;
    try {
      pt = new Uint8Array(await subtle.decrypt(
        { name: 'AES-GCM', iv: iv }, aesKey, hexToBytes(ks.ciphertext)
      ));
    } catch (_) {
      throw new Error('Incorrect password.');
    }
    if (pt.length !== 32) {
      wipeBytes(pt);
      throw new Error('Decrypted key has an invalid length.');
    }
    return pt;
  }

  function loadVault() {
    try {
      var raw = global.localStorage.getItem(KEYSTORE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function saveVault(ks) {
    global.localStorage.setItem(KEYSTORE_KEY, JSON.stringify(ks));
  }

  // ── auto-lock ─────────────────────────────────────────────────────────────
  function clearAutoLock() {
    if (autoLockTimer) { clearTimeout(autoLockTimer); autoLockTimer = null; }
  }

  function armAutoLock() {
    clearAutoLock();
    if (unlockedKey && autoLockMs > 0) {
      autoLockTimer = setTimeout(function () { api.lock(); }, autoLockMs);
    }
  }

  function setUnlocked(priv) {
    if (unlockedKey) wipeBytes(unlockedKey);
    unlockedKey = priv;
    unlockedAddress = addressFromPrivateKey(priv);
    armAutoLock();
    notify(unlockListeners);
  }

  function requireUnlocked() {
    if (!unlockedKey) throw new Error('Wallet is locked. Unlock it to sign.');
    armAutoLock(); // signing counts as activity
  }

  // ── public API ────────────────────────────────────────────────────────────
  var api = {
    ANTS_PER_ANET: ANTS_PER_ANET,
    MIN_FEE_ANTS: MIN_FEE_ANTS,

    isAvailable: function () { return true; },

    /** Derive the ANET address from a secret without storing anything. */
    previewAddress: function (secret) {
      var priv = secretToPrivateKey(secret);
      var addr = addressFromPrivateKey(priv);
      wipeBytes(priv);
      return addr;
    },

    isValidAddress: function (addr) {
      var a = String(addr || '').trim().toUpperCase();
      return /^ANET[0-9A-F]{36}$/.test(a);
    },

    /** Is there an encrypted keystore saved in this browser? */
    hasVault: function () { return !!loadVault(); },

    /** Address recorded in the saved keystore (no unlock needed), or ''. */
    vaultAddress: function () {
      var ks = loadVault();
      return ks && ks.address ? String(ks.address).toUpperCase() : '';
    },

    isUnlocked: function () { return !!unlockedKey; },
    currentAddress: function () { return unlockedAddress; },

    /**
     * Import a secret. Always loads it into memory (unlocked). When persist is
     * true the key is encrypted with `password` and saved to localStorage so it
     * can be unlocked again later (MetaMask-style). When persist is false the
     * key lives only for this session.
     */
    importSecret: async function (opts) {
      opts = opts || {};
      var priv = secretToPrivateKey(opts.secret);
      var address = addressFromPrivateKey(priv);
      if (opts.persist) {
        var ks = await encryptKeystore(priv, opts.password);
        saveVault(ks);
      }
      setUnlocked(priv);
      return address;
    },

    /** Decrypt the saved keystore with `password` and unlock. */
    unlock: async function (password) {
      var ks = loadVault();
      if (!ks) throw new Error('No saved wallet on this device. Import one first.');
      var priv = await decryptKeystore(ks, password);
      setUnlocked(priv);
      return unlockedAddress;
    },

    /** Wipe the in-memory key (keystore stays on disk). */
    lock: function () {
      clearAutoLock();
      if (unlockedKey) wipeBytes(unlockedKey);
      unlockedKey = null;
      unlockedAddress = '';
      notify(lockListeners);
    },

    /** Remove the encrypted keystore from this device and lock. */
    forget: function () {
      try { global.localStorage.removeItem(KEYSTORE_KEY); } catch (_) {}
      api.lock();
    },

    /** Reveal the raw private key hex (requires the password). For backups. */
    revealPrivateKey: async function (password) {
      var ks = loadVault();
      if (!ks) throw new Error('No saved wallet on this device.');
      var priv = await decryptKeystore(ks, password);
      var hex = bytesToHex(priv);
      wipeBytes(priv);
      return hex;
    },

    /** Refresh the inactivity timer (call on user interaction). */
    touch: function () { if (unlockedKey) armAutoLock(); },
    setAutoLockMs: function (ms) { autoLockMs = ms | 0; armAutoLock(); },

    onLock: function (cb) { if (typeof cb === 'function') lockListeners.push(cb); },
    onUnlock: function (cb) { if (typeof cb === 'function') unlockListeners.push(cb); },

    /**
     * Sign a Layer-1 action authorization with the unlocked key.
     * Returns the `auth` object expected by the chain (POST bodies).
     */
    signAction: function (actionType, payload, chainId) {
      requireUnlocked();
      if (!chainId) throw new Error('chainId is required to sign.');
      return buildSignedActionWithKey(unlockedKey, unlockedAddress, actionType, payload, chainId);
    },

    /** Sign a native ANET transfer transaction with the unlocked key. */
    signTransfer: function (opts) {
      requireUnlocked();
      opts = opts || {};
      if (!opts.chainId) throw new Error('chainId is required to sign.');
      var fee = opts.feeAnts == null ? MIN_FEE_ANTS : opts.feeAnts;
      return buildSignedTransferWithKey(
        unlockedKey, unlockedAddress, opts.to, opts.amountAnts, opts.nonce, fee, opts.chainId, opts.payload
      );
    },

    // expose pure helpers for callers that build payloads/amounts
    canonicalJson: canonicalJson,
    addressFromSecret: function (secret) { return api.previewAddress(secret); }
  };

  global.AnetWallet = api;
})(typeof window !== 'undefined' ? window : this);
