// dex-onchain.js — fee engine, ABI encoding and Solana fee-account logic.
// Reference encodings come from ethers v6 (contracts workspace) and the
// compiled AnetFeeRouter artifact, so the browser's hand-rolled encoder is
// proven byte-for-byte compatible with the contract it calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deepEqual as looseDeepEqual } from 'node:assert'; // cross-realm (vm) structures
import { loadModules, loadEthers, feeRouterAbi } from './harness.mjs';

const ethers = await loadEthers();
const ctx = loadModules();
const api = ctx.AnetDexOnchain;
const T = api.__test;

const V2_ROUTER_ABI = [
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
];

const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const ANET = '0x791055A7d52AA392eaE8De04250497f33807E46A';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const USER = '0x1111111111111111111111111111111111111111';

test('module boots in a headless sandbox and exposes its public surface', () => {
  assert.ok(api, 'window.AnetDexOnchain missing');
  assert.equal(typeof api.setupSolanaFeeAccounts, 'function');
  assert.equal(typeof api.feeInfo, 'function');
  assert.ok(ctx.AnetPrices, 'legacy window.AnetPrices accessor must stay available for dex.js');
  assert.ok(ctx.AnetTerminal, 'terminal module must load alongside');
});

test('fee configuration matches the treasury wallets and the contract parameters', () => {
  assert.equal(api.FEE.evmTreasury, '0x9C7C1058fdc9b710f688ECb7562924D9AE771417');
  assert.equal(api.FEE.solTreasury, '7j33RFPkNvaKsPuz2qJ5SzwiwXA4iL12ujqM4g2tRLEz');
  assert.equal(api.FEE.numerator, 875n);
  assert.equal(api.FEE.denominator, 100_000n);
  assert.equal(api.FEE.pct, 0.875);
  assert.equal(api.FEE.solanaBps, 87, 'Jupiter only accepts whole bps; 0.875% rounds down in the user\'s favour');
  assert.ok(Number.isInteger(api.FEE.solanaBps));
  // the Solana treasury must be a valid 32-byte key
  const pk = new ctx.AnetSolana.PublicKey(api.FEE.solTreasury);
  assert.equal(pk.toBase58(), api.FEE.solTreasury);
});

test('splitFee reproduces AnetFeeRouter.quoteFee exactly', () => {
  const one = 10n ** 18n;
  const { feeUnits, swapIn } = T.splitFee(one);
  assert.equal(feeUnits, 8_750_000_000_000_000n);      // 0.00875 ether
  assert.equal(swapIn, 991_250_000_000_000_000n);
  assert.equal(feeUnits + swapIn, one);
  // rounds down like Solidity integer division
  looseDeepEqual(T.splitFee(1n), { feeUnits: 0n, swapIn: 1n });
  looseDeepEqual(T.splitFee(100_000n), { feeUnits: 875n, swapIn: 99_125n });
});

test('every hard-coded selector equals keccak256(signature)[0:4]', () => {
  for (const [sig, selector] of Object.entries(T.SELECTORS)) {
    assert.equal(selector, ethers.id(sig).slice(0, 10), `selector mismatch for ${sig}`);
  }
});

test('toUnits / fromUnits round-trip and reject garbage', () => {
  assert.equal(T.toUnits('1.5', 18), 1_500_000_000_000_000_000n);
  assert.equal(T.toUnits('0.000001', 6), 1n);
  assert.equal(T.toUnits('123', 0), 123n);
  assert.equal(T.toUnits('1e5', 18), 0n);
  assert.equal(T.toUnits('abc', 18), 0n);
  assert.equal(T.toUnits('.', 18), 0n);
  assert.equal(T.fromUnits(1_500_000_000_000_000_000n, 18), '1.5');
  assert.equal(T.fromUnits(1n, 6), '0.000001');
  assert.equal(T.fromUnits(0n, 18), '0');
  assert.equal(T.fromUnits(T.toUnits('0.00875', 18), 18), '0.00875');
});

test('slipFloor applies the slippage tolerance with 2-decimal precision', () => {
  assert.equal(T.slipFloor(10_000n, 2), 9_800n);
  assert.equal(T.slipFloor(10_000n, 0.5), 9_950n);
  assert.equal(T.slipFloor(10_000n, 12), 8_800n);
});

