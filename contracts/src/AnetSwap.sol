// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * AnetSwap — EVM-to-ANET L1 Bridge Contract
 * ============================================
 * Deployed on: BNB Smart Chain (chainId 56)
 *              Ethereum, Polygon, Base, etc. (future)
 *
 * Flow:
 *   1. User calls swapBNBForAnet() or swapTokenForAnet() with their ANET L1 address.
 *   2. Contract emits SwapRequested event and stores the request.
 *   3. The ANET L1 bridge backend (pi-backend) detects the event via polling.
 *   4. Backend credits the ANET L1 wallet at the current bridge rate.
 *   5. Backend calls markProcessed() on this contract with the L1 tx ID.
 *
 * Security:
 *   - ReentrancyGuard on all state-changing external functions.
 *   - SafeERC20 for all token transfers.
 *   - Pausable for emergency stops.
 *   - Ownable — owner is the ANET L1 bridge multisig/backend wallet.
 *   - Maximum individual swap cap to limit exposure.
 *   - Token allowlist — only whitelisted tokens accepted.
 */

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
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

abstract contract Context {
    function _msgSender() internal view virtual returns (address) { return msg.sender; }
}

abstract contract Ownable is Context {
    address private _owner;
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address initialOwner) {
        require(initialOwner != address(0), "Ownable: zero address");
        _owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        require(_msgSender() == _owner, "Ownable: caller is not the owner");
        _;
    }

    function owner() public view returns (address) { return _owner; }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Ownable: zero address");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
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

abstract contract Pausable is Context {
    bool private _paused;
    event Paused(address account);
    event Unpaused(address account);

    modifier whenNotPaused() {
        require(!_paused, "Pausable: paused");
        _;
    }

    function paused() public view returns (bool) { return _paused; }
    function _pause() internal { _paused = true; emit Paused(_msgSender()); }
    function _unpause() internal { _paused = false; emit Unpaused(_msgSender()); }
}

