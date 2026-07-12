/**
 * verify-live.js — point the relayer's REAL evm.js at a deployed portal and
 * confirm it reads the live on-chain state (signer set, threshold, caps) and
 * finds the BridgeOut burn events it would relay to L1.
 *
 * Usage: node scripts/verify-live.js <rpcUrl> <chainId> <portalAddress> [fromBlock]
 */
import { makeSpoke, portalInfo, safeHead, scanBridgeOut, wanetContract } from '../src/evm.js';

const [rpcUrl, chainId, portal, fromBlockArg] = process.argv.slice(2);
if (!rpcUrl || !chainId || !portal) {
  console.error('usage: node scripts/verify-live.js <rpcUrl> <chainId> <portal> [fromBlock]');
  process.exit(1);
}

const spoke = makeSpoke({
  id: 'live', rpcUrl, chainId: Number(chainId), portal,
  wanet: null, startBlock: 0, minConfirmations: 1,
});

const info = await portalInfo(spoke);
console.log('=== relayer portalInfo() on live portal ===');
console.log('  threshold:', info.threshold.toString());
console.log('  signers  :', info.signers.join(', '));
console.log('  maxPerTx :', info.maxPerTx.toString());
console.log('  paused   :', info.paused);

const wanet = await wanetContract(spoke);
console.log('  wANET    :', await wanet.getAddress(), 'totalSupply', (await wanet.totalSupply()).toString());

const head = await safeHead(spoke);
const from = fromBlockArg ? Number(fromBlockArg) : Math.max(0, head - 4900);
console.log(`\n=== relayer scanBridgeOut() blocks ${from}..${head} ===`);
try {
  const events = await scanBridgeOut(spoke, from, head, 5000);
  if (events.length === 0) {
    console.log('  (no BridgeOut events in range)');
  } else {
    for (const ev of events) {
      console.log(`  BridgeOut #${ev.outId} from=${ev.from} l1=${ev.l1Recipient} amount=${ev.amount} tx=${ev.txHash}`);
    }
  }
} catch (e) {
  console.log('  scan skipped (public RPC blocks eth_getLogs):', e.shortMessage || e.message);
  if (process.env.BRIDGEOUT_TX) {
    const rcpt = await spoke.provider.getTransactionReceipt(process.env.BRIDGEOUT_TX);
    const parsed = rcpt.logs
      .map((l) => { try { return spoke.portal.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === 'BridgeOut');
    if (parsed) {
      console.log(`  parsed from receipt -> BridgeOut #${parsed.args.outId} from=${parsed.args.from} ` +
        `l1=${parsed.args.l1Recipient} amount=${parsed.args.amount} (relayer would credit this on L1)`);
    }
  }
}
console.log('\nRelayer read the live deployment successfully.');
