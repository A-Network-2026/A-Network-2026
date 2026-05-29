const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const PI_API_KEY = process.env.PI_API_KEY || '';
const PI_API_BASE_URL = (process.env.PI_API_BASE_URL || 'https://api.minepi.com').replace(/\/$/, '');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const PI_SANDBOX = (process.env.PI_SANDBOX || 'false').toLowerCase() === 'true';
const PI_ENABLE_TEST_ADMIN = (process.env.PI_ENABLE_TEST_ADMIN || (PI_SANDBOX ? 'true' : 'false')).toLowerCase() === 'true';
const PI_ALLOW_TEST_ASSET_MINT = (process.env.PI_ALLOW_TEST_ASSET_MINT || (PI_SANDBOX ? 'true' : 'false')).toLowerCase() === 'true';
const PI_ALLOWED_METADATA_APP = process.env.PI_ALLOWED_METADATA_APP || 'a-network-testnet';
const PI_ALLOWED_METADATA_PURPOSE = process.env.PI_ALLOWED_METADATA_PURPOSE || 'dex-lifetime-unlock';
const PI_ALLOWED_SANDBOX_METADATA_PURPOSE = process.env.PI_ALLOWED_SANDBOX_METADATA_PURPOSE || 'sandbox-test-payment';
const PI_ALLOWED_MEMO_PREFIX = process.env.PI_ALLOWED_MEMO_PREFIX || 'A Network';
const PI_APP_WALLET = process.env.PI_APP_WALLET || '';
const PI_REQUIRED_AMOUNT = Number(process.env.PI_REQUIRED_AMOUNT || 1);
const PI_MIN_AMOUNT = Number(process.env.PI_MIN_AMOUNT || 1);
const PI_MAX_AMOUNT = Number(process.env.PI_MAX_AMOUNT || 1);
const PI_CASHOUT_STATE_PATH = process.env.PI_CASHOUT_STATE_PATH || path.join(__dirname, '..', 'data', 'dex-access-state.json');
const PI_ADMIN_KEY = process.env.PI_ADMIN_KEY || '';
const ANET_CHAIN_API_BASE_URL = (process.env.ANET_CHAIN_API_BASE_URL || '').replace(/\/$/, '');
const ANET_CHAIN_API_FALLBACK_BASE_URL = (process.env.ANET_CHAIN_API_FALLBACK_BASE_URL || '').replace(/\/$/, '');
const ANET_L1_DEX_ADMIN_KEY = process.env.ANET_L1_DEX_ADMIN_KEY || '';
const PI_REQUIRED_SESSIONS = Number(process.env.PI_REQUIRED_SESSIONS || 1000);
const PI_ALLOW_INELIGIBLE_FOR_DEX_TEST = (process.env.PI_ALLOW_INELIGIBLE_FOR_DEX_TEST || 'false').toLowerCase() === 'true';
const ANET_TESTNET_COIN_LABEL = process.env.ANET_TESTNET_COIN_LABEL || 'ANET_TEST';
const ANET_MAINNET_COIN_LABEL = process.env.ANET_MAINNET_COIN_LABEL || 'ANET';
const PI_ENFORCE_PRIMARY_WALLET_BINDING = (process.env.PI_ENFORCE_PRIMARY_WALLET_BINDING || 'true').toLowerCase() === 'true';
const BTC_RPC_URL = String(process.env.BTC_RPC_URL || '').trim();
const BTC_RPC_USER = String(process.env.BTC_RPC_USER || '').trim();
const BTC_RPC_PASSWORD = String(process.env.BTC_RPC_PASSWORD || '').trim();
const BTC_NETWORK = String(process.env.BTC_NETWORK || 'mainnet').trim().toLowerCase();
const BTC_REQUIRED_CONFIRMATIONS = Math.max(1, Number(process.env.BTC_REQUIRED_CONFIRMATIONS || 1));
const BTC_EXPLORER_BASE_URL = String(process.env.BTC_EXPLORER_BASE_URL || '').trim().replace(/\/$/, '');
const BTC_ENABLE_TEST_ADMIN = (process.env.BTC_ENABLE_TEST_ADMIN || 'false').toLowerCase() === 'true';
const NFT_DB_PATH = process.env.NFT_DB_PATH || path.join(__dirname, '..', 'data', 'nft-identity.db');
const NFT_MIN_PROFILE_ANTS = Math.max(1, Number(process.env.NFT_MIN_PROFILE_ANTS || 1000));
const NFT_MAX_BIO_LENGTH = Math.max(80, Number(process.env.NFT_MAX_BIO_LENGTH || 280));
const NFT_DOMAIN_MIN_BID_ANTS = Math.max(10000, Number(process.env.NFT_DOMAIN_MIN_BID_ANTS || 10000));
const AI_OWNER_WALLET = String(process.env.AI_OWNER_WALLET || process.env.PI_APP_WALLET || '').trim().toUpperCase();
const AI_OWNER_WALLET_SOURCE = process.env.AI_OWNER_WALLET
  ? 'AI_OWNER_WALLET'
  : (process.env.PI_APP_WALLET ? 'PI_APP_WALLET' : 'none');
const API_JSON_LIMIT = String(process.env.API_JSON_LIMIT || '128kb').trim();
const API_RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000));
const API_RATE_LIMIT_MAX = Math.max(30, Number(process.env.API_RATE_LIMIT_MAX || 300));
const ADMIN_RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || 60_000));
const ADMIN_RATE_LIMIT_MAX = Math.max(3, Number(process.env.ADMIN_RATE_LIMIT_MAX || 20));
const PI_TEST_ADMIN_ALLOWED_IPS = String(process.env.PI_TEST_ADMIN_ALLOWED_IPS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

// Normalize an IP string: strip IPv6-mapped IPv4 prefix (::ffff:1.2.3.4 → 1.2.3.4).
function normalizeIp(ip) {
  const s = String(ip || '').trim();
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : s;
}

// Convert a dotted IPv4 string to a 32-bit unsigned integer, or null if invalid.
function ipv4ToInt(ip) {
  const parts = normalizeIp(ip).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    value = (value * 256) + n;
  }
  return value >>> 0;
}

