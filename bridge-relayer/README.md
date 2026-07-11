# ANET multi-chain bridge relayer

The off-chain coordination layer for the ANET mint/burn gateway. It connects the
**L1 hub** (native ANET, canonical supply) to the **EVM spoke chains** (Ethereum,
BSC, …) running [`AnetMintBurnPortal`](../contracts/src/AnetMintBurnPortal.sol) +
[`WrappedANET`](../contracts/src/WrappedANET.sol).

> **Status: pre-audit scaffold.** The EVM side (event scanning, EIP-712
> attestation, aggregation, `bridgeIn` submission, reconciliation) is complete
> and unit-tested. The L1-hub endpoints it calls (`/bridge/x/*`) are implemented
> in the L1 phase (see `src/l1.js` for the exact interface). Do **not** run
> against mainnet funds before the external audit.

## Flows

```
L1 → spoke (bridge-in / mint)
  user locks native ANET on L1
    → signer daemons attest the lock (EIP-712 over BridgeIn)
    → submitter aggregates M-of-N sigs → portal.bridgeIn() mints wANET on the spoke

spoke → L1 (bridge-out / unlock)
  user burns wANET on the spoke  (portal.bridgeOut → BridgeOut event)
    → submitter relays it to L1 /bridge/x/mint-credit
    → L1 verifies M-of-N + dedup → credits (unlocks) native ANET
```

Invariant enforced end-to-end and monitored continuously:
`Σ wANET(all spokes) == ANET locked on L1 ≤ 21,000,000`.

## Roles (set `ROLE`)

| Role | What it does | Key |
|---|---|---|
| `signer` | Independent M-of-N daemon. Watches L1 locks, signs the bridgeIn attestation, posts its signature to L1. **Cannot move funds alone.** | one signer key |
| `submitter` | Aggregates ≥ threshold attestations → `bridgeIn` on the spoke; relays spoke `BridgeOut` → L1 unlock. Pays gas, **no signing authority.** | a gas key |
| `reconciler` | Read-only supply-integrity monitor (default). | none |

Run 3+ `signer` daemons on independent infra/keys for a real M-of-N. The
`submitter` holds no signing power — a stuck submitter can be replaced by anyone
who can read the attestations and pay gas.

## Setup

```bash
cd bridge-relayer
npm install
cp .env.example .env   # fill in RPCs, portal/wANET addresses, chain ids, keys
npm test               # unit tests for the attestation logic (no chain needed)

ROLE=reconciler npm start   # or ROLE=signer / ROLE=submitter
```

Add a new spoke chain by appending its id to `SPOKES` and adding a
`SPOKE_<ID>_*` env block — no code changes.

## Security notes

- Attestations are EIP-712 bound to `(portal address, spoke chainId)` so a
  signature can never be replayed on another chain or contract.
- `messageId = keccak(srcChainId, srcTxRef, index)` — one L1 lock ⇒ one mint;
  the portal's on-chain `mintConsumed` dedup makes double-mint impossible.
- Signers hold exactly one key each and only ever sign; the submitter cannot
  forge the M-of-N threshold.