test('evmPath routes directly through the wrapped native or hops via it', () => {
  const dex = api.EVM_DEX[56];
  const toks = Object.fromEntries(api.ONCHAIN_TOKENS[56].map(t => [t.symbol, t]));
  looseDeepEqual(T.evmPath(56, toks.BNB, toks.ANET), [dex.wrapped, toks.ANET.addr]);
  looseDeepEqual(T.evmPath(56, toks.ANET, toks.BNB), [toks.ANET.addr, dex.wrapped]);
  looseDeepEqual(T.evmPath(56, toks.USDT, toks.ANET), [toks.USDT.addr, dex.wrapped, toks.ANET.addr]);
});

test('AnetFeeRouter calldata matches the compiled contract ABI (ethers reference)', () => {
  const iface = new ethers.Interface(feeRouterAbi());
  const deadline = 1_900_000_000n;
  const minOut = 123_456_789n;
  const amountIn = 5n * 10n ** 18n;

  // native → token
  let built = T.buildFeeRouterCalldata({ fromNative: true, toNative: false, amountIn, minOut, path: [WBNB, ANET], deadline });
  assert.equal(built.data, iface.encodeFunctionData('swapExactETHForTokens', [minOut, [WBNB, ANET], deadline]));
  assert.equal(built.value, amountIn, 'the full input is sent as value; the contract splits the fee');

  // token → native
  built = T.buildFeeRouterCalldata({ fromNative: false, toNative: true, amountIn, minOut, path: [ANET, WBNB], deadline });
  assert.equal(built.data, iface.encodeFunctionData('swapExactTokensForETH', [amountIn, minOut, [ANET, WBNB], deadline]));
  assert.equal(built.value, 0n);

  // token → token (3-hop path)
  built = T.buildFeeRouterCalldata({ fromNative: false, toNative: false, amountIn, minOut, path: [USDT, WBNB, ANET], deadline });
  assert.equal(built.data, iface.encodeFunctionData('swapExactTokensForTokens', [amountIn, minOut, [USDT, WBNB, ANET], deadline]));
});

test('public V2 router calldata (fallback path) matches the router ABI and pays the user', () => {
  const iface = new ethers.Interface(V2_ROUTER_ABI);
  const deadline = 1_900_000_000n, minOut = 777n, swapIn = 991_250_000_000_000_000n;

  let built = T.buildDexRouterCalldata({ fromNative: true, toNative: false, swapIn, minOut, path: [WBNB, ANET], to: USER, deadline });
  assert.equal(built.data, iface.encodeFunctionData('swapExactETHForTokensSupportingFeeOnTransferTokens', [minOut, [WBNB, ANET], USER, deadline]));
  assert.equal(built.value, swapIn, 'only the post-fee amount is swapped');

  built = T.buildDexRouterCalldata({ fromNative: false, toNative: true, swapIn, minOut, path: [ANET, WBNB], to: USER, deadline });
  assert.equal(built.data, iface.encodeFunctionData('swapExactTokensForETHSupportingFeeOnTransferTokens', [swapIn, minOut, [ANET, WBNB], USER, deadline]));

  built = T.buildDexRouterCalldata({ fromNative: false, toNative: false, swapIn, minOut, path: [USDT, WBNB, ANET], to: USER, deadline });
  assert.equal(built.data, iface.encodeFunctionData('swapExactTokensForTokensSupportingFeeOnTransferTokens', [swapIn, minOut, [USDT, WBNB, ANET], USER, deadline]));
});

test('cleanRevert extracts the venue revert reason', () => {
  assert.equal(T.cleanRevert('execution reverted: UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT'), 'UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT');
  assert.equal(T.cleanRevert('execution reverted'), 'execution reverted');
  assert.equal(T.cleanRevert('some RPC error'), 'some RPC error');
});

test('feeInfo reports the two-step fallback while no router is deployed, and in-swap on Solana', () => {
  assert.equal(api.FEE_ROUTER[56], '', 'router not deployed yet in this release');
  const bsc = api.feeInfo(56);
  assert.equal(bsc.atomic, false);
  assert.match(bsc.label, /0\.875%/);
  assert.match(bsc.label, /separate tx/);
  assert.equal(bsc.treasury, api.FEE.evmTreasury);
  const sol = api.feeInfo('solana');
  assert.equal(sol.atomic, true);
  assert.match(sol.label, /0\.87%/);
  assert.equal(sol.treasury, api.FEE.solTreasury);
});

