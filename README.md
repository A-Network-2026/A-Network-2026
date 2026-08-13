<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=rect&color=gradient&customColorList=12,20,24,30&height=220&section=header&text=A-Network&fontSize=54&fontAlignY=38&desc=WEB2_SESSION_MINING%20%7C%20WEB3_UTILITY_TOKEN%20%7C%20WEB4_LAYER1_PATH&descFontSize=18&fontColor=FFFFFF&stroke=FFFFFF&strokeWidth=1" alt="A-Network banner" />
  <img src="docs/play-feature-graphic.png" alt="A-Network feature graphic" width="100%" />
</div>

---

### Pi DEX Access App

A Pi Browser-ready starter page is now included at `pi-testnet.html`.

What it includes:

- Pi SDK initialization in sandbox mode (`Pi.init({ version: '2.0', sandbox: true })`)
- Pi user authentication (`username` + `payments` scopes)
- One-time lifetime DEX access unlock payment (`Pi.createPayment`, exact `1 Pi`)
- Backend DEX-status lookup per Pi user
- Layer 1 swap quote and execute after unlock
- Callback hooks for approval and completion against your backend

Required backend endpoints:

- `GET /api/pi/dex/status/:uid`
- `POST /api/pi/payments/approve`
- `POST /api/pi/payments/complete`
- `POST /api/pi/dex/quote`
- `POST /api/pi/dex/execute`

The page posts `paymentId` and `txid` to finalize the one-time lifetime unlock, then posts swap quote and execute data to your backend. Your server must validate the Pi payment, persist the lifetime unlock, and then forward approved requests to your Layer 1 `POST /dex/swap/quote` and `POST /dex/swap/execute` routes.

Included backend starter:

- Folder: `pi-backend/`
- Health endpoint: `GET /health`
- Pi SDK config endpoint: `GET /api/pi/config`
- DEX status endpoint: `GET /api/pi/dex/status/:uid`
- Payment endpoints:
  - `POST /api/pi/payments/approve`
  - `POST /api/pi/payments/complete`
  - `POST /api/pi/dex/quote`
  - `POST /api/pi/dex/execute`

Backend policy controls (`pi-backend/.env`):

- `PI_SANDBOX=true|false` (controls frontend Pi SDK mode through `/api/pi/config`)
- `PI_REQUIRED_AMOUNT` (exact Pi amount required before mining access is unlocked)
- `PI_ALLOWED_METADATA_PURPOSE` (expected `metadata.purpose` value, default `dex-lifetime-unlock`)
- `PI_ALLOWED_METADATA_APP` (expected `metadata.app` value)
- `PI_ALLOWED_MEMO_PREFIX` (required prefix in payment memo)
- `PI_APP_WALLET` (optional destination wallet match)
- `PI_MIN_AMOUNT` and `PI_MAX_AMOUNT` (allowed payment amount range)
- `PI_CASHOUT_STATE_PATH` (persistent JSON file for lifetime DEX unlock records)
- `ANET_CHAIN_API_BASE_URL` (Layer 1 DEX bridge)

Current default policy for testnet:

- Lifetime DEX access unlock requires an exact `1 Pi` payment only once per Pi user
- Frontend enforces exact amount based on backend `/api/pi/config`
- Backend enforces exact amount, metadata/memo validation, stores the unlock, and then uses that unlock to authorize later DEX quote and swap requests

Quick start:

1. Copy `pi-backend/.env.example` to `pi-backend/.env`
2. Set your real `PI_API_KEY` from Pi Developer Portal
3. Install and run backend:

```bash
cd pi-backend
npm install
npm run start
```

4. Open `pi-testnet.html` in Pi Browser sandbox and set `Backend Base URL` to your local or deployed backend URL.

Use this page in Pi Browser sandbox mode first, then switch to production mode when checklist validation is complete.

---

### Mainframe Protocol

<div align="center">

<pre>
> Initiating A-Network startup sequence...
> Loading mobile mining interface v1.0.6... [COMPLETE]
> Connecting Fastify backend and PostgreSQL ledger... [ACTIVE]
> Syncing Web3 utility-token visibility layer... [RUNNING]
> ANTS Mainnet... [LIVE - explorer.a-network.net]
> Mission: build a long-term mining ecosystem with real product surfaces.
</pre>

