# Whitepaper v4.7 — Change Log

**Published:** November 13, 2026, as the official `whitepaper.html`, on the owner's instruction. It replaces v4.6. The SHA-256 of the published file is listed in the [verification appendix](TECHNICAL_VERIFICATION_APPENDIX_v4.7.md#4-publication-hash-and-on-chain-attestation).

**Baseline:** v4.6 of November 1, 2026, as served at a-network.net (SHA-256 `cb382e1b52405941743b729deb1d657ed1ac8acb7064c700add3e5c8042c8c47`). The owner's app-download links (App Store meta tag, navigation entry, footer link and `app-download.js`) were added to the page before this revision and are published with it. The command named v4.4 as the baseline, but v4.5 (October 23) and v4.6 (November 1) were already published, so this revision follows the established numbering as v4.7.

## Added

- Section "Version 4.7: ANRC-20 and Open Network Infrastructure", placed before the v4.6 changelog, as in earlier versions. It contains:
  - a component status table (live, verified, planned);
  - A. ANRC-20 native token standard (identity, lifecycle, signed authorization, no fees, supply controls, separation from native ANET, on-chain record);
  - B. Mobile mining and genesis integrity (canonical chain identity, the Revelation snapshot, the mining-to-L1 path, verified reconciliation);
  - the protocol decision on the activation credit (no tokenomics changed);
  - C. Native ANET supply protection (unchanged rules, follower enforcement, issuance checkpoint, itemized legacy issuance);
  - D. Computer node infrastructure (node types, synchronization, peers, platforms, independent vs operator-controlled) and an architecture diagram (`whitepaper-v4.7-architecture.svg`);
  - E. Web2 → Web3 → Web4 progression, with a terminology note;
  - F. Developer documentation summary;
  - G. Network security, including one correction of record;
  - H. Decentralization status;
  - I. Production verification and known limitations;
  - J. Roadmap (completed / pending / planned);
  - corrections of record and "What did NOT change".
- Navigation entry "v4.7 ANRC-20 & Open Network".
- This folder: PDF and Markdown renditions, this change log, the verification appendix and the consistency report.

## Changed

- Title, description, header line, hero badge, hero version and publication fields and footer now name v4.7, November 13, 2026.
- Print stylesheet hides the floating assistant and back-to-top buttons in the PDF.
- `reserves.html` labels the hashed document as Version 4.7.

## Unchanged

All v4.6 content, every earlier changelog, Sections 1–15, § EA, § SC, § OL, the Decentralization Status Tracker (dated May 28, 2026) and all economic figures.

## Corrections of record introduced

1. v4.2's claim that the full SHA-256 digest of each version is sealed on-chain: the node recorded only a 16-hex-character prefix, and no version was sealed. Fixed in node 0.2.0 (live).
2. The node's `/network/consensus` descriptor overstated the verifier's checks (TPoW re-verification). Corrected in node 0.2.0 (live).
3. The published seed node lagged the primary node before the November 13 restarts, and the default seed host does not resolve.
4. Section 10 and v4.3 describe fees as shared by every miner with a completed session and validators as sealing blocks. The producer seals blocks, and fees go to the validator seats in each block (today the two operator bootstrap seats).

## Decisions

Made by the owner on November 13, 2026:

- Activation credits the Web2 ledger balance (live in node 0.2.1). Recorded in part B.
- The Web2/Web3/Web4 framing of part E is adopted.
- v4.7 is published as the official whitepaper.

## Open after publication

1. Editorial alignment of the Section 4, 9 and 10 titles and `web4.html` with the adopted framing, in a later revision.
2. On-chain attestation: the operator seals the published file's SHA-256 with the admin key (verification appendix, section 4). Until a follower node confirms the sealed event, v4.7 is published but not attested on-chain.
3. No separate legal review of this revision was performed. v4.7 introduces no sale, distribution, liquidity incentive, yield program or tokenomics change (the cases for which Section 15 requires counsel review).
