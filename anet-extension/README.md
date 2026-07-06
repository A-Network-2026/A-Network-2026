# ANET Wallet — browser extension

A non-custodial browser wallet for the **A Network Layer 1** (ANET / ANTS).
It reuses the exact key derivation and signing scheme the L1 verifies
(`assets/js/anet-wallet.js` + the vendored `@noble` crypto), so a wallet created
in the A Network app, the website, or this extension is the **same account**.

## What it does

- **Create / import** an ANET wallet (seed phrase or private key), encrypted on
  this device with your password (PBKDF2 + AES‑256‑GCM). The key never leaves the
  browser.
- **View balance** — live ANET / ANTS balance (and a USD estimate) from the L1
  explorer API.
- **Send / receive** native ANET (signs locally, broadcasts to `POST /transactions`).
- **Connect to dapps** — injects a standard `window.anet` provider so any website
  can request your address, balance, and signatures, with an approval popup.
- **Sell in MetaMask** — one‑click link to the DEX bridge flow (L1 ANET → wANET
  BEP‑20, 1:1), so your activated L1 coins can be sold on PancakeSwap with
  MetaMask.

> Note: MetaMask cannot hold native ANET (ANET L1 is not EVM). To use MetaMask,
> bridge L1 ANET → wANET first; this extension is the native ANET wallet.

## Install (developer / unpacked)

1. Open `chrome://extensions` (or `edge://extensions`, or Brave equivalent).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this `anet-extension/` folder.
4. Pin **ANET Wallet** and open it to create or import a wallet.

Firefox: use `about:debugging` → **This Firefox** → **Load Temporary Add‑on** and
pick `manifest.json` (MV3 support required).

## For dapp developers

```js
// Detect
if (window.anet) { /* ANET Wallet is installed */ }

// Connect (prompts the user)
const { address } = await window.anet.connect();

// Read
const bal = await window.anet.getBalance();      // { address, ants, anet }

// Ask the wallet to sign an L1 action (DEX swap, liquidity, etc.)
const auth = await window.anet.signAction('dex_swap', { /* payload */ });

// Native transfer (signs + broadcasts, returns the signed tx incl. tx_hash)
const tx = await window.anet.signTransfer({ to: 'ANET…', amountAnts: 100000000 });

window.anet.on('accountsChanged', (accts) => { /* … */ });
```

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest |
| `popup.html/.js/.css` | Wallet UI (create/import/unlock, balance, send/receive) |
| `background.js` | Service worker: routes dapp requests, opens approval windows |
| `content.js` | Injects the provider, relays page ↔ worker |
| `inpage.js` | `window.anet` provider (page context) |
| `approve.html/.js` | Connect / signature approval window (signing happens here) |
| `lib/anet-wallet.js` | ANET key derivation + signing (shared with the site) |
| `vendor/anet-crypto.bundle.js` | Vendored `@noble` secp256k1 / sha256 / ripemd160 |

## Security

- Private keys are encrypted at rest and only decrypted in memory to sign.
- The background service worker never sees the key; signing happens in the popup
  or the approval window, which own the encrypted vault.
- Only the **public address** is mirrored into extension storage so the worker
  can answer read requests.
- Update `lib/anet-wallet.js` / `vendor/` by re‑copying from the website whenever
  they change, so the derivation stays in lockstep with the L1.
