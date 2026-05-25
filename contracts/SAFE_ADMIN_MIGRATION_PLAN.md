# AnetBridgeVault admin migration plan — EOA → 2-of-2 Gnosis Safe

**Goal:** Replace the current vault admin EOA `0x54A65c28C894acB912A6f9527082749c44c0CC74` (single private key, currently on Joel's machine) with a 2-of-2 Gnosis Safe co-owned by both founders. This removes the last single-key role with on-chain governance power over the vault.

**Authored:** 2026-05-25
**Status:** Planning — not yet executed.

---

## Why

Current admin role can:
- Schedule signer-set rotations (48h timelocked).
- Schedule cap changes (48h timelocked).
- Transfer admin role (instant; 2-step propose/accept, **not** time-delayed — see `AnetBridgeVault.sol` `transferAdmin` / `acceptAdmin`).

Admin **cannot**: release wANET, mint, bypass signers, rescue the vault asset. The blast radius of admin compromise is bounded but still serious — an attacker with admin can rotate signers to addresses they control (after 48h) and then drain via legitimate releases up to the daily caps. A 2-of-2 Safe removes the single-key exposure.

---

## What we are NOT doing

- We are NOT renouncing admin (yet). That's a planned later milestone (#10 in the decentralization tracker) after 6+ months of clean multisig operation.
- We are NOT changing the pauser role in this migration. Pauser stays as the dedicated panic-stop EOA `0x8030e2D89cE6e25f6348176085a5425D7D0F7BD5`; it is intentionally separate so pause is fast and not gated on Safe quorum. (Future hardening: move pauser to a hardware-wallet-only key.)
- We are NOT changing the signer set in this migration. Signer rotation to onboard a co-founder-operated signer is a separate item on the v3.5 roadmap.

---

## Prerequisites

1. **Both founders have a hardware wallet** (Ledger / Trezor / Keystone) on BSC mainnet.
2. **Each founder's Safe-owner address has a small BNB balance** for gas (a few cents each).
3. **Joel still controls the current admin EOA** `0x54A65c28…0CC74`. Confirm by signing a test message before starting.
4. **Both founders agree on the Safe owner addresses** and the 2-of-2 threshold ahead of time.

---

## Step 1 — Deploy the Safe

Use the official Safe UI at https://app.safe.global

1. Connect with Joel's hardware wallet on **BSC mainnet** (chain 56).
2. Click **Create new Safe**.
3. Configure:
   - **Name:** `A-Network Bridge Vault Admin` (off-chain label, doesn't matter on-chain).
   - **Owners:** add 2 addresses:
     - Joel's hardware wallet address (BSC).
     - Co-founder `@Digitalgold1979`'s hardware wallet address (BSC).
   - **Threshold:** `2` (both must approve every transaction).
4. Review and deploy. Gas: a few cents BNB.
5. Record the deployed Safe address. Call it `SAFE_ADDR` for the rest of this doc.
6. **Verify** the Safe on BscScan:
   - Owners returned by `getOwners()` exactly match the two configured addresses.
   - `getThreshold()` returns `2`.
7. **Test the Safe** before handing it the vault. Send 0.001 BNB into it, then send it back out using a 2-of-2 signature flow. Confirms both owners can co-sign without surprises.

---

## Step 2 — Propose admin transfer from the current EOA

From the **current admin EOA** `0x54A65c28C894acB912A6f9527082749c44c0CC74` (Joel's key):

Call `AnetBridgeVault.transferAdmin(SAFE_ADDR)` on the vault.

**Easiest path: BscScan Write Contract**

1. Open: `https://bscscan.com/address/0x31438362a7667ce5559500023D025c7c14168B49#writeContract`
2. Connect Web3 with the wallet that controls `0x54A65c28…0CC74`.
3. Find `transferAdmin(address)`. Argument `newAdmin = SAFE_ADDR`.
4. Click **Write** → sign on hardware wallet.

This sets `pendingAdmin = SAFE_ADDR`. **It does not yet change `admin`.** No timelock (per contract `transferAdmin` is instant for the proposal; `acceptAdmin` finalises).

Verify on-chain:
```bash
# pendingAdmin() selector = 0x26782247
curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_call",
    "params":[{"to":"0x31438362a7667ce5559500023D025c7c14168B49",
               "data":"0x26782247"},"latest"],"id":1}' \
  https://bsc-dataseed.binance.org/
# Expect last 20 bytes == SAFE_ADDR (lowercased)
```

---

## Step 3 — Accept admin from the Safe

From the **Safe** (`SAFE_ADDR`), call `AnetBridgeVault.acceptAdmin()`.

In Safe UI:
1. Open the Safe → **New transaction** → **Contract interaction**.
2. Contract: `0x31438362a7667ce5559500023D025c7c14168B49`.
3. ABI: paste the function fragment `[{"inputs":[],"name":"acceptAdmin","outputs":[],"stateMutability":"nonpayable","type":"function"}]` (or load the verified ABI from BscScan).
4. Method: `acceptAdmin`. No arguments.
5. Create the proposal. Owner #1 signs. Owner #2 signs.
6. After threshold (2/2) is reached, the Safe executes the call.

This sets `admin = SAFE_ADDR` and clears `pendingAdmin`. Done.

---

## Step 4 — Verify

```bash
# admin() selector = 0xf851a440
curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_call",
    "params":[{"to":"0x31438362a7667ce5559500023D025c7c14168B49",
               "data":"0xf851a440"},"latest"],"id":1}' \
  https://bsc-dataseed.binance.org/
# Expect last 20 bytes == SAFE_ADDR
```

Also confirm:
- `pendingAdmin()` returns the zero address.
- Watch BscScan for the `AdminTransferAccepted` event in the tx that called `acceptAdmin`.

---

## Step 5 — Retire the old admin EOA

Once the Safe is confirmed as admin:

1. **Send any remaining BNB out of `0x54A65c28…0CC74`** to a personal wallet (a few cents probably).
2. **Securely destroy the old admin private key:**
   - Delete it from any `.env` / keys file on the laptop.
   - Delete it from password managers / 1Password if stored there.
   - Wipe any paper backup.
3. The address is now permanently inert (no role, no funds). It can stay as a historical-record artifact on-chain.

---

## Rollback plan

If anything goes wrong **before** Step 3 (acceptAdmin):
- The vault's `admin` is still the EOA. No state changed.
- Simply call `transferAdmin(currentAdmin)` from the EOA to reset `pendingAdmin = currentAdmin` (or any other valid address).

If anything goes wrong **after** Step 3:
- The Safe is admin. The EOA has no power.
- The Safe (2-of-2) can call `transferAdmin(<another address>)` to hand admin to a recovery address. Both founders must co-sign.

---

## Risks and acceptances

| Risk | Mitigation |
|---|---|
| One founder's hardware wallet is lost → 2-of-2 = 1-of-2 = governance frozen | Both founders keep **separate seed-phrase backups** in independent secure locations. Optional: add a 3rd owner with 2-of-3 threshold to tolerate one loss. |
| Safe contract bug | Safe is the most audited multisig on-chain. Acceptable risk. |
| BscScan/Safe UI compromise during ceremony | All signatures still happen on the hardware wallet; confirm `transferAdmin` and `acceptAdmin` calldata on-device before signing. |
| `transferAdmin` is not timelocked → if current admin EOA is compromised today, attacker can transfer admin to themselves instantly | This migration **removes** that risk. After the migration the new admin = Safe = 2-of-2; an attacker would need both founder hardware wallets. |

---

## Estimated execution time

- Step 1 (deploy Safe): ~15 min including hardware-wallet ceremony.
- Step 2 (transferAdmin propose): ~5 min.
- Step 3 (acceptAdmin from Safe): ~10 min (both founders sign).
- Step 4 (verify): ~5 min.
- Step 5 (retire EOA): ~5 min.

Total: under an hour with both founders available.
