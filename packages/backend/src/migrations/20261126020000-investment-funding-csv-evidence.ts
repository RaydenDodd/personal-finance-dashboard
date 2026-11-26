import { QueryInterface } from 'sequelize';
module.exports={
  up:async(q:QueryInterface)=>{
    await q.sequelize.query(`CREATE TABLE "InvestmentFundingCsvEvidence" (
      "transactionId" UUID PRIMARY KEY REFERENCES "Transactions"(id) ON DELETE CASCADE,
      "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
      "portfolioId" UUID NOT NULL REFERENCES "Portfolios"(id) ON DELETE CASCADE,
      "sourceRowId" VARCHAR(64) NOT NULL,
      "fileHash" VARCHAR(64) NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE ("portfolioId","sourceRowId")
    )`);
  },
  down:async(q:QueryInterface)=>{await q.dropTable('InvestmentFundingCsvEvidence');},
};
