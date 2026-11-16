# Whitepaper v4.8 — Technical Verification Appendix

Sealed `.ant` operations can be checked from public block data and the published specifications, without trusting the operator. Building and running the node's own verifier needs the node source, which is not public yet (section 1). This appendix lists the released code, how to verify it, the production evidence gathered at release, and the publication hash.

## 1. Released code

| Component | Repository | Public | Commit | Version |
|---|---|---|---|---|
| Layer 1 node (producer and follower), `.ant` module, SDK | `A-Network-2026/anet-chain` | Not yet | `8af1f55` | node 0.3.0, SDK 0.2.0 |
| Website `domains.html`, ANET Wallet extension, pi-backend | `A-Network-2026/A-Network-2026` | Yes | `0489d2b` | extension 1.1.0 |
| Mobile app | `A-Network-2026/anet-mobile-app` | No | `de2ef74` | 1.0.127+192 |

The owner plans to make the node repository public. Until then, its documentation at node 0.3.0 is published in this folder: [ANT_DOMAINS_SPEC.md](ANT_DOMAINS_SPEC.md) (the `.ant` rules), [ANRC20_SPEC.md](ANRC20_SPEC.md) (§4 defines the `action-v1` signature scheme) and [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md). In the node source, the rule engine is `src/domain.rs` and follower verification is in `src/ledger.rs` (`check_domains`, escrow check in `apply`).

## 2. How to verify

With public data only:

1. **Check every sealed operation.** `GET https://explorer.a-network.net/sync/head` gives `block_count`. Download the chain by position in pages of up to 256 blocks: `GET /blocks?from=0&to=255&position=true`, then `from=256&to=511`, and so on up to `block_count − 1`. For each event whose `event_type` is `AntDomain`, parse `attributes.auth`, the signed envelope (`wallet`, `nonce`, `timestamp`, `chain_id`, `payload`, `signature`, `action_hash`). Rebuild the `action-v1` preimage as in [ANRC20_SPEC.md](ANRC20_SPEC.md) §4, using the payload's `route` as the action, and check `action_hash`. Recover the public key from `signature` and confirm that it derives `wallet`. Confirm that nonces increase for each wallet and action. Then apply the rules in [ANT_DOMAINS_SPEC.md](ANT_DOMAINS_SPEC.md) to the events in block order.
2. **Read the published rules:** `GET https://explorer.a-network.net/network/consensus` → `ant_domains`, and `/network/capabilities` → `native_l1_modules` contains `ant_domains`.
3. **Inspect a name:** `https://explorer.a-network.net/explorer/domains/{name}` or `/domains/name/{name}/history`. Each entry carries the owner's signed authorization (`auth`), which can be checked as in step 1.

With the node source (until the repository is public, this needs access to it):

4. **Run the node's verifier over the whole chain** (Rust 1.88, no database), from a checkout of `anet-chain`:

   ```bash
   cargo run --release -- --verify-peer https://explorer.a-network.net \
     --expect-chain-id anet-private-mainnet-1 --verify-once
   ```

   From 0.3.0 the verifier also replays every `AntDomain` event: signature, nonce, naming, ownership and eligibility rules, the sealed attributes, and the escrow balance. The SDK's `verifyAction` performs the signature check of step 1.
5. **Run a follower** (`docs/NODE_OPERATOR_GUIDE.md`) and compare `GET /domains/name/{name}`, `/domains/reverse/{address}` and `/domains/market` with the producer.
6. **Reproduce the test network:** `PG_BIN=/path/to/postgresql/bin scripts/devnet/multinode-test.sh` (set `DEVNET_SETTLE_AUCTION=1` to wait out a one-hour auction and settle it).

## 3. Publication hash and on-chain attestation

Published files (SHA-256 of the raw bytes):

| File | SHA-256 |
|---|---|
| `whitepaper.html` | `6275ecbb3a74d1e80b145fdba4e1947964dd1bb5fe2359c64341826dd99b5ccf` |
| `whitepaper-v4.8-ant-names.svg` | `71b073bfe2e558e4f5a39dc7f4024215c38e40ddb3fb16540f40bb6ccc8f06f9` |
| `whitepaper-v4.8/WHITEPAPER_v4.8.md` | `35d08f77a07eea9709c3730649b2b82b4f7fbd9ebde3ae1d97d4cfdf86b993d6` |
| `whitepaper-v4.8/WHITEPAPER_v4.8.pdf` | `24a5ed490ea8a5c3fd1c676ad84496b7d61e37f01b1879523618d761e4fd236e` |

The file first published on November 16, 2026 had SHA-256 `a5ecd287a140642f9bce2716c2143c0cbdd439cee6cc08107e4bb30b1aa33744`. It was revised the same day because it linked documentation in the node repository, which is not public, and described the SDK source as published ([change log](CHANGELOG_v4.8.md)). Attest the revised digest above. Neither digest has been sealed on-chain.

