# Deploy Day Checklist — AnetSwap v3.6 (printable)

Print this. Tick boxes with a pen. Keep it next to your screen.

Estimated cost: **~0.05 BNB** (~USD 30 at current price) for gas across
the whole sequence. No other cost.

Estimated wall-clock time: **~30 min active work + 48h wait + 30 min
active work + 48h wait + 30 min active work = ~5 days total**.

---

## ☐ T-1 day: Pre-flight

```bash
cd /Users/joeldupalco/Downloads/A-Network-2026/contracts
npx hardhat compile
npx hardhat test
shasum -a 256 src/AnetBridgeVault.sol src/AnetSwap.sol src/MockERC20.sol
```

Gates (stop if any fails):
- ☐ `Compiled 3 Solidity files successfully`
- ☐ `70 passing`
- ☐ Source hashes match `contracts/AUDIT_PACKAGE.md §1`
- ☐ Deployer EOA has ≥ 0.05 BNB

Addresses on paper (do not paste into a chat, do not photograph):
- ☐ `admin` (Safe) = `0x ___________________________________`
- ☐ `pauser` (HW wallet) = `0x ___________________________________`
- ☐ `operator` (pi-backend) = `0x ___________________________________`
- ☐ `feeRecipient` (Safe) = `0x ___________________________________`

---

## ☐ T+0 hour: Deploy

Edit `contracts/.env` with the four addresses above + your
`DEPLOYER_PRIVATE_KEY` (the deployer is just gas — has no authority).

```bash
cd /Users/joeldupalco/Downloads/A-Network-2026/contracts
npx hardhat run scripts/deploy.js --network bsc
```

Watch the output. If you see "WARNING: ... falling back to deployer",
☐ **press Ctrl-C immediately**. Otherwise:

- ☐ New contract address: `0x ________________________________`
- ☐ Deploy tx: `0x ________________________________`
- ☐ Block number: `__________`

Verify on BscScan "Read Contract" tab:
- ☐ `admin()` matches your Safe
- ☐ `pauser()` matches your HW wallet
- ☐ `operator()` matches pi-backend
- ☐ `feeRecipient()` matches your Safe
- ☐ `feeBps()` returns `100`
- ☐ `owner()` returns the same address as `admin()`
- ☐ `paused()` returns `false`

If ANY mismatch: ☐ abandon this address, ☐ redeploy, ☐ start checklist over.

---

## ☐ T+1 hour: Schedule token whitelist

```bash
TOKEN_SETUP_PHASE=schedule \
ANET_SWAP_ADDRESS=0x<new address> \
npx hardhat run scripts/setup-tokens.js --network bsc
```

- ☐ State file `.token-setup-56.json` created (chainId 56 = BSC mainnet)
- ☐ Copy state file to safe storage (NOT git): `cp .token-setup-56.json ~/anet-token-setup-$(date +%Y%m%d).json`
- ☐ Sign every "Schedule" Safe transaction with your co-signers
- ☐ Set **TWO** calendar reminders: T+48h (token whitelist execute) and T+48h+30min (post-execute verification)

---

## ☐ During the 48h wait: Drain v3.5

The old contract is `0x1A1AFE5BF1ffDB64aC10958cCe2D06B22Fb47Fb8`.

Step-by-step:

- ☐ On BscScan v3.5 "Write Contract" tab, owner key calls `pause()`
- ☐ Edit `A-Network-2026/dex.html` and `index.html`: replace v3.5 address with the new v3.6 address. `git add` + `commit` + `push`
- ☐ Open live site in a private browser window, view-source, confirm new address loaded
- ☐ On v3.5 "Read Contract", call `getPendingSwaps()` — record the list
- ☐ For each `processed=false` entry, have the operator key call `markProcessed(swapId, l1TxHash)`
- ☐ Re-run `getPendingSwaps()` — confirm empty
- ☐ On v3.5 "Write Contract", owner calls `withdrawNative()` — sweeps all BNB to owner EOA
- ☐ For each whitelisted token (USDT, USDC), owner calls `withdrawToken(tokenAddress)`
- ☐ From owner EOA, transfer the drained BNB + USDT + USDC into the new `feeRecipient` Safe
- ☐ Write in your operations log: "v3.5 contract paused, drained, abandoned on <date>"

