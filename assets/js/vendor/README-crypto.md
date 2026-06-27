# Vendored crypto for the A Network web DEX

`anet-crypto.bundle.js` is a **vendored, audited, zero-dependency** crypto bundle
used by [`assets/js/anet-wallet.js`](../anet-wallet.js) to derive ANET addresses
and sign Layer‑1 actions **entirely in the browser** (no key ever leaves the
device). It is loaded as a plain `<script>` (the site CSP is `script-src 'self'`,
so external CDNs are not allowed — the library must be self-hosted).

It exposes a single global:

```js
window.AnetNoble = {
  secp256k1,      // @noble/curves/secp256k1
  sha256,         // @noble/hashes/sha256
  ripemd160,      // @noble/hashes/ripemd160
  bytesToHex, hexToBytes, utf8ToBytes, concatBytes, // @noble/hashes/utils
};
```

## Sources (pinned)

| Package          | Version | License | Upstream |
|------------------|---------|---------|----------|
| `@noble/curves`  | 1.6.0   | MIT     | https://github.com/paulmillr/noble-curves |
| `@noble/hashes`  | 1.5.0   | MIT     | https://github.com/paulmillr/noble-hashes |

These are widely audited libraries (the same primitives used by ethers.js v6,
viem, and others).

## Rebuild

```bash
mkdir -p /tmp/anet-crypto-build && cd /tmp/anet-crypto-build
npm init -y
npm install @noble/curves@1.6.0 @noble/hashes@1.5.0 esbuild@0.24.0

cat > entry.js <<'JS'
export { secp256k1 } from '@noble/curves/secp256k1';
export { sha256 } from '@noble/hashes/sha256';
export { ripemd160 } from '@noble/hashes/ripemd160';
export { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils';
JS

npx esbuild entry.js --bundle --format=iife --global-name=AnetNoble \
  --minify --legal-comments=inline --outfile=anet-crypto.bundle.js
```

Then prepend the provenance header (see the top of the committed file) and copy
the result to `assets/js/vendor/anet-crypto.bundle.js`.

## Why these primitives

The ANET L1 derives addresses and verifies signed actions as:

- `privkey = SHA256(utf8(seed))` (or a raw 32‑byte secp256k1 key for imported wallets)
- `address = "ANET" + HEX_UPPER(RIPEMD160(compressed_secp256k1_pubkey))[..36]`
- action hash = `SHA256("action-v1|<type>|<WALLET>|<nonce>|<ts_ms>|<chain_id>|<canonical_payload>")`
- signature = recoverable secp256k1 over that 32‑byte hash, **low‑S (EIP‑2)**,
  encoded as `r(32) || s(32) || recovery(1)` hex.

This must stay byte‑for‑byte compatible with `anet-chain/src/transaction.rs`
(`verify_signed_action_authorization`) and the mobile app
(`main.dart` `_buildSignedActionAuthFromKey`).
