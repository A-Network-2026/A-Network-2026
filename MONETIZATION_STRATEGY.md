# A-Network Monetization Strategy

**Last updated:** 2026-05-28
**Owner:** A-Network Maintainer
**Status:** Active roadmap — zero current revenue, multiple low-risk paths
identified.

---

## TL;DR

The mobile wallet (`com.anetwork.app`, 45K installs, 15.6K DAU) **cannot run
in-app ads** because the AdMob account was previously banned and the app is
flagged. Any ad SDK on this listing risks Play suspension and destruction of the
install base. Revenue must come from sources that don't trigger Play policy
review on a crypto wallet.

The five viable paths, in priority order:

1. **AnetSwap listing fees** (immediate, zero policy risk, scales with chain TVL)
2. **Ecosystem grants** (BNB Chain Builder, Pi Hackathon, others)
3. **Website sponsorships + AdSense on a-network.net** (web ads were never banned)
4. **Premium in-app features via Play Billing** (Pro tier — analytics, custom RPC, theming)
5. **Future companion product with own ad inventory** (Axon — long-term, build after L1 mainnet)

Realistic target: **$2,000–$5,000/month within 6 months** without ads on the
wallet.

---

## Why no ads on the wallet

| Risk | Severity |
|---|---|
| AdMob account already banned | High — listing is flagged |
| Crypto wallet + ads = Google "deceptive monetization" trigger | High |
| Play suspension would kill 53K install base + 15.6K DAU | Catastrophic |
| Best-case Unity Ads revenue at current geo mix (62% India) | ~$750/mo |
| Risk-adjusted expected value of adding any ad SDK | **Negative** |

The Unity Ads account configured on 2026-05-28 is left dormant. Game ID
`800001547`, placements, `app-ads.txt`, and payout profile remain in place as
preemptive hygiene — they cost nothing and don't activate unless an SDK is
integrated. **No SDK integration is planned for this app.**

---

## Path 1 — AnetSwap listing fees (PRIORITY)

**What:** Charge a small fee in wANET (or stablecoin equivalent) when a new
token requests a listing or curated placement on AnetSwap.

**Why it's safe:**
- Happens entirely on-chain — Google has no policy jurisdiction
- Industry standard (PancakeSwap, Uniswap front-ends, every major DEX does this)
- Aligned with user interests (filters spam tokens)

**Tiers:**
| Tier | Fee | Benefit |
|---|---|---|
| Basic listing | 50 wANET | Token appears in search, no curation badge |
| Curated listing | 500 wANET | "Verified" badge, default search visibility |
| Featured placement | 2,000 wANET / month | Top of swap suggestion list, banner on home |

**Revenue model:**
- 5 curated listings/month × 500 wANET ≈ 2,500 wANET/mo
- 2 featured placements × 2,000 wANET ≈ 4,000 wANET/mo
- Conservative target: **~6,500 wANET/mo** (≈ $650/mo at current price; scales
  with wANET appreciation and chain growth)

**Implementation effort:** Low. Already have the wANET token contract and a
swap UI. Need:
- [ ] Listing-application form on a-network.net (HTML form → email)
- [ ] On-chain registry contract (`AnetTokenRegistry.sol`) — optional, can start
      with off-chain curated list in `data/tokens.json`
- [ ] Admin UI for marking verified/featured tokens

**Time to first revenue:** 2–4 weeks.

---

## Path 2 — Ecosystem grants

**What:** Apply for builder grants from chains/protocols A-Network integrates
with.

**Eligible programs:**

| Program | Typical size | Fit |
|---|---|---|
| BNB Chain Builder Grants | $5K–$50K | High — AnetSwap is a BSC DEX |
| Pi Network Hackathon | $1K–$10K | High — Pi integration tracker item |
| Gitcoin Grants (Quadratic Funding) | $500–$5K per round | Medium — open-source L1 |
| MetaMask Grants DAO | $5K–$25K | Medium — wallet interoperability angle |
| Optimism RetroPGF | variable | Low — needs sustained public-goods footprint first |

