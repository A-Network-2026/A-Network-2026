# Copy-Paste Pack — Public Outreach (no funds required)

This file is for you to copy-paste into X, Discord, and email. Every
piece is calibrated to be honest about A-Network's current
zero-budget reality while still attracting the right kind of help.

---

## 1. Bug bounty announcement (post first — funds #7)

### 1a. X thread (4 tweets, post from `@Joel_Dupalco`)

**Tweet 1/4:**
> A-Network is opening a public bug bounty on our BNB Chain contracts.
>
> Scope: AnetBridgeVault (holds 10.5M wANET) + AnetSwap v3.6.
> Reward: up to 100,000 wANET, paid through the same 2-of-3 vault path that protects user funds.
>
> Details 👇

**Tweet 2/4:**
> Severity table:
> 🔴 Critical — 100,000 wANET (fund loss, signature forge, vault drain)
> 🟠 High — 25,000 wANET (timelock bypass, role escalation)
> 🟡 Medium — 5,000 wANET (correctness w/o fund risk)
> 🟢 Low — 1,000 wANET (spec drift, observable UX issue)

**Tweet 3/4:**
> Full audit package (frozen commit, source hashes, reproducible build, threat model):
> github.com/A-Network-2026/A-Network-2026/blob/main/contracts/AUDIT_PACKAGE.md
>
> Disclosure rules + safe harbor:
> github.com/A-Network-2026/A-Network-2026/blob/main/SECURITY.md

**Tweet 4/4:**
> We don't have cash budget for a paid CertiK/OZ audit. We do have wANET in the vault and a real threat model. If you find something, we will pay you. If we ever can afford a paid audit later, it'll be additive, not a replacement.
>
> Email findings: security@a-network.dev

---

### 1b. Discord / Telegram post (one block)

> 📢 **A-Network bug bounty is now LIVE**
>
> We're paying real wANET for real findings against AnetBridgeVault + AnetSwap v3.6 on BNB Chain.
>
> 🔴 Critical · 100,000 wANET
> 🟠 High · 25,000 wANET
> 🟡 Medium · 5,000 wANET
> 🟢 Low · 1,000 wANET
>
> Audit package (everything you need to start):
> https://github.com/A-Network-2026/A-Network-2026/blob/main/contracts/AUDIT_PACKAGE.md
>
> Disclosure rules:
> https://github.com/A-Network-2026/A-Network-2026/blob/main/SECURITY.md
>
> Send findings to **security@a-network.dev** (NOT this channel).
>
> We can't afford a paid audit firm right now. We can pay finders. If you've ever wanted a real, scoped, in-production target — this is it.

---

## 2. Validator recruitment (post second — funds #8)

### 2a. X thread (5 tweets)

**Tweet 1/5:**
> A-Network is opening Phase 2 validator recruitment.
>
> We're looking for 2 independent operators to join the L1 set, bringing us to 3 validators on 2-of-3 quorum. This is the recruitment that closes the biggest decentralization gap on our scorecard.

**Tweet 2/5:**
> What you get:
> • 50,000 wANET grant per operator, vested 12 months (3-month cliff)
> • USD 250/mo infra reimbursement on invoice, first 12 months
> • Public attribution as a Phase 2 validator
>
> Paid through the same 2-of-3 vault path. No side channels.

**Tweet 3/5:**
> What we need from you:
> • Real validator experience (Ethereum, Cosmos, BSC, Polkadot, Solana, etc.)
> • Independent infrastructure (not on the same cloud / region / ISP as the founding operator)
> • Doxxable to project counsel; public attribution as handle or name
> • 12-month commitment minimum, 30-day exit notice

**Tweet 4/5:**
> What we cannot offer (be honest):
> • There is no protocol-level validator reward yet — that comes in Phase 3
> • We are not BFT yet at Phase 2 (3 ops / 2-of-3 = 0 byzantine tolerated)
> • We have no cash beyond the infra reimbursement above
>
> If those are dealbreakers, this is not for you.

**Tweet 5/5:**
> Full spec — hardware, key custody, SLO, onboarding sequence:
> github.com/A-Network-2026/anet-chain/blob/main/VALIDATOR_RECRUITMENT_SPEC.md
>
> Intent to validate → security@a-network.dev
> Subject: "Phase 2 validator — <your handle>"

---

### 2b. Discord / Telegram post

> ⛓️ **Phase 2 validator recruitment — A-Network L1**
>
> Looking for **2 operators** to bring the L1 chain to 3 validators on 2-of-3 quorum. This is the milestone that takes the chain itself out of single-operator hands.
>
> **Grant:** 50,000 wANET per op, vested 12mo (3mo cliff) + USD 250/mo infra reimbursement
> **Term:** 12 months minimum, 30-day exit notice
> **Profile we want:** real validator experience, independent infra, doxxable to counsel
>
> Full spec: https://github.com/A-Network-2026/anet-chain/blob/main/VALIDATOR_RECRUITMENT_SPEC.md
>
> Apply: **security@a-network.dev** · subject "Phase 2 validator — your handle"
>
> Honest disclosure: no protocol reward yet (Phase 3), not BFT yet at Phase 2, zero cash beyond infra. If you're here to stake-for-yield, this isn't it. If you're here because you believe in the project and want a real validator seat at the bootstrap, we want you.

---

## 3. Email auto-response (paste into Gmail / your mail provider)

If you set up `security@a-network.dev` and want a stock auto-reply
for inbound submissions:

```
Subject: A-Network security inbox — your message has been received

Thanks for writing in. Your message is in the security inbox and will be triaged within 48 hours per https://github.com/A-Network-2026/A-Network-2026/blob/main/SECURITY.md.

If your message is a bug bounty submission:
- Severity assignment within 5 business days
- Reward (if applicable) paid in wANET via the 2-of-3 vault path
- Coordinated disclosure timeline per the policy

If your message is a Phase 2 validator application:
- Spec: https://github.com/A-Network-2026/anet-chain/blob/main/VALIDATOR_RECRUITMENT_SPEC.md
- Next step is identity verification with project counsel (~1 week)

If your message is something else: it will still be read and routed.

— A-Network maintainers
```

---

## 4. Pinned message for the project website (`index.html` hero)

If you want a one-line banner at the top of the homepage:

```html
<div style="background:#ffb84a;color:#1a1a1a;padding:10px 18px;text-align:center;font-weight:600;font-size:14px;">
  🪲 Bug bounty live · up to 100,000 wANET ·
  <a href="contracts/AUDIT_PACKAGE.md" style="color:#1a1a1a;text-decoration:underline;">Scope</a> ·
  <a href="SECURITY.md" style="color:#1a1a1a;text-decoration:underline;">Rules</a>
</div>
```

Drop above the existing hero. Remove the banner when you have either
a paid audit report or 30 days of bounty-program traction.

---

## 5. Order of operations (today)

1. ✅ Send X thread #1 (bug bounty) from `@Joel_Dupalco`.
2. ✅ Send X thread #2 (validator recruitment) ~2 hours later.
3. ✅ Cross-post both Discord blocks.
4. ✅ Set up `security@a-network.dev` if it isn't already (any
   provider — Cloudflare Email Routing is free).
5. ✅ Paste the auto-response into your mail config.
6. ✅ (Optional) Add the bounty banner to `index.html`.

Total time: ~30 minutes. Cost: $0.

Once threads are live, send me the tweet URLs and I'll link them
from the tracker.
