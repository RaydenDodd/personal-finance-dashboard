import type { QueryInterface } from 'sequelize';

// Transition tables batch revision increments once per affected security per SQL statement.
// The existing global analytics source revision is deliberately retained.
async function up(q: QueryInterface) {
  await q.sequelize.query(`
    CREATE TABLE "InvestmentSecurityPriceRevisions" (
      "securityId" TEXT PRIMARY KEY, revision BIGINT NOT NULL DEFAULT 0
    );
    INSERT INTO "InvestmentSecurityPriceRevisions" ("securityId", revision) VALUES ('*', 0);
    CREATE FUNCTION investment_security_price_changed() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'TRUNCATE' THEN
        UPDATE "InvestmentSecurityPriceRevisions" SET revision=revision+1 WHERE "securityId"='*';
      ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO "InvestmentSecurityPriceRevisions" ("securityId",revision)
        SELECT DISTINCT "securityId"::text,1 FROM new_prices ORDER BY 1
        ON CONFLICT ("securityId") DO UPDATE SET revision="InvestmentSecurityPriceRevisions".revision+1;
      ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO "InvestmentSecurityPriceRevisions" ("securityId",revision)
        SELECT DISTINCT "securityId"::text,1 FROM old_prices ORDER BY 1
        ON CONFLICT ("securityId") DO UPDATE SET revision="InvestmentSecurityPriceRevisions".revision+1;
      ELSE
        INSERT INTO "InvestmentSecurityPriceRevisions" ("securityId",revision)
        SELECT id,1 FROM (SELECT "securityId"::text AS id FROM new_prices UNION SELECT "securityId"::text FROM old_prices) changed ORDER BY id
        ON CONFLICT ("securityId") DO UPDATE SET revision="InvestmentSecurityPriceRevisions".revision+1;
      END IF;
      RETURN NULL;
    END $$;
    CREATE TRIGGER investment_price_revision_insert AFTER INSERT ON "SecurityPricings"
      REFERENCING NEW TABLE AS new_prices FOR EACH STATEMENT EXECUTE FUNCTION investment_security_price_changed();
    CREATE TRIGGER investment_price_revision_update AFTER UPDATE ON "SecurityPricings"
      REFERENCING OLD TABLE AS old_prices NEW TABLE AS new_prices FOR EACH STATEMENT EXECUTE FUNCTION investment_security_price_changed();
    CREATE TRIGGER investment_price_revision_delete AFTER DELETE ON "SecurityPricings"
      REFERENCING OLD TABLE AS old_prices FOR EACH STATEMENT EXECUTE FUNCTION investment_security_price_changed();
    CREATE TRIGGER investment_price_revision_truncate AFTER TRUNCATE ON "SecurityPricings"
      FOR EACH STATEMENT EXECUTE FUNCTION investment_security_price_changed();
    CREATE TRIGGER investment_analytics_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "Securities"
      FOR EACH STATEMENT EXECUTE FUNCTION investment_analytics_source_changed();
  `);
}
async function down(q: QueryInterface) {
  await q.sequelize.query(`
    DROP TRIGGER investment_analytics_revision ON "Securities";
    DROP TRIGGER investment_price_revision_insert ON "SecurityPricings";
    DROP TRIGGER investment_price_revision_update ON "SecurityPricings";
    DROP TRIGGER investment_price_revision_delete ON "SecurityPricings";
    DROP TRIGGER investment_price_revision_truncate ON "SecurityPricings";
    DROP FUNCTION investment_security_price_changed();
    DROP TABLE "InvestmentSecurityPriceRevisions";
  `);
}
module.exports = { up, down };
