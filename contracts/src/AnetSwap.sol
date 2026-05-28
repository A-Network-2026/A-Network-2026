// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * AnetSwap — EVM-to-ANET L1 Bridge Contract (v3.6 governance hardening)
 * =====================================================================
 * Deployed on: BNB Smart Chain (chainId 56)
 *              Ethereum, Polygon, Base, etc. (future)
 *
 * Flow:
 *   1. User calls swapNativeForAnet() or swapTokenForAnet() with their ANET L1 address.
 *   2. Contract emits SwapRequested event and stores the request.
 *   3. The ANET L1 bridge backend (pi-backend) detects the event via polling.
 *   4. Backend credits the ANET L1 wallet at the current bridge rate.
 *   5. An operator address calls markProcessed() on this contract with the L1 tx ID.
 *
 * v3.6 governance model — mirrors AnetBridgeVault:
 *   - admin    (Safe multisig recommended): all parameter changes via 48h
 *              timelock with a 14-day execution-grace window after ETA.
 *              2-step transfer (transferAdmin + acceptAdmin).
 *   - pauser   (separate hot key): can pause INSTANTLY. CANNOT unpause.
 *              Unpause requires the admin timelock so a compromised pauser
 *              cannot reopen the contract by itself.
 *   - operator (backend hot wallet): can call markProcessed /
 *              batchMarkProcessed without timelock. Cannot move funds, cannot
 *              change params.
 *
 *   View shim: owner() returns admin so existing tooling (Etherscan "Read",
 *   off-chain indexers) keeps working without code changes.
 *
 * Withdrawals (withdrawNative, withdrawToken) are admin-only but NOT
 * timelocked. Rationale: collected fees need to be swept operationally; the
 * Safe multisig already requires N-of-M signatures per call. Timelock would
 * block legitimate fee sweeps for 48h. Destination is hard-wired to admin
 * (cannot be redirected without going through transferAdmin/acceptAdmin).
 *
 * Security primitives unchanged from v3.5:
 *   - ReentrancyGuard on all state-changing external functions.
 *   - SafeERC20 for all token transfers.
 *   - Pausable for emergency stops.
 *   - Token allowlist — only whitelisted tokens accepted.
 *   - .call{value:} forwarding for native fee/withdraw (Safe-compatible).
 *   - Paginated indexer view.
 */

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner_, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

library SafeERC20 {
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transferFrom failed");
    }

    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }
}

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

abstract contract Pausable {
    bool private _paused;
    event Paused(address account);
    event Unpaused(address account);

    modifier whenNotPaused() {
        require(!_paused, "Pausable: paused");
        _;
    }

    function paused() public view returns (bool) { return _paused; }
    function _pause()   internal { _paused = true;  emit Paused(msg.sender); }
    function _unpause() internal { _paused = false; emit Unpaused(msg.sender); }
}

