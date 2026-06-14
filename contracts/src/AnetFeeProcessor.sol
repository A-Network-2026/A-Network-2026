// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ AnetFeeProcessor — converts collected ANET fees → WBNB/BNB on-chain      ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║ Token:  0x791055A7d52AA392eaE8De04250497f33807E46A (ANET BEP-20)         ║
 * ║                                                                          ║
 * ║ WHAT THIS IS                                                             ║
 * ║   A transparent, on-chain "fee desk". Protocol/bridge fees accrue here  ║
 * ║   as ANET. `processFees` swaps a bounded amount of that ANET into BNB   ║
 * ║   through the PUBLIC PancakeSwap ANET/WBNB pool and forwards the BNB to  ║
 * ║   the settlement treasury (used to pay gas, relayer costs, etc.).       ║
 * ║                                                                          ║
 * ║   This is NOT a token wrapper and NOT a minter. It holds no special     ║
 * ║   privilege over ANET supply. It simply trades fees on the open market  ║
 * ║   pool, so every conversion is visible and price-discovered on-chain.   ║
 * ║                                                                          ║
 * ║ TRANSPARENCY                                                            ║
 * ║   Every conversion emits `FeesProcessed` with the exact ANET in / BNB   ║
 * ║   out, the destination, and a human-readable `memo`. The pool, router   ║
 * ║   and explorer references are surfaced by `transparency()` so anyone    ║
 * ║   can replay the swap on a public explorer.                             ║
 * ║                                                                          ║
 * ║ SAFETY                                                                  ║
 * ║   • Slippage floor: caller passes `minBnbOut`; the swap reverts if the  ║
 * ║     pool would return less. A separate on-chain `maxSlippageBps` guard  ║
 * ║     also rejects quotes worse than the configured tolerance.            ║
 * ║   • Per-call cap on ANET spent (bounds a compromised operator).         ║
 * ║   • operator: hot key that may trigger swaps (no fund-moving power       ║
 * ║     beyond routing fees to the fixed treasury).                         ║
 * ║   • admin (Safe): all params via 48h timelock + 14d grace.              ║
 * ║   • pauser: separate cold key; instant pause, admin-only unpause.        ║
 * ║   • ReentrancyGuard + SafeERC20 throughout.                             ║
 * ║   • BNB destination is the fixed `settlementTreasury` (changeable only   ║
 * ║     via timelock) — fees can never be routed to an arbitrary address.   ║
 * ║                                                                          ║
 * ║ Solidity 0.8.20, vendored minimal interfaces (trivial BscScan verify).  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner_, address spender) external view returns (uint256);
}

