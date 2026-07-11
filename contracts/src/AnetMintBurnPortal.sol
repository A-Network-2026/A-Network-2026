// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ AnetMintBurnPortal — canonical L1 ⇆ spoke-chain bridge (mint & burn)     ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║ One deployment per EVM spoke chain (Ethereum, and a new mint/burn wANET  ║
 * ║ on BSC). Controls a WrappedANET token and is the ONLY minter/burner.     ║
 * ║                                                                          ║
 * ║   • BRIDGE-IN  (L1 → this chain): native ANET is LOCKED on the L1 hub.   ║
 * ║     M-of-N relayers sign an EIP-712 attestation of that lock and call    ║
 * ║     `bridgeIn`, which MINTS the same amount of wANET to the recipient.   ║
 * ║     Each attestation `messageId` mints at most once (replay-proof).      ║
 * ║   • BRIDGE-OUT (this chain → L1): a user calls `bridgeOut`, which BURNS  ║
 * ║     their wANET and emits `BridgeOut`. Relayers observe it and UNLOCK    ║
 * ║     the same amount of native ANET on L1. Permissionless — no approval   ║
 * ║     gate beyond the user's own signature/allowance.                      ║
 * ║                                                                          ║
 * ║ SINGLE CANONICAL SUPPLY                                                  ║
 * ║   wANET is minted 1:1 only against ANET locked on L1 and burned 1:1 on   ║
 * ║   the way back. Therefore  Σ wANET(all spokes) == ANET locked on L1,     ║
 * ║   and the WrappedANET hard cap (21,000,000) means no chain can inflate   ║
 * ║   the canonical supply. `messageId` dedup prevents double-mint.          ║
 * ║                                                                          ║
 * ║ SECURITY (mirrors AnetL2Portal / AnetBridgeVault, audited 2026-06-11)     ║
 * ║   1. Mint only via M-of-N EIP-712 signatures over a unique messageId.    ║
 * ║   2. Per-message dedup — one mint per attested L1 lock.                  ║
 * ║   3. Per-tx, per-recipient rolling-24h and global rolling-24h mint caps. ║
 * ║   4. EIP-2 low-s enforcement; ascending unique signer check.            ║
 * ║   5. Emergency pause via a SEPARATE cold pauser key.                     ║
 * ║   6. Admin (Safe) param changes gated by a 48h timelock + 14d grace.     ║
 * ║   7. chainId bound into the EIP-712 domain — a signature for one spoke   ║
 * ║      chain can never be replayed on another.                            ║
 * ║                                                                          ║
 * ║ MODULARITY                                                              ║
 * ║   Additional spoke chains reuse this exact contract (new deploy + new    ║
 * ║   WrappedANET). Stablecoins (USDT/USDC) use a separate lock/release      ║
 * ║   vault since they have their own native supply — never minted here.     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

