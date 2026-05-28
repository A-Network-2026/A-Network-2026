# AnetSwap v3.6 — Deploy & Migration Runbook

**Status:** Pre-deploy, awaiting human signing decisions.
**Tracker milestone:** #6 (AnetSwap ownership → multisig + timelock).
**Prepared:** May 28, 2026.

This document is the operator runbook for closing scorecard milestone
#6. It does not require any further code changes; it captures the
exact sequence of human-gated steps from "v3.6 code on `main`" to
"v3.6 contract live on BSC mainnet, frontend re-bound, v3.5 contract
drained and abandoned".

If you are reading this in order to *execute* the deploy, do every
section in order and do not skip the verification gates.

---

## 0. Prerequisites (decisions you must make before §1)

| Role | What it is | What it holds | Recommended custody |
|---|---|---|---|
| `admin` | Multisig that owns every parameter change behind a 48h timelock. | All admin authority. Withdraws fees. | **Gnosis Safe on BSC** (2-of-3 minimum, 3-of-5 ideal). At least one signer on a hardware wallet that has never signed for any other A-Network role. |
| `pauser` | Hot key that can instantly pause the contract in an incident. | Pause only. Cannot unpause, cannot change params, cannot move funds. | **Dedicated hardware wallet** (Ledger / Trezor) held by the on-call engineer. Rotated quarterly via the 48h timelock. |
| `operator` | Backend hot wallet that records L1 credit on processed swaps. | `markProcessed` / `batchMarkProcessed` only. Cannot move funds. | The existing **pi-backend relayer wallet**, with a per-tx gas budget and 24h spending alert on its BNB balance. |
| `feeRecipient` | Address that receives the 1% fee on each inbound swap. | Receives BNB / USDT / USDC fees. | The **same Safe as `admin`**, or a dedicated treasury Safe — never an EOA. Forwardable via 48h timelock. |

**You must produce four checksummed BSC addresses before §1.**

If any role is currently an EOA you control alone, fix that *first*.
The whole point of v3.6 is to retire single-key authority on the entry
side.

---

## 1. Pre-flight verification

From a clean clone of `main` at SHA `15a1920` (or later):

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
```

**Gates:**

- `Compiled 3 Solidity files successfully` and no warnings other than
  unused-parameter notices from MockERC20.
- `70 passing` (33 vault + 37 swap), 0 failing.

If either gate fails, **STOP**. Do not proceed.

Capture the source hashes and compare to `AUDIT_PACKAGE.md §1`:

```bash
shasum -a 256 src/AnetBridgeVault.sol src/AnetSwap.sol src/MockERC20.sol
```

Any mismatch means the working tree drifted and the audit package is
no longer authoritative. Reset to the audited SHA before continuing.

---

## 2. Configure environment

Edit `contracts/.env` (do **not** commit):

```dotenv
# Network
BSC_RPC_URL=https://bsc-dataseed.binance.org
BSCSCAN_API_KEY=<your bscscan key>

# Deployer EOA (gas only — does not retain authority on the contract)
DEPLOYER_PRIVATE_KEY=<hex, no 0x prefix>