</div>

---

### Primary System: A-Network Stack

<div align="center">

<pre>
> System Type   : Mobile Mining + Backend + Public Docs
> Core Focus    : Session rewards, token visibility, future Layer 1 migration
> Mission       : Connect app-native participation with broader network utility
> Status        : LIVE DEVELOPMENT
</pre>

</div>

A-Network is a full-stack product built around three linked layers:

- Web2 off-chain application services
- Web3 on-chain `21,000,000 ANET` utility-token visibility and wallet integration on BNB Smart Chain
- Web4/Web5 coordination concepts connecting the Web3 utility token to a separate `ANTS -> ANET` Layer 1 mining economy

The current product includes a Flutter app, a Node.js/Fastify backend, a PostgreSQL database, public legal pages, and a public website surface.

---

### Live System Status

<p align="center">
  <img src="https://img.shields.io/badge/Mobile_App-v1.0.21+71_LIVE-1f9d55?style=for-the-badge" alt="Mobile App v1.0.21+71 Live" />
  <img src="https://img.shields.io/badge/Fastify_API-ACTIVE-2563eb?style=for-the-badge" alt="Fastify API Active" />
  <img src="https://img.shields.io/badge/Bridge_Policy-One_Way_(L1→External)-f59e0b?style=for-the-badge" alt="Bridge Policy One Way" />
  <img src="https://img.shields.io/badge/Layer1_Chain-MAINNET_LIVE-7c3aed?style=for-the-badge" alt="ANTS Mainnet Live" />
</p>

<div align="center">

<pre>
> Node Status        : SYNCHRONIZED
> App Version        : v1.0.21+71 (Play Store / App Store ready)
> Mining Sessions    : 6-HOUR VALIDATED CYCLES
> Bridge Policy      : ONE-WAY (native L1 ANET can export out; external assets never mint native ANET)
> Web3 Surface       : ANET CONTRACT LOOKUP ENABLED
> Layer 1 Explorer   : explorer.a-network.net [LIVE]
> Build State        : CONTINUOUS DELIVERY READY
</pre>

</div>

---

### System Modules

<p align="center">
  <img src="https://img.shields.io/badge/MOBILE-Flutter-111827?style=flat-square&logo=flutter&logoColor=white" alt="Flutter" />
  <img src="https://img.shields.io/badge/BACKEND-Fastify-111827?style=flat-square&logo=fastify&logoColor=white" alt="Fastify" />
  <img src="https://img.shields.io/badge/DATABASE-PostgreSQL-111827?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/AUTH-JWT-111827?style=flat-square&logo=jsonwebtokens&logoColor=white" alt="JWT" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/WEB3-BNB_Smart_Chain-111827?style=flat-square&logo=binance&logoColor=white" alt="BNB Smart Chain" />
  <img src="https://img.shields.io/badge/REWARD_ENGINE-ANTS_First-111827?style=flat-square&logo=databricks&logoColor=white" alt="ANTS First" />
  <img src="https://img.shields.io/badge/CLIENT-Dart-111827?style=flat-square&logo=dart&logoColor=white" alt="Dart" />
  <img src="https://img.shields.io/badge/DOCS-Static_HTML-111827?style=flat-square&logo=html5&logoColor=white" alt="Static HTML" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/SECURITY-bcryptjs-111827?style=flat-square&logo=shield&logoColor=white" alt="bcryptjs" />
  <img src="https://img.shields.io/badge/ADS-google_mobile_ads-111827?style=flat-square&logo=googleads&logoColor=white" alt="google mobile ads" />
  <img src="https://img.shields.io/badge/VIDEO-video_player-111827?style=flat-square&logo=youtube&logoColor=white" alt="video player" />
  <img src="https://img.shields.io/badge/WEBVIEW-webview_flutter-111827?style=flat-square&logo=googlechrome&logoColor=white" alt="webview flutter" />
</p>

---

### Current Product Scope

<div align="center">

