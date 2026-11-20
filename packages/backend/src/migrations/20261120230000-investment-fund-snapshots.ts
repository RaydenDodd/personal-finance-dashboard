import { QueryInterface } from 'sequelize';

module.exports = {
  up: async (q: QueryInterface) => {
    await q.sequelize.query(`CREATE TABLE "InvestmentFundSnapshots" (
      id VARCHAR(64) PRIMARY KEY,
      "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
      data JSONB NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE INDEX investment_fund_snapshots_user ON "InvestmentFundSnapshots" ("userId");`);
  },
  down: async (q: QueryInterface) => {
    await q.dropTable('InvestmentFundSnapshots');
  },
};
