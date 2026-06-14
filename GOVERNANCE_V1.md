# A-Network Governance V1

**Status:** Production · **Introduced:** Whitepaper v3.8 · App 1.0.84+144 · 2026-06-10
**Model:** Participation-based — **1 qualified account = 1 vote**

A-Network Governance V1 is the protocol's first on-platform community vote. It is
designed to keep decision-making aligned with the project's utility-first, fair-
distribution ethos: a long-time miner with a single account has exactly the same
voice as the largest holder.

---

## 1. Voting power model

| Property | Value |
| --- | --- |
| Voting unit | **1 qualified account = 1 vote** |
| Token-weighted? | **No** — not 1 ANET = 1 vote |
| Wallet-weighted? | **No** |
| NFT-weighted? | **No** |
| Enforcement | Server-side, account-based |

Voting weight is uniform and account-based. It is never scaled by ANET balance,
number of wallets, or NFT holdings. Because authority is enforced entirely on the
backend, an outdated app client cannot bypass or game the model.

---

## 2. Eligibility

A vote is accepted only when **all** of the following gates pass:

1. **Email verified** — the account has a confirmed email.
2. **Account not banned** — accounts flagged by the risk/ban system are excluded.
3. **At least one completed mining session** — proof of genuine participation.
4. **Web3 migration wallet configured** — the account has set its migration wallet.
5. **Has not already voted** on the active proposal.

Ineligible accounts receive a clear **"Not Eligible To Vote"** response that
includes a per-requirement checklist, so the user knows exactly what to complete.

A configurable risk threshold (`GOVERNANCE_RISK_THRESHOLD`, default `10`) also
gates accounts whose risk score is at or above the limit.

---

## 3. Proposal lifecycle

- **Voting window:** 21 days (configurable via `VOTE_DURATION_DAYS`).
- **Activation:** Voting starts the moment the operator enables the backend
  feature flag (`GOVERNANCE_ENABLED=true`) — **not** when each user updates their
  app. Start and end timestamps are fixed server-side at activation, so every
  participant shares one synchronized window.
- **Closing:** When the window elapses, the proposal is flipped to `closed`
  automatically on the next read and the tally is final.
- **Choices:** `YES` / `NO` / `ABSTAIN`.

### First proposal — Utility-First Distribution Roadmap

> Proposal to prioritize utility, governance, validators, wallet migration, and
> smart-contract preparation before Layer 1 monetary activation. Layer 1 market
> settlement and broader liquidity activation would occur after 50% of the total
> mineable supply has been distributed. Governance remains one qualified
> participant equals one vote. Web3 reflections may be discontinued after the 50%
> distribution milestone to support fairer long-term distribution.

---

## 4. Backend

The governance route is mounted at `/governance` on the main API backend
(`rmp-site/backend`). It is additive and isolated — no existing mining, wallet, or
bridge behavior changes.

### Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOVERNANCE_ENABLED` | `false` | Set `true` to auto-start the seed proposal on boot. |
| `VOTE_DURATION_DAYS` | `21` | Length of the voting window in days. |
| `GOVERNANCE_RISK_THRESHOLD` | `10` | Accounts with `risk_score >=` this cannot vote. |

### Database schema

Tables are created lazily on first use (idempotent `CREATE TABLE IF NOT EXISTS`):

- **`governance_proposals`** — `id`, `slug` (unique), `title`, `description`,
  `choices`, `start_date`, `end_date`, `status` (`active` / `closed`).
- **`governance_votes`** — `id`, `proposal_id`, `user_id`, `vote_choice`,
  `wallet_address`, `created_at`, with `UNIQUE (proposal_id, user_id)`.
- **`governance_eligibility`** — advisory snapshot of each account's latest gate
  evaluation.
- **`governance_audit_logs`** — append-only trail of every governance action.

### Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/governance/status` | Public | Active state + days remaining. |
| `GET` | `/governance/proposal` | Public | Active proposal body and choices. |
| `GET` | `/governance/results` | Public | Live `{ yes, no, abstain, totalVotes }`. |
| `GET` | `/governance/eligibility` | Required | Caller gate breakdown + `hasVoted`. |
| `POST` | `/governance/vote` | Required | Cast a vote `{ choice }`. |

`POST /governance/vote` body: `{ "choice": "YES" | "NO" | "ABSTAIN" }`.

---

## 5. Integrity & auditability

- **Replay-safe casting.** Votes are written inside a single database transaction
  using `SELECT … FOR UPDATE`. Combined with the `UNIQUE(proposal_id, user_id)`
  constraint, this guarantees exactly one ballot per account even under
  concurrent requests; a unique-violation is treated as "already voted".
- **Append-only audit.** Every action — `vote_cast`, `vote_rejected_ineligible`,
  `vote_rejected_duplicate`, `vote_rejected_closed` — is recorded in
  `governance_audit_logs` with the action, choice, and source IP.
- **Public transparency.** Status, proposal text, and the running tally are
  readable without authentication; only casting a vote requires a signed-in,
  eligible account.

---

## 6. Mobile app

Governance is reachable from **Profile → Governance** in the A-Network app
(version 1.0.84+144 and later). The screen shows:

- Live status and days remaining, with a "1 account = 1 vote" badge.
- The active proposal title and description.
- The ballot — `YES` / `NO` / `ABSTAIN` — or a "Not Eligible To Vote" checklist
  when requirements are unmet, or a confirmation once the account has voted.
- A real-time results panel with per-choice counts and percentages.

API methods live in `lib/api.dart`
(`getGovernanceStatusAPI`, `getGovernanceProposalAPI`, `getGovernanceResultsAPI`,
`getGovernanceEligibilityAPI`, `castGovernanceVoteAPI`); the UI is in
`lib/governance_page.dart`.

---

## 7. Operator runbook — starting a vote

1. Set `GOVERNANCE_ENABLED=true` (and optionally `VOTE_DURATION_DAYS`) in the
   backend environment.
2. Restart / redeploy the backend. On first boot with the flag enabled, the seed
   proposal is created with `start = now()` and `end = now() + VOTE_DURATION_DAYS`.
   The insert is idempotent (`ON CONFLICT (slug) DO NOTHING`), so repeated boots
   never create duplicates or reset the window.
3. Verify with `GET /governance/status` — `active` should be `true` with the
   expected `daysRemaining`.
4. The vote closes automatically when the window elapses; no manual action needed.

---

## 8. Future direction

Governance V1 is intentionally minimal: one account, one vote, transparent tally.
Future iterations may add proposal threading and on-chain anchoring of finalized
results, but the **participation-based (non-capital-weighted)** principle is
foundational and will be preserved.