<pre>
> Auth Layer        : REGISTER / LOGIN / JWT / OTP / SMART-LOGIN
> Mining Engine     : 6H SESSION + HEARTBEAT + ANTI-GAMING
> Stats Surface     : GLOBAL STATS + LEADERBOARD ENDPOINTS
> Wallet Layer      : ON-CHAIN ANET BALANCE + TRANSFER INTENTS
> Bridge Surface    : ONE-WAY DISCLOSURE + EXPORT FLOW (L1 native ANET -> external market)
> Anti-Abuse        : RISK SCORING + BOT DETECTION + DEVICE BINDING
> Multi-Language    : EN / HI / UR / ZH / ES AUTO-DETECTED
> Docs Surface      : WEBSITE + PRIVACY + TERMS + WHITEPAPER + ROADMAP
</pre>

</div>

The codebase currently implements:

- User registration and login with JWT-based authentication and email OTP
- Smart login OTP: server detects risky logins and challenges with email OTP
- A 6-hour session-based off-chain mining engine with heartbeat validation
- 6-layer anti-gaming system: risk scoring, device binding, bot detection, IP clustering, heartbeat validation, session pattern analysis
- Global stats and leaderboard endpoints
- On-chain ANET balance lookup through the deployed BNB Chain token contract
- Wallet transfer intent system (server-validated sends)
- Admin dashboard: eligible user view, cheater detection (5 heuristics), ban/unban system, deep user audit
- Flutter mobile app v1.0.6 with 5-tab product surface (Mining, Web3, Web4, Whitepaper, Main)
- Multi-language support: English, Hindi, Urdu, Chinese, Spanish (auto-detected by region)
- Ant Code Colony system: single-level referral tracking, zero issuance multiplier
- Community colony chat with scoped rooms
- AdMob integration (banner/interstitial/rewarded — currently disabled by default)
- Seed phrase vault with encrypted-at-rest storage and PIN + OTP reveal flow
- In-app legal links for Privacy Policy, Terms of Service, and Account Deletion
- Public docs: website, privacy, terms, whitepaper (v2.2)
- ANTS Mainnet running (see [ROADMAP_2026.md](ROADMAP_2026.md))

The codebase does not currently implement:

- Guaranteed financial returns
- Brokerage or custodial financial services
- Automatic off-chain to on-chain reward minting for users
- A production claim bridge from off-chain app balance into on-chain wallet balance (Layer 1 migration is the path)

---

### Policy Guardrails

<div align="center">

<pre>
> Notice            : LONG-TERM ECOSYSTEM PROJECT
> Financial Claim   : NOT INVESTMENT ADVICE
> Return Guarantee  : NONE
> Store Messaging   : FACTUAL / RISK-AWARE / POLICY-SAFE
</pre>

</div>

Important notice:

- A-Network is a long-term ecosystem project.
- It is not financial advice.
- It does not promise guaranteed earnings, guaranteed returns, or token appreciation.
- Store listing text, website text, and in-app text should remain factual, risk-aware, and compliant with Google Play and App Store policies.

## Actual Tech Stack

Backend:

- Node.js
- Fastify
- PostgreSQL
- JWT
- bcryptjs
- dotenv

Frontend:

- Flutter
- Dart
- http
- shared_preferences
- google_mobile_ads
- video_player
- webview_flutter
- url_launcher

Website / Docs:

- Static HTML in `docs/`
- GitHub Pages compatible structure

## Repository Structure

```text
A Network/
├── anet-chain/               # Layer 1 Mainnet node (Rust) — live at explorer.a-network.net
├── backend/
│   ├── db.js
│   ├── database_schema.sql
│   ├── server.js
│   ├── middleware/
│   ├── routes/
│   └── services/
├── my_app/
│   ├── lib/
│   │   ├── main.dart
│   │   ├── api.dart
│   │   ├── ads_service.dart
│   │   ├── security_service.dart
│   │   └── notification_service.dart
│   ├── assets/
│   └── pubspec.yaml
├── pi-backend/               # Pi DEX bridge backend
├── index.html                # Main website
├── whitepaper.html           # Official whitepaper v2.1
├── privacy.html
├── terms.html
├── delete-account.html
├── ROADMAP_2026.md           # 5-phase ecosystem roadmap
├── COMMUNITY_ARTICLE_ANET_WBNB.md  # ANET/WBNB transparency article
└── README.md
```

## Mining Logic In Code

The current backend mining rules are defined in:

- `backend/services/miningEngine.js`
- `backend/services/halving.js`
- `backend/routes/mining.js`

### Mining Session Duration

- One mining session lasts exactly `21,600` seconds
- This equals `6` hours

### Base Rate

```text
LAUNCH_REWARD_ANET = 0.04882812 ANET/session
LAUNCH_REWARD_ANTS = 4,882,812 ants/session
LAUNCH_PHASE_SESSIONS = 500,000 total sessions
POST_LAUNCH_BASE_REWARD_ANET = 0.00262144 ANET/session
POST_LAUNCH_BASE_REWARD_ANTS = 262,144 ants/session
POST_LAUNCH_HALVING_INTERVAL = 3,800,000,000 total sessions
MAX_HALVING_STAGE = 9
MAX_SUPPLY = 21,000,000 ANET
```

### Current Rate Formula

```text
if totalSessions < 500000:
  rewardPerSession = 0.04882812 ANET
else:
  halvingStage = min(floor((totalSessions - 500000) / 3800000000), 9)
  rewardPerSession = 0.00262144 / (2 ^ halvingStage)
```

### Reward Formula

```text
rewardAnts = floor(rewardPerSession x 100,000,000)
rewardAnet = rewardAnts / 100,000,000
```

Examples:

- `launch tranche` -> `0.04882812 ANET` (`4,882,812` ants) for the first `500,000` total sessions
- `post-launch stage = 0` -> `0.00262144 ANET` (`262,144` ants)
- `stage = 1` -> `0.00131072 ANET` (`131,072` ants)
- `stage = 2` -> `0.00065536 ANET` (`65,536` ants)
- `stage = 9` -> `0.00000512 ANET` (`512` ants, capped final stage)

### Eligibility Rule

A user becomes eligible for the network halving calculation only when:

```text
successful_sessions >= 1000
```

### Halving Stage Formula

```text
totalSessions = sum(users.successful_sessions)
halvingStage = min(floor((max(totalSessions - 500000, 0)) / 3800000000), 9)
```

Examples:

- `0` to `499,999` sessions -> launch tranche reward
- `500,000` to `3,800,499,999` sessions -> post-launch stage 0
- `3,800,500,000` to `7,600,499,999` sessions -> stage 1
- `7,600,500,000` to `11,400,499,999` sessions -> stage 2
- `34,200,500,000+` sessions -> stage 9

### User Rules Enforced By The API

- User must be authenticated to start and complete mining
- User must exist in the database
- User cannot start a second session while `is_mining = true`
- User cannot complete mining before 6 full hours pass
- On successful completion:
  - user `balance` increases
  - `successful_sessions` increments by 1
  - `is_mining` becomes `false`

### Supply Protection Rules

- If `total_mined_ants >= MAX_SUPPLY_ANTS`, mining rewards stop
- If `total_mined_ants + rewardAnts > MAX_SUPPLY_ANTS`, reward is reduced to the exact remaining supply
- Claim conversion uses safe truncation to ensure total claimed ANET never exceeds max supply
- When max supply is reached, `is_mining_active` is disabled in network stats

## Security and Anti-Abuse (v1.0.6)

- Device binding with configurable max accounts per device (default `2`)
- Heartbeat-backed mining session validation before completion (min 2 heartbeats per 6h session, max 120-min gap)
- Risk scoring and account/session flagging with configurable block threshold
- IP cluster detection: accounts flagged when IP shared by 8+ accounts
- Fingerprint cluster detection: accounts flagged when fingerprint shared by 4+ accounts
- Bot pattern detection: session timing analysis over last 8 sessions
- Official client header enforcement: requests without valid app headers rejected
- Emulator/rooted device blocking
- Stale unverified account cleanup (72h)
- Claim gate for flagged or high-risk accounts
- Security audit logs for sensitive auth/mining events
- Admin cheater detection: 5 independent heuristics (inflated sessions, high risk score, fast sessions, daily limit abuse, multi-account device clusters)
- Manual ban/unban system (no automated permanent bans)
- Global API rate limiting baseline: `100 requests / 15 minutes / IP`
- 64-bit counter safety on ANTS balance for public-scale adoption
- Row-level database locking on all claim operations (no double-credit possible)

## Web2, Web3, and Web4 Positioning

