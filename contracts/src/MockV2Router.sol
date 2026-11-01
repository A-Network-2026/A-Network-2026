// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Hardhat-only UniswapV2/PancakeSwap V2 router mock covering the three
///      "SupportingFeeOnTransferTokens" entrypoints used by AnetFeeRouter.
///      Pays out at a fixed rate from its own inventory. Do NOT deploy.
interface IERC20MockV2 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract MockV2Router {
    address public immutable weth;
    uint256 public rateNum;   // out = in * rateNum / rateDen
    uint256 public rateDen;

    // Records the last swap so tests can assert the exact amounts forwarded.
    uint256 public lastAmountIn;
    address public lastTo;

    constructor(address weth_, uint256 rateNum_, uint256 rateDen_) {
        require(weth_ != address(0), "weth=0");
        require(rateDen_ > 0, "den=0");
        weth = weth_;
        rateNum = rateNum_;
        rateDen = rateDen_;
    }

    function setRate(uint256 num, uint256 den) external {
        require(den > 0, "den=0");
        rateNum = num;
        rateDen = den;
    }

    function WETH() external view returns (address) {
        return weth;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = (amountIn * rateNum) / rateDen;
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable {
        require(block.timestamp <= deadline, "UniswapV2Router: EXPIRED");
        require(path[0] == weth, "UniswapV2Router: INVALID_PATH");
        uint256 out = (msg.value * rateNum) / rateDen;
        require(out >= amountOutMin, "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        lastAmountIn = msg.value;
        lastTo = to;
        require(IERC20MockV2(path[path.length - 1]).transfer(to, out), "pay failed");
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external {
        require(block.timestamp <= deadline, "UniswapV2Router: EXPIRED");
        require(path[path.length - 1] == weth, "UniswapV2Router: INVALID_PATH");
        require(IERC20MockV2(path[0]).transferFrom(msg.sender, address(this), amountIn), "pull failed");
        uint256 out = (amountIn * rateNum) / rateDen;
        require(out >= amountOutMin, "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        lastAmountIn = amountIn;
        lastTo = to;
        (bool ok, ) = to.call{value: out}("");
        require(ok, "eth send failed");
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external {
        require(block.timestamp <= deadline, "UniswapV2Router: EXPIRED");
        require(IERC20MockV2(path[0]).transferFrom(msg.sender, address(this), amountIn), "pull failed");
        uint256 out = (amountIn * rateNum) / rateDen;
        require(out >= amountOutMin, "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        lastAmountIn = amountIn;
        lastTo = to;
        require(IERC20MockV2(path[path.length - 1]).transfer(to, out), "pay failed");
    }

    // Inventory funding for tests.
    receive() external payable {}
}

/// @dev ERC-20 that burns `feeBps` of every transfer (fee-on-transfer token).
contract MockFeeOnTransferToken {
    string public name = "FeeToken";
    string public symbol = "FOT";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    uint256 public immutable feeBps;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 feeBps_) {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "balance");
        uint256 burn = (amount * feeBps) / 10_000;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - burn;
        totalSupply -= burn;
    }
}

/// @dev ERC-20 whose `transfer` re-enters the fee router (attack simulation).
interface IAnetFeeRouterReentry {
    function swapExactTokensForTokens(uint256, uint256, address[] calldata, uint256) external;
}

contract MockReentrantToken {
    string public name = "Reentrant";
    string public symbol = "REE";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    address public target;
    address public other;
    bool public attacked;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function arm(address target_, address other_) external {
        target = target_;
        other = other_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        // Re-enter on the fee payout (first transfer the router makes).
        if (target != address(0) && !attacked && msg.sender == target) {
            attacked = true;
            address[] memory path = new address[](2);
            path[0] = address(this);
            path[1] = other;
            IAnetFeeRouterReentry(target).swapExactTokensForTokens(1, 0, path, block.timestamp + 1);
        }
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
