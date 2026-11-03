// Loads the browser modules (dex-terminal.js, dex-onchain.js and the vendored
// Solana bundle) into a Node `vm` sandbox with minimal DOM/network stubs so
// their pure functions can be unit-tested with `node --test`.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
export { ROOT };

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

/**
 * @param {object} opts
 * @param {boolean} [opts.solana]  load the vendored @solana/web3.js bundle (default true)
 * @param {Function} [opts.fetch]  fetch stub; defaults to "network disabled"
 */
export function loadModules(opts = {}) {
  const fetchImpl = opts.fetch || (async () => { throw new Error('network disabled in tests'); });
  const ctx = {
    console,
    TextEncoder, TextDecoder, Uint8Array, URL, URLSearchParams,
    setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    crypto: globalThis.crypto,
    navigator: {},
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    fetch: fetchImpl,
    localStorage: memoryStorage(),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    ResizeObserver: undefined,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: {
      readyState: 'complete',
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      documentElement: {},
    },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = () => {};
  ctx.dispatchEvent = () => true;
  ctx.devicePixelRatio = 1;
  vm.createContext(ctx);
  if (opts.solana !== false) vm.runInContext(read('assets/js/vendor/anet-solana.bundle.js'), ctx, { filename: 'anet-solana.bundle.js' });
  if (opts.wallet) {
    vm.runInContext(read('assets/js/vendor/anet-crypto.bundle.js'), ctx, { filename: 'anet-crypto.bundle.js' });
    vm.runInContext(read('assets/js/anet-wallet.js'), ctx, { filename: 'anet-wallet.js' });
  }
  vm.runInContext(read('assets/js/dex-terminal.js'), ctx, { filename: 'dex-terminal.js' });
  vm.runInContext(read('assets/js/dex-onchain.js'), ctx, { filename: 'dex-onchain.js' });
  if (opts.bridge !== false) vm.runInContext(read('assets/js/dex-bridge.js'), ctx, { filename: 'dex-bridge.js' });
  if (opts.reserves) vm.runInContext(read('assets/js/reserves.js'), ctx, { filename: 'reserves.js' });
  return ctx;
}

/** ethers v6 from the contracts workspace (reference ABI encoder for the tests). */
export async function loadEthers() {
  const { createRequire } = await import('node:module');
  const req = createRequire(path.join(ROOT, 'contracts', 'package.json'));
  return req('ethers');
}

export function feeRouterAbi() {
  const rel = 'contracts/artifacts/src/AnetFeeRouter.sol/AnetFeeRouter.json';
  if (!fs.existsSync(path.join(ROOT, rel))) {
    throw new Error(`${rel} not found — run "cd contracts && npm ci && npx hardhat compile" first (artifacts are git-ignored).`);
  }
  const art = JSON.parse(read(rel));
  return art.abi;
}
