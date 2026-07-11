/**
 * abi.js — minimal ABIs for the mint/burn bridge components (ethers v6).
 * Only the fragments the relayer needs — keeps RPC decoding cheap.
 */
export const PORTAL_ABI = [
  // events
  'event BridgeIn(bytes32 indexed messageId, uint256 indexed srcChainId, address indexed recipient, uint256 amount, uint256 signaturesUsed, string memo)',
  'event BridgeOut(uint256 indexed outId, address indexed from, string l1Recipient, uint256 amount, uint256 spokeChainId, string memo)',
  // write
  'function bridgeIn((bytes32 messageId,uint256 srcChainId,address recipient,uint256 amount,uint256 deadline,string memo) req, bytes[] signatures)',
  // views
  'function mintConsumed(bytes32 messageId) view returns (bool)',
  'function threshold() view returns (uint256)',
  'function signers() view returns (address[])',
  'function maxPerTx() view returns (uint256)',
  'function paused() view returns (bool)',
  'function backingRequired() view returns (uint256)',
  'function reconciliation() view returns (uint256 spokeSupply, uint256 mintedIn, uint256 burnedOut)',
  'function WANET() view returns (address)',
];

export const WANET_ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];
