# A-Network Smart Contracts — External Audit Package

**Status:** Ready for third-party audit.
**Prepared:** May 28, 2026.
**Tracker milestone:** #7 (Third-party security audit).

This document is the single entry point a prospective auditor (CertiK,
Hacken, OpenZeppelin, Trail of Bits, etc.) needs to scope and price the
engagement. Everything required to reproduce the build, run the test
suite, and reason about the threat model is referenced inline.

---

## 1. Scope

| File | LOC | SHA-256 | Audit scope |
|---|---:|---|---|
| `src/AnetBridgeVault.sol` | 545 | `bc1bdfcafe712fb10da6f283f5c192826261c6f7038d093a057e5567fb639570` | **In scope.** The wANET escrow on BNB Chain. Holds all bridge liquidity. |
| `src/AnetSwap.sol`        | 625 | `25221978074a3103dfd84f497dba126a20148fb50d6aacbed3d105f3eb9bc80e` | **In scope.** Entry-side swap router (BNB/USDT/USDC → ANET). v3.6. |
| `src/MockERC20.sol`       |  52 | `b41bb29143f05b19de4085a24ffded4eaeaa7a36154431d0c7a01085ee444948` | **Test-only.** Out of scope. Not deployable to mainnet. |
| `test/AnetBridgeVault.test.cjs` | 623 | reproduce via `shasum -a 256` | Reference, not audit subject. |
| `test/AnetSwap.test.cjs`        | 415 | reproduce via `shasum -a 256` | Reference, not audit subject. |

**Total in-scope LOC:** 1,170.

**Frozen git commit:** `15a1920` on `main` of
`github.com/A-Network-2026/A-Network-2026`. Auditors should pin to this
SHA. Any subsequent commit is out of scope unless rescoped in writing.

**Out of scope (current pass):**

- ANET BEP-20 token at `0x791055A7d52AA392eaE8De04250497f33807E46A` —
  ownership permanently renounced May 24, 2026; contract is immutable.
- A-Network Layer 1 chain (`anet-chain/`) — Rust, separate audit track.
- pi-backend relayer (`pi-backend/`) — Node.js, separate audit track.
- DEX assets (`dexscreener_assets/`) — branding only, no contracts.

---

## 2. Reproducing the build

Hardhat 2.x, Node 18+. Solidity 0.8.20.

```bash
git clone https://github.com/A-Network-2026/A-Network-2026.git
cd A-Network-2026/contracts
git checkout 15a1920
npm install
npx hardhat compile
npx hardhat test
```

**Expected:** `70 passing` (33 vault + 37 swap), 0 failing, 0 pending.

The `hardhat.config.cjs` pins compiler 0.8.20 with optimizer enabled
(runs=200) and viaIR off. No external libraries beyond OpenZeppelin
contracts (peer-pinned in `package.json`).

---

## 3. Deployed addresses (current production)

| Contract | Chain | Address | Deploy commit | Status |
|---|---|---|---|---|
| ANET BEP-20 | BSC mainnet | `0x791055A7d52AA392eaE8De04250497f33807E46A` | pre-renounce | Owner renounced May 24, 2026. Immutable. |
| AnetBridgeVault | BSC mainnet | `0x31438362a7667ce5559500023D025c7c14168B49` | May 25, 2026 (deploy tx `0x82da7f2a…62c7e`) | Live. Holds ~10.5M wANET. |
| AnetSwap (v3.5) | BSC mainnet | `0x1A1AFE5BF1ffDB64aC10958cCe2D06B22Fb47Fb8` | May 28, 2026 | Live but **scheduled for replacement** by the v3.6 contract in this audit package. See `DEPLOY_V36_MIGRATION.md`. |

The v3.6 `AnetSwap` build in this audit package has **not yet been
deployed to mainnet**. The audit is the gate before deployment.

---

## 4. Threat model

### 4.1 Asset at risk

- **Vault:** ~10.5M wANET (BEP-20) plus any future cofounder mirror
  deposit. Worth real USD at any DEX-tradeable price for the token.
- **Swap (v3.6):** transient BNB/USDT/USDC balances pending operator
  credit on L1, plus accumulated fees (1% of inbound).

### 4.2 Trust assumptions (what we accept as out-of-scope risk)

1. **L1 chain integrity.** AnetSwap records L1 credit via an
   `operator`-only `markProcessed` call. If the L1 chain is rolled back
   or the operator is compromised, swaps may be double-credited on L1.
   This is outside the scope of the BSC contracts and is the
   responsibility of the L1 + relayer audit track.
2. **EIP-712 signer key custody.** The vault's release path is gated by
   a 2-of-3 EIP-712 threshold. We assume the three signer keys are held
   on independent hardware in independent failure domains. Key
   management is operational, not a contract issue.
3. **Stable DEX pricing for entry-side quoting.** AnetSwap accepts the
   caller's `expectedAnetAmount` as a hint only; the contract does not
   quote against a DEX. Mispriced inbound swaps are an off-chain
   griefing concern, not a contract bug.

### 4.3 In-scope attack surfaces (please probe these)

**AnetBridgeVault:**

- **Signature replay** across chain id / contract / burnId. EIP-712
  domain separator binds `chainId` and `verifyingContract`; burnId is
  consumed via `processedBurns[burnId] = true`. Probe for replay across
  forks, signer rotation, threshold change.
- **Sliding-window cap evasion.** Per-tx (10k), per-recipient-24h
  (50k), global-24h (250k) caps are enforced via a true sliding window
  (commit `6d30d3f`). Probe for midnight-burst, recipient-spray, or
  burnId-grinding workarounds.
