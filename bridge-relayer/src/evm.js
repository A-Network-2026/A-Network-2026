/**
 * evm.js — per-spoke EVM access: providers, contracts, event scanning, submit.
 */
import { ethers } from 'ethers';
import { PORTAL_ABI, WANET_ABI } from './abi.js';

export function makeSpoke(spokeCfg) {
  const provider = new ethers.JsonRpcProvider(spokeCfg.rpcUrl, spokeCfg.chainId);
  const portal = new ethers.Contract(spokeCfg.portal, PORTAL_ABI, provider);
  return { cfg: spokeCfg, provider, portal };
}

export async function wanetContract(spoke) {
  const addr = spoke.cfg.wanet || (await spoke.portal.WANET());
  return new ethers.Contract(addr, WANET_ABI, spoke.provider);
}

export async function portalInfo(spoke) {
  const [threshold, signers, maxPerTx, paused] = await Promise.all([
    spoke.portal.threshold(),
    spoke.portal.signers(),
    spoke.portal.maxPerTx(),
    spoke.portal.paused(),
  ]);
  return { threshold, signers, maxPerTx, paused };
}

export async function safeHead(spoke) {
  const head = await spoke.provider.getBlockNumber();
  return Math.max(0, head - spoke.cfg.minConfirmations);
}

/**
 * Scan `BridgeOut` events (user burned wANET on this spoke → must unlock native
 * ANET on L1) across [fromBlock, toBlock] in chunks.
 */
export async function scanBridgeOut(spoke, fromBlock, toBlock, chunk) {
  const out = [];
  const filter = spoke.portal.filters.BridgeOut();
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = Math.min(start + chunk - 1, toBlock);
    const logs = await spoke.portal.queryFilter(filter, start, end);
    for (const log of logs) {
      out.push({
        outId: log.args.outId,
        from: log.args.from,
        l1Recipient: log.args.l1Recipient,
        amount: log.args.amount,
        spokeChainId: log.args.spokeChainId,
        memo: log.args.memo,
        txHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: log.blockNumber,
      });
    }
  }
  return out;
}

export async function isMintConsumed(spoke, messageId) {
  return spoke.portal.mintConsumed(messageId);
}

/** Aggregate M-of-N sigs and submit portal.bridgeIn from `wallet`. */
export async function submitBridgeIn(spoke, wallet, req, sigs) {
  const signer = wallet.connect(spoke.provider);
  const withSigner = spoke.portal.connect(signer);
  const tx = await withSigner.bridgeIn(req, sigs);
  return tx.wait();
}
