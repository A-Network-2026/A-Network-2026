# ANET Multi-Chain Bridge — Production Launch

The complete, ordered go-live for the ANET canonical L1 ⇆ BSC / Ethereum / Solana
mint-burn gateway. Single canonical supply (21,000,000), strict 1:1 lock/mint &
burn/unlock, M-of-N attestation, replay protection, rolling caps, supply
reconciliation.

> **Status of the code (all committed):**
> - Contracts: **105 tests passing** (incl. end-to-end relayer↔contract proof).
> - Relayer: **21 tests passing** (EVM + Solana + native-ANET credit).
> - Deploy script: local dry-run validated.
> - Solana Anchor program: written; compiles with `anchor build` (not yet built).
>
> **Not done — and required before mainnet:** an independent external audit, and
> a full testnet/devnet round-trip. The spoke→L1 credit direction stays gated
> OFF (`ANET_PORTAL_CREDIT_ENABLED`) until both are complete.

---

## Phase 0 — Prerequisites

- Gnosis **Safe** for `PORTAL_ADMIN` and one for `WANET_ADMIN` (can be the same Safe).
- A **separate cold key** for `PORTAL_PAUSER`.
- **3 independent relayer operator keys** (M-of-N, threshold 2). Each is one
  secp256k1 key that yields both an EVM address (spoke attestations) and an ANET
  address (L1 credits).
- Funded deployer keys **per network** (fresh — never reuse across chains).
- RPC endpoints (Ankr/Infura/Alchemy) for each spoke.

---

## Phase 1 — Testnet round-trip (do this first, no real value)

```bash
# 1. EVM testnets
cd contracts
cp deploy.testnet.env.example .env         # fill in fresh TESTNET keys + params
npm run deploy:mintburn:bsc-testnet        # -> prints WrappedANET + Portal addresses
npm run deploy:mintburn:sepolia
# Each Safe then calls wANET.acceptAdmin() on its chain.

# 2. Solana devnet
cd ../solana
anchor build && anchor keys sync           # writes the real program id everywhere
anchor deploy --provider.cluster devnet
# initialize() the portal (creates the 8-dec SPL wANET; records signers/caps/domain)

# 3. Relayer
cd ../bridge-relayer
npm ci
cp .env.example .env                        # fill portal/wANET addresses + signer keys
npm run reconciler                          # verify Σ wANET == ANET locked on L1
# In separate processes / hosts, one per operator:
npm run signer                              # M-of-N attesters
npm run submitter                           # aggregates + mints (pays gas)
npm run solana                              # Solana spoke (if SOLANA_ENABLED=1)
```

**Prove the loop:** lock native ANET on L1 → confirm wANET minted on the spoke →
burn wANET (bridgeOut) → confirm native ANET credited back on L1 → `reconciler`
reports the invariant holds. Repeat on each spoke.

---

## Phase 2 — External audit

Scope: `contracts/src/{WrappedANET,AnetMintBurnPortal}.sol`, the Solana
`anet_portal` program, and the relayer attestation modules
(`attest.js`, `attest-solana.js`, `l1-attest.js`). Fix findings, re-test, re-deploy
to testnet, re-run Phase 1.

---

## Phase 3 — Mainnet

```bash
cd contracts
cp deploy.env.example .env                  # MAINNET Safes + funded deployer keys
npm run deploy:mintburn:bsc
npm run deploy:mintburn:eth
# Safes call wANET.acceptAdmin(). Verify contracts on the explorers (commands are
# printed by the deploy script).

cd ../solana
anchor deploy --provider.cluster mainnet
```

- Point the relayer `.env` at the mainnet portals; start `reconciler` first, then
  `signer` × N, then `submitter` / `solana`.
- On the L1 node, enable the credit direction **only after** audit sign-off:
  `ANET_PORTAL_CREDIT_ENABLED=1`, `ANET_PORTAL_SIGNERS=<ANET addrs>`,
  `ANET_PORTAL_THRESHOLD=2`.

---

## Safety invariants (never violate)

1. **Never** enable `ANET_PORTAL_CREDIT_ENABLED` before audit + testnet round-trip.
2. Admin = Safe, behind the 48h timelock. Pauser = separate cold key.
3. wANET hard cap is 21,000,000; `messageId`/receipt dedup makes double-mint impossible.
4. Start `reconciler` on every environment; page on `SUPPLY INVARIANT VIOLATED`.
5. Deployer keys are per-chain and single-use; rotate signer keys via the timelock.

---

## Live in parallel (no mint authority — safe today)

- **DEX** — already live (PancakeSwap / Uniswap / Jupiter).
- **ANET Wallet extension** — submit to the Chrome Web Store.
- **L1 node** — Render redeploy; migrations are additive, credit stays OFF.
