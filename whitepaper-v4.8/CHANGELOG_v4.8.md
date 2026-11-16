# Whitepaper v4.8 — Change Log

**Published:** November 16, 2026, as the official `whitepaper.html`, on the owner's instruction (release approval of November 16, 2026). It replaces v4.7. The SHA-256 of the published file is listed in the [verification appendix](TECHNICAL_VERIFICATION_APPENDIX_v4.8.md#3-publication-hash-and-on-chain-attestation).

**Revised:** November 16, 2026, the same day. The first publication linked the `.ant` specification and the developer guide to the `anet-chain` repository on GitHub, which is not public, so the links failed. Its component table also said the SDK source was published with the node. The links now point to copies published in this folder. The component table, parts Q, R and T and a fourth correction of record now state that the node source is not public yet. No rule or figure changed; only the publication status of the node source, the follower software and the SDK was corrected. The digest of `whitepaper.html` changed from `a5ecd287…3744` to the one in the appendix.

**Baseline:** v4.7 of November 13, 2026, as served at a-network.net. The command for this revision named v4.4 as its reference, but v4.5, v4.6 and v4.7 were already published, so this revision follows the established numbering as v4.8.

## Added

- Section "Version 4.8: A Network `.ant` Blockchain Domain Name System", placed before the v4.7 changelog, as in earlier versions. It contains:
  - a notice that `.ant` is a blockchain naming system, not an ICANN top-level domain;
  - a component status table (live, published, pending);
  - A. Overview and purpose; B. Native registry architecture, with the diagram `whitepaper-v4.8-ant-names.svg`; C. Naming and normalization rules; D. Registration; E. Ownership and authorization; F. Forward resolution; G. Reverse resolution; H. Wallet integration; I. Domain identity and NFTs; J. Fixed-price marketplace; K. Auction marketplace; L. Domain-auction marketplace; M. Fees; N. Eligibility and activation rules; O. Blockchain settlement; P. Security architecture; Q. Explorer verification; R. Public APIs and integration requirements; S. Transfer and renewal policies; T. Technical limitations; U. Deployment and network activation status;
  - corrections of record and "What did NOT change".
- Navigation entry "v4.8 .ant Names".
- This folder: PDF and Markdown renditions, this change log, the verification appendix and the consistency report.
- Published copies of three node documents at node 0.3.0, because the node repository is not public yet: `ANT_DOMAINS_SPEC.md`, `ANRC20_SPEC.md` (its §4 defines the signature scheme) and `DEVELOPER_GUIDE.md`.

## Changed

- Title, description, Open Graph tags, header line, hero badge, hero version and publication fields and footer now name v4.8, November 16, 2026.
- `reserves.html` / `assets/js/reserves.js` label the hashed document as Version 4.8.

## Unchanged

All v4.7 content, every earlier changelog, Sections 1–15, § EA, § SC, § OL, the Decentralization Status Tracker and all economic figures. The supply rules, ANTS denomination, mining and activation schedule, eligibility thresholds, vesting, the one-way bridge and the separation of wANET from native ANET are restated, not modified.

## Corrections of record introduced

1. Version 2.3's marketplace (fixed, auction, domain-auction) was implemented only in the pi-backend database. A "sale" changed the recorded owner without moving any ANET, miner login needed no password or signature, and records lived on an ephemeral server disk. Production held no colony domains and no listings. That backend no longer creates `.ant` names; `.ant` sales settle on Layer 1.
2. The explorer search page reflected the query without escaping it (cross-site scripting). Fixed in node 0.3.0.
3. The ANET Wallet extension's Send screen used a timestamp as the transfer nonce, which the node rejects. Fixed in extension 1.1.0.
4. Version 4.7 describes the node source, the follower software, the SDK and the documentation as published. The `anet-chain` repository is not public, so they cannot be downloaded yet. The owner plans to open it. Until then, the specifications and the developer guide are published in this folder, and sealed operations can be checked from public block data (appendix, section 2).

## Decisions

Made by the owner on November 16, 2026, before implementation:

- Approve the `.ant` module as an exception to the Layer 1 feature freeze (logged in `anet-chain/FREEZE.md`).
- Eligibility: the participant lifecycle (at least 1,000 sessions plus a sealed Layer 1 settlement).
- No registration fee and no marketplace commission.
- Permanent ownership (no expiry, no renewal).
- Reserved names: `anet`, `wanet`.
- Deploy to mainnet and publish this whitepaper once devnet and CI pass.
- Ship the mobile change as app version 1.0.127+192.

## Open after publication

1. On-chain attestation: the operator seals the published file's SHA-256 with the admin key (appendix, section 3). Until a follower confirms the sealed event, v4.8 is published but not attested on-chain. The v4.7 attestation was also still pending at the time of writing.
2. Mobile app 1.0.127+192: App Store and Google Play releases follow store review.
3. ANET Wallet extension 1.1.0: users who installed the extension unpacked load the updated folder again.
4. No separate legal review of this revision was performed. v4.8 introduces no sale, distribution, fee, yield program or tokenomics change (the cases for which Section 15 requires counsel review).
5. Node repository: the owner makes `anet-chain` public. Until then, the node source, the follower software and the SDK cannot be downloaded, and the verification steps that need them (appendix, section 2, steps 4–6) are open only to those with access. Earlier links into that repository, such as the validator recruitment specification in the decentralization tracker, fail until then.