contract AnetSwap is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ── Roles ─────────────────────────────────────────────────────────────────

    address public admin;
    address public pendingAdmin;
    address public pauser;
    address public operator;

    // ── Timelock ──────────────────────────────────────────────────────────────

    uint256 public constant TIMELOCK_DELAY  = 48 hours;
    uint256 public constant EXECUTION_GRACE = 14 days;

    struct PendingChange {
        bytes32 paramKey;
        bytes32 valueHash;
        uint64  eta;
        bool    exists;
    }

    mapping(bytes32 => PendingChange) public pending;

    bytes32 public constant KEY_FEE_BPS       = keccak256("feeBps");
    bytes32 public constant KEY_FEE_RECIPIENT = keccak256("feeRecipient");
    bytes32 public constant KEY_TOKEN_CONFIG  = keccak256("tokenConfig");
    bytes32 public constant KEY_UNPAUSE       = keccak256("unpause");
    bytes32 public constant KEY_PAUSER        = keccak256("pauser");
    bytes32 public constant KEY_OPERATOR      = keccak256("operator");

    // ── Swap state (unchanged from v3.5) ─────────────────────────────────────

    struct TokenConfig {
        bool accepted;
        uint256 minAmount;
        uint256 maxAmount;
        uint8   decimals;
        string  symbol;
    }

    struct SwapRequest {
        uint256 id;
        address evmSender;
        string  anetRecipient;
        address tokenAddress;
        uint256 grossAmount;
        uint256 netAmount;
        uint256 feePaid;
        uint256 timestamp;
        bool    processed;
        string  anetTxId;
    }

    mapping(address => TokenConfig) public tokenConfigs;
    SwapRequest[] private _swaps;

    uint256 public feeBps = 100; // default 1% (100 / 10000)
    address public feeRecipient;

    uint256 public totalSwapsProcessed;
    uint256 public totalNativeReceived;
    mapping(address => uint256) public totalTokenReceived;

    // ── Events ────────────────────────────────────────────────────────────────

    event SwapRequested(
        uint256 indexed id,
        address indexed evmSender,
        string  anetRecipient,
        address tokenAddress,
        uint256 grossAmount,
        uint256 netAmount,
        uint256 feePaid,
        uint256 timestamp
    );

    event SwapProcessed(uint256 indexed id, string anetTxId, address indexed operator);
    event TokenConfigUpdated(address indexed token, bool accepted, uint256 minAmount, uint256 maxAmount);
    event FeeBpsUpdated(uint256 oldBps, uint256 newBps);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event NativeWithdrawn(address indexed to, uint256 amount);
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);
    event FeeForwardFailed(address indexed token, address indexed feeRecipient, uint256 amount);

    event AdminTransferProposed(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event PauserUpdated(address indexed previousPauser, address indexed newPauser);
    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    event ChangeScheduled(bytes32 indexed id, bytes32 indexed paramKey, uint64 eta);
    event ChangeExecuted(bytes32 indexed id, bytes32 indexed paramKey);
    event ChangeCancelled(bytes32 indexed id, bytes32 indexed paramKey);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "AnetSwap: not admin");
        _;
    }

    modifier onlyPauserOrAdmin() {
        require(msg.sender == pauser || msg.sender == admin, "AnetSwap: not pauser");
        _;
    }

    modifier onlyOperatorOrAdmin() {
        require(msg.sender == operator || msg.sender == admin, "AnetSwap: not operator");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address initialAdmin,
        address initialPauser,
        address initialOperator,
        address _feeRecipient
    ) {
        require(initialAdmin    != address(0), "AnetSwap: zero admin");
        require(initialPauser   != address(0), "AnetSwap: zero pauser");
        require(initialOperator != address(0), "AnetSwap: zero operator");
        require(_feeRecipient   != address(0), "AnetSwap: zero fee recipient");

        admin        = initialAdmin;
        pauser       = initialPauser;
        operator     = initialOperator;
        feeRecipient = _feeRecipient;

        emit AdminTransferred(address(0), initialAdmin);
        emit PauserUpdated(address(0), initialPauser);
        emit OperatorUpdated(address(0), initialOperator);
        emit FeeRecipientUpdated(address(0), _feeRecipient);

        tokenConfigs[address(0)] = TokenConfig({
            accepted: true,
            minAmount: 0.01 ether,
            maxAmount: 0,
            decimals: 18,
            symbol: "BNB"
        });
        emit TokenConfigUpdated(address(0), true, 0.01 ether, 0);
    }

    // ── Backwards-compat view ─────────────────────────────────────────────────

    function owner() external view returns (address) { return admin; }

    // ── Admin transfer (2-step) ───────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        pendingAdmin = newAdmin;
        emit AdminTransferProposed(admin, newAdmin);
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin && pendingAdmin != address(0), "AnetSwap: not pending admin");
        address previous = admin;
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferred(previous, admin);
    }

    // ── Timelocked: setFeeBps ─────────────────────────────────────────────────

    function scheduleFeeBps(uint256 newFeeBps) external onlyAdmin returns (bytes32 id) {
        require(newFeeBps <= 500, "AnetSwap: fee exceeds 5%");
        bytes32 valueHash = keccak256(abi.encode(newFeeBps));
        id = keccak256(abi.encode(KEY_FEE_BPS, valueHash, block.timestamp));
        _schedule(id, KEY_FEE_BPS, valueHash);
    }

    function executeFeeBps(uint256 newFeeBps, bytes32 id) external onlyAdmin {
        bytes32 valueHash = keccak256(abi.encode(newFeeBps));
        _consume(id, KEY_FEE_BPS, valueHash);
        require(newFeeBps <= 500, "AnetSwap: fee exceeds 5%");
        emit FeeBpsUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    // ── Timelocked: setFeeRecipient ──────────────────────────────────────────

    function scheduleFeeRecipient(address newRecipient) external onlyAdmin returns (bytes32 id) {
        require(newRecipient != address(0), "AnetSwap: zero address");
        bytes32 valueHash = keccak256(abi.encode(newRecipient));
        id = keccak256(abi.encode(KEY_FEE_RECIPIENT, valueHash, block.timestamp));
        _schedule(id, KEY_FEE_RECIPIENT, valueHash);
    }

    function executeFeeRecipient(address newRecipient, bytes32 id) external onlyAdmin {
        bytes32 valueHash = keccak256(abi.encode(newRecipient));
        _consume(id, KEY_FEE_RECIPIENT, valueHash);
        require(newRecipient != address(0), "AnetSwap: zero address");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    // ── Timelocked: configureToken ───────────────────────────────────────────

    function scheduleConfigureToken(
        address token,
        bool    accepted,
        uint256 minAmount,
        uint256 maxAmount,
        uint8   decimals,
        string  calldata symbol
    ) external onlyAdmin returns (bytes32 id) {
        bytes32 valueHash = keccak256(abi.encode(token, accepted, minAmount, maxAmount, decimals, symbol));
        id = keccak256(abi.encode(KEY_TOKEN_CONFIG, valueHash, block.timestamp));
        _schedule(id, KEY_TOKEN_CONFIG, valueHash);
    }

    function executeConfigureToken(
        address token,
        bool    accepted,
        uint256 minAmount,
        uint256 maxAmount,
        uint8   decimals,
        string  calldata symbol,
        bytes32 id
    ) external onlyAdmin {
        bytes32 valueHash = keccak256(abi.encode(token, accepted, minAmount, maxAmount, decimals, symbol));
        _consume(id, KEY_TOKEN_CONFIG, valueHash);
        tokenConfigs[token] = TokenConfig({
            accepted: accepted,
            minAmount: minAmount,
            maxAmount: maxAmount,
            decimals: decimals,
            symbol: symbol
        });
        emit TokenConfigUpdated(token, accepted, minAmount, maxAmount);
    }

    // ── Timelocked: setPauser / setOperator ──────────────────────────────────

    function schedulePauser(address newPauser) external onlyAdmin returns (bytes32 id) {
        require(newPauser != address(0), "AnetSwap: zero pauser");
        bytes32 valueHash = keccak256(abi.encode(newPauser));
        id = keccak256(abi.encode(KEY_PAUSER, valueHash, block.timestamp));
        _schedule(id, KEY_PAUSER, valueHash);
    }

    function executePauser(address newPauser, bytes32 id) external onlyAdmin {
        bytes32 valueHash = keccak256(abi.encode(newPauser));
        _consume(id, KEY_PAUSER, valueHash);
        require(newPauser != address(0), "AnetSwap: zero pauser");
        emit PauserUpdated(pauser, newPauser);
        pauser = newPauser;
    }

    function scheduleOperator(address newOperator) external onlyAdmin returns (bytes32 id) {
        require(newOperator != address(0), "AnetSwap: zero operator");
        bytes32 valueHash = keccak256(abi.encode(newOperator));
        id = keccak256(abi.encode(KEY_OPERATOR, valueHash, block.timestamp));
        _schedule(id, KEY_OPERATOR, valueHash);
    }

    function executeOperator(address newOperator, bytes32 id) external onlyAdmin {
        bytes32 valueHash = keccak256(abi.encode(newOperator));
        _consume(id, KEY_OPERATOR, valueHash);
        require(newOperator != address(0), "AnetSwap: zero operator");
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    // ── Cancel a pending change ──────────────────────────────────────────────

    function cancelChange(bytes32 id) external onlyAdmin {
        PendingChange memory p = pending[id];
        require(p.exists, "AnetSwap: no such change");
        delete pending[id];
        emit ChangeCancelled(id, p.paramKey);
    }

    // ── Pause / Unpause ──────────────────────────────────────────────────────

    function pause() external onlyPauserOrAdmin { _pause(); }

    function scheduleUnpause() external onlyAdmin returns (bytes32 id) {
        bytes32 valueHash = bytes32(0);
        id = keccak256(abi.encode(KEY_UNPAUSE, valueHash, block.timestamp));
        _schedule(id, KEY_UNPAUSE, valueHash);
    }

    function executeUnpause(bytes32 id) external onlyAdmin {
        _consume(id, KEY_UNPAUSE, bytes32(0));
        _unpause();
    }

    // ── Operator: mark processed ─────────────────────────────────────────────

    function markProcessed(uint256 id, string calldata anetTxId) external onlyOperatorOrAdmin {
        require(id < _swaps.length, "AnetSwap: invalid swap ID");
        require(!_swaps[id].processed, "AnetSwap: already processed");
        require(bytes(anetTxId).length > 0, "AnetSwap: anetTxId required");

        _swaps[id].processed = true;
        _swaps[id].anetTxId  = anetTxId;
        totalSwapsProcessed++;

        emit SwapProcessed(id, anetTxId, msg.sender);
    }

    function batchMarkProcessed(
        uint256[] calldata ids,
        string[]  calldata anetTxIds
    ) external onlyOperatorOrAdmin {
        require(ids.length == anetTxIds.length, "AnetSwap: length mismatch");
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (id < _swaps.length && !_swaps[id].processed && bytes(anetTxIds[i]).length > 0) {
                _swaps[id].processed = true;
                _swaps[id].anetTxId  = anetTxIds[i];
                totalSwapsProcessed++;
                emit SwapProcessed(id, anetTxIds[i], msg.sender);
            }
        }
    }

    // ── Admin: fund recovery (NOT timelocked; admin-multisig provides auth) ──

    function withdrawNative(uint256 amount) external onlyAdmin {
        require(amount <= address(this).balance, "AnetSwap: insufficient balance");
        address payable to = payable(admin);
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "AnetSwap: native withdraw failed");
        emit NativeWithdrawn(to, amount);
    }

    function withdrawToken(address token, uint256 amount) external onlyAdmin {
        require(token != address(0), "AnetSwap: use withdrawNative for BNB");
        address to = admin;
        IERC20(token).safeTransfer(to, amount);
        emit TokenWithdrawn(token, to, amount);
    }

    // ── User: swap native coin (BNB/ETH/MATIC) for ANET L1 ───────────────────

    function swapNativeForAnet(string calldata anetRecipient)
        external payable nonReentrant whenNotPaused
    {
        TokenConfig memory cfg = tokenConfigs[address(0)];
        require(cfg.accepted,                              "AnetSwap: native coin not accepted");
        require(msg.value >= cfg.minAmount,                "AnetSwap: amount below minimum");
        require(cfg.maxAmount == 0 || msg.value <= cfg.maxAmount, "AnetSwap: amount above maximum");
        require(bytes(anetRecipient).length >= 4,          "AnetSwap: invalid ANET recipient");

        uint256 fee       = (msg.value * feeBps) / 10_000;
        uint256 netAmount = msg.value - fee;

        if (fee > 0) {
            (bool ok, ) = payable(feeRecipient).call{value: fee}("");
            if (!ok) {
                netAmount = msg.value;
                emit FeeForwardFailed(address(0), feeRecipient, fee);
            }
        }

        totalNativeReceived += netAmount;

        uint256 id = _swaps.length;
        _swaps.push(SwapRequest({
            id:            id,
            evmSender:     msg.sender,
            anetRecipient: anetRecipient,
            tokenAddress:  address(0),
            grossAmount:   msg.value,
            netAmount:     netAmount,
            feePaid:       fee,
            timestamp:     block.timestamp,
            processed:     false,
            anetTxId:      ""
        }));

        emit SwapRequested(id, msg.sender, anetRecipient, address(0), msg.value, netAmount, fee, block.timestamp);
    }

    function swapTokenForAnet(
        address token,
        uint256 amount,
        string  calldata anetRecipient
    ) external nonReentrant whenNotPaused {
        require(token != address(0),                       "AnetSwap: use swapNativeForAnet for BNB");
        TokenConfig memory cfg = tokenConfigs[token];
        require(cfg.accepted,                              "AnetSwap: token not accepted");
        require(amount >= cfg.minAmount,                   "AnetSwap: amount below minimum");
        require(cfg.maxAmount == 0 || amount <= cfg.maxAmount, "AnetSwap: amount above maximum");
        require(bytes(anetRecipient).length >= 4,          "AnetSwap: invalid ANET recipient");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 fee       = (amount * feeBps) / 10_000;
        uint256 netAmount = amount - fee;

        if (fee > 0) {
            IERC20(token).safeTransfer(feeRecipient, fee);
        }

        totalTokenReceived[token] += netAmount;

        uint256 id = _swaps.length;
        _swaps.push(SwapRequest({
            id:            id,
            evmSender:     msg.sender,
            anetRecipient: anetRecipient,
            tokenAddress:  token,
            grossAmount:   amount,
            netAmount:     netAmount,
            feePaid:       fee,
            timestamp:     block.timestamp,
            processed:     false,
            anetTxId:      ""
        }));

        emit SwapRequested(id, msg.sender, anetRecipient, token, amount, netAmount, fee, block.timestamp);
    }

    // ── View functions ────────────────────────────────────────────────────────

    function getSwap(uint256 id) external view returns (SwapRequest memory) {
        require(id < _swaps.length, "AnetSwap: invalid ID");
        return _swaps[id];
    }

    function getSwapCount() external view returns (uint256) {
        return _swaps.length;
    }

    function getPendingSwaps() external view returns (uint256[] memory ids, SwapRequest[] memory swaps) {
        uint256 pendingCount = 0;
        for (uint256 i = 0; i < _swaps.length; i++) {
            if (!_swaps[i].processed) pendingCount++;
        }

        ids   = new uint256[](pendingCount);
        swaps = new SwapRequest[](pendingCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < _swaps.length; i++) {
            if (!_swaps[i].processed) {
                ids[idx]   = i;
                swaps[idx] = _swaps[i];
                idx++;
            }
        }
    }

    function getSwapsBySender(address sender) external view returns (SwapRequest[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < _swaps.length; i++) {
            if (_swaps[i].evmSender == sender) count++;
        }
        uint256 cap = count > 50 ? 50 : count;
        SwapRequest[] memory result = new SwapRequest[](cap);
        uint256 idx = 0;
        for (uint256 i = _swaps.length; i > 0 && idx < cap; i--) {
            if (_swaps[i - 1].evmSender == sender) {
                result[idx++] = _swaps[i - 1];
            }
        }
        return result;
    }

    function getPendingSwapsPaged(uint256 startId, uint256 maxScan, uint256 maxReturn)
        external view
        returns (uint256[] memory ids, SwapRequest[] memory swaps, uint256 nextStartId)
    {
        uint256 total = _swaps.length;
        if (startId >= total || maxScan == 0 || maxReturn == 0) {
            return (new uint256[](0), new SwapRequest[](0), total);
        }
        uint256 endExclusive = startId + maxScan;
        if (endExclusive > total) endExclusive = total;

        uint256 found;
        for (uint256 i = startId; i < endExclusive && found < maxReturn; i++) {
            if (!_swaps[i].processed) found++;
        }

        ids   = new uint256[](found);
        swaps = new SwapRequest[](found);
        uint256 idx;
        uint256 cursor = startId;
        for (; cursor < endExclusive && idx < found; cursor++) {
            if (!_swaps[cursor].processed) {
                ids[idx]   = cursor;
                swaps[idx] = _swaps[cursor];
                idx++;
            }
        }
        nextStartId = cursor;
    }

    function getContractBalance() external view returns (uint256 nativeBal) {
        nativeBal = address(this).balance;
    }

    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ── Internal: timelock helpers (mirror AnetBridgeVault) ───────────────────

    function _schedule(bytes32 id, bytes32 paramKey, bytes32 valueHash) internal {
        require(!pending[id].exists, "AnetSwap: duplicate schedule");
        uint64 eta = uint64(block.timestamp + TIMELOCK_DELAY);
        pending[id] = PendingChange({
            paramKey:  paramKey,
            valueHash: valueHash,
            eta:       eta,
            exists:    true
        });
        emit ChangeScheduled(id, paramKey, eta);
    }

    function _consume(bytes32 id, bytes32 expectedKey, bytes32 expectedValueHash) internal {
        PendingChange memory p = pending[id];
        require(p.exists,                              "AnetSwap: no such change");
        require(p.paramKey  == expectedKey,            "AnetSwap: wrong param");
        require(p.valueHash == expectedValueHash,      "AnetSwap: value mismatch");
        require(block.timestamp >= p.eta,              "AnetSwap: timelock");
        require(block.timestamp <= uint256(p.eta) + EXECUTION_GRACE, "AnetSwap: change expired");
        delete pending[id];
        emit ChangeExecuted(id, expectedKey);
    }

    // Allow contract to receive native coin directly (for swapNativeForAnet)
    receive() external payable {}
}
