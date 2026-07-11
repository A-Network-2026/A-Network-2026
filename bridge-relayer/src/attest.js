/**
 * attest.js — EIP-712 attestation for AnetMintBurnPortal.bridgeIn
 *
 * MUST match the on-chain domain/typehash exactly:
 *   domain: name="AnetMintBurnPortal", version="1", chainId=<spoke chainId>,
 *           verifyingContract=<portal address>
 *   BridgeIn(bytes32 messageId,uint256 srcChainId,address recipient,uint256 amount,uint256 deadline)
 *
 * Each independent M-of-N signer produces a signature over the SAME message.
 * The submitter aggregates them sorted ascending by signer address (the
 * contract requires strictly-ascending, unique signers).
 */
import { ethers } from 'ethers';

export const DOMAIN_NAME = 'AnetMintBurnPortal';
export const DOMAIN_VERSION = '1';

export const BRIDGE_IN_TYPES = {
  BridgeIn: [
    { name: 'messageId', type: 'bytes32' },
    { name: 'srcChainId', type: 'uint256' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export function domain(portalAddress, spokeChainId) {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: BigInt(spokeChainId),
    verifyingContract: ethers.getAddress(portalAddress),
  };
}

/** The 5 signed fields (memo is transparency-only and NOT signed). */
export function message({ messageId, srcChainId, recipient, amount, deadline }) {
  return {
    messageId,
    srcChainId: BigInt(srcChainId),
    recipient: ethers.getAddress(recipient),
    amount: BigInt(amount),
    deadline: BigInt(deadline),
  };
}

export async function signBridgeIn(wallet, attestation) {
  const { portalAddress, spokeChainId } = attestation;
  return wallet.signTypedData(domain(portalAddress, spokeChainId), BRIDGE_IN_TYPES, message(attestation));
}

export function recoverBridgeIn(sig, attestation) {
  const { portalAddress, spokeChainId } = attestation;
  return ethers.verifyTypedData(domain(portalAddress, spokeChainId), BRIDGE_IN_TYPES, message(attestation), sig);
}

/**
 * Deterministic, globally-unique message id for a cross-chain transfer.
 * Binding srcChainId + srcTxHash + srcLogIndex guarantees the same L1 lock (or
 * spoke burn) maps to exactly one messageId, so the portal's per-message dedup
 * makes replay impossible even across chains.
 */
export function computeMessageId(srcChainId, srcTxHash, srcLogIndex) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['uint256', 'bytes32', 'uint256'],
      [BigInt(srcChainId), srcTxHash, BigInt(srcLogIndex)]
    )
  );
}

/** Sort [{ signer, sig }] ascending by signer address → bytes[] for bridgeIn. */
export function aggregate(signed) {
  return [...signed]
    .sort((a, b) => (BigInt(a.signer.toLowerCase()) < BigInt(b.signer.toLowerCase()) ? -1 : 1))
    .map((x) => x.sig);
}

/** Verify a bundle: returns the unique valid signer count for `attestation`. */
export function countValidSigners(signed, attestation, allowedSigners) {
  const allow = new Set(allowedSigners.map((a) => a.toLowerCase()));
  const seen = new Set();
  let n = 0;
  for (const { sig } of signed) {
    let recovered;
    try { recovered = recoverBridgeIn(sig, attestation); } catch { continue; }
    const key = recovered.toLowerCase();
    if (allow.has(key) && !seen.has(key)) { seen.add(key); n++; }
  }
  return n;
}
