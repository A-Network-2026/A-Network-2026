> Published copy of `anet-chain/docs/DEVELOPER_GUIDE.md` at node release 0.3.0 (commit `8af1f55`), included with whitepaper v4.8 because the node repository is not public yet.

# A Network Developer Guide

How to build wallets, explorers and applications on the A Network Layer 1.

## 1. Networks

| Network | Chain ID | RPC | Notes |
|---|---|---|---|
| Mainnet | `anet-private-mainnet-1` | `https://explorer.a-network.net` | Operator producer plus any follower nodes |
| Local devnet | `anet-devnet-1` | `http://127.0.0.1:18080` | `scripts/devnet/multinode-test.sh` |

There is no public testnet. Use the devnet script for integration tests.

A Network is a fixed-function chain. It has no smart contracts and no EVM or TRON JSON-RPC; any compatibility layer would have to be built and tested separately.

## 2. Units and addresses

- `1 ANET = 100,000,000 ANTS`. All amounts on the wire are integer ANTS or integer token units.
- Address: `ANET` + the first 36 uppercase hex characters of RIPEMD160(compressed secp256k1 public key).
- Keys never leave the client. The node rejects seed phrases and private keys.

## 3. RPC

Read endpoints are served by the producer and by follower nodes (marked F).

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` (F) | Liveness and tip |
| GET | `/sync/head` (F) | Chain ID, genesis hash, tip, block count |
| GET | `/blocks?from=N&to=M&position=true` (F) | Blocks by chain position (≤ 256) |
| GET | `/blocks/{height or hash}` | Single block |
| GET | `/accounts/{address}` (F) | Balance, token balances, sessions, vesting |
| GET | `/accounts/{address}/activity` | History and `next_nonce` for transfers |
| GET | `/tokens/anrc20` (F), `/tokens/anrc20/{symbol}` (F) | Token registry |
| GET | `/domains/name/{name}` (F), `/domains/name/{name}/history` | `.ant` record: owner, resolver, listing, pending |
| GET | `/domains/reverse/{address}` (F), `/domains/owner/{address}` (F), `/domains/market` (F) | Reverse name, owned names, open listings and escrow |
| GET | `/network/capabilities`, `/network/consensus` | Published protocol rules |
| GET | `/network/seeds` (F), `/network/discovery` | Peers |
| GET | `/node/status` (F only) | Independent verification report |
| POST | `/transactions` | Signed native ANET transfer |
| POST | `/tokens/anrc20/create` | Signed token creation |
| POST | `/tokens/anrc20/mint` | Signed mint (owner) |
| POST | `/tokens/anrc20/transfer` | Signed token transfer |
| POST | `/domains/register`, `/domains/transfer`, `/domains/resolver`, `/domains/primary` | Signed `.ant` name operations |
| POST | `/domains/market/list`, `/cancel`, `/buy`, `/bid`, `/settle` | Signed `.ant` marketplace operations |

Errors return `{"error": "..."}` with HTTP 400 (rule violation), 401 (bad signature or payload mismatch), 404, 409 (replayed nonce) or 503.

## 4. TypeScript SDK

`sdk/typescript` (`@a-network/anet-sdk`) uses the audited `@noble/curves` and `@noble/hashes` libraries already used by the web wallet. Its signatures match the node byte for byte; a shared test vector runs in both the Rust and TypeScript test suites.

```ts
import { AnetClient, addressFromPrivateKey, verifyAction } from "@a-network/anet-sdk";

const client = new AnetClient("https://explorer.a-network.net", "anet-private-mainnet-1");
const head = await client.syncHead();

// Mutations sign locally; only the signature leaves the device.
await client.transfer(privateKeyHex, "ANET…", 100_000_000, "memo");
await client.createToken(privateKeyHex, { symbol: "MYTKN", name: "My Token", decimals: 8, initialSupply: 1_000_000n, mintable: false });
await client.transferToken(privateKeyHex, "MYTKN", "ANET…", 250n);
```

Lower-level helpers: `canonicalJson`, `signAction`, `signTransfer`, `verifyAction`, `createTokenRequest`, `tokenMoveRequest`, `formatAnet` and `parseAnet`.

## 5. Wallet integration

1. Generate or import a 32-byte secp256k1 key, store it encrypted, and derive the address as in §2.
2. **Native transfers:** read `next_nonce` from `/accounts/{address}/activity`, sign with `signTransfer`, then `POST /transactions`. Nonces are strictly sequential per sender. The minimum fee is 1,000 ANTS.
3. **Token actions:** `signAction` uses a millisecond nonce that must increase per wallet and action. Do not reuse an `auth` object.
4. Show the eligibility rules to users. Spending mined ANET, receiving P2P ANET and creating tokens require ≥ 1,000 completed sessions. Moving mined ANET out of Layer 1 follows the vesting schedule.
5. **Sending to a `.ant` name:** resolve it with `GET /domains/name/{name}` (or `client.resolveDomain`), show the name, the resolved address, amount, network and fee, and ask the user to confirm. Sign the transfer to the **address**, never to the name, and re-resolve just before signing; if the address changed since the user confirmed, stop and ask again. A signed transfer cannot be redirected by a later resolver change.
6. `.ant` names are an A Network naming system, not internet DNS. Browsers do not resolve them; only wallets, explorers and apps that call the RPC do.

```ts
const to = await client.resolveDomain("digitalgold.ant");   // current resolver wallet
// ...show name + address + amount + fee, get explicit confirmation...
await client.transfer(privateKeyHex, to, amountAnts);
await client.domainAction(privateKeyHex, "ant_register", "mycolony");
await client.domainAction(privateKeyHex, "ant_list", "mycolony.ant", { kind: "domain-auction", priceAnts: 10_000, durationHours: 24 });
```

## 6. Explorer integration

- Read from a follower node you run. Its `/node/status` reports supply, legacy issuance and token verification, all independently computed.
- Token events (`TokenTransferred`) carry `op` and, from release 0.2.0, the signed `auth`. Use `verifyAction(JSON.parse(event.attributes.auth), "anrc20_" + op)` to show who authorized each operation.
- Label the `legacy_issuance` items from `/node/status` as pre-checkpoint history. Do not present them as mining rewards.

## 7. Local devnet

```bash
PG_BIN=/path/to/postgresql/bin scripts/devnet/multinode-test.sh
```

The script starts PostgreSQL, a producer, three followers and two hostile peers, then reports PASS/FAIL. To keep a devnet running for manual work, follow the same steps by hand: `schema.sql`, producer flags, and the `users` rows.

`scripts/devnet/slow-db-test.sh` (same `PG_BIN` requirement, plus `psql` on `PATH`) reproduces a slow production database: `network_stats` sleeps 12 seconds (longer than the 8-second request budget of `/stats/investor`) and `mining_sessions` sleeps 3 seconds (the Web2 sync scans it every minute). It expects a single background metrics refresh, a warm cache, a fast explorer home page, and signed actions that do not wait behind the background queries.
