// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  AnetFeeRouter — non-custodial, atomic "fee-on-top" swap forwarder        ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  WHAT IT DOES                                                             ║
 * ║   • Takes `feeNumerator / FEE_DENOMINATOR` of the INPUT asset and sends   ║
 * ║     it to the immutable `treasury`, then forwards the remainder to the    ║
 * ║     public UniswapV2-style `router` (PancakeSwap V2 on BSC, Uniswap V2 on ║
 * ║     Ethereum) with `to = msg.sender` — all inside ONE transaction.        ║
 * ║   • If the swap reverts (slippage, deadline, no route) the WHOLE tx       ║
 * ║     reverts: the user never pays a fee for a failed trade.                ║
 * ║                                                                           ║
 * ║  WHAT IT CAN NEVER DO                                                     ║
 * ║   • Hold user funds between transactions (no balances are ever kept).     ║
 * ║   • Be paused, upgraded, or re-pointed: router, treasury and fee are      ║
 * ║     immutable. There is no owner and no privileged function at all.       ║
 * ║   • Pay anyone but the treasury: `sweep()` is permissionless and can only ║
 * ║     push stray dust (accidental transfers / airdrops) to the treasury.    ║
 * ║                                                                           ║
 * ║  To change the fee or the treasury: deploy a new instance and point the   ║
 * ║  front-end at it. Old instances keep working for anyone who still uses    ║
 * ║  them — they cannot be rugged.                                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUniswapV2Router02Minimal {
    function WETH() external pure returns (address);

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

contract AnetFeeRouter {
    // ─────────────────────────────────────────────────────────────────────────
    // Constants / immutables
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Fee denominator. 100_000 allows fractional basis points:
    ///         feeNumerator 875 = 0.875 %, 500 = 0.5 %, 30 = 0.03 %.
    uint256 public constant FEE_DENOMINATOR = 100_000;

    /// @notice Hard cap on the fee a deployment can ever charge (3 %).
    uint256 public constant MAX_FEE_NUMERATOR = 3_000;

    /// @notice Underlying public DEX router (PancakeSwap V2 / Uniswap V2).
    IUniswapV2Router02Minimal public immutable router;

    /// @notice Wrapped native token of `router` (WBNB / WETH).
    address public immutable WETH;

    /// @notice Fixed fee recipient. Cannot be changed after deployment.
    address payable public immutable treasury;

    /// @notice Fee taken from every swap's INPUT amount, over FEE_DENOMINATOR.
    uint256 public immutable feeNumerator;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    /// @param tokenIn  address(0) for the native coin (BNB / ETH).
    /// @param tokenOut address(0) for the native coin (BNB / ETH).
    event SwapWithFee(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 feeAmount,
        uint256 swapAmount
    );

    /// @notice Emitted when stray funds are pushed to the treasury.
    event Swept(address indexed token, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────
    // Reentrancy guard (minimal, no external dependency)
    // ─────────────────────────────────────────────────────────────────────────

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    modifier nonReentrant() {
        require(_status == _NOT_ENTERED, "FeeRouter: reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address router_, address payable treasury_, uint256 feeNumerator_) {
        require(router_ != address(0), "FeeRouter: router=0");
        require(treasury_ != address(0), "FeeRouter: treasury=0");
        require(feeNumerator_ <= MAX_FEE_NUMERATOR, "FeeRouter: fee too high");

        router = IUniswapV2Router02Minimal(router_);
        address weth = IUniswapV2Router02Minimal(router_).WETH();
        require(weth != address(0), "FeeRouter: WETH=0");

        WETH = weth;
        treasury = treasury_;
        feeNumerator = feeNumerator_;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Split an input amount into (fee, amount forwarded to the DEX).
    function quoteFee(uint256 amountIn) public view returns (uint256 feeAmount, uint256 swapAmount) {
        feeAmount = (amountIn * feeNumerator) / FEE_DENOMINATOR;
        swapAmount = amountIn - feeAmount;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Swaps (output always goes straight to msg.sender)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Native coin → ERC-20. `path[0]` must be the wrapped native token.
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external payable nonReentrant {
        require(path.length >= 2, "FeeRouter: bad path");
        require(path[0] == WETH, "FeeRouter: path[0] != WETH");
        require(msg.value > 0, "FeeRouter: zero amount");

        (uint256 feeAmount, uint256 swapAmount) = quoteFee(msg.value);
        require(swapAmount > 0, "FeeRouter: amount too small");

        _payNative(treasury, feeAmount);

        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: swapAmount}(
            amountOutMin,
            path,
            msg.sender,
            deadline
        );

        emit SwapWithFee(msg.sender, address(0), path[path.length - 1], msg.value, feeAmount, swapAmount);
    }

    /// @notice ERC-20 → native coin. `path[path.length-1]` must be the wrapped native token.
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external nonReentrant {
        require(path.length >= 2, "FeeRouter: bad path");
        require(path[path.length - 1] == WETH, "FeeRouter: path[last] != WETH");

        (uint256 feeAmount, uint256 swapAmount) = _pullAndTakeFee(path[0], amountIn);

        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            swapAmount,
            amountOutMin,
            path,
            msg.sender,
            deadline
        );

        emit SwapWithFee(msg.sender, path[0], address(0), feeAmount + swapAmount, feeAmount, swapAmount);
    }

    /// @notice ERC-20 → ERC-20.
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external nonReentrant {
        require(path.length >= 2, "FeeRouter: bad path");

        (uint256 feeAmount, uint256 swapAmount) = _pullAndTakeFee(path[0], amountIn);

        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            swapAmount,
            amountOutMin,
            path,
            msg.sender,
            deadline
        );

        emit SwapWithFee(msg.sender, path[0], path[path.length - 1], feeAmount + swapAmount, feeAmount, swapAmount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Permissionless dust recovery — can ONLY pay the treasury
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Push any stray balance (tokens sent here by mistake, airdrops,
    ///         force-fed native coin) to the treasury. The contract never holds
    ///         user funds in normal operation, so this can never touch a trade.
    /// @param token ERC-20 address, or address(0) for the native coin.
    function sweep(address token) external nonReentrant {
        uint256 amount;
        if (token == address(0)) {
            amount = address(this).balance;
            require(amount > 0, "FeeRouter: nothing to sweep");
            _payNative(treasury, amount);
        } else {
            amount = IERC20Minimal(token).balanceOf(address(this));
            require(amount > 0, "FeeRouter: nothing to sweep");
            _safeTransfer(token, treasury, amount);
        }
        emit Swept(token, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Pulls `amountIn` of `token` from the caller using balance-difference
    ///      accounting (so fee-on-transfer tokens are charged on what actually
    ///      arrived), pays the fee to the treasury and approves the router for
    ///      exactly the remainder.
    function _pullAndTakeFee(address token, uint256 amountIn)
        private
        returns (uint256 feeAmount, uint256 swapAmount)
    {
        require(amountIn > 0, "FeeRouter: zero amount");

        uint256 before = IERC20Minimal(token).balanceOf(address(this));
        _safeTransferFrom(token, msg.sender, address(this), amountIn);
        uint256 received = IERC20Minimal(token).balanceOf(address(this)) - before;
        require(received > 0, "FeeRouter: nothing received");

        (feeAmount, swapAmount) = quoteFee(received);
        require(swapAmount > 0, "FeeRouter: amount too small");

        if (feeAmount > 0) _safeTransfer(token, treasury, feeAmount);
        _safeApprove(token, address(router), swapAmount);
    }

    function _payNative(address payable to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "FeeRouter: native transfer failed");
    }

    /// @dev Tolerates tokens that return nothing (USDT on Ethereum) or `false`.
    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "FeeRouter: transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "FeeRouter: transferFrom failed");
    }

    /// @dev Some tokens (USDT on Ethereum) refuse to change a non-zero allowance
    ///      directly; reset to zero first in that case.
    function _safeApprove(address token, address spender, uint256 amount) private {
        if (!_approve(token, spender, amount)) {
            require(_approve(token, spender, 0), "FeeRouter: approve reset failed");
            require(_approve(token, spender, amount), "FeeRouter: approve failed");
        }
    }

    function _approve(address token, address spender, uint256 amount) private returns (bool) {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, amount)
        );
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }

    // No `receive()` / `fallback()`: plain native transfers to this contract
    // revert, so nobody can lose coins by sending them here by mistake.
}
