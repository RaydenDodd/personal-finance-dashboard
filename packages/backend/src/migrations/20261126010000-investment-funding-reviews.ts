import { QueryInterface } from 'sequelize';

module.exports = {
  up: async (q: QueryInterface) => {
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query(`
        CREATE TABLE "InvestmentFundingReviews" (
          "transactionId" UUID PRIMARY KEY REFERENCES "Transactions"(id) ON DELETE CASCADE,
          "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
          "groupId" UUID NOT NULL REFERENCES "InvestmentAccountGroups"(id) ON DELETE CASCADE,
          "portfolioId" UUID NOT NULL REFERENCES "Portfolios"(id) ON DELETE CASCADE,
          fingerprint TEXT NOT NULL,
          "cashRetained" BOOLEAN NOT NULL,
          "tradeCount" INTEGER NOT NULL,
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE "InvestmentFundingReviewTrades" (
          "transactionId" UUID NOT NULL REFERENCES "InvestmentFundingReviews"("transactionId") ON DELETE CASCADE,
          "tradeId" UUID PRIMARY KEY REFERENCES "InvestmentTransactions"(id) ON DELETE CASCADE,
          "tradeUpdatedAt" TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX ON "InvestmentFundingReviewTrades" ("transactionId");
        CREATE TABLE "InvestmentFundingReminderPreferences" (
          "userId" INTEGER PRIMARY KEY REFERENCES "Users"(id) ON DELETE CASCADE,
          "snoozedUntil" TIMESTAMPTZ NOT NULL
        );
      `, {transaction});
    });
  },
  down: async (q: QueryInterface) => {
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query('DROP TABLE "InvestmentFundingReviewTrades"; DROP TABLE "InvestmentFundingReviews"; DROP TABLE "InvestmentFundingReminderPreferences";', {transaction});
    });
  },
};
