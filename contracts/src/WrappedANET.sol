// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ WrappedANET (wANET) — bridge-controlled canonical wrapped ANET           ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║ The multi-chain representation of native Layer-1 ANET. One deployment    ║
 * ║ per spoke chain (Ethereum, BSC-new, and — via an equivalent SPL mint —   ║
 * ║ Solana). Minting and burning are controlled EXCLUSIVELY by an            ║
 * ║ AnetMintBurnPortal, which only mints against an M-of-N attested lock of  ║
 * ║ native ANET on the L1 hub, and only burns when a user bridges back.      ║
 * ║                                                                          ║
 * ║ SUPPLY INTEGRITY                                                         ║
 * ║   • Hard cap 21,000,000 wANET (== the ANET max supply). Mint can never   ║
 * ║     exceed it, so no single chain can inflate the canonical supply.      ║
 * ║   • Only the `bridge` can mint/burn. The bridge only mints 1:1 against   ║
 * ║     ANET locked on L1 and burns 1:1 when unlocking. Σ wANET(all chains)  ║
 * ║     therefore tracks ANET locked on L1.                                  ║
 * ║   • No owner mint, no arbitrary mint, no pause on transfers (censorship  ║
 * ║     resistant). Bridge rotation is admin-gated behind a 48h timelock.    ║
 * ║                                                                          ║
 * ║ Standards: ERC-20 + EIP-2612 permit (gasless approvals for bridge-out).  ║
 * ║ Self-contained (no imports) so block-explorer verification stays trivial.║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
contract WrappedANET {
    // ── ERC-20 metadata ────────────────────────────────────────────────────────
    string public constant name = "Wrapped ANET";
    string public constant symbol = "wANET";
    uint8  public constant decimals = 18;

    /// @notice Hard ceiling — identical to the ANET max supply. Enforced on mint.
    uint256 public constant MAX_SUPPLY = 21_000_000 ether;

    // ── ERC-20 state ───────────────────────────────────────────────────────────
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ── Roles ────────────────────────────────────────────────────────────────────
    /// @notice Sole address allowed to mint/burn (the AnetMintBurnPortal).
    address public bridge;
    /// @notice Governance address that can rotate the bridge behind a timelock.
    address public admin;
    address public pendingAdmin;

    uint256 public constant TIMELOCK_DELAY = 48 hours;
    address public pendingBridge;
    uint64  public pendingBridgeEta;
    /// @notice One-time genesis bridge handover flag (see setInitialBridge).
    bool public initialBridgeSet;

    // ── EIP-2612 permit ────────────────────────────────────────────────────────
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant _PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );
    mapping(address => uint256) public nonces;

    // ── Events ─────────────────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event BridgeRotationScheduled(address indexed newBridge, uint64 eta);
    event BridgeRotationExecuted(address indexed oldBridge, address indexed newBridge);
    event BridgeRotationCancelled(address indexed cancelledBridge);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferAccepted(address indexed oldAdmin, address indexed newAdmin);

    modifier onlyBridge() {
        require(msg.sender == bridge, "wANET: not bridge");
        _;
    }
    modifier onlyAdmin() {
        require(msg.sender == admin, "wANET: not admin");
        _;
    }

    constructor(address admin_, address bridge_) {
        require(admin_ != address(0), "wANET: admin=0");
        require(bridge_ != address(0), "wANET: bridge=0");
        admin = admin_;
        bridge = bridge_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ── ERC-20 ─────────────────────────────────────────────────────────────────
    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        _spendAllowance(from, msg.sender, value);
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "wANET: to=0");
        uint256 bal = balanceOf[from];
        require(bal >= value, "wANET: balance");
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    function _spendAllowance(address owner, address spender, uint256 value) internal {
        uint256 current = allowance[owner][spender];
        if (current != type(uint256).max) {
            require(current >= value, "wANET: allowance");
            unchecked { allowance[owner][spender] = current - value; }
        }
    }

    // ── EIP-2612 permit (gasless approve for bridge-out) ────────────────────────
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "wANET: permit expired");
        bytes32 structHash = keccak256(
            abi.encode(_PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == owner, "wANET: bad permit");
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    // ── Bridge mint/burn (sole supply mutation path) ────────────────────────────
    /// @notice Mint `amount` to `to`. Only the bridge, and only up to MAX_SUPPLY.
    function mint(address to, uint256 amount) external onlyBridge {
        require(to != address(0), "wANET: mint to 0");
        require(totalSupply + amount <= MAX_SUPPLY, "wANET: over max supply");
        totalSupply += amount;
        unchecked { balanceOf[to] += amount; }
        emit Transfer(address(0), to, amount);
    }

    /// @notice Burn `amount` from `from`, consuming the bridge's allowance.
    ///         The portal uses this on bridge-out after the user approves it.
    function burnFrom(address from, uint256 amount) external onlyBridge {
        _spendAllowance(from, msg.sender, amount);
        uint256 bal = balanceOf[from];
        require(bal >= amount, "wANET: burn exceeds balance");
        unchecked {
            balanceOf[from] = bal - amount;
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    // ── Admin: rotate bridge behind a 48h timelock ──────────────────────────────
    /// @notice One-time genesis handover: point the token at its portal exactly
    ///         once, while supply is still zero (so nothing can be stolen) and
    ///         before any timelocked rotation. This solves the deploy-order
    ///         circular dependency (portal needs the token address at
    ///         construction) without a 48h window in which the deployer key
    ///         could mint. After this, rotations require the 48h timelock.
    function setInitialBridge(address portal) external onlyAdmin {
        require(!initialBridgeSet, "wANET: initial bridge set");
        require(portal != address(0), "wANET: bridge=0");
        require(totalSupply == 0, "wANET: supply already minted");
        initialBridgeSet = true;
        bridge = portal;
        emit BridgeRotationExecuted(address(0), portal);
    }

    function scheduleBridgeRotation(address newBridge) external onlyAdmin {
        require(newBridge != address(0), "wANET: bridge=0");
        pendingBridge = newBridge;
        pendingBridgeEta = uint64(block.timestamp + TIMELOCK_DELAY);
        emit BridgeRotationScheduled(newBridge, pendingBridgeEta);
    }

    function executeBridgeRotation() external onlyAdmin {
        require(pendingBridge != address(0), "wANET: no pending bridge");
        require(block.timestamp >= pendingBridgeEta, "wANET: timelock");
        address old = bridge;
        bridge = pendingBridge;
        pendingBridge = address(0);
        pendingBridgeEta = 0;
        emit BridgeRotationExecuted(old, bridge);
    }

    function cancelBridgeRotation() external onlyAdmin {
        address cancelled = pendingBridge;
        pendingBridge = address(0);
        pendingBridgeEta = 0;
        emit BridgeRotationCancelled(cancelled);
    }

    // ── Admin transfer (2-step) ─────────────────────────────────────────────────
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "wANET: admin=0");
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "wANET: not pending admin");
        emit AdminTransferAccepted(admin, pendingAdmin);
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }
}
