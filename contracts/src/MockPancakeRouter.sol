// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Minimal PancakeSwap V2 router mock for Hardhat tests only.
///      Simulates the ANET/WBNB pool: pulls `amountIn` of path[0] from the
///      caller and pays out BNB to `to` at a configurable rate. Do NOT deploy.
interface IERC20Mock {
    function balanceOf(address) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract MockPancakeRouter {
    address public immutable weth;     // pretend WBNB
    uint256 public rateNum;            // BNB out = amountIn * rateNum / rateDen
    uint256 public rateDen;

    constructor(address weth_, uint256 rateNum_, uint256 rateDen_) {
        require(weth_ != address(0), "weth=0");
        require(rateDen_ > 0, "den=0");
        weth    = weth_;
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
        return amounts;
    }

    /// @dev Pulls path[0] tokens from caller, sends BNB to `to`.
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "expired");
        uint256 out = (amountIn * rateNum) / rateDen;
        require(out >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");

        require(IERC20Mock(path[0]).transferFrom(msg.sender, address(this), amountIn), "pull failed");
        (bool ok, ) = to.call{value: out}("");
        require(ok, "bnb send failed");

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = out;
        return amounts;
    }

    // Fund the router with BNB so it can pay out swaps in tests.
    receive() external payable {}
}
