# Publish Signed Releases — Closes Tracker #9

This is the copy-paste script for publishing first signed binary
releases of `anet-chain` and `pi-backend` on GitHub Releases. Once
both releases are live, scorecard milestone #9 flips to ✅ DONE.

**Prerequisites:**

- `gh` CLI installed and authenticated (`gh auth status` succeeds).
- macOS or Linux build host.
- ~15 minutes.

**Cost:** $0.

---

## Release 1 — anet-chain v1.0.0

```bash
cd /Users/joeldupalco/Downloads/anet-chain

# 1. Build release binary
cargo build --release

# 2. Compute SHA-256 of the binary
shasum -a 256 target/release/anet-chain > anet-chain-v1.0.0.sha256

# 3. Tag the release
git tag -a v1.0.0 -m "anet-chain v1.0.0 — first public release"
git push origin v1.0.0

# 4. Publish GitHub Release with binary + checksum
gh release create v1.0.0 \
  target/release/anet-chain \
  anet-chain-v1.0.0.sha256 \
  --title "anet-chain v1.0.0 — first public release" \
  --notes "$(cat <<'EOF'
First public release of the A-Network L1 chain binary.

## Verify

```bash
shasum -a 256 anet-chain
# expected: $(cat anet-chain-v1.0.0.sha256 — copy from below)
```

## Run

```bash
./anet-chain --help
```

Full docs: see DEPLOY.md and VALIDATOR_RECRUITMENT_SPEC.md in this repo.

## License

MIT — see LICENSE.

## Security

Coordinated disclosure: see SECURITY.md.
Bug bounty paid in wANET for contracts; L1 disclosures triaged per the same policy.

## Build provenance

- Frozen commit: \$(git rev-parse HEAD)
- Built with: \$(rustc --version)
- Built on: \$(uname -srm)
EOF
)"

# 5. Clean up local checksum file
rm anet-chain-v1.0.0.sha256
```

---

## Release 2 — pi-backend v1.0.0

```bash
cd /Users/joeldupalco/Downloads/A-Network-2026

# 1. Build source tarball (no compiled binary; it's Node.js)
tar -czf pi-backend-v1.0.0.tar.gz \
  pi-backend/src \
  pi-backend/package.json \
  pi-backend/package-lock.json \
  pi-backend/LICENSE \
  pi-backend/render.yaml \
  pi-backend/.env.example

# 2. Compute SHA-256
shasum -a 256 pi-backend-v1.0.0.tar.gz > pi-backend-v1.0.0.sha256

# 3. Tag the release (separate tag namespace from contracts/whitepaper)
git tag -a pi-backend-v1.0.0 -m "pi-backend v1.0.0 — first public release"
git push origin pi-backend-v1.0.0

# 4. Publish GitHub Release
gh release create pi-backend-v1.0.0 \
  pi-backend-v1.0.0.tar.gz \
  pi-backend-v1.0.0.sha256 \
  --title "pi-backend v1.0.0 — first public release" \
  --notes "$(cat <<'EOF'
First public release of the A-Network bridge relayer source.

This is the Node.js process that submits L1 burns to AnetBridgeVault on BSC.
It holds NO signing authority — signatures come from independent EIP-712 signer
daemons; this process can only submit gas. See whitepaper.html for the full
architecture.

## Verify

```bash
shasum -a 256 pi-backend-v1.0.0.tar.gz
# expected: \$(cat pi-backend-v1.0.0.sha256)
```

## Install

```bash
tar -xzf pi-backend-v1.0.0.tar.gz
cd pi-backend
cp .env.example .env   # then fill in values
npm install --omit=dev
node src/server.js
```

## License

MIT — see LICENSE.

## Security

Coordinated disclosure: see SECURITY.md at the repo root.

## Build provenance

- Frozen commit: \$(git rev-parse HEAD)
- Node target: 18+ (per package.json engines)
EOF
)"

# 5. Clean up
rm pi-backend-v1.0.0.tar.gz pi-backend-v1.0.0.sha256
```

---

## After both releases publish

Send me both release URLs (they'll look like
`https://github.com/A-Network-2026/anet-chain/releases/tag/v1.0.0`
and similar for pi-backend). I'll then:

1. Flip scorecard milestone #9 from 🟡 IN PROGRESS to ✅ DONE.
2. Add the SHA-256 fingerprints to the whitepaper.
3. Update the v3.6 changelog to point at the live releases.
4. Commit + push.

---

## Troubleshooting

**"gh: command not found"** → install with `brew install gh` then
`gh auth login` and select GitHub.com → HTTPS → paste a Personal
Access Token with `repo` + `write:packages` scope.

**"gh: tag already exists"** → someone already pushed the tag.
Delete it locally + remotely (`git tag -d v1.0.0` + `git push
origin :refs/tags/v1.0.0`) and re-run, or pick a new version.

**"cargo build --release" fails** → ensure `rustup default stable`
matches `rust-toolchain.toml`. The repo pins a toolchain; if cargo
complains about a missing channel, run `rustup install <channel>`
where `<channel>` is what `rust-toolchain.toml` specifies.

**"git push origin v1.0.0" rejected** → you don't have push rights
on the tag namespace. Most likely cause: the remote is HTTPS and
your PAT expired. Run `gh auth refresh -s repo`.
