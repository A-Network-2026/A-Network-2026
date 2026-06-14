# A-Network Development Roadmap 2026

**Status:** Whitepaper v3.0 (May 2026) | App v1.0.21+71 | Live Backend  
**Updated:** June 11, 2026 (Architecture Decision: BSC ANET = L2 native gas asset; L1 stays separate)

---

## 🎯 Vision: 4-Phase Ecosystem Architecture

A-Network is structured as a **long-horizon infrastructure project**, progressing from participation entry through utility, settlement, governance, and self-sovereign identity.

---

## 📋 Phase Breakdown

### ✅ **Phase 1: Web2 — Mobile Time-Based Mining** 
**Status:** LIVE (v1.0.20+70 | Current)**

**What it is:**
- Smartphone-accessible 6-hour session-based mining
- Server-validated proof-of-time ledger
- Closed-loop participation economy denominated in ANTS (100M Ants = 1 ANET)
- Entry point: zero capital required, time only

**Key Features:**
- Session Model: 6-hour cycles, max 4 per day, 1,000-session genesis threshold
- Halving Schedule: 500K launch tranche @ 0.04882812 ANET/session, then post-launch stages halving every 3.8B sessions
- Hard Cap: 21,000,000 ANET absolute supply maximum
- Device Binding: Sybil resistance via device ID + email OTP verification
- Anti-Gaming: Risk scoring, heartbeat validation, bot detection, 6-layer fraud prevention
- Multi-Language: English, Hindi, Urdu, Chinese, Spanish auto-selected per region
- Notifications: Local push + server 60-second fallback worker
- AdMob: Banner/interstitial/rewarded integration (currently disabled, can be enabled post-approval)
- **EVM Wallet Import:** MetaMask and any EVM-compatible wallet can be imported via 12/24-word seed phrase (BIP39/BIP32 m/44'/60'/0'/0/0 derivation) — users get full ANET address + 0x address, no PIN required
- Wallet Seed Encryption: Seed phrases stored exclusively in Android Keystore / iOS Secure Enclave (flutter_secure_storage)

**Current Deployment:**
- Flutter mobile app v1.0.20+70 on Google Play (AAB signed, deployed May 17, 2026)
- Fastify Node.js backend: https://rmp-site.onrender.com (LIVE)
- PostgreSQL ledger with 64-bit counter safety
- Web2 is the source of truth; ledger persists to future phases

**Launch Tranche Status:**
- Preserved 500,000 total sessions @ 0.04882812 ANET/session
- Post-launch Stage 0 begins after network reaches 500,000 cumulative sessions
- Currently in **launch phase** (exact session count TBD based on live network activity)

---

### 🔗 **Phase 2: Web3 — BNB Chain Integration** 
**Status:** INTEGRATED (v1.0.6 | Utility Token Live)**

**What it is:**
- Fixed-supply BEP-20 ANET utility token on BNB Smart Chain
- External market visibility and liquidity discovery
- **Designated future L2 native gas asset** (see *Architecture Decision — June 11, 2026* below). The BSC ANET token is the asset earmarked to pay gas on the planned BSC-anchored L2; it is **not** a separate, unrelated economy from that L2.

**Key Features:**
- Supply: 21,000,000 ANET fixed (no minting)
- Allocation: 50% founder / 50% owner stewardship pool
- Contract: `0x791055A7d52AA392eaE8De04250497f33807E46A` on BSC (Chain ID: 56)
- Market: Listed on DEX (PancakeSwap), visible on DexScreener
- Purpose: Ecosystem utility, access planning, external liquidity
- **In-App EVM Bridge (v3.0):** Users can swap BNB/USDT/USDC → ANET directly inside the wallet — no MetaMask or external app required
  - Bridge contract: `0x1A1AFE5BF1ffDB64aC10958cCe2D06B22Fb47Fb8` (AnetSwap, BSC mainnet)
  - 1% bridge fee, whitelisted: BNB, USDT, USDC, WBNB, BUSD
  - Every bridge swap recorded on ANET Layer 1 explorer
- **Important:** BSC ANET (BEP-20) and the in-development custom **L1** chain are *different layers*, not interchangeable balances:
  - The custom L1 (Rust, ANTS-denominated, mined) keeps its own **mining-only** supply model.
  - The BSC ANET token is the **designated L2 native gas asset** and is governed by its fixed 21M cap on BSC.
  - Holding BSC ANET ≠ L1 mining rewards; trading BSC ANET ≠ L1 mining rights.
  - The two ledgers remain **operationally separate today.** Any future unification is a deliberate, governed *migration decision* (see Phase 3 and the Architecture Decision below) — not an automatic bridge.

> ### 🧭 Architecture Decision — June 11, 2026
>
> A code audit clarified that the current Rust chain is a **custom L1**, not an L2 rollup, and that the BSC↔L1 credit relayer must **not** be treated as a canonical L2 bridge. The adopted, workable direction is:
>
> 1. **BSC ANET becomes the L2 native gas asset.** The existing BEP-20 token (`0x791055A7d52AA392eaE8De04250497f33807E46A`, fixed 21M cap) is the gas/settlement asset for the planned BSC-anchored L2.
> 2. **ANTS remains the gas/accounting unit.** On-chain accounting and fees stay denominated in ANTS (100M ANTS = 1 ANET).
> 3. **1,000 completed sessions unlock L2 utilities.** The participation gate (Time-PoW eligibility) is the on-ramp to L2 features.
> 4. **The unfinished ANET L1 remains separate** until a future, explicit migration decision. No code change in this release merges the two ledgers.
>
> **Guardrails enforced in code (this release):**
> - The BSC→L1 USDC relayer (`bsc-relayer`) credits ANET by quoting the L1 AMM and minting from a synthetic treasury. This is a **legacy L1 convenience path only**. It is flagged `IS_L2_CANONICAL_BRIDGE = false`, and the relayer **refuses to boot** if an operator tries to designate it as the L2 canonical bridge (`L2_CANONICAL_BRIDGE=true`). It must never back L2 supply.
> - `AnetBridgeVault.sol` is the **L1→BSC cash-out vault**, not the L2 deposit/withdraw portal.
> - The L1 mining-only supply guarantee is unaffected; synthetic-treasury credits exist solely to mirror real off-chain USDC deposits on the legacy L1 and are not a supply source for any L2.

**Current Status:**
- ✅ Contract deployed and verified
- ✅ AnetSwap bridge contract live: `0x1A1AFE5BF1ffDB64aC10958cCe2D06B22Fb47Fb8`
- ✅ In-app EVM bridge live (v1.0.21+71) — DEX tab → EVM Bridge
- ✅ Wallet integration in app (Web3 tab shows balances, transactions)
- ✅ Public visibility at https://a-network.net (contract link, market data)

---

### 🚀 **Phase 3: Web4 — Layer 1 Settlement Chain** 
**Status:** IN DEVELOPMENT (ANTS Mainnet Live | Public Release ~8 months)**

**What it is:**
- Private Layer 1 blockchain running now for development
- Settlement layer for Layer 1 ANET (separate from Web3 utility token)
- Closed-loop finality and transaction processing
- Foundation for smart contract and governance layers

**Key Features:**
- Mining Ledger Migration: Web2 ANTS history → Web4 balances (last-miner-first sync order)
  - **Who gets priority:** Active miners at max-supply are synchronized first
  - **Preservation:** All session history maintained; no valid ledger record lost
- ANTS as Native Unit: All on-chain accounting in ANTS (smallest unit)
- Wallet Continuity: User retains same ANET wallet identity across migration
- Custom Wallet Support: Users can set migration wallet for Layer 1 (optional)
- Block Explorer: https://explorer.a-network.net (live for network monitoring)
- **Native DEX (AMM):** ANET-USDC pool live on Layer 1 (10 ANET / 10,000 USDC seed liquidity, 0.30% fee, AMM pricing)
- **In-App DEX:** Swap interface built into mobile app — no browser or external wallet needed
- **EVM Cross-Compatibility:** Imported EVM wallets (MetaMask etc.) can swap directly on ANET Layer 1 DEX
- **Security Hardening (May 2026):** Constant-time admin key comparison (subtle crate), CORS locked to a-network.net, timing-safe auth in all services

**Timeline:**
- ANTS Mainnet: **LIVE NOW** (stable, hardened)
- Public Release: **~8 months** (subject to engineering readiness)
- Illustrative Price Zone: $0.000001 early Layer 1 discovery (not a guarantee, market-determined)

**Ledger Continuity Principle:**
- Web2 sessions recorded → ANTS accumulated → claim eligibility at 1,000 sessions
- At Layer 1 migration, ledger freezes Web2, publishes Web4 genesis state
- User's on-chain balance = verified ANTS balance from Web2
- Layer 1 settlement is permanent and immutable

---

### 🔧 **Phase 4: Smart Contracts — EVM Layer** 
**Status:** ARCHITECTED (Planned Post-Layer 1 Release)**

**What it is:**
- Smart contract execution layer directly on Layer 1
- ANTS-denominated gas (execution fees flow to miners/validators)
- EVM compatibility evaluation (primary approach) or custom VM (fallback)

**Key Features:**
- **ANTS as Gas:**
  - Every contract call consumes defined ANTS as execution fee
  - Fees flow to fee distribution model (supports validator/miner sustainability)
  - Cost model independent of external markets
  
- **Developer Tooling:**
  - SDK for contract deployment
  - RPC endpoints for Layer 1 access
  - Block explorer integration for contract state/traces/gas consumption
  - Full Solidity tooling compatibility (if EVM adopted)

- **Security-First Rollout:**
  - Staged deployment with independent security audits
  - No user funds/contracts activated until audit criteria met
  - Production chain protected by rigorous review

**Timeline:** Post-Phase 3 public launch (estimated Q4 2026 or later)

---

### 🌐 **Phase 5: ANET Core (Web5) — Identity & Governance Layer** 
**Status:** PROTOCOL DIRECTION (Planned for 2027+)**

**What it is:**
- Decentralized identity (DID) layer built on participation history
- Community governance tied to session count (not coin balance, preventing whale dominance)
- dApp ecosystem platform
- AI integration for personal AI agents and inference markets

**Key Features:**

**1. Self-Sovereign Identity (DID)**
- Eligibility: ≥ 1,000 completed mining sessions
- Not controlled by any company or platform
- Portable across all ANET Core applications
- Backed by on-chain session history (proof-of-participation)
- Used for governance voting, dApp access, reputation scoring

**2. Community Governance**
- **Proposal Threshold:** 100+ successful sessions to submit proposals
- **Voting Weight:** Proportional to verified session count (more mining = more governance influence)
  - ⚠️ NOT based on coin balance (prevents whale dominance)
- **Timelock:** Minimum 7-day timelock on all approved changes
- Purpose: Protocol upgrades, parameter changes, ecosystem fund allocation

**3. dApp Ecosystem**
- Applications use ANET as native currency (fees in Ants)
- Verify user identity via DID (no centralized data storage)
- Access ANET reputation graph for reputation-gated features
- Integrate mining history ledger for proof-of-participation requirements

**4. AI Integration Layer**
- **Personal AI Agents:** User-owned, not corporate-owned. Data stays with user (no centralized export)
- **Federated Learning:** Models improve from contributor data without centralizing training
- **On-Chain AI Inference Market:** Participants earn Ants for offering compute services
- **ANET Support Bot:** Initial AI assistant for ecosystem guidance, accessible to all miners

**Timeline:** Post-Phase 4 (estimated 2027+)

---

## 📊 Current App Status (v1.0.6+)

| Component | Status | Notes |
|-----------|--------|-------|
| **Mobile App** | ✅ Live v1.0.68+131 | Flutter — mining, EVM wallet import, in-app DEX + EVM bridge, AI support, NFT identity, server-side legacy→secp wallet migration |
| **Backend API** | ✅ Live (https://api.a-network.net) | Fastify + PostgreSQL, timing-safe auth, all anti-gaming logic, EVM key derivation + action signer |
| **Layer 1 Chain** | ✅ **Mainnet (LIVE)** | https://explorer.a-network.net — DEX live, hybrid TPoW + PoS consensus, 2-second settlement windows |
| **Native DEX** | ✅ Live (Layer 1) | ANET-USDC pool seeded, AMM pricing, 0.30% fee, in-app swap UI |
| **EVM Bridge** | ✅ Live (BSC Mainnet) | AnetSwap `0x1A1AFE5BF1ffDB64aC10958cCe2D06B22Fb47Fb8` — in-app BNB/USDT/USDC → ANET |
| **Bridge Vault** | ✅ Live (BSC Mainnet) | AnetBridgeVault `0x31438362a7667ce5559500023D025c7c14168B49` — 2-of-3 EIP-712 multisig, ~10.5M wANET custodied |
| **EVM Wallet Import** | ✅ Live (v1.0.20+70) | MetaMask / any EVM wallet via BIP39 mnemonic, works on ANET DEX |
| **Web3 Token** | ✅ Live (BNB Chain) | 21M supply, owner renounced, visible on DexScreener |
| **Whitepaper** | ✅ Published (v3.5) | https://a-network.net/whitepaper.html |
| **Block Explorer** | ✅ Live | https://explorer.a-network.net |
| **AdMob** | ⏳ Ready (test IDs available) | Currently disabled by default (ADS_ENABLED=false) |
| **Docs** | ✅ Live (privacy/terms/delete) | https://a-network.net |

---

## 🎯 Near-Term Priorities (May-Aug 2026)

1. **Mobile App Deployment**
   - ✅ Build production app bundles (v1.0.21+71)
   - ✅ EVM/MetaMask wallet import live
   - ✅ In-app DEX swap interface live (ANET L1 AMM)
   - ✅ In-app EVM Bridge live (AnetSwap BSC — BNB/USDT/USDC → ANET, no MetaMask)
   - ✅ Submit to Google Play Store
   - 📝 Monitor store metrics and user feedback

2. **ANTS Mainnet Hardening** ✅ Complete
   - ✅ Native DEX seeded and live (ANET-USDC pool)
   - ✅ Constant-time admin key comparison (subtle crate)
   - ✅ DEPLOY.md + FREEZE.md in all repos
   - ✅ CORS locked to a-network.net
   - ✅ All test flags disabled in production
   - Migration ledger validation (Web2 → Web4) — in progress
   - Validator/node setup documentation — in progress
   - Performance benchmarking — in progress

3. **AdMob Monetization (Optional)**
   - Request AdMob approval for production ad units
   - Test device setup and validation
   - Ad placement optimization
   - Revenue tracking and analytics

4. **Ecosystem Documentation**
   - Layer 1 migration guides for users
   - Validator setup documentation
   - Developer SDK docs (pre-Phase 4)
   - Community governance bylaws (pre-Phase 5)

---

## ⏱️ 12-Month Outlook (May 2026 – May 2027)

| Timeline | Milestone | Phase |
|----------|-----------|-------|
| **May 2026** | App live on stores | Phase 1 ✅ |
| **Jun–Jul 2026** | Monitor Web2 adoption, session volume growth | Phase 1 ✅ |
| **Aug 2026** | Post-launch Stage 0 transition (after 500K sessions) | Phase 1 → Phase 3 prep |
| **May 2026** | ✅ **Layer 1 Mainnet went LIVE** — no testnet stage (Bitcoin model) | Phase 3 ✅ |
| **Jun–Aug 2026** | Independent validator onboarding (hybrid TPoW + PoS) | Phase 3 🔄 In Progress |
| **Sep–Oct 2026** | Open public validator set, publish consensus rules | Phase 3 🔄 In Progress |
| **Nov–Dec 2026** | Migrate Web2 ledger to Layer 1, enable full settlement | Phase 3 ✅ → Phase 4 prep |
| **Q4 2026 / Q1 2027** | Smart contract layer development & audit | Phase 4 🔄 |
| **Q2 2027** | Smart contract public launch (post-audit) | Phase 4 ✅ |
| **Q2–Q4 2027** | ANET Core / Web5 design & implementation | Phase 5 🔄 |

---

## 💰 Supply & Economics

### Mining Distribution
- **Launch Tranche (Phase 1):** 500K sessions @ 0.04882812 ANET/session = ~24.4M ANET*
  - *Note: Expected to exhaust before network reaches 500K session cap
- **Post-Launch Stage 0:** Begins after 500K cumulative sessions @ 0.00262144 ANET/session
  - Halves every 3.8B additional sessions
- **Total Network Issuance Time:** ~16.94 years (10M active users, 4 sessions/day each)
- **Hard Cap:** 21,000,000 ANET absolute (enforced at claim boundary)
- **Issuance-Ended State:** When supply exhausted, all session starts rejected

### Unit Precision
- **1 ANET = 100,000,000 Ants** (like Bitcoin's Satoshi model)
- Layer 1 fees denominated in Ants (sub-cent transactions even at high valuations)
- On-chain display: Full 8-decimal precision

### Dual Economy
1. **Layer 1 (Closed-Loop):**
   - Denomination: ANTS
   - Origin: Mining only (100% issuance from sessions)
   - Value: Tied to network utility, participation, fee markets
   - Founder allocation: 0%, Owner allocation: 0%

2. **Web3 (Open-Market):**
   - Token: BEP-20 ANET (21M fixed)
   - Origin: Founder/owner stewardship (50/50 pool)
   - Value: Market-determined (DEX liquidity, trader activity)
   - Relation to Layer 1: Independent (not mining rewards)

---

## 🔒 Security & Anti-Fraud

### Core Controls
- 6-layer fraud detection (risk scoring, heartbeat validation, IP/device clustering, bot pattern detection, session spoofing checks, late-claim prevention)
- Email OTP for registration + login risk detection
- Device binding + device account cap (default: 2 per device)
- 64-bit counter safety for public-scale adoption
- Row-level database locking on claim operations (zero double-credit risk)
- Sybil resistance: unique device ID + email verification required

### Admin Enforcement
- Manual ban/unban system (no automated permanent bans)
- Eligible users dashboard (session count, ban status, flagged accounts)
- Cheater detection engine (5 heuristics: inflated sessions, high risk score, fast sessions, daily limit abuse, multi-account clusters)
- Deep user investigation view (profile, session history, audit trail)

---

## 🌍 Multi-Language Support (Phase 1)

Launch locales: **English, Hindi, Urdu, Chinese, Spanish**

- English: Default & global fallback
- Hindi (हिन्दी): Auto-selected for India region devices
- Urdu (اردو): Auto-selected for Pakistan region devices
- Chinese (中文): Auto-selected for China region devices
- Español: Auto-selected for Spain & Latin America (ES, MX, AR, CO, CL, PE)
- Auto (Region): Detects device locale, maps to closest language, falls back to English

**Note:** Language selection is cosmetic; all economic logic enforced server-side

---

## 📖 Reference

- **Whitepaper:** https://a-network.net/whitepaper.html (v2.1, April 29, 2026)
- **Explorer:** https://explorer.a-network.net
- **Web3 Token:** https://dexscreener.com/bsc/0xb90071e377a31a6ea2cfdebe19a4d5226c420b6b
- **Community:** Telegram sticker packs, referral system (Ant Codes, zero issuance multiplier)
- **Legal:** Privacy Policy, Terms of Service, Account Deletion at https://a-network.net

---

## ⚖️ Governance & Community

### Ant Code Colony System (Phase 1-2)
- **Single-level referral structure** (NOT multi-level pyramid)
- Links entry, community coordination, colony tracking
- **Zero issuance multiplier:** No coin rewards, session credits, or recurring distributions for referring
- Tracks direct colony members & their session progress
- Colony Points (CP) are participation metrics, not monetary claims
- Purpose: Record who activated whom; ledger depends on each participant's own verified sessions

### Governance Readiness (Phase 5 / ANET Core)
- Governance participation tied to session count, not coin holdings
- Prevents whale dominance and capital-weighted voting
- Foundation for decentralized protocol decisions

---

## ⚡ Consensus Model — Hybrid TPoW + PoS

A-Network rejects the testnet → mainnet two-stage model. Following the Bitcoin precedent, **there is one chain and it is live**. The L1 you can query at https://explorer.a-network.net is the production Mainnet.

The consensus design is a **hybrid of Time-Based Proof-of-Work (TPoW) and Proof-of-Stake (PoS)**:

- **TPoW (entry)** — work is committed time, not hashpower. Eligibility is earned through verified 6-hour mining sessions on commodity smartphones. ASIC-resistant and capital-resistant by construction.
- **PoS (finality)** — once a participant crosses the 1,000-session genesis threshold, accumulated ANTS → ANET stake can be bonded to operate a validator and sign settlement blocks. Slashing applies to equivocation and downtime.
- **Hybrid pairing** — every block must reference both a TPoW participation root (who showed up) and a PoS signature set (who staked). Neither side can fork alone.
- **No founder allocation, no premine** on Layer 1. All ANET on the L1 originates from mined ANTS.

This is the path to *full* decentralization: capital cannot buy in without time, and time cannot ship blocks without stake.

---

## 👥 Accountable Operators (Pre-Decentralized Validator Set)

Until the open validator set is live, infrastructure is run by **publicly named** operators. This is deliberate: the Bitcoin principle is "don't trust, verify" — and the first step in *verify* is knowing who to hold accountable. There are no anonymous core multisig holders.

| Role | Operator | Public Handle | Scope |
|------|----------|---------------|-------|
| Co-founder / L1 protocol | Joel Dupalco (Coach Joel) | [@Joel_Dupalco](https://x.com/Joel_Dupalco) | Layer 1 chain, backend, bridge signer #1, 50% BEP-20 steward |
| Co-founder / treasury + mobile release | Khurram Zahid (Digital Gold) | [@Digitalgold1979](https://x.com/Digitalgold1979) | Bridge signer #2, 50% BEP-20 steward, iOS + Android release signing (Apple Team ID `L792KSQ9VC`), App Store / Play Store delivery |

As validators come online (Phase 3, in progress) the operator set rotates from named individuals to a permissionless validator registry, and the multisig threshold expands beyond 2-of-3.

---

## 📅 Version History

| Version | Date | Status | Notes |
|---------|------|--------|-------|
| v1.0.6 | Current | LIVE | Launch tranche preserved, post-launch halving schedule, 64-bit counter hardening, multi-language support |
| v1.0.68+131 | May 28, 2026 | LIVE | Server-side legacy→secp wallet migration, hybrid TPoW+PoS consensus model documented, Mainnet terminology unified across docs |
| v3.5 (WP) | May 28, 2026 | Published | Hybrid TPoW + PoS, AnetBridgeVault 2-of-3 EIP-712, founder treasury custody migrated |
| v2.1 (WP) | Apr 29, 2026 | Published | Dual economy, Phase 4 smart contract vision, ANET Core direction documented |
| v2.0 (WP) | 2025 | Archived | Earlier dual-economy specification |

---

**Last Updated:** May 28, 2026  
**Next Review:** August 2026 (post-app-launch metrics)
