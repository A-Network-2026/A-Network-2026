# anet-rpc-proxy — read-only JSON-RPC relay for a-network.net

`server.js` is a zero-dependency Node service that relays the website's chain reads
(BNB Chain, Ethereum, Solana) to the project's RPC provider from **our own domain**
(`rpc.a-network.net`). It exists because some visitors' networks cannot reach the
provider directly (November 2026: `rpc.ankr.com` presented a wrong TLS certificate in
some regions and `reserves.html` could not fetch anything). It also caches the heavy,
immutable proof-of-reserves history and keeps serving it while the provider is down.

The browser never depends on it. `assets/js/anet-rpc.js` tries, in order:

| reads (`eth_call`, balances, Solana) | archive history (`eth_getLogs` over 32M blocks) |
|---|---|
| 1. Ankr directly · 2. **this relay** · 3. public nodes | 1. **this relay** (cached, stale-while-error) · 2. Ankr directly |

If the relay is unreachable the page behaves exactly as before it existed.

## What it enforces

- **Read-only allowlist per chain** (`eth_call`, `eth_getBalance`, `eth_getLogs`, …; `getBalance`,
  `getTokenAccountsByOwner`, …). Nothing that broadcasts: wallets send their own transactions.
- `eth_getLogs` must name 1–10 contract addresses (no whole-chain scans); block data is relayed
  without full transaction objects.
- **Upstream failover**: Ankr first, then any `UPSTREAMS_*` you add; a failing upstream is skipped
  for `COOLDOWN_MS` and re-probed with a 4 s budget, so an outage costs seconds, not minutes.
- **Genuine call errors are forwarded untouched** (an `eth_call` revert is not retried elsewhere).
- **Cache**: `eth_getLogs` over a closed block range and `eth_getBlockByNumber` by number are
  cached for `CACHE_TTL_MS` (10 min) and served **stale for up to `CACHE_STALE_MS` (24 h) when
  every upstream fails**, flagged with `x-anet-rpc-cache: stale` and a `Warning` header. The
  website cuts long scans at a 20,000-block boundary so every visitor shares one cache entry.
- Per-IP rate limit (`RATE_LIMIT_PER_MIN`, batch entries count), global concurrency cap with a
  bounded queue (overload answers 503 quickly and the browser moves on), body caps (64 KB in,
  32 MB out), gzip, CORS allowlist, keys redacted from every log line and status page.
- `GET /health` for the platform; `GET /` or `/rpc` for status (upstream health, cache, counters);
  `POST /rpc/{bsc|eth|solana}` to relay. Graceful SIGTERM drain for zero-downtime deploys.

## Deploy on Render (no outage)

The relay is a **new, separate web service without a disk**, so creating or redeploying it
touches nothing that is running today: the L1 node (`explorer.a-network.net`, which has a
persistent disk and therefore restarts on every deploy) and the app backend
(`api.a-network.net`) are not involved at all. Render deploys disk-less services with zero
downtime: the new instance must pass `/health` before traffic switches, and a failed build or
test leaves the previous version serving.

Rollout order — each step is safe on its own:

1. **Website first (already in this commit).** `anet-rpc.js` lists `https://rpc.a-network.net`
   as an optional endpoint. Until the host exists, the browser gets an instant DNS failure,
   demotes the relay for 60 s and uses Ankr / public nodes as before. No visible change.
2. **Create the service.** Render dashboard → *New* → *Blueprint* → this repository (the
   `render.yaml` at the repo root defines `anet-rpc-proxy`, `rootDir: rpc-proxy`, Starter plan,
   health check `/health`). Or *New* → *Web Service* with root directory `rpc-proxy`, build
   `npm test`, start `node server.js`.
3. **Set `ANKR_KEY`** in the service's Environment (the Ankr project key; it is the only secret).
   Optional: `UPSTREAMS_BSC` / `UPSTREAMS_ETH` / `UPSTREAMS_SOLANA` with extra archive-capable
   node URLs (comma-separated) to fail over to when Ankr itself is down.
4. **Check** `https://<service>.onrender.com/health` → `{"ok":true,"configured":["bsc","eth","solana"]}`
   and `https://<service>.onrender.com/rpc` for the status page (keys shown as `***`).
5. **Custom domain.** Service → *Settings* → *Custom Domains* → add `rpc.a-network.net`, then
   at the DNS provider (Google Domains for a-network.net) add the CNAME Render shows:
   `rpc` → `<service>.onrender.com`. Render issues the TLS certificate automatically. From the
   moment DNS resolves, the website starts using the relay — no website change needed.
6. **Verify from the website**: open `https://a-network.net/reserves.html`; the network bar shows
   `history: rpc.a-network.net`. In DevTools → Network, `rpc.a-network.net/rpc/bsc` responses
   carry `x-anet-rpc-cache: miss|hit`.

Rollback at any time: delete the DNS record (the browser falls back within one request) or
suspend the service. Nothing else changes.

## Run locally

```bash
cd rpc-proxy
npm test                                   # 9 tests, mock upstreams, no network
ANKR_KEY=... PORT=8791 LOG_REQUESTS=true node server.js
curl -s localhost:8791/health
curl -s -X POST localhost:8791/rpc/bsc -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

To let a local copy of the website talk to a local relay, start the relay with
`ALLOWED_ORIGINS=http://127.0.0.1:8787` and point `PROXY` in `assets/js/anet-rpc.js` at it
(do not commit that change).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8790` | Listen port (Render sets it) |
| `ANKR_KEY` | — | Ankr project key → first upstream for every chain |
| `UPSTREAMS_BSC` / `UPSTREAMS_ETH` / `UPSTREAMS_SOLANA` | — | Extra upstream URLs, tried after Ankr |
| `ALLOWED_ORIGINS` | `https://a-network.net,https://www.a-network.net` | Browser origins that receive CORS headers |
| `RATE_LIMIT_PER_MIN` | `240` | Per client IP (`cf-connecting-ip` / `x-forwarded-for`) |
| `MAX_CONCURRENCY` / `QUEUE_TIMEOUT_MS` | `24` / `10000` | Upstream requests in flight; wait cap before 503 |
| `UPSTREAM_TIMEOUT_MS` / `LOGS_TIMEOUT_MS` / `PROBE_TIMEOUT_MS` | `10000` / `20000` / `4000` | Per attempt; `eth_getLogs`; re-probing a node in cooldown |
| `COOLDOWN_MS` | `30000` | How long a failing upstream is skipped |
| `CACHE_TTL_MS` / `CACHE_STALE_MS` / `CACHE_MAX_BYTES` | `600000` / `86400000` / `67108864` | Fresh / stale-while-error / memory cap |
| `MAX_BODY_BYTES` / `MAX_UPSTREAM_BYTES` | `65536` / `33554432` | Request / upstream response caps |
| `LOG_REQUESTS` | `false` | One log line per relayed request |
