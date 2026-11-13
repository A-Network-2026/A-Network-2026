# Whitepaper v4.7 — Technical Verification Appendix

All results below were produced on November 13, 2026 on macOS 26.5 (Apple silicon) with Rust 1.88.0 (pinned) and Node.js 26. Production was accessed read-only, except for the refused requests of row 17.

## 1. Software under test

| Item | Version / identity |
|---|---|
| Node (`anet-chain`) | 0.2.0 (`07ebd43`, deployed 17:27 UTC) and 0.2.1 (`9d0bfe1`, deployed 17:41 UTC). Local macOS arm64 release binaries: 0.2.0 `f8ce1e4864fa378811ff9ac3c8d08988dcfdbc876cd8116f183ca55dfc10726e`, 0.2.1 `be9e7aaa83c98b8aa19ea8cc2542ae09d254f84d0e7580f381814dd4a50e922e` |
| TypeScript SDK | `@a-network/anet-sdk` 0.1.0 (`sdk/typescript`) |
| Production chain | `anet-private-mainnet-1`, block 0 `24f8723fe1ea0b186d28b5574979fdd91236328e6c1c733ae93989389bb9d49b` |

## 2. Results

| # | Check | Command | Result |
|---|---|---|---|
| 1 | Baseline tests before changes | `cargo test --release` at `c4c4f3a` | 97 passed |
| 2 | Node tests, release 0.2.0 | `cargo test --release --locked` | 106 passed, 0 failed |
| 3 | Lints | `cargo clippy --all-targets`, compared with baseline | 0 new findings; the 27 baseline findings are style lints in unchanged code |
| 4 | Dependency audit, node | `cargo audit` | 14 vulnerabilities before, 0 after; 2 "unmaintained" warnings (`fxhash`, `instant`, via `sled`) |
| 5 | SDK tests | `npm test` | 6 passed, 0 failed; strict `tsc` type check clean; `npm audit` 0 |
| 6 | Cross-language signatures | `signatures_match_the_typescript_sdk_test_vector` (Rust) and `sdk.test.ts` | Identical address `ANET7BD9723DB3CE4D6BFF7E02F4DEE5B0DCE36C`, action hash `1fee7465…e931`, signature `1af9b8bc…be00`, transfer hash `6d67a012…5ebe` |
| 7 | Full production audit from scratch | `anet-private-mainnet --verify-peer https://explorer.a-network.net --expect-chain-id anet-private-mainnet-1 --verify-once` | PASSED: 39,609 blocks, tip height 39,601, 10 transactions, native supply 25,189,021,715 ANTS, legacy issuance 25,189,021,715, activation 0, 4 tokens (1 min 42 s). Repeated with the final binary: PASSED at 39,613 blocks, tip height 39,605 (1 min 40 s) |
| 8 | Follower restart re-verification | `--follow-peer … --follower-store` on an existing replica | All stored blocks re-verified at startup; resumed at tip |
| 9 | Supply reconciliation | Follower `/node/status` vs producer `/stats/investor` at height 39,601 | Accounts 23,959,021,715 ANTS on both, exact |
| 10 | Second implementation | Independent Python canonical-JSON hasher over the replica | All 37,731 v4 block hashes and their non-empty state roots reproduced |
| 11 | Multi-node network | `scripts/devnet/multinode-test.sh` | 0.2.0: 20/20 in each of 4 consecutive runs. 0.2.1: 21/21, including the new activation check |
| 12 | Web2 backend (`rmp-site/backend`) | `npm audit fix` (non-breaking), `npm test` | Non-breaking dependency updates and a hardening change with a regression test; 64/64 tests pass. Deployment of the Web2 service is an operator action |
| 13 | Continuous integration | `node-ci.yml` | 0.2.0 and 0.2.1: Linux, macOS and Windows build and test, and SDK test, build and audit, all passed |
| 14 | Post-deployment audit of production | `--verify-peer` after each deployment | 0.2.0: PASSED, 39,615 blocks. 0.2.1: PASSED, 39,618 blocks. The chain resumed from the same tip after each restart (`de6e4657…`, `72d7913c…`) |
| 15 | Activation rule live | `GET /network/consensus` | `issuance.activation_credit` = `web2_ledger_balance_following_session_halving_schedule` |
| 16 | Audit of production at publication | Row 7 command, node 0.2.1 | PASSED: 39,623 blocks, tip height 39,615, 10 transactions, native supply 25,189,021,715 ANTS, legacy issuance 25,189,021,715, activation 0, 4 tokens (1 min 41 s) |
| 17 | ANRC-20 on production, through the SDK | `AnetClient` against `https://explorer.a-network.net` with a new, unfunded key | 18/18. Registry read: `CJ`, `CJC`, `DG` and the internal `WANET` entry, each matching its single-token view. Refused as specified: amount altered after signing (401), another chain ID (401), a forged signer (401), creation below 1,000 sessions (400), a replayed authorization (409), minting a non-mintable token by a non-owner (400), a transfer beyond balance (400), creating `WANET` (400). Registry unchanged afterwards |

