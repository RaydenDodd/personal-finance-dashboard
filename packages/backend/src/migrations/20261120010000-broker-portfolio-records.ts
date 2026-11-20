import { QueryInterface } from 'sequelize';

module.exports = {
  up: async (q: QueryInterface) => {
    await q.sequelize.query(`CREATE TABLE "BrokerPortfolioData" (
      "portfolioId" UUID PRIMARY KEY REFERENCES "Portfolios"(id) ON DELETE CASCADE,
      data JSONB NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE "PublicPortfolioConnections" (
      "userId" INTEGER PRIMARY KEY REFERENCES "Users"(id) ON DELETE CASCADE,
      "encryptedCredentials" TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true,
      "lastSyncAt" TIMESTAMPTZ, "lastError" VARCHAR(255),
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  },
  down: async (q: QueryInterface) => {
    await q.dropTable('PublicPortfolioConnections');
    await q.dropTable('BrokerPortfolioData');
  },
};
