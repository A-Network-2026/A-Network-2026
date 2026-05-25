# Co-founder 10.5M wANET → AnetBridgeVault deposit instructions

**Audience:** [@Digitalgold1979](https://x.com/Digitalgold1979) (co-founder, 50% founder allocation holder)
**Goal:** Move the entire co-founder 50% wANET allocation (~10,499,798 wANET) from a hot EOA into the AnetBridgeVault smart-contract custody.
**Reference:** Whitepaper v3.4 § v3.3 AnetBridgeVault. Joel's mirror deposit was completed on May 25, 2026.

---

## Why we're doing this

Both founder allocations are currently held as ordinary BEP-20 balances in hot wallets. That's a single-key risk per founder. After this deposit:

- wANET is held by **AnetBridgeVault** (`0x31438362a7667ce5559500023D025c7c14168B49`).
- Releases require a **2-of-3 EIP-712 multisig**.
- Even the vault admin cannot withdraw wANET (rescue is blocked on the vault asset).
- Per-tx release cap: 10,000 wANET. Per-recipient/24h cap: 50,000. Global/24h cap: 250,000.
- Result: no single founder key can move the treasury. Bitcoin principle.

---

## Pre-flight checklist

1. **Confirm the source address** holding your 50% allocation (BSC mainnet, wANET balance ≈ 10,499,798 ANET). On BscScan:
   `https://bscscan.com/token/0x791055A7d52AA392eaE8De04250497f33807E46A?a=<YOUR_ADDRESS>`
2. **Confirm you control the private key / hardware wallet** that signs for that address.
3. **Have a small BNB balance** in that address for gas (a few cents of BNB is enough).
4. **Verify the vault address** before signing:
   `0x31438362a7667ce5559500023D025c7c14168B49`
   Cross-check with whitepaper, A-Network site, or a direct message from Joel. Do not trust an address pasted into chat from any other source.

---

## Recommended method — BscScan "Write Contract"

This is the safest because the function and parameters are explicitly shown on the hardware wallet screen.

1. Open:
   `https://bscscan.com/address/0x791055A7d52AA392eaE8De04250497f33807E46A#writeContract`

2. Click **"Connect to Web3"** at the top of the function list. Connect the wallet that controls your 50% allocation.

3. Find the `transfer` function and expand it. Fill in:

   | Field | Value |
   |---|---|
   | `_to (address)` | `0x31438362a7667ce5559500023D025c7c14168B49` |
   | `_value (uint256)` | the integer-wei amount of your full balance |

4. To get the exact integer-wei value, run this in any browser console (no website needed, just `F12`):
   ```js
   // Replace ADDRESS with your address, then visit
   //   https://bscscan.com/token/0x791055A7d52AA392eaE8De04250497f33807E46A?a=ADDRESS
   // and copy the raw balance from the contract.
   ```
   Or ask Joel — he'll pull the exact wei balance from BscScan and send it to you.

5. Click **Write** → approve in your wallet → confirm on the hardware wallet.

6. **On the hardware wallet display, verify:**
   - Contract: `0x791055A7…E46A` (wANET, the token contract — this is correct; ERC-20 transfers always call the token contract)
   - Function: `transfer`
   - Recipient: `0x31438362…14168B49` (the vault)
   - Amount: matches your full balance

7. Sign. Wait for confirmation. Send the transaction hash to Joel.

---

## Alternative method — MetaMask "Send Token"

1. In MetaMask, switch to **BSC mainnet** and select the account holding your 50%.
2. Make sure **wANET** is added as a custom token (contract `0x791055A7d52AA392eaE8De04250497f33807E46A`, symbol ANET, 18 decimals).
3. Click **Send** from the wANET balance.
4. Recipient: `0x31438362a7667ce5559500023D025c7c14168B49`
5. Amount: tap **Max** (deposits the full balance).
6. Confirm on hardware wallet. Same fields to verify as above.

---

## Do NOT use

- **A "raw transaction" / "custom data" screen on a mobile wallet.** Mobile wallets often won't accept pasted calldata correctly. Use a normal token Send screen or BscScan Write Contract.
- **A self-send to your own address.** If From and To match, the transfer did not move funds. Joel's first 2 attempts on May 25 made this mistake; do not repeat it.
- **An address shorter or different from `0x31438362a7667ce5559500023D025c7c14168B49`.** Bridge scammers commonly post lookalike vault addresses. The official one is on the whitepaper at https://a-network.io/whitepaper.html#bridge-vault and on the vault verification page on BscScan.

---

## After the deposit

Joel will run these on-chain reads to confirm:

```bash
# Vault should show ~21M wANET total after both founder halves are in.
curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_call",
    "params":[{"to":"0x31438362a7667ce5559500023D025c7c14168B49",
               "data":"0x0bf6cc08"},"latest"],"id":1}' \
  https://bsc-dataseed.binance.org/
```

When both halves are escrowed, the whitepaper will be updated again (v3.4 → v3.5 milestone row) and the `ANET_BRIDGE_BURN_ENABLED` flag can be enabled in stages on the L1 burn endpoint.

---

## If anything looks wrong

Cancel the transaction before signing. Don't proceed. Reach out to Joel directly through a verified channel.