// True if `ip` matches an allowlist entry. Entries may be an exact IPv4
// address (e.g. "1.2.3.4") or a CIDR range (e.g. "74.220.50.0/24").
function ipMatchesEntry(ip, entry) {
  const target = normalizeIp(ip);
  const trimmed = String(entry || '').trim();
  if (!trimmed) return false;
  if (!trimmed.includes('/')) {
    return target === trimmed;
  }
  const [range, bitsRaw] = trimmed.split('/');
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(target);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

// True if `ip` is allowed by any entry in the allowlist (exact or CIDR).
function isIpAllowed(ip, allowlist) {
  return allowlist.some((entry) => ipMatchesEntry(ip, entry));
}

// ── EVM Bridge config ──────────────────────────────────────────────────────
// The bsc-relayer service is the authoritative writer for EVM → L1 swaps.
// pi-backend only needs read-side config: RPC URLs (for /api/evm/activity's
// receipt check) and explorer/symbol tables (for the legacy /history route).
//
// Removed in the bridge-migration commit (no longer read anywhere):
//   EVM_BRIDGE_CONTRACTS (env: EVM_BRIDGE_CONTRACT_BSC, …)
//   EVM_BRIDGE_ADMIN_KEY (env: EVM_BRIDGE_ADMIN_KEY)

// JSON-RPC node URLs per chainId
const EVM_RPC_URLS = {
  56:    String(process.env.EVM_RPC_BSC       || 'https://bsc-dataseed1.binance.org').trim(),
  97:    String(process.env.EVM_RPC_BSC_TEST  || 'https://data-seed-prebsc-1-s1.binance.org:8545').trim(),
  1:     String(process.env.EVM_RPC_ETH       || 'https://eth.llamarpc.com').trim(),
  137:   String(process.env.EVM_RPC_POLYGON   || 'https://polygon-rpc.com').trim(),
  8453:  String(process.env.EVM_RPC_BASE      || 'https://mainnet.base.org').trim(),
};
// Block explorer TX URL builders per chainId
const EVM_EXPLORER_TX = {
  56:    'https://bscscan.com/tx/',
  97:    'https://testnet.bscscan.com/tx/',
  1:     'https://etherscan.io/tx/',
  137:   'https://polygonscan.com/tx/',
  8453:  'https://basescan.org/tx/',
};
// Native token symbol per chainId (used in history formatting)
const EVM_NATIVE_SYMBOL = {
  56: 'BNB', 97: 'tBNB', 1: 'ETH', 137: 'MATIC', 8453: 'ETH',
};

let nftDb = null;

if (!PI_API_KEY) {
  console.warn('[WARN] PI_API_KEY is not set. Pi API calls will fail until configured.');
}

function initialState() {
  return {
    lifetimeUnlocks: {},
    cashoutRequests: [],
    settlementTransactions: [],
    walletBindings: {},
    btcPaymentRequests: {},
    btcSettlementTransactions: [],
    evmBridgeRequests: {}
  };
}

function ensureStateDirectory() {
  fs.mkdirSync(path.dirname(PI_CASHOUT_STATE_PATH), { recursive: true });
}

function loadState() {
  try {
    ensureStateDirectory();
    if (!fs.existsSync(PI_CASHOUT_STATE_PATH)) {
      return initialState();
    }

    const parsed = JSON.parse(fs.readFileSync(PI_CASHOUT_STATE_PATH, 'utf8'));
    return {
      lifetimeUnlocks: parsed?.lifetimeUnlocks && typeof parsed.lifetimeUnlocks === 'object' ? parsed.lifetimeUnlocks : {},
      cashoutRequests: Array.isArray(parsed?.cashoutRequests) ? parsed.cashoutRequests : [],
      settlementTransactions: Array.isArray(parsed?.settlementTransactions) ? parsed.settlementTransactions : [],
      walletBindings: parsed?.walletBindings && typeof parsed.walletBindings === 'object' ? parsed.walletBindings : {},
      btcPaymentRequests: parsed?.btcPaymentRequests && typeof parsed.btcPaymentRequests === 'object' ? parsed.btcPaymentRequests : {},
      btcSettlementTransactions: Array.isArray(parsed?.btcSettlementTransactions) ? parsed.btcSettlementTransactions : [],
      evmBridgeRequests: parsed?.evmBridgeRequests && typeof parsed.evmBridgeRequests === 'object' ? parsed.evmBridgeRequests : {}
    };
  } catch (error) {
    console.warn(`[WARN] Failed to read DEX state: ${error.message}`);
    return initialState();
  }
}

const cashoutState = loadState();

function persistState() {
  ensureStateDirectory();
  const tempPath = `${PI_CASHOUT_STATE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(cashoutState, null, 2));
  fs.renameSync(tempPath, PI_CASHOUT_STATE_PATH);
}

function normalizePiUid(uid) {
  return String(uid || '').trim();
}

function normalizeAnetProfileId(value) {
  return normalizePiUid(value);
}

function getAnetProfileIdFromBody(body) {
  return normalizeAnetProfileId(body?.anet_profile_id || body?.profile_id || body?.uid);
}

function normalizePositiveInteger(value) {
  const amount = Number(value);
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return fallback;
  }
  return Math.floor(amount);
}

function safeIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Constant-time key comparison to prevent timing oracle attacks on admin endpoints.
function safeKeyEqual(provided, expected) {
  if (!provided || !expected) return false;
  try {
    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length) {
      // Still invoke timingSafeEqual to avoid length-based timing leak, then return false.
      crypto.timingSafeEqual(Buffer.alloc(a.length, 0), Buffer.alloc(a.length, 1));
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function ensureNftDbDirectory() {
  fs.mkdirSync(path.dirname(NFT_DB_PATH), { recursive: true });
}

function createSqliteConnection(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (error) => {
      if (error) {
        return reject(error);
      }
      resolve(db);
    });
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        return reject(error);
      }
      return resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        return reject(error);
      }
      return resolve(row || null);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        return reject(error);
      }
      return resolve(Array.isArray(rows) ? rows : []);
    });
  });
}

async function initializeNftDatabase() {
  ensureNftDbDirectory();
  nftDb = await createSqliteConnection(NFT_DB_PATH);

  await dbRun(nftDb, `
    CREATE TABLE IF NOT EXISTS nft_profiles (
      uid TEXT PRIMARY KEY,
      username TEXT DEFAULT '',
      wallet_address TEXT DEFAULT '',
      display_name TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      avatar_uri TEXT DEFAULT '',
      banner_uri TEXT DEFAULT '',
      theme_json TEXT DEFAULT '{}',
      ants_balance INTEGER DEFAULT 0,
      profile_nft_id TEXT,
      profile_created_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await dbRun(nftDb, `
    CREATE TABLE IF NOT EXISTS nft_assets (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      slug TEXT DEFAULT '',
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      image_uri TEXT DEFAULT '',
      metadata_uri TEXT DEFAULT '',
      traits_json TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active',
      ants_stake INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(uid) REFERENCES nft_profiles(uid)
    )
  `);

  await dbRun(nftDb, `
    CREATE TABLE IF NOT EXISTS nft_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL,
      event_type TEXT NOT NULL,
      details_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(uid) REFERENCES nft_profiles(uid)
    )
  `);

  await dbRun(nftDb, `
    CREATE TABLE IF NOT EXISTS nft_market_listings (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      seller_uid TEXT NOT NULL,
      listing_type TEXT NOT NULL,
      ask_price_ants INTEGER DEFAULT 0,
      min_bid_ants INTEGER DEFAULT 0,
      buy_now_price_ants INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      winner_uid TEXT DEFAULT '',
      final_price_ants INTEGER DEFAULT 0,
      start_at TEXT NOT NULL,
      end_at TEXT,
      sold_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(asset_id) REFERENCES nft_assets(id),
      FOREIGN KEY(seller_uid) REFERENCES nft_profiles(uid)
    )
  `);

  await dbRun(nftDb, `
    CREATE TABLE IF NOT EXISTS nft_market_bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id TEXT NOT NULL,
      bidder_uid TEXT NOT NULL,
      amount_ants INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(listing_id) REFERENCES nft_market_listings(id),
      FOREIGN KEY(bidder_uid) REFERENCES nft_profiles(uid)
    )
  `);

  await dbRun(nftDb, 'CREATE INDEX IF NOT EXISTS idx_nft_assets_uid ON nft_assets(uid)');
  await dbRun(nftDb, 'CREATE INDEX IF NOT EXISTS idx_nft_activity_uid ON nft_activity(uid)');
  await dbRun(nftDb, 'CREATE INDEX IF NOT EXISTS idx_nft_market_listings_status ON nft_market_listings(status)');
  await dbRun(nftDb, 'CREATE INDEX IF NOT EXISTS idx_nft_market_listings_asset ON nft_market_listings(asset_id)');
  await dbRun(nftDb, 'CREATE INDEX IF NOT EXISTS idx_nft_market_bids_listing ON nft_market_bids(listing_id)');

  await dbRun(nftDb, `
    CREATE TABLE IF NOT EXISTS ai_training_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      source_page TEXT DEFAULT '',
      prompt_text TEXT NOT NULL,
      response_text TEXT NOT NULL,
      tags_json TEXT DEFAULT '[]',
      is_public INTEGER DEFAULT 0,
      approved_by_owner INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await dbRun(nftDb, 'CREATE INDEX IF NOT EXISTS idx_ai_training_uid ON ai_training_data(uid)');
  await dbRun(nftDb, 'CREATE INDEX IF NOT EXISTS idx_ai_training_public ON ai_training_data(is_public, approved_by_owner)');

  // --- Genesis + Colony Domain migrations (safe ALTER TABLE) ---
  const existingAssetCols = await dbAll(nftDb, `PRAGMA table_info(nft_assets)`, []);
  const assetColNames = existingAssetCols.map((c) => c.name);
  const assetMigrations = [
    ['asset_type', `ALTER TABLE nft_assets ADD COLUMN asset_type TEXT DEFAULT 'standard'`],
    ['collection_id', `ALTER TABLE nft_assets ADD COLUMN collection_id TEXT DEFAULT NULL`],
    ['serial_number', `ALTER TABLE nft_assets ADD COLUMN serial_number INTEGER DEFAULT NULL`],
    ['domain_name', `ALTER TABLE nft_assets ADD COLUMN domain_name TEXT DEFAULT NULL`],
    ['colony_description', `ALTER TABLE nft_assets ADD COLUMN colony_description TEXT DEFAULT ''`],
    ['colony_logo_uri', `ALTER TABLE nft_assets ADD COLUMN colony_logo_uri TEXT DEFAULT ''`],
    ['colony_banner_uri', `ALTER TABLE nft_assets ADD COLUMN colony_banner_uri TEXT DEFAULT ''`],
    ['colony_links_json', `ALTER TABLE nft_assets ADD COLUMN colony_links_json TEXT DEFAULT '{}'`],
    ['colony_theme_json', `ALTER TABLE nft_assets ADD COLUMN colony_theme_json TEXT DEFAULT '{}'`],
    ['holder_tier', `ALTER TABLE nft_assets ADD COLUMN holder_tier TEXT DEFAULT 'worker'`],
    ['utility_flags_json', `ALTER TABLE nft_assets ADD COLUMN utility_flags_json TEXT DEFAULT '{}'`]
  ];
  for (const [col, sql] of assetMigrations) {
    if (!assetColNames.includes(col)) {
      await dbRun(nftDb, sql);
    }
  }

  await dbRun(nftDb, `
    CREATE TABLE IF NOT EXISTS nft_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT DEFAULT '',
      description TEXT DEFAULT '',
      collection_type TEXT DEFAULT 'standard',
      max_supply INTEGER DEFAULT 0,
      current_supply INTEGER DEFAULT 0,
      image_uri TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await dbRun(nftDb, 'CREATE INDEX IF NOT EXISTS idx_nft_collections_slug ON nft_collections(slug)');
  await dbRun(nftDb, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_nft_assets_domain_name ON nft_assets(domain_name) WHERE domain_name IS NOT NULL');

  // Seed Genesis Ants collection if not present
  const existingGenesis = await dbGet(nftDb, `SELECT id FROM nft_collections WHERE slug = 'genesis-ants'`, []);
  if (!existingGenesis) {
    const now = new Date().toISOString();
    await dbRun(nftDb,
      `INSERT INTO nft_collections (id, name, slug, description, collection_type, max_supply, current_supply, image_uri, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `col_genesis_ants`,
        'Genesis Ants',
        'genesis-ants',
        'The original 100 Genesis Ants — the founding colony of A Network. Capped forever at 100. Holders gain Architect-tier access, boosted rewards, and governance weight.',
        'genesis',
        100,
        0,
        'https://a-network.net/assets/Ant-001-NFT.png',
        now,
        now
      ]
    );
    console.log('[NFT] Genesis Ants collection seeded.');
  }
}

function requireNftDatabase(res) {
  if (!nftDb) {
    res.status(503).json({ ok: false, error: 'NFT database is not initialized' });
    return false;
  }
  return true;
}

function normalizeShortText(value, maxLength = 64) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeUri(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeThemeJson(value) {
  if (value == null) {
    return '{}';
  }
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return '{}';
    }
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '{}';
    }
  }
  return '{}';
}

function normalizeTraitsJson(value) {
  if (value == null) {
    return '[]';
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(Array.isArray(parsed) ? parsed : []);
    } catch {
      return '[]';
    }
  }
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[]';
    }
  }
  return '[]';
}

function parseJsonSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function mapNftProfileRow(row) {
  if (!row) {
    return null;
  }
  const anetProfileId = normalizeAnetProfileId(row.uid);
  return {
    uid: anetProfileId,
    anetProfileId,
    username: String(row.username || '').trim(),
    walletAddress: String(row.wallet_address || '').trim().toUpperCase(),
    displayName: String(row.display_name || '').trim(),
    bio: String(row.bio || '').trim(),
    avatarUri: String(row.avatar_uri || '').trim(),
    bannerUri: String(row.banner_uri || '').trim(),
    theme: parseJsonSafe(row.theme_json, {}),
    antsBalance: normalizeNonNegativeInteger(row.ants_balance, 0),
    profileNftId: String(row.profile_nft_id || '').trim() || null,
    profileCreatedAt: safeIsoDate(row.profile_created_at),
    createdAt: safeIsoDate(row.created_at),
    updatedAt: safeIsoDate(row.updated_at)
  };
}

function mapNftAssetRow(row) {
  if (!row) {
    return null;
  }
  const anetProfileId = normalizeAnetProfileId(row.uid);
  const assetType = String(row.asset_type || 'standard').trim().toLowerCase();
  const domainName = String(row.domain_name || '').trim().toLowerCase() || null;
  return {
    id: String(row.id || '').trim(),
    uid: anetProfileId,
    anetProfileId,
    slug: String(row.slug || '').trim(),
    name: String(row.name || '').trim(),
    description: String(row.description || '').trim(),
    imageUri: String(row.image_uri || '').trim(),
    metadataUri: String(row.metadata_uri || '').trim(),
    traits: parseJsonSafe(row.traits_json, []),
    status: String(row.status || 'active').trim(),
    antsStake: normalizeNonNegativeInteger(row.ants_stake, 0),
    createdAt: safeIsoDate(row.created_at),
    updatedAt: safeIsoDate(row.updated_at),
    assetType,
    collectionId: String(row.collection_id || '').trim() || null,
    serialNumber: row.serial_number != null ? Number(row.serial_number) : null,
    domainName,
    isDomain: assetType === 'domain' || (domainName !== null),
    isGenesis: assetType === 'genesis',
    colony: {
      description: String(row.colony_description || '').trim(),
      logoUri: String(row.colony_logo_uri || '').trim(),
      bannerUri: String(row.colony_banner_uri || '').trim(),
      links: parseJsonSafe(row.colony_links_json, {}),
      theme: parseJsonSafe(row.colony_theme_json, {})
    },
    holderTier: String(row.holder_tier || 'worker').trim().toLowerCase(),
    utilityFlags: parseJsonSafe(row.utility_flags_json, {})
  };
}

function mapNftMarketListingRow(row) {
  if (!row) {
    return null;
  }

  const startAt = safeIsoDate(row.start_at);
  const endAt = safeIsoDate(row.end_at);
  const now = Date.now();
  const isExpired = Boolean(endAt && Date.parse(endAt) <= now && String(row.status || '') === 'active');

  return {
    id: String(row.id || '').trim(),
    assetId: String(row.asset_id || '').trim(),
    sellerUid: normalizeAnetProfileId(row.seller_uid),
    listingType: String(row.listing_type || '').trim().toLowerCase(),
    askPriceAnts: normalizeNonNegativeInteger(row.ask_price_ants, 0),
    minBidAnts: normalizeNonNegativeInteger(row.min_bid_ants, 0),
    buyNowPriceAnts: normalizeNonNegativeInteger(row.buy_now_price_ants, 0),
    status: String(row.status || '').trim().toLowerCase(),
    winnerUid: normalizeAnetProfileId(row.winner_uid),
    finalPriceAnts: normalizeNonNegativeInteger(row.final_price_ants, 0),
    startAt,
    endAt,
    soldAt: safeIsoDate(row.sold_at),
    createdAt: safeIsoDate(row.created_at),
    updatedAt: safeIsoDate(row.updated_at),
    highestBidAnts: normalizeNonNegativeInteger(row.highest_bid_ants, 0),
    bidCount: normalizeNonNegativeInteger(row.bid_count, 0),
    asset: {
      id: String(row.asset_id || '').trim(),
      uid: normalizeAnetProfileId(row.asset_owner_uid),
      anetProfileId: normalizeAnetProfileId(row.asset_owner_uid),
      slug: String(row.asset_slug || '').trim(),
      name: String(row.asset_name || '').trim(),
      description: String(row.asset_description || '').trim(),
      imageUri: String(row.asset_image_uri || '').trim(),
      metadataUri: String(row.asset_metadata_uri || '').trim(),
      traits: parseJsonSafe(row.asset_traits_json, []),
      status: String(row.asset_status || 'active').trim(),
      antsStake: normalizeNonNegativeInteger(row.asset_ants_stake, 0),
      createdAt: safeIsoDate(row.asset_created_at),
      updatedAt: safeIsoDate(row.asset_updated_at),
      assetType: String(row.asset_type_col || 'standard').trim().toLowerCase(),
      domainName: String(row.asset_domain_name || '').trim().toLowerCase() || null,
      isDomain: String(row.asset_type_col || '').trim().toLowerCase() === 'domain' || String(row.asset_domain_name || '').trim().length > 0,
      isGenesis: String(row.asset_type_col || '').trim().toLowerCase() === 'genesis',
      colony: {
        description: String(row.asset_colony_description || '').trim(),
        logoUri: String(row.asset_colony_logo_uri || '').trim(),
        bannerUri: String(row.asset_colony_banner_uri || '').trim(),
        links: parseJsonSafe(row.asset_colony_links_json, {}),
        theme: parseJsonSafe(row.asset_colony_theme_json, {})
      },
      holderTier: String(row.asset_holder_tier || 'worker').trim().toLowerCase(),
      serialNumber: row.asset_serial_number != null ? Number(row.asset_serial_number) : null
    },
    sellerDisplayName: normalizeShortText(row.seller_display_name || row.seller_username || row.seller_uid, 80),
    isExpired
  };
}

function mapNftMarketBidRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: normalizeNonNegativeInteger(row.id, 0),
    listingId: String(row.listing_id || '').trim(),
    bidderUid: normalizeAnetProfileId(row.bidder_uid),
    bidderDisplayName: normalizeShortText(row.bidder_display_name || row.bidder_username || row.bidder_uid, 80),
    amountAnts: normalizeNonNegativeInteger(row.amount_ants, 0),
    createdAt: safeIsoDate(row.created_at)
  };
}

function isDomainAsset(assetRow) {
  const slug = String(assetRow?.slug || '').trim().toLowerCase();
  const name = String(assetRow?.name || '').trim().toLowerCase();
  return slug.endsWith('.ant') || name.endsWith('.ant');
}

async function getMarketListingById(listingId) {
  const row = await dbGet(
    nftDb,
    `SELECT l.*, a.uid AS asset_owner_uid, a.slug AS asset_slug, a.name AS asset_name,
            a.description AS asset_description, a.image_uri AS asset_image_uri,
            a.metadata_uri AS asset_metadata_uri, a.traits_json AS asset_traits_json,
            a.status AS asset_status, a.ants_stake AS asset_ants_stake,
            a.created_at AS asset_created_at, a.updated_at AS asset_updated_at,
            a.asset_type AS asset_type_col, a.domain_name AS asset_domain_name,
            a.colony_description AS asset_colony_description,
            a.colony_logo_uri AS asset_colony_logo_uri,
            a.colony_banner_uri AS asset_colony_banner_uri,
            a.colony_links_json AS asset_colony_links_json,
            a.colony_theme_json AS asset_colony_theme_json,
            a.holder_tier AS asset_holder_tier,
            a.serial_number AS asset_serial_number,
            p.display_name AS seller_display_name, p.username AS seller_username,
            IFNULL(b.bid_count, 0) AS bid_count, IFNULL(b.highest_bid_ants, 0) AS highest_bid_ants
     FROM nft_market_listings l
     LEFT JOIN nft_assets a ON a.id = l.asset_id
     LEFT JOIN nft_profiles p ON p.uid = l.seller_uid
     LEFT JOIN (
       SELECT listing_id, COUNT(*) AS bid_count, MAX(amount_ants) AS highest_bid_ants
       FROM nft_market_bids
       GROUP BY listing_id
     ) b ON b.listing_id = l.id
     WHERE l.id = ?`,
    [String(listingId || '').trim()]
  );
  return mapNftMarketListingRow(row);
}

async function settleMarketListing(listingId, buyerUid, finalPriceAnts) {
  const listing = await getMarketListingById(listingId);
  if (!listing) {
    throw new Error('Listing not found');
  }
  if (listing.status !== 'active') {
    throw new Error('Listing is not active');
  }

  const buyerProfileId = normalizeAnetProfileId(buyerUid);
  const buyerProfile = await getNftProfile(buyerProfileId);
  if (!buyerProfile) {
    throw new Error('Buyer ANET profile not found');
  }

  const now = new Date().toISOString();
  await dbRun(
    nftDb,
    `UPDATE nft_market_listings
     SET status = 'sold', winner_uid = ?, final_price_ants = ?, sold_at = ?, updated_at = ?
     WHERE id = ?`,
    [buyerProfileId, normalizeNonNegativeInteger(finalPriceAnts, 0), now, now, listing.id]
  );

  await dbRun(
    nftDb,
    'UPDATE nft_assets SET uid = ?, status = ?, updated_at = ? WHERE id = ?',
    [buyerProfileId, 'active', now, listing.assetId]
  );

  await appendNftActivity(listing.sellerUid, 'NFT_SOLD', {
    listingId: listing.id,
    assetId: listing.assetId,
    buyerUid: buyerProfileId,
    finalPriceAnts: normalizeNonNegativeInteger(finalPriceAnts, 0)
  });

  await appendNftActivity(buyerProfileId, 'NFT_BOUGHT', {
    listingId: listing.id,
    assetId: listing.assetId,
    sellerUid: listing.sellerUid,
    finalPriceAnts: normalizeNonNegativeInteger(finalPriceAnts, 0)
  });

  return getMarketListingById(listing.id);
}

async function getNftProfile(uid) {
  const row = await dbGet(nftDb, 'SELECT * FROM nft_profiles WHERE uid = ?', [normalizePiUid(uid)]);
  return mapNftProfileRow(row);
}

function hasDexCashoutHistory(uid) {
  const profileId = normalizeAnetProfileId(uid);
  return (cashoutState.cashoutRequests || []).some((entry) => normalizeAnetProfileId(entry?.uid) === profileId);
}

async function requireNftActivationByCashout(uid) {
  const profileId = normalizeAnetProfileId(uid);
  // In test mode, bypass cashout requirement for NFT activation
  if (!PI_ALLOW_INELIGIBLE_FOR_DEX_TEST && !hasDexCashoutHistory(profileId)) {
    return {
      ok: false,
      status: 403,
      error: 'NFT is activated only after first successful cashout/swap. Complete a DEX cashout flow first.'
    };
  }

  return {
    ok: true,
    testModeBypass: PI_ALLOW_INELIGIBLE_FOR_DEX_TEST
  };
}

async function ensureCashoutActivatedNftProfile(uid, username, walletAddress) {
  const profileId = normalizeAnetProfileId(uid);
  if (!profileId) {
    return null;
  }

  const existing = await getNftProfile(profileId);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const normalizedWallet = String(walletAddress || '').trim().toUpperCase();
  const normalizedUsername = normalizeShortText(username, 80);
  const displayName = normalizeShortText(username || profileId, 80);

  await dbRun(
    nftDb,
    `INSERT INTO nft_profiles (
      uid, username, wallet_address, display_name, bio, avatar_uri, banner_uri,
      theme_json, ants_balance, profile_nft_id, profile_created_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      profileId,
      normalizedUsername,
      normalizedWallet,
      displayName,
      'Cashout-activated NFT profile',
      '',
      '',
      '{}',
      0,
      `nft_profile_${profileId}_${Date.now()}`,
      now,
      now,
      now
    ]
  );

  await appendNftActivity(profileId, 'PROFILE_ACTIVATED_BY_CASHOUT', {
    username: normalizedUsername,
    walletAddress: normalizedWallet
  });

  return getNftProfile(profileId);
}

async function appendNftActivity(uid, eventType, details = {}) {
  const now = new Date().toISOString();
  await dbRun(
    nftDb,
    'INSERT INTO nft_activity (uid, event_type, details_json, created_at) VALUES (?, ?, ?, ?)',
    [normalizePiUid(uid), normalizeShortText(eventType, 64), JSON.stringify(details || {}), now]
  );
}

function normalizeDirection(anetToToken) {
  return anetToToken ? 'ANET_TO_TOKEN' : 'TOKEN_TO_ANET';
}

function getPiExplorerTransactionUrl(txid) {
  const value = String(txid || '').trim();
  if (!value) {
    return null;
  }

  const path = PI_SANDBOX ? 'testnet' : 'mainnet';
  return `https://blockexplorer.minepi.com/${path}/transactions/${encodeURIComponent(value)}`;
}

function resolveBtcExplorerBaseUrl() {
  if (BTC_EXPLORER_BASE_URL) {
    return BTC_EXPLORER_BASE_URL;
  }
  if (BTC_NETWORK === 'testnet') {
    return 'https://mempool.space/testnet';
  }
  if (BTC_NETWORK === 'signet') {
    return 'https://mempool.space/signet';
  }
  return 'https://mempool.space';
}

function getBtcExplorerTransactionUrl(txid) {
  const value = String(txid || '').trim();
  if (!value) {
    return null;
  }
  return `${resolveBtcExplorerBaseUrl()}/tx/${encodeURIComponent(value)}`;
}

function getBtcExplorerAddressUrl(address) {
  const value = String(address || '').trim();
  if (!value) {
    return null;
  }
  return `${resolveBtcExplorerBaseUrl()}/address/${encodeURIComponent(value)}`;
}

function formatBtcAmountFromSats(sats) {
  const value = Number.isFinite(Number(sats)) ? Number(sats) : 0;
  return (value / 100000000).toFixed(8);
}

function parseBtcToSats(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const normalized = text.replace(/,/g, '');
  if (!/^\d+(\.\d{1,8})?$/.test(normalized)) {
    return null;
  }

  const [wholePart, fracPartRaw = ''] = normalized.split('.');
  const fracPart = `${fracPartRaw}00000000`.slice(0, 8);
  const whole = BigInt(wholePart || '0');
  const fractional = BigInt(fracPart || '0');
  const sats = (whole * 100000000n) + fractional;
  if (sats <= 0n) {
    return null;
  }
  if (sats > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(sats);
}

function ensureBtcCollections() {
  if (!cashoutState.btcPaymentRequests || typeof cashoutState.btcPaymentRequests !== 'object') {
    cashoutState.btcPaymentRequests = {};
  }
  if (!Array.isArray(cashoutState.btcSettlementTransactions)) {
    cashoutState.btcSettlementTransactions = [];
  }
}

function saveBtcPaymentRequest(record) {
  ensureBtcCollections();
  cashoutState.btcPaymentRequests[String(record.id)] = record;
  persistState();
  return record;
}

function getBtcPaymentRequest(requestId) {
  ensureBtcCollections();
  return cashoutState.btcPaymentRequests[String(requestId || '').trim()] || null;
}

function recentBtcPaymentProof(limit = 30) {
  ensureBtcCollections();
  return Object.values(cashoutState.btcPaymentRequests || {})
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      id: String(entry.id || '').trim() || null,
      uid: normalizePiUid(entry.uid),
      username: String(entry.username || '').trim(),
      address: String(entry.address || '').trim(),
      amountBtc: String(entry.amountBtc || '').trim() || formatBtcAmountFromSats(entry.amountSats),
      amountSats: normalizePositiveInteger(entry.amountSats),
      status: String(entry.status || 'pending').trim().toLowerCase(),
      txid: String(entry.txid || '').trim() || null,
      confirmations: Number.isFinite(Number(entry.confirmations)) ? Number(entry.confirmations) : 0,
      createdAt: safeIsoDate(entry.createdAt),
      verifiedAt: safeIsoDate(entry.verifiedAt),
      expiresAt: safeIsoDate(entry.expiresAt),
      btcExplorerTransactionUrl: getBtcExplorerTransactionUrl(entry.txid),
      btcExplorerAddressUrl: getBtcExplorerAddressUrl(entry.address)
    }))
    .sort((left, right) => {
      const leftTs = left.createdAt ? Date.parse(left.createdAt) : 0;
      const rightTs = right.createdAt ? Date.parse(right.createdAt) : 0;
      return rightTs - leftTs;
    })
    .slice(0, limit);
}

function ensureBtcRpcConfigured() {
  if (!BTC_RPC_URL || !BTC_RPC_USER || !BTC_RPC_PASSWORD) {
    const error = new Error('BTC RPC is not configured. Set BTC_RPC_URL, BTC_RPC_USER, and BTC_RPC_PASSWORD.');
    error.status = 503;
    throw error;
  }
}

async function bitcoinRpc(method, params = []) {
  ensureBtcRpcConfigured();

  const response = await fetch(BTC_RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${BTC_RPC_USER}:${BTC_RPC_PASSWORD}`).toString('base64')}`
    },
    body: JSON.stringify({
      jsonrpc: '1.0',
      id: `btc_${Date.now()}`,
      method,
      params
    })
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`Bitcoin RPC failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  if (body?.error) {
    const message = String(body.error?.message || 'Bitcoin RPC error');
    const error = new Error(message);
    error.status = 502;
    error.body = body;
    throw error;
  }

  return body?.result;
}

async function evaluateBtcTransactionForRequest(requestRecord, txid) {
  const normalizedTxid = String(txid || '').trim();
  if (!normalizedTxid) {
    const error = new Error('txid is required');
    error.status = 400;
    throw error;
  }

  const tx = await bitcoinRpc('gettransaction', [normalizedTxid, true]);
  const confirmations = Number.isFinite(Number(tx?.confirmations)) ? Number(tx.confirmations) : 0;
  const details = Array.isArray(tx?.details) ? tx.details : [];
  const expectedAddress = String(requestRecord?.address || '').trim();

  let receivedBtc = 0;
  for (const detail of details) {
    const category = String(detail?.category || '').trim().toLowerCase();
    const amount = Number(detail?.amount || 0);
    const address = String(detail?.address || '').trim();
    if ((category === 'receive' || amount > 0) && amount > 0) {
      if (!expectedAddress || address === expectedAddress) {
        receivedBtc += amount;
      }
    }
  }

  if (receivedBtc <= 0 && Number(tx?.amount || 0) > 0) {
    receivedBtc = Number(tx.amount);
  }

  const receivedSats = Math.max(0, Math.round(receivedBtc * 100000000));
  const expectedSats = Number.isFinite(Number(requestRecord?.amountSats)) ? Number(requestRecord.amountSats) : 0;
  const paidEnough = expectedSats > 0 ? receivedSats >= expectedSats : receivedSats > 0;
  const confirmed = paidEnough && confirmations >= BTC_REQUIRED_CONFIRMATIONS;

  return {
    txid: normalizedTxid,
    confirmations,
    requiredConfirmations: BTC_REQUIRED_CONFIRMATIONS,
    receivedSats,
    receivedBtc: formatBtcAmountFromSats(receivedSats),
    expectedSats,
    expectedBtc: formatBtcAmountFromSats(expectedSats),
    paidEnough,
    confirmed,
    status: confirmed ? 'confirmed' : (paidEnough ? 'seen' : 'pending'),
    btcExplorerTransactionUrl: getBtcExplorerTransactionUrl(normalizedTxid)
  };
}

function recentUnlockProof(limit = 20) {
  return Object.values(cashoutState.lifetimeUnlocks || {})
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      uid: normalizePiUid(entry.uid),
      username: String(entry.username || '').trim(),
      unlocked: Boolean(entry.unlocked),
      unlockedAt: safeIsoDate(entry.unlockedAt),
      paymentId: String(entry.paymentId || '').trim() || null,
      txid: String(entry.txid || '').trim() || null,
      piExplorerTransactionUrl: getPiExplorerTransactionUrl(entry.txid)
    }))
    .sort((left, right) => {
      const leftTs = left.unlockedAt ? Date.parse(left.unlockedAt) : 0;
      const rightTs = right.unlockedAt ? Date.parse(right.unlockedAt) : 0;
      return rightTs - leftTs;
    })
    .slice(0, limit);
}

function recentDexProof(limit = 30) {
  return (cashoutState.cashoutRequests || [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      id: String(entry.id || '').trim() || null,
      uid: normalizePiUid(entry.uid),
      username: String(entry.username || '').trim(),
      trader: String(entry.trader || '').trim().toUpperCase(),
      tokenSymbol: String(entry.token_symbol || '').trim().toUpperCase(),
      amountIn: normalizePositiveInteger(entry.amount_in),
      direction: normalizeDirection(Boolean(entry.anet_to_token)),
      requestedAt: safeIsoDate(entry.requestedAt),
      chainResponse: entry.chainResponse && typeof entry.chainResponse === 'object'
        ? {
          pairId: String(entry.chainResponse.pair_id || '').trim() || null,
          amountOut: String(entry.chainResponse.amount_out || '').trim() || null,
          feePaid: String(entry.chainResponse.fee_paid || '').trim() || null
        }
        : null
    }))
    .sort((left, right) => {
      const leftTs = left.requestedAt ? Date.parse(left.requestedAt) : 0;
      const rightTs = right.requestedAt ? Date.parse(right.requestedAt) : 0;
      return rightTs - leftTs;
    })
    .slice(0, limit);
}

function extractPaymentIdentity(payment) {
  const metadata = payment?.metadata && typeof payment.metadata === 'object' ? payment.metadata : {};
  return {
    uid: normalizePiUid(metadata.pi_uid || metadata.uid || payment?.user_uid || payment?.uid),
    username: String(metadata.pi_username || metadata.username || payment?.user_username || payment?.username || '').trim()
  };
}

function getLifetimeUnlock(uid) {
  return cashoutState.lifetimeUnlocks[normalizePiUid(uid)] || null;
}

function upsertLifetimeUnlock(payment, paymentId, txid) {
  const identity = extractPaymentIdentity(payment);
  if (!identity.uid) {
    throw new Error('Payment metadata must include pi_uid for lifetime DEX unlock tracking');
  }

  const existing = getLifetimeUnlock(identity.uid) || {};
  const record = {
    uid: identity.uid,
    username: identity.username || existing.username || '',
    unlocked: true,
    paymentId,
    txid: txid || existing.txid || null,
    amount: Number(payment?.amount || 0),
    memo: String(payment?.memo || ''),
    unlockedAt: existing.unlockedAt || new Date().toISOString()
  };

  cashoutState.lifetimeUnlocks[identity.uid] = record;
  persistState();
  return record;
}

app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN }));
app.disable('x-powered-by');

// Security headers on every response.
app.use((_req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  next();
});

function getClientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').trim();
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return String(req.ip || req.socket?.remoteAddress || '').trim();
}

function createSimpleRateLimiter({ windowMs, max, keyPrefix = 'global' }) {
  const store = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = getClientIp(req) || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const current = store.get(key);

    if (!current || current.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        ok: false,
        error: 'Too many requests. Please retry shortly.'
      });
    }

    current.count += 1;
    store.set(key, current);
    return next();
  };
}

function enforceAdminIpAllowlist(req, res, next) {
  if (!PI_TEST_ADMIN_ALLOWED_IPS.length) {
    if (!PI_SANDBOX) {
      // Non-sandbox: fail-closed when no allowlist is configured to prevent
      // unintended admin access from any IP. Set PI_TEST_ADMIN_ALLOWED_IPS
      // to a comma-separated list of trusted IPs to enable admin access.
      return res.status(403).json({
        ok: false,
        error: 'Admin access requires PI_TEST_ADMIN_ALLOWED_IPS to be configured in this environment'
      });
    }
    // Sandbox mode: allow without IP restriction (admin key still required per endpoint).
    return next();
  }
  const ip = getClientIp(req);
  if (!isIpAllowed(ip, PI_TEST_ADMIN_ALLOWED_IPS)) {
    return res.status(403).json({ ok: false, error: 'Admin endpoint access denied for this IP' });
  }
  return next();
}

const globalRateLimiter = createSimpleRateLimiter({
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  max: API_RATE_LIMIT_MAX,
  keyPrefix: 'global'
});
const adminRateLimiter = createSimpleRateLimiter({
  windowMs: ADMIN_RATE_LIMIT_WINDOW_MS,
  max: ADMIN_RATE_LIMIT_MAX,
  keyPrefix: 'admin'
});

app.use(express.json({ limit: API_JSON_LIMIT }));
app.use(globalRateLimiter);

const nftMinerSessions = new Map();
const NFT_MINER_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function pruneExpiredNftMinerSessions() {
  const now = Date.now();
  for (const [token, session] of nftMinerSessions.entries()) {
    if (!session?.expiresAt || Date.parse(session.expiresAt) <= now) {
      nftMinerSessions.delete(token);
    }
  }
}

function getNftMinerSessionToken(req) {
  const headerToken = String(req.headers?.['x-anet-miner-session'] || '').trim();
  if (headerToken) {
    return headerToken;
  }

  const authHeader = String(req.headers?.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

function createNftMinerSession(uid, username, walletAddress) {
  const token = `nft_miner_${crypto.randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + NFT_MINER_SESSION_TTL_MS).toISOString();
  const session = {
    token,
    uid: normalizeAnetProfileId(uid),
    username: String(username || '').trim(),
    walletAddress: String(walletAddress || '').trim().toUpperCase(),
    createdAt: now.toISOString(),
    expiresAt
  };
  nftMinerSessions.set(token, session);
  return session;
}

function requireNftMinerSession(req, res) {
  pruneExpiredNftMinerSessions();
  const token = getNftMinerSessionToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Miner login required for NFT access' });
    return null;
  }

  const session = nftMinerSessions.get(token);
  if (!session) {
    res.status(401).json({ ok: false, error: 'Invalid or expired miner session. Login again.' });
    return null;
  }
  return session;
}

function requireSessionUidMatch(res, session, requestedUid) {
  const sessionUid = normalizeAnetProfileId(session?.uid);
  const targetUid = normalizeAnetProfileId(requestedUid);
  if (!sessionUid || !targetUid || sessionUid !== targetUid) {
    res.status(403).json({ ok: false, error: 'Miner session does not match requested ANET profile ID' });
    return false;
  }
  return true;
}

function isAiOwnerWallet(walletAddress) {
  const wallet = String(walletAddress || '').trim().toUpperCase();
  return Boolean(AI_OWNER_WALLET) && wallet === AI_OWNER_WALLET;
}

function mapAiTrainingRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: normalizeNonNegativeInteger(row.id, 0),
    uid: normalizeAnetProfileId(row.uid),
    walletAddress: String(row.wallet_address || '').trim().toUpperCase(),
    sourcePage: String(row.source_page || '').trim(),
    prompt: String(row.prompt_text || '').trim(),
    response: String(row.response_text || '').trim(),
    tags: parseJsonSafe(row.tags_json, []),
    isPublic: Number(row.is_public || 0) === 1,
    approvedByOwner: Number(row.approved_by_owner || 0) === 1,
    createdAt: safeIsoDate(row.created_at),
    updatedAt: safeIsoDate(row.updated_at)
  };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'a-network-pi-backend' });
});