- **48h timelock bypass.** `scheduleChange` / `executeChange` with 14d
  grace and `keccak256(abi.encode(...))` arg re-hashing. Probe for
  schedule-then-swap-args at execute, grace-window miscalculation,
  cross-paramKey collision.
- **Admin role compromise.** `transferAdmin` / `acceptAdmin` 2-step.
  Probe for accept-without-propose, propose-cancel race, post-renounce
  re-entry.
- **Asset rescue.** Vault is a one-way sink for wANET; admin
  intentionally **cannot** call ERC20 transfer on the vault asset.
  Probe whether any code path (rescue of mistakenly-sent other tokens,
  selfdestruct neighbors, callback re-entry) can drain wANET.

**AnetSwap (v3.6):**

- **Role split correctness.** `admin` / `pauser` / `operator`. Pauser
  cannot unpause (must go through admin's 48h timelock). Operator
  cannot move funds. Probe each cross-role attempt.
- **Timelock parity with vault.** Same 48h delay + 14d grace + arg
  re-hashing. Probe for the same bypasses as the vault.
- **Fee accounting.** `feeBps = 100` (1%). Probe for integer overflow
  on large swaps, fee-recipient griefing via reverting `receive()`,
  Safe-multisig `.call{value:}` gas-stipend mismatch (the v3.5
  satoshi-pass already addressed this; reconfirm).
- **Pending-swap indexing.** `getPendingSwaps`, paged variant, sender
  index. Probe for DoS via unbounded growth, stale-entry leak.
- **`withdrawNative` / `withdrawToken`.** Admin-only, destination
  hard-wired to `admin`. Probe whether the admin can be tricked into a
  destination redirect via call-data crafting.

### 4.4 Known design choices (not bugs)

- **Fee-on-transfer tokens are not supported as inbound.** Documented
  as a v3.7 follow-up. AnetSwap assumes `transferFrom(amount)` actually
  credits `amount`.
- **No on-chain entry-side rolling cap on AnetSwap.** The vault
  enforces caps on the *exit* side. The entry side relies on operator
  rate-limiting plus the global supply invariant. v3.7 will add a
  rolling cap to AnetSwap.
- **AnetSwap is not paused by vault pause.** Two independent pause
  surfaces. This is intentional: an exit-side incident should not block
  entry-side liquidity routing to other escrows.

### 4.5 Global supply invariant (cross-contract)

The protocol-level invariant the auditor should verify holds across the
audit package:

```
Σ wANET_all_chains  ≤  ANET_locked_on_L1  ≤  21,000,000
```

The vault is the BNB Chain anchor for this invariant. Any flow that
could violate it is a critical finding.

---

## 5. Internal audit history

- **`AUDIT_BRIDGE_2026-05-24.md`** — initial internal pass on the
  vault, pre-v3.5 hardening.
- **`whitepaper.html#v35-changelog`** — v3.5 "Satoshi & Engineer
  Thanks" audit pass on AnetSwap (Safe-multisig `.call{value:}`,
  paginated views, withdrawal events).
- **`whitepaper.html#v36-changelog`** — v3.6 governance hardening pass
  (this audit's primary subject for AnetSwap).
- **Commit history on `main`** documents every fix with one-commit-
  per-scope discipline; see `git log --oneline contracts/`.

The auditor should treat internal audits as **prior context, not
prior validation**. We have not engaged a third party until now.

---

## 6. External review program

A-Network does **not** currently have cash budget for a paid third-
party audit (typical scope at 1,170 LOC: USD 15k–60k), and we do
**not** issue wANET as bounty payment — the founder allocation is
reserved for the project's published economic functions and we will
not dilute that commitment.

What we offer external researchers is **durable public recognition**:
credit in the fix commit, credit in the whitepaper changelog, an
entry in `SECURITY_FINDINGS.md`, a pinned project-account acknowledgement
for Critical / High findings, and a signed letter for your portfolio
if you need one. Full terms and severity table: `SECURITY.md` at the
repo root.

The review target is **this audit package at the frozen commit**.
Findings against later commits are welcome but evaluated against the
then-current `main`.

This is the honest stance. If you need monetary compensation, the
audit firms below are reachable directly; A-Network cannot fund
them at this stage.

### 6.1 If a paid audit becomes affordable

Should funding materialise, the following firms have been pre-
scoped for an RFQ in priority order. This is reference material for
that future engagement — not a current commitment:

| Firm | Strengths | Approx scope | Notes |
|---|---|---|---|
| **OpenZeppelin** | Deepest Solidity bench. | 1–2 weeks for 1,170 LOC. | Highest signal value, highest cost. |
| **Trail of Bits** | Adversarial mindset; strong EIP-712 + signature work. | 1.5–2.5 weeks. | Manticore + Echidna usually included. |
| **Hacken** | Mid-tier price, solid BSC reputation. | 1–2 weeks. | Reasonable if budget is the constraint. |
| **CertiK** | Highest retail brand recognition. | 1–2 weeks. | Uneven historical quality; treat the score as marketing. |

A paid audit, if it happens, would be **additive** to the bounty,
not a replacement for it.

---

## 7. Deliverables expected from researchers

For a recognition-program submission:

1. Clear description + file/line or contract address.
2. Reproduction recipe — Hardhat test, cast call sequence, or
   step-by-step against a local fork.
3. Severity argument mapped to the `SECURITY.md` table.
4. Suggested mitigation (optional but appreciated).
5. Your preferred attribution (real name, handle, or anonymous).

When at least one external researcher publishes a finding against
the frozen commit (or completes a documented zero-finding review),
scorecard milestone #7 flips from IN PROGRESS to ✅ DONE with the
researcher's chosen attribution.

---

## 8. Contact

Per repo `SECURITY.md`. Use the disclosed channel for the audit
engagement and for any pre-disclosure of findings during the
engagement window.
