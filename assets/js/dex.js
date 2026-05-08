/**
 * A Network — Native DEX
 * dex.js  |  v1.0  |  2026
 *
 * Connects to the ANET L1 chain DEX API at explorer.a-network.net
 * and supports EVM wallet connection via MetaMask / window.ethereum.
 */

'use strict';

/* ── Constants ──────────────────────────────── */
const CHAIN_API = 'https://explorer.a-network.net';
const ANTS_PER_ANET = 100_000_000;  // 1 ANET = 10^8 ants

const EVM_CHAINS = {
  1:       { name: 'Ethereum',       symbol: 'ETH',   color: '#627EEA', rpc: 'https://cloudflare-eth.com',                      explorer: 'https://etherscan.io' },
  56:      { name: 'BNB Chain',      symbol: 'BNB',   color: '#F0B90B', rpc: 'https://bsc-dataseed.binance.org/',               explorer: 'https://bscscan.com' },
  137:     { name: 'Polygon',        symbol: 'MATIC', color: '#8247E5', rpc: 'https://polygon-rpc.com/',                        explorer: 'https://polygonscan.com' },
  8453:    { name: 'Base',           symbol: 'ETH',   color: '#0052FF', rpc: 'https://mainnet.base.org/',                       explorer: 'https://basescan.org' },
  42161:   { name: 'Arbitrum One',   symbol: 'ETH',   color: '#28A0F0', rpc: 'https://arb1.arbitrum.io/rpc',                    explorer: 'https://arbiscan.io' },
  43114:   { name: 'Avalanche',      symbol: 'AVAX',  color: '#E84142', rpc: 'https://api.avax.network/ext/bc/C/rpc',           explorer: 'https://snowtrace.io' },
  10:      { name: 'Optimism',       symbol: 'ETH',   color: '#FF0420', rpc: 'https://mainnet.optimism.io',                     explorer: 'https://optimistic.etherscan.io' },
  324:     { name: 'zkSync Era',     symbol: 'ETH',   color: '#8C8DFC', rpc: 'https://mainnet.era.zksync.io',                   explorer: 'https://explorer.zksync.io' },
  250:     { name: 'Fantom',         symbol: 'FTM',   color: '#1969FF', rpc: 'https://rpc.ftm.tools/',                          explorer: 'https://ftmscan.com' },
  25:      { name: 'Cronos',         symbol: 'CRO',   color: '#002D74', rpc: 'https://evm.cronos.org',                          explorer: 'https://cronoscan.com' },
  59144:   { name: 'Linea',          symbol: 'ETH',   color: '#61DFFF', rpc: 'https://rpc.linea.build',                         explorer: 'https://lineascan.build' },
  1101:    { name: 'Polygon zkEVM',  symbol: 'ETH',   color: '#7B3FE4', rpc: 'https://zkevm-rpc.com',                           explorer: 'https://zkevm.polygonscan.com' },
};

/* Per-chain token lists with real contract addresses.
   Used to populate the bridge token dropdown dynamically. */
