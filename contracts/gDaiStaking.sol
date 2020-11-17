pragma solidity 0.5.16;

/*
MIT License

Copyright (c) 2019 Synthetix

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import "openzeppelin-solidity-2.3.0/contracts/math/Math.sol";
import "openzeppelin-solidity-2.3.0/contracts/math/SafeMath.sol";
import "openzeppelin-solidity-2.3.0/contracts/token/ERC20/ERC20Detailed.sol";
import "openzeppelin-solidity-2.3.0/contracts/token/ERC20/SafeERC20.sol";
import "openzeppelin-solidity-2.3.0/contracts/utils/ReentrancyGuard.sol";

contract gDaiStaking is ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    IERC20 public rewardsToken;

    // @dev note: this would be the underlying gDai ERC20 token
    address public stakingController;
    uint256 public periodFinish;
    uint256 public rewardRate;
    uint256 public rewardsDuration;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public startDate;
    bool public started;

    mapping(address => uint256) public userRewardPerToken;
    mapping(address => uint256) public rewards;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address _rewardsToken,
        address _stakingController,
        uint256 _rewardsDurationSeconds,
        uint256 _startDate
    ) public {
        require(_rewardsToken != address(0), "_rewardsToken is zero address");
        require(_stakingController != address(0), "_stakingController is zero address");
        require(_rewardsDurationSeconds > 0, "_rewardsDurationSeconds is zero");
        require(_startDate > 0, "_startDate is zero");

        rewardsToken = IERC20(_rewardsToken);
        stakingController = _stakingController;
        rewardsDuration = _rewardsDurationSeconds;
        startDate = _startDate;
    }

    /* ========== VIEWS ========== */

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return Math.min(_getNow(), periodFinish);
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }

        if (lastTimeRewardApplicable() < lastUpdateTime) {
            return 0;
        }

        return
            rewardPerTokenStored.add(
                lastTimeRewardApplicable().sub(lastUpdateTime).mul(rewardRate).mul(1e18).div(_totalSupply)
            );
    }

    function earned(address account) public view returns (uint256) {
        return _balances[account].mul(rewardPerToken().sub(userRewardPerToken[account])).div(1e18).add(rewards[account]);
    }

    function getRewardForDuration() external view returns (uint256) {
        return rewardRate.mul(rewardsDuration);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function stake(address user, uint256 amount) external onlyController updateReward(user) {
        require(amount > 0, "Cannot stake 0");
        require(user != address(0), "User cannot be zero address");
        _totalSupply = _totalSupply.add(amount);
        _balances[user] = _balances[user].add(amount);
        emit Staked(user, amount);
    }

    function withdraw(address user, uint256 amount) public onlyController updateReward(user) {
        require(amount > 0, "Cannot withdraw 0");
        require(user != address(0), "User cannot be zero address");
        require(_balances[user] >= amount, "Amount greater than balance");

        _totalSupply = _totalSupply.sub(amount);
        _balances[user] = _balances[user].sub(amount);
        emit Withdrawn(user, amount);
        // We also send user his reward on each withdrawal
        uint256 reward = rewards[user];
        if (reward > 0) {
            rewards[user] = 0;
            rewardsToken.safeTransfer(user, reward);
            emit RewardPaid(user, reward);
        }
    }

    function getReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function start() external updateReward(address(0)) {
        require(_getNow() >= startDate, "startDate has not yet been reached");
        require(!started, "Distribution has already started");
        uint256 reward = rewardsToken.balanceOf(address(this));
        require(reward > 0, "No tokens were sent for rewards");
        rewardRate = reward.div(rewardsDuration);

        lastUpdateTime = _getNow();
        started = true;
        periodFinish = _getNow().add(rewardsDuration);
        emit Started(reward);
    }

    /* ========== MODIFIERS ========== */

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerToken[account] = rewardPerTokenStored;
        }
        _;
    }

    modifier onlyController() {
        require(msg.sender == stakingController, 'Only callable by controller');
        _;
    }

    /* ========== EVENTS ========== */

    event Started(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    /* ========== INTERNALS ========== */

    function _getNow() internal view returns (uint256) {
        return block.timestamp;
    }
}