interface IWrappedANET {
    function mint(address to, uint256 amount) external;
    function burnFrom(address from, uint256 amount) external;
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;
    modifier nonReentrant() {
        require(_status != _ENTERED, "Portal: reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

contract AnetMintBurnPortal is ReentrancyGuard {
    // ── Constants ─────────────────────────────────────────────────────────────
    IWrappedANET public immutable WANET;

    uint256 public constant MAX_SIGNERS = 16;
    uint256 public constant TIMELOCK_DELAY = 48 hours;
    uint256 public constant EXECUTION_GRACE = 14 days;
    uint256 public constant MAX_MEMO_BYTES = 256;
    uint256 public constant MAX_L1_ADDR_BYTES = 64;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant _BRIDGE_IN_TYPEHASH = keccak256(
        "BridgeIn(bytes32 messageId,uint256 srcChainId,address recipient,uint256 amount,uint256 deadline)"
    );

    /// @notice L1→spoke mint attestation. `memo` is transparency-only (unsigned).
    struct MintReq {
        bytes32 messageId; // unique id of the attested L1 lock (mints once)
        uint256 srcChainId; // L1 hub chain id the lock happened on
        address recipient; // spoke-chain address that receives minted wANET
        uint256 amount;    // wANET to mint (18 decimals) == ANET locked on L1
        uint256 deadline;  // unix time after which signatures are invalid
        string  memo;      // human-readable note (≤256B), e.g. L1 lock tx link
    }

    // ── Roles ─────────────────────────────────────────────────────────────────
    address public admin;
    address public pendingAdmin;
    address public pauser;
    bool    public paused;

    mapping(address => bool) public isSigner;
    address[] private _signerList;
    uint256 public threshold;

    // ── Caps (18-decimal wANET wei) — applied to MINTS (bridge-in) ─────────────
    uint256 public maxPerTx;
    uint256 public maxPerRecipient24h;
    uint256 public maxGlobal24h;

    // ── Accounting ──────────────────────────────────────────────────────────────
    uint256 public bridgeOutCount;
    uint256 public totalMinted;   // cumulative wANET minted via bridge-in
    uint256 public totalBurned;   // cumulative wANET burned via bridge-out
    mapping(bytes32 => bool) public mintConsumed; // messageId => minted

    uint256 private constant _WINDOW_HOURS = 24;
    struct HourSlot { uint64 hour; uint192 amount; }
    HourSlot[24] private _globalSlots;
    mapping(address => HourSlot[24]) private _recipientSlots;

    // ── Transparency ────────────────────────────────────────────────────────────
    string public l1ExplorerBase;    // e.g. "https://explorer.a-network.net/tx/"
    string public spokeExplorerBase; // e.g. "https://etherscan.io/tx/"
    string public backingStatement;  // e.g. "wANET is 1:1 backed by ANET locked on L1."

    // ── Timelock ────────────────────────────────────────────────────────────────
    struct PendingChange { bytes32 valueHash; uint64 eta; bool exists; }
    mapping(bytes32 => PendingChange) public pending;

    bytes32 public constant PARAM_SIGNERS = keccak256("SIGNERS");
    bytes32 public constant PARAM_CAPS    = keccak256("CAPS");
    bytes32 public constant PARAM_PAUSER  = keccak256("PAUSER");

    // ── Events ────────────────────────────────────────────────────────────────
    event BridgeIn(
        bytes32 indexed messageId,
        uint256 indexed srcChainId,
        address indexed recipient,
        uint256 amount,
        uint256 signaturesUsed,
        string  memo
    );
    event BridgeOut(
        uint256 indexed outId,
        address indexed from,
        string  l1Recipient,
        uint256 amount,
        uint256 spokeChainId,
        string  memo
    );
    event SignerSetUpdated(address[] signers, uint256 threshold);
    event CapsUpdated(uint256 maxPerTx, uint256 maxPerRecipient24h, uint256 maxGlobal24h);
    event PauserUpdated(address indexed oldPauser, address indexed newPauser);
    event PausedBy(address indexed who);
    event UnpausedBy(address indexed who);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferAccepted(address indexed oldAdmin, address indexed newAdmin);
    event ChangeScheduled(bytes32 indexed paramKey, uint64 eta);
    event ChangeExecuted(bytes32 indexed paramKey);
    event ChangeCancelled(bytes32 indexed paramKey);
    event TransparencyUpdated(string l1ExplorerBase, string spokeExplorerBase, string backingStatement);

    modifier onlyAdmin() { require(msg.sender == admin, "Portal: not admin"); _; }
    modifier whenNotPaused() { require(!paused, "Portal: paused"); _; }

    constructor(
        IWrappedANET wanet_,
        address admin_,
        address pauser_,
        address[] memory initialSigners,
        uint256 initialThreshold,
        uint256 maxPerTx_,
        uint256 maxPerRecipient24h_,
        uint256 maxGlobal24h_
    ) {
        require(address(wanet_) != address(0), "Portal: token=0");
        require(admin_ != address(0),  "Portal: admin=0");
        require(pauser_ != address(0), "Portal: pauser=0");
        WANET  = wanet_;
        admin  = admin_;
        pauser = pauser_;
        _setSignerSet(initialSigners, initialThreshold);
        _setCaps(maxPerTx_, maxPerRecipient24h_, maxGlobal24h_);
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("AnetMintBurnPortal")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BRIDGE-OUT (this chain → L1): burn wANET, emit for L1 unlock. Permissionless.
    // ─────────────────────────────────────────────────────────────────────────
    function bridgeOut(uint256 amount, string calldata l1Recipient, string calldata memo)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 outId)
    {
        require(amount > 0, "Portal: amount=0");
        uint256 rl = bytes(l1Recipient).length;
        require(rl > 0 && rl <= MAX_L1_ADDR_BYTES, "Portal: bad l1 recipient");
        require(bytes(memo).length <= MAX_MEMO_BYTES, "Portal: memo too long");

        // Burns the user's wANET (user approved this portal, or used permit()).
        WANET.burnFrom(msg.sender, amount);

        unchecked { outId = ++bridgeOutCount; }
        totalBurned += amount;

        emit BridgeOut(outId, msg.sender, l1Recipient, amount, block.chainid, memo);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BRIDGE-IN (L1 → this chain): mint wANET against an M-of-N attested L1 lock.
    // ─────────────────────────────────────────────────────────────────────────
    function bridgeIn(MintReq calldata req, bytes[] calldata signatures)
        external
        nonReentrant
        whenNotPaused
    {
        require(req.recipient != address(0),      "Portal: recipient=0");
        require(req.amount > 0,                    "Portal: amount=0");
        require(block.timestamp <= req.deadline,   "Portal: expired");
        require(!mintConsumed[req.messageId],      "Portal: message used");
        require(req.amount <= maxPerTx,            "Portal: > per-tx cap");
        require(bytes(req.memo).length <= MAX_MEMO_BYTES, "Portal: memo too long");

        _accrueAndCheck(_globalSlots, req.amount, maxGlobal24h);
        _accrueAndCheck(_recipientSlots[req.recipient], req.amount, maxPerRecipient24h);

        uint256 used = _verifySignatures(_bridgeInDigest(req), signatures);
        require(used >= threshold, "Portal: not enough signatures");

        mintConsumed[req.messageId] = true;
        totalMinted += req.amount;

        WANET.mint(req.recipient, req.amount);

        emit BridgeIn(req.messageId, req.srcChainId, req.recipient, req.amount, used, req.memo);
    }

    function _bridgeInDigest(MintReq calldata req) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                _BRIDGE_IN_TYPEHASH,
                req.messageId,
                req.srcChainId,
                req.recipient,
                req.amount,
                req.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    // ── Signature verification (M-of-N, ascending unique, EIP-2 low-s) ──────────
    function _verifySignatures(bytes32 digest, bytes[] calldata signatures)
        internal
        view
        returns (uint256 uniqueValid)
    {
        address last = address(0);
        for (uint256 i = 0; i < signatures.length; i++) {
            address recovered = _recover(digest, signatures[i]);
            require(recovered != address(0), "Portal: bad sig");
            require(isSigner[recovered],     "Portal: not a signer");
            require(recovered > last,        "Portal: sigs not sorted/unique");
            last = recovered;
            unchecked { uniqueValid++; }
        }
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }

    // ── Rolling 24h caps (24× 1-hour circular slots) ────────────────────────────
    function _windowSum(HourSlot[24] storage slots, uint64 currentHour)
        internal
        view
        returns (uint256 sum)
    {
        uint64 cutoff = currentHour >= 23 ? currentHour - 23 : 0;
        for (uint256 i = 0; i < _WINDOW_HOURS; i++) {
            HourSlot storage s = slots[i];
            if (s.hour >= cutoff && s.hour <= currentHour) {
                sum += uint256(s.amount);
            }
        }
    }

    function _accrueAndCheck(HourSlot[24] storage slots, uint256 amount, uint256 cap) internal {
        uint64 currentHour = uint64(block.timestamp / 1 hours);
        uint256 running = _windowSum(slots, currentHour) + amount;
        require(running <= cap, "Portal: > 24h cap");
        uint256 idx = currentHour % _WINDOW_HOURS;
        HourSlot storage slot = slots[idx];
        if (slot.hour == currentHour) {
            slot.amount = uint192(uint256(slot.amount) + amount);
        } else {
            slot.hour = currentHour;
            slot.amount = uint192(amount);
        }
    }

    // ── Views ────────────────────────────────────────────────────────────────
    /// @notice Current wANET supply on this spoke — the exact ANET amount that
    ///         must be locked on the L1 hub to back it 1:1.
    function backingRequired() external view returns (uint256) {
        return WANET.totalSupply();
    }

    function signers() external view returns (address[] memory) {
        return _signerList;
    }

    function reconciliation()
        external
        view
        returns (uint256 spokeSupply, uint256 mintedIn, uint256 burnedOut)
    {
        return (WANET.totalSupply(), totalMinted, totalBurned);
    }

    // ── Pause (separate cold key) ───────────────────────────────────────────────
    function pause() external {
        require(msg.sender == pauser || msg.sender == admin, "Portal: not pauser");
        paused = true;
        emit PausedBy(msg.sender);
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit UnpausedBy(msg.sender);
    }

    // ── Admin transfer (2-step) ─────────────────────────────────────────────────
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Portal: zero admin");
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "Portal: not pending admin");
        emit AdminTransferAccepted(admin, pendingAdmin);
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }

    function setTransparency(
        string calldata l1ExplorerBase_,
        string calldata spokeExplorerBase_,
        string calldata backingStatement_
    ) external onlyAdmin {
        l1ExplorerBase = l1ExplorerBase_;
        spokeExplorerBase = spokeExplorerBase_;
        backingStatement = backingStatement_;
        emit TransparencyUpdated(l1ExplorerBase_, spokeExplorerBase_, backingStatement_);
    }

    // ── Timelocked parameter changes (48h delay + 14d grace) ────────────────────
    function _schedule(bytes32 paramKey, bytes32 valueHash) internal {
        uint64 eta = uint64(block.timestamp + TIMELOCK_DELAY);
        pending[paramKey] = PendingChange(valueHash, eta, true);
        emit ChangeScheduled(paramKey, eta);
    }

    function _consume(bytes32 paramKey, bytes32 valueHash) internal {
        PendingChange memory p = pending[paramKey];
        require(p.exists, "Portal: nothing scheduled");
        require(p.valueHash == valueHash, "Portal: arg mismatch");
        require(block.timestamp >= p.eta, "Portal: timelock");
        require(block.timestamp <= p.eta + EXECUTION_GRACE, "Portal: change expired");
        delete pending[paramKey];
        emit ChangeExecuted(paramKey);
    }

    function cancelChange(bytes32 paramKey) external onlyAdmin {
        require(pending[paramKey].exists, "Portal: nothing scheduled");
        delete pending[paramKey];
        emit ChangeCancelled(paramKey);
    }

    function scheduleSignerSet(address[] calldata newSigners, uint256 newThreshold) external onlyAdmin {
        _schedule(PARAM_SIGNERS, keccak256(abi.encode(newSigners, newThreshold)));
    }

    function executeSignerSet(address[] calldata newSigners, uint256 newThreshold) external onlyAdmin {
        _consume(PARAM_SIGNERS, keccak256(abi.encode(newSigners, newThreshold)));
        _setSignerSet(newSigners, newThreshold);
    }

    function scheduleCaps(uint256 maxPerTx_, uint256 maxPerRecipient24h_, uint256 maxGlobal24h_) external onlyAdmin {
        _schedule(PARAM_CAPS, keccak256(abi.encode(maxPerTx_, maxPerRecipient24h_, maxGlobal24h_)));
    }

    function executeCaps(uint256 maxPerTx_, uint256 maxPerRecipient24h_, uint256 maxGlobal24h_) external onlyAdmin {
        _consume(PARAM_CAPS, keccak256(abi.encode(maxPerTx_, maxPerRecipient24h_, maxGlobal24h_)));
        _setCaps(maxPerTx_, maxPerRecipient24h_, maxGlobal24h_);
    }

    function schedulePauser(address newPauser) external onlyAdmin {
        _schedule(PARAM_PAUSER, keccak256(abi.encode(newPauser)));
    }

    function executePauser(address newPauser) external onlyAdmin {
        _consume(PARAM_PAUSER, keccak256(abi.encode(newPauser)));
        require(newPauser != address(0), "Portal: pauser=0");
        emit PauserUpdated(pauser, newPauser);
        pauser = newPauser;
    }

    // ── Internal setters ────────────────────────────────────────────────────────
    function _setSignerSet(address[] memory newSigners, uint256 newThreshold) internal {
        uint256 n = newSigners.length;
        require(n > 0 && n <= MAX_SIGNERS, "Portal: bad signer count");
        require(newThreshold > 0 && newThreshold <= n, "Portal: bad threshold");

        // clear previous
        for (uint256 i = 0; i < _signerList.length; i++) {
            isSigner[_signerList[i]] = false;
        }
        delete _signerList;

        address last = address(0);
        for (uint256 i = 0; i < n; i++) {
            address sgn = newSigners[i];
            require(sgn != address(0), "Portal: signer=0");
            require(sgn > last, "Portal: signers not sorted/unique");
            last = sgn;
            isSigner[sgn] = true;
            _signerList.push(sgn);
        }
        threshold = newThreshold;
        emit SignerSetUpdated(newSigners, newThreshold);
    }

    function _setCaps(uint256 maxPerTx_, uint256 maxPerRecipient24h_, uint256 maxGlobal24h_) internal {
        require(maxPerTx_ > 0, "Portal: maxPerTx=0");
        require(maxPerRecipient24h_ >= maxPerTx_, "Portal: recip cap < tx cap");
        require(maxGlobal24h_ >= maxPerRecipient24h_, "Portal: global cap < recip cap");
        maxPerTx = maxPerTx_;
        maxPerRecipient24h = maxPerRecipient24h_;
        maxGlobal24h = maxGlobal24h_;
        emit CapsUpdated(maxPerTx_, maxPerRecipient24h_, maxGlobal24h_);
    }
}
