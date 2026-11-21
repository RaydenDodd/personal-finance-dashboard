import type { QueryInterface } from 'sequelize';

async function up(queryInterface: QueryInterface) {
  await queryInterface.sequelize.query(`
    CREATE TABLE "InvestmentDailyAccountValues" (
      "portfolioId" UUID NOT NULL REFERENCES "Portfolios"(id) ON DELETE CASCADE,
      "currencyCode" TEXT NOT NULL, date DATE NOT NULL,
      value NUMERIC(36,12), "knownValue" NUMERIC(36,12), "netFunding" NUMERIC(36,12), coverage JSONB NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY("portfolioId","currencyCode",date)
    );
    CREATE TABLE "InvestmentHistoryState" (
      "portfolioId" UUID PRIMARY KEY REFERENCES "Portfolios"(id) ON DELETE CASCADE,
      "currencyCode" TEXT NOT NULL, "builtAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "firstDate" DATE, "lastDate" DATE, "nextDate" DATE, "pendingRevision" BIGINT, audit JSONB NOT NULL DEFAULT '{}'
    );
    CREATE TABLE "InvestmentHistoryDirty" (
      "portfolioId" UUID PRIMARY KEY REFERENCES "Portfolios"(id) ON DELETE CASCADE,
      "fromDate" DATE NOT NULL, revision BIGINT NOT NULL DEFAULT 1
    );
    CREATE FUNCTION investment_history_dirty(p UUID, d DATE) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      IF p IS NOT NULL AND EXISTS(SELECT 1 FROM "Portfolios" WHERE id=p) THEN
        INSERT INTO "InvestmentHistoryDirty"("portfolioId","fromDate") VALUES(p,d)
        ON CONFLICT("portfolioId") DO UPDATE SET "fromDate"=LEAST("InvestmentHistoryDirty"."fromDate",EXCLUDED."fromDate"),revision="InvestmentHistoryDirty".revision+1;
      END IF;
    END $$;
    CREATE FUNCTION investment_history_source_changed() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE r jsonb; oldrow jsonb; pid UUID; d DATE;
    BEGIN
      r=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
      oldrow=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
      IF TG_TABLE_NAME='SecurityPricings' THEN
        IF TG_OP='UPDATE' AND r->'date'=oldrow->'date' AND r->'priceClose'=oldrow->'priceClose' AND r->'unadjustedClose' IS NOT DISTINCT FROM oldrow->'unadjustedClose' AND r->'priceAsOf' IS NOT DISTINCT FROM oldrow->'priceAsOf' AND r->'previousClose' IS NOT DISTINCT FROM oldrow->'previousClose' THEN RETURN NULL; END IF;
        d=CASE WHEN r->>'priceAsOf' IS NOT NULL THEN ((r->>'priceAsOf')::timestamptz AT TIME ZONE 'America/New_York')::date ELSE (r->>'date')::date END;
        IF TG_OP='UPDATE' THEN d=LEAST(d,CASE WHEN oldrow->>'priceAsOf' IS NOT NULL THEN ((oldrow->>'priceAsOf')::timestamptz AT TIME ZONE 'America/New_York')::date ELSE (oldrow->>'date')::date END);END IF;
        FOR pid IN SELECT "portfolioId" FROM "InvestmentTransactions" WHERE "securityId"=(r->>'securityId')::uuid UNION SELECT "portfolioId" FROM "Holdings" WHERE "securityId"=(r->>'securityId')::uuid LOOP
          PERFORM investment_history_dirty(pid,d);
        END LOOP;
      ELSIF TG_TABLE_NAME='Securities' THEN
        FOR pid IN SELECT "portfolioId" FROM "InvestmentTransactions" WHERE "securityId"=(r->>'id')::uuid UNION SELECT "portfolioId" FROM "Holdings" WHERE "securityId"=(r->>'id')::uuid LOOP PERFORM investment_history_dirty(pid,'1900-01-01'::date);END LOOP;
      ELSIF TG_TABLE_NAME='PortfolioTransfers' THEN
        d=LEAST((r->>'date')::date,(oldrow->>'date')::date);
        PERFORM investment_history_dirty((r->>'fromPortfolioId')::uuid,d);PERFORM investment_history_dirty((r->>'toPortfolioId')::uuid,d);
        IF TG_OP='UPDATE' THEN PERFORM investment_history_dirty((oldrow->>'fromPortfolioId')::uuid,d);PERFORM investment_history_dirty((oldrow->>'toPortfolioId')::uuid,d);END IF;
      ELSE
        pid=(r->>'portfolioId')::uuid;
        d=CASE WHEN TG_TABLE_NAME='InvestmentTransactions' THEN LEAST((r->>'date')::date,(oldrow->>'date')::date)-1 ELSE '1900-01-01'::date END;
        PERFORM investment_history_dirty(pid,d);
        IF TG_OP='UPDATE' AND r->>'portfolioId' IS DISTINCT FROM oldrow->>'portfolioId' THEN PERFORM investment_history_dirty((oldrow->>'portfolioId')::uuid,d);END IF;
      END IF;
      RETURN NULL;
    END $$;
    CREATE TRIGGER investment_history_transactions AFTER INSERT OR UPDATE OR DELETE ON "InvestmentTransactions" FOR EACH ROW EXECUTE FUNCTION investment_history_source_changed();
    CREATE TRIGGER investment_history_snapshots AFTER INSERT OR UPDATE OR DELETE ON "BrokerPortfolioData" FOR EACH ROW EXECUTE FUNCTION investment_history_source_changed();
    CREATE TRIGGER investment_history_balances AFTER INSERT OR UPDATE OR DELETE ON "PortfolioBalances" FOR EACH ROW EXECUTE FUNCTION investment_history_source_changed();
    CREATE TRIGGER investment_history_transfers AFTER INSERT OR UPDATE OR DELETE ON "PortfolioTransfers" FOR EACH ROW EXECUTE FUNCTION investment_history_source_changed();
    CREATE TRIGGER investment_history_prices AFTER INSERT OR UPDATE OR DELETE ON "SecurityPricings" FOR EACH ROW EXECUTE FUNCTION investment_history_source_changed();
    CREATE TRIGGER investment_history_security_metadata AFTER UPDATE OF "currencyCode","assetClass",symbol,"providerSymbol" ON "Securities" FOR EACH ROW WHEN (OLD."currencyCode" IS DISTINCT FROM NEW."currencyCode" OR OLD."assetClass" IS DISTINCT FROM NEW."assetClass" OR OLD.symbol IS DISTINCT FROM NEW.symbol OR OLD."providerSymbol" IS DISTINCT FROM NEW."providerSymbol") EXECUTE FUNCTION investment_history_source_changed();
    INSERT INTO "InvestmentHistoryDirty"("portfolioId","fromDate") SELECT id,'1900-01-01' FROM "Portfolios";
  `);
}
async function down(queryInterface: QueryInterface) {
  await queryInterface.sequelize.query(`
    DROP TRIGGER investment_history_transactions ON "InvestmentTransactions";DROP TRIGGER investment_history_snapshots ON "BrokerPortfolioData";DROP TRIGGER investment_history_balances ON "PortfolioBalances";DROP TRIGGER investment_history_transfers ON "PortfolioTransfers";DROP TRIGGER investment_history_prices ON "SecurityPricings";
    DROP TRIGGER investment_history_security_metadata ON "Securities";
    DROP FUNCTION investment_history_source_changed();DROP FUNCTION investment_history_dirty(UUID,DATE);
    DROP TABLE "InvestmentHistoryDirty";DROP TABLE "InvestmentHistoryState";DROP TABLE "InvestmentDailyAccountValues";
  `);
}
module.exports = { up, down };