/// @dev Minimal PancakeSwap V2 router surface used here.
interface IPancakeRouter02 {
    function WETH() external view returns (address);
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts);
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }

    /// @dev Some tokens (USDT-style) require allowance reset to 0 first. ANET is
    ///      standard, but we reset-then-set to remain robust for any router.
    function safeApprove(IERC20 token, address spender, uint256 value) internal {
        (bool ok0, bytes memory d0) = address(token).call(
            abi.encodeWithSelector(token.approve.selector, spender, 0)
        );
        require(ok0 && (d0.length == 0 || abi.decode(d0, (bool))), "SafeERC20: approve(0) failed");
        (bool ok1, bytes memory d1) = address(token).call(
            abi.encodeWithSelector(token.approve.selector, spender, value)
        );
        require(ok1 && (d1.length == 0 || abi.decode(d1, (bool))), "SafeERC20: approve failed");
    }
}

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;
    modifier nonReentrant() {
        require(_status != _ENTERED, "Fee: reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

contract AnetFeeProcessor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────────
    IERC20 public immutable ANET;
    uint256 public constant TIMELOCK_DELAY  = 48 hours;
    uint256 public constant EXECUTION_GRACE = 14 days;
    uint256 public constant MAX_BPS         = 10_000;
    uint256 public constant MAX_MEMO_BYTES  = 256;

    // ── Roles ─────────────────────────────────────────────────────────────────
    address public admin;
    address public pendingAdmin;
    address public pauser;
    address public operator;
    bool    public paused;

    // ── Config ────────────────────────────────────────────────────────────────
    IPancakeRouter02 public router;       // PancakeSwap V2 router
    address public wbnb;                  // router.WETH() (WBNB on BSC)
    address public settlementTreasury;    // fixed BNB destination
    uint256 public maxAnetPerCall;        // hard cap on ANET spent per swap
    uint256 public maxSlippageBps;        // reject quotes worse than this vs spot

    // ── Accounting ──────────────────────────────────────────────────────────────
    uint256 public totalAnetProcessed;    // cumulative ANET swapped
    uint256 public totalBnbOut;           // cumulative BNB delivered to treasury

    // ── Transparency references ──────────────────────────────────────────────
    string private _bscExplorerBase;      // e.g. "https://bscscan.com/tx/"
    string private _poolInfo;             // e.g. "PancakeSwap V2 ANET/WBNB 0x…"

    // ── Timelock ────────────────────────────────────────────────────────────────
    struct PendingChange { bytes32 paramKey; bytes32 valueHash; uint64 eta; bool exists; }
    mapping(bytes32 => PendingChange) public pending;

    // ── Events ────────────────────────────────────────────────────────────────
    event FeesProcessed(
        address indexed caller,
        uint256 anetIn,
        uint256 bnbOut,
        address indexed treasury,
        string  memo
    );
    event RouterUpdated(address indexed router, address indexed wbnb);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event LimitsUpdated(uint256 maxAnetPerCall, uint256 maxSlippageBps);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event PauserUpdated(address indexed oldPauser, address indexed newPauser);
    event PausedBy(address indexed who);
    event UnpausedBy(address indexed who);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferAccepted(address indexed oldAdmin, address indexed newAdmin);
    event ChangeScheduled(bytes32 indexed id, bytes32 paramKey, uint64 eta);
    event ChangeExecuted(bytes32 indexed id, bytes32 paramKey);
    event ChangeCancelled(bytes32 indexed id, bytes32 paramKey);
    event OtherTokenRescued(address indexed token, address indexed to, uint256 amount);
    event TransparencyUpdated(string bscExplorerBase, string poolInfo);

    // ── Modifiers ────────────────────────────────────────────────────────────────
    modifier onlyAdmin() { require(msg.sender == admin, "Fee: not admin"); _; }
    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == admin, "Fee: not operator");
        _;
    }
    modifier whenNotPaused() { require(!paused, "Fee: paused"); _; }

    // ── Constructor ────────────────────────────────────────────────────────────────
    constructor(
        IERC20  anet_,
        IPancakeRouter02 router_,
        address settlementTreasury_,
        address admin_,
        address pauser_,
        address operator_,
        uint256 maxAnetPerCall_,
        uint256 maxSlippageBps_
    ) {
        require(address(anet_) != address(0),       "Fee: token=0");
        require(address(router_) != address(0),     "Fee: router=0");
        require(settlementTreasury_ != address(0),  "Fee: treasury=0");
        require(admin_  != address(0),              "Fee: admin=0");
        require(pauser_ != address(0),              "Fee: pauser=0");
        require(operator_ != address(0),            "Fee: operator=0");

        ANET     = anet_;
        admin    = admin_;
        pauser   = pauser_;
        operator = operator_;

        _setRouter(router_);
        settlementTreasury = settlementTreasury_;
        emit TreasuryUpdated(address(0), settlementTreasury_);
        _setLimits(maxAnetPerCall_, maxSlippageBps_);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core: convert ANET fees → BNB via the public ANET/WBNB pool.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Swap `anetAmount` of held ANET into BNB and send it to the fixed
     *         settlement treasury.
     * @param anetAmount  ANET to convert (≤ maxAnetPerCall and ≤ balance).
     * @param minBnbOut   Caller's slippage floor (wei BNB). Swap reverts below it.
     * @param deadline    Unix time after which the router rejects the swap.
     * @param memo        Human-readable note (≤ 256 bytes) emitted for transparency.
     * @return bnbOut     Actual BNB delivered to the treasury.
     */
    function processFees(
        uint256 anetAmount,
        uint256 minBnbOut,
        uint256 deadline,
        string calldata memo
    ) external nonReentrant whenNotPaused onlyOperator returns (uint256 bnbOut) {
        require(anetAmount > 0,                    "Fee: amount=0");
        require(anetAmount <= maxAnetPerCall,      "Fee: > per-call cap");
        require(block.timestamp <= deadline,       "Fee: expired");
        require(bytes(memo).length <= MAX_MEMO_BYTES, "Fee: memo too long");
        require(ANET.balanceOf(address(this)) >= anetAmount, "Fee: insufficient ANET");

        address[] memory path = new address[](2);
        path[0] = address(ANET);
        path[1] = wbnb;

        // On-chain spot quote → enforce a hard slippage tolerance independent of
        // the caller-supplied floor, so a compromised operator can't push a
        // 99%-slippage trade through with minBnbOut = 1.
        uint256[] memory quote = router.getAmountsOut(anetAmount, path);
        uint256 spotOut = quote[quote.length - 1];
        require(spotOut > 0, "Fee: no liquidity");
        uint256 floorBps = (spotOut * (MAX_BPS - maxSlippageBps)) / MAX_BPS;
        uint256 effectiveMin = minBnbOut > floorBps ? minBnbOut : floorBps;

        // Approve exactly what we spend, then swap to BNB (router unwraps WBNB).
        ANET.safeApprove(address(router), anetAmount);

        uint256 balBefore = settlementTreasury.balance;
        router.swapExactTokensForETH(anetAmount, effectiveMin, path, settlementTreasury, deadline);
        bnbOut = settlementTreasury.balance - balBefore;
        require(bnbOut >= effectiveMin, "Fee: slippage");

        // Clear any residual allowance defensively.
        ANET.safeApprove(address(router), 0);

        totalAnetProcessed += anetAmount;
        totalBnbOut        += bnbOut;

        emit FeesProcessed(msg.sender, anetAmount, bnbOut, settlementTreasury, memo);
    }

    /// @notice Spot quote of BNB out for `anetAmount` ANET on the configured pool.
    function quoteBnbOut(uint256 anetAmount) external view returns (uint256) {
        if (anetAmount == 0) return 0;
        address[] memory path = new address[](2);
        path[0] = address(ANET);
        path[1] = wbnb;
        uint256[] memory quote = router.getAmountsOut(anetAmount, path);
        return quote[quote.length - 1];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pauser / admin transfer
    // ─────────────────────────────────────────────────────────────────────────

    function pause() external {
        require(msg.sender == pauser || msg.sender == admin, "Fee: not pauser");
        paused = true;
        emit PausedBy(msg.sender);
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit UnpausedBy(msg.sender);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Fee: zero admin");
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "Fee: not pending admin");
        emit AdminTransferAccepted(admin, pendingAdmin);
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }

    /// @notice Operator is a hot key with no fund-moving power beyond triggering
    ///         swaps to the fixed treasury, so it is rotatable without timelock.
    function setOperator(address newOperator) external onlyAdmin {
        require(newOperator != address(0), "Fee: operator=0");
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Timelocked parameter changes (router, treasury, limits, transparency, pauser)
    // ─────────────────────────────────────────────────────────────────────────

    bytes32 public constant PARAM_ROUTER       = keccak256("ROUTER");
    bytes32 public constant PARAM_TREASURY     = keccak256("TREASURY");
    bytes32 public constant PARAM_LIMITS       = keccak256("LIMITS");
    bytes32 public constant PARAM_PAUSER       = keccak256("PAUSER");

    function scheduleRouter(IPancakeRouter02 newRouter) external onlyAdmin returns (bytes32 id) {
        require(address(newRouter) != address(0), "Fee: router=0");
        id = _schedule(PARAM_ROUTER, keccak256(abi.encode(address(newRouter))));
    }

    function executeRouter(IPancakeRouter02 newRouter, bytes32 id) external onlyAdmin {
        _consume(id, PARAM_ROUTER, keccak256(abi.encode(address(newRouter))));
        _setRouter(newRouter);
    }

    function scheduleTreasury(address newTreasury) external onlyAdmin returns (bytes32 id) {
        require(newTreasury != address(0), "Fee: treasury=0");
        id = _schedule(PARAM_TREASURY, keccak256(abi.encode(newTreasury)));
    }

    function executeTreasury(address newTreasury, bytes32 id) external onlyAdmin {
        require(newTreasury != address(0), "Fee: treasury=0");
        _consume(id, PARAM_TREASURY, keccak256(abi.encode(newTreasury)));
        emit TreasuryUpdated(settlementTreasury, newTreasury);
        settlementTreasury = newTreasury;
    }

    function scheduleLimits(uint256 maxAnetPerCall_, uint256 maxSlippageBps_)
        external onlyAdmin returns (bytes32 id)
    {
        id = _schedule(PARAM_LIMITS, keccak256(abi.encode(maxAnetPerCall_, maxSlippageBps_)));
    }

    function executeLimits(uint256 maxAnetPerCall_, uint256 maxSlippageBps_, bytes32 id)
        external onlyAdmin
    {
        _consume(id, PARAM_LIMITS, keccak256(abi.encode(maxAnetPerCall_, maxSlippageBps_)));
        _setLimits(maxAnetPerCall_, maxSlippageBps_);
    }

    function schedulePauser(address newPauser) external onlyAdmin returns (bytes32 id) {
        require(newPauser != address(0), "Fee: pauser=0");
        id = _schedule(PARAM_PAUSER, keccak256(abi.encode(newPauser)));
    }

    function executePauser(address newPauser, bytes32 id) external onlyAdmin {
        _consume(id, PARAM_PAUSER, keccak256(abi.encode(newPauser)));
        emit PauserUpdated(pauser, newPauser);
        pauser = newPauser;
    }

    /// @notice Update human-readable transparency pointers (explorer base URL +
    ///         pool description). Informational only — they do not affect funds,
    ///         routing, slippage, or caps — so admin-settable without a timelock.
    function setTransparency(string calldata bscExplorerBase_, string calldata poolInfo_)
        external onlyAdmin
    {
        _bscExplorerBase = bscExplorerBase_;
        _poolInfo        = poolInfo_;
        emit TransparencyUpdated(bscExplorerBase_, poolInfo_);
    }

    function cancelChange(bytes32 id) external onlyAdmin {
        PendingChange memory p = pending[id];
        require(p.exists, "Fee: no such change");
        delete pending[id];
        emit ChangeCancelled(id, p.paramKey);
    }

    function _schedule(bytes32 paramKey, bytes32 valueHash) internal returns (bytes32 id) {
        uint64 eta = uint64(block.timestamp + TIMELOCK_DELAY);
        id = keccak256(abi.encode(paramKey, valueHash, eta, block.number));
        require(!pending[id].exists, "Fee: dup schedule");
        pending[id] = PendingChange({paramKey: paramKey, valueHash: valueHash, eta: eta, exists: true});
        emit ChangeScheduled(id, paramKey, eta);
    }

    function _consume(bytes32 id, bytes32 expectedKey, bytes32 expectedValueHash) internal {
        PendingChange memory p = pending[id];
        require(p.exists,                              "Fee: no such change");
        require(p.paramKey  == expectedKey,            "Fee: wrong param");
        require(p.valueHash == expectedValueHash,      "Fee: value mismatch");
        require(block.timestamp >= p.eta,              "Fee: timelock");
        require(block.timestamp <= uint256(p.eta) + EXECUTION_GRACE, "Fee: change expired");
        delete pending[id];
        emit ChangeExecuted(id, expectedKey);
    }

    // ── Internal setters ─────────────────────────────────────────────────────
    function _setRouter(IPancakeRouter02 router_) internal {
        address w = router_.WETH();
        require(w != address(0), "Fee: router WETH=0");
        router = router_;
        wbnb   = w;
        emit RouterUpdated(address(router_), w);
    }

    function _setLimits(uint256 maxAnetPerCall_, uint256 maxSlippageBps_) internal {
        require(maxAnetPerCall_ > 0,            "Fee: per-call cap=0");
        require(maxAnetPerCall_ <= 21_000_000 * 1e18, "Fee: cap > total supply");
        require(maxSlippageBps_ <= MAX_BPS,     "Fee: slippage > 100%");
        maxAnetPerCall = maxAnetPerCall_;
        maxSlippageBps = maxSlippageBps_;
        emit LimitsUpdated(maxAnetPerCall_, maxSlippageBps_);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rescue (foreign tokens only — this desk is meant to convert ANET, but a
    // stuck non-ANET token can be swept by admin). ANET is intentionally NOT
    // rescuable so collected fees can only leave via the public pool swap.
    // ─────────────────────────────────────────────────────────────────────────
    function rescueOtherToken(IERC20 token, address to, uint256 amount) external onlyAdmin {
        require(address(token) != address(ANET), "Fee: cannot rescue ANET");
        require(to != address(0),                 "Fee: to=0");
        token.safeTransfer(to, amount);
        emit OtherTokenRescued(address(token), to, amount);
    }

    // ── Views ────────────────────────────────────────────────────────────────
    function anetBalance() external view returns (uint256) {
        return ANET.balanceOf(address(this));
    }

    function transparency()
        external
        view
        returns (
            address anetToken,
            address routerAddr,
            address wbnbAddr,
            address treasury,
            string memory bscExplorerBase,
            string memory poolInfo
        )
    {
        return (address(ANET), address(router), wbnb, settlementTreasury, _bscExplorerBase, _poolInfo);
    }

    // Allow receiving native BNB (e.g. accidental sends or router refunds). Funds
    // are not auto-forwarded; admin can sweep via rescueBnb.
    receive() external payable {}

    function rescueBnb(address to, uint256 amount) external onlyAdmin {
        require(to != address(0), "Fee: to=0");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Fee: bnb send failed");
    }
}