contract AnetSwap is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ── State ─────────────────────────────────────────────────────────────────

    struct TokenConfig {
        bool accepted;
        uint256 minAmount;   // smallest unit (wei for BNB, token decimals for ERC20)
        uint256 maxAmount;   // 0 = no cap
        uint8   decimals;
        string  symbol;
    }

    struct SwapRequest {
        uint256 id;
        address evmSender;
        string  anetRecipient;   // ANET L1 wallet address (e.g. "ANET1abc...")
        address tokenAddress;    // address(0) = native BNB/ETH
        uint256 grossAmount;     // amount user sent (before fee)
        uint256 netAmount;       // amount after fee deduction
        uint256 feePaid;
        uint256 timestamp;
        bool    processed;
        string  anetTxId;        // filled by admin after L1 credit
    }

    // address(0) = native coin config
    mapping(address => TokenConfig) public tokenConfigs;
    SwapRequest[] private _swaps;

    uint256 public feeBps         = 100;    // default 1% (100 / 10000)
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

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address initialOwner, address _feeRecipient) Ownable(initialOwner) {
        require(_feeRecipient != address(0), "AnetSwap: zero fee recipient");
        feeRecipient = _feeRecipient;

        // Accept native coin (BNB on BSC, ETH on Ethereum, etc.) by default.
        // 0.01 BNB minimum, no max cap, 18 decimals.
        tokenConfigs[address(0)] = TokenConfig({
            accepted: true,
            minAmount: 0.01 ether,
            maxAmount: 0,
            decimals: 18,
            symbol: "BNB"
        });
    }

    // ── Admin: token management ───────────────────────────────────────────────

    function configureToken(
        address token,
        bool    accepted,
        uint256 minAmount,
        uint256 maxAmount,
        uint8   decimals,
        string  calldata symbol
    ) external onlyOwner {
        tokenConfigs[token] = TokenConfig({
            accepted: accepted,
            minAmount: minAmount,
            maxAmount: maxAmount,
            decimals: decimals,
            symbol: symbol
        });
        emit TokenConfigUpdated(token, accepted, minAmount, maxAmount);
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 500, "AnetSwap: fee exceeds 5%");
        emit FeeBpsUpdated(feeBps, _feeBps);
        feeBps = _feeBps;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "AnetSwap: zero address");
        emit FeeRecipientUpdated(feeRecipient, _feeRecipient);
        feeRecipient = _feeRecipient;
    }

    // ── Admin: mark processed ─────────────────────────────────────────────────

    /**
     * @notice Called by ANET L1 bridge backend after crediting the user's L1 wallet.
     * @param id       The swap request ID (from SwapRequested event).
     * @param anetTxId The ANET L1 transaction ID confirming the credit.
     */
    function markProcessed(uint256 id, string calldata anetTxId) external onlyOwner {
        require(id < _swaps.length, "AnetSwap: invalid swap ID");
        require(!_swaps[id].processed, "AnetSwap: already processed");
        require(bytes(anetTxId).length > 0, "AnetSwap: anetTxId required");

        _swaps[id].processed = true;
        _swaps[id].anetTxId  = anetTxId;
        totalSwapsProcessed++;

        emit SwapProcessed(id, anetTxId, msg.sender);
    }

    // ── Admin: batch mark ─────────────────────────────────────────────────────

    function batchMarkProcessed(
        uint256[] calldata ids,
        string[]  calldata anetTxIds
    ) external onlyOwner {
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

    // ── Admin: fund recovery ──────────────────────────────────────────────────

    function withdrawNative(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "AnetSwap: insufficient balance");
        payable(owner()).transfer(amount);
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        require(token != address(0), "AnetSwap: use withdrawNative for BNB");
        IERC20(token).safeTransfer(owner(), amount);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── User: swap native coin (BNB/ETH/MATIC) for ANET L1 ───────────────────

    /**
     * @notice Send BNB (or chain's native coin) to receive ANET L1 tokens.
     * @param anetRecipient  The ANET L1 wallet address that will receive the tokens.
     *
     * Emits a {SwapRequested} event. The ANET L1 bridge backend listens for this
     * event and credits the corresponding ANET L1 wallet at the current bridge rate.
     */
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
            payable(feeRecipient).transfer(fee);
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

    /**
     * @notice Send an ERC-20/BEP-20 token (USDT, USDC, WBNB, etc.) to receive ANET L1 tokens.
     * @param token         The ERC-20 contract address (must be whitelisted).
     * @param amount        Amount in the token's smallest unit.
     * @param anetRecipient The ANET L1 wallet address that will receive the tokens.
     *
     * The caller must have approved this contract for at least `amount` first.
     */
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

    /// @return ids and swaps of all unprocessed requests (for bridge backend polling)
    function getPendingSwaps() external view returns (uint256[] memory ids, SwapRequest[] memory swaps) {
        uint256 pending = 0;
        for (uint256 i = 0; i < _swaps.length; i++) {
            if (!_swaps[i].processed) pending++;
        }

        ids   = new uint256[](pending);
        swaps = new SwapRequest[](pending);
        uint256 idx = 0;
        for (uint256 i = 0; i < _swaps.length; i++) {
            if (!_swaps[i].processed) {
                ids[idx]   = i;
                swaps[idx] = _swaps[i];
                idx++;
            }
        }
    }

    /// @return Swaps requested by a specific EVM sender (most recent first, capped at 50)
    function getSwapsBySender(address sender) external view returns (SwapRequest[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < _swaps.length; i++) {
            if (_swaps[i].evmSender == sender) count++;
        }
        uint256 cap = count > 50 ? 50 : count;
        SwapRequest[] memory result = new SwapRequest[](cap);
        uint256 idx = 0;
        // iterate reversed for most-recent-first
        for (uint256 i = _swaps.length; i > 0 && idx < cap; i--) {
            if (_swaps[i - 1].evmSender == sender) {
                result[idx++] = _swaps[i - 1];
            }
        }
        return result;
    }

    function getContractBalance() external view returns (uint256 nativeBal) {
        nativeBal = address(this).balance;
    }

    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // Allow contract to receive BNB directly (for swapNativeForAnet)
    receive() external payable {}
}