### Web2 Layer

The current application includes an off-chain session engine, user accounts, ranking, app-native progression, and backend-controlled reward accounting.

### Web3 Layer

The current application and website can read ANET utility-token information from the deployed token contract on BNB Smart Chain. In the current public model, this Web3 token is a fixed-supply ecosystem utility asset with a total supply of `21,000,000 ANET` and a documented stewardship split of `50% owner / 50% founder` for ecosystem distribution, liquidity, partnerships, and long-term Layer 1 access planning.

Contract address:

```text
0x791055A7d52AA392eaE8De04250497f33807E46A
```

### Web4 Layer

Web4 is currently presented as the coordination layer between off-chain utility and on-chain ownership. In the current project narrative, Web4/Web5 uses a separate Layer 1 ANET/ANTS mining economy: miners accumulate ANTS through validated 6-hour sessions, the first `1,000` completed sessions act as a non-spendable genesis threshold, and only after that threshold can ANTS be converted into spendable Layer 1 ANET through the governed migration flow. This Layer 1 mining economy is intended to be `100% mining-based` with `0% owner allocation` and `0% founder allocation`.

## Token Model And Distribution

### Web3 Utility Token On BNB Chain

- Asset role: ecosystem utility token and external market visibility layer
- Network: BNB Smart Chain
- Supply: `21,000,000 ANET`
- Stewardship: `50% owner / 50% founder`
- Intended uses: ecosystem growth, market discovery, liquidity planning, partner distribution, and future buy-in rails for the Layer 1 economy
- Current public contract:

```text
0x791055A7d52AA392eaE8De04250497f33807E46A
```

### Web4/Web5 Layer 1 Coin Economy

- Separate from the BNB Chain utility token
- Accounting model: users mine `ANTS` first and convert into Layer 1 `ANET` only after eligibility
- Genesis threshold: the first `1,000` completed sessions are a non-spendable participation threshold
- Conversion rule: after `1,000` completed sessions, miners become eligible to convert accumulated ANTS into spendable Layer 1 ANET through the project migration and settlement flow
- Distribution: `100% mining/community distribution`
- Founder allocation: `0%`
- Owner allocation: `0%`
- Economic principle: everyone participates as miners; the Layer 1 coin economy is not presented as a pre-allocated insider reserve

### Roadmap Framing

- The current codebase already implements the ANTS-first session ledger and the `1,000`-session eligibility threshold
- The BNB Chain utility token is already visible through the current wallet and website surfaces
- **ANTS Mainnet is now running** — block explorer live at https://explorer.a-network.net
- The Layer 1 public release target is approximately `8 months`, subject to technical readiness, security review, and market conditions
- Web2 ledger migration to Layer 1 uses **last-miner-first sync order** — most recently active miners are synchronized first to minimize downtime
- Any early Layer 1 starting price discussion should be treated as a non-guaranteed planning reference only; market price discovery will depend on open participation and liquidity at launch
- Full phase breakdown available in [ROADMAP_2026.md](ROADMAP_2026.md)

## Backend Setup

### Install Dependencies

```bash
cd backend
npm install
```

### Database Setup

Create a PostgreSQL database and load the schema:

```bash
psql -U postgres -d anetwork -f database_schema.sql
```

### Backend Environment

Example `.env`:

```env
PORT=3000

DB_USER=postgres
DB_HOST=localhost
DB_NAME=anetwork
DB_PASS=your_password
DB_PORT=5432

JWT_SECRET=ANET_SECRET_KEY

ANET_CONTRACT=0x791055A7d52AA392eaE8De04250497f33807E46A
ANET_DECIMALS=18
BSCSCAN_API_URL=https://api.bscscan.com/api
BSCSCAN_API_KEY=
```

### Start Backend

```bash
npm start
```

`npm start` now runs `backend/server.js` (Fastify API with ANTS-first mining, wallet, and forgot-password OTP routes).

## Flutter App Setup

```bash
cd my_app
flutter pub get
flutter run
```

Current app capabilities include:

- login and register
- mining slide
- main dashboard slide
- web3 slide with in-app browser and wallet actions
- web4 concept slide
- whitepaper, privacy, and terms slide

Current app build command:

```bash
flutter build apk --release --no-obfuscate
```