### Multi-node checks (row 11)

The test starts one producer on a throwaway PostgreSQL. Follower F1 follows the producer, F2 follows F1, and F3 follows F1 and F2. Each follower has a separate store and port. The checks are:

1. All nodes agree on chain ID, genesis and tip.
2. An eligible miner creates an ANRC-20 token.
3. Token supply equals initial supply plus minted amounts.
4. A 999-session wallet cannot create a token.
5. A non-owner cannot mint.
6. `WANET` cannot be created.
7. A request whose amount was altered after signing is refused (401).
8. A replayed authorization is refused (409).
9. An overdraft is refused.
10. ANET cannot be sent to an ineligible wallet.
11. A native transfer is accepted.
12. Followers converge after the operations.
13. Every follower balance equals the producer's.
14. Ledger reports are identical on all followers.
15. All native ANET comes from sealed activation, and every token operation is signed.
16. A stopped follower restarts from its store and catches up.
17. When a peer goes down, followers fail over to discovered peers.
18. A tampered block is rejected.
19. A fully re-hashed chain that mints 1,000 ANET is rejected.
20. A node with one hostile and one honest peer follows the honest chain.

Release 0.2.1 adds a 21st check: activation credits the Web2 ledger balance.

### Activation rule (decided)

On the devnet with 0.2.0, a wallet whose Web2 balance was 2.62144 ANET for 1,000 sessions (262,144 ANTS per session) was activated with 48.82812 ANET (1,000 × 4,882,812, the launch-era rate). The owner decided that activation credits the Web2 balance. With 0.2.1 the same wallet is activated with exactly 2.62144 ANET. No production wallet had been activated under the old rule.

## 3. Not verified in this cycle

- Successful ANRC-20 operations on mainnet. They require the key of an eligible wallet; they were verified on the devnet (row 11), and production was probed with refused operations only (row 17). No mainnet token operation has occurred since sealing went live, so followers still report 0 authenticated operations.
- Bit-for-bit reproducibility of release binaries.
- An independent external security audit.
- Real multi-operator decentralization. A local multi-node environment does not prove it.

## 4. Publication hash and on-chain attestation

Published files (SHA-256 of the raw bytes):

| File | SHA-256 |
|---|---|
| `whitepaper.html` | `3b2ea5f9368dc052eb61676017bf6c8e840c36f73e02532ed3e85a8b0b16f1ba` |
| `whitepaper-v4.7-architecture.svg` | `3dce5863256f7e16755a377811b726f4cfc434f87c49063baf56cadf7c871e7b` |
| `whitepaper-v4.7/WHITEPAPER_v4.7.md` | `214e5e90f951ae170ba84a980e5d6c2bbdb6ea9b123cb5084db401df5fd198f4` |
| `whitepaper-v4.7/WHITEPAPER_v4.7.pdf` | `42239d825ca345cc02b5458031cc49f79a91a8b7fb39d7222bf0910e3a9cbdba` |

Attestation procedure:

1. Done on November 13, 2026: `whitepaper.html` was published. Anyone can reproduce its digest with `curl -s https://a-network.net/whitepaper.html | shasum -a 256`, as `reserves.html` does.
2. With node 0.2.0 or later running (live since November 13, 2026), the operator submits `POST /admin/protocol/update` with `{"version":"4.7","title":"ANRC-20 and Open Network Infrastructure","document_sha256":"3b2ea5f9368dc052eb61676017bf6c8e840c36f73e02532ed3e85a8b0b16f1ba"}` and the admin key. The admin key is never published or committed.
3. Wait for the next block. On an independent follower, find the `ProtocolUpdate` event whose `document_sha256` equals the digest, and record its block height and hash in the Decentralization Status Tracker.
4. Anyone can then download `whitepaper.html`, hash it, and compare the result with the sealed event.

Do not describe v4.7 as sealed on-chain until step 3 has been confirmed on a follower node.