Attestation procedure:

1. Done on November 16, 2026: `whitepaper.html` was published and then revised the same day. Anyone can reproduce its digest with `curl -s https://a-network.net/whitepaper.html | shasum -a 256`, as `reserves.html` does.
2. The operator submits `POST /admin/protocol/update` with `{"version":"4.8","title":"A Network .ant Blockchain Domain Name System","document_sha256":"6275ecbb3a74d1e80b145fdba4e1947964dd1bb5fe2359c64341826dd99b5ccf"}` and the admin key. The admin key is never published or committed.
3. Wait for the next block. On an independent follower, find the `ProtocolUpdate` event whose `document_sha256` equals the digest, and record its block height and hash.
4. Anyone can then download `whitepaper.html`, hash it, and compare the result with the sealed event.

Do not describe v4.8 as sealed on-chain until step 3 has been confirmed on a follower node. At publication, no `ProtocolUpdate` event had been sealed for v4.7 either (blocks 39,136–40,335 scanned).

## 4. Evidence at release (November 16, 2026)

**Deployment.** Node 0.3.0 was pushed at 17:12 UTC and served from 17:18:27 UTC; the public RPC returned HTTP 502 between about 17:15 and 17:18. Production resumed at the same tip (height 40,326) and sealed its next block (40,327).

**Independent verification after deployment** (0.3.0 binary, `--verify-peer https://explorer.a-network.net`):

```text
chain verification PASSED: hash chain, signatures and ledger invariants are valid
chain_id=anet-private-mainnet-1 genesis_hash=24f8723fe1ea0b186d28b5574979fdd91236328e6c1c733ae93989389bb9d49b
tip_height=40326 blocks_verified=40334 native_supply_ants=25189021715 tokens=4
```

Native supply is 251.89021715 ANET, unchanged from Version 4.7.

**Production checks (18/18 passed)** with throwaway keys; every write was expected to be refused:
chain ID and genesis unchanged; `ant_domains` in capabilities; published rules (no fees, permanent ownership, reserved `anet.ant` and `wanet.ant`, 10,000 ANTS domain-auction floor); lookup normalizes `DigitalGold` to an available `digitalgold.ant`; reserved name reported; invalid and look-alike Unicode names rejected (400); market readable with escrow equal to open bids (0); wallet without 1,000 sessions refused (400); replay refused (409); name altered after signing refused (401); signature for another chain refused (401); transfer and purchase of an unregistered name refused (400); explorer search redirects `.ant` names (303); explorer name page renders (200); explorer search escapes its query (reflected XSS fixed).

**Existing services after deployment:** `/stats/investor` and `/explorer` 200 in about 0.4 s once the metrics cache warmed (503 for the first minute, as after earlier restarts); accounts, ANRC-20 tokens, DEX pools, validators, session root and consensus all 200. The website `domains.html` was exercised in a browser against production (search, availability, reserved name, look-alike rejection, market). pi-backend returns HTTP 410 for off-chain `.ant` creation.

**Before deployment.**
- `cargo test`: 115 passed, 0 failed.
- `cargo clippy`: no new findings against the pre-existing baseline.
- SDK: 8/8 tests; `npm audit --omit=dev`: 0 vulnerabilities.
- Website: 67/67 tests.
- Mobile: 5/5 tests on a clean checkout of `main` plus this change, analyzer unchanged.
- Multi-node test network: one producer, three followers and two hostile peers. All checks passed, including:
  - every `.ant` operation and refusal;
  - a full one-hour auction settled from escrow;
  - a producer restart that rebuilt identical `.ant` state;
  - the security regressions.
- Compatibility: a node 0.2.4 follower accepted a test chain that carries sealed `.ant` operations, a sale and escrowed bids (12 blocks, same tip as a 0.3.0 follower), confirming that older followers keep working.
- CI on Linux, macOS and Windows: `anet-chain` Actions run 43915860365 (success). The run page becomes visible when the repository is public.

**Security review before release.** An independent review of the `.ant` changes found two issues, both fixed and re-tested before deployment:

| Severity | Issue | Fix |
|---|---|---|
| High | Concurrent signed actions from one wallet could be sealed out of nonce order; followers would have rejected that block permanently. The free "clear primary name" action made this cheap. | The producer re-checks and advances nonces under its state lock (ANRC-20 and `.ant`), rebuilt from sealed history; no-op name operations are rejected |
| Medium | A domain payment could spend ANET already committed to a queued transfer, making the next block unbuildable and halting production. | Payments must leave the payer's queued transfers covered |

The same immediate-debit pattern exists in DEX wrap/swap and bridge burns. It predates this release, is not changed by it, and is reported separately.
