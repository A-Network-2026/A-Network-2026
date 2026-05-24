# ANET / wANET Bridge — Security Audit & Hardening Plan
**Date:** 2026-05-24  
**Scope:**
- BEP-20 `ANetwork` at `0x791055A7d52AA392eaE8De04250497f33807E46A` (immutable, verified)
- `AnetSwap.sol` (BSC → L1 direction)
- L1 → BSC cash-out path (currently EOA escrow `0x27766A070e6F55BD832A10aB9c5931FfA2037029` + relayer)
- L1 RPC `/bridge/burn*` endpoints in [anet-chain/src/rpc.rs](anet-chain/src/rpc.rs)

---

## 1. Summary of risk before hardening

| # | Risk | Severity | Component |
|---|---|---|---|
| R1 | Bridge escrow is a hot EOA — one key compromise drains 21M wANET | **Critical** | Escrow wallet |
| R2 | Per-tx / daily caps enforced only in relayer env vars, not on-chain | **High** | Relayer |
| R3 | Burn-id deduplication relies on Postgres truth — re-org / DB lie = double release | **High** | Relayer + DB |
| R4 | Owner of BEP-20 can `pause` / `setBlacklist` / (theoretically) `mint` with single key | Medium | BEP-20 token |
| R5 | `AnetSwap.withdrawNative` / `withdraw` let owner drain swap balance at will | Medium | AnetSwap |
| R6 | No emergency pause independent of L1 RPC liveness | Medium | Bridge |
| R7 | OZ v4.9.0 ERC20 / Ownable / Pausable code itself | None | BEP-20 token |

---

## 2. Existing contract findings

### 2.1 BEP-20 `ANetwork` (immutable — verified at exact match)
- Compiler 0.8.20, OZ v4.9.0 — no known vulns.
- `MAX_SUPPLY = 21_000_000 * 1e18` enforced inside `mint()`.
- Constructor already minted full 21M to deployer → `mint()` is dead code in practice.
- `setBlacklist` blocks both sender and recipient via `_beforeTokenTransfer` override (correct).
- `pause()` blocks all transfers via the same hook (correct).
- **Cannot be modified.** Hardening this layer means changing who the *owner* is, not changing the code.