**What's needed to apply:**
- Whitepaper ✅ (live at a-network.net/whitepaper.html)
- Public GitHub with MIT license ✅ (landed this week)
- SECURITY.md + CONTRIBUTING.md ✅ (landed this week)
- Active user base ✅ (15.6K DAU is more than enough)
- A 1-page application doc — **need to write**

**Action:** Once v129 ships, draft `GRANT_APPLICATION_TEMPLATE.md` covering:
- Problem statement
- Traction (DAU, installs, GitHub stars)
- Use of funds
- Milestones + accountability

**Time to first revenue:** 6–12 weeks (grant cycles are slow).

---

## Path 3 — Website monetization (a-network.net)

**What:** Web ads on the marketing/landing site are not subject to the AdMob
ban (different product, different policy regime).

**Current state:**
- `ads.txt` at `https://a-network.net/ads.txt` already lists
  `google.com, pub-4393604935823547, DIRECT` ✅
- AdSense for web (`pub-4393604935823547`) is the publisher ID — needs
  verification it's still active (the *AdMob* ban may or may not have spilled
  over to AdSense; check first)
- If web AdSense was also banned, fall back to Carbon Ads or EthicalAds (both
  are crypto-friendly developer-focused networks)

**Realistic revenue at current website traffic:**
- Whitepaper / docs / landing-page visits: ~5K/mo (estimate; verify with
  Cloudflare or Plausible)
- AdSense web eCPM for crypto/tech audience: $1–3
- **Estimated: $5–50/mo** — small, but $0 effort once it's set up

**Bigger lever — direct sponsorships:**
- Sell a "Sponsored by" footer slot to other crypto projects: $200–500/mo
- Sell a tutorial / case-study landing-page slot: $500–1,000 one-time

**Action items:**
- [ ] Verify AdSense status at https://www.google.com/adsense
- [ ] If active, place AdSense unit in whitepaper.html footer
- [ ] If banned, replace with Carbon Ads (`carbonads.net`)
- [ ] Add "Sponsorships" link in site footer pointing to a Google Form

**Time to first revenue:** 1–2 weeks.

---

## Path 4 — Premium features via Play Billing

**What:** Add a "Pro" tier inside the wallet. Sell it via Google Play Billing
(not crypto) so Play's policy team has nothing to object to — it's the same
billing flow Spotify and Notion use.

**Why this works on a flagged app:**
- Play Billing is *encouraged* by Google (15% revenue cut, no policy friction)
- Doesn't trigger the "deceptive monetization" or "ads in finance app" rules
- Adds value rather than friction → improves retention

**Pro tier feature ideas:**
| Feature | Build complexity | User appeal |
|---|---|---|
| Portfolio analytics (cost basis, P&L) | Medium | High |
| Custom RPC endpoints | Low | Medium (power users) |
| Multi-wallet management (>3 wallets) | Low | Medium |
| Advanced charting on swap pairs | Medium | Medium |
| Theme customization | Low | Low |
| Priority support (Telegram VIP) | Zero code | Medium |
| Early access to new features | Zero code | Medium |

**Pricing:** $2.99/month or $19.99/year (sweet spot for India/SEA users)

