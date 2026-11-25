import type { QueryInterface } from 'sequelize';

// Revisions are per source table, not per user; conservative invalidation avoids
// missing dependencies from benchmark prices, nested funds and currency changes.
const sources = ['InvestmentTransactions', 'BrokerPortfolioData', 'PortfolioBalances', 'PortfolioTransfers', 'Holdings', 'SecurityPricings', 'Portfolios', 'InvestmentFundSnapshots', 'UsersCurrencies'];
async function up(q: QueryInterface) {
  await q.sequelize.query(`
    CREATE TABLE "InvestmentAnalyticsSourceRevisions" (
      source TEXT PRIMARY KEY, revision BIGINT NOT NULL DEFAULT 0
    );
    ALTER TABLE "InvestmentAnalyticsReadModels" ADD COLUMN "sourceRevision" TEXT;
    CREATE FUNCTION investment_analytics_source_changed() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO "InvestmentAnalyticsSourceRevisions"(source,revision) VALUES(TG_TABLE_NAME,1)
      ON CONFLICT(source) DO UPDATE SET revision="InvestmentAnalyticsSourceRevisions".revision+1;
      RETURN NULL;
    END $$;
  `);
  for (const source of sources) {
    // Some installations use different names for optional tables.
    await q.sequelize.query(`
      DO $$ BEGIN
        IF to_regclass('"${source}"') IS NOT NULL THEN
          EXECUTE 'CREATE TRIGGER investment_analytics_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "${source}" FOR EACH STATEMENT EXECUTE FUNCTION investment_analytics_source_changed()';
        END IF;
      END $$;
    `);
  }
}
async function down(q: QueryInterface) {
  for (const source of sources) {
    await q.sequelize.query(`
      DO $$ BEGIN
        IF to_regclass('"${source}"') IS NOT NULL THEN
          EXECUTE 'DROP TRIGGER IF EXISTS investment_analytics_revision ON "${source}"';
        END IF;
      END $$;
    `);
  }
  await q.sequelize.query('DROP FUNCTION investment_analytics_source_changed(); ALTER TABLE "InvestmentAnalyticsReadModels" DROP COLUMN "sourceRevision"; DROP TABLE "InvestmentAnalyticsSourceRevisions";');
}
module.exports = { up, down };