test('verifyFeeRouter refuses a router whose on-chain parameters differ from the UI config', async () => {
  const addr = '0x2222222222222222222222222222222222222222';
  const mkFetch = (feeNum, treasury) => async (_url, init) => {
    const body = JSON.parse(init.body);
    const data = body.params[0].data;
    let result;
    if (data === T.SELECTORS['feeNumerator()']) result = '0x' + feeNum.toString(16).padStart(64, '0');
    else if (data === T.SELECTORS['treasury()']) result = '0x' + treasury.slice(2).toLowerCase().padStart(64, '0');
    else throw new Error('unexpected call ' + data);
    return { json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
  };
  const good = loadModules({ fetch: mkFetch(875n, api.FEE.evmTreasury) });
  good.AnetDexOnchain.FEE_ROUTER[56] = addr;
  assert.equal(await good.AnetDexOnchain.__test.verifyFeeRouter(56), true);
  assert.equal(good.AnetDexOnchain.feeInfo(56).atomic, true);
  assert.equal(good.AnetDexOnchain.feeInfo(56).router, addr);

  const wrongFee = loadModules({ fetch: mkFetch(1000n, api.FEE.evmTreasury) });
  wrongFee.AnetDexOnchain.FEE_ROUTER[56] = addr;
  const origErr = console.error; console.error = () => {};
  try {
    assert.equal(await wrongFee.AnetDexOnchain.__test.verifyFeeRouter(56), false);
    const wrongTreasury = loadModules({ fetch: mkFetch(875n, '0x3333333333333333333333333333333333333333') });
    wrongTreasury.AnetDexOnchain.FEE_ROUTER[56] = addr;
    assert.equal(await wrongTreasury.AnetDexOnchain.__test.verifyFeeRouter(56), false);
    assert.equal(wrongTreasury.AnetDexOnchain.feeInfo(56).atomic, false, 'must fall back to the two-step flow');
  } finally { console.error = origErr; }
});

test('Solana: treasury fee token accounts derive to the on-chain-verified ATAs', () => {
  const treasury = api.FEE.solTreasury;
  const mint = (sym) => api.SOL_TOKENS.find(t => t.symbol === sym).mint;
  assert.equal(T.SOL_TOKEN_PROGRAM, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  assert.equal(T.SOL_ATA_PROGRAM, 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  assert.equal(T.deriveAta(treasury, mint('SOL')),  'DNLFjU4yTt2W9HbEj2f5TsYLHGiVV5TCdxopw479AFhZ');
  assert.equal(T.deriveAta(treasury, mint('USDC')), '2cVCwf4beGya6KMJG4wMfp6ufdkdUYoFdrULqDAjwWax');
  assert.equal(T.deriveAta(treasury, mint('USDT')), 'D9PEa91U4QhiBE72J4dnvoWNpMs8arCJVrtFHGbhws6Q');
});

test('Solana: CreateIdempotent ATA instruction has the canonical account layout', () => {
  const payer = '7j33RFPkNvaKsPuz2qJ5SzwiwXA4iL12ujqM4g2tRLEz';
  const usdc = api.SOL_TOKENS.find(t => t.symbol === 'USDC').mint;
  const ix = T.ataCreateIdempotentIx(payer, api.FEE.solTreasury, usdc);
  assert.equal(ix.programId.toBase58(), T.SOL_ATA_PROGRAM);
  looseDeepEqual(Array.from(ix.data), [1]);
  const keys = ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]);
  looseDeepEqual(keys, [
    [payer, true, true],
    ['2cVCwf4beGya6KMJG4wMfp6ufdkdUYoFdrULqDAjwWax', false, true],
    [api.FEE.solTreasury, false, false],
    [usdc, false, false],
    ['11111111111111111111111111111111', false, false],
    [T.SOL_TOKEN_PROGRAM, false, false],
  ]);
  // The legacy Transaction accepts the plain-object instruction and compiles it.
  const tx = new ctx.AnetSolana.Transaction();
  tx.feePayer = new ctx.AnetSolana.PublicKey(payer);
  tx.recentBlockhash = '11111111111111111111111111111111';
  tx.add(ix);
  const msg = tx.compileMessage();
  assert.equal(msg.instructions.length, 1);
  assert.equal(msg.accountKeys.length, 6);
});

/* ── Funds check + approval reset (mocked RPC + wallet) ─────────────────── */
function mockChain({ native, tokenBal, allowance, gasPrice = 1_000_000_000n }) {
  const sent = [];
  const pad = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
    const answer = (b) => {
      if (b.method === 'eth_getBalance') return pad(native);
      if (b.method === 'eth_gasPrice') return '0x' + gasPrice.toString(16);
      if (b.method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0x10' };
      if (b.method === 'eth_call') {
        const data = b.params[0].data;
        if (data.startsWith('0x70a08231')) return pad(tokenBal);      // balanceOf
        if (data.startsWith('0xdd62ed3e')) return pad(allowance);     // allowance
      }
      throw new Error('unexpected ' + b.method);
    };
    if (Array.isArray(body)) return { json: async () => body.map(b => reply(b.id, answer(b))) };
    return { json: async () => reply(body.id, answer(body)) };
  };
  const c = loadModules({ fetch: fetchImpl });
  c.ethereum = { request: async ({ method, params }) => { if (method === 'eth_sendTransaction') { sent.push(params[0]); return '0x' + 'ab'.repeat(32); } throw new Error('unexpected ' + method); } };
  return { c, sent };
}

const USER2 = '0x1111111111111111111111111111111111111111';
const BNB = { symbol: 'BNB', native: true, decimals: 18 };
const ANET_TOK = { symbol: 'ANET', addr: ANET, decimals: 18 };

test('assertFunds blocks a native trade that could not afford the fee + swap gas (nothing is sent)', async () => {
  const { c } = mockChain({ native: 10n ** 18n, tokenBal: 0n, allowance: 0n });
  const F = c.AnetDexOnchain.__test;
  // 1 BNB balance: spending exactly 1 BNB across two transactions is impossible
  await assert.rejects(F.assertFunds(56, USER2, BNB, 10n ** 18n, 2), /Insufficient BNB[\s\S]*Nothing was sent/);
  // 0.9 BNB leaves ample headroom
  await F.assertFunds(56, USER2, BNB, 9n * 10n ** 17n, 2);
  // the reserve scales with gas price and never drops below the chain floor
  assert.ok(await F.gasReserve(56, 2) >= 1_000_000_000_000_000n);
  assert.ok(await F.gasReserve(1, 2) >= 4_000_000_000_000_000n);
});

test('assertFunds blocks an ERC-20 trade when the token balance or the gas balance is short', async () => {
  let m = mockChain({ native: 10n ** 18n, tokenBal: 5n * 10n ** 18n, allowance: 0n });
  await assert.rejects(m.c.AnetDexOnchain.__test.assertFunds(56, USER2, ANET_TOK, 6n * 10n ** 18n, 3), /Insufficient ANET balance/);
  await m.c.AnetDexOnchain.__test.assertFunds(56, USER2, ANET_TOK, 5n * 10n ** 18n, 3);
  m = mockChain({ native: 1_000n, tokenBal: 5n * 10n ** 18n, allowance: 0n });
  await assert.rejects(m.c.AnetDexOnchain.__test.assertFunds(56, USER2, ANET_TOK, 10n ** 18n, 3), /Not enough BNB for gas/);
});

test('ensureAllowance resets a stale non-zero allowance to 0 before approving (USDT-safe)', async () => {
  const spender = '0x9999999999999999999999999999999999999999';
  // stale allowance 5 < needed 10 → approve(0) then approve(10)
  let m = mockChain({ native: 10n ** 18n, tokenBal: 0n, allowance: 5n });
  await m.c.AnetDexOnchain.__test.ensureAllowance(56, ANET, USER2, spender, 10n, 'ANET', () => {});
  assert.equal(m.sent.length, 2);
  assert.equal(m.sent[0].data, '0x095ea7b3' + spender.slice(2).toLowerCase().padStart(64, '0') + '0'.repeat(64));
  assert.equal(m.sent[1].data, '0x095ea7b3' + spender.slice(2).toLowerCase().padStart(64, '0') + (10n).toString(16).padStart(64, '0'));
  // zero allowance → a single approve
  m = mockChain({ native: 10n ** 18n, tokenBal: 0n, allowance: 0n });
  await m.c.AnetDexOnchain.__test.ensureAllowance(56, ANET, USER2, spender, 10n, 'ANET', () => {});
  assert.equal(m.sent.length, 1);
  // sufficient allowance → nothing sent
  m = mockChain({ native: 10n ** 18n, tokenBal: 0n, allowance: 10n });
  await m.c.AnetDexOnchain.__test.ensureAllowance(56, ANET, USER2, spender, 10n, 'ANET', () => {});
  assert.equal(m.sent.length, 0);
});
