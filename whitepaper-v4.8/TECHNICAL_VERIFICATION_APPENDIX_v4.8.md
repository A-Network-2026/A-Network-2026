# Whitepaper v4.8 — Technical Verification Appendix

Everything in the v4.8 section can be checked without trusting the operator. This appendix lists the released code, how to verify it, the production evidence gathered at release, and the publication hash.

## 1. Released code

| Component | Repository | Commit | Version |
|---|---|---|---|
| Layer 1 node (producer and follower), `.ant` module, SDK | `A-Network-2026/anet-chain` | `8af1f55` | node 0.3.0, SDK 0.2.0 |
| Website `domains.html`, ANET Wallet extension, pi-backend | `A-Network-2026/A-Network-2026` | `0489d2b` | extension 1.1.0 |
| Mobile app | `A-Network-2026/anet-mobile-app` | `de2ef74` | 1.0.127+192 |

Specification: `anet-chain/docs/ANT_DOMAINS_SPEC.md`. Rule engine: `anet-chain/src/domain.rs`. Follower verification: `anet-chain/src/ledger.rs` (`check_domains`, escrow check in `apply`).

## 2. How to verify

1. **Run an independent check of the whole chain** (Rust 1.88, no database):

   ```bash
   git clone https://github.com/A-Network-2026/anet-chain && cd anet-chain
   cargo run --release -- --verify-peer https://explorer.a-network.net \
     --expect-chain-id anet-private-mainnet-1 --verify-once
   ```

   From 0.3.0 the verifier also replays every `AntDomain` event: signature, nonce, naming, ownership and eligibility rules, the sealed attributes, and the escrow balance.
2. **Run a follower** (`docs/NODE_OPERATOR_GUIDE.md`) and compare `GET /domains/name/{name}`, `/domains/reverse/{address}` and `/domains/market` with the producer.
3. **Read the published rules:** `GET https://explorer.a-network.net/network/consensus` → `ant_domains`, and `/network/capabilities` → `native_l1_modules` contains `ant_domains`.
4. **Inspect a name:** `https://explorer.a-network.net/explorer/domains/{name}` or `/domains/name/{name}/history`; each entry carries the owner's signed authorization (`auth`), which `verifyAction` in the SDK checks.
5. **Reproduce the test network:** `PG_BIN=/path/to/postgresql/bin scripts/devnet/multinode-test.sh` (set `DEVNET_SETTLE_AUCTION=1` to wait out a one-hour auction and settle it).

## 3. Publication hash and on-chain attestation

Published files (SHA-256 of the raw bytes):

| File | SHA-256 |
|---|---|
| `whitepaper.html` | `a5ecd287a140642f9bce2716c2143c0cbdd439cee6cc08107e4bb30b1aa33744` |
| `whitepaper-v4.8-ant-names.svg` | `71b073bfe2e558e4f5a39dc7f4024215c38e40ddb3fb16540f40bb6ccc8f06f9` |
| `whitepaper-v4.8/WHITEPAPER_v4.8.md` | `8e4b723ff3e3e9628260ad7f177686524ffbf29df15aa027cb0dbe6aab39b6b2` |
| `whitepaper-v4.8/WHITEPAPER_v4.8.pdf` | `1c0ef6e28651088072495d251175a5ab1a2eae3ad13d80e1f6b68f53364df0d1` |

Attestation procedure:

1. Done on November 16, 2026: `whitepaper.html` was published. Anyone can reproduce its digest with `curl -s https://a-network.net/whitepaper.html | shasum -a 256`, as `reserves.html` does.
2. The operator submits `POST /admin/protocol/update` with `{"version":"4.8","title":"A Network .ant Blockchain Domain Name System","document_sha256":"a5ecd287a140642f9bce2716c2143c0cbdd439cee6cc08107e4bb30b1aa33744"}` and the admin key. The admin key is never published or committed.
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
- CI on Linux, macOS and Windows: <https://github.com/A-Network-2026/anet-chain/actions/runs/43915860365> (success).

**Security review before release.** An independent review of the `.ant` changes found two issues, both fixed and re-tested before deployment:

| Severity | Issue | Fix |
|---|---|---|
| High | Concurrent signed actions from one wallet could be sealed out of nonce order; followers would have rejected that block permanently. The free "clear primary name" action made this cheap. | The producer re-checks and advances nonces under its state lock (ANRC-20 and `.ant`), rebuilt from sealed history; no-op name operations are rejected |
| Medium | A domain payment could spend ANET already committed to a queued transfer, making the next block unbuildable and halting production. | Payments must leave the payer's queued transfers covered |

The same immediate-debit pattern exists in DEX wrap/swap and bridge burns. It predates this release, is not changed by it, and is reported separately.
