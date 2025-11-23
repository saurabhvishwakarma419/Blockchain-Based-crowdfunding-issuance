const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Blockchain Crowdfunding Platform", function () {
  let crowdfunding;
  let owner;
let creator;
  let contributor1;
  let contributor2;
  
  const CAMPAIGN_TITLE = "Innovative Tech Project";
  const CAMPAIGN_DESCRIPTION = "Building the future of technology";
  const FUNDING_GOAL = ethers.utils.parseEther("10"); // 10 ETH
  const CONTRIBUTION_AMOUNT = ethers.utils.parseEther("5"); // 5 ETH
  
  beforeEach(async function () {
    // Get signers
    [owner, creator, contributor1, contributor2] = await ethers.getSigners();
    
    // Deploy contract
    const Crowdfunding = await ethers.getContractFactory("Project");
    crowdfunding = await Crowdfunding.deploy();
    await crowdfunding.deployed();
  });

  describe("Deployment", function () {
    it("Should set the right platform owner", async function () {
      expect(await crowdfunding.platformOwner()).to.equal(owner.address);
    });

    it("Should initialize with zero campaigns", async function () {
      expect(await crowdfunding.campaignCount()).to.equal(0);
    });

    it("Should set default platform fee to 2%", async function () {
      expect(await crowdfunding.platformFeePercent()).to.equal(2);
    });
  });

  describe("Campaign Creation", function () {
    it("Should create a campaign successfully", async function () {
      const deadline = (await time.latest()) + 30 * 24 * 60 * 60; // 30 days
      
      await expect(
        crowdfunding.connect(creator).createCampaign(
          CAMPAIGN_TITLE,
          CAMPAIGN_DESCRIPTION,
          FUNDING_GOAL,
          deadline
        )
      ).to.emit(crowdfunding, "CampaignCreated")
       .withArgs(1, creator.address, CAMPAIGN_TITLE, FUNDING_GOAL, deadline);

      expect(await crowdfunding.campaignCount()).to.equal(1);
    });

    it("Should fail to create campaign with empty title", async function () {
      const deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      
      await expect(
        crowdfunding.connect(creator).createCampaign(
          "",
          CAMPAIGN_DESCRIPTION,
          FUNDING_GOAL,
          deadline
        )
      ).to.be.revertedWith("Title cannot be empty");
    });

    it("Should fail to create campaign with zero funding goal", async function () {
      const deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      
      await expect(
        crowdfunding.connect(creator).createCampaign(
          CAMPAIGN_TITLE,
          CAMPAIGN_DESCRIPTION,
          0,
          deadline
        )
      ).to.be.revertedWith("Funding goal must be greater than 0");
    });

    it("Should fail to create campaign with past deadline", async function () {
      const pastDeadline = (await time.latest()) - 1000;
      
      await expect(
        crowdfunding.connect(creator).createCampaign(
          CAMPAIGN_TITLE,
          CAMPAIGN_DESCRIPTION,
          FUNDING_GOAL,
          pastDeadline
        )
      ).to.be.revertedWith("Deadline must be in the future");
    });
  });

  describe("Contributions", function () {
    let campaignId;
    let deadline;

    beforeEach(async function () {
      deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      const tx = await crowdfunding.connect(creator).createCampaign(
        CAMPAIGN_TITLE,
        CAMPAIGN_DESCRIPTION,
        FUNDING_GOAL,
        deadline
      );
      const receipt = await tx.wait();
      campaignId = receipt.events[0].args.campaignId;
    });

    it("Should accept contributions", async function () {
      await expect(
        crowdfunding.connect(contributor1).contribute(campaignId, {
          value: CONTRIBUTION_AMOUNT
        })
      ).to.emit(crowdfunding, "ContributionReceived")
       .withArgs(campaignId, contributor1.address, CONTRIBUTION_AMOUNT);

      const campaign = await crowdfunding.getCampaign(campaignId);
      expect(campaign.amountRaised).to.equal(CONTRIBUTION_AMOUNT);
    });

    it("Should track multiple contributions from same contributor", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: CONTRIBUTION_AMOUNT
      });
      
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: CONTRIBUTION_AMOUNT
      });

      const contribution = await crowdfunding.getContribution(
        campaignId,
        contributor1.address
      );
      expect(contribution).to.equal(CONTRIBUTION_AMOUNT.mul(2));
    });

    it("Should update campaign status to Successful when goal reached", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: FUNDING_GOAL
      });

      const status = await crowdfunding.getCampaignStatus(campaignId);
      expect(status).to.equal(1); // CampaignStatus.Successful
    });

    it("Should fail contribution with zero amount", async function () {
      await expect(
        crowdfunding.connect(contributor1).contribute(campaignId, {
          value: 0
        })
      ).to.be.revertedWith("Contribution must be greater than 0");
    });

    it("Should fail contribution after deadline", async function () {
      // Fast forward time past deadline
      await time.increaseTo(deadline + 1);

      await expect(
        crowdfunding.connect(contributor1).contribute(campaignId, {
          value: CONTRIBUTION_AMOUNT
        })
      ).to.be.revertedWith("Campaign has ended");
    });
  });

  describe("Fund Withdrawal", function () {
    let campaignId;
    let deadline;

    beforeEach(async function () {
      deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      const tx = await crowdfunding.connect(creator).createCampaign(
        CAMPAIGN_TITLE,
        CAMPAIGN_DESCRIPTION,
        FUNDING_GOAL,
        deadline
      );
      const receipt = await tx.wait();
      campaignId = receipt.events[0].args.campaignId;
    });

    it("Should allow creator to withdraw funds after successful campaign", async function () {
      // Contribute to reach goal
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: FUNDING_GOAL
      });

      // Fast forward past deadline
      await time.increaseTo(deadline + 1);

      const creatorBalanceBefore = await ethers.provider.getBalance(creator.address);

      await expect(
        crowdfunding.connect(creator).withdrawFunds(campaignId)
      ).to.emit(crowdfunding, "FundsWithdrawn");

      const creatorBalanceAfter = await ethers.provider.getBalance(creator.address);
      expect(creatorBalanceAfter).to.be.gt(creatorBalanceBefore);
    });

    it("Should deduct platform fee on withdrawal", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: FUNDING_GOAL
      });

      await time.increaseTo(deadline + 1);

      const platformBalanceBefore = await ethers.provider.getBalance(owner.address);
      
      await crowdfunding.connect(creator).withdrawFunds(campaignId);

      const platformBalanceAfter = await ethers.provider.getBalance(owner.address);
      const expectedFee = FUNDING_GOAL.mul(2).div(100); // 2% fee
      
      expect(platformBalanceAfter.sub(platformBalanceBefore)).to.equal(expectedFee);
    });

    it("Should fail withdrawal before deadline", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: FUNDING_GOAL
      });

      await expect(
        crowdfunding.connect(creator).withdrawFunds(campaignId)
      ).to.be.revertedWith("Campaign has not ended yet");
    });

    it("Should fail withdrawal if goal not reached", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: CONTRIBUTION_AMOUNT
      });

      await time.increaseTo(deadline + 1);

      await expect(
        crowdfunding.connect(creator).withdrawFunds(campaignId)
      ).to.be.revertedWith("Funding goal not reached");
    });

    it("Should fail withdrawal by non-creator", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: FUNDING_GOAL
      });

      await time.increaseTo(deadline + 1);

      await expect(
        crowdfunding.connect(contributor1).withdrawFunds(campaignId)
      ).to.be.revertedWith("Only campaign creator can call this");
    });

    it("Should prevent double withdrawal", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: FUNDING_GOAL
      });

      await time.increaseTo(deadline + 1);

      await crowdfunding.connect(creator).withdrawFunds(campaignId);

      await expect(
        crowdfunding.connect(creator).withdrawFunds(campaignId)
      ).to.be.revertedWith("Funds already withdrawn");
    });
  });

  describe("Refunds", function () {
    let campaignId;
    let deadline;

    beforeEach(async function () {
      deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      const tx = await crowdfunding.connect(creator).createCampaign(
        CAMPAIGN_TITLE,
        CAMPAIGN_DESCRIPTION,
        FUNDING_GOAL,
        deadline
      );
      const receipt = await tx.wait();
      campaignId = receipt.events[0].args.campaignId;
    });

    it("Should allow refund for failed campaign", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: CONTRIBUTION_AMOUNT
      });

      await time.increaseTo(deadline + 1);

      const balanceBefore = await ethers.provider.getBalance(contributor1.address);

      await expect(
        crowdfunding.connect(contributor1).refund(campaignId)
      ).to.emit(crowdfunding, "RefundIssued")
       .withArgs(campaignId, contributor1.address, CONTRIBUTION_AMOUNT);

      const balanceAfter = await ethers.provider.getBalance(contributor1.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should fail refund before deadline", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: CONTRIBUTION_AMOUNT
      });

      await expect(
        crowdfunding.connect(contributor1).refund(campaignId)
      ).to.be.revertedWith("Campaign was successful, no refunds");
    });

    it("Should fail refund with no contribution", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: CONTRIBUTION_AMOUNT
      });

      await time.increaseTo(deadline + 1);

      await expect(
        crowdfunding.connect(contributor2).refund(campaignId)
      ).to.be.revertedWith("No contribution found");
    });

    it("Should update campaign status to Failed after refund", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: CONTRIBUTION_AMOUNT
      });

      await time.increaseTo(deadline + 1);

      await crowdfunding.connect(contributor1).refund(campaignId);

      const status = await crowdfunding.getCampaignStatus(campaignId);
      expect(status).to.equal(2); // CampaignStatus.Failed
    });
  });

  describe("View Functions", function () {
    let campaignId;
    let deadline;

    beforeEach(async function () {
      deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      const tx = await crowdfunding.connect(creator).createCampaign(
        CAMPAIGN_TITLE,
        CAMPAIGN_DESCRIPTION,
        FUNDING_GOAL,
        deadline
      );
      const receipt = await tx.wait();
      campaignId = receipt.events[0].args.campaignId;
    });

    it("Should return correct campaign details", async function () {
      const campaign = await crowdfunding.getCampaign(campaignId);
      
      expect(campaign.id).to.equal(campaignId);
      expect(campaign.creator).to.equal(creator.address);
      expect(campaign.title).to.equal(CAMPAIGN_TITLE);
      expect(campaign.description).to.equal(CAMPAIGN_DESCRIPTION);
      expect(campaign.fundingGoal).to.equal(FUNDING_GOAL);
      expect(campaign.deadline).to.equal(deadline);
      expect(campaign.amountRaised).to.equal(0);
      expect(campaign.withdrawn).to.equal(false);
      expect(campaign.status).to.equal(0); // CampaignStatus.Active
    });

    it("Should return correct contribution amount", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: CONTRIBUTION_AMOUNT
      });

      const contribution = await crowdfunding.getContribution(
        campaignId,
        contributor1.address
      );
      expect(contribution).to.equal(CONTRIBUTION_AMOUNT);
    });

    it("Should return list of contributors", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: CONTRIBUTION_AMOUNT
      });
      
      await crowdfunding.connect(contributor2).contribute(campaignId, {
        value: CONTRIBUTION_AMOUNT
      });

      const contributors = await crowdfunding.getCampaignContributors(campaignId);
      expect(contributors.length).to.equal(2);
      expect(contributors[0]).to.equal(contributor1.address);
      expect(contributors[1]).to.equal(contributor2.address);
    });

    it("Should return correct campaign status", async function () {
      let status = await crowdfunding.getCampaignStatus(campaignId);
      expect(status).to.equal(0); // Active

      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: FUNDING_GOAL
      });

      status = await crowdfunding.getCampaignStatus(campaignId);
      expect(status).to.equal(1); // Successful
    });

    it("Should return total number of campaigns", async function () {
      expect(await crowdfunding.getTotalCampaigns()).to.equal(1);

      await crowdfunding.connect(creator).createCampaign(
        "Second Campaign",
        "Another description",
        FUNDING_GOAL,
        deadline
      );

      expect(await crowdfunding.getTotalCampaigns()).to.equal(2);
    });

    it("Should return contract balance", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: CONTRIBUTION_AMOUNT
      });

      const balance = await crowdfunding.getContractBalance();
      expect(balance).to.equal(CONTRIBUTION_AMOUNT);
    });
  });

  describe("Platform Management", function () {
    it("Should allow owner to update platform fee", async function () {
      await crowdfunding.connect(owner).updatePlatformFee(5);
      expect(await crowdfunding.platformFeePercent()).to.equal(5);
    });

    it("Should fail to update fee above 10%", async function () {
      await expect(
        crowdfunding.connect(owner).updatePlatformFee(11)
      ).to.be.revertedWith("Fee cannot exceed 10%");
    });

    it("Should fail to update fee by non-owner", async function () {
      await expect(
        crowdfunding.connect(creator).updatePlatformFee(5)
      ).to.be.revertedWith("Only platform owner can call this");
    });
  });

  describe("Edge Cases", function () {
    let campaignId;
    let deadline;

    beforeEach(async function () {
      deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      const tx = await crowdfunding.connect(creator).createCampaign(
        CAMPAIGN_TITLE,
        CAMPAIGN_DESCRIPTION,
        FUNDING_GOAL,
        deadline
      );
      const receipt = await tx.wait();
      campaignId = receipt.events[0].args.campaignId;
    });

    it("Should handle exact funding goal amount", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: FUNDING_GOAL
      });

      const campaign = await crowdfunding.getCampaign(campaignId);
      expect(campaign.amountRaised).to.equal(FUNDING_GOAL);
      expect(campaign.status).to.equal(1); // Successful
    });

    it("Should handle overfunding", async function () {
      const overAmount = FUNDING_GOAL.add(ethers.utils.parseEther("5"));
      
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: overAmount
      });

      const campaign = await crowdfunding.getCampaign(campaignId);
      expect(campaign.amountRaised).to.equal(overAmount);
      expect(campaign.status).to.equal(1); // Successful
    });

    it("Should handle multiple contributors for same campaign", async function () {
      await crowdfunding.connect(contributor1).contribute(campaignId, {
        value: ethers.utils.parseEther("3")
      });
      
      await crowdfunding.connect(contributor2).contribute(campaignId, {
        value: ethers.utils.parseEther("4")
      });
      
      await crowdfunding.connect(creator).contribute(campaignId, {
        value: ethers.utils.parseEther("3")
      });

      const campaign = await crowdfunding.getCampaign(campaignId);
      expect(campaign.amountRaised).to.equal(ethers.utils.parseEther("10"));
      expect(campaign.status).to.equal(1); // Successful
    });

    it("Should fail to get non-existent campaign", async function () {
      await expect(
        crowdfunding.getCampaign(999)
      ).to.be.revertedWith("Campaign does not exist");
    });

    it("Should handle campaign at exact deadline", async function () {
      await time.increaseTo(deadline);

      await expect(
        crowdfunding.connect(contributor1).contribute(campaignId, {
          value: CONTRIBUTION_AMOUNT
        })
      ).to.be.revertedWith("Campaign has ended");
    });
  });

  describe("Gas Optimization Tests", function () {
    it("Should efficiently create multiple campaigns", async function () {
      const deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      
      for (let i = 0; i < 5; i++) {
        await crowdfunding.connect(creator).createCampaign(
          `Campaign ${i}`,
          `Description ${i}`,
          FUNDING_GOAL,
          deadline
        );
      }

      expect(await crowdfunding.getTotalCampaigns()).to.equal(5);
    });

    it("Should efficiently handle multiple contributions", async function () {
      const deadline = (await time.latest()) + 30 * 24 * 60 * 60;
      const tx = await crowdfunding.connect(creator).createCampaign(
        CAMPAIGN_TITLE,
        CAMPAIGN_DESCRIPTION,
        FUNDING_GOAL,
        deadline
      );
      const receipt = await tx.wait();
      const campaignId = receipt.events[0].args.campaignId;

      const contributionAmount = ethers.utils.parseEther("0.1");
      
      for (let i = 0; i < 10; i++) {
        await crowdfunding.connect(contributor1).contribute(campaignId, {
          value: contributionAmount
        });
      }

      const contribution = await crowdfunding.getContribution(
        campaignId,
        contributor1.address
      );
      expect(contribution).to.equal(contributionAmount.mul(10));
    });
  });
});
