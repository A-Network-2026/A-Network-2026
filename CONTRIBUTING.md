# Contributing to A-Network

Thanks for your interest in contributing. A-Network is open source
under the MIT License (see `LICENSE`). Anyone can run a node, audit
the contracts, and submit improvements.

## Before you start

- **Security issues do not go through pull requests.** See
  `SECURITY.md` for the disclosure channel.
- Read the `whitepaper.html` Decentralization Status Tracker so you
  understand which components are operator-run versus trustless
  today. A contribution that contradicts the published trust model
  will be closed even if the code is correct.
- For contract changes, read `contracts/AUDIT_PACKAGE.md` so you
  understand the audit gate.

## What we accept

| Area | We accept | We do not accept (yet) |
|---|---|---|
| Smart contracts (`contracts/`) | Bug fixes with a regression test, gas-saving rewrites of audited code with an equivalence argument, new tests covering existing behaviour. | New features, new external dependencies, refactors that are not behaviour-preserving. The contracts are pre-audit and we are not adding scope. |
| L1 chain (`anet-chain/`) | Correctness fixes, new RPC tests, validator UX improvements. | Consensus changes without a written design doc. |
| Bridge relayer (`pi-backend/`) | Operational hardening, observability, new safety gates. | New endpoints that move funds. |
| Mobile app (`anet-mobile-app/`) | Bug fixes, accessibility, translations, performance. | Anything that changes the wallet's signing model. |
| Frontend (`*.html`, `assets/`, `dexscreener_assets/`) | Bug fixes, accessibility, copy edits, broken-link fixes. | Marketing copy claims about decentralization beyond what the tracker says. |
| Docs and whitepaper | Typo fixes, clarifications, broken-link fixes. | Adding new milestones to the tracker without project sign-off. |

## Process

1. **Open an issue first** for anything non-trivial. Describe the
   problem, the proposed fix, and the test plan. Wait for
   acknowledgement before writing a large PR.
2. **One logical change per PR.** Multiple unrelated changes get
   split.
3. **Tests are required** for code changes. Contracts: Hardhat tests
   that fail without your change and pass with it. L1: `cargo test`.
   Backend: integration tests against a local hardhat node.
4. **Commit messages** follow the existing convention:
   `<scope>(<area>): <summary>` with a body explaining *why*. See
   `git log --oneline` for examples.
5. **Sign off** with your real name or a stable handle. We will not
   merge anonymous one-time pseudonyms for contract or backend code.

## Style

- **Solidity:** Match the existing style in `contracts/src/`.
  Solidity 0.8.20, optimizer runs=200, no `via_ir`. Use
  `keccak256(abi.encode(...))` for storage keys (matches the
  timelock pattern). Prefer custom errors over string reverts only
  if the surrounding file already does; do not mix styles.
- **Rust:** `cargo fmt` and `cargo clippy -- -D warnings` must pass.
- **JS / Node:** Match the existing style in `pi-backend/`. No new
  dependencies without justification.
- **HTML / CSS:** Match the existing whitepaper / dex page style.
  No build step; ship as static assets.

## Review

- Contracts and bridge relayer PRs require **two** project reviewers,
  one of whom must be a current vault signer.
- Everything else requires one reviewer.
- We will not rubber-stamp. Expect substantive feedback. We will
  also tell you clearly when something is good and merge it.

## CLA

A-Network does not require a CLA. By submitting a PR you confirm
that:

1. You have the right to license your contribution under the MIT
   License.
2. You are not under any obligation that would prevent that
   license grant.

If you need a different arrangement (corporate contribution, work-
for-hire), open an issue tagged `legal` and we will work it out.

## Recognition

Significant contributors are credited in the
`whitepaper.html#contributors` section (planned for v3.7) and in the
relevant release notes.

## Questions

Public discussion: project Discord / X.
Anything sensitive: per `SECURITY.md`.
