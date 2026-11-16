> Published copy of `anet-chain/docs/ANT_DOMAINS_SPEC.md` at node release 0.3.0 (commit `8af1f55`), included with whitepaper v4.8 because the node repository is not public yet.

# `.ant` Domain Names (native module)

**Status:** implemented in node release `0.3.0` on the A Network Layer 1. Enforcement starts at the first block that contains an `AntDomain` event (§9).

`.ant` names are a fixed-function naming module built into the Layer 1 node, like ANRC-20. There is no virtual machine and no user code. The producer applies every rule and every follower node re-checks it.

`.ant` is a **blockchain naming system**. It is not an ICANN top-level domain: browsers and DNS resolvers do not resolve `.ant` names. A name resolves only through the A Network RPC (`/domains/...`) and through wallets and explorers that use it.

## 1. Names

| Rule | Value |
|---|---|
| Canonical form | `<label>.ant`, stored lowercase |
| Label | 1–62 characters from `a–z`, `0–9`, `-` |
| Hyphens | Not first, not last, never two in a row (this also rules out `xn--` punycode) |
| Input | Trimmed and ASCII-lowercased; the `.ant` suffix is optional |
| Rejected | Any non-ASCII character (blocks look-alike Unicode names), dots inside the label, empty names |
| Reserved | `anet.ant`, `wanet.ant` (cannot be registered) |

A name is globally unique. Ownership is permanent: there is no expiry and no renewal.

## 2. Records

| Field | Meaning |
|---|---|
| `owner` | Wallet that controls the name |
| `resolver` | Wallet the name resolves to. Set to the owner at registration and **reset to the new owner on every transfer or sale** |
| `primary` | Reverse record: a wallet may name one `.ant` name as its primary, but only a name that currently resolves to that wallet |

Reverse resolution is forward-confirmed: `reverse(W) = N` only while `N` resolves to `W`.

## 3. Eligibility (participant lifecycle)

Registering, buying, bidding and receiving a transfer require an **eligible** wallet:

1. at least 1,000 completed mining sessions (`MIN_SESSIONS_FOR_ANET`) in the last sealed state, and
2. at least one sealed Layer 1 settlement in an earlier block: a `SessionActivation` credit (`credited_ants > 0`) to the wallet, or a signed native transfer sent by the wallet, and
3. not an operator bootstrap seat (checked by the producer, as for ANRC-20).

Owners can always transfer, update the resolver, list and cancel. Every way of acquiring a name requires eligibility, so every owner is eligible.

## 4. Fees and payments

- No registration fee, no renewal fee and no marketplace commission. Domain actions carry no network fee, like ANRC-20. Any future fee needs a published, versioned protocol rule.
- Marketplace payments are native ANET (integer ANTS) moved by the node: buyer → seller for a sale; bidder → escrow → seller for an auction.
- Escrow is the pseudo-account `__ant_market_escrow__`. It has no key and is not a valid wallet address. Its balance always equals the sum of the highest bids on open auctions.
- Domain operations never create or destroy ANET.

## 5. Actions

Every mutation carries an `auth` envelope signed by the acting wallet. It uses the same `action-v1` scheme as ANRC-20 (`docs/ANRC20_SPEC.md` §4); the action name is the payload `route`. Amounts are exact decimal strings (or JSON integers ≤ 2^53). The node rejects a payload that differs from the request (401) and a nonce that is not strictly greater than the wallet's previous nonce for that action (409).

| Route (`POST`) | Action | Signed payload | Signer | Rules |
|---|---|---|---|---|
| `/domains/register` | `ant_register` | `{route, name}` | Registrant | Valid, unreserved, unregistered name; eligible |
| `/domains/transfer` | `ant_transfer` | `{route, name, to}` | Owner | Not listed; `to` is a valid wallet, not the owner, and eligible |
| `/domains/resolver` | `ant_set_resolver` | `{route, name, address}` | Owner | `address` is a valid wallet other than the current resolver |
| `/domains/primary` | `ant_set_primary` | `{route, name}` | Any wallet | `name` must resolve to the signer and not already be its primary name; `""` clears an existing primary name |
| `/domains/market/list` | `ant_list` | `{route, name, kind, price_ants, duration_hours}` | Owner | Not listed. `fixed`: price ≥ 1, duration 0. `auction`: minimum bid ≥ 1, 1–168 hours. `domain-auction`: minimum bid ≥ 10,000 ANTS, 1–168 hours |
| `/domains/market/cancel` | `ant_cancel` | `{route, name, listing_id}` | Seller | An auction that has a bid cannot be cancelled |
| `/domains/market/buy` | `ant_buy` | `{route, name, listing_id, price_ants}` | Buyer | Fixed listing; id and price equal the listing; not the seller; eligible; sufficient balance |
| `/domains/market/bid` | `ant_bid` | `{route, name, listing_id, amount_ants}` | Bidder | Auction open; not the seller; eligible; amount ≥ max(minimum bid, highest bid + 1). The bid is escrowed and the previous highest bid is refunded in the same operation |
| `/domains/market/settle` | `ant_settle` | `{route, name, listing_id}` | Seller or highest bidder | Auction has ended. With a bid: name → winner, escrow → seller. Without: the listing closes |

