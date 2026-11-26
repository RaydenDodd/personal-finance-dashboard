import { QueryInterface } from 'sequelize';
module.exports={
  up:async(q:QueryInterface)=>{
    await q.sequelize.query(`CREATE TABLE "InvestmentFundingNativeLinks" (
      "transactionId" UUID PRIMARY KEY REFERENCES "Transactions"(id) ON DELETE CASCADE,
      "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
      "portfolioTransferId" UUID NOT NULL UNIQUE REFERENCES "PortfolioTransfers"(id) ON DELETE CASCADE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  },
  down:async(q:QueryInterface)=>{await q.dropTable('InvestmentFundingNativeLinks');},
};
