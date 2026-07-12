# ANET Bridge — Pre-Audit Security Review

Prepared for external auditors and the community. This is an honest map of the
ANET canonical-L1 ⇆ BSC/Ethereum/Solana mint-burn gateway: what it guarantees,
how, and — importantly — what is **not yet done** and must be resolved before it
holds real value.

Status (2026-07-12): **Proven live on BSC testnet** (deploy + M-of-N mint +
replay-block + burn + supply-invariant, real txs). **Not audited. Not on mainnet.
Credit direction disabled.**

---

## 1. Trust model

- **M-of-N relayer signer set.** Minting on any spoke requires ≥ threshold
  independent secp256k1 signatures over an EIP-712 attestation. No single signer
  can mint. (Testnet used 2-of-3; **mainnet should use ≥ 3-of-5 with signers on
  independent infra/operators.**)
- **Admin = Gnosis Safe behind a 48h timelock** (EVM). Pauser is a **separate
  cold key** that can pause instantly without timelock.
- **The bridge is the only minter/burner** of wANET; the token has no other mint
  path and a hard 21,000,000 cap.

## 2. Core invariant

> Σ wANET(all spokes) == ANET locked on the L1 hub ≤ 21,000,000

wANET is minted 1:1 only against ANET locked on L1, and burned 1:1 on the way
back. The `reconciler` role continuously checks this and alerts on violation.

## 3. Controls in place (per component)

**WrappedANET (EVM):** onlyBridge `mint`/`burnFrom`; 21M hard cap enforced on
mint; one-time `setInitialBridge` (genesis wiring, only while supply == 0); 48h
timelocked bridge rotation; 2-step admin transfer.

**AnetMintBurnPortal (EVM):**
- `bridgeIn` mints only on M-of-N EIP-712 signatures over a unique `messageId`.
- **Replay:** `messageId` consumed-once mapping.
- **Signature hygiene:** EIP-2 low-s enforced; signers must be strictly
  ascending + unique (dedup); domain binds `chainId` + `verifyingContract` so a
  signature can never be replayed on another chain or contract.
- **Caps:** per-tx, per-recipient rolling-24h, and global rolling-24h mint caps.
- **Pause** via separate pauser; **48h timelock + 14d grace** on admin params.
- `bridgeOut` burns the caller's wANET and emits `BridgeOut` (permissionless).
- Views: `reconciliation()` (spokeSupply, mintedIn, burnedOut), `backingRequired()`.

**Solana anet_portal:** same M-of-N model verified **on-chain** with
`secp256k1_recover` + `keccak` over a Solana-specific EIP-712 struct (recipient =
32-byte pubkey, amount = 8-dec ANTS); replay via a per-`messageId` receipt PDA;
per-tx + global rolling-24h caps; 21M cap; pause; 2-step admin.

**Relayer:** roles are least-privilege — `signer` holds one key and can only
attest; `submitter` pays gas and has no signing authority; `reconciler` is
read-only. Off-chain attestation code (`attest.js`, `attest-solana.js`,
`l1-attest.js`) is unit-tested to **byte-match** the on-chain verifiers.

**L1 node:** the spoke→L1 credit endpoint (`/bridge/x/mint-credit`) is gated by
`ANET_PORTAL_CREDIT_ENABLED` (default OFF), requires an M-of-N native-ANET
attestation bound to the exact (chain, out_id, amount, recipient), and dedups by
(spoke_chain_id, out_id).

## 4. Known limitations — MUST address before mainnet

1. **No external audit yet.** This document exists to enable one.
2. **Solana program:** no on-chain timelock on admin param changes, and no
   on-chain per-recipient cap (only per-tx + global). Add both before mainnet.
3. **Solana digest parity is unverified on-chain** — the EIP-712 construction is
   standard but has only been proven in JS + by construction; verify with a
   devnet round-trip.
4. **Credit direction (spoke→L1) is unaudited** and stays OFF until reviewed.
5. **Threshold + signer independence:** raise threshold and distribute signer
   keys across independent operators/HSMs for mainnet.
6. **No automatic halt on invariant breach** — the reconciler alerts but does not
   pause; consider an automated pause trigger.
7. **Solana program id / EIP-712 domain values** must be finalized via
   `anchor keys sync` + recorded before signer configuration.

## 5. Recommended audit scope

- `contracts/src/WrappedANET.sol`, `contracts/src/AnetMintBurnPortal.sol`
- `solana/programs/anet_portal/src/lib.rs`
- `bridge-relayer/src/{attest,attest-solana,l1-attest,evm,l1,reconcile,index}.js`
- L1 node: `anet-chain/src/{rpc,db,transaction}.rs` (bridge + action-signing paths)

## 6. Launch gate (do not skip)

1. Full testnet/devnet round-trip on every spoke (EVM done on BSC testnet).
2. External audit; fix findings; re-test.
3. Mainnet deploy with Safes + high-threshold signer set.
4. Enable `ANET_PORTAL_CREDIT_ENABLED` **only after** 1–3.

Nothing that mints real value should go live before this gate is cleared. That
protects the people this is being built for.
