import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { read } from './harness.mjs';

function page({ sandbox = false, hostname = 'a-network.net' } = {}) {
  const elements = new Map();
  const requests = [];
  const setup = [];
  const scopes = [];
  let payments = 0;
  let mode = sandbox;
  function getElementById(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '', style: {}, classList: { toggle() {} }, addEventListener() {},
        querySelector: () => getElementById(id + '-submit')
      });
    }
    return elements.get(id);
  }
  const ctx = {
    URL, AbortController, setTimeout, clearTimeout, console,
    window: { location: { hostname, search: '?mode=prod', href: 'https://a-network.net/pi-testnet?mode=prod' } },
    document: { getElementById },
    fetch: async (url, options) => {
      requests.push({url, options});
      const body = url.endsWith('/config')
        ? {sdk:{sandbox:mode},policy:{requiredAmount:1}}
        : url.includes('/status/') ? {unlocked:true,paymentId:'test-unlock'} : {ok:true};
      return Response.json(body);
    }
  };
  ctx.window.Pi = ctx.Pi = {
    init: options => setup.push(options.sandbox),
    authenticate: async grants => {
      scopes.push([...grants]);
      return { user:{uid:'test-user',username:'pioneer'}, accessToken:'sample-token-that-must-stay-private' };
    },
    createPayment: async () => { payments++; return { identifier:'test-payment' }; }
  };
  vm.createContext(ctx);
  vm.runInContext(read('assets/js/pi-testnet.js'), ctx);
  return {
    ctx, get: getElementById, requests, setup, scopes,
    payments: () => payments,
    changeMode: value => { mode = value; }
  };
}

test('production backend leaves Pi test payments blocked and renders identity only', async () => {
  const app = page();
  await app.ctx.initializePiFromBackendConfig();
  assert.deepEqual(app.setup,[true]);
  assert.equal(app.get('payWithPiBtn').disabled,true);
  assert.match(app.get('sdkStatus').textContent,/production mode/);
  await app.ctx.authenticatePiUser();
  assert.deepEqual(app.scopes,[['username']]);
  assert.equal(app.get('authResult').textContent,'Signed in as @pioneer.');
  await app.ctx.runSimplePiPayment();
  assert.equal(app.payments(),0);
});

test('rechecks Testnet mode before opening a payment', async () => {
  const app = page({sandbox:true});
  await app.ctx.initializePiFromBackendConfig();
  assert.equal(app.get('payWithPiBtn').disabled,false);
  app.changeMode(false);
  await app.ctx.runSimplePiPayment();
  assert.equal(app.payments(),0);
  assert.equal(app.get('payWithPiBtn').disabled,true);
});

test('public quotes never send a signing secret and public execution stays disabled', async () => {
  const app = page({sandbox:true});
  await app.ctx.initializePiFromBackendConfig();
  await app.ctx.authenticatePiUser();
  app.get('senderSeed').value='test-signing-placeholder';
  app.get('traderWallet').value='ANET_TEST_WALLET';
  app.get('tokenSymbol').value='TEST';
  app.get('amountIn').value='2';
  assert.equal(app.get('signingSecretField').hidden,true);
  assert.equal(app.get('dexForm-submit').disabled,true);
  await app.ctx.requestDexQuote();
  const quote=app.requests.find(item=>item.url.endsWith('/quote'));
  assert.equal(JSON.parse(quote.options.body).sender_seed,undefined);
  await app.ctx.submitDexSwap({preventDefault(){}});
  assert.equal(app.requests.some(item=>item.url.endsWith('/execute')),false);
});
