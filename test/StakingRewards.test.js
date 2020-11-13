const {BN, time, expectEvent, expectRevert, constants, ether} = require('@openzeppelin/test-helpers');
const {latest} = time;

const {fromWei} = require('web3-utils');

require('chai').should();

const StakingRewardsMock = artifacts.require('gDaiStakingWithFixedTime');
const StakingRewards = artifacts.require('gDaiStaking');
const SyncToken = artifacts.require('SyncToken');

contract('gDai Staking', function ([admin, alice, stakingController, bob, other, beneficiary3, ...otherAccounts]) {
  const TEN_BILLION = new BN(10000000000);
  const INITIAL_SUPPLY = ether(TEN_BILLION);

  const REWARD_VALUE = ether('1000');
  const STAKE_VALUE = ether('10');
  const _10days = new BN('10');
  const PERIOD_ONE_DAY_IN_SECONDS = new BN('86400');
  const _1DaysWorthOfReward = REWARD_VALUE.div(_10days);

  const ZERO = new BN('0');

  const daysInSeconds = (days) => days.mul(PERIOD_ONE_DAY_IN_SECONDS);

  const shouldBeNumberInEtherCloseTo = (valInWei, expected) => parseFloat(fromWei(valInWei)).should.be.closeTo(parseFloat(expected.toString()), 0.000001);

  beforeEach(async () => {
    this.token = await SyncToken.new(
      INITIAL_SUPPLY,
      admin,
      admin,
      {from: admin}
    );

    // Assert the token is set up correctly
    const creatorBalance = await this.token.balanceOf(admin);
    creatorBalance.should.be.bignumber.equal(INITIAL_SUPPLY);

    (await this.token.minter()).should.be.equal(admin);


    // Construct new staking contract
    this.stakingRewards = await StakingRewardsMock.new(
      this.token.address,
      stakingController,
      _10days.mul(PERIOD_ONE_DAY_IN_SECONDS),
      '5',
      {from: admin}
    );

    // fix time for testing
    await this.stakingRewards.fixTime('2', {from: admin});
  });

  it('should return rewards token address', async () => {
    const rewardsToken = await this.stakingRewards.rewardsToken();
    rewardsToken.should.be.equal(this.token.address);
  });

  describe.only('deploying', () => {
    it('Reverts when reward token is zero', async () => {
      await expectRevert(
        StakingRewards.new(
          constants.ZERO_ADDRESS,
          stakingController,
          _10days.mul(PERIOD_ONE_DAY_IN_SECONDS),
          '5',
          {from: admin}
        ),
        "_rewardsToken is zero address"
      );
    });

    it('Reverts when rewards duration is zero', async () => {
      await expectRevert(
        StakingRewards.new(
          this.token.address,
          stakingController,
          0,
          '5',
          {from: admin}
        ),
        "_rewardsDurationSeconds is zero"
      );
    });

    it('Reverts when start is zero', async () => {
      await expectRevert(
        StakingRewards.new(
          this.token.address,
          stakingController,
          10,
          0,
          {from: admin}
        ),
        "_startDate is zero"
      );
    });

    it('Reverts when staking rewards is zero', async () => {
      await expectRevert(
        StakingRewards.new(
          this.token.address,
          constants.ZERO_ADDRESS,
          _10days.mul(PERIOD_ONE_DAY_IN_SECONDS),
          '5',
          {from: admin}
        ),
        "_stakingController is zero address"
      );
    });
  });

  describe.only('start ', async () => {

    it('sets required reward rate on notify', async () => {
      (await this.stakingRewards.rewardRate()).should.be.bignumber.equal(ZERO);

      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: admin});

      await this.stakingRewards.fixTime('5', {from: admin});
      await this.stakingRewards.start({from: admin});

      (await this.stakingRewards.rewardRate()).should.be.bignumber.equal(REWARD_VALUE.div(daysInSeconds(_10days)));
      (await this.stakingRewards.lastUpdateTime()).should.be.bignumber.equal('5');

      (await this.stakingRewards.periodFinish()).should.be.bignumber.equal(daysInSeconds(_10days).addn(5));
    });

    describe('with real (not mock contract)', () => {
      it('can start issuing rewards', async () => {
        const stakingRewards = await StakingRewards.new(
          this.token.address,
          stakingController,
          _10days.mul(PERIOD_ONE_DAY_IN_SECONDS),
          '5',
          {from: admin}
        );

        await this.token.transfer(stakingRewards.address, REWARD_VALUE, {from: admin});

        await stakingRewards.start({from: admin});
      });
    });

    it('reverts if called twice', async () => {
      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: admin});
      await this.stakingRewards.fixTime('5', {from: admin});
      await this.stakingRewards.start({from: admin});

      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: admin});
      await expectRevert(
        this.stakingRewards.start({from: admin}),
        "Distribution has already started"
      );
    });

    it('reverts if start time is still in the future', async () => {
      await expectRevert(
        this.stakingRewards.start({from: admin}),
        "startDate has not yet been reached"
      );
    });

    it('reverts if no tokens sent', async () => {
      await this.stakingRewards.fixTime('5', {from: admin});

      await expectRevert(
        this.stakingRewards.start({from: admin}),
        "No tokens were sent for rewards"
      );
    });
  });

  describe.only('stake ', async () => {
    beforeEach(async () => {
      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: admin});

      await this.stakingRewards.fixTime('5', {from: admin});
      await this.stakingRewards.start({from: admin});
    });

    it('reverts if staking nothing', async () => {
      await expectRevert(
        this.stakingRewards.stake(alice, ZERO, {from: stakingController}),
        'Cannot stake 0'
      );
    });

    it('reverts if staking for zero address', async () => {
      await expectRevert(
        this.stakingRewards.stake(constants.ZERO_ADDRESS, STAKE_VALUE, {from: stakingController}),
        'User cannot be zero address'
      );
    });

    it('reverts if not called by the staking controller', async () => {
      await expectRevert(
        this.stakingRewards.stake(alice, ZERO, {from: alice}),
        'Only callable by controller'
      );
    });

    it.only('can stake and get rewards', async () => {
      await this.stakingRewards.stake(alice, STAKE_VALUE, {from: stakingController});

      (await this.stakingRewards.balanceOf(alice)).should.be.bignumber.equal(STAKE_VALUE);

      (await this.stakingRewards.totalSupply()).should.be.bignumber.equal(STAKE_VALUE);

      await this.stakingRewards.fixTime(new BN('5').add(PERIOD_ONE_DAY_IN_SECONDS), {from: admin});

      // 1000 reward for 10 days is 100 per day
      // 1 days has passed with one staker - so they are due 100 tokens
      const tx = await this.stakingRewards.getReward({from: alice});
      expectEvent(tx, 'RewardPaid', {
        user: alice,
        reward: new BN('99999999999999964800'), // 100 tokens - calcs lose dust!
      });

      shouldBeNumberInEtherCloseTo(tx.logs[0].args.reward, fromWei(_1DaysWorthOfReward));
    });
  });

  describe.only('stake and withdraw then claim rewards', async () => {
    beforeEach(async () => {
      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: admin});

      await this.stakingRewards.fixTime('5', {from: admin});
      await this.stakingRewards.start({from: admin});
    });

    it('reverts if withdrawing nothing', async () => {
      await expectRevert(
        this.stakingRewards.withdraw(alice, ZERO, {from: stakingController}),
        'Cannot withdraw 0'
      );
    });

    it('reverts if staking for zero address', async () => {
      await expectRevert(
        this.stakingRewards.withdraw(constants.ZERO_ADDRESS, STAKE_VALUE, {from: stakingController}),
        'User cannot be zero address'
      );
    });

    it('reverts if trying to withdraw and have no stake', async () => {
      await expectRevert(
        this.stakingRewards.withdraw(alice, STAKE_VALUE, {from: stakingController}),
        'Amount greater than balance'
      );
    });

    it('reverts if not called by the staking controller', async () => {
      await expectRevert(
        this.stakingRewards.withdraw(alice, ZERO, {from: alice}),
        'Only callable by controller'
      );
    });

    it('can stake and get rewards with a single withdrawal', async () => {
      await this.stakingRewards.stake(alice, STAKE_VALUE, {from: stakingController});

      (await this.stakingRewards.balanceOf(alice)).should.be.bignumber.equal(STAKE_VALUE);
      (await this.stakingRewards.totalSupply()).should.be.bignumber.equal(STAKE_VALUE);

      await this.stakingRewards.fixTime(new BN('5').add(PERIOD_ONE_DAY_IN_SECONDS), {from: admin});

      await this.stakingRewards.withdraw(alice, STAKE_VALUE, {from: stakingController});

      (await this.stakingRewards.totalSupply()).should.be.bignumber.equal(ZERO);
      (await this.stakingRewards.balanceOf(alice)).should.be.bignumber.equal(ZERO);

      // 1000 reward for 10 days is 100 per day
      // 1 days has passed with one staker - so they are due 100 cudos tokens after exit which claims reward
      shouldBeNumberInEtherCloseTo(
        (await this.token.balanceOf(alice)),
        new BN(fromWei(_1DaysWorthOfReward))
      );
    });

    it('can stake and get rewards over 2 withdrawals', async () => {
      await this.stakingRewards.stake(alice, STAKE_VALUE, {from: stakingController});

      (await this.stakingRewards.balanceOf(alice)).should.be.bignumber.equal(STAKE_VALUE);
      (await this.stakingRewards.totalSupply()).should.be.bignumber.equal(STAKE_VALUE);

      await this.stakingRewards.fixTime(new BN('5').add(PERIOD_ONE_DAY_IN_SECONDS), {from: admin});

      await this.stakingRewards.withdraw(alice, STAKE_VALUE.divn('2'), {from: stakingController});

      (await this.stakingRewards.totalSupply()).should.be.bignumber.equal(STAKE_VALUE.divn('2'));
      (await this.stakingRewards.balanceOf(alice)).should.be.bignumber.equal(STAKE_VALUE.divn('2'));

      await this.stakingRewards.withdraw(alice, STAKE_VALUE.divn('2'), {from: stakingController});

      (await this.stakingRewards.totalSupply()).should.be.bignumber.equal(ZERO);
      (await this.stakingRewards.balanceOf(alice)).should.be.bignumber.equal(ZERO);

      // 1000 reward for 10 days is 100 per day
      // 1 days has passed with one staker - so they are due 100 cudos tokens after exit which claims reward
      shouldBeNumberInEtherCloseTo(
        (await this.token.balanceOf(alice)),
        new BN(fromWei(_1DaysWorthOfReward))
      );
    });
  });

  // adjusted from synthetix

  describe.only('lastTimeRewardApplicable()', () => {
    it('should return 0', async () => {
      (await this.stakingRewards.lastTimeRewardApplicable()).should.be.bignumber.equal('0');
    });

    describe('when updated', () => {
      it('should equal current timestamp', async () => {

        await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: admin});

        await this.stakingRewards.fixTime(PERIOD_ONE_DAY_IN_SECONDS.addn(5), {from: admin});
        await this.stakingRewards.start({from: admin});

        const lastTimeReward = await stakingRewards.lastTimeRewardApplicable();

        lastTimeReward.should.be.bignumber.equal(PERIOD_ONE_DAY_IN_SECONDS.addn(5));
      });
    });
  });

  describe.only('getReward()', () => {
    it('should do nothing if no stake', async () => {
      (await this.token.balanceOf(alice)).should.be.bignumber.equal(ZERO);
      await this.stakingRewards.getReward({from: alice});
      (await this.token.balanceOf(alice)).should.be.bignumber.equal(ZERO);
    });
  });

  describe.only('getRewardForDuration()', () => {
    it('should increase rewards token balance', async () => {
      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: admin});

      await this.stakingRewards.fixTime('5', {from: admin});
      await this.stakingRewards.start({from: admin});

      const rewardForDuration = await this.stakingRewards.getRewardForDuration();

      const duration = await this.stakingRewards.rewardsDuration();
      const rewardRate = await this.stakingRewards.rewardRate();

      rewardForDuration.should.be.bignumber.equal(duration.mul(rewardRate));
      shouldBeNumberInEtherCloseTo(rewardForDuration, fromWei(REWARD_VALUE)); // REWARD_VALUE is 1000
    });
  });

  describe.only('rewardPerToken()', () => {
    it('should return 0', async () => {
      (await this.stakingRewards.rewardPerToken()).should.be.bignumber.equal(ZERO);
    });

    it('should be > 0', async () => {

      // set up Alice
      await this.stakingRewards.stake(alice, STAKE_VALUE, {from: stakingController});

      const totalSupply = await stakingRewards.totalSupply();
      totalSupply.should.be.bignumber.equal(STAKE_VALUE);

      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: admin});
      await this.stakingRewards.fixTime('5', {from: admin});
      await this.stakingRewards.start({from: stakingController});

      await this.stakingRewards.fixTime(PERIOD_ONE_DAY_IN_SECONDS.addn(5), {from: admin});

      const rewardPerToken = await this.stakingRewards.rewardPerToken();

      // 1000 over 10 days is 100 per day - we staked 10 so get 10 reward per token as no others staking
      shouldBeNumberInEtherCloseTo(rewardPerToken, '10');
    });
  });
});
