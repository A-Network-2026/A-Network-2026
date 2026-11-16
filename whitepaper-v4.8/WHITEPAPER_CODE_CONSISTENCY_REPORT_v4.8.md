# Whitepaper v4.8 — Code Consistency Report

Each technical claim in the v4.8 section, the code that implements it, and the evidence that it behaves as stated. Paths are in `A-Network-2026/anet-chain` unless noted.

| Claim (v4.8 part) | Implementation | Evidence |
|---|---|---|
| Names: ASCII `a–z 0–9 -`, 1–62 characters, no leading, trailing or double hyphen, optional `.ant`, look-alikes rejected (C) | `src/domain.rs` `normalize_name`; SDK `normalizeDomain`; website `domains.js` `normalizeName`; mobile `ant_names.dart` | Same accept/reject table in the Rust, SDK, website and mobile tests; production probe rejects `bad--name` and a Cyrillic look-alike |
| `anet.ant`, `wanet.ant` reserved (C) | `domain.rs` `RESERVED_NAMES` | Unit test; devnet and production refuse `anet.ant` |
| Registration needs an eligible wallet; duplicates refused (D, N) | `DomainRegistry::prepare` (`register`), `check_eligible`; producer `NodeState::domain_action` (sealed sessions, settlement set, bootstrap seats) | Unit tests; devnet refuses a 999-session wallet and a duplicate; production refuses a wallet without sessions |
| Lifecycle step 3: activation credit or signed transfer in an earlier block (N) | `domain::settlement_evidence`, `NodeState.domain_settled` (updated after sealing), `LedgerVerifier.settled` | Unit test `registration_is_unique_unreserved_and_gated`; ledger test with activated vs. unactivated wallets |
| Every operation signed with `action-v1`; payload must equal the request; strictly increasing nonce (E) | `rpc.rs` `domain_post` → `verify_bound_action`; `SealedActionNonces` checked under the state lock; follower `check_domains` | Devnet: altered name 401, replay 409; production: 401/409 and another chain 401; unit test `sealed_action_nonces_refuse_reordered_or_replayed_authorizations` |
| Owner-only transfer, resolver, list, cancel; no administrator path (E) | `prepare` (`owner_only`); no admin route exists for names | Unit and ledger tests reject a non-owner's signed transfer; devnet refuses non-owner resolver and transfer |
| Producer and followers use one rule engine; followers require identical sealed attributes (B, P) | `domain::apply_sealed` (followers and producer restart), `prepare` + `sealed_event` (producer) | Ledger test rejects tampered attributes; devnet: three followers verified the same operations; restart rebuilt identical state |
| Forward-confirmed reverse resolution; a transfer or sale resets the resolver (G, S) | `DomainRegistry::set_resolver` (`primary.retain`), `reverse`, `Change::Owner` | Unit test `transfer_and_resolver_changes_keep_reverse_records_forward_confirmed`; devnet transfer clears the old reverse record |
| No-op operations refused (P) | `prepare`: same resolver, same primary, clearing a missing primary | Unit test; devnet refuses clearing a primary name that does not exist |
| Fixed sale: exact signed price and listing id; pays the seller (J) | `prepare_market` (`buy`) | Unit test (stale listing id after relisting refused); devnet: exact +50,000 / −50,000 ANTS, second purchase refused |
| Auctions: floor, increments of at least 1 ANTS, escrow, atomic refund, no seller bids, no cancel with a bid, settlement only after the end by the seller or highest bidder (K, L) | `prepare_market` (`bid`, `cancel`, `settle`), `ESCROW_ADDRESS` | Unit tests; devnet refusals for each rule; one-hour devnet auction settled: escrow paid to the seller and name moved to the winner |
| Escrow always equals the open highest bids (O, P) | Follower check in `LedgerVerifier::apply`; producer `/domains/market` reports `escrow_ants` and `open_bids_ants` | Ledger test rejects a short escrow; devnet and production report equal values |
| Payments cannot spend funds committed to queued transfers (P) | `NodeState::mempool_debits` in `domain_action` (shared with `queue_transaction`) | Devnet: refused with "beyond your queued transfers", and blocks continued |
| No fees; no ANET created or destroyed (M, O) | No fee code path; payments move existing balances; follower supply rule unchanged | Published `registration_fee_ants: 0`, `marketplace_commission_ants: 0`; supply 251.89021715 ANET unchanged after deployment |
| Deadlines use the sealed event time at millisecond precision (O) | `domain::now_ms`, `sealed_event`, `apply_sealed` (time equality) | Unit test rejects sub-millisecond time; devnet auction settlement |
| Block format and hash unchanged; older nodes accept blocks (B, U) | Only a new event type; `Block` and `BlockHashPayload` untouched | Production resumed at the same tip; full-chain verification passed with 0.3.0 |
| Explorer: search, name page, history with confirmations, signed-action hashes; reflected XSS fixed (Q, P) | `rpc.rs` `explorer_search`, `explorer_domain`, `domain_history_row`, `escape_html` | Production probe: 303 redirect, page 200, query escaped |
| Wallets resolve, confirm, re-resolve and sign to the address (H) | Extension `anet-extension/popup.js` `doSend`; mobile `main.dart` send dialog; SDK `resolveDomain` | Devnet "ANET sent to a .ant name reaches the resolved wallet"; code review of both flows |
| Extension used a timestamp nonce (correction 3) | `popup.js` now reads `next_nonce` | The node requires `nonce == next_nonce` (`state.rs` `queue_transaction`) |
| pi-backend no longer creates `.ant` names (I) | `A-Network-2026/pi-backend/src/server.js` `rejectOffChainAntName`, `/api/nft/domains/create` | Production returns HTTP 410 |

## Statements that are deliberately limited

- "No name is registered yet" and "registration is not yet possible for any user": on November 16, 2026 the network had 0 organic wallets with 1,000 completed sessions (`/validators`: `organic_count: 0`). Successful registrations, transfers, sales and auctions were therefore demonstrated on the test network, not on mainnet.
- Mobile 1.0.127+192 is committed; it is not described as released in the stores.
- Followers do not check the bootstrap-seat exclusion, and they accept per-account balances as sealed (part T).