## API Surface

Authentication:

- `POST /auth/register`
- `POST /auth/verify-otp`
- `POST /auth/resend-otp`
- `POST /auth/login`
- `POST /auth/verify-login-otp`
- `POST /auth/resend-login-otp`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/account-restore/request`
- `POST /auth/account-restore/confirm`
- `POST /auth/change-email`
- `POST /auth/change-password`
- `POST /auth/delete-account`

Wallet:

- `GET /auth/wallet`
- `POST /auth/wallet/create`
- `POST /auth/wallet/set-pin`
- `POST /auth/wallet/change-pin`
- `POST /auth/wallet/verify-pin`
- `POST /auth/wallet/request-seed-otp`
- `POST /auth/wallet/reveal-seed`
- `POST /auth/wallet/request-pin-reset`
- `POST /auth/wallet/confirm-pin-reset`
- `POST /auth/wallet/update-migration-address`
- `POST /auth/wallet/transfer-intent`
- `GET /auth/wallet/history`

Mining:

- `POST /mining/start`
- `GET /mining/status`
- `POST /mining/complete`
- `POST /mining/heartbeat`
- `POST /mining/session/claim`
- `POST /mining/claim`
- `GET /mining/sessions`

Stats:

- `GET /stats/network`
- `GET /stats/countries`
- `GET /stats/onchain/:address`
- `GET /stats/evm-token`

Leaderboard:

- `GET /leaderboard/top`
- `GET /leaderboard/rank/:userId`

Referral / Colony:

- `GET /referral/stats`
- `GET /referral/community-chat`
- `POST /referral/community-chat`
- `POST /referral/room-name`
- `POST /referral/claim-ant-code`

User Dashboard:

- `GET /user/dashboard`
- `GET /user/profile`

Admin (JWT + admin ID required):

- `GET /admin/dashboard`
- `GET /admin/cheaters`
- `GET /admin/user/:id`
- `POST /admin/ban`
- `POST /admin/unban`

Ads:

- `POST /ads/impression`

NFT Studio / Marketplace (miner-gated):

- `GET /api/nft/config`
- `POST /api/nft/auth/miner-login`
- `POST /api/nft/auth/logout`
- `GET /api/nft/profile/:uid`
- `POST /api/nft/profile/upsert`
- `GET /api/nft/assets/:uid`
- `POST /api/nft/assets/create`
- `PATCH /api/nft/assets/:assetId`
- `GET /api/nft/colony/feed`
- `GET /api/nft/market/listings`
- `POST /api/nft/market/listings/create`
- `POST /api/nft/market/listings/:listingId/bid`
- `POST /api/nft/market/listings/:listingId/buy`
- `POST /api/nft/market/listings/:listingId/close`
- `GET /api/nft/market/listings/:listingId/bids`

NFT policy knowledge (production):

- Miner-only access: NFT and marketplace routes require a valid miner session token from `POST /api/nft/auth/miner-login`
- Session ownership enforced: session uid must match request uid for profile, asset, and market actions
- NFT activation rule: first successful cashout or swap activates NFT profile creation (no pre-cashout NFT requirement)
- Domain auctions: only `.ant` assets are eligible for `domain-auction`, with minimum bid floor of `10,000 ANTS`
- No-burn model: profile and marketplace activity use closed-loop utility accounting

## Website And Legal Pages

Public pages live in the repository root (served via GitHub Pages / CNAME):

- `index.html` — Main website
- `whitepaper.html` — Official Whitepaper v2.2 (May 2026)
- `privacy.html` — Privacy Policy
- `terms.html` — Terms of Service
- `delete-account.html` — Account Deletion instructions
- `app-ads.txt` — AdMob publisher verification

Public URLs:

- `https://a-network.net/`
- `https://a-network.net/whitepaper.html`
- `https://a-network.net/privacy.html`
- `https://a-network.net/terms.html`
- `https://a-network.net/delete-account.html`

## Policy-Safe Messaging Guidelines

When preparing store listings, screenshots, ads, and marketing copy, keep messaging aligned with the real implementation.

Safe principles:

- Describe the app as a long-term ecosystem or session-based reward product
- Avoid promising profit, guaranteed income, or guaranteed token value
- Clearly separate off-chain app balance, the BNB Chain utility token, and the future Layer 1 mining coin economy
- Keep privacy and terms URLs public and accessible
- Label roadmap allocations and launch targets as roadmap items, not as already-enforced code behavior

Avoid claiming:

- guaranteed returns
- guaranteed price growth
- guaranteed launch price
- financial services that are not implemented
- unsupported token allocations that are not documented in the official project materials
- features that imply regulatory approval when none is shown in code or docs

## Legal Links

- Privacy Policy: `https://a-network.net/privacy.html`
- Terms of Service: `https://a-network.net/terms.html`

## Contact

- Website: https://a-network.net
- Explorer: https://explorer.a-network.net
- Whitepaper: https://a-network.net/whitepaper.html
- Email: `info@a-network.net`
- GitHub: https://github.com/A-Network-2026
- X: https://x.com/ANetworkLLC
- DexScreener: https://dexscreener.com/bsc/0x791055a7d52aa392eae8de04250497f33807e46a

## Documentation

| Document | Description |
|----------|-------------|
| [ROADMAP_2026.md](ROADMAP_2026.md) | Full 5-phase ecosystem roadmap (Web2 → Web3 → Web4 → Smart Contracts → ANET Core) |
| [COMMUNITY_ARTICLE_ANET_WBNB.md](COMMUNITY_ARTICLE_ANET_WBNB.md) | Transparency article: ANET/WBNB vs Layer 1 coin, dual economy explanation |
| [whitepaper.html](https://a-network.net/whitepaper.html) | Official Whitepaper v2.1 — full technical specification |
| [explorer.a-network.net](https://explorer.a-network.net) | Layer 1 block explorer (ANTS Mainnet live) |

## Summary

A-Network currently ships as a real application stack with:

- Code-backed off-chain mining logic (6h sessions, halving, hard cap)
- 6-layer anti-gaming system (risk scoring, heartbeat, bot detection, device binding)
- Code-backed network stats and leaderboard behavior
- Code-backed on-chain ANET balance lookup and transfer intents
- Wallet system with encrypted seed vault (PIN + OTP reveal)
- Multi-language support (English, Hindi, Urdu, Chinese, Spanish)
- Ant Code Colony referral system (single-level, zero issuance multiplier)
- Admin dashboard with cheater detection and manual ban system
- ANTS Mainnet running (explorer: https://explorer.a-network.net)
- Public legal pages and policy-safe product positioning for app store submission
- App v1.0.6 ready for Google Play and App Store submission

Any future README updates should stay aligned with the actual source code, legal pages, and store-policy-safe language.
2. Build optimized release:
```bash
flutter build apk --release    # Android
flutter build ipa --release    # iOS
flutter build web --release    # Web
```



## 📝 Environment Variables

```env
PORT                - Server port (default: 3000)
DB_USER            - PostgreSQL username
DB_HOST            - Database host
DB_NAME            - Database name
DB_PASS            - Database password
DB_PORT            - Database port (default: 5432)
JWT_SECRET         - Secret key for JWT signing
```



## 🐛 Troubleshooting

### "Database connection error"
- Verify PostgreSQL is running
- Check .env credentials
- Ensure database exists: `createdb anetwork`

### "Mining failed: User not found"
- Register new account first
- Verify JWT token is valid

### "Already mining"
- Wait for current session to complete
- Or reset is_mining flag in database

### "Connection refused to API"
- Check backend server is running
- Verify correct API URL in `api.dart`
- For Android emulator, use machine IP instead of localhost

### Flutter video not loading
- Ensure `assets/video.mp4` exists
- Add to `pubspec.yaml` correctly
- Run `flutter pub get`



## 📈 Future Features

- [ ] Real blockchain integration
- [ ] Multiple mining pools
- [ ] Advanced analytics dashboard
- [ ] Social features (referrals, teams)
- [ ] Hardware acceleration support
- [ ] Mobile notification system
- [ ] WebSocket live updates
- [ ] Payment gateway integration



## 📄 License

ISC License

## 👨‍💻 Support

For issues or questions:
1. Check logs in backend console
2. Verify database schema
3. Test API endpoints with curl
4. Check Flutter console debug output

---

**⛏️ Happy Mining! 🚀**
