> Published copy of `anet-chain/docs/ANRC20_SPEC.md` at node release 0.3.0 (commit `8af1f55`), included with whitepaper v4.8 because the node repository is not public yet.

# ANRC-20 Native Token Standard

**Status:** implemented on the A Network Layer 1 (`anet-private-mainnet-1`). Signed-authorization sealing (§5) ships with node release `0.2.0` and applies from its activation (§7).

ANRC-20 is a fixed-function token module built into the Layer 1 node. It is **not** a smart-contract standard: there is no virtual machine, no user code, and no EVM or TRON compatibility. Every rule below is enforced by the producer and re-checked by every follower node.

## 1. Separation from native ANET

- ANRC-20 balances are recorded separately from native ANET (`ants_balance`). No ANRC-20 operation can create, destroy or move native ANET, and creating a token does not change native supply.
- The symbols `ANET` and `WANET` are reserved. `WANET` is the internal 1:1 wrapper used by the native DEX. It changes only through wrap/unwrap, which followers account for as part of native supply.
- ANRC-20 operations charge no fee.

## 2. Token identity

| Field | Rule |
|---|---|
| `symbol` | Canonical ID. 1–16 characters from `A–Z 0–9 _ -`, stored uppercase, unique, immutable. `ANET` and `WANET` are rejected. |
| `name` | 1–64 characters, immutable |
| `decimals` | 0–18, immutable. Display only; balances are integer units. |
| `owner` | Creating wallet, immutable |
| `mintable` | Fixed at creation |
| `total_supply` | Integer units (u64). Always equals the sum of balances. |

## 3. Lifecycle

| Operation | Route | Who | Rules |
|---|---|---|---|
| Create | `POST /tokens/anrc20/create` | Wallet with ≥ 1,000 completed mining sessions that is not an operator bootstrap seat | New symbol; initial supply (may be 0) credited to the creator |
| Mint | `POST /tokens/anrc20/mint` | Token owner only | Token must be `mintable`; amount > 0; supply must not overflow u64 |
| Transfer | `POST /tokens/anrc20/transfer` | Holder | Amount > 0; sufficient balance; recipient is a valid ANET address and differs from the sender |
| Read | `GET /tokens/anrc20`, `GET /tokens/anrc20/{symbol}` | Anyone | — |

There is no burn and no administrative override. Supply can only grow through create and mint.

## 4. Authorization

Every mutation carries an `auth` envelope signed with the wallet's secp256k1 key:

```text
preimage    = "action-v1|" + action + "|" + WALLET + "|" + nonce + "|" + timestamp_ms + "|" + chain_id + "|" + canonical_json(payload)
action_hash = hex(sha256(preimage))
signature   = hex(r || s || recovery_id), low-s only (65 bytes)
WALLET      = "ANET" + first 36 uppercase hex chars of RIPEMD160(compressed public key)
```

`canonical_json` sorts object keys and has no whitespace. Amounts are exact decimal strings (or JSON integers ≤ 2^53).

| Action | Signed payload |
|---|---|
| `anrc20_create` | `{"route","symbol","name","decimals","initial_supply","mintable"}` |
| `anrc20_mint` | `{"route","to","symbol","amount"}` |
| `anrc20_transfer` | `{"route","to","symbol","amount"}` |

The node rejects a signature from another chain, a payload that differs from the request (HTTP 401), and a nonce that is not strictly greater than the last nonce for the same wallet and action (HTTP 409). The signer is always the acting wallet: the creator, the minting owner, or the sender.

## 5. On-chain record

Each operation is sealed in the next block as a `TokenTransferred` event:

| Attribute | Value |
|---|---|
| `symbol`, `amount` | Token and integer amount |
| `from` | `MINT` for create and mint, otherwise the sender |
| `to` | Creator, mint recipient or transfer recipient |
| `op` | `create`, `mint` or `transfer` |
| `auth` | The full signed envelope (canonical JSON) |

The block also carries the full token registry (`token_registry`) and the changed accounts' `asset_balances`. All three are committed to the block hash.

## 6. Verification by follower nodes

For every block, a follower checks:

1. No registered token disappears, and no token's identity fields change.
2. Balances sum exactly to `total_supply`.
3. A new token appears only together with a create event.
4. Supply grows by exactly the minted amount, and never for a non-mintable token.
5. For tokens outside DEX pools, every balance change equals the sum of that block's token events.
6. Every sealed `auth` verifies: hash, signature, chain ID, route, symbol, amount and recipient match the event; the signer is the creator, owner or sender; and the nonce is strictly increasing per wallet and action.
7. From the first block containing a sealed authorization, any token event without one is invalid.

## 7. Activation and history

Sealed authorizations are introduced without changing the block format: older nodes ignore the extra event attributes. Enforcement activates on-chain at the first block that contains a sealed authorization, so every follower agrees on the activation point.

Tokens created before activation (`CJ`, `CJC`, `DG`, created 2026-10-22) were authorized by the producer, but their signatures were not recorded. Followers report them as `token_ops_unauthenticated_legacy`. Their balances and supply are still verified by rules 1–5.

## 8. Limits

- Amounts are unsigned 64-bit integers (maximum 18,446,744,073,709,551,615 units).
- Tokens are not natively interoperable with EVM or other chains. Any bridge would be a separate, separately reviewed component.
- Token creation depends on Web2 session counts, which the producer imports. Followers verify that credits and records are sealed and consistent, not the underlying mining sessions.
