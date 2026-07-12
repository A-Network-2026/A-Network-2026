/**
 * attest-solana.js — EIP-712 attestation for the Solana `anet_portal.bridge_in`.
 *
 * The Solana program verifies the SAME Ethereum-style secp256k1 signatures as
 * the EVM spokes, so the SAME relayer signer keys attest for Solana. The typed
 * struct is Solana-specific:
 *
 *   domain: name="AnetMintBurnPortalSolana", version="1",
 *           chainId=<eip712_chain_id set at init>,
 *           verifyingContract=<20-byte eip712_verifying_contract set at init>
 *   BridgeInSol(bytes32 messageId,uint256 srcChainId,bytes32 recipient,uint256 amount,uint256 deadline)
 *
 *   • recipient is the 32-byte Solana pubkey (NOT a 20-byte EVM address).
 *   • amount is in 8-decimal base units (== L1 ANTS), 1:1 with the SPL wANET.
 *
 * MUST match programs/anet_portal/src/lib.rs `PortalConfig::bridge_in_digest`.
 */
import { ethers } from 'ethers';

export { computeMessageId } from './attest.js';

export const SOL_DOMAIN_NAME = 'AnetMintBurnPortalSolana';
export const SOL_DOMAIN_VERSION = '1';

export const BRIDGE_IN_SOL_TYPES = {
  BridgeInSol: [
    { name: 'messageId', type: 'bytes32' },
    { name: 'srcChainId', type: 'uint256' },
    { name: 'recipient', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

/**
 * @param {number|bigint} eip712ChainId  the chain id bound into the domain at init
 * @param {string} verifyingContract     20-byte id (0x-hex) bound at init
 */
export function solDomain(eip712ChainId, verifyingContract) {
  return {
    name: SOL_DOMAIN_NAME,
    version: SOL_DOMAIN_VERSION,
    chainId: BigInt(eip712ChainId),
    verifyingContract: ethers.getAddress(verifyingContract),
  };
}

/** The 5 signed fields. `recipient` is the 32-byte Solana pubkey (0x-hex). */
export function solMessage({ messageId, srcChainId, recipient, amount, deadline }) {
  return {
    messageId,
    srcChainId: BigInt(srcChainId),
    recipient: toBytes32Hex(recipient),
    amount: BigInt(amount),
    deadline: BigInt(deadline),
  };
}

export async function signBridgeInSolana(wallet, attestation) {
  const { eip712ChainId, verifyingContract } = attestation;
  return wallet.signTypedData(
    solDomain(eip712ChainId, verifyingContract),
    BRIDGE_IN_SOL_TYPES,
    solMessage(attestation),
  );
}

export function recoverBridgeInSolana(sig, attestation) {
  const { eip712ChainId, verifyingContract } = attestation;
  return ethers.verifyTypedData(
    solDomain(eip712ChainId, verifyingContract),
    BRIDGE_IN_SOL_TYPES,
    solMessage(attestation),
    sig,
  );
}

/**
 * Aggregate [{ signer, sig }] into the 65-byte r‖s‖v arrays the program expects,
 * sorted STRICTLY ASCENDING by signer address (the on-chain loop enforces this).
 */
export function aggregateSolana(signed) {
  return [...signed]
    .sort((a, b) => (BigInt(a.signer.toLowerCase()) < BigInt(b.signer.toLowerCase()) ? -1 : 1))
    .map((x) => Array.from(ethers.getBytes(x.sig)));
}

/** Verify a bundle: returns the unique valid signer count for `attestation`. */
export function countValidSignersSolana(signed, attestation, allowedSigners) {
  const allow = new Set(allowedSigners.map((a) => a.toLowerCase()));
  const seen = new Set();
  let n = 0;
  for (const { sig } of signed) {
    let recovered;
    try { recovered = recoverBridgeInSolana(sig, attestation); } catch { continue; }
    const key = recovered.toLowerCase();
    if (allow.has(key) && !seen.has(key)) { seen.add(key); n++; }
  }
  return n;
}

/**
 * Normalize a Solana recipient (base58 pubkey OR 0x-hex) to a 0x 32-byte hex
 * string for the bytes32 field.
 */
export function toBytes32Hex(recipient) {
  if (typeof recipient === 'string' && recipient.startsWith('0x')) {
    const bytes = ethers.getBytes(recipient);
    if (bytes.length !== 32) throw new Error('recipient hex must be 32 bytes');
    return ethers.hexlify(bytes);
  }
  // base58 Solana address → 32 bytes
  const bytes = base58Decode(String(recipient));
  if (bytes.length !== 32) throw new Error('recipient pubkey must decode to 32 bytes');
  return ethers.hexlify(bytes);
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(str) {
  let num = 0n;
  for (const ch of str) {
    const idx = B58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base58 char: ${ch}`);
    num = num * 58n + BigInt(idx);
  }
  // to bytes (big-endian)
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let bytes = hex.length ? Array.from(Buffer.from(hex, 'hex')) : [];
  // restore leading zero bytes (each leading '1' in base58 == one 0x00 byte)
  for (const ch of str) {
    if (ch === '1') bytes.unshift(0);
    else break;
  }
  return Uint8Array.from(bytes);
}