app.use('/api/pi/admin', adminRateLimiter, enforceAdminIpAllowlist);

// Admin-only: force-persist a lifetime unlock without a live Pi payment.
// Requires PI_ADMIN_KEY env var to be set. Use only for test/bootstrap purposes.
app.post('/api/pi/admin/force-unlock', (req, res) => {
  if (!PI_ENABLE_TEST_ADMIN) {
    return res.status(403).json({ ok: false, error: 'Admin force-unlock is disabled in this environment' });
  }

  if (!PI_ADMIN_KEY) {
    return res.status(503).json({ ok: false, error: 'PI_ADMIN_KEY is not configured on this deployment' });
  }

  const providedKey = String(req.body?.admin_key || '').trim();
  if (!safeKeyEqual(providedKey, PI_ADMIN_KEY)) {
    return res.status(401).json({ ok: false, error: 'Invalid admin key' });
  }

  const uid = normalizePiUid(req.body?.uid);
  const username = String(req.body?.username || '').trim();
  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }

  const syntheticPayment = {
    uid,
    user_uid: uid,
    username,
    user_username: username,
    metadata: { pi_uid: uid, pi_username: username },
    amount: 1,
    memo: 'admin-force-unlock'
  };

  const record = upsertLifetimeUnlock(syntheticPayment, 'admin-force-unlock', null);
  return res.status(200).json({ ok: true, unlock: record });
});

// Admin: re-point NFT identity records from an old wallet address to a new one
// after a wallet re-key (lost-seed recovery / re-migration). Requires PI_ADMIN_KEY.
// Keyed by wallet_address, so the user's NFT profile + AI training rows follow
// their account to the freshly generated wallet. Old address is left orphaned
// (it is tombstoned on the L1 chain and in the Web2 backend).
app.post('/api/pi/admin/nft/rekey', async (req, res) => {
  if (!PI_ADMIN_KEY) {
    return res.status(503).json({ ok: false, error: 'PI_ADMIN_KEY is not configured on this deployment' });
  }

  const providedKey = String(req.body?.admin_key || req.headers['x-admin-key'] || '').trim();
  if (!safeKeyEqual(providedKey, PI_ADMIN_KEY)) {
    return res.status(401).json({ ok: false, error: 'Invalid admin key' });
  }

  const oldAddress = String(req.body?.old_address || '').trim().toUpperCase();
  const newAddress = String(req.body?.new_address || '').trim().toUpperCase();
  if (!oldAddress || !newAddress) {
    return res.status(400).json({ ok: false, error: 'old_address and new_address are required' });
  }
  if (oldAddress === newAddress) {
    return res.status(400).json({ ok: false, error: 'old_address and new_address must differ' });
  }

  try {
    const nowIso = new Date().toISOString();
    const profileUpdate = await dbRun(
      nftDb,
      `UPDATE nft_profiles SET wallet_address = ?, updated_at = ? WHERE UPPER(TRIM(wallet_address)) = ?`,
      [newAddress, nowIso, oldAddress]
    );
    let trainingChanges = 0;
    try {
      const trainingUpdate = await dbRun(
        nftDb,
        `UPDATE ai_training_data SET wallet_address = ? WHERE UPPER(TRIM(wallet_address)) = ?`,
        [newAddress, oldAddress]
      );
      trainingChanges = trainingUpdate.changes || 0;
    } catch (trainingErr) {
      console.warn('[pi-backend] nft rekey: ai_training_data update skipped:', trainingErr.message || trainingErr);
    }

    return res.status(200).json({
      ok: true,
      old_address: oldAddress,
      new_address: newAddress,
      profiles_updated: profileUpdate.changes || 0,
      training_rows_updated: trainingChanges,
    });
  } catch (err) {
    console.error('[pi-backend] nft rekey failed:', err.message || err);
    return res.status(500).json({ ok: false, error: 'NFT identity re-key failed' });
  }
});

app.post('/api/pi/admin/force-dex-record', async (req, res) => {
  if (!PI_ENABLE_TEST_ADMIN) {
    return res.status(403).json({ ok: false, error: 'Admin force-dex-record is disabled in this environment' });
  }

  if (!PI_ADMIN_KEY) {
    return res.status(503).json({ ok: false, error: 'PI_ADMIN_KEY is not configured on this deployment' });
  }

  const providedKey = String(req.body?.admin_key || '').trim();
  if (!safeKeyEqual(providedKey, PI_ADMIN_KEY)) {
    return res.status(401).json({ ok: false, error: 'Invalid admin key' });
  }

  const uid = normalizePiUid(req.body?.uid);
  const username = String(req.body?.username || '').trim();
  const trader = String(req.body?.trader || '').trim().toUpperCase();
  const tokenSymbol = String(req.body?.token_symbol || '').trim().toUpperCase();
  const amountIn = normalizePositiveInteger(req.body?.amount_in);
  const anetToToken = Boolean(req.body?.anet_to_token);

  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  if (!trader) {
    return res.status(400).json({ ok: false, error: 'trader is required' });
  }
  if (!tokenSymbol) {
    return res.status(400).json({ ok: false, error: 'token_symbol is required' });
  }
  if (!amountIn) {
    return res.status(400).json({ ok: false, error: 'amount_in must be a positive integer' });
  }

  const requestRecord = {
    id: `dex_${Date.now()}`,
    uid,
    username,
    trader,
    token_symbol: tokenSymbol,
    amount_in: amountIn,
    anet_to_token: anetToToken,
    requestedAt: new Date().toISOString(),
    chainResponse: {
      pair_id: `ANET-${tokenSymbol}`,
      amount_out: '1',
      fee_paid: '0',
      synthetic: true,
      source: 'admin-force-dex-record'
    }
  };

  cashoutState.cashoutRequests.push(requestRecord);
  persistState();

  await ensureCashoutActivatedNftProfile(uid, username, trader);

  return res.status(200).json({ ok: true, request: requestRecord });
});

app.get('/api/pi/config', (_req, res) => {
  res.json({
    ok: true,
    sdk: {
      version: '2.0',
      sandbox: PI_SANDBOX
    },
    policy: {
      requiredAmount: PI_REQUIRED_AMOUNT,
      minAmount: PI_MIN_AMOUNT,
      maxAmount: PI_MAX_AMOUNT,
      memoPrefix: PI_ALLOWED_MEMO_PREFIX,
      metadataApp: PI_ALLOWED_METADATA_APP,
      metadataPurpose: PI_ALLOWED_METADATA_PURPOSE,
      requiredSessionsForPrivateMainnet: PI_REQUIRED_SESSIONS,
      sandboxMetadataPurpose: PI_ALLOWED_SANDBOX_METADATA_PURPOSE,
      lifetimeDexUnlockEnabled: true,
      appWalletCheckEnabled: Boolean(PI_APP_WALLET),
      testAdminEnabled: PI_ENABLE_TEST_ADMIN,
      testAssetMintEnabled: PI_ALLOW_TEST_ASSET_MINT,
      coinAccess: {
        testnetLabel: ANET_TESTNET_COIN_LABEL,
        mainnetLabel: ANET_MAINNET_COIN_LABEL,
        model: 'testnet-always-mainnet-after-session-threshold'
      },
      enforcePrimaryWalletBinding: PI_ENFORCE_PRIMARY_WALLET_BINDING,
      bitcoin: {
        enabled: Boolean(BTC_RPC_URL && BTC_RPC_USER && BTC_RPC_PASSWORD),
        network: BTC_NETWORK,
        requiredConfirmations: BTC_REQUIRED_CONFIRMATIONS,
        explorerBaseUrl: resolveBtcExplorerBaseUrl(),
        testAdminEnabled: BTC_ENABLE_TEST_ADMIN
      }
    }
  });
});

app.get('/api/nft/config', (_req, res) => {
  return res.status(200).json({
    ok: true,
    policy: {
      noBurn: true,
      minAntsForProfileCreation: NFT_MIN_PROFILE_ANTS,
      minDomainAuctionBidAnts: NFT_DOMAIN_MIN_BID_ANTS,
      tradingRequiresNftProfile: false,
      nftUnlockRequiresCashout: true,
      maxBioLength: NFT_MAX_BIO_LENGTH,
      model: 'nft-identity-and-closed-loop-utility'
    }
  });
});

app.get('/api/ai/config', (_req, res) => {
  return res.status(200).json({
    ok: true,
    policy: {
      ownerWalletConfigured: Boolean(AI_OWNER_WALLET),
      ownerWalletSource: AI_OWNER_WALLET_SOURCE,
      trainingFlow: 'users-submit-owner-approves',
      loginFlow: 'wallet-address-via-nft-miner-session'
    }
  });
});

