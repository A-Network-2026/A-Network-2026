# Security Policy — A-Network

A-Network operates a real economic system: a Layer 1 chain, a BNB
Chain bridge holding ~10.5M wANET, and a mobile app with paying
users. We take security disclosures seriously.

## Supported components

The following components are in scope for security disclosure:

| Component | Repository / path | Notes |
|---|---|---|
| `AnetBridgeVault.sol` | `contracts/src/AnetBridgeVault.sol` | wANET escrow on BSC. Highest-severity asset. |
| `AnetSwap.sol` | `contracts/src/AnetSwap.sol` | Entry-side swap router (v3.6). |
| ANET BEP-20 token | on-chain `0x791055A7d52AA392eaE8De04250497f33807E46A` | Ownership renounced; report-only. |
| A-Network L1 chain | `anet-chain/` (separate repo) | Rust binary. |
| pi-backend relayer | `pi-backend/` | Node.js bridge relayer. |
| Mobile app | `anet-mobile-app/` | Flutter app (iOS + Android). |
| Web frontend | `*.html` in this repo | dex.html, index.html, profile.html, etc. |

Out of scope: third-party services we integrate with (BscScan,
Render, DEX aggregators); social-engineering attacks; theoretical
attacks without a working PoC.

## How to report

**Do not open a public GitHub issue for security disclosures.**

Email: **security@a-network.dev**

If you cannot email, contact the project lead directly via signed
DM on X (`@Joel_Dupalco`) and request a secure channel. Do not
include exploit details in the first DM.

When reporting, please include:

1. A clear description of the vulnerability.
2. The component and, where possible, the exact file/line or
   contract address.
3. A minimal proof of concept or call trace, if you have one.
4. Your assessment of severity and impact.
5. Your preferred attribution (real name, handle, or anonymous).

## What to expect

- **Acknowledgement within 48 hours** of receipt.
- **Triage and severity classification within 5 business days.**
- **Coordinated disclosure timeline**:
  - **Critical** (funds at risk, key compromise): patched and
    disclosed within 14 days; mitigations may go out faster than the
    public write-up.
  - **High** (significant degradation, not direct fund loss):
    patched within 30 days.
  - **Medium / Low**: patched in the next normal release cycle.
- **Public credit** on the Decentralization Status Tracker and in
  the patch commit message, unless you request anonymity.

## Bounty

A-Network does not currently run a formal bounty program. For
critical findings, we will negotiate an ad-hoc reward in wANET from
the founder allocation, paid through `AnetBridgeVault` on the
standard 2-of-3 signature path. We will not negotiate any payment
that requires you to keep a vulnerability undisclosed.

## Safe harbor

If you make a good-faith effort to follow this policy, A-Network
commits to:

- Not pursue legal action for accidental, good-faith violations.
- Work with you to understand and resolve the issue quickly.
- Recognize your contribution publicly if you wish.

Good-faith effort means: you stop as soon as you can prove the
vulnerability, you do not exfiltrate user data or funds beyond what
is necessary to demonstrate the issue, you do not disclose publicly
before we have had a reasonable patch window, and you give us the
information needed to fix it.

## Out-of-scope behaviour

These do not qualify as security issues:

- DoS against public RPC endpoints (use your own RPC).
- Stale dependency advisories without a working exploit path.
- Issues that require physical access to a user's signed-in device.
- Findings against the renounced ANET BEP-20 contract (we cannot
  fix it; ownership is `0x0`).

## Public disclosures

Past disclosures and our responses are summarised in the project
`whitepaper.html` changelog sections and on the Decentralization
Status Tracker. The first formal external audit is scoped in
`contracts/AUDIT_PACKAGE.md` and will be published on completion.