**Recommended posture for the token contract:** transfer ownership to a Gnosis Safe multisig first (so a single phishing event doesn't pause/blacklist the token), then renounce only after the bridge has 6+ months of clean production operation.

### 2.2 `AnetSwap.sol` (BSC → L1)
- ReentrancyGuard, SafeERC20, Pausable, allowlist, min/max per token, ≤5% fee cap — all correct.
- `markProcessed(id, anetTxId)` is `onlyOwner` and per-id idempotent (`!processed`) — fine.
- `withdrawNative` / `withdraw` let `owner` move all collected funds anywhere — **timelock these** when ownership moves to the Safe.

**Action:** when redeploying or upgrading governance, make `AnetSwap`'s owner the same Safe + Timelock as the vault below.

### 2.3 L1 → BSC path (the actual cash-out for miners)
- L1 side: ECDSA-signed `bridge_burn` action authorization, atomic L1 debit, Postgres row, admin-key-gated relayer feed. **Reasonable.**
- BSC side: **no contract.** Relayer EOA calls `transfer()` from escrow EOA. Every protection is off-chain, in a process. This is the gap.

---

## 3. Hardened L1 → BSC architecture (what we're deploying)

```
┌───────────────────────────────────────────────────────────────────────┐
│  ANET L1 (anet-chain)                                                 │
│  1. user signs bridge_burn auth (ECDSA over L1 key)                   │
│  2. POST /bridge/burn → debits L1 balance, inserts bridge_burns row   │
│  3. GET  /bridge/burns (admin-key) → list pending                     │
└────────────────────────┬──────────────────────────────────────────────┘
                         │  burnId, l1Sender, bscRecipient, amount
                         ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Relayer cluster (M-of-N independent signers, separate keys)          │
│  Each signer:                                                         │
│    - independently fetches /bridge/burns/:id from L1                  │
│    - validates burn record + caps                                     │
│    - signs EIP-712 Release(burnId, l1Sender, recipient, amount, ddl)  │
│                                                                       │
│  Submitter (anyone — does not need a signer key) aggregates ≥M sigs   │
│  and calls AnetBridgeVault.releaseBurn(...)                           │
└────────────────────────┬──────────────────────────────────────────────┘
                         │
                         ▼
┌───────────────────────────────────────────────────────────────────────┐
│  AnetBridgeVault on BSC  ← holds ALL 21M wANET                        │
│  - Verifies M-of-N EIP-712 signatures                                 │
│  - Dedupes by burnId                                                  │
│  - Enforces per-tx, per-recipient-24h, global-24h caps ON-CHAIN       │
│  - Pause via separate cold pauser key                                 │
│  - Admin (Safe) parameter changes through 48h timelock                │
│  - CANNOT rescue wANET (one-way sink)                                 │
└────────────────────────┬──────────────────────────────────────────────┘
                         │
                         ▼
                  Miner's BSC address
```

### 3.1 Property table (vault)

| Property | Mechanism |
|---|---|
| One-way: wANET never leaves except via valid burn | `rescueOtherToken` rejects `address == WANET` |
| No single-key drain | M-of-N EIP-712 signatures, signers strictly ascending |
| No double-release | `burnIdConsumed[burnId]` mapping |
| Replay across chains blocked | `block.chainid` baked into DOMAIN_SEPARATOR |
| Signature malleability blocked | `s` upper-bound + `v ∈ {27,28}` |
| Per-tx cap | `maxPerTx` enforced before signature check |
| Rolling 24h caps | day-bucketed `WindowBucket` (per-recipient + global) |
| Emergency stop | `pauser` cold key (separate from signers/admin) |
| Admin can't run away | All param changes 48h-timelocked, no token withdraw |
| 2-step admin transfer | `transferAdmin` + `acceptAdmin` (prevents fat-finger to dead address) |

### 3.2 Recommended initial parameters

```
admin              = Gnosis Safe (3-of-5) on BSC
pauser             = separate hardware wallet, kept offline
signers            = 5 relayer addresses (independent infra/operators)
threshold          = 3 (3-of-5)
maxPerTx           =     10_000  ANET   (10,000 * 1e18)
maxPerRecipient24h =     50_000  ANET
maxGlobal24h       =    250_000  ANET
```

These match the existing `ANET_BRIDGE_MAX_BURN_PER_TX_ANET=10_000` env in [anet-chain/src/rpc.rs](anet-chain/src/rpc.rs#L2055).

### 3.3 Deployment & cut-over runbook

1. **Deploy `AnetBridgeVault`** with the params above to BSC.
2. From the current owner wallet, send **all 21,000,000 wANET** from `0x2776…7029` (and any other holdings) to the new vault address.
3. Verify on BscScan: `vault.vaultBalance() == 21_000_000 * 1e18`.
4. Update the relayer service to:
   - Build EIP-712 `Release` digests instead of raw `transfer()`.
   - Each signer signs independently; submitter aggregates.
5. Update [anet-chain/src/rpc.rs](anet-chain/src/rpc.rs) so the relayer release callback also records the on-chain `Released` event tx hash (already does — confirm `bsc_tx_hash` is from the vault, not from an EOA transfer).
6. Set `ANET_BRIDGE_BURN_ENABLED=true` only after a small canary cohort (e.g., 1 burn, 10 ANET) succeeds end-to-end.
7. Transfer **ownership of the BEP-20 token** (`0x7910…E46A`) to the **same Safe** that is the vault's admin. (Do not renounce yet — keep pause/blacklist available during the first 6 months of bridge operation.)
8. Publish vault address + signer set + caps in [whitepaper.html](A-Network-2026/whitepaper.html) v3.2 update.

### 3.4 Decentralization phase plan

| Phase | When | Action |
|---|---|---|
| P0 | Now | Vault deployed; Safe admin; EOA escrow drained to vault |
| P1 | +30 days | Add 48h Timelock contract in front of the Safe for vault admin ops |
| P2 | +90 days | Move 1 relayer signer slot to a community-elected key |
| P3 | +180 days | Renounce BEP-20 token ownership (no more pause/blacklist on the asset itself; vault remains the governing surface) |
| P4 | +360 days | Migrate vault admin to on-chain DAO governance, retire the Safe |

---

## 4. Items intentionally NOT done in this audit

- **No new BEP-20 token deployed.** The existing immutable contract is sound; redeploying would lose the verified address and 47 existing holders.
- **No proxy / upgrade pattern added to the vault.** Upgradeability is itself a centralization vector — the vault is intentionally non-upgradeable. Bug fixes require deploying a v2 and migrating supply through a one-time governed action (which the Safe + Timelock can authorize publicly).
- **No on-chain L1 light client.** Verifying L1 burns trustlessly on BSC would require an ANET light-client / SPV on EVM — out of scope for v1. M-of-N relayer signatures are the standard trust-minimized bridge primitive used by most production bridges (Wormhole, Axelar, deBridge, etc.).

---

## 5. Code deliverable

- [A-Network-2026/contracts/src/AnetBridgeVault.sol](A-Network-2026/contracts/src/AnetBridgeVault.sol) — hardened one-way release vault, 0.8.20, no external deps, ready to verify on BscScan.

Tests + deploy script should be added next (`contracts/test/AnetBridgeVault.t.sol` and `contracts/scripts/deploy-vault.js`) — say the word and I'll write them.