Do NOT call `transferOwnership` on v3.5. Do NOT renounce v3.5. Just leave it paused, drained, and abandoned.

---

## ☐ T+48h: Execute token whitelist

```bash
cp ~/anet-token-setup-<date>.json /Users/joeldupalco/Downloads/A-Network-2026/contracts/.token-setup-56.json
cd /Users/joeldupalco/Downloads/A-Network-2026/contracts
TOKEN_SETUP_PHASE=execute \
ANET_SWAP_ADDRESS=0x<new address> \
npx hardhat run scripts/setup-tokens.js --network bsc
```

- ☐ Sign every "Execute" Safe transaction with your co-signers
- ☐ State file `.token-setup-56.json` is deleted automatically by the script
- ☐ On BscScan, call `tokens(USDT_ADDRESS)` and `tokens(USDC_ADDRESS)` — confirm `supported = true` and the min/max are what you scheduled

---

## ☐ T+48h: Schedule unpause

From the Safe, call `scheduleUnpause()` on the new v3.6 contract.

- ☐ Sign with co-signers
- ☐ Record the returned `id`: `0x ________________________________`
- ☐ Set calendar reminder for T+96h (the unpause execute)

---

## ☐ T+96h: Execute unpause

From the Safe, call `executeUnpause(id)` with the id from above.

- ☐ Sign with co-signers
- ☐ On BscScan, call `paused()` — must return `false`

---

## ☐ T+96h+15min: Acceptance test

From a stranger EOA (NOT admin / pauser / operator / deployer):

- ☐ Test 1: `swapNativeForAnet(1000000)` with `msg.value = 0.001 BNB` → expect success, `SwapInitiated` event, non-zero `swapId`
- ☐ Test 2: From operator EOA, `markProcessed(swapId, 0xdeadbeef...)` → expect success, `SwapProcessed` event
- ☐ Test 3: From a stranger EOA, `markProcessed(swapId, anything)` → expect revert "AnetSwap: not operator"
- ☐ Test 4: From the pauser EOA, attempt `executeUnpause(any id)` → expect revert "AnetSwap: not admin"

If all 4 pass: ☐ deploy is complete and correctly bound.

If any fails: ☐ pause via Safe `pause()`, ☐ revert frontend to v3.5, ☐ unpause v3.5 from the old owner key, ☐ file incident note, ☐ contact me.

---

## ☐ T+96h+30min: Notify

Send me a single message with:

```
v3.6 deployed and accepted.
- Address: 0x________________________________
- Deploy tx: 0x________________________________
- Block: __________
- Acceptance tests: 4/4 pass
```

I will then:
- ☐ Flip scorecard #6 from 🟡 IN PROGRESS to ✅ DONE
- ☐ Update the v3.6 changelog to point at the live address
- ☐ Update the audit package "deployed addresses" table
- ☐ Commit + push

---

## Rollback (if anything goes wrong)

At any point before the v3.5 drain, you can abort and stay on v3.5
forever. The v3.6 contract is harmless if left paused.

After the v3.5 drain, rollback means redeploying v3.5 from source
(`git checkout` an earlier commit) and re-funding from the
fee-recipient Safe. This is recoverable but painful — which is why
the §"During the 48h wait" sequence has the **drain at the END** of
the wait window, not at the beginning. Don't drain until you've
verified the new contract is healthy.

---

## Emergency contacts

- ☐ Your co-signer 1: ____________________________
- ☐ Your co-signer 2: ____________________________
- ☐ BSC RPC backup: https://bsc-dataseed1.defibit.io/
- ☐ Etherscan/BscScan support: support@bscscan.com
- ☐ Project incident inbox: security@a-network.dev
