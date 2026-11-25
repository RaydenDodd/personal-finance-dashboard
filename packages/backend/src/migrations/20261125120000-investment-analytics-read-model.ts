import type { QueryInterface } from 'sequelize';

async function up(queryInterface: QueryInterface) {
  await queryInterface.sequelize.query(`
    CREATE TABLE "InvestmentAnalyticsReadModels" (
      "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
      "selectionKey" TEXT NOT NULL,
      selection JSONB NOT NULL,
      payload JSONB,
      "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "builtAt" TIMESTAMPTZ,
      "retryAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      failures INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY ("userId", "selectionKey")
    );
    CREATE INDEX investment_analytics_due ON "InvestmentAnalyticsReadModels" ("retryAt", "builtAt");
  `);
}

async function down(queryInterface: QueryInterface) {
  await queryInterface.sequelize.query('DROP TABLE "InvestmentAnalyticsReadModels"');
}

module.exports = { up, down };
