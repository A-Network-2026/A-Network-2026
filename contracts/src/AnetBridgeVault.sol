// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ AnetBridgeVault — L1 → BSC cash-out vault for wANET (BEP-20)             ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║ Token: 0x791055A7d52AA392eaE8De04250497f33807E46A (ANET BEP-20, 21M cap) ║
 * ║                                                                          ║
 * ║ Purpose                                                                  ║
 * ║   This contract replaces the previous EOA escrow wallet                  ║
 * ║   (0x27766A070e6F55BD832A10aB9c5931FfA2037029) with an on-chain vault    ║
 * ║   that enforces the bridge rules in Solidity instead of in a hot         ║
 * ║   relayer process. After deployment the founder transfers the entire    ║
 * ║   21,000,000 wANET supply into this vault and then renounces the BEP-20 ║
 * ║   token contract. From that moment forward, the ONLY way wANET can      ║
 * ║   appear in circulation on BSC is via `releaseBurn()` — which requires  ║
 * ║   an M-of-N EIP-712 signed attestation from authorized L1 relayers      ║
 * ║   referencing a specific L1 `burnId`.                                   ║
 * ║                                                                          ║
 * ║ Design properties (enforced by code, not by trust)                       ║
 * ║   1. One-way: tokens flow OUT only via releaseBurn(); never withdrawn   ║
 * ║      by admin. There is no `rescueERC20(self)` escape hatch.            ║
 * ║   2. M-of-N relayer signatures (EIP-712, per-burn nonce = L1 burnId).   ║
 * ║   3. Per-tx cap, per-recipient rolling-24h cap, global rolling-24h cap. ║
 * ║   4. Burn-ID dedup — each L1 burnId can release at most once.           ║
 * ║   5. Emergency pause via a SEPARATE pauser role (cold key, not relayer).║
 * ║   6. Admin actions (rotate signers, change caps) gated by a 48h         ║
 * ║      timelock. Admin can NEVER mint or move tokens directly.            ║
 * ║   7. Other ERC20s accidentally sent here can be rescued by admin via    ║
 * ║      `rescueOtherToken()`, but the vault's own token (wANET) is         ║
 * ║      explicitly blocked from rescue.                                    ║
 * ║                                                                          ║
 * ║ Solidity 0.8.20, no external dependencies (vendored minimal interfaces  ║
 * ║ to keep deployment + verification trivial on BscScan).                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }
}

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;
    modifier nonReentrant() {
        require(_status != _ENTERED, "Vault: reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

contract AnetBridgeVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────────

    /// @notice The wANET BEP-20 token this vault holds and releases.
    IERC20 public immutable WANET;

    /// @notice Maximum number of relayer signers ever allowed (gas safety).
    uint256 public constant MAX_SIGNERS = 16;

    /// @notice Timelock delay for admin parameter changes.
    uint256 public constant TIMELOCK_DELAY = 48 hours;

    /// @notice EIP-712 domain.
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant _RELEASE_TYPEHASH = keccak256(
        "Release(uint256 burnId,string l1Sender,address recipient,uint256 amount,uint256 deadline)"
    );

    // ── Roles ─────────────────────────────────────────────────────────────────
    // admin   — schedules timelocked changes (signer set, caps). Cannot release.
    //           Should be a Gnosis Safe or, eventually, a DAO.
    // pauser  — separate cold key that can ONLY pause/unpause. Cannot release,
    //           cannot rotate signers, cannot rescue.
    // signers — M-of-N set whose EIP-712 signatures authorize releaseBurn().

    address public admin;
    address public pendingAdmin;

    address public pauser;
    bool    public paused;

    mapping(address => bool) public isSigner;
    address[] private _signerList;
    uint256 public threshold; // required number of signatures (M of N)

    // ── Caps (all in wei-scaled wANET, 18 decimals) ──────────────────────────

    uint256 public maxPerTx;            // hard cap on a single release
    uint256 public maxPerRecipient24h;  // rolling 24h cap per BSC address
    uint256 public maxGlobal24h;        // rolling 24h cap across all recipients

    // ── Accounting ────────────────────────────────────────────────────────────

    /// @notice burnId => true once released. Prevents double-release.
    mapping(uint256 => bool) public burnIdConsumed;

    /// @notice Cumulative wANET ever released by this vault.
    uint256 public totalReleased;

    // True 24h sliding-window accounting via 24 hourly buckets in a circular
    // buffer. We previously bucketed by (timestamp / 1 days), which let an
    // attacker who controls a compromised signer quorum drain the daily cap
    // at 23:59:59 UTC and again at 00:00:01 UTC — 2× the intended cap in
    // ~2 seconds. Hourly slots prevent that: the rolling sum always reflects
    // the last 24 hours regardless of when the window is observed.
    //
    // Each slot stores the absolute unix-hour it was last written to. Slots
    // older than (currentHour - 23) are stale and excluded from the sum.
    // Per release this costs 24 SLOADs (cheap, warm slots after first use)
    // and 1 SSTORE — acceptable for a settlement contract.
    uint256 private constant _WINDOW_HOURS = 24;
    struct HourSlot { uint64 hour; uint192 amount; }
    HourSlot[24] private _globalSlots;
    mapping(address => HourSlot[24]) private _recipientSlots;

    // ── Timelock ──────────────────────────────────────────────────────────────

    struct PendingChange {
        bytes32 paramKey;     // keccak256 of param name
        bytes32 valueHash;    // keccak256 of abi.encoded new value
        uint64  eta;          // earliest block.timestamp at which it may execute
        bool    exists;
    }
    mapping(bytes32 => PendingChange) public pending; // id => change

    // ── Events ────────────────────────────────────────────────────────────────

    event Released(
        uint256 indexed burnId,
        address indexed recipient,
        uint256 amount,
        string  l1Sender,
        uint256 signaturesUsed
    );
    event SignerSetUpdated(address[] signers, uint256 threshold);
    event CapsUpdated(uint256 maxPerTx, uint256 maxPerRecipient24h, uint256 maxGlobal24h);
    event PauserUpdated(address indexed oldPauser, address indexed newPauser);
    event PausedBy(address indexed who);
    event UnpausedBy(address indexed who);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferAccepted(address indexed oldAdmin, address indexed newAdmin);
    event ChangeScheduled(bytes32 indexed id, bytes32 paramKey, uint64 eta);
    event ChangeExecuted(bytes32 indexed id, bytes32 paramKey);
    event ChangeCancelled(bytes32 indexed id, bytes32 paramKey);
    event OtherTokenRescued(address indexed token, address indexed to, uint256 amount);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "Vault: not admin");
        _;
    }
    modifier whenNotPaused() {
        require(!paused, "Vault: paused");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        IERC20  wanet_,
        address admin_,
        address pauser_,
        address[] memory initialSigners,
        uint256 initialThreshold,
        uint256 maxPerTx_,
        uint256 maxPerRecipient24h_,
        uint256 maxGlobal24h_
    ) {
        require(address(wanet_) != address(0), "Vault: token=0");
        require(admin_  != address(0),         "Vault: admin=0");
        require(pauser_ != address(0),         "Vault: pauser=0");

        WANET  = wanet_;
        admin  = admin_;
        pauser = pauser_;

        _setSignerSet(initialSigners, initialThreshold);
        _setCaps(maxPerTx_, maxPerRecipient24h_, maxGlobal24h_);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("AnetBridgeVault")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public release flow — the only path tokens leave the vault.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Release wANET to `recipient` in fulfilment of L1 burn `burnId`.
     * @dev    Anyone may submit the transaction; what matters are the
     *         signatures. This is intentional so a stuck relayer can be
     *         worked around by any signer publishing the bundle.
     *
     * @param burnId    L1 burn record id (must be unique forever).
     * @param l1Sender  L1 wallet address that signed the burn (string form).
     * @param recipient BSC address that receives wANET.
     * @param amount    Amount of wANET to release (18 decimals).
     * @param deadline  Unix timestamp after which signatures are invalid.
     * @param signatures Array of 65-byte ECDSA signatures by signers over the
     *                  EIP-712 typed digest. Must contain ≥ `threshold` unique
     *                  signatures from the current `isSigner` set.
     */
    function releaseBurn(
        uint256 burnId,
        string calldata l1Sender,
        address recipient,
        uint256 amount,
        uint256 deadline,
        bytes[] calldata signatures
    ) external nonReentrant whenNotPaused {
        require(recipient != address(0),            "Vault: recipient=0");
        require(amount > 0,                         "Vault: amount=0");
        require(block.timestamp <= deadline,        "Vault: expired");
        require(!burnIdConsumed[burnId],            "Vault: burnId used");
        require(amount <= maxPerTx,                 "Vault: > per-tx cap");

        // Caps (true rolling 24h windows, 1-hour slot resolution).
        _accrueAndCheck(_globalSlots, amount, maxGlobal24h);
        _accrueAndCheck(_recipientSlots[recipient], amount, maxPerRecipient24h);

        // Verify signatures.
        bytes32 structHash = keccak256(
            abi.encode(
                _RELEASE_TYPEHASH,
                burnId,
                keccak256(bytes(l1Sender)),
                recipient,
                amount,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        uint256 used = _verifySignatures(digest, signatures);
        require(used >= threshold, "Vault: not enough signatures");

        // Effects.
        burnIdConsumed[burnId] = true;
        totalReleased += amount;

        // Interactions.
        WANET.safeTransfer(recipient, amount);

        emit Released(burnId, recipient, amount, l1Sender, used);
    }

    function _verifySignatures(bytes32 digest, bytes[] calldata signatures)
        internal
        view
        returns (uint256 uniqueValid)
    {
        // Bounded loop. Caller usually passes exactly `threshold` sigs.
        address last = address(0);
        // To enforce uniqueness without an extra mapping, require strictly
        // ascending signer addresses. Off-chain signer sorts before submitting.
        for (uint256 i = 0; i < signatures.length; i++) {
            address recovered = _recover(digest, signatures[i]);
            require(recovered != address(0),  "Vault: bad sig");
            require(isSigner[recovered],      "Vault: not a signer");
            require(recovered > last,         "Vault: sigs not sorted/unique");
            last = recovered;
            unchecked { uniqueValid++; }
        }
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        // calldata layout: r (32) | s (32) | v (1)
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        // EIP-2 — reject high-s malleable signatures.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cap accounting (true rolling 24h, 24× 1-hour circular slots).
    // ─────────────────────────────────────────────────────────────────────────

    function _windowSum(HourSlot[24] storage slots, uint64 currentHour)
        internal
        view
        returns (uint256 sum)
    {
        // Earliest hour still counted is currentHour - 23 (inclusive).
        // Slots whose recorded hour is older are stale.
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
        require(running <= cap, "Vault: > 24h cap");

        uint256 idx = currentHour % _WINDOW_HOURS;
        HourSlot storage slot = slots[idx];
        if (slot.hour == currentHour) {
            // Same hour — accumulate. Cap already bounds it under 2^192.
            slot.amount = uint192(uint256(slot.amount) + amount);
        } else {
            // Slot belongs to an older hour (or unused). Overwrite.
            slot.hour = currentHour;
            slot.amount = uint192(amount);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pauser (single role, separate cold key).
    // ─────────────────────────────────────────────────────────────────────────

    function pause() external {
        require(msg.sender == pauser || msg.sender == admin, "Vault: not pauser");
        paused = true;
        emit PausedBy(msg.sender);
    }

    function unpause() external onlyAdmin {
        // Only admin (timelocked Safe) can unpause — pauser is a "panic stop"
        // role, not a "resume" role. Forces a deliberate restart decision.
        paused = false;
        emit UnpausedBy(msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin transfer (2-step).
    // ─────────────────────────────────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Vault: zero admin");
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "Vault: not pending admin");
        emit AdminTransferAccepted(admin, pendingAdmin);
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Timelocked parameter changes.
    //
    // All admin-tunable parameters go through schedule→wait→execute so that
    // a compromised admin key gives the community a 48h window to detect and
    // respond (publicly visible event, can be cancelled by replacing the
    // admin Safe).
    // ─────────────────────────────────────────────────────────────────────────

    bytes32 public constant PARAM_SIGNERS = keccak256("SIGNERS");
    bytes32 public constant PARAM_CAPS    = keccak256("CAPS");
    bytes32 public constant PARAM_PAUSER  = keccak256("PAUSER");

    function scheduleSignerSet(address[] calldata newSigners, uint256 newThreshold)
        external onlyAdmin returns (bytes32 id)
    {
        bytes32 valueHash = keccak256(abi.encode(newSigners, newThreshold));
        id = _schedule(PARAM_SIGNERS, valueHash);
    }

    function executeSignerSet(address[] calldata newSigners, uint256 newThreshold, bytes32 id)
        external onlyAdmin
    {
        bytes32 valueHash = keccak256(abi.encode(newSigners, newThreshold));
        _consume(id, PARAM_SIGNERS, valueHash);
        _setSignerSet(newSigners, newThreshold);
    }

    function scheduleCaps(uint256 mTx, uint256 mRecip24h, uint256 mGlobal24h)
        external onlyAdmin returns (bytes32 id)
    {
        bytes32 valueHash = keccak256(abi.encode(mTx, mRecip24h, mGlobal24h));
        id = _schedule(PARAM_CAPS, valueHash);
    }

    function executeCaps(uint256 mTx, uint256 mRecip24h, uint256 mGlobal24h, bytes32 id)
        external onlyAdmin
    {
        bytes32 valueHash = keccak256(abi.encode(mTx, mRecip24h, mGlobal24h));
        _consume(id, PARAM_CAPS, valueHash);
        _setCaps(mTx, mRecip24h, mGlobal24h);
    }

    function schedulePauser(address newPauser) external onlyAdmin returns (bytes32 id) {
        require(newPauser != address(0), "Vault: pauser=0");
        bytes32 valueHash = keccak256(abi.encode(newPauser));
        id = _schedule(PARAM_PAUSER, valueHash);
    }

    function executePauser(address newPauser, bytes32 id) external onlyAdmin {
        bytes32 valueHash = keccak256(abi.encode(newPauser));
        _consume(id, PARAM_PAUSER, valueHash);
        emit PauserUpdated(pauser, newPauser);
        pauser = newPauser;
    }

    function cancelChange(bytes32 id) external onlyAdmin {
        PendingChange memory p = pending[id];
        require(p.exists, "Vault: no such change");
        delete pending[id];
        emit ChangeCancelled(id, p.paramKey);
    }

    function _schedule(bytes32 paramKey, bytes32 valueHash) internal returns (bytes32 id) {
        uint64 eta = uint64(block.timestamp + TIMELOCK_DELAY);
        id = keccak256(abi.encode(paramKey, valueHash, eta, block.number));
        require(!pending[id].exists, "Vault: dup schedule");
        pending[id] = PendingChange({paramKey: paramKey, valueHash: valueHash, eta: eta, exists: true});
        emit ChangeScheduled(id, paramKey, eta);
    }

    function _consume(bytes32 id, bytes32 expectedKey, bytes32 expectedValueHash) internal {
        PendingChange memory p = pending[id];
        require(p.exists,                              "Vault: no such change");
        require(p.paramKey  == expectedKey,            "Vault: wrong param");
        require(p.valueHash == expectedValueHash,      "Vault: value mismatch");
        require(block.timestamp >= p.eta,              "Vault: timelock");
        delete pending[id];
        emit ChangeExecuted(id, expectedKey);
    }

    // ── Internal setters (used by constructor and executors) ─────────────────

    function _setSignerSet(address[] memory signers_, uint256 threshold_) internal {
        require(signers_.length > 0,                    "Vault: no signers");
        require(signers_.length <= MAX_SIGNERS,         "Vault: too many signers");
        require(threshold_ > 0,                         "Vault: threshold=0");
        require(threshold_ <= signers_.length,          "Vault: threshold>N");

        // Clear previous set.
        for (uint256 i = 0; i < _signerList.length; i++) {
            isSigner[_signerList[i]] = false;
        }
        delete _signerList;

        // Install new set. Enforce strictly ascending so off-chain submitters
        // can also use ascending order to enforce uniqueness in releaseBurn.
        address last = address(0);
        for (uint256 i = 0; i < signers_.length; i++) {
            address s = signers_[i];
            require(s != address(0),                    "Vault: signer=0");
            require(s > last,                           "Vault: signers not sorted/unique");
            last = s;
            isSigner[s] = true;
            _signerList.push(s);
        }
        threshold = threshold_;
        emit SignerSetUpdated(signers_, threshold_);
    }

    function _setCaps(uint256 mTx, uint256 mRecip24h, uint256 mGlobal24h) internal {
        require(mTx > 0,                                "Vault: per-tx cap=0");
        require(mRecip24h >= mTx,                       "Vault: recip cap < per-tx");
        require(mGlobal24h >= mRecip24h,                "Vault: global cap < recip cap");
        // Sanity ceiling: caps cannot exceed total wANET supply (21M * 1e18).
        require(mGlobal24h <= 21_000_000 * 1e18,        "Vault: cap > total supply");
        maxPerTx           = mTx;
        maxPerRecipient24h = mRecip24h;
        maxGlobal24h       = mGlobal24h;
        emit CapsUpdated(mTx, mRecip24h, mGlobal24h);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rescue (other tokens only — wANET itself is locked in forever)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Rescue accidentally-sent ERC20s other than wANET.
    /// @dev    The vault's own token CANNOT be rescued. This is the property
    ///         that makes the vault a true one-way bridge sink.
    function rescueOtherToken(IERC20 token, address to, uint256 amount) external onlyAdmin {
        require(address(token) != address(WANET), "Vault: cannot rescue wANET");
        require(to != address(0),                 "Vault: to=0");
        token.safeTransfer(to, amount);
        emit OtherTokenRescued(address(token), to, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function signers() external view returns (address[] memory) {
        return _signerList;
    }

    function vaultBalance() external view returns (uint256) {
        return WANET.balanceOf(address(this));
    }

    function released24hGlobal() external view returns (uint256) {
        return _windowSum(_globalSlots, uint64(block.timestamp / 1 hours));
    }

    function released24hRecipient(address r) external view returns (uint256) {
        return _windowSum(_recipientSlots[r], uint64(block.timestamp / 1 hours));
    }
}
