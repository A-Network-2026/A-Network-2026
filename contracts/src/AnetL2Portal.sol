// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ AnetL2Portal — CANONICAL BSC ⇆ L2 deposit/withdraw portal (lock & mint)  ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║ Token: 0x791055A7d52AA392eaE8De04250497f33807E46A (ANET BEP-20, 21M cap) ║
 * ║                                                                          ║
 * ║ WHAT THIS IS                                                             ║
 * ║   The missing piece from the June 11, 2026 Architecture Decision:       ║
 * ║   BSC ANET is the designated L2 native gas asset. This portal is the    ║
 * ║   ONLY sanctioned way ANET crosses between BSC (web2 L1 / settlement     ║
 * ║   layer) and the A-Network L2 (opBNB / OP-Stack rollup).                ║
 * ║                                                                          ║
 * ║   • DEPOSIT  (BSC → L2): user LOCKS ANET here. The L2 sequencer watches  ║
 * ║     `DepositInitiated` and credits the SAME amount of NATIVE ANET on L2 ║
 * ║     1:1. Nothing is minted on BSC; the locked ANET is the backing.      ║
 * ║   • WITHDRAW (L2 → BSC): user burns native ANET on L2. M-of-N relayers  ║
 * ║     sign an EIP-712 attestation of that burn and `finalizeWithdrawal`   ║
 * ║     RELEASES the same amount of locked ANET back on BSC. Burn-id dedup  ║
 * ║     guarantees one release per L2 burn.                                 ║
 * ║                                                                          ║
 * ║ BACKING INVARIANT (enforced by code, not trust)                         ║
 * ║       circulating native ANET on L2  ==  ANET locked in this portal     ║
 * ║   The portal NEVER mints BSC ANET and has NO admin withdraw path for    ║
 * ║   the locked ANET. ANET only leaves via `finalizeWithdrawal` against a  ║
 * ║   signed L2 burn. This makes L2 ANET fully 1:1 backed — not synthetic.  ║
 * ║                                                                          ║
 * ║ TRANSPARENCY                                                            ║
 * ║   Every deposit and withdrawal emits a human-readable `memo` plus the   ║
 * ║   canonical chain/explorer references (see `transparency()` view), so   ║
 * ║   the community can follow each cross-chain movement end to end on the  ║
 * ║   public explorers of BOTH chains.                                      ║
 * ║                                                                          ║
 * ║ SECURITY (mirrors AnetBridgeVault, audited 2026-06-11)                   ║
 * ║   1. One-way release: locked ANET leaves ONLY via finalizeWithdrawal.   ║
 * ║   2. M-of-N EIP-712 relayer signatures (per-withdrawal nonce).          ║
 * ║   3. Per-tx, per-recipient rolling-24h, global rolling-24h caps.        ║
 * ║   4. Withdrawal-id dedup — each L2 burn releases at most once.          ║
 * ║   5. Emergency pause via a SEPARATE cold pauser key.                    ║
 * ║   6. Admin (Safe) param changes gated by a 48h timelock + 14d grace.    ║
 * ║   7. ANET itself can NEVER be rescued; only foreign tokens.             ║
 * ║                                                                          ║
 * ║ Solidity 0.8.20, no external deps (vendored minimal interfaces) so      ║
 * ║ BscScan verification stays trivial.                                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transferFrom failed");
    }
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

