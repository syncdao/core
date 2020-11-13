const {BN, time, expectEvent, expectRevert, constants, ether} = require('@openzeppelin/test-helpers');
const {latest} = time;

const {fromWei} = require('web3-utils');

require('chai').should();

const StakingRewards = artifacts.require('gDaiStakingWithFixedTime');
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
    this.stakingRewards = await StakingRewards.new(
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

  describe.skip('notifyRewardAmount ', async () => {
    it('only admin can call', async () => {
      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: cudos});
      await this.stakingRewards.notifyRewardAmount(REWARD_VALUE, {from: cudos});

      await expectRevert(
        this.stakingRewards.notifyRewardAmount(REWARD_VALUE, {from: serviceProviderAlice}),
        'Only admin');
    });

    it('sets required reward rate on notify', async () => {
      (await this.stakingRewards.rewardRate()).should.be.bignumber.equal(ZERO);

      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: cudos});
      await this.stakingRewards.notifyRewardAmount(REWARD_VALUE, {from: cudos});

      (await this.stakingRewards.rewardRate()).should.be.bignumber.equal(REWARD_VALUE.div(daysInSeconds(_10days)));
      (await this.stakingRewards.lastUpdateTime()).should.be.bignumber.equal(this.now);

      (await this.stakingRewards.periodFinish()).should.be.bignumber.equal(this.now.add(daysInSeconds(_10days)));
    });

    it('reverts if the provided reward is greater than the balance.', async () => {
      await expectRevert(
        this.stakingRewards.notifyRewardAmount(REWARD_VALUE.mul(new BN('4')), {from: cudos}),
        'Provided reward too high'
      );
    });

    it('reverts if called twice', async () => {
      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: cudos});
      await this.stakingRewards.notifyRewardAmount(REWARD_VALUE, {from: cudos});

      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: cudos});
      await expectRevert(
        this.stakingRewards.notifyRewardAmount(REWARD_VALUE, {from: cudos}),
        'Must be called only once'
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

  describe.skip('stake and exit', async () => {
    beforeEach(async () => {
      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: cudos});
      await this.stakingRewards.notifyRewardAmount(REWARD_VALUE, {from: cudos});

      // set up Alice SP
      await this.token.transfer(serviceProviderAlice, STAKE_VALUE, {from: cudos});
      await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: serviceProviderAlice});
    });

    it('can stake and get rewards as a service provider', async () => {
      (await this.token.balanceOf(serviceProviderAlice)).should.be.bignumber.equal(STAKE_VALUE);

      await this.stakingRewards.stake(STAKE_VALUE, {from: serviceProviderAlice});

      (await this.token.balanceOf(serviceProviderAlice)).should.be.bignumber.equal(ZERO);
      (await this.stakingRewards.balanceOf(serviceProviderAlice)).should.be.bignumber.equal(STAKE_VALUE);

      (await this.stakingRewards.totalSupply()).should.be.bignumber.equal(STAKE_VALUE);

      await this.stakingRewards.fixTime(this.now.add(PERIOD_ONE_DAY_IN_SECONDS), {from: cudos});

      await this.stakingRewards.exit({from: serviceProviderAlice});

      (await this.stakingRewards.totalSupply()).should.be.bignumber.equal(ZERO);
      (await this.stakingRewards.balanceOf(serviceProviderAlice)).should.be.bignumber.equal(ZERO);

      // 1000 reward for 10 days is 100 per day
      // 1 days has passed with one staker - so they are due 100 cudos tokens after exit which claims reward
      shouldBeNumberInEtherCloseTo(
        (await this.token.balanceOf(serviceProviderAlice)),
        new BN(fromWei(STAKE_VALUE)).add(new BN(fromWei(_1DaysWorthOfReward)))
      );
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

    it('reverts if trying to withdraw and have no stake', async () => {
      await expectRevert(
        this.stakingRewards.withdraw(alice, STAKE_VALUE, {from: stakingController}),
        'Amount greater than balance'
      );
    });

    it('can stake and get rewards as a service provider', async () => {
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
  });

  // adjusted from synthetix

  describe.skip('lastTimeRewardApplicable()', () => {
    it('should return 0', async () => {
      (await this.stakingRewards.lastTimeRewardApplicable()).should.be.bignumber.equal('0');
    });

    describe('when updated', () => {
      it('should equal current timestamp', async () => {

        await this.stakingRewards.fixTime(this.now.add(PERIOD_ONE_DAY_IN_SECONDS), {from: cudos});

        await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: cudos});
        await this.stakingRewards.notifyRewardAmount(REWARD_VALUE, {from: cudos});

        const lastTimeReward = await stakingRewards.lastTimeRewardApplicable();

        lastTimeReward.should.be.bignumber.equal(this.now.add(PERIOD_ONE_DAY_IN_SECONDS));
      });
    });
  });

  describe.skip('getReward()', () => {
    it('should do nothing if no stake', async () => {
      (await this.token.balanceOf(serviceProviderAlice)).should.be.bignumber.equal(ZERO);
      await this.stakingRewards.getReward({from: serviceProviderAlice});
      (await this.token.balanceOf(serviceProviderAlice)).should.be.bignumber.equal(ZERO);
    });
  });

  describe.skip('getRewardForDuration()', () => {
    it('should increase rewards token balance', async () => {
      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: cudos});
      await this.stakingRewards.notifyRewardAmount(REWARD_VALUE, {from: cudos});

      const rewardForDuration = await this.stakingRewards.getRewardForDuration();

      const duration = await this.stakingRewards.rewardsDuration();
      const rewardRate = await this.stakingRewards.rewardRate();

      rewardForDuration.should.be.bignumber.equal(duration.mul(rewardRate));
      shouldBeNumberInEtherCloseTo(rewardForDuration, fromWei(REWARD_VALUE)); // REWARD_VALUE is 1000
    });
  });

  describe.skip('rewardPerToken()', () => {
    it('should return 0', async () => {
      (await stakingRewards.rewardPerToken()).should.be.bignumber.equal(ZERO);
    });

    it('should be > 0', async () => {

      // set up Alice SP
      await this.token.transfer(serviceProviderAlice, STAKE_VALUE, {from: cudos});
      await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: serviceProviderAlice});

      await this.stakingRewards.stake(STAKE_VALUE, {from: serviceProviderAlice});

      const totalSupply = await stakingRewards.totalSupply();
      totalSupply.should.be.bignumber.equal(STAKE_VALUE);

      await this.token.transfer(this.stakingRewards.address, REWARD_VALUE, {from: cudos});
      await this.stakingRewards.notifyRewardAmount(REWARD_VALUE, {from: cudos});

      await this.stakingRewards.fixTime(this.now.add(PERIOD_ONE_DAY_IN_SECONDS), {from: cudos});

      const rewardPerToken = await this.stakingRewards.rewardPerToken();

      // 1000 over 10 days is 100 per day - we staked 10 so get 10 reward per token as no others staking
      shouldBeNumberInEtherCloseTo(rewardPerToken, '10');
    });
  });
});
