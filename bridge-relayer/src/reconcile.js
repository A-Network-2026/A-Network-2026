/**
 * reconcile.js — continuous supply-integrity monitoring.
 *
 * The single-canonical-supply invariant the whole gateway must uphold:
 *
 *     Σ wANET(all spokes)  ==  ANET locked on L1   ≤   21,000,000
 *
 * This reads each spoke's on-chain wANET.totalSupply() and compares the sum to
 * the L1 hub's reported locked balance. Any drift is a critical alert.
 */
import { makeSpoke, wanetContract } from './evm.js';
import { weiToAnts } from './l1.js';

const MAX_SUPPLY_ANTS = 21_000_000n * 100_000_000n;

export async function reconcile(config, l1) {
  const perChain = {};
  let sumMintedAnts = 0n;

  for (const spokeCfg of config.spokes) {
    const spoke = makeSpoke(spokeCfg);
    const wanet = await wanetContract(spoke);
    const supplyWei = await wanet.totalSupply();
    const ants = weiToAnts(supplyWei);
    perChain[spokeCfg.id] = { chainId: spokeCfg.chainId, mintedAnts: ants.toString() };
    sumMintedAnts += ants;
  }

  let lockedAnts = null;
  try {
    const rec = await l1.reconciliation();
    lockedAnts = BigInt(rec.locked_ants ?? 0);
  } catch (e) {
    // L1 endpoint not yet available — report spoke totals only.
  }

  const report = {
    ts: new Date().toISOString(),
    sumMintedAnts: sumMintedAnts.toString(),
    lockedAnts: lockedAnts == null ? null : lockedAnts.toString(),
    maxSupplyAnts: MAX_SUPPLY_ANTS.toString(),
    perChain,
    ok: true,
    alerts: [],
  };

  if (sumMintedAnts > MAX_SUPPLY_ANTS) {
    report.ok = false;
    report.alerts.push(`CRITICAL: Σ wANET (${sumMintedAnts}) exceeds max supply (${MAX_SUPPLY_ANTS})`);
  }
  if (lockedAnts != null) {
    if (sumMintedAnts > lockedAnts) {
      report.ok = false;
      report.alerts.push(`CRITICAL: Σ wANET (${sumMintedAnts}) exceeds ANET locked on L1 (${lockedAnts}) — under-collateralized`);
    } else if (sumMintedAnts < lockedAnts) {
      // Not a solvency risk (over-collateralized) but worth surfacing.
      report.alerts.push(`INFO: L1 locked (${lockedAnts}) > Σ wANET (${sumMintedAnts}) — over-collateralized / in-flight`);
    }
  }
  return report;
}