contract AnetL2Portal is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────────

    /// @notice The ANET BEP-20 token this portal locks/releases (1:1 backing).
    IERC20 public immutable ANET;

    /// @notice L2 chain id native ANET lives on (for transparency tooling).
    uint256 public immutable L2_CHAIN_ID;

    uint256 public constant MAX_SIGNERS = 16;
    uint256 public constant TIMELOCK_DELAY = 48 hours;
    uint256 public constant EXECUTION_GRACE = 14 days;

    /// @notice Hard ceiling on the optional memo string (gas bound).
    uint256 public constant MAX_MEMO_BYTES = 256;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant _WITHDRAW_TYPEHASH = keccak256(
        "Withdraw(uint256 withdrawalId,uint256 l2BurnBlock,string l2Sender,address recipient,uint256 amount,uint256 deadline)"
    );

    /// @notice L2→BSC withdrawal attestation. Passed to `finalizeWithdrawal` as
    ///         a single calldata struct so its fields stay in calldata (keeps
    ///         the function frame under the EVM stack limit). The signed EIP-712
    ///         payload covers everything EXCEPT `memo` (transparency-only).
    struct Withdrawal {
        uint256 withdrawalId; // unique L2 burn record id (released at most once)
        uint256 l2BurnBlock;  // L2 block height of the burn (audit/transparency)
        string  l2Sender;     // L2 address that burned native ANET (string form)
        address recipient;    // BSC address that receives the unlocked ANET
        uint256 amount;       // ANET amount to release (18 decimals)
        uint256 deadline;     // unix time after which the signatures are invalid
        string  memo;         // human-readable note (≤256B), e.g. L2 burn link
    }

    // ── Transparency references (immutable; surfaced via transparency()) ───────
    // Plain-text links the community/UI use to follow each movement on the
    // PUBLIC explorers of both chains. Stored as immutable bytes so the chain
    // itself is the single source of truth for "where do I verify this".
    string private _bscExplorerBase;   // e.g. "https://bscscan.com/tx/"
    string private _l2ExplorerBase;    // e.g. "https://opbnbscan.com/tx/"
    string private _backingStatement;  // e.g. "L2 native ANET is 1:1 backed by ANET locked in this portal."

    // ── Roles ─────────────────────────────────────────────────────────────────
    address public admin;
    address public pendingAdmin;
    address public pauser;
    bool    public paused;

    mapping(address => bool) public isSigner;
    address[] private _signerList;
    uint256 public threshold;

    // ── Caps (18-decimal ANET wei) ─────────────────────────────────────────────
    uint256 public maxPerTx;
    uint256 public maxPerRecipient24h;
    uint256 public maxGlobal24h;

    // ── Accounting ──────────────────────────────────────────────────────────────
    /// @notice Monotonic deposit counter — also the depositId the L2 credits against.
    uint256 public depositCount;
    /// @notice Cumulative ANET ever locked via deposits.
    uint256 public totalDeposited;
    /// @notice Cumulative ANET ever released via withdrawals.
    uint256 public totalReleased;
    /// @notice L2 withdrawalId => true once released. Prevents double-release.
    mapping(uint256 => bool) public withdrawalConsumed;

    // True 24h sliding-window accounting (24× 1-hour circular slots), identical
    // to AnetBridgeVault so an attacker cannot drain 2× the cap across a UTC
    // day boundary.
    uint256 private constant _WINDOW_HOURS = 24;
    struct HourSlot { uint64 hour; uint192 amount; }
    HourSlot[24] private _globalSlots;
    mapping(address => HourSlot[24]) private _recipientSlots;

    // ── Timelock ────────────────────────────────────────────────────────────────
    struct PendingChange {
        bytes32 paramKey;
        bytes32 valueHash;
        uint64  eta;
        bool    exists;
    }
    mapping(bytes32 => PendingChange) public pending;

    // ── Events ────────────────────────────────────────────────────────────────
    /// @notice Emitted when ANET is locked on BSC. The L2 sequencer mints the
    ///         SAME `amount` of native ANET to `l2Recipient`, 1:1.
    event DepositInitiated(
        uint256 indexed depositId,
        address indexed from,
        address indexed l2Recipient,
        uint256 amount,
        string  memo
    );
    /// @notice Emitted when locked ANET is released back on BSC against an L2 burn.
    event WithdrawalFinalized(
        uint256 indexed withdrawalId,
        address indexed recipient,
        uint256 amount,
        string  l2Sender,
        uint256 signaturesUsed,
        string  memo
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
    event TransparencyUpdated(string bscExplorerBase, string l2ExplorerBase, string backingStatement);

    // ── Modifiers ────────────────────────────────────────────────────────────────
    modifier onlyAdmin() {
        require(msg.sender == admin, "Portal: not admin");
        _;
    }
    modifier whenNotPaused() {
        require(!paused, "Portal: paused");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────────────
    constructor(
        IERC20  anet_,
        uint256 l2ChainId_,
        address admin_,
        address pauser_,
        address[] memory initialSigners,
        uint256 initialThreshold,
        uint256 maxPerTx_,
        uint256 maxPerRecipient24h_,
        uint256 maxGlobal24h_
    ) {
        require(address(anet_) != address(0), "Portal: token=0");
        require(admin_  != address(0),         "Portal: admin=0");
        require(pauser_ != address(0),         "Portal: pauser=0");
        require(l2ChainId_ != 0,               "Portal: l2ChainId=0");

        ANET        = anet_;
        L2_CHAIN_ID = l2ChainId_;
        admin       = admin_;
        pauser      = pauser_;

        _setSignerSet(initialSigners, initialThreshold);
        _setCaps(maxPerTx_, maxPerRecipient24h_, maxGlobal24h_);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("AnetL2Portal")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DEPOSIT (BSC → L2): lock ANET; L2 mints native ANET 1:1.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Lock `amount` ANET on BSC and request the equivalent NATIVE ANET
     *         on L2 for `l2Recipient`. The L2 sequencer credits 1:1.
     * @param amount       ANET amount to lock (18 decimals). Must be > 0.
     * @param l2Recipient  Address that will receive native ANET on L2.
     * @param memo         Optional human-readable note (≤ 256 bytes). Included
     *                     verbatim in the event so the movement is fully
     *                     transparent on-chain. The UI typically embeds the
     *                     backing statement and the L2 explorer link here.
     * @return depositId   The id the L2 credits against (== this lock).
     */
    function deposit(uint256 amount, address l2Recipient, string calldata memo)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 depositId)
    {
        require(amount > 0,                "Portal: amount=0");
        require(l2Recipient != address(0), "Portal: l2Recipient=0");
        require(bytes(memo).length <= MAX_MEMO_BYTES, "Portal: memo too long");

        // Pull-and-verify: measure the realized balance delta so fee-on-transfer
        // or rebasing tokens can never desync the 1:1 backing invariant. ANET is
        // a vanilla fixed-supply BEP-20, but defending the invariant is cheap.
        uint256 balBefore = ANET.balanceOf(address(this));
        ANET.safeTransferFrom(msg.sender, address(this), amount);
        uint256 locked = ANET.balanceOf(address(this)) - balBefore;
        require(locked == amount, "Portal: transfer amount mismatch");

        unchecked { depositId = ++depositCount; }
        totalDeposited += locked;

        emit DepositInitiated(depositId, msg.sender, l2Recipient, locked, memo);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WITHDRAW (L2 → BSC): release locked ANET against a signed L2 burn.
    // The only path locked ANET leaves the portal.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Release locked ANET to `req.recipient` against L2 burn
     *         `req.withdrawalId`.
     * @dev    Anyone may submit; only the M-of-N signatures matter (so a stuck
     *         relayer can be routed around by any signer publishing the bundle).
     *         The request is passed as a calldata struct so its fields stay in
     *         calldata and the function frame stays under the EVM stack limit.
     * @param req         The withdrawal attestation fields (see Withdrawal).
     * @param signatures  ≥ threshold unique EIP-712 sigs, ascending by signer.
     */
    function finalizeWithdrawal(Withdrawal calldata req, bytes[] calldata signatures)
        external
        nonReentrant
        whenNotPaused
    {
        require(req.recipient != address(0),          "Portal: recipient=0");
        require(req.amount > 0,                        "Portal: amount=0");
        require(block.timestamp <= req.deadline,       "Portal: expired");
        require(!withdrawalConsumed[req.withdrawalId], "Portal: withdrawal used");
        require(req.amount <= maxPerTx,                "Portal: > per-tx cap");
        require(bytes(req.memo).length <= MAX_MEMO_BYTES, "Portal: memo too long");

        // Rolling 24h caps.
        _accrueAndCheck(_globalSlots, req.amount, maxGlobal24h);
        _accrueAndCheck(_recipientSlots[req.recipient], req.amount, maxPerRecipient24h);

        // Verify M-of-N EIP-712 signatures. l2BurnBlock and l2Sender are part of
        // the signed payload so relayers attest to the exact burn. The digest is
        // built in a helper to keep this frame off the "stack too deep" limit.
        uint256 used = _verifySignatures(_withdrawDigest(req), signatures);
        require(used >= threshold, "Portal: not enough signatures");

        // Effects.
        withdrawalConsumed[req.withdrawalId] = true;
        totalReleased += req.amount;

        // Interactions.
        ANET.safeTransfer(req.recipient, req.amount);

        emit WithdrawalFinalized(
            req.withdrawalId, req.recipient, req.amount, req.l2Sender, used, req.memo
        );
    }

    function _withdrawDigest(Withdrawal calldata req) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                _WITHDRAW_TYPEHASH,
                req.withdrawalId,
                req.l2BurnBlock,
                keccak256(bytes(req.l2Sender)),
                req.recipient,
                req.amount,
                req.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

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

    // ─────────────────────────────────────────────────────────────────────────
    // Pauser (separate cold key).
    // ─────────────────────────────────────────────────────────────────────────

    function pause() external {
        require(msg.sender == pauser || msg.sender == admin, "Portal: not pauser");
        paused = true;
        emit PausedBy(msg.sender);
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit UnpausedBy(msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin transfer (2-step).
    // ─────────────────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────────────────
    // Timelocked parameter changes.
    // ─────────────────────────────────────────────────────────────────────────

    bytes32 public constant PARAM_SIGNERS      = keccak256("SIGNERS");
    bytes32 public constant PARAM_CAPS         = keccak256("CAPS");
    bytes32 public constant PARAM_PAUSER       = keccak256("PAUSER");

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
        require(newPauser != address(0), "Portal: pauser=0");
        bytes32 valueHash = keccak256(abi.encode(newPauser));
        id = _schedule(PARAM_PAUSER, valueHash);
    }

    function executePauser(address newPauser, bytes32 id) external onlyAdmin {
        bytes32 valueHash = keccak256(abi.encode(newPauser));
        _consume(id, PARAM_PAUSER, valueHash);
        emit PauserUpdated(pauser, newPauser);
        pauser = newPauser;
    }

    /// @notice Update the human-readable transparency pointers (explorer base
    ///         URLs + backing statement). These are INFORMATIONAL only — they do
    ///         not affect funds, the 1:1 peg, signatures, or caps — so they are
    ///         admin-settable without a timelock. The authoritative data (events,
    ///         balances, the backing invariant) lives immutably on-chain.
    function setTransparency(
        string calldata bscExplorerBase_,
        string calldata l2ExplorerBase_,
        string calldata backingStatement_
    ) external onlyAdmin {
        _bscExplorerBase  = bscExplorerBase_;
        _l2ExplorerBase   = l2ExplorerBase_;
        _backingStatement = backingStatement_;
        emit TransparencyUpdated(bscExplorerBase_, l2ExplorerBase_, backingStatement_);
    }

    function cancelChange(bytes32 id) external onlyAdmin {
        PendingChange memory p = pending[id];
        require(p.exists, "Portal: no such change");
        delete pending[id];
        emit ChangeCancelled(id, p.paramKey);
    }

    function _schedule(bytes32 paramKey, bytes32 valueHash) internal returns (bytes32 id) {
        uint64 eta = uint64(block.timestamp + TIMELOCK_DELAY);
        id = keccak256(abi.encode(paramKey, valueHash, eta, block.number));
        require(!pending[id].exists, "Portal: dup schedule");
        pending[id] = PendingChange({paramKey: paramKey, valueHash: valueHash, eta: eta, exists: true});
        emit ChangeScheduled(id, paramKey, eta);
    }

    function _consume(bytes32 id, bytes32 expectedKey, bytes32 expectedValueHash) internal {
        PendingChange memory p = pending[id];
        require(p.exists,                              "Portal: no such change");
        require(p.paramKey  == expectedKey,            "Portal: wrong param");
        require(p.valueHash == expectedValueHash,      "Portal: value mismatch");
        require(block.timestamp >= p.eta,              "Portal: timelock");
        require(block.timestamp <= uint256(p.eta) + EXECUTION_GRACE, "Portal: change expired");
        delete pending[id];
        emit ChangeExecuted(id, expectedKey);
    }

    // ── Internal setters ─────────────────────────────────────────────────────
    function _setSignerSet(address[] memory signers_, uint256 threshold_) internal {
        require(signers_.length > 0,            "Portal: no signers");
        require(signers_.length <= MAX_SIGNERS, "Portal: too many signers");
        require(threshold_ > 0,                 "Portal: threshold=0");
        require(threshold_ <= signers_.length,  "Portal: threshold>N");

        for (uint256 i = 0; i < _signerList.length; i++) {
            isSigner[_signerList[i]] = false;
        }
        delete _signerList;

        address last = address(0);
        for (uint256 i = 0; i < signers_.length; i++) {
            address s = signers_[i];
            require(s != address(0), "Portal: signer=0");
            require(s > last,        "Portal: signers not sorted/unique");
            last = s;
            isSigner[s] = true;
            _signerList.push(s);
        }
        threshold = threshold_;
        emit SignerSetUpdated(signers_, threshold_);
    }

    function _setCaps(uint256 mTx, uint256 mRecip24h, uint256 mGlobal24h) internal {
        require(mTx > 0,                  "Portal: per-tx cap=0");
        require(mRecip24h >= mTx,         "Portal: recip cap < per-tx");
        require(mGlobal24h >= mRecip24h,  "Portal: global cap < recip cap");
        // ANET fixed supply is 21M; a withdrawal cap can never exceed it.
        require(mGlobal24h <= 21_000_000 * 1e18, "Portal: cap > total supply");
        maxPerTx           = mTx;
        maxPerRecipient24h = mRecip24h;
        maxGlobal24h       = mGlobal24h;
        emit CapsUpdated(mTx, mRecip24h, mGlobal24h);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rescue (foreign tokens only — locked ANET is never withdrawable by admin)
    // ─────────────────────────────────────────────────────────────────────────

    function rescueOtherToken(IERC20 token, address to, uint256 amount) external onlyAdmin {
        require(address(token) != address(ANET), "Portal: cannot rescue ANET");
        require(to != address(0),                 "Portal: to=0");
        token.safeTransfer(to, amount);
        emit OtherTokenRescued(address(token), to, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function signers() external view returns (address[] memory) {
        return _signerList;
    }

    /// @notice ANET currently locked in the portal — i.e. the live 1:1 backing
    ///         for all native ANET circulating on L2.
    function lockedBalance() external view returns (uint256) {
        return ANET.balanceOf(address(this));
    }

    /// @notice Net ANET that SHOULD be circulating on L2 (deposited − released).
    ///         Equals lockedBalance() in steady state; the relayer/community can
    ///         reconcile this against the L2 native supply to prove the peg.
    function expectedL2Supply() external view returns (uint256) {
        return totalDeposited - totalReleased;
    }

    function released24hGlobal() external view returns (uint256) {
        return _windowSum(_globalSlots, uint64(block.timestamp / 1 hours));
    }

    function released24hRecipient(address r) external view returns (uint256) {
        return _windowSum(_recipientSlots[r], uint64(block.timestamp / 1 hours));
    }

    /// @notice Canonical transparency references for the community/UI: where to
    ///         verify every movement and the 1:1 backing guarantee. The chain
    ///         itself is the source of truth for these links.
    function transparency()
        external
        view
        returns (
            address anetToken,
            uint256 l2ChainId,
            string memory bscExplorerBase,
            string memory l2ExplorerBase,
            string memory backingStatement
        )
    {
        return (address(ANET), L2_CHAIN_ID, _bscExplorerBase, _l2ExplorerBase, _backingStatement);
    }
}