**Revenue model:**
- 1% conversion of 15.6K DAU = 156 subscribers
- 156 × $2.99 × 0.85 (Play's 15% cut) = **~$396/mo**
- At 3% conversion (achievable with good Pro features) = **~$1,200/mo**

**Implementation effort:** Medium. Need:
- [ ] `in_app_purchase` Flutter package
- [ ] Subscription product configured in Play Console
- [ ] Backend endpoint to verify Play receipts and gate features
- [ ] Pro upgrade UI

**Time to first revenue:** 4–8 weeks.

**Important caveat:** Pro features must NOT include anything that touches
crypto-as-payment (e.g., "pay 100 wANET for Pro"). Must be fiat-only via Play
Billing or Play rejects it.

---

## Path 5 — Axon ad network (LONG TERM)

**What:** Build your own ad inventory and sell directly to advertisers without
Google/Unity in the loop. Original pubspec.yaml note already references this:

```
# Axon (ads.axon) integration will replace it in a future release.
```

**Why this is the right endgame:**
- You control policy (no AdMob ban risk)
- You keep 100% of revenue (no 30% network cut)
- Advertisers are crypto-native projects who want exposure to your DAU

**Why it's not happening this quarter:**
- Needs ad-serving backend (Render service)
- Needs advertiser onboarding flow
- Needs at least 50K DAU to attract advertisers willing to pay
- 6–12 month build-out minimum

**When to revisit:** After L1 mainnet ships and DAU crosses 50K. Until then,
Paths 1–4 are higher-leverage.

---

## What NOT to do

- ❌ Do not integrate Unity Ads SDK on `com.anetwork.app`
- ❌ Do not integrate AdMob, IronSource, Vungle, AppLovin, or any ad mediation
  SDK on the wallet
- ❌ Do not accept "sponsored token" payments in exchange for fake "verified"
  badges (kills trust, kills the entire DEX)
- ❌ Do not sell user data or analytics (privacy is a core differentiator)
- ❌ Do not add ads to the bridge or seed-phrase flows even if Path 4 (Pro) is
  added — keep all financial-action screens ad-free forever

---

## 6-month revenue projection (conservative)

| Month | Path 1 (Listings) | Path 2 (Grants) | Path 3 (Web) | Path 4 (Pro) | Total |
|---|---|---|---|---|---|
| M1 (Jun 2026) | $0 | $0 | $20 | $0 | **$20** |
| M2 | $200 | $0 | $30 | $0 | **$230** |
| M3 | $400 | $0 | $50 | $200 | **$650** |
| M4 | $600 | $5,000 (grant) | $50 | $400 | **$6,050** |
| M5 | $650 | $0 | $80 | $600 | **$1,330** |
| M6 (Nov 2026) | $700 | $0 | $100 | $800 | **$1,600** |
| **6-mo total** | **$2,550** | **$5,000** | **$330** | **$2,000** | **~$9,880** |

Sustained monthly run-rate by M6: **~$1,600/mo** + occasional grant lumps.
Enough to fund ops ($105/mo), modest validator grants ($500/mo), and start
building a smart-contract audit fund (~$1,000/mo saved).

---

## Sequencing — what to do in what order

**Phase 0 — RIGHT NOW (this week)**
- ✅ Wait for v129 (1.0.66) Play review to clear
- ✅ Post X threads from `OUTREACH_COPY_PACK.md` (grows DAU = grows everything)
- ✅ Verify AdSense web account status

**Phase 1 — Next 2 weeks (after v129 ships)**
- Ship v130 — edge-to-edge Android 15 fixes only
- Add AnetSwap listing-application form to a-network.net (Path 1 foundation)
- Decide on AdSense vs Carbon Ads for website (Path 3)

**Phase 2 — Weeks 3–6**
- Launch Curated Listing tier (Path 1) — first listing fees
- Draft and submit BNB Chain Builder Grant application (Path 2)
- Place web ad units (Path 3)

**Phase 3 — Weeks 7–12**
- Ship v131 — Pro tier via Play Billing (Path 4)
- Submit Pi Hackathon application (Path 2)
- Scale featured-listing program (Path 1)

**Phase 4 — Q4 2026 and beyond**
- Evaluate Axon ad network (Path 5) once DAU > 50K
- Revisit recognition-only program — convert top contributors to paid
  contractors funded by listing fees + grants

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-28 | Configure Unity Ads dashboard but **do not** integrate SDK | Dashboard config is free hygiene; SDK integration risks Play suspension |
| 2026-05-28 | Publish app-ads.txt anyway | Costs nothing, future-proof |
| 2026-05-28 | Defer all in-app ads indefinitely | AdMob ban + flagged listing makes risk-adjusted EV negative |
| 2026-05-28 | Prioritize listing fees + grants over ads | Zero policy risk, scales with chain TVL |
