import { QueryInterface } from 'sequelize';

module.exports = {
  up: async (q: QueryInterface) => {
    await q.sequelize.transaction(async (transaction) => {
      await q.sequelize.query(`
        CREATE TABLE "InvestmentAccountGroups" (
          id UUID PRIMARY KEY,
          "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          "sourceAccountId" UUID UNIQUE REFERENCES "Accounts"(id) ON DELETE SET NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX "InvestmentAccountGroups_owner_name" ON "InvestmentAccountGroups" ("userId", LOWER(name));
        CREATE TABLE "InvestmentAccountGroupMembers" (
          "groupId" UUID NOT NULL REFERENCES "InvestmentAccountGroups"(id) ON DELETE CASCADE,
          "portfolioId" UUID NOT NULL UNIQUE REFERENCES "Portfolios"(id) ON DELETE CASCADE,
          PRIMARY KEY ("groupId", "portfolioId")
        );
      `, { transaction });
    });
  },
  down: async (q: QueryInterface) => {
    await q.sequelize.transaction(async (transaction) => {
      await q.sequelize.query('DROP TABLE "InvestmentAccountGroupMembers"; DROP TABLE "InvestmentAccountGroups";', { transaction });
    });
  },
};