app.get('/api/ai/training/public', async (_req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }
  try {
    const rows = await dbAll(
      nftDb,
      `SELECT *
       FROM ai_training_data
       WHERE is_public = 1 AND approved_by_owner = 1
       ORDER BY datetime(updated_at) DESC
       LIMIT 300`,
      []
    );
    return res.status(200).json({
      ok: true,
      count: rows.length,
      examples: rows.map(mapAiTrainingRow)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/ai/training/mine', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }
  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const rows = await dbAll(
      nftDb,
      `SELECT *
       FROM ai_training_data
       WHERE uid = ?
       ORDER BY datetime(updated_at) DESC
       LIMIT 200`,
      [normalizeAnetProfileId(minerSession.uid)]
    );

    return res.status(200).json({
      ok: true,
      count: rows.length,
      isOwner: isAiOwnerWallet(minerSession.walletAddress),
      examples: rows.map(mapAiTrainingRow)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/ai/training/submit', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }
  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const uid = getAnetProfileIdFromBody(req.body);
    if (!uid) {
      return res.status(400).json({ ok: false, error: 'anet profile id is required' });
    }
    if (!requireSessionUidMatch(res, minerSession, uid)) {
      return;
    }

    const promptText = normalizeShortText(req.body?.prompt, 1000);
    const responseText = normalizeShortText(req.body?.response, 3000);
    if (!promptText || !responseText) {
      return res.status(400).json({ ok: false, error: 'prompt and response are required' });
    }

    const sourcePage = normalizeShortText(req.body?.source_page, 120);
    const tagsJson = normalizeTraitsJson(req.body?.tags);
    const requesterIsOwner = isAiOwnerWallet(minerSession.walletAddress);
    const publishRequested = Boolean(req.body?.is_public);
    const isPublic = requesterIsOwner ? (publishRequested ? 1 : 0) : 0;
    const approvedByOwner = requesterIsOwner ? 1 : 0;
    const now = new Date().toISOString();

    await dbRun(
      nftDb,
      `INSERT INTO ai_training_data (
         uid, wallet_address, source_page, prompt_text, response_text,
         tags_json, is_public, approved_by_owner, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid,
        String(minerSession.walletAddress || '').trim().toUpperCase(),
        sourcePage,
        promptText,
        responseText,
        tagsJson,
        isPublic,
        approvedByOwner,
        now,
        now
      ]
    );

    const created = await dbGet(nftDb, 'SELECT * FROM ai_training_data WHERE id = last_insert_rowid()', []);
    return res.status(201).json({
      ok: true,
      queuedForOwnerApproval: !requesterIsOwner,
      example: mapAiTrainingRow(created)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/ai/training/:id/approve', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }
  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  if (!isAiOwnerWallet(minerSession.walletAddress)) {
    return res.status(403).json({ ok: false, error: 'Only AI owner wallet can approve training data' });
  }

  try {
    const id = normalizeNonNegativeInteger(req.params?.id, 0);
    if (!id) {
      return res.status(400).json({ ok: false, error: 'training id is required' });
    }
    const now = new Date().toISOString();
    await dbRun(
      nftDb,
      `UPDATE ai_training_data
       SET approved_by_owner = 1, is_public = 1, updated_at = ?
       WHERE id = ?`,
      [now, id]
    );
    const updated = await dbGet(nftDb, 'SELECT * FROM ai_training_data WHERE id = ?', [id]);
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'training row not found' });
    }
    return res.status(200).json({ ok: true, example: mapAiTrainingRow(updated) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/nft/auth/miner-login', async (req, res) => {
  try {
    const uid = normalizeAnetProfileId(req.body?.uid || req.body?.anet_profile_id);
    const username = String(req.body?.username || '').trim();
    const walletAddress = String(req.body?.wallet_address || '').trim().toUpperCase();

    if (!uid || !username || !walletAddress) {
      return res.status(400).json({
        ok: false,
        error: 'uid, username, and wallet_address are required'
      });
    }

    const access = await requireUnlockAndEligibility(uid, username, walletAddress);
    if (access.error) {
      return res.status(access.status || 403).json({
        ok: false,
        error: access.error,
        unlock: access.unlock || null,
        eligibility: access.eligibility || null,
        walletBinding: access.walletBinding || null
      });
    }

    const session = createNftMinerSession(uid, username, walletAddress);
    const activation = await requireNftActivationByCashout(uid);
    return res.status(200).json({
      ok: true,
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      uid: session.uid,
      username: session.username,
      walletAddress: session.walletAddress,
      nftActivated: Boolean(activation.ok),
      walletBinding: access.walletBinding || null,
      eligibility: access.eligibility || null
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/nft/auth/logout', (req, res) => {
  const token = getNftMinerSessionToken(req);
  if (token) {
    nftMinerSessions.delete(token);
  }
  return res.status(200).json({ ok: true });
});

app.get('/api/nft/profile/:uid', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }

  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const uid = normalizeAnetProfileId(req.params?.uid || req.params?.profileId);
    if (!uid) {
      return res.status(400).json({ ok: false, error: 'anet profile id is required' });
    }
    if (!requireSessionUidMatch(res, minerSession, uid)) {
      return;
    }

    const profile = await getNftProfile(uid);
    const assets = await dbAll(
      nftDb,
      'SELECT * FROM nft_assets WHERE uid = ? ORDER BY datetime(created_at) DESC LIMIT 100',
      [uid]
    );

    return res.status(profile ? 200 : 404).json({
      ok: Boolean(profile),
      uid,
      anetProfileId: uid,
      minAntsForProfileCreation: NFT_MIN_PROFILE_ANTS,
      profile,
      assets: assets.map(mapNftAssetRow),
      exists: Boolean(profile)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/nft/profile/upsert', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }

  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const uid = getAnetProfileIdFromBody(req.body);
    if (!uid) {
      return res.status(400).json({ ok: false, error: 'anet profile id is required' });
    }
    if (!requireSessionUidMatch(res, minerSession, uid)) {
      return;
    }

    const username = normalizeShortText(req.body?.username, 80);
    const walletAddress = String(req.body?.wallet_address || '').trim().toUpperCase();
    const displayName = normalizeShortText(req.body?.display_name, 80);
    const bio = normalizeShortText(req.body?.bio, NFT_MAX_BIO_LENGTH);
    const avatarUri = normalizeUri(req.body?.avatar_uri, 500);
    const bannerUri = normalizeUri(req.body?.banner_uri, 500);
    const themeJson = normalizeThemeJson(req.body?.theme);
    const antsBalance = normalizeNonNegativeInteger(req.body?.ants_balance, 0);
    const now = new Date().toISOString();

    const existing = await getNftProfile(uid);
    const activation = await requireNftActivationByCashout(uid);
    if (!existing && !activation.ok) {
      return res.status(activation.status || 403).json({
        ok: false,
        error: activation.error,
        rule: 'NFT_UNLOCK_AFTER_CASHOUT'
      });
    }

    if (!existing) {
      const profileNftId = `nft_profile_${uid}_${Date.now()}`;
      await dbRun(
        nftDb,
        `INSERT INTO nft_profiles (
          uid, username, wallet_address, display_name, bio, avatar_uri, banner_uri,
          theme_json, ants_balance, profile_nft_id, profile_created_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uid,
          username,
          walletAddress,
          displayName,
          bio,
          avatarUri,
          bannerUri,
          themeJson,
          antsBalance,
          profileNftId,
          now,
          now,
          now
        ]
      );

      await appendNftActivity(uid, 'PROFILE_CREATED', {
        antsBalance,
        profileNftId,
        username,
        walletAddress
      });
    } else {
      await dbRun(
        nftDb,
        `UPDATE nft_profiles
         SET username = ?, wallet_address = ?, display_name = ?, bio = ?,
             avatar_uri = ?, banner_uri = ?, theme_json = ?, ants_balance = ?, updated_at = ?
         WHERE uid = ?`,
        [
          username || existing.username,
          walletAddress || existing.walletAddress,
          displayName || existing.displayName,
          bio,
          avatarUri,
          bannerUri,
          themeJson,
          antsBalance,
          now,
          uid
        ]
      );

      await appendNftActivity(uid, 'PROFILE_UPDATED', {
        antsBalance,
        username,
        walletAddress
      });
    }

    const profile = await getNftProfile(uid);
    return res.status(200).json({
      ok: true,
      profile,
      minAntsForProfileCreation: NFT_MIN_PROFILE_ANTS
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/nft/assets/:uid', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }

  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const uid = normalizeAnetProfileId(req.params?.uid || req.params?.profileId);
    if (!uid) {
      return res.status(400).json({ ok: false, error: 'anet profile id is required' });
    }
    if (!requireSessionUidMatch(res, minerSession, uid)) {
      return;
    }

    const assets = await dbAll(
      nftDb,
      'SELECT * FROM nft_assets WHERE uid = ? ORDER BY datetime(created_at) DESC LIMIT 200',
      [uid]
    );

    return res.status(200).json({
      ok: true,
      uid,
      anetProfileId: uid,
      count: assets.length,
      assets: assets.map(mapNftAssetRow)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/nft/assets/create', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }

  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const uid = getAnetProfileIdFromBody(req.body);
    if (!uid) {
      return res.status(400).json({ ok: false, error: 'anet profile id is required' });
    }
    if (!requireSessionUidMatch(res, minerSession, uid)) {
      return;
    }

    const profile = await getNftProfile(uid);
    if (!profile) {
      return res.status(404).json({
        ok: false,
        error: 'NFT profile not found. Create profile first.'
      });
    }

    const antsBalance = normalizeNonNegativeInteger(req.body?.ants_balance, profile.antsBalance || 0);

    const name = normalizeShortText(req.body?.name, 100);
    if (!name) {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }

    const assetId = `nft_asset_${crypto.randomUUID()}`;
    const slug = normalizeShortText(req.body?.slug, 80).toLowerCase();
    const description = normalizeShortText(req.body?.description, 600);
    const imageUri = normalizeUri(req.body?.image_uri, 500);
    const metadataUri = normalizeUri(req.body?.metadata_uri, 500);
    const traitsJson = normalizeTraitsJson(req.body?.traits);
    const status = normalizeShortText(req.body?.status || 'active', 20).toLowerCase() || 'active';
    const antsStake = normalizeNonNegativeInteger(req.body?.ants_stake, 0);
    const now = new Date().toISOString();

    await dbRun(
      nftDb,
      `INSERT INTO nft_assets (
        id, uid, slug, name, description, image_uri, metadata_uri,
        traits_json, status, ants_stake, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        assetId,
        uid,
        slug,
        name,
        description,
        imageUri,
        metadataUri,
        traitsJson,
        status,
        antsStake,
        now,
        now
      ]
    );

    await dbRun(
      nftDb,
      'UPDATE nft_profiles SET ants_balance = ?, updated_at = ? WHERE uid = ?',
      [antsBalance, now, uid]
    );

    await appendNftActivity(uid, 'NFT_CREATED', {
      id: assetId,
      name,
      slug,
      status,
      antsStake
    });

    const created = await dbGet(nftDb, 'SELECT * FROM nft_assets WHERE id = ?', [assetId]);
    return res.status(201).json({
      ok: true,
      asset: mapNftAssetRow(created),
      profile: await getNftProfile(uid)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch('/api/nft/assets/:assetId', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }

  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const assetId = normalizeShortText(req.params?.assetId, 120);
    const uid = getAnetProfileIdFromBody(req.body);
    if (!assetId || !uid) {
      return res.status(400).json({ ok: false, error: 'assetId and anet profile id are required' });
    }
    if (!requireSessionUidMatch(res, minerSession, uid)) {
      return;
    }

    const existing = await dbGet(nftDb, 'SELECT * FROM nft_assets WHERE id = ? AND uid = ?', [assetId, uid]);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'NFT asset not found for this ANET profile ID' });
    }

    const now = new Date().toISOString();
    const nextName = normalizeShortText(req.body?.name || existing.name, 100);
    const nextDescription = normalizeShortText(req.body?.description || existing.description, 600);
    const nextImageUri = normalizeUri(req.body?.image_uri || existing.image_uri, 500);
    const nextMetadataUri = normalizeUri(req.body?.metadata_uri || existing.metadata_uri, 500);
    const nextTraitsJson = req.body?.traits == null ? String(existing.traits_json || '[]') : normalizeTraitsJson(req.body?.traits);
    const nextStatus = normalizeShortText(req.body?.status || existing.status, 20).toLowerCase() || 'active';
    const nextAntsStake = req.body?.ants_stake == null
      ? normalizeNonNegativeInteger(existing.ants_stake, 0)
      : normalizeNonNegativeInteger(req.body?.ants_stake, 0);

    await dbRun(
      nftDb,
      `UPDATE nft_assets
       SET name = ?, description = ?, image_uri = ?, metadata_uri = ?,
           traits_json = ?, status = ?, ants_stake = ?, updated_at = ?
       WHERE id = ? AND uid = ?`,
      [
        nextName,
        nextDescription,
        nextImageUri,
        nextMetadataUri,
        nextTraitsJson,
        nextStatus,
        nextAntsStake,
        now,
        assetId,
        uid
      ]
    );

    await appendNftActivity(uid, 'NFT_UPDATED', {
      id: assetId,
      status: nextStatus,
      antsStake: nextAntsStake
    });

    const updated = await dbGet(nftDb, 'SELECT * FROM nft_assets WHERE id = ?', [assetId]);
    return res.status(200).json({ ok: true, asset: mapNftAssetRow(updated) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/nft/colony/feed', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }

  try {
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 30)));
    const assets = await dbAll(
      nftDb,
      `SELECT a.*, p.display_name, p.username
       FROM nft_assets a
       LEFT JOIN nft_profiles p ON p.uid = a.uid
       ORDER BY datetime(a.created_at) DESC
       LIMIT ?`,
      [limit]
    );

    return res.status(200).json({
      ok: true,
      count: assets.length,
      assets: assets.map((row) => ({
        ...mapNftAssetRow(row),
        ownerDisplayName: normalizeShortText(row.display_name || row.username || row.uid, 80)
      }))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/nft/market/listings', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }

  try {
    const requestedStatus = normalizeShortText(req.query?.status || 'active', 20).toLowerCase();
    const status = ['active', 'sold', 'cancelled', 'expired', 'all'].includes(requestedStatus)
      ? requestedStatus
      : 'active';
    const requestedListingType = normalizeShortText(req.query?.listing_type || 'all', 30).toLowerCase();
    const listingType = ['all', 'fixed', 'auction', 'domain-auction'].includes(requestedListingType)
      ? requestedListingType
      : 'all';
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50)));

    const whereParts = [];
    const params = [];
    if (status !== 'all') {
      whereParts.push('l.status = ?');
      params.push(status);
    }
    if (listingType !== 'all') {
      whereParts.push('l.listing_type = ?');
      params.push(listingType);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const sql = `SELECT l.*, a.uid AS asset_owner_uid, a.slug AS asset_slug, a.name AS asset_name,
                        a.description AS asset_description, a.image_uri AS asset_image_uri,
                        a.metadata_uri AS asset_metadata_uri, a.traits_json AS asset_traits_json,
                        a.status AS asset_status, a.ants_stake AS asset_ants_stake,
                        a.created_at AS asset_created_at, a.updated_at AS asset_updated_at,
                        a.asset_type AS asset_type_col, a.domain_name AS asset_domain_name,
                        a.colony_description AS asset_colony_description,
                        a.colony_logo_uri AS asset_colony_logo_uri,
                        a.colony_banner_uri AS asset_colony_banner_uri,
                        a.colony_links_json AS asset_colony_links_json,
                        a.colony_theme_json AS asset_colony_theme_json,
                        a.holder_tier AS asset_holder_tier,
                        a.serial_number AS asset_serial_number,
                        p.display_name AS seller_display_name, p.username AS seller_username,
                        IFNULL(b.bid_count, 0) AS bid_count, IFNULL(b.highest_bid_ants, 0) AS highest_bid_ants
                 FROM nft_market_listings l
                 LEFT JOIN nft_assets a ON a.id = l.asset_id
                 LEFT JOIN nft_profiles p ON p.uid = l.seller_uid
                 LEFT JOIN (
                   SELECT listing_id, COUNT(*) AS bid_count, MAX(amount_ants) AS highest_bid_ants
                   FROM nft_market_bids
                   GROUP BY listing_id
                 ) b ON b.listing_id = l.id
                 ${whereSql}
                 ORDER BY datetime(l.created_at) DESC
                 LIMIT ?`;

    const rows = await dbAll(nftDb, sql, [...params, limit]);
    const listings = rows.map(mapNftMarketListingRow);

    return res.status(200).json({
      ok: true,
      status,
      listingType,
      count: listings.length,
      listings
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/nft/market/listings/:listingId/bids', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }

  try {
    const listingId = normalizeShortText(req.params?.listingId, 120);
    if (!listingId) {
      return res.status(400).json({ ok: false, error: 'listingId is required' });
    }

    const bids = await dbAll(
      nftDb,
      `SELECT b.*, p.display_name AS bidder_display_name, p.username AS bidder_username
       FROM nft_market_bids b
       LEFT JOIN nft_profiles p ON p.uid = b.bidder_uid
       WHERE b.listing_id = ?
       ORDER BY b.amount_ants DESC, datetime(b.created_at) DESC
       LIMIT 100`,
      [listingId]
    );

    return res.status(200).json({
      ok: true,
      listingId,
      count: bids.length,
      bids: bids.map(mapNftMarketBidRow)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/nft/market/listings/create', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }

  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const sellerUid = getAnetProfileIdFromBody(req.body);
    const assetId = normalizeShortText(req.body?.asset_id, 120);
    const listingType = normalizeShortText(req.body?.listing_type || 'fixed', 20).toLowerCase();
    const askPriceAnts = normalizeNonNegativeInteger(req.body?.ask_price_ants, 0);
    const minBidAnts = normalizeNonNegativeInteger(req.body?.min_bid_ants, 0);
    const buyNowPriceAnts = normalizeNonNegativeInteger(req.body?.buy_now_price_ants, 0);
    const durationHours = Math.min(168, Math.max(1, normalizeNonNegativeInteger(req.body?.duration_hours, 24)));

    if (!sellerUid || !assetId) {
      return res.status(400).json({ ok: false, error: 'anet profile id and asset_id are required' });
    }
    if (!requireSessionUidMatch(res, minerSession, sellerUid)) {
      return;
    }
    if (!['fixed', 'auction', 'domain-auction'].includes(listingType)) {
      return res.status(400).json({ ok: false, error: 'listing_type must be fixed, auction, or domain-auction' });
    }

    const sellerProfile = await getNftProfile(sellerUid);
    if (!sellerProfile) {
      return res.status(404).json({ ok: false, error: 'Seller ANET profile not found' });
    }

    const asset = await dbGet(nftDb, 'SELECT * FROM nft_assets WHERE id = ?', [assetId]);
    if (!asset) {
      return res.status(404).json({ ok: false, error: 'NFT asset not found' });
    }
    if (normalizeAnetProfileId(asset.uid) !== sellerUid) {
      return res.status(403).json({ ok: false, error: 'Only current owner can list this NFT' });
    }

    if (listingType === 'domain-auction' && !isDomainAsset(asset)) {
      return res.status(400).json({ ok: false, error: 'domain-auction requires NFT name or slug ending with .ant' });
    }

    const activeListing = await dbGet(
      nftDb,
      'SELECT id FROM nft_market_listings WHERE asset_id = ? AND status = ? LIMIT 1',
      [assetId, 'active']
    );
    if (activeListing) {
      return res.status(409).json({ ok: false, error: 'This NFT already has an active listing' });
    }

    if (listingType === 'fixed' && askPriceAnts <= 0) {
      return res.status(400).json({ ok: false, error: 'ask_price_ants must be greater than 0 for fixed listing' });
    }
    if (listingType === 'auction' && minBidAnts <= 0) {
      return res.status(400).json({ ok: false, error: 'min_bid_ants must be greater than 0 for auction listing' });
    }
    if (listingType === 'domain-auction' && minBidAnts < NFT_DOMAIN_MIN_BID_ANTS) {
      return res.status(400).json({ ok: false, error: `domain-auction minimum bid is ${NFT_DOMAIN_MIN_BID_ANTS} ANTS` });
    }

    const now = new Date();
    const createdAt = now.toISOString();
    const endAt = ['auction', 'domain-auction'].includes(listingType)
      ? new Date(now.getTime() + durationHours * 60 * 60 * 1000).toISOString()
      : null;
    const listingId = `nft_listing_${crypto.randomUUID()}`;

    await dbRun(
      nftDb,
      `INSERT INTO nft_market_listings (
        id, asset_id, seller_uid, listing_type, ask_price_ants, min_bid_ants,
        buy_now_price_ants, status, winner_uid, final_price_ants,
        start_at, end_at, sold_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        listingId,
        assetId,
        sellerUid,
        listingType,
        askPriceAnts,
        minBidAnts,
        buyNowPriceAnts,
        'active',
        '',
        0,
        createdAt,
        endAt,
        null,
        createdAt,
        createdAt
      ]
    );

    await appendNftActivity(sellerUid, 'NFT_LISTED', {
      listingId,
      assetId,
      listingType,
      askPriceAnts,
      minBidAnts,
      buyNowPriceAnts,
      durationHours: ['auction', 'domain-auction'].includes(listingType) ? durationHours : null
    });

    return res.status(201).json({
      ok: true,
      listing: await getMarketListingById(listingId)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/nft/market/listings/:listingId/bid', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }

  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const listingId = normalizeShortText(req.params?.listingId, 120);
    const bidderUid = getAnetProfileIdFromBody(req.body);
    const amountAnts = normalizeNonNegativeInteger(req.body?.amount_ants, 0);
    if (!listingId || !bidderUid || amountAnts <= 0) {
      return res.status(400).json({ ok: false, error: 'listingId, anet profile id and amount_ants are required' });
    }
    if (!requireSessionUidMatch(res, minerSession, bidderUid)) {
      return;
    }

    const listing = await getMarketListingById(listingId);
    if (!listing) {
      return res.status(404).json({ ok: false, error: 'Listing not found' });
    }
    if (listing.status !== 'active') {
      return res.status(409).json({ ok: false, error: 'Listing is not active' });
    }
    if (!['auction', 'domain-auction'].includes(listing.listingType)) {
      return res.status(400).json({ ok: false, error: 'Bids are only allowed on auction listings' });
    }
    if (listing.isExpired) {
      return res.status(409).json({ ok: false, error: 'Auction expired. Seller should close listing.' });
    }
    if (bidderUid === listing.sellerUid) {
      return res.status(400).json({ ok: false, error: 'Seller cannot bid on own listing' });
    }

    const bidderProfile = await getNftProfile(bidderUid);
    if (!bidderProfile) {
      return res.status(404).json({ ok: false, error: 'Bidder ANET profile not found' });
    }

    const highestBid = await dbGet(
      nftDb,
      'SELECT MAX(amount_ants) AS highest_bid FROM nft_market_bids WHERE listing_id = ?',
      [listingId]
    );
    const currentHighest = normalizeNonNegativeInteger(highestBid?.highest_bid, 0);
    const domainFloor = listing.listingType === 'domain-auction' ? NFT_DOMAIN_MIN_BID_ANTS : 0;
    const minRequired = Math.max(listing.minBidAnts, domainFloor, currentHighest + 1);
    if (amountAnts < minRequired) {
      return res.status(400).json({ ok: false, error: `Bid must be at least ${minRequired} ANTS` });
    }

    const now = new Date().toISOString();
    await dbRun(
      nftDb,
      'INSERT INTO nft_market_bids (listing_id, bidder_uid, amount_ants, created_at) VALUES (?, ?, ?, ?)',
      [listingId, bidderUid, amountAnts, now]
    );

    await appendNftActivity(bidderUid, 'NFT_BID_PLACED', {
      listingId,
      assetId: listing.assetId,
      amountAnts
    });

    if (listing.buyNowPriceAnts > 0 && amountAnts >= listing.buyNowPriceAnts) {
      const soldListing = await settleMarketListing(listingId, bidderUid, amountAnts);
      return res.status(200).json({
        ok: true,
        autoSettled: true,
        listing: soldListing
      });
    }

    return res.status(200).json({
      ok: true,
      autoSettled: false,
      listing: await getMarketListingById(listingId)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/nft/market/listings/:listingId/buy', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }

  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const listingId = normalizeShortText(req.params?.listingId, 120);
    const buyerUid = getAnetProfileIdFromBody(req.body);
    if (!listingId || !buyerUid) {
      return res.status(400).json({ ok: false, error: 'listingId and anet profile id are required' });
    }
    if (!requireSessionUidMatch(res, minerSession, buyerUid)) {
      return;
    }

    const listing = await getMarketListingById(listingId);
    if (!listing) {
      return res.status(404).json({ ok: false, error: 'Listing not found' });
    }
    if (listing.status !== 'active') {
      return res.status(409).json({ ok: false, error: 'Listing is not active' });
    }
    if (buyerUid === listing.sellerUid) {
      return res.status(400).json({ ok: false, error: 'Seller cannot buy own listing' });
    }

    let finalPriceAnts = 0;
    if (listing.listingType === 'fixed') {
      finalPriceAnts = listing.askPriceAnts;
    } else {
      if (listing.buyNowPriceAnts <= 0) {
        return res.status(400).json({ ok: false, error: 'Auction listing has no buy now price' });
      }
      finalPriceAnts = listing.buyNowPriceAnts;
    }

    const soldListing = await settleMarketListing(listingId, buyerUid, finalPriceAnts);
    return res.status(200).json({ ok: true, listing: soldListing });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/nft/market/listings/:listingId/close', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }

  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const listingId = normalizeShortText(req.params?.listingId, 120);
    const sellerUid = getAnetProfileIdFromBody(req.body);
    if (!listingId || !sellerUid) {
      return res.status(400).json({ ok: false, error: 'listingId and anet profile id are required' });
    }
    if (!requireSessionUidMatch(res, minerSession, sellerUid)) {
      return;
    }

    const listing = await getMarketListingById(listingId);
    if (!listing) {
      return res.status(404).json({ ok: false, error: 'Listing not found' });
    }
    if (listing.status !== 'active') {
      return res.status(409).json({ ok: false, error: 'Listing is not active' });
    }
    if (sellerUid !== listing.sellerUid) {
      return res.status(403).json({ ok: false, error: 'Only seller can close listing' });
    }

    if (['auction', 'domain-auction'].includes(listing.listingType)) {
      const highest = await dbGet(
        nftDb,
        `SELECT bidder_uid, amount_ants
         FROM nft_market_bids
         WHERE listing_id = ?
         ORDER BY amount_ants DESC, datetime(created_at) DESC
         LIMIT 1`,
        [listingId]
      );

      if (highest?.bidder_uid) {
        const settled = await settleMarketListing(listingId, highest.bidder_uid, highest.amount_ants);
        return res.status(200).json({ ok: true, settled: true, listing: settled });
      }
    }

    const now = new Date().toISOString();
    const nextStatus = listing.isExpired ? 'expired' : 'cancelled';
    await dbRun(
      nftDb,
      'UPDATE nft_market_listings SET status = ?, updated_at = ? WHERE id = ?',
      [nextStatus, now, listing.id]
    );

    await appendNftActivity(sellerUid, 'NFT_LISTING_CLOSED', {
      listingId,
      assetId: listing.assetId,
      status: nextStatus
    });

    return res.status(200).json({
      ok: true,
      settled: false,
      listing: await getMarketListingById(listing.id)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// ─── Genesis Collections ───────────────────────────────────────────────────

app.get('/api/nft/collections', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }
  try {
    const collections = await dbAll(nftDb, `SELECT * FROM nft_collections ORDER BY created_at ASC`, []);
    return res.status(200).json({
      ok: true,
      count: collections.length,
      collections: collections.map((c) => ({
        id: String(c.id || '').trim(),
        name: String(c.name || '').trim(),
        slug: String(c.slug || '').trim(),
        description: String(c.description || '').trim(),
        collectionType: String(c.collection_type || 'standard').trim(),
        maxSupply: Number(c.max_supply || 0),
        currentSupply: Number(c.current_supply || 0),
        remaining: c.max_supply > 0 ? Math.max(0, Number(c.max_supply) - Number(c.current_supply)) : null,
        soldOut: c.max_supply > 0 && Number(c.current_supply) >= Number(c.max_supply),
        imageUri: String(c.image_uri || '').trim(),
        createdAt: safeIsoDate(c.created_at),
        updatedAt: safeIsoDate(c.updated_at)
      }))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Admin-only: create a new collection
app.post('/api/nft/collections/create', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }
  const adminKey = String(req.body?.admin_key || req.headers?.['x-admin-key'] || '').trim();
  if (!PI_ADMIN_KEY || !safeKeyEqual(adminKey, PI_ADMIN_KEY)) {
    return res.status(403).json({ ok: false, error: 'Admin key required' });
  }
  try {
    const name = normalizeShortText(req.body?.name, 120);
    if (!name) {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }
    const slug = normalizeShortText(req.body?.slug || name.toLowerCase().replace(/[^a-z0-9-]/g, '-'), 80);
    const description = normalizeShortText(req.body?.description, 600);
    const collectionType = ['genesis', 'domain', 'standard'].includes(String(req.body?.collection_type || '').trim().toLowerCase())
      ? String(req.body.collection_type).trim().toLowerCase()
      : 'standard';
    const maxSupply = normalizeNonNegativeInteger(req.body?.max_supply, 0);
    const imageUri = normalizeUri(req.body?.image_uri, 500);
    const now = new Date().toISOString();
    const id = `col_${crypto.randomUUID()}`;

    await dbRun(nftDb,
      `INSERT INTO nft_collections (id, name, slug, description, collection_type, max_supply, current_supply, image_uri, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [id, name, slug, description, collectionType, maxSupply, imageUri, now, now]
    );
    const created = await dbGet(nftDb, 'SELECT * FROM nft_collections WHERE id = ?', [id]);
    return res.status(201).json({ ok: true, collection: created });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// ─── Colony Domain Endpoints ───────────────────────────────────────────────

// Create a .ant colony domain NFT
app.post('/api/nft/domains/create', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }
  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const uid = getAnetProfileIdFromBody(req.body);
    if (!uid) {
      return res.status(400).json({ ok: false, error: 'anet profile id is required' });
    }
    if (!requireSessionUidMatch(res, minerSession, uid)) {
      return;
    }

    const profile = await getNftProfile(uid);
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'NFT profile not found. Create profile first.' });
    }

    const rawDomain = normalizeShortText(req.body?.domain_name || req.body?.name, 80).toLowerCase().trim();
    if (!rawDomain) {
      return res.status(400).json({ ok: false, error: 'domain_name is required (must end in .ant)' });
    }
    const domainName = rawDomain.endsWith('.ant') ? rawDomain : `${rawDomain}.ant`;

    // Domain name format: lowercase alphanumeric + hyphens + .ant
    if (!/^[a-z0-9][a-z0-9-]{0,61}\.ant$/.test(domainName)) {
      return res.status(400).json({ ok: false, error: 'Domain name must be lowercase alphanumeric with hyphens, ending in .ant (max 62 chars before .ant)' });
    }

    // Uniqueness check
    const existing = await dbGet(nftDb, 'SELECT id FROM nft_assets WHERE domain_name = ?', [domainName]);
    if (existing) {
      return res.status(409).json({ ok: false, error: `Domain ${domainName} is already registered` });
    }

    const colonyDescription = normalizeShortText(req.body?.colony_description, 600);
    const colonyLogoUri = normalizeUri(req.body?.colony_logo_uri, 500);
    const colonyBannerUri = normalizeUri(req.body?.colony_banner_uri, 500);
    const colonyLinksJson = normalizeThemeJson(req.body?.colony_links);
    const colonyThemeJson = normalizeThemeJson(req.body?.colony_theme);
    const imageUri = normalizeUri(req.body?.image_uri || colonyLogoUri || colonyBannerUri, 500);
    const description = normalizeShortText(req.body?.description || `Colony domain ${domainName}`, 600);
    const antsStake = normalizeNonNegativeInteger(req.body?.ants_stake, 0);
    const traitsJson = normalizeTraitsJson([
      { trait_type: 'domain', value: domainName },
      { trait_type: 'asset_type', value: 'colony-domain' },
      ...(Array.isArray(req.body?.traits) ? req.body.traits : [])
    ]);
    const now = new Date().toISOString();
    const assetId = `nft_asset_${crypto.randomUUID()}`;
    const slug = domainName.replace(/\./g, '-');

    await dbRun(nftDb,
      `INSERT INTO nft_assets (
         id, uid, slug, name, description, image_uri, metadata_uri, traits_json,
         status, ants_stake, created_at, updated_at,
         asset_type, domain_name, colony_description, colony_logo_uri,
         colony_banner_uri, colony_links_json, colony_theme_json, holder_tier, utility_flags_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        assetId, uid, slug, domainName, description, imageUri,
        normalizeUri(req.body?.metadata_uri, 500), traitsJson,
        'active', antsStake, now, now,
        'domain', domainName, colonyDescription, colonyLogoUri,
        colonyBannerUri, colonyLinksJson, colonyThemeJson, 'worker', '{}'
      ]
    );

    const antsBalance = normalizeNonNegativeInteger(req.body?.ants_balance, profile.antsBalance || 0);
    await dbRun(nftDb, 'UPDATE nft_profiles SET ants_balance = ?, updated_at = ? WHERE uid = ?', [antsBalance, now, uid]);
    await appendNftActivity(uid, 'COLONY_DOMAIN_CREATED', { id: assetId, domainName });

    const created = await dbGet(nftDb, 'SELECT * FROM nft_assets WHERE id = ?', [assetId]);
    return res.status(201).json({
      ok: true,
      asset: mapNftAssetRow(created),
      domainName
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Customize a colony domain base (owner only)
app.patch('/api/nft/domains/:domainId/customize', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }
  const minerSession = requireNftMinerSession(req, res);
  if (!minerSession) {
    return;
  }

  try {
    const domainId = normalizeShortText(req.params?.domainId, 120);
    const uid = getAnetProfileIdFromBody(req.body);
    if (!domainId || !uid) {
      return res.status(400).json({ ok: false, error: 'domainId and anet profile id are required' });
    }
    if (!requireSessionUidMatch(res, minerSession, uid)) {
      return;
    }

    const asset = await dbGet(nftDb, 'SELECT * FROM nft_assets WHERE id = ?', [domainId]);
    if (!asset) {
      return res.status(404).json({ ok: false, error: 'Domain asset not found' });
    }
    if (normalizeAnetProfileId(asset.uid) !== uid) {
      return res.status(403).json({ ok: false, error: 'Only the domain owner can customize it' });
    }
    if (String(asset.asset_type || '').trim().toLowerCase() !== 'domain') {
      return res.status(400).json({ ok: false, error: 'Asset is not a colony domain' });
    }

    const now = new Date().toISOString();
    const updates = {};
    if (req.body?.colony_description !== undefined) updates.colony_description = normalizeShortText(req.body.colony_description, 600);
    if (req.body?.colony_logo_uri !== undefined) updates.colony_logo_uri = normalizeUri(req.body.colony_logo_uri, 500);
    if (req.body?.colony_banner_uri !== undefined) updates.colony_banner_uri = normalizeUri(req.body.colony_banner_uri, 500);
    if (req.body?.colony_links !== undefined) updates.colony_links_json = normalizeThemeJson(req.body.colony_links);
    if (req.body?.colony_theme !== undefined) updates.colony_theme_json = normalizeThemeJson(req.body.colony_theme);
    if (req.body?.image_uri !== undefined) updates.image_uri = normalizeUri(req.body.image_uri, 500);
    if (req.body?.description !== undefined) updates.description = normalizeShortText(req.body.description, 600);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ ok: false, error: 'No customization fields provided' });
    }

    const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), now, domainId];
    await dbRun(nftDb, `UPDATE nft_assets SET ${setClauses}, updated_at = ? WHERE id = ?`, values);
    await appendNftActivity(uid, 'COLONY_DOMAIN_CUSTOMIZED', { id: domainId, fields: Object.keys(updates) });

    const updated = await dbGet(nftDb, 'SELECT * FROM nft_assets WHERE id = ?', [domainId]);
    return res.status(200).json({ ok: true, asset: mapNftAssetRow(updated) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Get all colony domains (public)
app.get('/api/nft/domains', async (req, res) => {
  if (!requireNftDatabase(res)) {
    return;
  }
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50)));
    const rows = await dbAll(nftDb,
      `SELECT a.*, p.display_name, p.username
       FROM nft_assets a
       LEFT JOIN nft_profiles p ON p.uid = a.uid
       WHERE a.asset_type = 'domain'
       ORDER BY datetime(a.created_at) DESC
       LIMIT ?`,
      [limit]
    );
    return res.status(200).json({
      ok: true,
      count: rows.length,
      domains: rows.map((row) => ({
        ...mapNftAssetRow(row),
        ownerDisplayName: normalizeShortText(row.display_name || row.username || row.uid, 80)
      }))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/public/verification', async (req, res) => {
  const uid = normalizePiUid(req.query?.uid);
  let chainHealth = null;
  let chainLatestHeight = null;
  let chainId = null;
  let poolsCount = null;

  if (ANET_CHAIN_API_BASE_URL) {
    try {
      chainHealth = await getFromLayer1('/health');
      chainId = String(chainHealth?.chain_id || '').trim() || null;
      chainLatestHeight = Number.isFinite(Number(chainHealth?.latest_block_height))
        ? Number(chainHealth.latest_block_height)
        : null;
    } catch {
      chainHealth = null;
    }

    try {
      const pools = await getFromLayer1('/dex/pools');
      poolsCount = Array.isArray(pools) ? pools.length : null;
    } catch {
      poolsCount = null;
    }
  }

  const unlockProof = recentUnlockProof();
  const dexProof = recentDexProof();
  const btcPaymentProof = recentBtcPaymentProof();
  const uidUnlock = uid ? getLifetimeUnlock(uid) : null;

  return res.json({
    ok: true,
    network: {
      anet: {
        label: 'A Network ANTS Mainnet',
        chainId: chainId || 'anet-private-mainnet-1',
        explorerBaseUrl: ANET_CHAIN_API_BASE_URL || null,
        latestBlockHeight: chainLatestHeight
      },
      pi: {
        mode: PI_SANDBOX ? 'sandbox' : 'mainnet',
        sdkVersion: '2.0',
        apiBaseUrl: PI_API_BASE_URL,
        metadataApp: PI_ALLOWED_METADATA_APP,
        metadataPurpose: PI_ALLOWED_METADATA_PURPOSE
      },
      bitcoin: {
        enabled: Boolean(BTC_RPC_URL && BTC_RPC_USER && BTC_RPC_PASSWORD),
        network: BTC_NETWORK,
        requiredConfirmations: BTC_REQUIRED_CONFIRMATIONS,
        explorerBaseUrl: resolveBtcExplorerBaseUrl()
      }
    },
    publicVerification: {
      summary: 'This service bridges Pi/Bitcoin payments to A Network Mainnet native L1 DEX access records.',
      howToVerify: [
        `${req.protocol}://${req.get('host')}/api/pi/config`,
        `${req.protocol}://${req.get('host')}/api/public/verification`,
        `${req.protocol}://${req.get('host')}/api/btc/payment/recent`,
        ANET_CHAIN_API_BASE_URL ? `${ANET_CHAIN_API_BASE_URL}/health` : null,
        ANET_CHAIN_API_BASE_URL ? `${ANET_CHAIN_API_BASE_URL}/blocks` : null,
        ANET_CHAIN_API_BASE_URL ? `${ANET_CHAIN_API_BASE_URL}/dex/pools` : null
      ].filter(Boolean)
    },
    metrics: {
      lifetimeUnlockRecords: Object.keys(cashoutState.lifetimeUnlocks || {}).length,
      dexExecutionRecords: (cashoutState.cashoutRequests || []).length,
      btcPaymentRecords: Object.keys(cashoutState.btcPaymentRequests || {}).length,
      recentPoolCount: poolsCount
    },
    recentProof: {
      unlocks: unlockProof,
      dexExecutions: dexProof,
      btcPayments: btcPaymentProof
    },
    uidStatus: uid
      ? {
        uid,
        unlocked: Boolean(uidUnlock),
        unlock: uidUnlock
          ? {
            uid: normalizePiUid(uidUnlock.uid),
            username: String(uidUnlock.username || '').trim(),
            unlockedAt: safeIsoDate(uidUnlock.unlockedAt),
            paymentId: String(uidUnlock.paymentId || '').trim() || null,
            txid: String(uidUnlock.txid || '').trim() || null,
            piExplorerTransactionUrl: getPiExplorerTransactionUrl(uidUnlock.txid)
          }
          : null
      }
      : null
  });
});

async function sendUnlockStatus(res, uid, walletAddress) {
  const unlock = getLifetimeUnlock(uid);
  const walletBinding = getPublicWalletBinding(uid);
  const providedWallet = normalizeWalletAddress(walletAddress);
  const boundWalletMismatch = Boolean(
    PI_ENFORCE_PRIMARY_WALLET_BINDING &&
    walletBinding &&
    providedWallet &&
    normalizeWalletAddress(walletBinding.primaryWallet) !== providedWallet
  );
  const response = {
    ok: true,
    uid,
    unlocked: Boolean(unlock),
    requiredSessionsForPrivateMainnet: PI_REQUIRED_SESSIONS,
    coinAccess: buildCoinAccess(false),
    walletBindingPolicy: {
      enforcePrimaryWalletBinding: PI_ENFORCE_PRIMARY_WALLET_BINDING
    },
    walletBinding,
    boundWalletMismatch,
    ...(unlock || {})
  };

  if (walletAddress) {
    const eligibility = await getSessionEligibility(walletAddress);
    if (!eligibility.error) {
      response.eligibility = eligibility;
      response.coinAccess = buildCoinAccess(eligibility.eligible);
    } else {
      response.eligibilityError = eligibility.error;
    }
  }

  return res.json({
    ...response
  });
}

app.get('/api/pi/dex/status/:uid', async (req, res) => {
  const uid = normalizePiUid(req.params?.uid);
  const walletAddress = String(req.query?.wallet || '').trim().toUpperCase();
  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  return sendUnlockStatus(res, uid, walletAddress);
});

app.get('/api/pi/cashout/status/:uid', async (req, res) => {
  const uid = normalizePiUid(req.params?.uid);
  const walletAddress = String(req.query?.wallet || '').trim().toUpperCase();
  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  return sendUnlockStatus(res, uid, walletAddress);
});

async function piRequest(pathname, options = {}) {
  const response = await fetch(`${PI_API_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Key ${PI_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`Pi API request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function verifyPaymentExists(paymentId) {
  return piRequest(`/v2/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
}

function unwrapPayment(paymentResponse) {
  if (!paymentResponse || typeof paymentResponse !== 'object') {
    return {};
  }

  return paymentResponse.payment && typeof paymentResponse.payment === 'object'
    ? paymentResponse.payment
    : paymentResponse;
}

function boolCandidate(payment, keys) {
  for (const key of keys) {
    const direct = payment?.[key];
    if (typeof direct === 'boolean') {
      return direct;
    }

    const nested = payment?.status?.[key];
    if (typeof nested === 'boolean') {
      return nested;
    }
  }

  return false;
}

function getCurrentTxid(payment) {
  return payment?.transaction?.txid || payment?.transaction?.tx_id || payment?.txid || null;
}

function isDeveloperCompleted(payment) {
  return boolCandidate(payment, ['developer_completed', 'developerCompleted']);
}

function isAllowedMetadataPurpose(metadataPurpose) {
  const allowedPurposes = new Set([PI_ALLOWED_METADATA_PURPOSE]);

  if (PI_SANDBOX && PI_ALLOWED_SANDBOX_METADATA_PURPOSE) {
    allowedPurposes.add(PI_ALLOWED_SANDBOX_METADATA_PURPOSE);
  }

  return allowedPurposes.has(metadataPurpose);
}

function isDexUnlockPayment(payment) {
  return String(payment?.metadata?.purpose || '') === PI_ALLOWED_METADATA_PURPOSE;
}

function canUnlockDexForSandbox(payment) {
  if (!PI_SANDBOX) {
    return false;
  }

  const purpose = String(payment?.metadata?.purpose || '');
  return isAllowedMetadataPurpose(purpose);
}

function validatePaymentForApp(payment) {
  const amount = Number(payment?.amount);
  const memo = String(payment?.memo || '');
  const metadataApp = String(payment?.metadata?.app || '');
  const metadataPurpose = String(payment?.metadata?.purpose || '');
  const toAddress = String(payment?.to_address || payment?.toAddress || '');

  if (!Number.isFinite(amount)) {
    return 'Invalid payment amount';
  }

  if (amount < PI_MIN_AMOUNT || amount > PI_MAX_AMOUNT) {
    return `Payment amount ${amount} is outside allowed range ${PI_MIN_AMOUNT} - ${PI_MAX_AMOUNT}`;
  }

  if (Math.abs(amount - PI_REQUIRED_AMOUNT) > 0.000001) {
    return `Payment amount must be exactly ${PI_REQUIRED_AMOUNT} Pi`;
  }

  if (PI_ALLOWED_MEMO_PREFIX && !memo.startsWith(PI_ALLOWED_MEMO_PREFIX)) {
    return `Payment memo must start with '${PI_ALLOWED_MEMO_PREFIX}'`;
  }

  if (PI_ALLOWED_METADATA_APP && metadataApp !== PI_ALLOWED_METADATA_APP) {
    return `Payment metadata.app must be '${PI_ALLOWED_METADATA_APP}'`;
  }

  if (PI_ALLOWED_METADATA_PURPOSE && !isAllowedMetadataPurpose(metadataPurpose)) {
    return `Payment metadata.purpose must be '${PI_ALLOWED_METADATA_PURPOSE}'${PI_SANDBOX ? ` or '${PI_ALLOWED_SANDBOX_METADATA_PURPOSE}'` : ''}`;
  }

  if (PI_APP_WALLET && toAddress && toAddress !== PI_APP_WALLET) {
    return 'Payment destination wallet does not match configured app wallet';
  }

  return null;
}

function requireUnlock(uid, username) {
  const unlock = getLifetimeUnlock(uid);
  if (!unlock) {
    return { error: 'Lifetime DEX access has not been paid for this Pi user yet' };
  }

  if (unlock.username && username && unlock.username !== username) {
    return { error: 'Pi username does not match stored lifetime unlock record' };
  }

  return { unlock };
}

function normalizeWalletAddress(address) {
  return String(address || '').trim().toUpperCase();
}

function getWalletBinding(uid) {
  return cashoutState.walletBindings?.[normalizePiUid(uid)] || null;
}

function getPublicWalletBinding(uid) {
  const binding = getWalletBinding(uid);
  if (!binding) {
    return null;
  }
  return {
    primaryWallet: normalizeWalletAddress(binding.primaryWallet),
    wallets: Array.isArray(binding.wallets)
      ? binding.wallets.map((wallet) => normalizeWalletAddress(wallet)).filter(Boolean)
      : [normalizeWalletAddress(binding.primaryWallet)].filter(Boolean),
    createdAt: safeIsoDate(binding.createdAt),
    updatedAt: safeIsoDate(binding.updatedAt)
  };
}

function enforceWalletBinding(uid, username, walletAddress) {
  if (!PI_ENFORCE_PRIMARY_WALLET_BINDING) {
    return {
      ok: true,
      binding: getPublicWalletBinding(uid),
      walletBoundNow: false
    };
  }

  const normalizedUid = normalizePiUid(uid);
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  if (!normalizedUid) {
    return { error: 'uid is required for wallet binding checks', status: 400 };
  }
  if (!normalizedWallet) {
    return { error: 'wallet_address is required for wallet binding checks', status: 400 };
  }

  const existing = getWalletBinding(normalizedUid);
  if (!existing) {
    const now = new Date().toISOString();
    const record = {
      uid: normalizedUid,
      username: String(username || '').trim(),
      primaryWallet: normalizedWallet,
      wallets: [normalizedWallet],
      createdAt: now,
      updatedAt: now
    };
    cashoutState.walletBindings[normalizedUid] = record;
    persistState();
    return {
      ok: true,
      walletBoundNow: true,
      binding: getPublicWalletBinding(normalizedUid)
    };
  }

  const primaryWallet = normalizeWalletAddress(existing.primaryWallet);
  if (primaryWallet !== normalizedWallet) {
    return {
      error: `This Pi user is bound to wallet ${primaryWallet}. Use the primary wallet for ANTS Mainnet swap/bridge requests.`,
      status: 403,
      binding: getPublicWalletBinding(normalizedUid)
    };
  }

  const mergedWallets = new Set(Array.isArray(existing.wallets) ? existing.wallets.map((wallet) => normalizeWalletAddress(wallet)) : []);
  mergedWallets.add(primaryWallet);
  const nextRecord = {
    ...existing,
    username: String(existing.username || '').trim() || String(username || '').trim(),
    primaryWallet,
    wallets: [...mergedWallets],
    updatedAt: new Date().toISOString()
  };
  cashoutState.walletBindings[normalizedUid] = nextRecord;
  persistState();

  return {
    ok: true,
    walletBoundNow: false,
    binding: getPublicWalletBinding(normalizedUid)
  };
}

function buildCoinAccess(eligibleForMainnet) {
  return {
    testnet: {
      enabled: true,
      label: ANET_TESTNET_COIN_LABEL
    },
    mainnet: {
      enabled: Boolean(eligibleForMainnet),
      label: ANET_MAINNET_COIN_LABEL
    }
  };
}

async function getSessionEligibility(walletAddress) {
  const normalizedWallet = String(walletAddress || '').trim().toUpperCase();
  if (!normalizedWallet) {
    return { error: 'wallet address is required for eligibility checks', status: 400 };
  }

  if (!ANET_CHAIN_API_BASE_URL) {
    return { error: 'Layer 1 DEX bridge is not configured', status: 503 };
  }

  try {
    let account = null;
    try {
      account = await getFromLayer1(`/accounts/${encodeURIComponent(normalizedWallet)}`);
    } catch (error) {
      // Treat missing on-chain account as a valid zero-session state.
      if (error?.status !== 404) {
        throw error;
      }
    }

    const sessions = Number.isFinite(Number(account?.sessions)) ? Number(account.sessions) : 0;
    const requiredSessions = Number.isFinite(PI_REQUIRED_SESSIONS) && PI_REQUIRED_SESSIONS > 0
      ? PI_REQUIRED_SESSIONS
      : 1000;
    // In test mode, bypass eligibility check
    const eligible = PI_ALLOW_INELIGIBLE_FOR_DEX_TEST || (sessions >= requiredSessions);

    return {
      wallet: normalizedWallet,
      sessions,
      requiredSessions,
      eligible,
      remainingSessions: Math.max(0, requiredSessions - sessions),
      testModeBypass: PI_ALLOW_INELIGIBLE_FOR_DEX_TEST
    };
  } catch (error) {
    return {
      error: error?.message || 'Unable to verify session eligibility',
      status: error?.status || 502
    };
  }
}

async function requireUnlockAndEligibility(uid, username, walletAddress) {
  const unlockResult = requireUnlock(uid, username);
  if (unlockResult.error) {
    return {
      error: unlockResult.error,
      status: 403
    };
  }

  const bindingResult = enforceWalletBinding(uid, username, walletAddress);
  if (bindingResult.error) {
    return {
      error: bindingResult.error,
      status: bindingResult.status || 403,
      unlock: unlockResult.unlock,
      walletBinding: bindingResult.binding || getPublicWalletBinding(uid) || null
    };
  }

  const eligibility = await getSessionEligibility(walletAddress);
  if (eligibility.error) {
    return {
      error: eligibility.error,
      status: eligibility.status || 502,
      unlock: unlockResult.unlock,
      walletBinding: bindingResult.binding || null
    };
  }

  if (!eligibility.eligible) {
    return {
      error: `You need to complete at least ${eligibility.requiredSessions} sessions before using swap/bridge on ANTS Mainnet`,
      status: 403,
      unlock: unlockResult.unlock,
      eligibility,
      coinAccess: buildCoinAccess(false),
      walletBinding: bindingResult.binding || null
    };
  }

  return {
    unlock: unlockResult.unlock,
    eligibility,
    coinAccess: buildCoinAccess(true),
    walletBinding: bindingResult.binding || null,
    walletBoundNow: Boolean(bindingResult.walletBoundNow)
  };
}

async function approvePayment(paymentId) {
  const payment = unwrapPayment(await verifyPaymentExists(paymentId));
  const validationError = validatePaymentForApp(payment);
  if (validationError) {
    const error = new Error(validationError);
    error.status = 400;
    throw error;
  }

  if (boolCandidate(payment, ['developer_approved', 'developerApproved'])) {
    return { ok: true, paymentId, skipped: true, reason: 'Payment already approved' };
  }

  const approved = await piRequest(`/v2/payments/${encodeURIComponent(paymentId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  return { ok: true, paymentId, approved };
}

async function completePayment(paymentId, txid) {
  const payment = unwrapPayment(await verifyPaymentExists(paymentId));
  const validationError = validatePaymentForApp(payment);
  if (validationError) {
    const error = new Error(validationError);
    error.status = 400;
    throw error;
  }

  const existingTxid = getCurrentTxid(payment);
  if (isDeveloperCompleted(payment)) {
    let unlock = null;
    if (isDexUnlockPayment(payment) || canUnlockDexForSandbox(payment)) {
      unlock = upsertLifetimeUnlock(payment, paymentId, existingTxid || txid || null);
    }
    return {
      ok: true,
      paymentId,
      txid: existingTxid || txid || null,
      ...(unlock ? { unlock } : {}),
      skipped: true,
      reason: 'Payment already completed'
    };
  }

  const finalTxid = txid || existingTxid;
  if (!finalTxid) {
    const error = new Error('txid is required to complete payment');
    error.status = 400;
    throw error;
  }

  const completed = await piRequest(`/v2/payments/${encodeURIComponent(paymentId)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ txid: finalTxid })
  });

  let unlock = null;
  if (isDexUnlockPayment(payment) || canUnlockDexForSandbox(payment)) {
    unlock = upsertLifetimeUnlock(payment, paymentId, finalTxid);
  }
  return {
    ok: true,
    paymentId,
    txid: finalTxid,
    completed,
    ...(unlock ? { unlock } : {})
  };
}

async function resolveIncompletePayment(paymentId) {
  const initialPayment = unwrapPayment(await verifyPaymentExists(paymentId));
  const response = {
    ok: true,
    paymentId,
    approved: false,
    completed: false,
    txid: getCurrentTxid(initialPayment) || null,
    requiresUserAction: false,
    unlock: null
  };

  if (!boolCandidate(initialPayment, ['developer_approved', 'developerApproved'])) {
    await piRequest(`/v2/payments/${encodeURIComponent(paymentId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    response.approved = true;
  }

  const refreshedPayment = unwrapPayment(await verifyPaymentExists(paymentId));
  const txid = getCurrentTxid(refreshedPayment);
  response.txid = txid || null;

  if (!txid) {
    response.requiresUserAction = true;
    response.reason = 'Payment is approved but still waiting for user-side blockchain confirmation';
    return response;
  }

  const completion = await completePayment(paymentId, txid);
  response.completed = true;
  response.unlock = completion.unlock || null;
  response.reason = completion.reason || 'Payment resolved';
  return response;
}

app.post('/approve', async (req, res) => {
  const { paymentId } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }

  try {
    return res.json(await approvePayment(paymentId));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      paymentId,
      error: error.message,
      details: error.body || null
    });
  }
});

app.post('/complete', async (req, res) => {
  const { paymentId, txid } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }
  if (!txid) {
    return res.status(400).json({ ok: false, error: 'txid is required' });
  }

  try {
    return res.json(await completePayment(paymentId, txid));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      paymentId,
      txid,
      error: error.message,
      details: error.body || null
    });
  }
});

app.post('/resolve-incomplete', async (req, res) => {
  const { paymentId } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }

  try {
    return res.json(await resolveIncompletePayment(paymentId));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      paymentId,
      error: error.message,
      details: error.body || null
    });
  }
});

app.post('/api/pi/payments/approve', async (req, res) => {
  const { paymentId } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }

  try {
    return res.json(await approvePayment(paymentId));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      paymentId,
      error: error.message,
      details: error.body || null
    });
  }
});

app.post('/api/pi/payments/complete', async (req, res) => {
  const { paymentId, txid } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }
  if (!txid) {
    return res.status(400).json({ ok: false, error: 'txid is required' });
  }

  try {
    return res.json(await completePayment(paymentId, txid));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      paymentId,
      txid,
      error: error.message,
      details: error.body || null
    });
  }
});

app.post('/api/pi/payments/resolve-incomplete', async (req, res) => {
  const { paymentId } = req.body || {};
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'paymentId is required' });
  }

  try {
    return res.json(await resolveIncompletePayment(paymentId));
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      paymentId,
      error: error.message,
      details: error.body || null
    });
  }
});

async function postToLayer1(pathname, payload) {
  if (!ANET_CHAIN_API_BASE_URL) {
    throw new Error('Layer 1 DEX bridge is not configured');
  }

  const headers = { 'Content-Type': 'application/json' };
  if (ANET_L1_DEX_ADMIN_KEY) {
    headers['x-anet-admin-key'] = ANET_L1_DEX_ADMIN_KEY;
  }

  const requestOnce = async (baseUrl) => {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }

    return { response, body };
  };

  const primary = await requestOnce(ANET_CHAIN_API_BASE_URL);
  if (primary.response.ok) {
    return primary.body;
  }

  const shouldRetryFallback =
    primary.response.status === 404 &&
    ANET_CHAIN_API_FALLBACK_BASE_URL &&
    ANET_CHAIN_API_FALLBACK_BASE_URL !== ANET_CHAIN_API_BASE_URL;

  if (shouldRetryFallback) {
    const fallback = await requestOnce(ANET_CHAIN_API_FALLBACK_BASE_URL);
    if (fallback.response.ok) {
      return fallback.body;
    }

    const error = new Error(`Layer 1 request failed (${fallback.response.status})`);
    error.status = fallback.response.status;
    error.body = fallback.body;
    throw error;
  }

  const error = new Error(`Layer 1 request failed (${primary.response.status})`);
  error.status = primary.response.status;
  error.body = primary.body;
  throw error;
}

async function getFromLayer1(pathname) {
  if (!ANET_CHAIN_API_BASE_URL) {
    throw new Error('Layer 1 DEX bridge is not configured');
  }

  const requestOnce = async (baseUrl) => {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'GET'
    });

    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }

    return { response, body };
  };

  const primary = await requestOnce(ANET_CHAIN_API_BASE_URL);
  if (primary.response.ok) {
    return primary.body;
  }

  const shouldRetryFallback =
    primary.response.status === 404 &&
    ANET_CHAIN_API_FALLBACK_BASE_URL &&
    ANET_CHAIN_API_FALLBACK_BASE_URL !== ANET_CHAIN_API_BASE_URL;

  if (shouldRetryFallback) {
    const fallback = await requestOnce(ANET_CHAIN_API_FALLBACK_BASE_URL);
    if (fallback.response.ok) {
      return fallback.body;
    }

    const error = new Error(`Layer 1 request failed (${fallback.response.status})`);
    error.status = fallback.response.status;
    error.body = fallback.body;
    throw error;
  }

  const error = new Error(`Layer 1 request failed (${primary.response.status})`);
  error.status = primary.response.status;
  error.body = primary.body;
  throw error;
}

async function getLatestLayer1BlockHeight() {
  try {
    const blocks = await getFromLayer1('/blocks');
    if (Array.isArray(blocks) && blocks.length > 0) {
      const heights = blocks
        .map((b) => Number(b?.block_height))
        .filter((value) => Number.isFinite(value));
      if (heights.length > 0) {
        return Math.max(...heights);
      }
    }
  } catch {
    // Ignore read errors and return null when chain height cannot be read.
  }
  return null;
}

app.post('/api/pi/dex/quote', async (req, res) => {
  const uid = normalizePiUid(req.body?.uid);
  const username = String(req.body?.username || '').trim();
  const walletAddress = String(req.body?.wallet_address || req.body?.trader || req.body?.provider || '').trim().toUpperCase();
  const tokenSymbol = String(req.body?.token_symbol || '').trim().toUpperCase();
  const amountIn = normalizePositiveInteger(req.body?.amount_in);
  const anetToToken = Boolean(req.body?.anet_to_token);

  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  if (!tokenSymbol) {
    return res.status(400).json({ ok: false, error: 'token_symbol is required' });
  }
  if (!amountIn) {
    return res.status(400).json({ ok: false, error: 'amount_in must be a positive integer' });
  }
  if (!walletAddress) {
    return res.status(400).json({ ok: false, error: 'wallet_address is required for eligibility checks' });
  }

  const access = await requireUnlockAndEligibility(uid, username, walletAddress);
  if (access.error) {
    return res.status(access.status || 403).json({
      ok: false,
      error: access.error,
      unlock: access.unlock || null,
      eligibility: access.eligibility || null,
      coinAccess: access.coinAccess || buildCoinAccess(false),
      walletBinding: access.walletBinding || getPublicWalletBinding(uid) || null
    });
  }

  try {
    const quote = await postToLayer1('/dex/swap/quote', {
      token_symbol: tokenSymbol,
      amount_in: amountIn,
      anet_to_token: anetToToken
    });

    return res.status(200).json({
      ok: true,
      unlock: access.unlock,
      eligibility: access.eligibility,
      coinAccess: access.coinAccess,
      walletBinding: access.walletBinding || null,
      walletBoundNow: Boolean(access.walletBoundNow),
      quote
    });
  } catch (requestError) {
    return res.status(requestError.status || 500).json({
      ok: false,
      error: requestError.message,
      details: requestError.body || null
    });
  }
});

app.post('/api/pi/dex/bootstrap', async (req, res) => {
  const uid = normalizePiUid(req.body?.uid);
  const username = String(req.body?.username || '').trim();
  const provider = String(req.body?.provider || '').trim().toUpperCase();
  const senderSeed = String(req.body?.sender_seed || '').trim();
  const tokenSymbol = String(req.body?.token_symbol || 'USDA').trim().toUpperCase();
  const anetAmountAnts = normalizePositiveInteger(req.body?.anet_amount_ants ?? 2000);
  const tokenAmountUnits = normalizePositiveInteger(req.body?.token_amount_units ?? 2000);
  const feeBps = Number.isInteger(Number(req.body?.fee_bps)) ? Number(req.body?.fee_bps) : 30;
  const mintTestAssets = Boolean(req.body?.mint_test_assets);

  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  if (!provider) {
    return res.status(400).json({ ok: false, error: 'provider is required' });
  }
  if (!senderSeed) {
    return res.status(400).json({ ok: false, error: 'sender_seed is required' });
  }
  if (!tokenSymbol) {
    return res.status(400).json({ ok: false, error: 'token_symbol is required' });
  }
  if (!anetAmountAnts || !tokenAmountUnits) {
    return res.status(400).json({ ok: false, error: 'anet_amount_ants and token_amount_units must be positive integers' });
  }

  const access = await requireUnlockAndEligibility(uid, username, provider);
  if (access.error) {
    return res.status(access.status || 403).json({
      ok: false,
      error: access.error,
      unlock: access.unlock || null,
      eligibility: access.eligibility || null,
      coinAccess: access.coinAccess || buildCoinAccess(false),
      walletBinding: access.walletBinding || getPublicWalletBinding(uid) || null
    });
  }

  try {
    const beforeHeight = await getLatestLayer1BlockHeight();

    const actions = [];
    if (mintTestAssets) {
      if (!PI_ALLOW_TEST_ASSET_MINT) {
        return res.status(403).json({ ok: false, error: 'mint_test_assets is disabled in this environment' });
      }
      if (!ANET_L1_DEX_ADMIN_KEY) {
        return res.status(400).json({ ok: false, error: 'ANET_L1_DEX_ADMIN_KEY is required when mint_test_assets=true' });
      }

      const mintedAnet = await postToLayer1('/admin/anet/mint', {
        address: provider,
        amount_ants: anetAmountAnts,
        admin_key: ANET_L1_DEX_ADMIN_KEY
      });
      actions.push({ type: 'admin_mint_anet', result: mintedAnet });

      const mintedAsset = await postToLayer1('/dex/assets/mint', {
        address: provider,
        token_symbol: tokenSymbol,
        amount: tokenAmountUnits,
        admin_key: ANET_L1_DEX_ADMIN_KEY
      });
      actions.push({ type: 'dex_mint_asset', result: mintedAsset });
    }

    let poolExists = false;
    try {
      const pool = await getFromLayer1(`/dex/pools/${encodeURIComponent(tokenSymbol)}`);
      poolExists = Boolean(pool);
    } catch (readError) {
      if (readError?.status !== 404) {
        throw readError;
      }
    }

    if (!poolExists) {
      const created = await postToLayer1('/dex/pools/create', {
        provider,
        sender_seed: senderSeed,
        token_symbol: tokenSymbol,
        anet_amount_ants: anetAmountAnts,
        token_amount_units: tokenAmountUnits,
        fee_bps: feeBps
      });
      actions.push({ type: 'create_pool', result: created });
    } else {
      const added = await postToLayer1('/dex/pools/add-liquidity', {
        provider,
        sender_seed: senderSeed,
        token_symbol: tokenSymbol,
        anet_amount_ants: anetAmountAnts,
        token_amount_units: tokenAmountUnits
      });
      actions.push({ type: 'add_liquidity', result: added });
    }

    const afterHeight = await getLatestLayer1BlockHeight();
    return res.status(200).json({
      ok: true,
      unlock: access.unlock,
      eligibility: access.eligibility,
      coinAccess: access.coinAccess,
      walletBinding: access.walletBinding || null,
      walletBoundNow: Boolean(access.walletBoundNow),
      token_symbol: tokenSymbol,
      anet_amount_ants: anetAmountAnts,
      token_amount_units: tokenAmountUnits,
      block_height_before: beforeHeight,
      block_height_after: afterHeight,
      block_advanced: Number.isFinite(beforeHeight) && Number.isFinite(afterHeight)
        ? afterHeight > beforeHeight
        : null,
      actions
    });
  } catch (requestError) {
    return res.status(requestError.status || 500).json({
      ok: false,
      error: requestError.message,
      details: requestError.body || null
    });
  }
});

app.post('/api/pi/dex/execute', async (req, res) => {
  const uid = normalizePiUid(req.body?.uid);
  const username = String(req.body?.username || '').trim();
  const trader = String(req.body?.trader || '').trim().toUpperCase();
  const senderSeed = String(req.body?.sender_seed || '').trim();
  const tokenSymbol = String(req.body?.token_symbol || '').trim().toUpperCase();
  const amountIn = normalizePositiveInteger(req.body?.amount_in);
  const anetToToken = Boolean(req.body?.anet_to_token);

  if (!uid) {
    return res.status(400).json({ ok: false, error: 'uid is required' });
  }
  if (!trader) {
    return res.status(400).json({ ok: false, error: 'trader is required' });
  }
  if (!senderSeed) {
    return res.status(400).json({ ok: false, error: 'sender_seed is required' });
  }
  if (!tokenSymbol) {
    return res.status(400).json({ ok: false, error: 'token_symbol is required' });
  }
  if (!amountIn) {
    return res.status(400).json({ ok: false, error: 'amount_in must be a positive integer' });
  }

  const access = await requireUnlockAndEligibility(uid, username, trader);
  if (access.error) {
    return res.status(access.status || 403).json({
      ok: false,
      error: access.error,
      unlock: access.unlock || null,
      eligibility: access.eligibility || null,
      coinAccess: access.coinAccess || buildCoinAccess(false),
      walletBinding: access.walletBinding || getPublicWalletBinding(uid) || null
    });
  }

  try {
    const swap = await postToLayer1('/dex/swap/execute', {
      trader,
      sender_seed: senderSeed,
      token_symbol: tokenSymbol,
      amount_in: amountIn,
      anet_to_token: anetToToken
    });

    const requestRecord = {
      id: `dex_${Date.now()}`,
      uid,
      username: access.unlock.username || username,
      trader,
      token_symbol: tokenSymbol,
      amount_in: amountIn,
      anet_to_token: anetToToken,
      requestedAt: new Date().toISOString(),
      chainResponse: swap
    };

    cashoutState.cashoutRequests.push(requestRecord);
    persistState();

    await ensureCashoutActivatedNftProfile(uid, access.unlock.username || username, trader);

    return res.status(200).json({
      ok: true,
      unlock: access.unlock,
      eligibility: access.eligibility,
      coinAccess: access.coinAccess,
      walletBinding: access.walletBinding || null,
      walletBoundNow: Boolean(access.walletBoundNow),
      request: requestRecord,
      swap
    });
  } catch (requestError) {
    return res.status(requestError.status || 500).json({
      ok: false,
      error: requestError.message,
      details: requestError.body || null
    });
  }
});

app.get('/api/btc/config', (_req, res) => {
  return res.status(200).json({
    ok: true,
    bitcoin: {
      enabled: Boolean(BTC_RPC_URL && BTC_RPC_USER && BTC_RPC_PASSWORD),
      network: BTC_NETWORK,
      requiredConfirmations: BTC_REQUIRED_CONFIRMATIONS,
      explorerBaseUrl: resolveBtcExplorerBaseUrl(),
      testAdminEnabled: BTC_ENABLE_TEST_ADMIN
    }
  });
});

app.post('/api/btc/payment/request', async (req, res) => {
  try {
    const uid = normalizePiUid(req.body?.uid);
    const username = String(req.body?.username || '').trim();
    const memo = String(req.body?.memo || 'a-network-unlock').trim();
    const amountSatsInput = normalizePositiveInteger(req.body?.amount_sats);
    const amountSats = amountSatsInput || parseBtcToSats(req.body?.amount_btc);
    const expiresMinutes = Math.max(1, Math.min(1440, Number(req.body?.expires_minutes || 120)));

    if (!uid) {
      return res.status(400).json({ ok: false, error: 'uid is required' });
    }
    if (!amountSats) {
      return res.status(400).json({ ok: false, error: 'amount_btc or amount_sats is required' });
    }

    const addressLabel = `anet-${uid}-${Date.now()}`;
    const address = await bitcoinRpc('getnewaddress', [addressLabel, 'bech32']);
    const id = `btcpay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + (expiresMinutes * 60 * 1000)).toISOString();

    const requestRecord = saveBtcPaymentRequest({
      id,
      uid,
      username,
      memo,
      amountSats,
      amountBtc: formatBtcAmountFromSats(amountSats),
      address: String(address || '').trim(),
      status: 'pending',
      txid: null,
      confirmations: 0,
      createdAt: nowIso,
      expiresAt,
      verifiedAt: null
    });

    return res.status(200).json({
      ok: true,
      paymentRequest: {
        ...requestRecord,
        btcExplorerAddressUrl: getBtcExplorerAddressUrl(requestRecord.address)
      }
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message,
      details: error.body || null
    });
  }
});

app.post('/api/btc/payment/verify', async (req, res) => {
  try {
    const requestId = String(req.body?.request_id || '').trim();
    const txid = String(req.body?.txid || '').trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'request_id is required' });
    }
    if (!txid) {
      return res.status(400).json({ ok: false, error: 'txid is required' });
    }

    const requestRecord = getBtcPaymentRequest(requestId);
    if (!requestRecord) {
      return res.status(404).json({ ok: false, error: 'BTC payment request not found' });
    }

    const txCheck = await evaluateBtcTransactionForRequest(requestRecord, txid);
    const updatedRecord = {
      ...requestRecord,
      txid: txCheck.txid,
      confirmations: txCheck.confirmations,
      status: txCheck.status,
      verifiedAt: txCheck.confirmed ? new Date().toISOString() : requestRecord.verifiedAt || null,
      lastCheckedAt: new Date().toISOString()
    };
    saveBtcPaymentRequest(updatedRecord);

    return res.status(200).json({
      ok: true,
      paymentRequest: {
        ...updatedRecord,
        btcExplorerAddressUrl: getBtcExplorerAddressUrl(updatedRecord.address),
        btcExplorerTransactionUrl: getBtcExplorerTransactionUrl(updatedRecord.txid)
      },
      txCheck
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message,
      details: error.body || null
    });
  }
});

app.get('/api/btc/payment/status/:requestId', async (req, res) => {
  try {
    const requestId = String(req.params?.requestId || '').trim();
    const txid = String(req.query?.txid || '').trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'requestId is required' });
    }

    const requestRecord = getBtcPaymentRequest(requestId);
    if (!requestRecord) {
      return res.status(404).json({ ok: false, error: 'BTC payment request not found' });
    }

    const trackedTxid = txid || String(requestRecord.txid || '').trim();
    let txCheck = null;
    let updatedRecord = requestRecord;

    if (trackedTxid) {
      txCheck = await evaluateBtcTransactionForRequest(requestRecord, trackedTxid);
      updatedRecord = {
        ...requestRecord,
        txid: txCheck.txid,
        confirmations: txCheck.confirmations,
        status: txCheck.status,
        verifiedAt: txCheck.confirmed ? new Date().toISOString() : requestRecord.verifiedAt || null,
        lastCheckedAt: new Date().toISOString()
      };
      saveBtcPaymentRequest(updatedRecord);
    }

    return res.status(200).json({
      ok: true,
      paymentRequest: {
        ...updatedRecord,
        btcExplorerAddressUrl: getBtcExplorerAddressUrl(updatedRecord.address),
        btcExplorerTransactionUrl: getBtcExplorerTransactionUrl(updatedRecord.txid)
      },
      txCheck
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message,
      details: error.body || null
    });
  }
});

app.get('/api/btc/payment/recent', (_req, res) => {
  const records = recentBtcPaymentProof(50);
  return res.status(200).json({
    ok: true,
    payments: records,
    count: records.length
  });
});

app.post('/api/btc/admin/force-confirm', (req, res) => {
  if (!BTC_ENABLE_TEST_ADMIN) {
    return res.status(403).json({ ok: false, error: 'BTC admin force-confirm is disabled in this environment' });
  }
  if (!PI_ADMIN_KEY) {
    return res.status(503).json({ ok: false, error: 'PI_ADMIN_KEY is not configured on this deployment' });
  }

  const providedKey = String(req.body?.admin_key || '').trim();
  if (!safeKeyEqual(providedKey, PI_ADMIN_KEY)) {
    return res.status(401).json({ ok: false, error: 'Invalid admin key' });
  }

  const requestId = String(req.body?.request_id || '').trim();
  if (!requestId) {
    return res.status(400).json({ ok: false, error: 'request_id is required' });
  }

  const existing = getBtcPaymentRequest(requestId);
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'BTC payment request not found' });
  }

  const updated = {
    ...existing,
    status: 'confirmed',
    confirmations: Math.max(BTC_REQUIRED_CONFIRMATIONS, Number(existing.confirmations || 0)),
    txid: String(req.body?.txid || existing.txid || `admin_btc_${Date.now()}`).trim(),
    verifiedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString()
  };
  saveBtcPaymentRequest(updated);

  return res.status(200).json({
    ok: true,
    paymentRequest: {
      ...updated,
      btcExplorerAddressUrl: getBtcExplorerAddressUrl(updated.address),
      btcExplorerTransactionUrl: getBtcExplorerTransactionUrl(updated.txid)
    }
  });
});

app.post('/api/pi/settlement/record', (req, res) => {
  try {
    const piPaymentId = String(req.body?.pi_payment_id || '').trim();
    const piTxid = String(req.body?.pi_txid || '').trim();
    const piAmount = String(req.body?.pi_amount || '').trim();
    const fromAddress = String(req.body?.from_address || '').trim();
    const toAddress = String(req.body?.to_address || '').trim();
    const l1BlockHeight = Number.isInteger(Number(req.body?.l1_block_height)) ? Number(req.body?.l1_block_height) : null;
    const l1BlockEvent = String(req.body?.l1_block_event || 'Pi: Payment Settlement').trim();

    if (!piPaymentId || !piTxid || !piAmount || !fromAddress || !toAddress) {
      return res.status(400).json({
        ok: false,
        error: 'pi_payment_id, pi_txid, pi_amount, from_address, and to_address are required'
      });
    }

    // Initialize settlement transactions array if not present
    if (!cashoutState.settlementTransactions) {
      cashoutState.settlementTransactions = [];
    }

    const settlementRecord = {
      id: `settlement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      piPaymentId,
      piTxid,
      piAmount,
      fromAddress,
      toAddress,
      l1BlockHeight,
      l1BlockEvent,
      recordedAt: new Date().toISOString(),
      piExplorerUrl: getPiExplorerTransactionUrl(piTxid)
    };

    cashoutState.settlementTransactions.push(settlementRecord);
    persistState();

    console.log(`[SETTLEMENT] Recorded Pi→L1 settlement: ${piPaymentId} (${piTxid})`);

    return res.status(200).json({
      ok: true,
      settlement: settlementRecord,
      message: `Settlement recorded: Pi payment ${piPaymentId} settled on L1 at block ${l1BlockHeight}`
    });
  } catch (error) {
    console.error(`[ERROR] Settlement recording failed: ${error.message}`);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get('/api/pi/settlement/recent', (_req, res) => {
  try {
    const settlements = (cashoutState.settlementTransactions || [])
      .slice(-50)
      .reverse();
    return res.status(200).json({
      ok: true,
      settlements,
      count: settlements.length
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/api/btc/settlement/record', (req, res) => {
  try {
    const btcTxid = String(req.body?.btc_txid || '').trim();
    const btcAmount = String(req.body?.btc_amount || '').trim();
    const fromAddress = String(req.body?.from_address || '').trim();
    const toAddress = String(req.body?.to_address || '').trim();
    const l1BlockHeight = Number.isInteger(Number(req.body?.l1_block_height)) ? Number(req.body.l1_block_height) : null;
    const l1BlockEvent = String(req.body?.l1_block_event || 'Bitcoin: Payment Settlement').trim();

    if (!btcTxid || !btcAmount || !fromAddress || !toAddress) {
      return res.status(400).json({
        ok: false,
        error: 'btc_txid, btc_amount, from_address, and to_address are required'
      });
    }

    ensureBtcCollections();
    const settlementRecord = {
      id: `btc_settlement_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      btcTxid,
      btcAmount,
      fromAddress,
      toAddress,
      l1BlockHeight,
      l1BlockEvent,
      confirmations: Number.isFinite(Number(req.body?.confirmations)) ? Number(req.body.confirmations) : null,
      recordedAt: new Date().toISOString(),
      btcExplorerTransactionUrl: getBtcExplorerTransactionUrl(btcTxid),
      btcExplorerAddressUrl: getBtcExplorerAddressUrl(toAddress)
    };

    cashoutState.btcSettlementTransactions.push(settlementRecord);
    persistState();

    return res.status(200).json({
      ok: true,
      settlement: settlementRecord,
      message: `Settlement recorded: BTC tx ${btcTxid} settled on L1 at block ${l1BlockHeight}`
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get('/api/btc/settlement/recent', (_req, res) => {
  try {
    ensureBtcCollections();
    const settlements = (cashoutState.btcSettlementTransactions || [])
      .slice(-50)
      .reverse();
    return res.status(200).json({
      ok: true,
      settlements,
      count: settlements.length
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/api/pi/cashout/request', (_req, res) => {
  return res.status(410).json({
    ok: false,
    error: 'Cashout flow has been replaced by the DEX flow. Use /api/pi/dex/quote and /api/pi/dex/execute instead.'
  });
});

/* ── EVM Bridge endpoints ──────────────────────────────────────────────
 *
 * The bsc-relayer service is the authoritative writer for EVM → L1 swaps.
 * It watches BSC for AnetSwap deposits and calls
 *   POST {ANET_CHAIN_API_BASE_URL}/admin/bridge/evm/credit
 * to credit ANTS on L1. pi-backend MUST NOT also write here — running both
 * pipelines causes double-credits and confusing logs.
 *
 * What this service still exposes:
 *   - GET /api/bridge/evm/status/:txHash   (proxies to L1 public lookup)
 *   - GET /api/bridge/evm/history/:evmAddress
 *       (returns legacy records still in the local state file; new swaps are
 *        not written here anymore, so this list will only show pre-migration
 *        history)
 *
 * Deleted in this commit:
 *   - POST /api/bridge/evm/notify
 *   - POST /api/bridge/evm/admin/process
 *   - background auto-processor (setInterval that called L1 /admin/bridge/evm/credit)
 *   - helpers evmGetTransaction(), computeBridgeAntsFromChain()
 *
 * Removable env vars (no longer read by this file):
 *   EVM_BRIDGE_ADMIN_KEY, EVM_BRIDGE_CONTRACT_BSC, EVM_RPC_BSC, ANET_BEP20_ADDRESS_BSC
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/bridge/evm/status/:txHash
 * Returns whether the L1 chain has credited this BSC tx hash.
 * Proxies to L1's public lookup endpoint so the mobile app can stop polling.
 */
app.get('/api/bridge/evm/status/:txHash', async (req, res) => {
  const txHash = String(req.params.txHash || '').toLowerCase();
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ ok: false, error: 'Invalid txHash.' });
  }

  // Legacy local record (pre-migration). If we have one and it's marked
  // processed, trust it.
  const localRecord = cashoutState.evmBridgeRequests?.[txHash] || null;
  if (localRecord && localRecord.processed) {
    return res.json({
      ok: true,
      found: true,
      processed: true,
      anetTxId: localRecord.anetTxId || `bridge:evm:${txHash}`,
      createdAt: localRecord.createdAt || null,
      processedAt: localRecord.processedAt || null,
      source: 'local',
    });
  }

  // Ask L1 directly. New swaps (post-migration) are minted by the bsc-relayer,
  // so L1 is the source of truth.
  if (ANET_CHAIN_API_BASE_URL) {
    try {
      const resp = await fetch(
        `${ANET_CHAIN_API_BASE_URL}/bridge/evm/credit/${txHash}`,
        { method: 'GET', headers: { 'Accept': 'application/json' } }
      );
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const processed = Boolean(data?.processed);
        return res.json({
          ok: true,
          found: processed || Boolean(localRecord),
          processed,
          anetTxId: processed ? (data?.tx_id || `bridge:evm:${txHash}`) : null,
          createdAt: localRecord?.createdAt || null,
          processedAt: null,
          source: 'l1',
        });
      }
    } catch (err) {
      console.warn(`[EVM Bridge] L1 status lookup failed for ${txHash.slice(0, 18)}…: ${err.message}`);
    }
  }

  // L1 unreachable or not configured — fall back to whatever local state we have.
  if (localRecord) {
    return res.json({
      ok: true,
      found: true,
      processed: Boolean(localRecord.processed),
      anetTxId: localRecord.anetTxId || null,
      createdAt: localRecord.createdAt || null,
      processedAt: localRecord.processedAt || null,
      source: 'local',
    });
  }
  return res.json({ ok: true, found: false, processed: false, source: 'unknown' });
});

/**
 * GET /api/bridge/evm/history/:evmAddress
 * Returns bridge swap history for a given EVM address from the local state file.
 * NOTE: only legacy pre-migration records appear here. The bsc-relayer is the
 * authoritative writer for new swaps and does not populate this list.
 */
app.get('/api/bridge/evm/history/:evmAddress', (req, res) => {
  const addr = String(req.params.evmAddress || '').toLowerCase().trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    return res.status(400).json({ ok: false, error: 'Invalid EVM address.' });
  }
  const chainId = Number(req.query.chainId) || 56;
  const nativeSym = EVM_NATIVE_SYMBOL[chainId] || 'BNB';
  const explorerBase = EVM_EXPLORER_TX[chainId] || '';

  const swaps = Object.values(cashoutState.evmBridgeRequests || {})
    .filter(r => r.evmSender === addr)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map(r => {
      const isNative = r.tokenAddress === '0x0000000000000000000000000000000000000000';
      const tokenSymbol = isNative ? nativeSym : 'TOKEN';
      let grossAmountFormatted = '';
      try {
        const wei = BigInt(r.grossAmountHex || '0x0');
        grossAmountFormatted = (Number(wei) / 1e18).toFixed(6);
      } catch (_) { grossAmountFormatted = '?'; }
      return {
        txHash:              r.txHash,
        chainId:             r.chainId,
        evmSender:           r.evmSender,
        anetRecipient:       r.anetRecipient,
        tokenAddress:        r.tokenAddress,
        tokenSymbol,
        grossAmountFormatted,
        processed:           r.processed,
        anetTxId:            r.anetTxId || null,
        createdAt:           r.createdAt,
        processedAt:         r.processedAt || null,
        explorerUrl:         explorerBase ? `${explorerBase}${r.txHash}` : '',
      };
    });

  return res.json({ ok: true, swaps });
});

/**
 * Minimal JSON-RPC helper for reading EVM receipts (kept for /api/evm/activity
 * which uses it to reject reverted txs before recording a block event on L1).
 */
async function evmGetReceipt(txHash, chainId) {
  const rpcUrl = EVM_RPC_URLS[chainId];
  if (!rpcUrl) throw new Error(`No RPC URL configured for chainId ${chainId}`);

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id:      1,
      method:  'eth_getTransactionReceipt',
      params:  [txHash],
    }),
  });

  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
  return data.result;  // null if pending, object if mined
}

/* ── End EVM Bridge endpoints ──────────────────────────────────────── */

/* ── EVM Wallet Activity — block events on ANET L1 ──────────────────
 * POST /api/evm/activity
 * Called by the mobile app after a successful EVM Send or Swap.
 * Forwards the activity to the ANET L1 chain so it can create a
 * corresponding block event (same as native DEX swaps do).
 * Requires: ANET_CHAIN_API_BASE_URL + ANET_L1_DEX_ADMIN_KEY on the server.
 * ─────────────────────────────────────────────────────────────────── */
const _evmActivityProcessedHashes = new Set(); // in-memory dedup within session

app.post('/api/evm/activity', async (req, res) => {
  try {
    const { txHash, activityType, tokenSymbol, amount, anetAddress, evmAddress, chainId } = req.body || {};

    // Strict format validation: EVM tx hash must be 0x + 64 lowercase hex chars
    if (!txHash || typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return res.status(400).json({ ok: false, error: 'txHash must be a valid EVM transaction hash (0x + 64 hex chars)' });
    }
    const validTypes = ['send', 'swap', 'receive'];
    const normalizedType = (activityType || '').toLowerCase().trim();
    if (!validTypes.includes(normalizedType)) {
      return res.status(400).json({ ok: false, error: 'activityType must be send, swap, or receive' });
    }

    const txHashLower = txHash.toLowerCase();
    const effectiveChainId = Number(chainId) || 56;

    // In-memory dedup: avoid spamming L1 for the same tx hash
    if (_evmActivityProcessedHashes.has(txHashLower)) {
      return res.json({ ok: true, new_block_triggered: false, cached: true });
    }

    // Verify the BSC transaction receipt before creating an L1 block event.
    // A reverted tx (status 0x0) is rejected outright.
    // A pending tx (null receipt) or RPC timeout is allowed optimistically.
    try {
      const receipt = await Promise.race([
        evmGetReceipt(txHashLower, effectiveChainId),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000)),
      ]);
      if (receipt && receipt.status === '0x0') {
        return res.status(400).json({ ok: false, error: 'BSC transaction was reverted — cannot create block event' });
      }
    } catch (receiptErr) {
      // Pending tx or RPC unreachable → proceed optimistically
      console.warn(`[EVM Activity] Receipt check skipped for ${txHashLower.slice(0, 18)}…: ${receiptErr.message}`);
    }

    // If L1 chain is not configured just acknowledge silently
    if (!ANET_CHAIN_API_BASE_URL || !ANET_L1_DEX_ADMIN_KEY) {
      _evmActivityProcessedHashes.add(txHashLower);
      return res.json({ ok: true, new_block_triggered: false, reason: 'L1 not configured' });
    }

    const chainRes = await fetch(`${ANET_CHAIN_API_BASE_URL}/admin/evm/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_key:     ANET_L1_DEX_ADMIN_KEY,
        evm_tx_hash:   txHashLower,
        activity_type: normalizedType,
        token_symbol:  tokenSymbol || null,
        amount_str:    amount != null ? String(amount) : null,
        evm_address:   evmAddress || null,
        anet_address:  anetAddress || null,
        evm_chain_id:  effectiveChainId,
      }),
    }).catch(e => ({ ok: false, _err: e.message }));

    if (!chainRes.ok) {
      const body = typeof chainRes.text === 'function'
        ? await chainRes.text().catch(() => '?')
        : (chainRes._err || '?');
      console.error(`[EVM Activity] L1 event failed for ${txHashLower}: ${String(body).slice(0, 120)}`);
      return res.status(502).json({ ok: false, error: 'L1 chain call failed' });
    }

    const data = await chainRes.json().catch(() => ({}));
    _evmActivityProcessedHashes.add(txHashLower);
    // Limit set size to 5000 entries to prevent unbounded memory growth
    if (_evmActivityProcessedHashes.size > 5000) {
      const first = _evmActivityProcessedHashes.values().next().value;
      _evmActivityProcessedHashes.delete(first);
    }

    console.log(`[EVM Activity] ✓ ${normalizedType} block event on L1 — BSC tx ${txHashLower.slice(0, 18)}…`);
    return res.json({ ok: true, new_block_triggered: data.new_block_triggered ?? true, block_event: data.block_event });
  } catch (err) {
    console.error('[EVM Activity] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

/* ── End EVM Wallet Activity ─────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────
 * AnetScan Explorer Read-only Endpoints
 *
 * Powers the static explorer pages at /scan.html (mainnet) and /nft.html
 * (NFT explorer) on a-network.net. All routes are public, read-only, and
 * cached for 15s to absorb traffic spikes without hitting the chain node.
 *
 * If the chain node or NFT db is unavailable, endpoints return shaped
 * empty payloads (never 500) so the explorer renders skeletons cleanly.
 * ──────────────────────────────────────────────────────────────────── */
const SCAN_CACHE_TTL_MS = 15 * 1000;
const _scanCache = new Map(); // key -> { at, value }
function scanCacheGet(key) {
  const hit = _scanCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SCAN_CACHE_TTL_MS) { _scanCache.delete(key); return null; }
  return hit.value;
}
function scanCachePut(key, value) {
  _scanCache.set(key, { at: Date.now(), value });
  return value;
}

function chainNodeBase() {
  return String(process.env.ANET_CHAIN_API_BASE_URL || '').replace(/\/+$/, '');
}

async function chainNodeFetch(path, timeoutMs = 4000) {
  const base = chainNodeBase();
  if (!base) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const r = await fetch(base + path, { signal: controller.signal, headers: { 'accept': 'application/json' } });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

// GET /api/chain/stats — header tile metrics for scan.html
app.get('/api/chain/stats', async (_req, res) => {
  try {
    const cached = scanCacheGet('chain:stats');
    if (cached) return res.json(cached);

    // anet-chain exposes /stats/investor (JSON) + /blocks?limit=N (JSON Block[]).
    // We synthesize the explorer tiles from these two real endpoints.
    const [inv, recentBlocks] = await Promise.all([
      chainNodeFetch('/stats/investor'),
      chainNodeFetch('/blocks?limit=64')
    ]);

    const blocks = Array.isArray(recentBlocks) ? recentBlocks : [];
    const latest = blocks.length ? blocks[blocks.length - 1] : null;

    // 24h tx count: sum of block.transactions.length for blocks whose
    // epoch_end falls within the last 24h.
    const dayMs = 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    let txs24h = 0;
    for (const b of blocks) {
      const ts = b && b.epoch_end ? Date.parse(b.epoch_end) : NaN;
      if (!Number.isFinite(ts)) continue;
      if (nowMs - ts <= dayMs) txs24h += Array.isArray(b.transactions) ? b.transactions.length : 0;
    }

    // TPS: average over the last 16 blocks (or whatever we have).
    let tps = null;
    if (blocks.length >= 2) {
      const tail = blocks.slice(-16);
      const first = Date.parse(tail[0].epoch_start || tail[0].epoch_end);
      const last = Date.parse(tail[tail.length - 1].epoch_end || tail[tail.length - 1].epoch_start);
      const txs = tail.reduce((n, b) => n + (Array.isArray(b.transactions) ? b.transactions.length : 0), 0);
      const spanSec = Math.max(1, (last - first) / 1000);
      tps = Number((txs / spanSec).toFixed(2));
    }

    // 14-day tx history (one bucket per day, oldest -> newest).
    const buckets = Array(14).fill(0);
    const startMs = nowMs - 14 * dayMs;
    for (const b of blocks) {
      const ts = b && b.epoch_end ? Date.parse(b.epoch_end) : NaN;
      if (!Number.isFinite(ts) || ts < startMs) continue;
      const idx = Math.min(13, Math.max(0, Math.floor((ts - startMs) / dayMs)));
      buckets[idx] += Array.isArray(b.transactions) ? b.transactions.length : 0;
    }

    // Block time: average gap over the tail.
    let blockTimeSec = 0.5;
    if (blocks.length >= 2) {
      const tail = blocks.slice(-16);
      const gaps = [];
      for (let i = 1; i < tail.length; i++) {
        const a = Date.parse(tail[i - 1].epoch_end || tail[i - 1].epoch_start);
        const c = Date.parse(tail[i].epoch_end || tail[i].epoch_start);
        if (Number.isFinite(a) && Number.isFinite(c)) gaps.push((c - a) / 1000);
      }
      if (gaps.length) blockTimeSec = Number((gaps.reduce((s, g) => s + g, 0) / gaps.length).toFixed(2));
    }

    const payload = {
      price: { value: null, change24h: null }, // ANET price: backend has no on-chain oracle yet.
      gasGwei: 0.001, // closed-loop ANTS economy: gas is effectively flat.
      transactions24h: txs24h,
      tps,
      latestBlock: {
        height: latest ? Number(latest.block_height || 0) : Number((inv && inv.latest_block_height) || 0),
        timeSec: blockTimeSec
      },
      marketCapAnts: inv && inv.activated_supply_ants != null ? Number(inv.activated_supply_ants) : null,
      circulatingAnts: inv && inv.activated_supply_ants != null ? Number(inv.activated_supply_ants) : null,
      votingPowerAnet: inv && inv.activated_supply_anet != null ? Number(inv.activated_supply_anet) : null,
      txChart14d: buckets,
      updatedAt: new Date().toISOString()
    };
    return res.json(scanCachePut('chain:stats', payload));
  } catch (_) {
    return res.json({
      price: { value: null, change24h: null },
      gasGwei: 0.001,
      transactions24h: null,
      tps: null,
      latestBlock: { height: 0, timeSec: 0.5 },
      marketCapAnts: null,
      circulatingAnts: null,
      votingPowerAnet: null,
      txChart14d: Array(14).fill(0),
      updatedAt: new Date().toISOString()
    });
  }
});

// GET /api/chain/latest-blocks?limit=
app.get('/api/chain/latest-blocks', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 6));
    const key = 'chain:blocks:' + limit;
    const cached = scanCacheGet(key);
    if (cached) return res.json(cached);

    const upstream = await chainNodeFetch('/blocks?limit=' + limit);
    const list = Array.isArray(upstream) ? upstream : [];
    // anet-chain returns oldest-first within the latest_blocks window; reverse
    // for newest-first display.
    const reversed = list.slice().reverse();
    const payload = reversed.map((b) => ({
      height: Number(b.block_height || 0),
      timestamp: b.epoch_end ? Math.floor(Date.parse(b.epoch_end) / 1000) : 0,
      validator: Array.isArray(b.miners) && b.miners.length ? String(b.miners[0]) : '',
      txCount: Array.isArray(b.transactions) ? b.transactions.length : 0,
      reward: b.total_fees_ants != null ? Number(b.total_fees_ants) : null
    }));
    return res.json(scanCachePut(key, payload));
  } catch (_) {
    return res.json([]);
  }
});

// GET /api/chain/latest-transactions?limit=
app.get('/api/chain/latest-transactions', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 6));
    const key = 'chain:txs:' + limit;
    const cached = scanCacheGet(key);
    if (cached) return res.json(cached);

    // anet-chain has no /transactions GET — flatten the txs out of the most
    // recent blocks. We pull a wider window so even quiet blocks still yield N.
    const upstream = await chainNodeFetch('/blocks?limit=32');
    const blocks = Array.isArray(upstream) ? upstream.slice().reverse() : [];
    const out = [];
    for (const b of blocks) {
      const ts = b.epoch_end ? Math.floor(Date.parse(b.epoch_end) / 1000) : 0;
      const txs = Array.isArray(b.transactions) ? b.transactions : [];
      for (let i = txs.length - 1; i >= 0; i--) {
        const t = txs[i] || {};
        out.push({
          hash: String(t.hash || t.id || (`blk${b.block_height || 0}-${i}`)),
          timestamp: ts,
          from: String(t.from || t.sender || t.source || ''),
          to: String(t.to || t.recipient || t.destination || ''),
          valueAnts: t.amount_ants != null ? Number(t.amount_ants)
                    : (t.value_ants != null ? Number(t.value_ants)
                    : (t.amount != null ? Number(t.amount) : null))
        });
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    return res.json(scanCachePut(key, out));
  } catch (_) {
    return res.json([]);
  }
});

// GET /api/nft/stats — header tile metrics for nft.html explorer
app.get('/api/nft/stats', async (_req, res) => {
  try {
    const cached = scanCacheGet('nft:stats');
    if (cached) return res.json(cached);

    let totalNfts = 0, collections = 0, activeListings = 0, totalHolders = 0;
    let floorAnts = null, volume24hAnts = null;
    const mintChart14d = Array(14).fill(0);

    if (nftDb) {
      try {
        const row = await dbGet(nftDb, 'SELECT COUNT(*) AS c FROM nft_assets', []);
        totalNfts = Number(row && row.c) || 0;
      } catch (_) {}
      try {
        const row = await dbGet(nftDb, "SELECT COUNT(DISTINCT collection_id) AS c FROM nft_assets WHERE collection_id IS NOT NULL AND collection_id != ''", []);
        collections = Number(row && row.c) || 0;
      } catch (_) {}
      try {
        const row = await dbGet(nftDb, "SELECT COUNT(*) AS c FROM nft_market_listings WHERE status = 'active'", []);
        activeListings = Number(row && row.c) || 0;
      } catch (_) {}
      try {
        const row = await dbGet(nftDb, 'SELECT COUNT(DISTINCT uid) AS c FROM nft_assets', []);
        totalHolders = Number(row && row.c) || 0;
      } catch (_) {}
      try {
        const row = await dbGet(nftDb, "SELECT MIN(ask_price_ants) AS p FROM nft_market_listings WHERE status = 'active' AND ask_price_ants > 0", []);
        floorAnts = row && row.p != null ? Number(row.p) : null;
      } catch (_) {}
      try {
        const sinceSec = Math.floor((Date.now() - 24 * 3600 * 1000) / 1000);
        const row = await dbGet(nftDb, "SELECT COALESCE(SUM(final_price_ants), 0) AS v FROM nft_market_listings WHERE status = 'sold' AND COALESCE(sold_at, updated_at, created_at) >= ?", [sinceSec]);
        volume24hAnts = row && row.v != null ? Number(row.v) : 0;
      } catch (_) {}
      try {
        // Build 14-day mint histogram. Bucket index 0 = oldest, 13 = today.
        const nowSec = Math.floor(Date.now() / 1000);
        const startSec = nowSec - 14 * 86400;
        const rows = await dbAll(
          nftDb,
          'SELECT created_at FROM nft_assets WHERE created_at >= ? ORDER BY created_at ASC',
          [startSec]
        );
        if (Array.isArray(rows)) {
          for (const r of rows) {
            const ts = Number(r.created_at || 0);
            if (!ts) continue;
            const idx = Math.min(13, Math.max(0, Math.floor((ts - startSec) / 86400)));
            mintChart14d[idx]++;
          }
        }
      } catch (_) {}
    }

    const payload = {
      floorAnts,
      volume24hAnts,
      collections,
      totalNfts,
      activeListings,
      totalHolders,
      mintChart14d,
      updatedAt: new Date().toISOString()
    };
    return res.json(scanCachePut('nft:stats', payload));
  } catch (_) {
    return res.json({
      floorAnts: null, volume24hAnts: null, collections: 0,
      totalNfts: 0, activeListings: 0, totalHolders: 0,
      mintChart14d: Array(14).fill(0),
      updatedAt: new Date().toISOString()
    });
  }
});

// GET /api/nft/latest-mints?limit=
app.get('/api/nft/latest-mints', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 6));
    const key = 'nft:mints:' + limit;
    const cached = scanCacheGet(key);
    if (cached) return res.json(cached);
    if (!nftDb) return res.json([]);

    const rows = await dbAll(
      nftDb,
      `SELECT id AS tokenId, uid AS minter, created_at AS timestamp,
              COALESCE(collection_id, asset_type, 'public-proof') AS collection,
              NULL AS priceAnts
         FROM nft_assets
         ORDER BY created_at DESC
         LIMIT ?`,
      [limit]
    );
    const payload = (rows || []).map((r) => ({
      tokenId: String(r.tokenId || ''),
      minter: String(r.minter || ''),
      timestamp: Number(r.timestamp || 0),
      collection: String(r.collection || ''),
      priceAnts: r.priceAnts != null ? Number(r.priceAnts) : null
    }));
    return res.json(scanCachePut(key, payload));
  } catch (_) {
    return res.json([]);
  }
});