The signed `listing_id` and price bind a purchase or bid to one specific listing, so a cancelled and re-listed name cannot reuse an old signature. One name has at most one open listing, so it can never be sold twice. An operation that would change nothing (same resolver, same primary name, clearing a primary name that does not exist) is rejected, so no one can write permanent events for free.

The producer checks each wallet's nonce for an action again while it holds its state lock, so sealed blocks always carry strictly increasing nonces per wallet and action, even for concurrent requests; a request that loses that race gets 409 and is signed again. A payment may not spend ANET that the payer has already committed to queued native transfers.

Auction deadlines use the producer-sealed event time. A listing ends at `list time + duration_hours`; a bid is valid if its event time is before the end, and a settlement only at or after it.

## 6. Reads

| Method | Path | Producer | Follower |
|---|---|---|---|
| GET | `/domains/name/{name}` | ✓ | ✓ |
| GET | `/domains/name/{name}/history` | ✓ | — |
| GET | `/domains/reverse/{address}` | ✓ | ✓ |
| GET | `/domains/owner/{address}` | ✓ | ✓ |
| GET | `/domains/market?kind=` | ✓ | ✓ |

`/domains/name/{name}` returns `registered`, `available`, `reserved`, `owner`, `resolver`, `listing` and, on the producer, `pending` (true while an operation on the name is accepted but not yet sealed). An invalid name returns 400. Followers answer from their own verified copy of the chain, so any client can compare answers from independent nodes.

## 7. On-chain record

Each operation is sealed in the next block as one `AntDomain` event (committed to the block hash):

| Attribute | Present for | Value |
|---|---|---|
| `op` | all | `register`, `transfer`, `resolver`, `primary`, `list`, `cancel`, `buy`, `bid`, `settle` |
| `name` | all | Canonical name (`""` when a primary name is cleared) |
| `actor` | all | Signing wallet |
| `auth` | all | The full signed envelope (canonical JSON) |
| `owner`, `resolver` | register | Registrant |
| `from`, `to` | transfer, buy, settle | Previous and new owner (`to` is empty when an auction closes without bids) |
| `address` | resolver, primary | New resolver / wallet |
| `listing_id`, `kind`, `price_ants`, `ends_at_ms` | list | Listing terms (`ends_at_ms` is 0 for fixed) |
| `listing_id` | cancel, buy, bid, settle | The listing acted on |
| `price_ants` | buy, settle | Price paid (0 when an auction closes without bids) |
| `amount_ants`, `refund_to`, `refund_ants` | bid | Bid and the refunded previous bid (empty and 0 if none) |

The event's `timestamp` is the time used for auction deadlines. Balance changes appear in the block's `account_state_changes`.

## 8. Verification by follower nodes

For every block, a follower checks, in block order:

1. every `AntDomain` event carries a valid `auth`: hash, signature, chain ID and route, with a nonce strictly increasing per wallet and action;
2. replaying the signed payload against the follower's own registry, with the §1, §3 and §5 rules, produces exactly the sealed attributes;
3. after the block, the escrow account's balance equals the sum of the highest bids on open auctions;
4. native ANET is conserved (the existing supply rule in `docs/ANRC20_SPEC.md` §6 and `src/ledger.rs`).

Followers check eligibility rules 1 and 2. Rule 3 (bootstrap seats) uses an operator list that is not on chain; followers do not check it.

Followers trust the block's `account_state_changes` for per-account balances, as they do for DEX operations. They verify that each payment was authorized by the payer's signature for the exact amount, that escrow is fully backed, and that supply is conserved. They do not attribute every account balance change to an operation.

## 9. Activation and compatibility

The module adds a new event type only; the block format and hash are unchanged. Nodes older than `0.3.0` accept these blocks, because domain payments only move ANET between accounts, but they do not check domain rules. Upgraded followers check every `AntDomain` event from the first one.

## 10. Limits and status

- Producer-ordered: the operator's single producer orders operations, so it decides which of two simultaneous bids or purchases arrives first. There are no reorganizations in the current single-producer design. "Confirmed" means sealed in a block.
- An auction does not extend when a bid arrives near its end.
- An ended auction stays open until the seller or the highest bidder settles it; the escrowed bid stays locked until then.
- Off-chain metadata (logos, banners, profile text) is not part of the name record. The pi-backend no longer creates `.ant` names off-chain.
