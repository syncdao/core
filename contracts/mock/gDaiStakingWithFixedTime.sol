pragma solidity 0.5.16;

import "../gDaiStaking.sol";

/**
 * Mock contract for testing only - not to be deployed in production
 */
contract gDaiStakingWithFixedTime is gDaiStaking {
    uint256 public time;

    constructor(
        address _rewardsToken,
        address _stakingController,
        uint _rewardsDurationSeconds,
        uint _startDate
    ) gDaiStaking(_rewardsToken, _stakingController, _rewardsDurationSeconds, _startDate) public {}

    function fixTime(uint256 _time) external {
        time = _time;
    }

    function _getNow() internal view returns (uint256) {
        if (time > 0) {
            return time;
        }
        return block.timestamp;
    }
}