# Roles (all four are required; deploy.js warns if any falls back to deployer)
ANET_BRIDGE_ADMIN=0x<Safe address>
ANET_BRIDGE_PAUSER=0x<hardware wallet address>
ANET_BRIDGE_OPERATOR=0x<pi-backend relayer address>
ANET_FEE_RECIPIENT=0x<Safe or treasury address>
```

Make sure `DEPLOYER_PRIVATE_KEY` corresponds to an EOA that holds
**at least 0.05 BNB** for gas. The deployer key has no authority on
the deployed contract — `admin` is set in the constructor.

---

## 3. Deploy v3.6 to BSC mainnet

```bash
cd contracts
npx hardhat run scripts/deploy.js --network bsc
```

`deploy.js` will:

1. Print every role and warn loudly if any of them resolved to the
   deployer EOA. **Abort with Ctrl-C** if you see any such warning.
2. Deploy `AnetSwap(admin, pauser, operator, feeRecipient)`.
3. Print the new contract address and the constructor args (copy both).
4. Auto-verify on BscScan if `BSCSCAN_API_KEY` is set; otherwise print
   the manual verify command.

**Record:**

- New contract address: `0x________________________________`
- Deploy tx hash: `0x________________________________`
- Deployer EOA: `0x________________________________`
- Block number: `__________`

---

## 4. Post-deploy on-chain verification

From BscScan "Read Contract" on the new address:

| View | Expected |
|---|---|
| `admin()` | Your Safe address |
| `pauser()` | Your pauser hardware wallet |
| `operator()` | Your pi-backend relayer |
| `feeRecipient()` | Your treasury address |
| `feeBps()` | `100` |
| `owner()` | Same as `admin()` (compatibility shim) |
| `paused()` | `false` |

If any value is wrong, **do not migrate**. Treat the deploy as failed,
note the contract address as abandoned, and redeploy with correct
constructor args.

---

## 5. Configure supported tokens (two-phase, 48h gap)

USDT and USDC must be added through the timelock. From the Safe
(`admin`):

**Phase 1 — schedule (T+0):**

```bash
TOKEN_SETUP_PHASE=schedule \
ANET_SWAP_ADDRESS=0x<new address> \
npx hardhat run scripts/setup-tokens.js --network bsc
```

This writes `.token-setup-<chainId>.json` with one pending `id` per
token. Commit the file to internal ops storage (not git) so the same
state survives across the 48h gap.

**Wait 48 hours.** During the wait window, the contract is live but
has no whitelisted tokens, so only `swapNativeForAnet` (BNB) works.
That is acceptable for soft-launch.

**Phase 2 — execute (T+48h):**

```bash
TOKEN_SETUP_PHASE=execute \
ANET_SWAP_ADDRESS=0x<new address> \
npx hardhat run scripts/setup-tokens.js --network bsc
```

Each `executeConfigureToken` Safe transaction must be co-signed per
your threshold. The script deletes the state file on success.

---

## 6. Drain & abandon v3.5 contract (`0x1A1AFE5BF1ffDB64aC10958cCe2D06B22Fb47Fb8`)

The v3.5 contract is `Ownable` (single owner). It has no timelock on
withdrawal; `owner()` calls `withdrawNative()` / `withdrawToken()`
directly.

**6.1 Stop new traffic to v3.5.**

- Pause the v3.5 contract via the existing owner key (`pause()`).
- Update frontend (`A-Network-2026/dex.html`, `index.html`, any
  embedded scripts) to point at the new v3.6 address.
- Push the frontend change. Verify the live site loads the new address
  in `data-anet-swap-address` (or equivalent) before unpausing v3.6.

**6.2 Wait for in-flight settlement.**

- Run `getPendingSwaps()` on v3.5. The `processed=false` entries are
  swaps that paid the contract but have not yet been credited on L1.
- Have the operator continue calling `markProcessed` on those entries
  until the list is empty. Do **not** withdraw funds before this.
- L1-side: the operator's existing job should keep crediting the L1
  account for each processed swap as normal.

**6.3 Drain v3.5.**

- `owner()` calls `withdrawNative()` to sweep all BNB to the owner
  address.
- `owner()` calls `withdrawToken(USDT)` and `withdrawToken(USDC)` to
  sweep all stablecoin balances.
- Move each balance from the owner EOA into the new `feeRecipient`
  Safe. This is the legal transfer of accumulated fees onto the v3.6
  governance surface.

**6.4 Abandon v3.5.**

- Do **not** call `transferOwnership` on v3.5. Leaving it owned by the
  old EOA, paused, and drained is acceptable. Renouncing ownership on
  a `_Pausable_` Ownable contract is irreversible and not necessary.
- Add a note to `whitepaper.html` and `AnetSwap_v35.address.txt` (if
  it exists) marking the v3.5 contract as deprecated.

**6.5 Unpause v3.6.**

- Schedule `Unpause` via `scheduleUnpause()` on the Safe (T+0).
- Wait 48 hours.
- Execute `executeUnpause()` from the Safe.

The 48h delay on unpause is intentional and is the point of the
3-role model. If you find yourself impatient and tempted to skip it,
re-read §0 — that impatience is exactly the failure mode this
contract is designed against.

---

## 7. Post-migration acceptance test

From an EOA you control (not admin, not pauser, not operator):

1. `swapNativeForAnet(expectedAnetAmount)` with `msg.value = 0.001 BNB`.
   Expect a `SwapInitiated` event and a non-zero `swapId`.
2. Have the operator wallet call `markProcessed(swapId, l1TxHash)`.
   Expect a `SwapProcessed` event.
3. From a stranger EOA, attempt `markProcessed` — expect revert
   "AnetSwap: not operator".
4. From the pauser EOA, attempt `executeUnpause(...)` — expect revert
   "AnetSwap: not admin".

If all four pass, the contract is correctly bound on-chain and the
role split is enforced.

---

## 8. Tracker update

Once §7 passes:

- Edit `whitepaper.html` scorecard milestone #6 from 🟡 IN PROGRESS
  to ✅ DONE with the v3.6 contract address and deploy tx.
- Update the v3.6 changelog "Deployment & migration" bullet to point
  at the live address.
- Commit: `docs(whitepaper): close tracker milestone #6 — v3.6 AnetSwap live at 0x…`.

---

## 9. Rollback plan

If §4 verification or §7 acceptance test fails:

- The Safe (`admin`) calls `pause()` on the v3.6 contract immediately.
- Revert the frontend pointer back to the v3.5 address.
- Leave v3.5 unpaused so users can continue swapping during triage.
- File an internal incident note with the failing observation.

The v3.6 contract is not destroyable. A failed v3.6 instance is
abandoned the same way v3.5 is in §6.4, and a fresh v3.6 is
redeployed.

---

## 10. Out of scope

- Renouncing `admin` on v3.6. That is scorecard milestone #10's
  vault-side analog applied to swap, and it should not happen until
  v3.6 has at least 6 months of clean operation under multisig.
- Fee-on-transfer token support. Deferred to v3.7.
- Entry-side rolling caps on swap. Deferred to v3.7.

---

## 11. Audit gate (recommended)

The strong recommendation is to **complete an external audit per
`AUDIT_PACKAGE.md` before §3**. The v3.6 code is internally reviewed
and 70/70 test-clean, but it has not been externally validated. The
vault was deployed without an external audit and that is a defensible
one-time choice for an asset that was already partially deployed; the
v3.6 swap deploy does not have the same justification.

If you choose to deploy without an external audit, document the
rationale in the §8 tracker update so the scorecard remains honest.