// GET /api/nft/latest-sales?limit=
app.get('/api/nft/latest-sales', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 6));
    const key = 'nft:sales:' + limit;
    const cached = scanCacheGet(key);
    if (cached) return res.json(cached);
    if (!nftDb) return res.json([]);

    const rows = await dbAll(
      nftDb,
      `SELECT asset_id AS tokenId,
              seller_uid AS seller,
              COALESCE(winner_uid, '') AS buyer,
              COALESCE(sold_at, updated_at, created_at) AS timestamp,
              final_price_ants AS priceAnts
         FROM nft_market_listings
         WHERE status = 'sold'
         ORDER BY COALESCE(sold_at, updated_at, created_at) DESC
         LIMIT ?`,
      [limit]
    );
    const payload = (rows || []).map((r) => ({
      tokenId: String(r.tokenId || ''),
      seller: String(r.seller || ''),
      buyer: String(r.buyer || ''),
      timestamp: Number(r.timestamp || 0),
      priceAnts: r.priceAnts != null ? Number(r.priceAnts) : null
    }));
    return res.json(scanCachePut(key, payload));
  } catch (_) {
    return res.json([]);
  }
});

/* ── End AnetScan Explorer Endpoints ─────────────────────────────── */

initializeNftDatabase()
  .then(() => {
    // ── S1-3: Production safety gate (fail closed before listen) ─────────
    // A single env typo like PI_SANDBOX=true leaking into prod would silently
    // enable admin force-unlock and test-asset minting via the default-on
    // ternaries above. Mirror the anet-chain `validate_production_safety_flags`
    // pattern: when NODE_ENV is production, hard-exit if any sandbox toggle
    // is true. Warnings stay for non-prod so reviewers still see the banner.
    const RUNTIME_ENV = String(process.env.NODE_ENV || process.env.APP_ENV || '')
      .trim()
      .toLowerCase();
    const IS_PRODUCTION_RUNTIME = RUNTIME_ENV === 'production' || RUNTIME_ENV === 'prod';
    if (IS_PRODUCTION_RUNTIME) {
      const violations = [];
      if (PI_SANDBOX) violations.push('PI_SANDBOX=true');
      if (PI_ENABLE_TEST_ADMIN) violations.push('PI_ENABLE_TEST_ADMIN=true');
      if (PI_ALLOW_TEST_ASSET_MINT) violations.push('PI_ALLOW_TEST_ASSET_MINT=true');
      if ((process.env.PI_ALLOW_INELIGIBLE_FOR_DEX_TEST || 'false').toLowerCase() === 'true') {
        violations.push('PI_ALLOW_INELIGIBLE_FOR_DEX_TEST=true');
      }
      if (BTC_ENABLE_TEST_ADMIN) violations.push('BTC_ENABLE_TEST_ADMIN=true');
      if (violations.length > 0) {
        console.error(
          `[FATAL] Unsafe production config: ${violations.join(', ')}. ` +
          'These sandbox-only toggles MUST be false in NODE_ENV=production. ' +
          'Refusing to start.'
        );
        process.exit(2);
      }
      if (!PI_ADMIN_KEY) {
        console.error('[FATAL] PI_ADMIN_KEY is required in production. Refusing to start.');
        process.exit(2);
      }
      if (ALLOWED_ORIGIN === '*') {
        console.error(
          '[FATAL] ALLOWED_ORIGIN="*" is not allowed in production. ' +
          'Set ALLOWED_ORIGIN to your production domain (e.g. https://a-network.net). Refusing to start.'
        );
        process.exit(2);
      }
    }

    app.listen(port, host, () => {
      console.log(`Pi backend listening on http://${host}:${port}`);
      console.log(`[NFT] Identity DB ready at ${NFT_DB_PATH}`);
      console.log(`[NFT] Minimum profile creation stake: ${NFT_MIN_PROFILE_ANTS} ANTS`);

      // EVM bridge auto-processor removed: the bsc-relayer service is now the
      // sole writer for EVM → L1 credit calls. See the comment block above
      // the /api/bridge/evm/* routes for migration details.

      // ── Production safety checks ──────────────────────────────────────────
      if (!PI_SANDBOX) {
        if (!PI_ADMIN_KEY) {
          console.warn('[SECURITY WARNING] PI_ADMIN_KEY is not set. Admin endpoints will return 503. Set PI_ADMIN_KEY in production to enable admin access.');
        }
        if (ALLOWED_ORIGIN === '*') {
          console.warn('[SECURITY WARNING] ALLOWED_ORIGIN is set to "*" (all origins). Set ALLOWED_ORIGIN to your production domain (e.g. https://a-network.net).');
        }
        if (PI_ENABLE_TEST_ADMIN) {
          console.warn('[SECURITY WARNING] PI_ENABLE_TEST_ADMIN=true in a non-sandbox environment. Admin force-unlock endpoints are active.');
        }
        if (PI_ALLOW_TEST_ASSET_MINT) {
          console.warn('[SECURITY WARNING] PI_ALLOW_TEST_ASSET_MINT=true in a non-sandbox environment. Test asset minting is active.');
        }
        if ((process.env.PI_ALLOW_INELIGIBLE_FOR_DEX_TEST || 'false').toLowerCase() === 'true') {
          console.warn('[SECURITY WARNING] PI_ALLOW_INELIGIBLE_FOR_DEX_TEST=true in a non-sandbox environment. DEX cashout requirement is bypassed.');
        }
      }
    });
  })
  .catch((error) => {
    console.error(`[FATAL] Failed to initialize NFT database: ${error.message}`);
    process.exit(1);
  });
