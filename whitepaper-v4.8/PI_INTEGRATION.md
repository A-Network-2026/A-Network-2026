# Pi integration note

This companion to [whitepaper v4.8](WHITEPAPER_v4.8.md) documents the application integration. The published, attested whitepaper remains the reference for protocol and economic rules. See its [publication hash and attestation](TECHNICAL_VERIFICATION_APPENDIX_v4.8.md#3-publication-hash-and-on-chain-attestation).

## Pi Order Book

Pioneers sign in with Pi. A seller can create a Pi-priced order with a deliverable and due date, then share an invite. After the buyer accepts, the seller marks the order sent and the buyer confirms delivery. Participants can export visible records as CSV. The exported amount is the agreed price. Delivery confirmation comes from the buyer.

- [Mainnet deployment](https://orders.a-network.net/)
- [Staging deployment](https://a-network-order-book-staging.pages.dev/)

The backend verifies Pi access tokens against Pi's identity endpoint. Shared order records are stored in separate Cloudflare D1 databases for Mainnet and Staging. Personal records stay in the browser. The app has no payment, custody, swap, or token issuance flow.

## A Network utilities

The [.ant directory](../domains.html) resolves names against A Network's public read API. A name search can be shared as a URL without connecting a wallet. The registry and ANRC-20 remain native A Network Layer 1 modules. Refer to the published [.ant specification](ANT_DOMAINS_SPEC.md) and [ANRC-20 specification](ANRC20_SPEC.md) for protocol behavior.

The experimental Pi DEX sandbox is independent of the Order Book. The Order Book does not provide ANET/PI liquidity, bridge assets or grant ANRC-20 access. The one-way ANET export policy, issuance, vesting, and eligibility rules remain governed by the whitepaper.
