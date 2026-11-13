# Whitepaper-to-Code Consistency Report (v4.7)

Each statement in v4.7 that falls within this release's scope, plus the earlier statements it touches, was compared with the source of `anet-chain` (releases 0.2.0 and 0.2.1), `rmp-site/backend` and the live production chain on November 13, 2026.

**Status key**

- **Consistent**: matches code or live data.
- **Corrected**: an earlier statement was wrong; v4.7 records the correction.
- **Open**: editorial work remains.

## Tokenomics and supply

| Statement | Evidence | Status |
|---|---|---|
| Maximum supply 21,000,000 ANET; 1 ANET = 100,000,000 ANTS | `activation.rs` `MAX_SUPPLY_ANET`, `ANTS_PER_ANET`; `/network/consensus` | Consistent |
| Launch reward 4,882,812 ANTS; 500,000-session tranche; post-launch 262,144 halving every 4,000,000,000 sessions; stage 19 | `activation.rs`; Web2 `miningEngine.js` (revision `2026-06-15-bitcoin-halving-21m`); `/stats/investor` reports 262,144 per session | Consistent |
| Activation credits follow the schedule (Section 7) | Before 0.2.1, `db::load_genesis_accounts` credited `max(stored, sessions × 4,882,812)` (devnet: 2.62 → 48.83 ANET). The owner decided to credit the Web2 balance; 0.2.1 is live and `/network/consensus` publishes `activation_credit` | Consistent (resolved 2026-11-13) |
| Six-hour sessions | Web2 `SESSION_DURATION_HOURS = 6`; node `DEFAULT_WORKER_SESSION_SECONDS = 21600` | Consistent |
| 1,000-session eligibility | `MIN_SESSIONS_FOR_ANET = 1000`; Web2 `is_eligible`; devnet refusals | Consistent |
| Vesting: 6-month cliff, then 25% every 3 months | `activation.rs` vesting constants | Consistent |
| Native supply on L1 is 251.89021715 ANET, of which 239.59021715 is in accounts | Follower replay and producer `/stats/investor` at height 39,601 | Consistent (exact) |
| No native ANET has entered L1 through mining activation | 0 `SessionActivation` events; `activated_supply_ants` = 0 in all blocks | Consistent |
| Legacy issuance itemized (bridge credits, bootstrap pool, test transfers) | Follower `/node/status` `legacy_issuance` | Consistent |
| No premine, development, validator or computer allocation of native ANET | No credit path other than activation; follower strict rule after position 4,777 | Consistent for native ANET. The BEP-20 market token's pre-mint and the founder custody disclosures (v4.4 and the Tracker) concern a separate supply domain and are unchanged. |
| One-way bridge; inbound credit route answers 410 | `one_way_bridge_in_active()` is hard-wired with a test; `rpc.rs` returns `StatusCode::GONE` | Consistent |

## ANRC-20

| Statement | Evidence | Status |
|---|---|---|
| Identity rules, creator gate, owner-only mint, no burn, no fee, `WANET` reserved | `state.rs` `anrc20_*`, `dex::normalize_token_symbol`; devnet checks 2–9 | Consistent |
| Signed authorization required; nonce strictly increasing per wallet and action | `verify_bound_action`, `record_action_authorization_nonce`; devnet 401/409; production refuses altered and wrong-chain requests with 401 | Consistent |
| Authorizations sealed in blocks; followers re-verify them | `sealed_token_event`, `ledger.rs`; devnet: 5 authenticated, 0 unauthenticated; live since 0.2.0 (no mainnet token operation since) | Consistent |
| `CJ`, `CJC`, `DG` predate sealing | Follower: `token_ops_unauthenticated_legacy` = 3 | Consistent |
| Token supply and balances conserved in every block | Follower replay of every production block | Consistent |

## Nodes and verification

| Statement | Evidence | Status |
|---|---|---|
| Followers verify hash, roots, links, signatures and ledger rules; reject invalid peers | `sync.rs`, `follower.rs`, `ledger.rs`; tests; devnet hostile-peer checks; source published | Consistent |
| Restart re-verifies the store; corruption is dropped and re-synced | `replay_local`; unit test `store_restarts_at_verified_tip_and_drops_gaps_and_corruption` | Consistent |
| macOS, Linux and Windows | CI build and test passed on all three for 0.2.0 and 0.2.1 | Consistent |
| Followers cannot produce blocks or mint | No producer or credit code path in follower mode; status reports `can_mint_native_anet: false` | Consistent |
| `/network/consensus` lists the verifier's checks | Corrected list in 0.2.0, now served by production (earlier list claimed TPoW re-verification) | Corrected |

## Governance, decentralization and records

| Statement | Evidence | Status |
|---|---|---|
| Single operator producer; validators do not sign blocks | `validator_votes` empty in every production block | Consistent |
| Section 10 fee example ("every miner with a completed session"); v4.3 "validators seal every transfer" | Fees go to `block.miners`, the validator seats: two bootstrap addresses received all 10,000 ANTS of fees | Corrected in v4.7 |
| v4.2: full document digest sealed on-chain for each version | Code sealed a 16-character prefix; no version was ever sealed. 0.2.0 (live) seals the full digest | Corrected |
| Decentralization Status Tracker dated May 28, 2026 | Not updated since; still lists the multi-validator set as in progress | Consistent with code, but stale (editorial) |
| Seed nodes | The published seed was 102 blocks behind before the November 13 restarts and, as a standby, will lag again; the default seed host does not resolve | Disclosed (operational) |
| Web2 → Web3 → Web4 framing | Adopted by the owner on 2026-11-13. Sections 4, 9 and 10 and `web4.html` still call the live L1 "Web4" | Open (editorial alignment in a later revision) |

## Cross-section contradictions found

1. Section 10's fee example contradicts the v4.5 fee panel. Recorded as a correction in v4.7.
2. v4.2's attestation description contradicts the node behavior. Recorded as a correction.
3. Web3/Web4 naming differs between Sections 4, 9 and 10 and the v4.7 framing the owner adopted. The older titles will be aligned in a later editorial revision.

No contradiction was found in supply figures, the cap, the denomination, eligibility, vesting or bridge policy.

## Version numbers and dates

v4.7 follows v4.6 (November 1, 2026) and v4.5 (October 23, 2026). Node releases 0.2.0 and 0.2.1; SDK 0.1.0; published November 13, 2026. Supply figures are stated at production height 39,601.

## Legal and economic disclosures

The Section 15 regulatory framework and the existing disclosures are unchanged: no profit share, dividend or promised return, and no guarantee of future features or outcomes. v4.7 adds no return, yield or price claim, and no sale, distribution, liquidity incentive or yield program. No separate legal review of this revision was performed.