const CHAIN_TOKENS = {
  1: [ // Ethereum
    { symbol: 'ETH',   name: 'Ether',            native: true,  decimals: 18 },
    { symbol: 'USDC',  name: 'USD Coin',          addr: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'USDT',  name: 'Tether USD',        addr: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'WBTC',  name: 'Wrapped Bitcoin',   addr: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
    { symbol: 'DAI',   name: 'Dai Stablecoin',    addr: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
    { symbol: 'LINK',  name: 'Chainlink',         addr: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18 },
  ],
  56: [ // BNB Chain
    { symbol: 'BNB',   name: 'BNB',               native: true,  decimals: 18 },
    { symbol: 'USDT',  name: 'Tether USD (BEP20)',addr: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { symbol: 'USDC',  name: 'USD Coin (BEP20)',  addr: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    { symbol: 'BTCB',  name: 'Bitcoin BEP20',     addr: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18 },
    { symbol: 'BUSD',  name: 'Binance USD',       addr: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18 },
    { symbol: 'WBNB',  name: 'Wrapped BNB',       addr: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
  ],
  137: [ // Polygon
    { symbol: 'MATIC', name: 'Polygon',            native: true,  decimals: 18 },
    { symbol: 'USDC',  name: 'USD Coin (PoS)',     addr: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6 },
    { symbol: 'USDT',  name: 'Tether USD (PoS)',   addr: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    { symbol: 'WBTC',  name: 'Wrapped Bitcoin',    addr: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', decimals: 8 },
    { symbol: 'DAI',   name: 'Dai (PoS)',          addr: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals: 18 },
    { symbol: 'WETH',  name: 'Wrapped Ether',      addr: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 },
  ],
  8453: [ // Base
    { symbol: 'ETH',   name: 'Ether',              native: true,  decimals: 18 },
    { symbol: 'USDC',  name: 'USD Coin (Base)',     addr: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    { symbol: 'USDT',  name: 'Tether USD (Base)',   addr: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
    { symbol: 'DAI',   name: 'Dai (Base)',          addr: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18 },
    { symbol: 'WETH',  name: 'Wrapped Ether',       addr: '0x4200000000000000000000000000000000000006', decimals: 18 },
  ],
  42161: [ // Arbitrum One
    { symbol: 'ETH',   name: 'Ether',              native: true,  decimals: 18 },
    { symbol: 'USDC',  name: 'USD Coin (Arbitrum)',addr: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    { symbol: 'USDT',  name: 'Tether USD (Arb)',   addr: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    { symbol: 'WBTC',  name: 'Wrapped Bitcoin',    addr: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8 },
    { symbol: 'DAI',   name: 'Dai (Arbitrum)',     addr: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
    { symbol: 'ARB',   name: 'Arbitrum Token',     addr: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18 },
  ],
  43114: [ // Avalanche
    { symbol: 'AVAX',  name: 'Avalanche',          native: true,  decimals: 18 },
    { symbol: 'USDC',  name: 'USD Coin (Avax)',    addr: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
    { symbol: 'USDT',  name: 'Tether USD (Avax)',  addr: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
    { symbol: 'WBTC',  name: 'Wrapped Bitcoin',    addr: '0x50b7545627a5162F82A992c33b87aDc75187B218', decimals: 8 },
    { symbol: 'DAI',   name: 'Dai.e (Avax)',       addr: '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70', decimals: 18 },
  ],
  10: [ // Optimism
    { symbol: 'ETH',   name: 'Ether',              native: true,  decimals: 18 },
    { symbol: 'USDC',  name: 'USD Coin (Optimism)',addr: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
    { symbol: 'USDT',  name: 'Tether USD (OP)',    addr: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
    { symbol: 'DAI',   name: 'Dai (Optimism)',     addr: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
    { symbol: 'OP',    name: 'Optimism Token',     addr: '0x4200000000000000000000000000000000000042', decimals: 18 },
    { symbol: 'WBTC',  name: 'Wrapped Bitcoin',    addr: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', decimals: 8 },
  ],
  324: [ // zkSync Era
    { symbol: 'ETH',   name: 'Ether',              native: true,  decimals: 18 },
    { symbol: 'USDC',  name: 'USD Coin (zkSync)',  addr: '0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf', decimals: 6 },
    { symbol: 'USDT',  name: 'Tether USD (zkSync)',addr: '0x493257fD37EDB34451f62EDf8D2a0C418852bA4c', decimals: 6 },
    { symbol: 'WBTC',  name: 'Wrapped Bitcoin',    addr: '0xBBeB516fb02a01611cBBE0453Fe3c580D7281011', decimals: 8 },
  ],
  250: [ // Fantom
    { symbol: 'FTM',   name: 'Fantom',             native: true,  decimals: 18 },
    { symbol: 'USDC',  name: 'USD Coin (Fantom)',  addr: '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75', decimals: 6 },
    { symbol: 'USDT',  name: 'Tether USD (FTM)',   addr: '0x049d68029688eAbF473097a2fC38ef61633A3C7A', decimals: 6 },
    { symbol: 'WBTC',  name: 'Wrapped Bitcoin',    addr: '0x321162Cd933E2Be498Cd2267a90534A804051b11', decimals: 8 },
    { symbol: 'DAI',   name: 'Dai (Fantom)',       addr: '0x8D11eC38a3EB5E956B052f67Da8Bdc9bef8Abf3E', decimals: 18 },
  ],
  25: [ // Cronos
    { symbol: 'CRO',   name: 'Cronos',             native: true,  decimals: 18 },
    { symbol: 'USDC',  name: 'USD Coin (CRC20)',   addr: '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59', decimals: 6 },
    { symbol: 'USDT',  name: 'Tether USD (CRC20)', addr: '0x66e428c3f67a68878562e79A0234c1F83c208770', decimals: 6 },
    { symbol: 'WBTC',  name: 'Wrapped Bitcoin',    addr: '0x062E66477Faf219F25D27dCED647BF57C3107d52', decimals: 8 },
  ],
  59144: [ // Linea
    { symbol: 'ETH',   name: 'Ether',              native: true,  decimals: 18 },
    { symbol: 'USDC',  name: 'USD Coin (Linea)',   addr: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff', decimals: 6 },
    { symbol: 'USDT',  name: 'Tether USD (Linea)', addr: '0xA219439258ca9da29E9Cc4cE5596924745e12B93', decimals: 6 },
  ],
  1101: [ // Polygon zkEVM
    { symbol: 'ETH',   name: 'Ether',              native: true,  decimals: 18 },
    { symbol: 'USDC',  name: 'USD Coin (zkEVM)',   addr: '0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035', decimals: 6 },
    { symbol: 'USDT',  name: 'Tether USD (zkEVM)', addr: '0x1E4a5963aBFD975d8c9021ce480b42188849D41d', decimals: 6 },
  ],
};

const KNOWN_TOKENS = [
  { symbol: 'ANET',  name: 'A Network Coin',       chain: 'L1',    decimals: 8,  native: true },
  { symbol: 'WBNB',  name: 'Wrapped BNB',          chain: 'BNB',   decimals: 8 },
  { symbol: 'WETH',  name: 'Wrapped Ether',        chain: 'ETH',   decimals: 8 },
  { symbol: 'USDT',  name: 'Tether USD',           chain: 'Multi', decimals: 8 },
  { symbol: 'USDC',  name: 'USD Coin',             chain: 'Multi', decimals: 8 },
  { symbol: 'DAI',   name: 'Dai Stablecoin',       chain: 'Multi', decimals: 8 },
  { symbol: 'BUSD',  name: 'Binance USD',          chain: 'BNB',   decimals: 8 },
  { symbol: 'PI',    name: 'Pi Coin',              chain: 'DEX',   decimals: 8 },
  { symbol: 'WBTC',  name: 'Wrapped Bitcoin',      chain: 'Multi', decimals: 8 },
  { symbol: 'BTCB',  name: 'Bitcoin BEP20',        chain: 'BNB',   decimals: 8 },
  { symbol: 'AVAX',  name: 'Avalanche',            chain: 'AVAX',  decimals: 8 },
  { symbol: 'MATIC', name: 'Polygon',              chain: 'MATIC', decimals: 8 },
  { symbol: 'FTM',   name: 'Fantom',               chain: 'FTM',   decimals: 8 },
  { symbol: 'CRO',   name: 'Cronos',               chain: 'CRO',   decimals: 8 },
  { symbol: 'OP',    name: 'Optimism Token',       chain: 'OP',    decimals: 8 },
  { symbol: 'ARB',   name: 'Arbitrum Token',       chain: 'ARB',   decimals: 8 },
  { symbol: 'LINK',  name: 'Chainlink',            chain: 'Multi', decimals: 8 },
];

const TOKEN_COLORS = {
  ANET: '#58c5ff', WBNB: '#F0B90B', WETH: '#627EEA', USDT: '#26A17B',
  USDC: '#2775CA', DAI:  '#F5AC37', BUSD: '#F0B90B', PI:   '#9C4FE6',
  WBTC: '#F7931A', BTCB: '#F7931A', AVAX: '#E84142', MATIC:'#8247E5',
  FTM:  '#1969FF', CRO:  '#002D74', OP:   '#FF0420', ARB:  '#28A0F0',
  LINK: '#2A5ADA', BNB:  '#F0B90B', ETH:  '#627EEA',
};

/* ── App state ──────────────────────────────── */
const state = {
  // ANET wallet (in-memory only, never persisted)
  anetWallet: { address: '', seedPhrase: '', balance: null },

  // EVM wallet
  evmWallet: { address: '', chainId: null, balance: null },

  // DEX state
  pools: [],
  selectedPool: null,
  fromToken: 'ANET',
  toToken: null,       // derived from selected pool / any loaded pool
  fromAmount: '',
  quote: null,
  slippage: 1.0,       // percent

  // UI
  activeTab: 'swap',
  bridgeDirection: 'evm_to_anet',  // 'evm_to_anet' | 'anet_to_evm'
  selectedBridgeChain: 56,          // BNB Chain default
  marketPair: '',
  recentLocalTrades: [],
  chainTxs: [],
  miniPriceSeries: {},
  loading: false,
};

/* ── Utility helpers ────────────────────────── */
function ants2anet(ants) { return (Number(ants) / ANTS_PER_ANET).toFixed(8); }
function anet2ants(anet) { return Math.round(parseFloat(anet) * ANTS_PER_ANET); }

function fmt(num, decimals = 4) {
  if (num == null || isNaN(num)) return '—';
  const n = Number(num);
  if (n === 0) return '0';
  if (n < 0.0001 && n > 0) return n.toExponential(4);
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

function shortAddr(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function tokenInitials(sym) {
  return (sym || '?').slice(0, 3);
}

function tokenColor(sym) {
  return TOKEN_COLORS[sym?.toUpperCase()] || '#58c5ff';
}

function tokenIconEl(sym, size = 22) {
  const color = tokenColor(sym);
  const el = document.createElement('div');
  el.className = 'token-icon-placeholder';
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.fontSize = Math.floor(size * 0.38) + 'px';
  el.style.background = `linear-gradient(135deg, ${color}, ${color}88)`;
  el.textContent = tokenInitials(sym);
  return el;
}

/* ── Toast notifications ────────────────────── */
function toast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = 'all 0.3s'; setTimeout(() => t.remove(), 300); }, duration);
}

/* ── API layer ──────────────────────────────── */
async function apiFetch(path, options = {}) {
  const url = CHAIN_API + path;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
}

async function loadPools() {
  try {
    const data = await apiFetch('/dex/pools');
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('loadPools:', e);
    return [];
  }
}

async function getSwapQuote({ tokenSymbol, amountIn, anetToToken }) {
  return apiFetch('/dex/swap/quote', {
    method: 'POST',
    body: JSON.stringify({ token_symbol: tokenSymbol, amount_in: amountIn, anet_to_token: anetToToken }),
  });
}

async function executeSwap({ trader, senderSeed, tokenSymbol, amountIn, anetToToken }) {
  return apiFetch('/dex/swap/execute', {
    method: 'POST',
    body: JSON.stringify({
      trader,
      sender_seed: senderSeed,
      token_symbol: tokenSymbol,
      amount_in: amountIn,
      anet_to_token: anetToToken,
    }),
  });
}

async function addLiquidity({ provider, senderSeed, tokenSymbol, anetAmountAnts, tokenAmountUnits }) {
  return apiFetch('/dex/pools/add-liquidity', {
    method: 'POST',
    body: JSON.stringify({
      provider,
      sender_seed: senderSeed,
      token_symbol: tokenSymbol,
      anet_amount_ants: anetAmountAnts,
      token_amount_units: tokenAmountUnits,
    }),
  });
}

async function createPool({ provider, senderSeed, tokenSymbol, anetAmountAnts, tokenAmountUnits, feeBps }) {
  return apiFetch('/dex/pools/create', {
    method: 'POST',
    body: JSON.stringify({
      provider,
      sender_seed: senderSeed,
      token_symbol: tokenSymbol,
      anet_amount_ants: anetAmountAnts,
      token_amount_units: tokenAmountUnits,
      fee_bps: feeBps,
    }),
  });
}

async function getAccount(address) {
  return apiFetch(`/accounts/${address}`);
}

/* ── EVM Wallet (MetaMask) ──────────────────── */
async function connectEvmWallet() {
  if (!window.ethereum) {
    toast('MetaMask not detected. Please install MetaMask.', 'error');
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    state.evmWallet.address = accounts[0];
    const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
    state.evmWallet.chainId = parseInt(chainIdHex, 16);
    await refreshEvmBalance();
    updateEvmWalletUI();
    toast('EVM wallet connected', 'success');
  } catch (e) {
    toast(e.message || 'Failed to connect wallet', 'error');
  }
}

async function refreshEvmBalance() {
  if (!state.evmWallet.address || !window.ethereum) return;
  try {
    const balHex = await window.ethereum.request({
      method: 'eth_getBalance',
      params: [state.evmWallet.address, 'latest'],
    });
    state.evmWallet.balance = parseInt(balHex, 16) / 1e18;
    updateEvmWalletUI();
  } catch (_) {}
}

function updateEvmWalletUI() {
  const btn = document.getElementById('evm-wallet-btn');
  if (!btn) return;
  const { address, chainId, balance } = state.evmWallet;
  if (!address) {
    btn.innerHTML = `<span class="dot"></span><span>Connect EVM Wallet</span>`;
    btn.className = 'wallet-btn';
  } else {
    const chain = EVM_CHAINS[chainId];
    const sym = chain ? chain.symbol : 'ETH';
    btn.innerHTML = `<span class="dot"></span><span class="addr">${shortAddr(address)}</span><span style="color:var(--muted-2);">${balance != null ? fmt(balance, 4) + ' ' + sym : ''}</span>`;
    btn.className = 'wallet-btn connected';
  }
  // propagate to bridge/swap UI
  updateBridgeWalletDisplay();
}

/* EVM chain switching */
async function switchEvmChain(chainId) {
  if (!window.ethereum) return;
  const chainHex = '0x' + chainId.toString(16);
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] });
    state.evmWallet.chainId = chainId;
    await refreshEvmBalance();
    updateEvmWalletUI();
  } catch (e) {
    if (e.code === 4902) {
      const cfg = EVM_CHAINS[chainId];
      if (!cfg) return;
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: chainHex, chainName: cfg.name, rpcUrls: [cfg.rpc], nativeCurrency: { name: cfg.symbol, symbol: cfg.symbol, decimals: 18 } }],
        });
        state.evmWallet.chainId = chainId;
        await refreshEvmBalance();
        updateEvmWalletUI();
      } catch (err) {
        toast(err.message || 'Failed to add chain', 'error');
      }
    }
  }
}

/* ── ANET Wallet ────────────────────────────── */
function openAnetWalletModal() {
  const overlay = document.getElementById('anet-wallet-modal');
  if (overlay) overlay.classList.add('open');
}

function closeAnetWalletModal() {
  const overlay = document.getElementById('anet-wallet-modal');
  if (overlay) overlay.classList.remove('open');
}

async function connectAnetWallet() {
  const address = document.getElementById('anet-address-input')?.value?.trim();
  const seed = document.getElementById('anet-seed-input')?.value?.trim();
  if (!address) { toast('Please enter your ANET wallet address', 'error'); return; }
  if (!seed)    { toast('Please enter your seed phrase', 'error'); return; }

  try {
    const acct = await getAccount(address);
    state.anetWallet.address = address;
    state.anetWallet.seedPhrase = seed;
    state.anetWallet.balance = acct.ants_balance != null ? Number(acct.ants_balance) : null;
    updateAnetWalletUI();
    closeAnetWalletModal();
    toast('ANET wallet connected', 'success');
  } catch (e) {
    toast(e.message || 'Failed to verify ANET account', 'error');
  }
}

function disconnectAnetWallet() {
  state.anetWallet = { address: '', seedPhrase: '', balance: null };
  updateAnetWalletUI();
  toast('ANET wallet disconnected', 'info');
}

function updateAnetWalletUI() {
  const btn = document.getElementById('anet-wallet-btn');
  if (!btn) return;
  const { address, balance } = state.anetWallet;
  if (!address) {
    btn.innerHTML = `<span class="dot"></span><span>Connect ANET Wallet</span>`;
    btn.className = 'wallet-btn';
  } else {
    const anet = balance != null ? ants2anet(balance) : '—';
    btn.innerHTML = `<span class="dot"></span><span class="addr">${shortAddr(address)}</span><span style="color:var(--muted-2);">${fmt(parseFloat(anet), 4)} ANET</span>`;
    btn.className = 'wallet-btn connected';
  }
  // update balance displays in swap/liq UI
  updateSwapFromBalance();
  updateBridgeWalletDisplay();
  // Hide wallet hint once ANET wallet is connected
  const hint = document.getElementById('wallet-hint');
  if (hint) hint.style.display = state.anetWallet.address ? 'none' : 'block';
  // keep cashout panel in sync if it's visible
  if (state.activeTab === 'cashout') initCashoutTab();
}

/* ── Tab navigation ─────────────────────────── */
function setTab(name) {
  state.activeTab = name;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'markets') {
    renderMarketsTable();
    renderMarketMicrostructure();
    refreshMarketActivity();
  }
  if (name === 'liquidity')   renderLiquidityPools();
  if (name === 'multichain')  renderMultiChainTab();
  if (name === 'cashout')     initCashoutTab();
}

/* ── Cash Out tab ───────────────────────────── */
function initCashoutTab() {
  // Sync wallet state into the cashout panel
  const addrEl   = document.getElementById('co-anet-addr');
  const balEl    = document.getElementById('co-anet-balance');
  const pillEl   = document.getElementById('co-wallet-status-pill');
  const btnEl    = document.getElementById('co-connect-btn');
  const step1    = document.getElementById('cstep-1');
  const step2    = document.getElementById('cstep-2');

  if (state.anetWallet.address) {
    if (addrEl) addrEl.textContent = state.anetWallet.address;
    if (balEl)  balEl.textContent  = fmt(state.anetWallet.balance / ANTS_PER_ANET, 4);
    if (pillEl) { pillEl.textContent = 'Connected'; pillEl.className = 'pill live green'; }
    if (btnEl)  { btnEl.textContent = 'Wallet Connected ✓'; btnEl.disabled = true; }
    if (step1)  step1.classList.add('done');
    if (step2)  step2.classList.add('active');
  } else {
    if (addrEl) addrEl.textContent = '—';
    if (balEl)  balEl.textContent  = '—';
    if (pillEl) { pillEl.textContent = 'Not connected'; pillEl.className = 'pill'; }
    if (btnEl)  { btnEl.textContent = 'Connect ANET Wallet'; btnEl.disabled = false; }
    if (step1)  step1.classList.remove('done');
    if (step2)  step2.classList.remove('active');
  }
}

let _cashoutQuoteTimer = null;
async function getCashoutQuote() {
  const amtEl    = document.getElementById('co-anet-in');
  const stableEl = document.getElementById('co-stable-token');
  const qBox     = document.getElementById('co-quote-box');
  const recvEl   = document.getElementById('co-receive-amt');
  const feeEl    = document.getElementById('co-fee-amt');
  const impEl    = document.getElementById('co-impact');
  const swapBtn  = document.getElementById('co-swap-btn');

  if (!amtEl || !stableEl) return;
  const amt = parseFloat(amtEl.value);
  if (isNaN(amt) || amt <= 0) {
    if (qBox)    qBox.style.display = 'none';
    if (swapBtn) { swapBtn.disabled = true; swapBtn.textContent = 'Get a quote first'; }
    return;
  }

  // debounce 450ms
  clearTimeout(_cashoutQuoteTimer);
  _cashoutQuoteTimer = setTimeout(async () => {
    if (swapBtn) { swapBtn.disabled = true; swapBtn.textContent = 'Getting quote…'; }
    try {
      const q = await getSwapQuote({ tokenSymbol: stableEl.value, amountIn: anet2ants(amt), anetToToken: true });
      const amtOut  = parseInt(q.amount_out  || 0) / ANTS_PER_ANET;
      const fee     = parseInt(q.fee_charged || 0) / ANTS_PER_ANET;
      const impact  = parseFloat(q.price_impact_pct || 0).toFixed(2);

      if (recvEl)  recvEl.textContent = `${fmt(amtOut, 4)} ${stableEl.value}`;
      if (feeEl)   feeEl.textContent  = `${fmt(fee, 6)} ${stableEl.value}`;
      if (impEl)   { impEl.textContent = `${impact}%`; impEl.style.color = parseFloat(impact) > 2 ? 'var(--warn)' : ''; }
      if (qBox)    qBox.style.display  = 'flex';
      if (swapBtn) {
        swapBtn.disabled    = !state.anetWallet.address;
        swapBtn.textContent = state.anetWallet.address
          ? `Swap ${fmt(amt,4)} ANET → ${fmt(amtOut,4)} ${stableEl.value}`
          : 'Connect wallet first';
      }
      // cache quote for doCashout
      state._cashoutQuote = { amt, amtOut, stable: stableEl.value };
    } catch (e) {
      if (qBox)    qBox.style.display = 'none';
      if (swapBtn) { swapBtn.disabled = true; swapBtn.textContent = e.message || 'Quote failed'; }
    }
  }, 450);
}

function setCashoutMax() {
  const amtEl = document.getElementById('co-anet-in');
  if (!amtEl) return;
  const bal = state.anetWallet.balance / ANTS_PER_ANET;
  if (!bal || bal <= 0) { toast('Connect your ANET wallet first', 'error'); return; }
  // Leave a tiny buffer for any chain fees (ANET L1 fees are negligible but good practice)
  amtEl.value = fmt(Math.max(0, bal - 0.001), 8);
  getCashoutQuote();
}

async function doCashout() {
  if (!state.anetWallet.address || !state.anetWallet.seedPhrase) {
    openAnetWalletModal();
    return;
  }
  if (!state._cashoutQuote) { toast('Get a quote first', 'error'); return; }

  const { amt, stable } = state._cashoutQuote;
  if (!amt || amt <= 0) { toast('Invalid amount', 'error'); return; }

  const btn      = document.getElementById('co-swap-btn');
  const statusEl = document.getElementById('co-swap-status');

  btn.disabled    = true;
  btn.textContent = 'Swapping…';
  if (statusEl) { statusEl.className = 'swap-status show loading'; statusEl.innerHTML = '<span class="spinner"></span> Broadcasting transaction…'; }

  try {
    const result = await executeSwap({
      trader:      state.anetWallet.address,
      senderSeed:  state.anetWallet.seedPhrase,
      tokenSymbol: stable,
      amountIn:    anet2ants(amt),
      anetToToken: true,
    });

    const received = parseInt(result.amount_out || 0) / ANTS_PER_ANET;

    appendLocalTrade({
      side: 'SELL',
      pair: `ANET/${stable}`,
      tokenSymbol: stable,
      amountBase: amt,
      amountQuote: received,
      anetToToken: true,
      source: 'DEX',
      timestamp: Date.now(),
    });

    if (statusEl) {
      statusEl.className   = 'swap-status show success';
      statusEl.textContent = `✓ Swapped ${fmt(amt,4)} ANET → ${fmt(received,4)} ${stable}. Your ${stable} is now in your ANET L1 wallet.`;
    }
    toast(`Swap successful! ${fmt(received,4)} ${stable} is in your ANET wallet. Bridge to EVM launches in Phase 2.`, 'success', 8000);

    // Mark step 2 done, step 3 active
    const s2 = document.getElementById('cstep-2');
    const s3 = document.getElementById('cstep-3');
    if (s2) s2.classList.add('done');
    if (s3) s3.classList.add('active');

    state._cashoutQuote = null;
    document.getElementById('co-anet-in').value = '';
    document.getElementById('co-quote-box').style.display = 'none';
    btn.textContent = 'Swap complete ✓';
    await Promise.all([refreshPools(), refreshAnetBalance()]);
    initCashoutTab(); // refresh balance display
  } catch (e) {
    if (statusEl) { statusEl.className = 'swap-status show error'; statusEl.textContent = `✕ ${e.message || 'Swap failed'}`; }
    toast(e.message || 'Swap failed', 'error');
    btn.disabled    = false;
    btn.textContent = 'Retry Swap';
  }
}

function submitBridgeNotify() {
  const emailEl  = document.getElementById('co-notify-email');
  const statusEl = document.getElementById('co-notify-status');
  if (!emailEl || !statusEl) return;

  const email = emailEl.value.trim();
  // Basic email format validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    statusEl.style.display = 'block';
    statusEl.style.color   = 'var(--error)';
    statusEl.textContent   = 'Please enter a valid email address.';
    return;
  }

  // Opens a mailto to the team — can be replaced with a real API endpoint later
  const subject = encodeURIComponent('ANET Bridge Phase 2 — Notify Me');
  const body    = encodeURIComponent(`Please notify me when the ANET L1 bridge goes live.\n\nEmail: ${email}`);
  window.open(`mailto:hello@a-network.net?subject=${subject}&body=${body}`, '_blank');

  emailEl.value          = '';
  statusEl.style.display = 'block';
  statusEl.style.color   = 'var(--accent-2)';
  statusEl.textContent   = '✓ Request sent! We will email you when the bridge launches.';
}
/* ── Pool data & rendering ──────────────────── */
async function refreshPools() {
  state.pools = await loadPools();
  captureMiniChartSnapshots();
  renderPoolsSidebar();
  renderMarketsTable();
  hydrateMarketPairSelector();
  renderMarketMicrostructure();
  renderLiqPoolList();
  updateHeroStats();
  renderMiniLiveChart();
  // pick default token for swap
  if (!state.toToken && state.pools.length > 0) {
    state.toToken = state.pools[0].token_symbol;
    renderSwapTokenSelectors();
  }
}

function getPoolPriceInAnet(pool) {
  const anetRes = parseFloat(pool.anet_reserve_anet || ants2anet(pool.anet_reserve_ants || 0));
  const tokRes = Number(pool.token_reserve_units || 0) / ANTS_PER_ANET;
  if (!isFinite(anetRes) || !isFinite(tokRes) || tokRes <= 0) {
    return null;
  }
  return anetRes / tokRes;
}

function captureMiniChartSnapshots() {
  const now = Date.now();
  state.pools.forEach(pool => {
    const sym = (pool.token_symbol || '').toUpperCase();
    if (!sym) return;

    const price = getPoolPriceInAnet(pool);
    if (price == null || !isFinite(price) || price <= 0) return;

    if (!Array.isArray(state.miniPriceSeries[sym])) {
      state.miniPriceSeries[sym] = [];
    }

    const series = state.miniPriceSeries[sym];
    const last = series[series.length - 1];
    if (last && Math.abs(last.price - price) < 1e-12) {
      last.time = now;
    } else {
      series.push({ time: now, price });
    }

    if (series.length > 42) {
      series.splice(0, series.length - 42);
    }
  });
}

function buildSparklinePath(points, width, height) {
  if (!Array.isArray(points) || points.length < 2) return '';

  const values = points.map(p => p.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  return points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p.price - min) / span) * height;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function renderMiniLiveChart() {
  const pairEl = document.getElementById('mini-chart-pair');
  const priceEl = document.getElementById('mini-chart-price');
  const changeEl = document.getElementById('mini-chart-change');
  const pathEl = document.getElementById('mini-chart-path');
  const updatedEl = document.getElementById('mini-chart-updated');
  if (!pairEl || !priceEl || !changeEl || !pathEl || !updatedEl) return;

  let symbol = (state.selectedPool || state.toToken || '').toUpperCase();
  if (!symbol || symbol === 'ANET' || !state.miniPriceSeries[symbol]?.length) {
    const candidates = Object.keys(state.miniPriceSeries);
    if (candidates.includes('WBNB')) symbol = 'WBNB';
    else symbol = candidates[0] || '';
  }

  const series = state.miniPriceSeries[symbol] || [];
  if (!symbol || series.length === 0) {
    pairEl.textContent = 'ANET / --';
    priceEl.textContent = '--';
    changeEl.className = 'mini-chart-change neutral';
    changeEl.textContent = 'Waiting for first pool ticks';
    pathEl.setAttribute('d', '');
    pathEl.style.stroke = 'var(--accent)';
    updatedEl.textContent = 'waiting...';
    return;
  }

  const first = series[0].price;
  const last = series[series.length - 1].price;
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;

  pairEl.textContent = `ANET / ${symbol}`;
  priceEl.textContent = `${fmt(last, 6)} ANET`;
  updatedEl.textContent = `updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  let trendClass = 'neutral';
  if (pct > 0.01) trendClass = 'up';
  else if (pct < -0.01) trendClass = 'down';
  changeEl.className = `mini-chart-change ${trendClass}`;
  changeEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;

  const path = buildSparklinePath(series, 260, 74);
  pathEl.setAttribute('d', path);
  pathEl.style.stroke = trendClass === 'up'
    ? 'var(--accent-2)'
    : trendClass === 'down'
      ? 'var(--danger)'
      : 'var(--accent)';
}

function renderPoolsSidebar() {
  const container = document.getElementById('pools-sidebar');
  if (!container) return;

  if (state.pools.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🌊</div><p>No pools found yet.<br>Be the first to create one.</p></div>`;
    return;
  }

  container.innerHTML = state.pools.map(pool => {
    const anetBal = parseFloat(pool.anet_reserve_anet || ants2anet(pool.anet_reserve_ants || 0));
    const tokenBal = Number(pool.token_reserve_units || 0);
    const price = tokenBal > 0 ? (anetBal / tokenBal).toFixed(6) : '—';
    const sym = pool.token_symbol || '';
    const feePct = ((pool.fee_bps || 30) / 100).toFixed(2);
    const holders = pool.lp_holders ?? 0;
    return `
    <div class="pool-card ${state.selectedPool === sym ? 'active' : ''}" onclick="selectPool('${sym}')">
      <div class="pool-card-header">
        <div class="pool-pair">
          <div class="pool-icons">
            <div class="token-icon-placeholder" style="background:linear-gradient(135deg,#58c5ff,#58c5ff88);font-size:8px;width:24px;height:24px;">ANT</div>
            <div class="token-icon-placeholder" style="background:linear-gradient(135deg,${tokenColor(sym)},${tokenColor(sym)}88);font-size:8px;width:24px;height:24px;margin-left:-8px;">${tokenInitials(sym)}</div>
          </div>
          <span class="pool-pair-name">ANET / ${sym}</span>
        </div>
        <span class="pool-fee">${feePct}%</span>
      </div>
      <div class="pool-stats">
        <div class="pool-stat"><div class="v">${fmt(anetBal, 2)}</div><div class="l">ANET Res.</div></div>
        <div class="pool-stat"><div class="v">${fmt(tokenBal, 2)}</div><div class="l">${sym} Res.</div></div>
        <div class="pool-stat"><div class="v">${price}</div><div class="l">Price</div></div>
      </div>
    </div>`;
  }).join('');
}

function selectPool(symbol) {
  state.selectedPool = symbol;
  // Update toToken based on fromToken
  if (state.fromToken === 'ANET') {
    state.toToken = symbol;
  } else {
    state.fromToken = symbol;
    state.toToken = 'ANET';
  }
  renderSwapTokenSelectors();
  renderPoolsSidebar();
  clearQuote();
}

function renderLiqPoolList() {
  const el = document.getElementById('liq-pool-list');
  if (!el) return;
  if (state.pools.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:24px 0;"><div class="empty-icon">🌊</div><p>No pools yet. Create the first one above.</p></div>';
    return;
  }
  el.innerHTML = state.pools.map(pool => {
    const sym = pool.token_symbol || '';
    const anetRes = parseFloat(pool.anet_reserve_anet || ants2anet(pool.anet_reserve_ants || 0));
    const tokRes  = Number(pool.token_reserve_units || 0) / ANTS_PER_ANET;
    const feePct  = ((pool.fee_bps || 30) / 100).toFixed(2);
    return `
    <div class="lp-position-row">
      <div>
        <div class="lp-pair">ANET / ${sym}</div>
        <div style="font-size:11px;color:var(--muted-2);margin-top:2px;">
          ${fmt(anetRes,2)} ANET · ${fmt(tokRes,4)} ${sym} · Fee: ${feePct}%
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="setTab('swap');selectPool('${sym}')">Trade →</button>
    </div>`;
  }).join('');
}

function updateHeroStats() {
  const poolCount = document.getElementById('stat-pools');
  const tvlEl = document.getElementById('stat-tvl');
  if (poolCount) poolCount.textContent = state.pools.length;
  if (tvlEl) {
    const totalAnet = state.pools.reduce((sum, p) => sum + parseFloat(p.anet_reserve_anet || ants2anet(p.anet_reserve_ants || 0)), 0);
    tvlEl.textContent = fmt(totalAnet, 0) + ' ANET';
  }
}

/* ── Swap UI ────────────────────────────────── */
function renderSwapTokenSelectors() {
  const fromBtn = document.getElementById('from-token-btn');
  const toBtn   = document.getElementById('to-token-btn');
  if (!fromBtn || !toBtn) return;

  function buildBtn(btn, sym) {
    btn.innerHTML = '';
    const icon = document.createElement('div');
    icon.className = 'token-icon-placeholder';
    icon.style.width = '22px'; icon.style.height = '22px'; icon.style.fontSize = '8px';
    icon.style.background = `linear-gradient(135deg, ${tokenColor(sym)}, ${tokenColor(sym)}88)`;
    icon.textContent = tokenInitials(sym);
    const label = document.createElement('span');
    label.textContent = sym || 'Select';
    const arrow = document.createElement('span');
    arrow.textContent = '▾';
    arrow.style.fontSize = '10px';
    arrow.style.color = 'var(--muted)';
    btn.appendChild(icon);
    btn.appendChild(label);
    btn.appendChild(arrow);
  }

  buildBtn(fromBtn, state.fromToken || 'Select');
  buildBtn(toBtn,   state.toToken   || 'Select');
  updateSwapFromBalance();
}

function updateSwapFromBalance() {
  const el = document.getElementById('from-balance');
  if (!el) return;
  if (state.fromToken === 'ANET' && state.anetWallet.balance != null) {
    el.textContent = `Balance: ${fmt(parseFloat(ants2anet(state.anetWallet.balance)), 4)} ANET`;
  } else {
    el.textContent = state.anetWallet.address ? 'Balance: — (off-chain)' : 'Connect wallet to see balance';
  }
}

function swapDirection() {
  const tmp = state.fromToken;
  state.fromToken = state.toToken;
  state.toToken = tmp;
  // clear amounts
  const inp = document.getElementById('from-amount');
  if (inp) inp.value = '';
  state.fromAmount = '';
  clearQuote();
  renderSwapTokenSelectors();
}

function clearQuote() {
  state.quote = null;
  const priceInfo = document.getElementById('swap-price-info');
  if (priceInfo) priceInfo.style.display = 'none';
  const swapBtn = document.getElementById('do-swap-btn');
  if (swapBtn) { swapBtn.disabled = true; swapBtn.textContent = 'Enter an amount'; }
}

async function onAmountChange() {
  const inp = document.getElementById('from-amount');
  if (!inp) return;
  state.fromAmount = inp.value;
  const amt = parseFloat(inp.value);
  if (isNaN(amt) || amt <= 0 || !state.fromToken || !state.toToken) { clearQuote(); return; }
  if (!state.fromToken || !state.toToken || state.fromToken === state.toToken) { clearQuote(); return; }

  // determine token symbol and direction
  const isAnetToToken = state.fromToken === 'ANET';
  const tokenSym = isAnetToToken ? state.toToken : state.fromToken;
  const amountAnts = isAnetToToken ? anet2ants(amt) : Math.round(amt * ANTS_PER_ANET);

  try {
    const q = await getSwapQuote({ tokenSymbol: tokenSym, amountIn: amountAnts, anetToToken: isAnetToToken });
    state.quote = q;
    renderQuote(q, isAnetToToken);
  } catch (e) {
    clearQuote();
    if (e.message !== 'pool has no liquidity') {
      toast(e.message || 'Quote failed', 'error');
    }
  }
}

function renderQuote(q, isAnetToToken) {
  const priceInfo = document.getElementById('swap-price-info');
  if (!priceInfo) return;
  const amtOutAnts = parseInt(q.amount_out || 0);
  const amtOut = amtOutAnts / ANTS_PER_ANET;
  const feeAnts = parseInt(q.fee_paid || 0);
  const fee = feeAnts / ANTS_PER_ANET;
  const impact = (parseInt(q.price_impact_bps || 0) / 100).toFixed(2);
  const minOut = parseInt(q.min_out_1pct_slippage || 0) / ANTS_PER_ANET;
  const outSym = isAnetToToken ? state.toToken : 'ANET';
  const feeSym = isAnetToToken ? 'ANET' : state.fromToken;

  // update output field
  const toAmtEl = document.getElementById('to-amount-display');
  if (toAmtEl) toAmtEl.textContent = fmt(amtOut, 6);

  priceInfo.style.display = 'flex';
  priceInfo.innerHTML = `
    <div class="price-row"><span>You receive</span><span class="val">${fmt(amtOut, 6)} ${outSym}</span></div>
    <div class="price-row"><span>Swap fee</span><span class="val">${fmt(fee, 6)} ${feeSym}</span></div>
    <div class="price-row ${parseFloat(impact) > 2 ? 'warn' : ''}"><span>Price impact</span><span class="val">${impact}%</span></div>
    <div class="price-row"><span>Min received (1% slip.)</span><span class="val">${fmt(minOut, 6)} ${outSym}</span></div>
  `;

  const swapBtn = document.getElementById('do-swap-btn');
  if (swapBtn) {
    swapBtn.disabled = false;
    swapBtn.textContent = `Swap ${state.fromToken} → ${state.toToken}`;
  }
}

async function doSwap() {
  if (!state.anetWallet.address || !state.anetWallet.seedPhrase) {
    openAnetWalletModal();
    return;
  }
  if (!state.quote) { toast('Get a quote first', 'error'); return; }
  const amt = parseFloat(state.fromAmount);
  if (isNaN(amt) || amt <= 0) { toast('Invalid amount', 'error'); return; }

  const isAnetToToken = state.fromToken === 'ANET';
  const tokenSym = isAnetToToken ? state.toToken : state.fromToken;
  const amountAnts = isAnetToToken ? anet2ants(amt) : Math.round(amt * ANTS_PER_ANET);

  const btn = document.getElementById('do-swap-btn');
  const statusEl = document.getElementById('swap-status');
  btn.disabled = true;
  if (statusEl) { statusEl.className = 'swap-status show loading'; statusEl.innerHTML = '<span class="spinner"></span> Broadcasting transaction…'; }

  try {
    const result = await executeSwap({
      trader: state.anetWallet.address,
      senderSeed: state.anetWallet.seedPhrase,
      tokenSymbol: tokenSym,
      amountIn: amountAnts,
      anetToToken: isAnetToToken,
    });

    const amtOut = parseInt(result.amount_out || 0) / ANTS_PER_ANET;

    if (statusEl) {
      statusEl.className = 'swap-status show success';
      const outSym = isAnetToToken ? tokenSym : 'ANET';
      statusEl.textContent = `✓ Swapped ${fmt(amt, 4)} ${state.fromToken} → ${fmt(amtOut, 6)} ${outSym}`;
    }

    appendLocalTrade({
      side: isAnetToToken ? 'SELL' : 'BUY',
      pair: `ANET/${tokenSym}`,
      tokenSymbol: tokenSym,
      amountBase: amt,
      amountQuote: amtOut,
      anetToToken: isAnetToToken,
      source: 'DEX',
      timestamp: Date.now(),
    });

    toast(`Swap successful! Received ${fmt(amtOut, 6)} ${isAnetToToken ? tokenSym : 'ANET'}`, 'success', 6000);

    // refresh balance & pools
    document.getElementById('from-amount').value = '';
    state.fromAmount = '';
    clearQuote();
    await Promise.all([refreshPools(), refreshAnetBalance()]);
  } catch (e) {
    if (statusEl) { statusEl.className = 'swap-status show error'; statusEl.textContent = `✕ ${e.message || 'Swap failed'}`; }
    toast(e.message || 'Swap failed', 'error');
    btn.disabled = false;
  }
}

async function refreshAnetBalance() {
  if (!state.anetWallet.address) return;
  try {
    const acct = await getAccount(state.anetWallet.address);
    state.anetWallet.balance = Number(acct.ants_balance);
    updateAnetWalletUI();
  } catch (_) {}
}

/* ── Token dropdown ─────────────────────────── */
let activeDropdown = null;

function openTokenDropdown(side) {
  closeTokenDropdown();
  const refBtn = document.getElementById(side === 'from' ? 'from-token-btn' : 'to-token-btn');
  if (!refBtn) return;

  const overlay = document.getElementById('token-dropdown-overlay');
  const dropdown = document.getElementById('token-dropdown');
  if (!overlay || !dropdown) return;

  overlay.classList.add('open');
  dropdown.classList.add('open');
  activeDropdown = side;

  // position dropdown near button
  const rect = refBtn.getBoundingClientRect();
  const scrollY = window.pageYOffset || document.documentElement.scrollTop;
  dropdown.style.position = 'fixed';
  dropdown.style.top = (rect.bottom + 6) + 'px';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.zIndex = '601';

  renderTokenDropdownItems(side, '');
  const searchInp = dropdown.querySelector('.token-search input');
  if (searchInp) { searchInp.value = ''; searchInp.focus(); }
}

function closeTokenDropdown() {
  const overlay = document.getElementById('token-dropdown-overlay');
  const dropdown = document.getElementById('token-dropdown');
  if (overlay) overlay.classList.remove('open');
  if (dropdown) dropdown.classList.remove('open');
  activeDropdown = null;
}

function renderTokenDropdownItems(side, filter) {
  const dropdown = document.getElementById('token-dropdown');
  if (!dropdown) return;
  const list = dropdown.querySelector('.token-list');
  if (!list) return;

  // build available token list: ANET + all pool tokens
  const poolTokens = state.pools.map(p => p.token_symbol);
  const allTokens = ['ANET', ...new Set([...poolTokens, ...KNOWN_TOKENS.map(t => t.symbol)])];
  const q = filter.trim().toUpperCase();
  const filtered = allTokens.filter(sym => !q || sym.includes(q));

  list.innerHTML = filtered.map(sym => {
    const info = KNOWN_TOKENS.find(t => t.symbol === sym) || { name: sym + ' Token', chain: 'DEX' };
    const isSel = side === 'from' ? state.fromToken === sym : state.toToken === sym;
    return `<div class="token-list-item ${isSel ? 'selected' : ''}" onclick="selectToken('${side}','${sym}')">
      <div class="token-icon-placeholder" style="background:linear-gradient(135deg,${tokenColor(sym)},${tokenColor(sym)}88);font-size:8px;width:28px;height:28px;flex-shrink:0;">${tokenInitials(sym)}</div>
      <div class="token-info-col">
        <div class="token-sym">${sym}</div>
        <div class="token-name">${info.name}</div>
      </div>
      <span class="token-chain-tag">${info.chain || 'DEX'}</span>
    </div>`;
  }).join('') || '<div style="padding:14px;color:var(--muted-2);font-size:13px;text-align:center;">No tokens found</div>';
}

function selectToken(side, sym) {
  if (side === 'from') {
    if (sym === state.toToken) { state.toToken = state.fromToken; } // swap if same
    state.fromToken = sym;
  } else {
    if (sym === state.fromToken) { state.fromToken = state.toToken; }
    state.toToken = sym;
  }
  closeTokenDropdown();
  renderSwapTokenSelectors();
  clearQuote();

  // auto-select pool
  if (state.fromToken !== 'ANET' && state.toToken !== 'ANET') {
    // multi-hop not supported in v1; require one side to be ANET
    toast('Direct token-to-token swaps route through ANET. Select ANET on one side.', 'info', 5000);
    state.toToken = 'ANET';
    renderSwapTokenSelectors();
  }
}

/* ── Markets table & tape ───────────────────── */
function formatRelativeTime(ts) {
  if (!ts) return '—';
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return '—';
  const delta = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (delta < 5) return 'just now';
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function sanitizeMemo(memo) {
  const m = String(memo || '').trim();
  if (!m) return 'Transfer';
  return m.length > 64 ? (m.slice(0, 64) + '…') : m;
}

function appendLocalTrade(trade) {
  const priceAnetPerToken = trade.amountQuote > 0 ? (trade.amountBase / trade.amountQuote) : null;
  state.recentLocalTrades.unshift({
    side: trade.side,
    pair: trade.pair,
    tokenSymbol: trade.tokenSymbol,
    amountAnet: trade.anetToToken ? trade.amountBase : trade.amountQuote,
    amountToken: trade.anetToToken ? trade.amountQuote : trade.amountBase,
    price: priceAnetPerToken,
    source: trade.source || 'DEX',
    timestamp: trade.timestamp || Date.now(),
  });
  state.recentLocalTrades = state.recentLocalTrades.slice(0, 80);
  if (state.activeTab === 'markets') renderLastTradesTable();
}

async function loadLatestBlocks() {
  try {
    const data = await apiFetch('/blocks');
    let blocks = [];
    if (Array.isArray(data)) blocks = data;
    else if (Array.isArray(data?.blocks)) blocks = data.blocks;
    else if (data && typeof data === 'object') blocks = [data];

    const txs = [];
    blocks.forEach((b, bi) => {
      const list = Array.isArray(b.transactions) ? b.transactions : [];
      list.forEach((tx, ti) => {
        txs.push({
          blockHeight: b.block_height ?? b.height ?? '—',
          from: tx.from || '—',
          to: tx.to || '—',
          memo: sanitizeMemo(tx.memo || b.block_event || 'Transfer'),
          amountAnts: Number(tx.amount_ants || 0),
          feeAnts: Number(tx.fee_ants || 0),
          timestamp: tx.timestamp || b.epoch_end || b.epoch_start || b.timestamp || null,
          txRef: tx.txid || tx.hash || tx.id || `${b.block_height || bi}-${ti}`,
        });
      });
    });

    txs.sort((a, b) => {
      const ta = Date.parse(a.timestamp || 0) || 0;
      const tb = Date.parse(b.timestamp || 0) || 0;
      return tb - ta;
    });
    state.chainTxs = txs.slice(0, 60);
  } catch (e) {
    console.warn('loadLatestBlocks:', e?.message || e);
  }
}

async function refreshMarketActivity() {
  await loadLatestBlocks();
  renderChainTxTable();
  renderLastTradesTable();
}

function hydrateMarketPairSelector() {
  const sel = document.getElementById('market-pair-select');
  if (!sel) return;
  if (state.pools.length === 0) {
    sel.innerHTML = '<option value="">No pools available</option>';
    return;
  }
  sel.innerHTML = state.pools.map(p => `<option value="${p.token_symbol}">ANET / ${p.token_symbol}</option>`).join('');
  if (!state.marketPair || !state.pools.some(p => p.token_symbol === state.marketPair)) {
    state.marketPair = state.selectedPool || state.pools[0].token_symbol;
  }
  sel.value = state.marketPair;
}

function getSelectedMarketPool() {
  const sel = document.getElementById('market-pair-select');
  if (sel && sel.value) state.marketPair = sel.value;
  if (!state.marketPair && state.pools.length) state.marketPair = state.pools[0].token_symbol;
  return state.pools.find(p => p.token_symbol === state.marketPair) || null;
}

function renderMarketMicrostructure() {
  hydrateMarketPairSelector();
  const asksEl = document.getElementById('ob-asks');
  const bidsEl = document.getElementById('ob-bids');
  const midEl = document.getElementById('ob-mid');
  if (!asksEl || !bidsEl || !midEl) return;

  const pool = getSelectedMarketPool();
  if (!pool) {
    asksEl.innerHTML = '<tr><td colspan="3" style="padding:20px;text-align:center;color:var(--muted);">No market selected.</td></tr>';
    bidsEl.innerHTML = '<tr><td colspan="3" style="padding:20px;text-align:center;color:var(--muted);">No market selected.</td></tr>';
    midEl.textContent = 'Mid: —';
    renderLastTradesTable();
    return;
  }

  const sym = pool.token_symbol;
  const anetRes = parseFloat(pool.anet_reserve_anet || ants2anet(pool.anet_reserve_ants || 0));
  const tokRes = Number(pool.token_reserve_units || 0) / ANTS_PER_ANET;
  const mid = (anetRes > 0 && tokRes > 0) ? (anetRes / tokRes) : 0;

  if (!mid || !Number.isFinite(mid)) {
    asksEl.innerHTML = '<tr><td colspan="3" style="padding:20px;text-align:center;color:var(--muted);">Pool has no liquidity.</td></tr>';
    bidsEl.innerHTML = '<tr><td colspan="3" style="padding:20px;text-align:center;color:var(--muted);">Pool has no liquidity.</td></tr>';
    midEl.textContent = 'Mid: —';
    renderLastTradesTable();
    return;
  }

  midEl.textContent = `Mid: ${fmt(mid, 6)} ANET per ${sym}`;

  const levels = 10;
  const step = 0.004;
  const baseSize = Math.max(tokRes * 0.01, 0.001);

  const asks = Array.from({ length: levels }, (_, idx) => {
    const i = idx + 1;
    const price = mid * (1 + step * i);
    const qty = baseSize * (1 + (i * 0.15));
    return { price, qty, total: price * qty };
  }).reverse();

  const bids = Array.from({ length: levels }, (_, idx) => {
    const i = idx + 1;
    const price = mid * (1 - step * i);
    const qty = baseSize * (1 + (i * 0.15));
    return { price, qty, total: price * qty };
  });

  asksEl.innerHTML = asks.map(r => `
    <tr>
      <td class="mono" style="color:#ff7d8f;">${fmt(r.price, 6)}</td>
      <td class="mono">${fmt(r.qty, 4)} ${sym}</td>
      <td class="mono">${fmt(r.total, 4)} ANET</td>
    </tr>
  `).join('');

  bidsEl.innerHTML = bids.map(r => `
    <tr>
      <td class="mono" style="color:#22e7b8;">${fmt(r.price, 6)}</td>
      <td class="mono">${fmt(r.qty, 4)} ${sym}</td>
      <td class="mono">${fmt(r.total, 4)} ANET</td>
    </tr>
  `).join('');

  renderLastTradesTable();
}

function renderLastTradesTable() {
  const tbody = document.getElementById('last-trades-tbody');
  if (!tbody) return;
  const pool = getSelectedMarketPool();
  const sym = pool?.token_symbol;

  const local = state.recentLocalTrades
    .filter(t => !sym || t.tokenSymbol === sym)
    .map(t => ({
      side: t.side,
      price: t.price,
      amountToken: t.amountToken,
      time: t.timestamp,
    }));

  const chainInferred = state.chainTxs
    .filter(t => /swap|dex|pool|liquidity|trade/i.test(t.memo))
    .slice(0, 16)
    .map(t => ({
      side: /sell|out/i.test(t.memo) ? 'SELL' : (/buy|in/i.test(t.memo) ? 'BUY' : 'CHAIN'),
      price: null,
      amountToken: t.amountAnts / ANTS_PER_ANET,
      time: t.timestamp,
    }));

  const merged = [...local, ...chainInferred]
    .sort((a, b) => (Date.parse(b.time || 0) || b.time || 0) - (Date.parse(a.time || 0) || a.time || 0))
    .slice(0, 16);

  if (merged.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:18px;text-align:center;color:var(--muted);">No recent trades yet. Execute a swap to start the tape.</td></tr>';
    return;
  }

  tbody.innerHTML = merged.map(r => {
    const sideColor = r.side === 'SELL' ? '#ff7d8f' : (r.side === 'BUY' ? '#22e7b8' : 'var(--muted)');
    return `<tr>
      <td class="mono" style="color:${sideColor};font-weight:700;">${r.side}</td>
      <td class="mono">${r.price != null ? fmt(r.price, 6) : '—'}</td>
      <td class="mono">${fmt(r.amountToken, 4)} ${sym || ''}</td>
      <td style="font-size:11.5px;color:var(--muted-2);">${formatRelativeTime(r.time)}</td>
    </tr>`;
  }).join('');
}

function renderChainTxTable() {
  const tbody = document.getElementById('chain-tx-tbody');
  if (!tbody) return;
  if (!state.chainTxs.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:18px;text-align:center;color:var(--muted);">No chain transactions available.</td></tr>';
    return;
  }

  tbody.innerHTML = state.chainTxs.slice(0, 16).map(tx => `
    <tr>
      <td class="mono" style="color:var(--accent);">#${tx.blockHeight}</td>
      <td class="mono" style="font-size:11.5px;">${shortAddr(tx.from)}</td>
      <td style="font-size:11.5px;color:var(--muted);">${sanitizeMemo(tx.memo)}</td>
      <td style="font-size:11.5px;color:var(--muted-2);">${formatRelativeTime(tx.timestamp)}</td>
    </tr>
  `).join('');
}

function renderMarketsTable() {
  const tbody = document.getElementById('markets-tbody');
  if (!tbody) return;
  if (state.pools.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--muted);">No pools found. Pools will appear here once created.</td></tr>`;
    hydrateMarketPairSelector();
    renderMarketMicrostructure();
    return;
  }
  tbody.innerHTML = state.pools.map(pool => {
    const sym = pool.token_symbol || '';
    const anetRes = parseFloat(pool.anet_reserve_anet || ants2anet(pool.anet_reserve_ants || 0));
    const tokRes  = Number(pool.token_reserve_units || 0) / ANTS_PER_ANET;
    const price   = tokRes > 0 ? anetRes / tokRes : 0;
    const fee     = ((pool.fee_bps || 30) / 100).toFixed(2);
    const holders = pool.lp_holders ?? 0;
    return `<tr>
      <td>
        <div class="pair-cell">
          <div class="pool-icons" style="display:flex;">
            <div class="token-icon-placeholder" style="background:linear-gradient(135deg,#58c5ff,#58c5ff88);font-size:8px;width:26px;height:26px;">ANT</div>
            <div class="token-icon-placeholder" style="background:linear-gradient(135deg,${tokenColor(sym)},${tokenColor(sym)}88);font-size:8px;width:26px;height:26px;margin-left:-8px;">${tokenInitials(sym)}</div>
          </div>
          <span class="mono">ANET / ${sym}</span>
        </div>
      </td>
      <td class="mono">${fmt(price, 6)} ANET</td>
      <td class="mono">${fmt(anetRes, 2)} ANET</td>
      <td class="mono">${fmt(tokRes, 4)} ${sym}</td>
      <td><span class="pill">${fee}%</span></td>
      <td>${holders} LP${holders !== 1 ? 's' : ''}</td>
    </tr>`;
  }).join('');
  hydrateMarketPairSelector();
}

/* ── Liquidity panel ────────────────────────── */
function renderLiquidityPools() {
  const sel = document.getElementById('liq-pool-select');
  if (!sel) return;
  sel.innerHTML = state.pools.map(p => `<option value="${p.token_symbol}">ANET / ${p.token_symbol}</option>`).join('');
  if (state.pools.length === 0) sel.innerHTML = '<option value="">No pools available</option>';
}

async function doAddLiquidity() {
  if (!state.anetWallet.address || !state.anetWallet.seedPhrase) { openAnetWalletModal(); return; }

  const sym    = document.getElementById('liq-pool-select')?.value;
  const anetAmt = parseFloat(document.getElementById('liq-anet-amount')?.value);
  const tokAmt  = parseFloat(document.getElementById('liq-token-amount')?.value);

  if (!sym)          { toast('Select a pool', 'error'); return; }
  if (isNaN(anetAmt) || anetAmt <= 0) { toast('Enter ANET amount', 'error'); return; }
  if (isNaN(tokAmt)  || tokAmt <= 0)  { toast('Enter token amount', 'error'); return; }

  const btn = document.getElementById('add-liq-btn');
  btn.disabled = true;
  btn.textContent = 'Adding…';

  try {
    const result = await addLiquidity({
      provider: state.anetWallet.address,
      senderSeed: state.anetWallet.seedPhrase,
      tokenSymbol: sym,
      anetAmountAnts: anet2ants(anetAmt),
      tokenAmountUnits: Math.round(tokAmt * ANTS_PER_ANET),
    });
    toast(`Liquidity added! LP units: ${result.lp_minted}`, 'success', 6000);
    await Promise.all([refreshPools(), refreshAnetBalance()]);
    document.getElementById('liq-anet-amount').value = '';
    document.getElementById('liq-token-amount').value = '';
  } catch (e) {
    toast(e.message || 'Add liquidity failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Liquidity';
  }
}

async function doCreatePool() {
  if (!state.anetWallet.address || !state.anetWallet.seedPhrase) { openAnetWalletModal(); return; }

  const sym    = document.getElementById('create-token-sym')?.value?.trim()?.toUpperCase();
  const anetAmt = parseFloat(document.getElementById('create-anet-amount')?.value);
  const tokAmt  = parseFloat(document.getElementById('create-token-amount')?.value);
  const fee     = parseInt(document.getElementById('create-fee-bps')?.value || '30');

  if (!sym)          { toast('Enter token symbol', 'error'); return; }
  if (isNaN(anetAmt) || anetAmt <= 0) { toast('Enter ANET amount', 'error'); return; }
  if (isNaN(tokAmt)  || tokAmt <= 0)  { toast('Enter token amount', 'error'); return; }

  const discoveryMode = isCreatePoolDiscoveryModeEnabled();

  // When discovery mode is OFF, enforce stable-pair 1:1 bootstrap at submission.
  const submitTokAmt = (!discoveryMode && isStableSymbol(sym)) ? anetAmt : tokAmt;
  if (!discoveryMode && isStableSymbol(sym) && Math.abs(tokAmt - anetAmt) > 0.0000001) {
    const tokEl = document.getElementById('create-token-amount');
    if (tokEl) tokEl.value = String(anetAmt);
    toast(`Adjusted ${sym} amount to match ANET for 1:1 launch price.`, 'info', 3500);
  }

  const btn = document.getElementById('create-pool-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    await createPool({
      provider: state.anetWallet.address,
      senderSeed: state.anetWallet.seedPhrase,
      tokenSymbol: sym,
      anetAmountAnts: anet2ants(anetAmt),
      tokenAmountUnits: Math.round(submitTokAmt * ANTS_PER_ANET),
      feeBps: fee,
    });
    toast(`Pool ANET/${sym} created!`, 'success', 6000);
    await refreshPools();
    applyCreatePoolStartDefaults();
    syncCreatePoolPegDraft();
  } catch (e) {
    toast(e.message || 'Create pool failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Pool';
  }
}

function isStableSymbol(sym) {
  return ['USDT', 'USDC', 'DAI', 'BUSD'].includes((sym || '').toUpperCase());
}

function isCreatePoolDiscoveryModeEnabled() {
  const el = document.getElementById('create-discovery-mode');
  return !!el && el.checked;
}

function applyCreatePoolStartDefaults() {
  const symEl  = document.getElementById('create-token-sym');
  const anetEl = document.getElementById('create-anet-amount');
  const tokEl  = document.getElementById('create-token-amount');
  const feeEl  = document.getElementById('create-fee-bps');
  const discoveryEl = document.getElementById('create-discovery-mode');
  if (!symEl || !anetEl || !tokEl || !feeEl) return;

  if (!symEl.value || !symEl.value.trim()) symEl.value = 'USDT';
  if (!anetEl.value || parseFloat(anetEl.value) <= 0) anetEl.value = '1';
  tokEl.value = anetEl.value;
  if (!feeEl.value || parseInt(feeEl.value, 10) <= 0) feeEl.value = '30';
  if (discoveryEl) discoveryEl.checked = true;
}

function useAvailableAnetForCreatePool() {
  const anetEl = document.getElementById('create-anet-amount');
  const tokEl = document.getElementById('create-token-amount');
  const symEl = document.getElementById('create-token-sym');
  if (!anetEl || !tokEl || !symEl) return;

  if (!state.anetWallet.address) {
    toast('Connect ANET wallet first to use available balance.', 'error');
    openAnetWalletModal();
    return;
  }
  if (state.anetWallet.balance == null || Number(state.anetWallet.balance) <= 0) {
    toast('No ANET balance available in connected wallet.', 'error');
    return;
  }

  const availableAnet = Number(state.anetWallet.balance) / ANTS_PER_ANET;
  const amount = Number(Math.max(availableAnet, 0).toFixed(8));
  anetEl.value = String(amount);

  const sym = (symEl.value || '').trim().toUpperCase();
  if (!isCreatePoolDiscoveryModeEnabled() && isStableSymbol(sym)) {
    tokEl.value = String(amount);
  } else if (!tokEl.value || parseFloat(tokEl.value) <= 0) {
    tokEl.value = String(amount);
  }

  syncCreatePoolPegDraft();
  toast(`Filled ANET amount from wallet balance: ${fmt(amount, 8)} ANET`, 'info', 4500);
}

function quickCreateStablePool(symbol) {
  const symEl  = document.getElementById('create-token-sym');
  const anetEl = document.getElementById('create-anet-amount');
  const tokEl  = document.getElementById('create-token-amount');
  const feeEl  = document.getElementById('create-fee-bps');
  if (!symEl || !anetEl || !tokEl) return;

  symEl.value = symbol;
  // Keep a small bootstrap amount by default so operators can test immediately.
  if (!anetEl.value || parseFloat(anetEl.value) <= 0) anetEl.value = '1';
  tokEl.value = anetEl.value;
  if (feeEl && (!feeEl.value || parseInt(feeEl.value, 10) <= 0)) feeEl.value = '30';

  syncCreatePoolPegDraft();
  updateCreatePoolDepthPreview();

  toast(`Draft set: ANET/${symbol} at 1:1 (1 ANET = $1). Review and click Create Pool.`, 'info', 4500);
}

function syncCreatePoolPegDraft() {
  const symEl  = document.getElementById('create-token-sym');
  const anetEl = document.getElementById('create-anet-amount');
  const tokEl  = document.getElementById('create-token-amount');
  const hintEl = document.getElementById('create-peg-hint');
  if (!symEl || !anetEl || !tokEl) return;

  const sym = (symEl.value || '').trim().toUpperCase();
  const anetAmt = parseFloat(anetEl.value || '0');
  const discoveryMode = isCreatePoolDiscoveryModeEnabled();

  if (!discoveryMode && isStableSymbol(sym) && !isNaN(anetAmt) && anetAmt > 0) {
    tokEl.value = String(anetAmt);
    if (hintEl) {
      hintEl.textContent = `Peg mode active: ${sym} amount mirrors ANET amount (1 ANET = $1).`;
      hintEl.style.color = 'var(--accent-2)';
    }
  } else if (discoveryMode) {
    if (hintEl) {
      hintEl.textContent = 'Discovery mode active: market sets price from your ANET/TOKEN ratio (no forced peg).';
      hintEl.style.color = 'var(--accent)';
    }
  } else if (hintEl) {
    hintEl.textContent = 'Tip: for USDT/USDC pools, keep TOKEN AMOUNT equal to ANET AMOUNT to start at 1 ANET = $1.';
    hintEl.style.color = 'var(--muted-2)';
  }

  updateCreatePoolDepthPreview();
}

function estimateImpactBps({ reserveIn, reserveOut, amountIn }) {
  if (reserveIn <= 0 || reserveOut <= 0 || amountIn <= 0) return 0;
  const midPrice = reserveOut / reserveIn;
  const out = reserveOut - (reserveIn * reserveOut) / (reserveIn + amountIn);
  const execPrice = out / amountIn;
  const impact = Math.max(0, (1 - (execPrice / midPrice)) * 10000);
  return impact;
}

function updateCreatePoolDepthPreview() {
  const symEl = document.getElementById('create-token-sym');
  const anetEl = document.getElementById('create-anet-amount');
  const tokEl = document.getElementById('create-token-amount');
  const badgeEl = document.getElementById('create-depth-badge');
  const summaryEl = document.getElementById('create-depth-summary');
  const gridEl = document.getElementById('create-depth-grid');
  if (!symEl || !anetEl || !tokEl || !badgeEl || !summaryEl || !gridEl) return;

  const sym = (symEl.value || '').trim().toUpperCase();
  const anetAmt = parseFloat(anetEl.value || '0');
  const tokAmt = parseFloat(tokEl.value || '0');

  if (!sym || isNaN(anetAmt) || isNaN(tokAmt) || anetAmt <= 0 || tokAmt <= 0) {
    badgeEl.className = 'pill';
    badgeEl.textContent = 'Set amounts';
    summaryEl.style.color = 'var(--muted)';
    summaryEl.textContent = 'Enter ANET + token amounts to preview initial depth and trade impact.';
    gridEl.innerHTML = '';
    return;
  }

  const stableMode = isStableSymbol(sym);
  const tvlUsd = stableMode ? (anetAmt + tokAmt) : (2 * anetAmt);
  const imbalance = Math.abs(tokAmt - anetAmt) / Math.max(anetAmt, 0.0000001);

  let tier = 'Bootstrap';
  let color = 'var(--warn)';
  if (tvlUsd >= 5000) { tier = 'Deep'; color = 'var(--accent-2)'; }
  else if (tvlUsd >= 1000) { tier = 'Healthy'; color = 'var(--accent)'; }
  else if (tvlUsd >= 100) { tier = 'Thin'; color = 'var(--warn)'; }

  badgeEl.className = 'pill';
  badgeEl.textContent = `${tier} Depth`;
  badgeEl.style.color = color;
  badgeEl.style.borderColor = color;

  const pegHint = stableMode
    ? `${fmt(1, 2)} ANET = ${fmt(tokAmt / anetAmt, 4)} ${sym}`
    : `${fmt(1, 2)} ANET = ${fmt(tokAmt / anetAmt, 4)} ${sym} (non-stable pair)`;

  if (stableMode && imbalance > 0.02) {
    summaryEl.style.color = 'var(--warn)';
    summaryEl.textContent = `Pool starts off-peg: ${pegHint}. For a $1 launch target, keep ANET and ${sym} equal.`;
  } else if (tvlUsd < 100) {
    summaryEl.style.color = 'var(--warn)';
    summaryEl.textContent = `Very low depth (~$${fmt(tvlUsd, 2)}). Large slippage expected. Use for testing/bootstrap only.`;
  } else {
    summaryEl.style.color = 'var(--muted)';
    summaryEl.textContent = `Estimated launch price: ${pegHint}. Approx pool depth: ~$${fmt(tvlUsd, 2)}.`;
  }

  // Slippage estimates for selling ANET into this pool at common trade sizes.
  const testSizes = stableMode ? [1, 5, 10] : [1, 3, 5];
  gridEl.innerHTML = testSizes.map(size => {
    const impactBps = estimateImpactBps({ reserveIn: anetAmt, reserveOut: tokAmt, amountIn: size });
    const impactPct = impactBps / 100;
    const warn = impactPct > 10;
    const medium = impactPct > 3 && impactPct <= 10;
    const impactColor = warn ? 'var(--error)' : (medium ? 'var(--warn)' : 'var(--accent-2)');
    return `
      <div style="padding:8px;border:1px solid var(--line);border-radius:var(--radius-sm);background:rgba(5,11,18,0.5);">
        <div style="color:var(--muted-2);margin-bottom:3px;">Sell ${size} ANET</div>
        <div style="font-weight:700;color:${impactColor};">~${fmt(impactPct, 2)}% impact</div>
      </div>
    `;
  }).join('');
}

function initCreatePoolHelpers() {
  const symEl  = document.getElementById('create-token-sym');
  const anetEl = document.getElementById('create-anet-amount');
  const tokEl  = document.getElementById('create-token-amount');
  const discoveryEl = document.getElementById('create-discovery-mode');
  if (!symEl || !anetEl || !tokEl) return;
  applyCreatePoolStartDefaults();
  symEl.addEventListener('input', syncCreatePoolPegDraft);
  anetEl.addEventListener('input', syncCreatePoolPegDraft);
  tokEl.addEventListener('input', updateCreatePoolDepthPreview);
  if (discoveryEl) discoveryEl.addEventListener('change', syncCreatePoolPegDraft);
  syncCreatePoolPegDraft();
}

/* ── Bridge UI ──────────────────────────────── */
function updateBridgeWalletDisplay() {
  const evmEl  = document.getElementById('bridge-evm-addr');
  const anetEl = document.getElementById('bridge-anet-addr');
  if (evmEl) {
    evmEl.textContent = state.evmWallet.address ? shortAddr(state.evmWallet.address) : 'Not connected';
    evmEl.style.color = state.evmWallet.address ? 'var(--accent-2)' : 'var(--muted-2)';
  }
  if (anetEl) {
    anetEl.textContent = state.anetWallet.address ? shortAddr(state.anetWallet.address) : 'Not connected';
    anetEl.style.color = state.anetWallet.address ? 'var(--accent-2)' : 'var(--muted-2)';
  }
}

function setBridgeDirection(dir) {
  state.bridgeDirection = dir;
  document.querySelectorAll('.bridge-dir-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.dir === dir)
  );
  renderBridgeUI();
  buildBridgeTokenOptions(state.selectedBridgeChain);
}

function renderBridgeUI() {
  const fromLabel = document.getElementById('bridge-from-label');
  const toLabel   = document.getElementById('bridge-to-label');
  if (!fromLabel || !toLabel) return;
  if (state.bridgeDirection === 'evm_to_anet') {
    fromLabel.textContent = 'EVM Chain → Wrapped on ANET L1';
    toLabel.textContent   = 'Receive on ANET wallet';
  } else {
    fromLabel.textContent = 'ANET L1 Wrapped Token → EVM Chain';
    toLabel.textContent   = 'Receive on EVM wallet';
  }
}

function selectBridgeChain(chainId) {
  state.selectedBridgeChain = chainId;
  document.querySelectorAll('.chain-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.chain) === chainId)
  );
  buildBridgeTokenOptions(chainId);
  if (state.evmWallet.address) switchEvmChain(chainId);
}

/* Dynamically populate bridge token dropdown for a given chainId */
function buildBridgeTokenOptions(chainId) {
  const sel = document.getElementById('bridge-token');
  if (!sel) return;
  const tokens = CHAIN_TOKENS[chainId] || [];
  const chainName = EVM_CHAINS[chainId]?.name || 'EVM';
  sel.innerHTML = tokens.map(t => {
    const dirFrom = state.bridgeDirection === 'evm_to_anet';
    const label = dirFrom
      ? `${t.symbol} (${chainName}) → w${t.symbol} on ANET L1`
      : `w${t.symbol} on ANET L1 → ${t.symbol} (${chainName})`;
    return `<option value="${t.symbol}" data-addr="${t.addr || 'native'}">${label}</option>`;
  }).join('');
  if (!tokens.length) sel.innerHTML = '<option value="">No tokens found for this chain</option>';

  // Also update the bridge fee estimate display
  updateBridgeFeeEstimate(chainId);
}

function updateBridgeFeeEstimate(chainId) {
  const el = document.getElementById('bridge-fee-estimate');
  if (!el) return;
  const chain = EVM_CHAINS[chainId];
  if (!chain) return;
  const gasMap = { 1: '~$8–18', 56: '~$0.10–0.30', 137: '~$0.01–0.05',
    8453: '~$0.05–0.15', 42161: '~$0.20–0.60', 43114: '~$0.05–0.20',
    10: '~$0.05–0.15', 324: '~$0.10–0.30', 250: '~$0.01–0.05',
    25: '~$0.01–0.05', 59144: '~$0.05–0.20', 1101: '~$0.05–0.20' };
  el.textContent = gasMap[chainId] || '~$0.05–0.50';
}

/* Render the multi-chain availability table */
function renderMultiChainTab() {
  const tbody = document.getElementById('multichain-tbody');
  if (!tbody) return;

  const rows = Object.entries(EVM_CHAINS).map(([id, chain]) => {
    const cid = parseInt(id);
    const tokens = CHAIN_TOKENS[cid] || [];
    const stables = tokens.filter(t => ['USDC','USDT','DAI','BUSD'].includes(t.symbol));
    const stableStr = stables.map(t =>
      `<span class="pill" style="font-size:10px;padding:1px 6px;background:rgba(38,163,122,0.12);color:#26A17B;border-color:rgba(38,163,122,0.25);">${t.symbol}</span>`
    ).join(' ');
    const nativeToken = tokens.find(t => t.native);
    const gasMap = { 1: 'High', 56: 'Low', 137: 'Very Low', 8453: 'Low',
      42161: 'Low', 43114: 'Low', 10: 'Low', 324: 'Low', 250: 'Very Low',
      25: 'Very Low', 59144: 'Low', 1101: 'Very Low' };
    const gasClass = { High: 'danger', Low: 'info', 'Very Low': 'success' };
    const speedMap = { 1: '~15s', 56: '~3s', 137: '~2s', 8453: '~2s',
      42161: '~1s', 43114: '~2s', 10: '~2s', 324: '~5s', 250: '~1s',
      25: '~6s', 59144: '~3s', 1101: '~2s' };
    const gasLevel = gasMap[cid] || 'Low';
    const gasColor = { High:'#ff5c7a', Low:'#58c5ff', 'Very Low':'#22e7b8' }[gasLevel];
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:9px;">
          <div style="width:10px;height:10px;border-radius:50%;background:${chain.color};flex-shrink:0;"></div>
          <span style="font-weight:700;font-size:13px;">${chain.name}</span>
        </div>
      </td>
      <td>
        <span class="pill" style="font-size:10px;padding:1px 6px;">${nativeToken?.symbol || chain.symbol}</span>
        ${tokens.filter(t => !t.native).map(t =>
          `<span class="pill" style="font-size:10px;padding:1px 6px;background:rgba(88,197,255,0.07);">${t.symbol}</span>`
        ).join(' ')}
      </td>
      <td>${stableStr || '<span style="color:var(--muted-2);font-size:12px;">—</span>'}</td>
      <td>
        <span class="pill" style="font-size:10px;background:rgba(88,197,255,0.08);color:var(--accent);">
          Bridge → ANET L1
        </span>
      </td>
      <td style="color:${gasColor};font-size:12.5px;font-weight:600;">${gasLevel}</td>
      <td style="color:var(--muted);font-size:12px;">${speedMap[cid] || '~3s'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:5px 10px;"
                onclick="setTab('bridge');selectBridgeChain(${cid})">
          Select →
        </button>
      </td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rows;
}

/* ── Slippage ───────────────────────────────── */
function setSlippage(pct) {
  state.slippage = pct;
  document.querySelectorAll('.slip-btn').forEach(b =>
    b.classList.toggle('active', parseFloat(b.dataset.slip) === pct)
  );
}

/* ── Network status bar ─────────────────────── */
async function loadNetworkStats() {
  try {
    const data = await apiFetch('/stats/investor');
    const el = document.getElementById('network-block');
    const supply = document.getElementById('network-supply');
    if (el && data.latest_block_height != null) el.textContent = '#' + data.latest_block_height.toLocaleString();
    if (supply && data.activated_supply_anet) supply.textContent = fmt(parseFloat(data.activated_supply_anet), 0) + ' ANET';
  } catch (_) {}
}

/* ── MetaMask event hooks ───────────────────── */
function initEvmEventListeners() {
  if (!window.ethereum) return;
  window.ethereum.on('accountsChanged', accts => {
    state.evmWallet.address = accts[0] || '';
    state.evmWallet.balance = null;
    refreshEvmBalance();
    updateEvmWalletUI();
  });
  window.ethereum.on('chainChanged', chainHex => {
    state.evmWallet.chainId = parseInt(chainHex, 16);
    refreshEvmBalance();
    updateEvmWalletUI();
  });
}

/* ── Init ───────────────────────────────────── */
async function init() {
  // Check if MetaMask already connected
  if (window.ethereum?.selectedAddress) {
    state.evmWallet.address = window.ethereum.selectedAddress;
    const chainHex = await window.ethereum.request({ method: 'eth_chainId' }).catch(() => '0x38');
    state.evmWallet.chainId = parseInt(chainHex, 16);
    await refreshEvmBalance();
    updateEvmWalletUI();
  }
  initEvmEventListeners();

  // Load pools
  await refreshPools();
  await loadNetworkStats();

  // Set defaults
  if (!state.toToken && state.pools.length > 0) {
    state.toToken = state.pools[0].token_symbol;
  } else if (!state.toToken) {
    state.toToken = 'WBNB';
  }
  renderSwapTokenSelectors();
  renderBridgeUI();
  buildBridgeTokenOptions(state.selectedBridgeChain);
  initCreatePoolHelpers();
  hydrateMarketPairSelector();
  renderMarketMicrostructure();
  refreshMarketActivity();

  // Auto-refresh
  setInterval(refreshPools, 30_000);
  setInterval(loadNetworkStats, 15_000);
  setInterval(refreshMarketActivity, 12_000);
}

document.addEventListener('DOMContentLoaded', init);
